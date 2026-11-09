import { getPrepV2Section, parseInline, parseInterviewPrepDoc, prepInlineText,
  type InterviewPrepDoc, type PrepBlock, type PrepInline } from "../interview-prep-doc.ts";
import { interviewPrepVersion, PREP_V2_STAGE_BLOCKS } from "../interview-prep-validation.mjs";
import { INTERVIEW_RECORDS, type InterviewCompanyProjection, type InterviewContext } from "../interview-read-model.ts";
import { getString, getType, stripNonLinkRegions, type Note } from "../notes.ts";
import { readInterviewRecord } from "./interview-read-model.ts";
import { RequestRejectedError } from "./write-guards.ts";

type InterviewAiSource = { id: string; label: string; excerpt: string };
type InterviewAiContext = {
  limited: boolean;
  usingPrivatePrep: boolean;
  sources: InterviewAiSource[];
};

const CONTACT_TEXT = /[a-z][a-z\d+.-]*:\/\/|www\.|mailto:|\S+@\S+\.\S+|(?:\+?\d{1,4}[ -])?\(?\d{2,4}\)?[ -]\d{2,4}[ -]\d{3,4}|(?<!\d)0\d{9,10}(?!\d)/i;
const PRIVATE_TEXT = /電話|电话|連絡先|联系方式|メールアドレス|住所|面試邀請|面试邀请|招待メール|会議(?:ID|リンク)|会议(?:ID|链接)|パス(?:コード|ワード)|验证码|密[码碼]|薪[资資酬]|工资|工資|年収|月給|年俸|報酬|年薪|時給|在留|签证|簽證|ビザ|就労資格|他社(?:状況|選考)|老師留言|老师留言|HR事実カード/i;
const OUTSIDE_REVIEWS = /openwork|転職会議|口コミ|口碑|外部[评評][价価]|员工评价|匿名评论|従業員レビュー|社員レビュー/i;
const OVERVIEW_SKIP = /基本情報|(?:基本|基础)信息|人物|面[接试]官|邀请|招待|連絡|联[络系]|日[時时程]|会[場场议議]|場所|地址|交通|私有|个人信息|内部备注|内部用/;
const MAIN_QUESTION = /^[1-3]\.\s*〔(?:面接官本人型|经验连接型|事业课题型|活跃期待型)〕/;
const ROUND_LABEL = /^(?:[一二三四五]面|[一二三四五1-5]次(?:面接|面试)?|最終面接|最终面试|技術面接|技术面试|カジュアル面談|面接|面试|面談|面谈)$/;

function textWithoutLinks(nodes: PrepInline[]): string {
  return nodes.map((node) => {
    if (node.kind === "strong") return textWithoutLinks(node.children);
    if (node.kind === "link" || node.kind === "ref") return "";
    return node.kind === "ruby" ? node.base : node.text;
  }).join("");
}

function safeExcerpt(value: string, max: number) {
  const text = value.replace(/\s+/g, " ").trim();
  const normalized = text.normalize("NFKC");
  // 直接舍弃有隐私标记或原始口碑的片段，避免删半句后让模型误读剩余内容。
  if (CONTACT_TEXT.test(normalized) || PRIVATE_TEXT.test(normalized) || OUTSIDE_REVIEWS.test(normalized)) return "";
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const lastEnd = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"));
  return lastEnd >= max / 2 ? head.slice(0, lastEnd + 1) : `${head.trimEnd()}…`;
}

function reviewLink(nodes: PrepInline[]): boolean {
  return nodes.some((node) => (node.kind === "link" && /openwork|jobtalk|vorkers/i.test(node.href))
    || (node.kind === "strong" && reviewLink(node.children)));
}

function safeInline(nodes: PrepInline[], max: number) {
  return OUTSIDE_REVIEWS.test(prepInlineText(nodes).normalize("NFKC")) || reviewLink(nodes)
    ? "" : safeExcerpt(textWithoutLinks(nodes), max);
}

function addSource(sources: InterviewAiSource[], id: string, label: string, excerpt: string) {
  if (excerpt) sources.push({ id, label, excerpt });
}

function headingGroups(blocks: PrepBlock[], depth = 3) {
  const groups: { title: string; blocks: PrepBlock[] }[] = [{ title: "", blocks: [] }];
  for (const block of blocks) {
    if (block.embed) continue;
    if (block.kind === "heading" && block.depth === depth) {
      groups.push({ title: prepInlineText(block.inline).trim(), blocks: [] });
    } else {
      groups[groups.length - 1].blocks.push(block);
    }
  }
  return groups;
}

function beforeSubheading(blocks: PrepBlock[]) {
  const end = blocks.findIndex((block) => block.kind === "heading");
  return end < 0 ? blocks : blocks.slice(0, end);
}

