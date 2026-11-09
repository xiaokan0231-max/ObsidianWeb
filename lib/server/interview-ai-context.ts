import { getPrepV2Section, parseInline, parseInterviewPrepDoc, prepInlineText,
  type InterviewPrepDoc, type PrepBlock, type PrepInline } from "../interview-prep-doc.ts";
import { interviewPrepVersion } from "../interview-prep-validation.mjs";
import { INTERVIEW_RECORDS, type InterviewCompanyProjection, type InterviewContext } from "../interview-read-model.ts";
import { getString, getType, stripNonLinkRegions, type Note } from "../notes.ts";
import { readInterviewRecord } from "./interview-read-model.ts";
import { RequestRejectedError } from "./write-guards.ts";

type InterviewAiSource = { id: string; label: string; excerpt: string };
type InterviewAiContext = {
  limited: boolean;
  sources: InterviewAiSource[];
};

const CONTACT_TEXT = /[a-z][a-z\d+.-]*:\/\/|www\.|mailto:|\S+@\S+\.\S+|(?:\+?\d{1,4}[ -])?\(?\d{2,4}\)?[ -]\d{2,4}[ -]\d{3,4}|(?<!\d)0\d{9,10}(?!\d)/i;
const PRIVATE_TEXT = /電話|电话|連絡先|联系方式|メールアドレス|住所|面試邀請|面试邀请|招待メール|会議(?:ID|リンク)|会议(?:ID|链接)|パス(?:コード|ワード)|验证码|密[码碼]|薪[资資酬]|工资|工資|年収|月給|年俸|報酬|年薪|時給|在留|签证|簽證|ビザ|就労資格|他社(?:状況|選考)|老師留言|老师留言|HR事実カード/i;
const OUTSIDE_REVIEWS = /openwork|転職会議|口コミ|口碑|外部[评評][价価]|员工评价|匿名评论|従業員レビュー|社員レビュー/i;
const ROLE_HEADING = /^(?:工作与机会|公司与岗位|岗位(?:实态|职责|要求|定位|拆解|解读)?|本轮(?:纵览|重点|面试)|贡献(?:切入点|机会|与建议)|招聘背景)$/;
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

function headingText(block: PrepBlock) {
  return block.kind === "heading" && block.depth === 3 ? prepInlineText(block.inline).trim() : "";
}

function roleNotes(blocks: PrepBlock[]) {
  let position = "";
  const paragraphs: string[] = [];
  let heading = "";
  for (const block of blocks) {
    if (block.embed) continue;
    if (block.kind === "heading") heading = headingText(block);
    if (!position && heading === "基本情報" && block.kind === "table") {
      const row = block.rows.find((cells) => prepInlineText(cells[0] ?? []).trim() === "岗位");
      position = safeInline(row?.[1] ?? [], 100);
    }
    if (!ROLE_HEADING.test(heading) || paragraphs.length >= 3) continue;
    if (block.kind === "paragraph") {
      const text = safeInline(block.inline, 320);
      if (text) paragraphs.push(text);
    } else if (block.kind === "list") {
      paragraphs.push(...block.items.map((item) => safeInline(item, 220)).filter(Boolean));
    }
  }
  return [position && `岗位：${position}`, ...paragraphs.slice(0, 3)].filter(Boolean).join("\n");
}

/** 只用本轮结构化内容；准备稿中的评论、表、外链和嵌入材料不直接传给模型。 */
function prepSources(doc: InterviewPrepDoc): InterviewAiSource[] {
  const sources: InterviewAiSource[] = [];
  const overview = getPrepV2Section(doc.sections, "overview")?.blocks ?? [];
  addSource(sources, "role", "本轮准备稿 · 岗位与准备重点", roleNotes(overview));

  const motivation = getPrepV2Section(doc.sections, "motivation")?.blocks ?? [];
  const start = motivation.findIndex((block) => headingText(block) === "20秒版（既定）");
  if (start >= 0) {
    const next = motivation.findIndex((block, index) => index > start && block.kind === "heading");
    const lines = motivation.slice(start + 1, next < 0 ? undefined : next).flatMap((block) =>
      block.kind === "say" && block.speaker === "you" && !block.embed
        ? [safeInline(block.inline, 330)] : []);
    addSource(sources, "motivation", "本轮准备稿 · 志望動機短答", lines.filter(Boolean).slice(0, 2).join("\n"));
  }
  return sources;
}

function outboundAllowed(note: Note) {
  return String(note.frontmatter.publish).trim() !== "false";
}