function roleNotes(blocks: PrepBlock[]) {
  let position = "";
  const overview: string[] = [];
  for (const group of headingGroups(blocks)) {
    const direct = beforeSubheading(group.blocks);
    if (group.title === "基本情報") {
      const row = direct.flatMap((block) => block.kind === "table" ? block.rows : [])
        .find((cells) => prepInlineText(cells[0] ?? []).trim() === "岗位");
      position ||= safeInline(row?.[1] ?? [], 100);
    }
    // v2 允许按本场内容自定纵览小标题。保留不同主题的首段，避开日程和人物信息。
    const title = safeExcerpt(group.title, 100);
    if (OVERVIEW_SKIP.test(group.title) || (group.title && !title) || overview.length >= 6) continue;
    const excerpts = direct.flatMap((block) => {
      if (block.kind === "paragraph") return [safeInline(block.inline, 320)];
      if (block.kind === "list") return block.items.map((item) => safeInline(item, 220));
      return [];
    }).filter(Boolean).slice(0, 2);
    if (excerpts.length) {
      overview.push([title, ...excerpts].filter(Boolean).join("\n"));
    }
  }
  return [position && `岗位：${position}`, ...overview].filter(Boolean).join("\n\n");
}

function candidateLines(blocks: PrepBlock[], max: number) {
  return beforeSubheading(blocks).flatMap((block) =>
    block.kind === "say" && block.speaker === "you" ? [safeInline(block.inline, max)] : []);
}

function questionNotes(blocks: PrepBlock[]) {
  return headingGroups(blocks).flatMap((group) => {
    if (!MAIN_QUESTION.test(group.title.normalize("NFKC"))) return [];
    const title = safeExcerpt(group.title, 100);
    const [question] = candidateLines(group.blocks, 320);
    return title && question ? [`${title}\n${question}`] : [];
  }).slice(0, 3).join("\n\n");
}

function strategyNotes(blocks: PrepBlock[]) {
  const stageTitle = (id: string) => PREP_V2_STAGE_BLOCKS.find((item) => item.id === id)?.title;
  const groups = headingGroups(blocks);
  const discipline = beforeSubheading(groups.find((group) => group.title === stageTitle("discipline"))?.blocks ?? [])
    .flatMap((block) => block.kind === "list" ? block.items.map((item) => safeInline(item, 160)) : [])
    .filter(Boolean).slice(0, 3).join("\n");
  const concerns = headingGroups(groups.find((group) => group.title === stageTitle("concerns"))?.blocks ?? [], 4)
    .flatMap((group) => {
      const title = safeExcerpt(group.title, 100);
      const [line] = candidateLines(group.blocks, 280);
      return title && line ? [`${title}\n${line}`] : [];
    }).slice(0, 4).join("\n");
  const [closing] = candidateLines(groups.find((group) => group.title === stageTitle("closing"))?.blocks ?? [], 260);
  return [discipline && `本场答题提醒\n${discipline}`, concerns && `可能被追问的点与应答\n${concerns}`,
    closing && `结束时的一句话\n${closing}`].filter(Boolean).join("\n\n");
}

/** 只用本轮结构化内容；准备稿中的评论、表、外链和嵌入材料不直接传给模型。 */
function prepSources(doc: InterviewPrepDoc): InterviewAiSource[] {
  const sources: InterviewAiSource[] = [];
  const overview = getPrepV2Section(doc.sections, "overview")?.blocks ?? [];
  addSource(sources, "role", "本轮准备稿 · 公司、岗位与准备重点", roleNotes(overview));
  const motivation = getPrepV2Section(doc.sections, "motivation")?.blocks ?? [];
  const shortAnswer = headingGroups(motivation).find((group) => group.title === "20秒版（既定）")?.blocks ?? [];
  addSource(sources, "motivation", "本轮准备稿 · 志望動機短答", candidateLines(shortAnswer, 330).filter(Boolean).slice(0, 2).join("\n"));
  const questions = getPrepV2Section(doc.sections, "questions")?.blocks ?? [];
  addSource(sources, "questions", "本轮准备稿 · 已备逆質問", questionNotes(questions));
  const backup = getPrepV2Section(doc.sections, "backup")?.blocks ?? [];
  addSource(sources, "preparation", "本轮准备稿 · 临场提醒与应答", strategyNotes(backup));
  return sources;
}

function outboundAllowed(note: Note) {
  return String(note.frontmatter.publish).trim() !== "false";
}

async function companySource(
  projection: InterviewCompanyProjection,
  readNote: (path: string) => Promise<Note>,
  allowPrivateSummary: boolean,
): Promise<{ source: InterviewAiSource | null; limited: boolean; usingPrivateSummary: boolean }> {
  const result = { source: null as InterviewAiSource | null, limited: false, usingPrivateSummary: false };
  if (projection.summary) {
    const note = await readNote(projection.summary.sourcePath);
    if (note.path === projection.summary.sourcePath && getType(note) === "ai-report"
      && getString(note.frontmatter.report_kind) === "company-summary") {
      const excerpt = projection.summary.data.paragraphs.map((nodes) => safeInline(nodes, 430))
        .filter(Boolean).slice(0, 3).join("\n");
      result.limited = Boolean(excerpt) && !outboundAllowed(note);
      if (excerpt && (!result.limited || allowPrivateSummary)) {
        return { source: { id: "company", label: "公司总结 · 业务与背景", excerpt },
          limited: result.limited, usingPrivateSummary: result.limited };
      }
    }
  }
  if (!projection.profile || !projection.dossierPath) return result;
  const dossier = await readNote(projection.dossierPath);
  if (dossier.path !== projection.dossierPath || getType(dossier) !== "company" || !outboundAllowed(dossier)) return result;
  const excerpt = projection.profile.facts
    .filter((fact) => /业务|事業|产品|製品|サービス|客户|顧客|员工数|従業員|规模|成立|設立|上市|上場|集团|グループ/.test(fact.label))
    .map((fact) => safeInline(parseInline(`${fact.label}：${fact.value}`), 200))
    .filter(Boolean).slice(0, 4).join("\n");
  if (excerpt) result.source = { id: "company", label: "公司卷宗 · 业务事实", excerpt };
  return result;
}

type ContextReader = {
  context(path: string): Promise<InterviewContext | null>;
  company(path: string): Promise<InterviewCompanyProjection | null>;
  note(path: string): Promise<Note>;
};

export async function resolveInterviewAiContext(prepPath: string, reader: ContextReader, allowPrivatePrep = false): Promise<InterviewAiContext> {
  const indexed = await reader.context(prepPath);
  if (indexed?.source.path !== prepPath || indexed.source.type !== "interview-prep") {
    throw new RequestRejectedError("找不到本轮的面试准备稿。", 404);
  }
  const note = await reader.note(prepPath);
  if (note.path !== prepPath || getType(note) !== "interview-prep"
    || getString(note.frontmatter.replay_of) || interviewPrepVersion(note.frontmatter.prep_version) !== 2) {
    throw new RequestRejectedError("本场没有新版面试准备稿。", 404);
  }
  const privatePrep = !outboundAllowed(note);
  // 私有准备稿须明确选择本轮摘录；同案其他私有材料仍遵守原有边界。
  const doc = privatePrep && !allowPrivatePrep ? null : parseInterviewPrepDoc({ ...note, content: stripNonLinkRegions(note.content) }, []);
  const sources = doc ? prepSources(doc) : [];
  let limited = privatePrep;
  let usingPrivatePrep = privatePrep && sources.length > 0;
  let ownerName = "";
  // 只按准备稿已解析的案件读取公司投影，不能拿显示名称去匹配另一家或另一个岗位。
  if (indexed.contextPath) {
    const projection = await reader.company(indexed.contextPath);
    if (projection?.sourcePath === indexed.contextPath) {
      const company = await companySource(projection, (path) => reader.note(path), allowPrivatePrep);
      if (company.source) sources.unshift(company.source);
      limited ||= company.limited;
      usingPrivatePrep ||= company.usingPrivateSummary;
      if (privatePrep && !usingPrivatePrep) {
        // 准备稿设为私有时，公司的名称也只能从另有资格外发的案件取得。
        const owner = await reader.note(indexed.contextPath);
        if (owner.path === indexed.contextPath && outboundAllowed(owner)) {
          ownerName = safeExcerpt(getString(owner.frontmatter.company), 100);
        }
      }
    }
  }
  if (doc && sources.length && (!privatePrep || usingPrivatePrep)) {
    const companyName = safeExcerpt(doc.company, 100);
    const round = doc.round.trim().normalize("NFKC");
    const scope = [companyName, ROUND_LABEL.test(round) ? round : ""].filter(Boolean).join(" · ");
    if (scope) sources.unshift({ id: "scope", label: "公司与轮次", excerpt: scope });
  } else if (ownerName) {
    sources.unshift({ id: "scope", label: "公司名称", excerpt: ownerName });
  }
  return { limited, usingPrivatePrep, sources };
}

export async function readInterviewAiContext(prepPath: string, revision: string, allowPrivatePrep = false): Promise<InterviewAiContext> {
  if (!prepPath.endsWith(".md") || prepPath.length > 1024 || !revision || revision.length > 256) {
    throw new RequestRejectedError("本场面试资料范围无效，请刷新后重试。", 400);
  }
  const { readModelRuntime, readModelNote } = await import("../../app/read-model-server.ts");
  const { model, revision: pinnedRevision } = await readModelRuntime(revision);
  return resolveInterviewAiContext(prepPath, {
    context: (path) => readInterviewRecord<InterviewContext>(model, pinnedRevision, INTERVIEW_RECORDS.context, path),
    company: (path) => readInterviewRecord<InterviewCompanyProjection>(model, pinnedRevision, INTERVIEW_RECORDS.company, path),
    note: (path) => readModelNote(path, pinnedRevision),
  }, allowPrivatePrep);
}