async function companySource(
  projection: InterviewCompanyProjection,
  readNote: (path: string) => Promise<Note>,
): Promise<InterviewAiSource | null> {
  if (projection.summary) {
    const note = await readNote(projection.summary.sourcePath);
    if (note.path === projection.summary.sourcePath && getType(note) === "ai-report"
      && getString(note.frontmatter.report_kind) === "company-summary" && outboundAllowed(note)) {
      const excerpt = projection.summary.data.paragraphs.map((nodes) => safeInline(nodes, 430))
        .filter(Boolean).slice(0, 3).join("\n");
      if (excerpt) return { id: "company", label: "公司总结 · 业务与背景", excerpt };
    }
  }
  if (!projection.profile || !projection.dossierPath) return null;
  const dossier = await readNote(projection.dossierPath);
  if (dossier.path !== projection.dossierPath || getType(dossier) !== "company" || !outboundAllowed(dossier)) return null;
  const excerpt = projection.profile.facts
    .filter((fact) => /业务|事業|产品|製品|サービス|客户|顧客|员工数|従業員|规模|成立|設立|上市|上場|集团|グループ/.test(fact.label))
    .map((fact) => safeInline(parseInline(`${fact.label}：${fact.value}`), 200))
    .filter(Boolean).slice(0, 4).join("\n");
  return excerpt ? { id: "company", label: "公司卷宗 · 业务事实", excerpt } : null;
}

type ContextReader = {
  context(path: string): Promise<InterviewContext | null>;
  company(path: string): Promise<InterviewCompanyProjection | null>;
  note(path: string): Promise<Note>;
};

export async function resolveInterviewAiContext(prepPath: string, reader: ContextReader): Promise<InterviewAiContext> {
  const indexed = await reader.context(prepPath);
  if (indexed?.source.path !== prepPath || indexed.source.type !== "interview-prep") {
    throw new RequestRejectedError("找不到本轮的面试准备稿。", 404);
  }
  const note = await reader.note(prepPath);
  if (note.path !== prepPath || getType(note) !== "interview-prep"
    || getString(note.frontmatter.replay_of) || interviewPrepVersion(note.frontmatter.prep_version) !== 2) {
    throw new RequestRejectedError("本场没有新版面试准备稿。", 404);
  }
  const limited = !outboundAllowed(note);
  // 私有准备稿只确定本场身份；对话仍可使用独立允许外发的公司资料或本人输入。
  const doc = limited ? null : parseInterviewPrepDoc({ ...note, content: stripNonLinkRegions(note.content) }, []);
  const sources = doc ? prepSources(doc) : [];
  let companyName = doc ? safeExcerpt(doc.company, 100) : "";
  // 只按准备稿已解析的案件读取公司投影，不能拿显示名称去匹配另一家或另一个岗位。
  if (indexed.contextPath) {
    const projection = await reader.company(indexed.contextPath);
    if (projection?.sourcePath === indexed.contextPath) {
      const company = await companySource(projection, (path) => reader.note(path));
      if (company) sources.unshift(company);
      if (limited) {
        // 准备稿设为私有时，公司的名称也只能从另有资格外发的案件取得。
        const owner = await reader.note(indexed.contextPath);
        if (owner.path === indexed.contextPath && outboundAllowed(owner)) {
          companyName = safeExcerpt(getString(owner.frontmatter.company), 100);
        }
      }
    }
  }
  if (doc && sources.length) {
    const round = doc.round.trim().normalize("NFKC");
    const scope = [companyName, ROUND_LABEL.test(round) ? round : ""].filter(Boolean).join(" · ");
    if (scope) sources.unshift({ id: "scope", label: "公司与轮次", excerpt: scope });
  } else if (limited && companyName) {
    sources.unshift({ id: "scope", label: "公司名称", excerpt: companyName });
  }
  return { limited, sources };
}

export async function readInterviewAiContext(prepPath: string, revision: string): Promise<InterviewAiContext> {
  if (!prepPath.endsWith(".md") || prepPath.length > 1024 || !revision || revision.length > 256) {
    throw new RequestRejectedError("本场面试资料范围无效，请刷新后重试。", 400);
  }
  const { readModelRuntime, readModelNote } = await import("../../app/read-model-server.ts");
  const { model, revision: pinnedRevision } = await readModelRuntime(revision);
  return resolveInterviewAiContext(prepPath, {
    context: (path) => readInterviewRecord<InterviewContext>(model, pinnedRevision, INTERVIEW_RECORDS.context, path),
    company: (path) => readInterviewRecord<InterviewCompanyProjection>(model, pinnedRevision, INTERVIEW_RECORDS.company, path),
    note: (path) => readModelNote(path, pinnedRevision),
  });
}
