import {
  collectPrepExternalLinks,
  getPrepV2Section,
  prepInlineText,
  type InterviewPrepDoc,
  type PrepBlock,
  type PrepExternalLink,
  type PrepInline,
} from "./interview-prep-doc.ts";
import type { CompanyEvidence, CompanyFact } from "./company-overview.ts";
import { PREP_V2_STAGE_BLOCKS, PREP_V2_THANKS_TITLE } from "./interview-prep-validation.mjs";

/** 基本信息仍由笔记持有，避免日期以外的具体时间在页面上丢失。 */
export function prepV2Overview(doc: InterviewPrepDoc) {
  const blocks = getPrepV2Section(doc.sections, "overview")?.blocks ?? [];
  const start = blocks.findIndex((block) => block.kind === "heading" && prepInlineText(block.inline) === "基本情報");
  let end = start + 1;
  while (end < blocks.length && !(blocks[end].kind === "heading" && (blocks[end] as { level: number }).level <= 3)) end++;
  const info = start < 0 ? [] : blocks.slice(start + 1, end);
  const rows = info.flatMap((block) => block.kind === "table" ? block.rows : []);
  const cell = (label: string) => rows.find((row) => prepInlineText(row[0] ?? []).trim() === label)?.[1] ?? [];
  const place = cell("場所");
  const meetingUrl = collectPrepExternalLinks([{ id: "meta", title: "研究资料", navLabel: "", blocks: [{ kind: "paragraph", inline: place }] }], 2)
    .find((link) => /^https:\/\//.test(link.href))?.href ?? "";
  // 只移走页头已承载的三项，密码、实体地点补充与临场说明不能随着信息表消失。
  const remaining = info.flatMap((block): PrepBlock[] => {
    if (block.kind !== "table") return [block];
    const rows = block.rows.filter((row) => !["岗位", "日時", "場所"].includes(prepInlineText(row[0] ?? []).trim()));
    return rows.length ? [{ ...block, rows }] : [];
  });
  return {
    blocks: start < 0 ? blocks : [...blocks.slice(0, start), ...(remaining.length ? [blocks[start], ...remaining] : []), ...blocks.slice(end)],
    dateTime: prepInlineText(cell("日時")) || doc.date,
    position: prepInlineText(cell("岗位")),
    place: prepInlineText(place) || doc.format,
    meetingUrl,
  };
}

export function prepSourceHost(href: string) {
  try { return new URL(href).hostname.replace(/^www\./, "") || "链接格式异常"; }
  catch { return "链接格式异常"; }
}

export function prepV2BlockLinks(blocks: PrepBlock[]) {
  return collectPrepExternalLinks([{ id: "citations", title: "研究资料", navLabel: "", blocks }], 2);
}

function openingUrl(href: string | undefined) {
  try {
    const url = new URL(href ?? "");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    // 邮件、站内私信和会议入口有自己的位置，不能因为被引用过就当成公司资料。
    if (/^(mail\.google\.com|outlook\.(live|office)\.com|meet\.google\.com|teams\.(live|microsoft)\.com)$|(?:^|\.)zoom\.us$/i.test(url.hostname)
      || /(?:^|\/)(?:messages|scouts|inbox|joinmeeting)(?:\/|$)/i.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

function openingUrlKey(url: URL) {
  // 同一个详情页常有带斜杠和不带斜杠两个版本。保留查询与定位，职位可能由其中之一确定。
  return url.origin + url.pathname.replace(/\/$/, "") + url.search + url.hash;
}

function isJobDetail(url: URL) {
  const path = url.pathname;
  return /\/(?:jobs?|job_offers|jobs\/detail|job\/view|careers?)\/(?:j-)?\d+(?:\/|$)/i.test(path)
    || /\/(?:jobdetails?|joboffer_search_preview_pdt_view|viewjob|rsheet\.html)(?:\/|$)/i.test(path)
    || /\/jobdetail\d+(?:\/|$)|\/job\/[^/]+-[a-f0-9]{16}\/?$/i.test(path)
    || (/\/(?:careers?|recruit)(?:\/|$)/i.test(path) && /^#position-[\w-]+$/i.test(url.hash))
    || (/(?:^|\.)wantedly\.com$/.test(url.hostname) && /^\/projects\/\d+\/?$/.test(path))
    || (url.hostname === "herp.careers" && /^\/v\d+\/[^/]+\/[^/]+\/?$/.test(path))
    || (url.hostname === "hrmos.co" && /^\/pages\/[^/]+\/jobs\/[^/]+\/?$/.test(path));
}

type OpeningSourceKind = "job" | "site" | "article" | "company" | "other";

const CURRENT_POSTING_LABEL = /(?:当前|本次|现行|本轮|現行)[^。]*求人|原求人|求人(?:正本|原文|全文)|岗位原文/;

function openingSourceKind(link: PrepExternalLink, url: URL, caseMatch: boolean): OpeningSourceKind {
  const label = link.label.normalize("NFKC");
  const group = link.group.normalize("NFKC");
  const path = url.pathname;
  if (/OpenWork|転職会議|口コミ|外部評価|外部评价/i.test(label + group)
    || /(?:^|\.)(?:openwork|jobtalk)\.jp$/.test(url.hostname)) return "other";
  if (/求人一覧|求人検索|求人紹介|求人情報一覧|職種検索|募集一覧|採用情報一覧|招聘列表|其他岗位/.test(label)) return "company";
  // 「求人・採用」下面也可能是博客、招聘流程和职种列表；具体求人要由单项标题或直达地址来确定。
  if (isJobDetail(url) || CURRENT_POSTING_LABEL.test(label) || /求人(?:票|詳細|ページ|\s*\d)|岗位详情|職位ページ/.test(label)
    || (caseMatch && /通年採用|キャリア採用|募集要項|官方招聘/.test(label))) return "job";
  if (/ブログ|博客|インタビュー|访谈|采访|訪談|專訪|専訪|コラム|公式\s*note/i.test(label)
    || /\/(?:blogs?|techblog|interviews?)(?:\/|$)/i.test(path)) return "article";
  if (/官网|官網|公式(?:トップ|サイト|ホームページ|HP)|コーポレートサイト|会社(?:概要|情報|紹介)|会社(?:案内|沿革)|公司(?:概要|简介|概况|介绍|信息)|法人概要/i.test(label)
    || /\/(?:about|company|corporate|profile)(?:\/(?:index|profile|outline))?(?:\.html?)?\/?$/i.test(path)) return "site";
  if (/公式|官方|採用|招聘|会社|公司|事業|业务|業務|サービス|产品|製品|プロダクト|導入事例|案例|決算|\bIR\b/i.test(label)
    || /公式|官方|会社|公司|事業|业务|製品|产品/i.test(group)
    || /\/(?:careers?|recruit|services?|products?)(?:\/|$)/i.test(path)) return "company";
  return "other";
}

/** 首屏从本轮研究和明确关联的案件取求人，往轮链接与公司证据只补充已有资料。 */
export function prepOpeningSources(
  sources: PrepExternalLink[],
  jobPostingUrl?: string,
  companyEvidence: CompanyEvidence[] = [],
  currentSources: PrepExternalLink[] = sources,
) {
  const caseHref = jobPostingUrl?.trim() ?? "";
  const caseUrl = openingUrl(caseHref);
  const caseKey = caseUrl ? openingUrlKey(caseUrl) : "";
  const currentKeys = new Set(currentSources.flatMap((link) => {
    const url = openingUrl(link.href);
    return url ? [openingUrlKey(url)] : [];
  }));
  const seen = new Set<string>();
  const prepared = [...currentSources, ...sources].flatMap((link) => {
    const url = openingUrl(link.href);
    if (!url) return [];
    const key = openingUrlKey(url);
    if (seen.has(key)) return [];
    seen.add(key);
    const kind = openingSourceKind(link, url, key === caseKey);
    return [{ link, key, kind, current: currentKeys.has(key) }];
  });
  const postings = prepared.filter((source) => source.kind === "job");
  const currentPostings = postings.filter((source) => source.current);
  // 同一研究章节可能引用别的岗位作对比。有本轮正本时，其余仍可在更多资料中打开。
  const confirmedCurrent = currentPostings.filter((source) => source.key === caseKey || CURRENT_POSTING_LABEL.test(source.link.label.normalize("NFKC")));
  const exact = (confirmedCurrent.length ? confirmedCurrent : postings).find((source) => source.key === caseKey);
  const caseFallback = !exact && !confirmedCurrent.length && caseUrl && isJobDetail(caseUrl)
    ? { href: caseHref, label: "求人票", group: "", starred: false }
    : null;
  const primary = exact?.link ?? caseFallback;
  const visiblePostings = confirmedCurrent.length ? confirmedCurrent : primary ? [] : currentPostings.length ? currentPostings : postings;
  const job = [...(primary ? [primary] : []), ...visiblePostings.filter((source) => source !== exact).map((source) => source.link)];
  if (caseFallback) seen.add(caseKey);

  const companyGroups: Record<"site" | "article" | "company", PrepExternalLink[]> = {
    site: [], article: [], company: [],
  };
  const other: PrepExternalLink[] = [];
  for (const source of prepared) {
    if (caseFallback && source.key === caseKey) continue;
    if (source.kind === "job" || source.kind === "other") {
      if (!job.includes(source.link)) other.push(source.link);
    } else {
      companyGroups[source.kind].push(source.link);
    }
  }
  for (const evidence of companyEvidence) {
    if (!evidence.url) continue;
    const url = openingUrl(evidence.url);
    if (!url) continue;
    const key = openingUrlKey(url);
    if (seen.has(key)) continue;
    const link = { href: evidence.url, label: evidence.label, group: "", starred: false };
    const kind = openingSourceKind(link, url, false);
    if (kind === "job" || kind === "other") continue;
    seen.add(key);
    companyGroups[kind].push(link);
  }
  const { site, article, company } = companyGroups;
  // 官网、博客各露出一条，避免多篇公司介绍把其他可用入口挤出首屏。
  return { job, company: [...site.slice(0, 1), ...article.slice(0, 1), ...company, ...site.slice(1), ...article.slice(1)], other };
}

export function prepOpeningCompanyFacts(facts: CompanyFact[]) {
  const rank = (fact: CompanyFact) => {
    if (/^(employees|workforce|headcount|company_size)$/.test(fact.id) || /员工数|员工规模|人员规模|従業員|社員数/.test(fact.label)) return 0;
    if (fact.id === "business" || /^(业务|事業)/.test(fact.label)) return 1;
    return 2;
  };
  return [...facts].sort((a, b) => rank(a) - rank(b));
}

export type PrepStageSection = { id: string; title: string; blocks: PrepBlock[] };

/**
 * 临场卡只留「要说出口的话」：say 台词，加上它紧邻的那个小标题（不然一串台词分不清是哪一问的）。
 * 背景、分析、资料一概不要——面试前最后几分钟只看要说的。
 * 一个标题下没有台词时连标题一起丢，免得卡上出现一排空标题。keep 可额外放行少数非台词块。
 */
export function stageCardBlocks(blocks: PrepBlock[], keep: (block: PrepBlock) => boolean = (block) => block.kind === "say"): PrepBlock[] {
  const kept: PrepBlock[] = [];
  let heading: PrepBlock | null = null;
  for (const block of blocks) {
    if (block.kind === "heading") {
      heading = block;
    } else if (keep(block)) {
      if (heading) {
        kept.push(heading);
        heading = null;
      }
      kept.push(block);
    }
  }
  return kept;
}

/** 切出标题为 title 的小节（到下一个同级或更高的标题为止），连同标题本身与剩下的部分一起返回。 */
function takeSubsection(blocks: PrepBlock[], title: string, depth: number) {
  const start = blocks.findIndex((block) => block.kind === "heading" && block.depth === depth && prepInlineText(block.inline).trim() === title);
  if (start < 0) return null;
  let end = start + 1;
  while (end < blocks.length) {
    const block = blocks[end];
    if (block.kind === "heading" && block.depth <= depth) break;
    end++;
  }
  return { heading: blocks[start], body: blocks.slice(start + 1, end), rest: [...blocks.slice(0, start), ...blocks.slice(end)] };
}

function linksToSection(nodes: PrepInline[]): boolean {
  return nodes.some((node) => (node.kind === "ref" && node.section !== "") || (node.kind === "strong" && linksToSection(node.children)));
}

/**
 * 临场卡按面试流程排：規律 → 冒頭 → 事実カード → 懸念 → 志望動機 → 逆質問 → 締め，其余临场备用（被问到才用的短答）垫底。
 * 固定块住在临场备用里（不新增 H2），这里按标题取出；没有这些块的旧稿，顺序和内容都与以前相同。
 * 規律是几行纪律、事実カード是表，都不是台词：这两块按自己的块型上卡，其余块仍只留台词。
 */
export function prepV2StageSections(doc: InterviewPrepDoc): PrepStageSection[] {
  const backup = getPrepV2Section(doc.sections, "backup");
  let rest = backup?.blocks ?? [];
  const fixed = new Map<string, PrepBlock[]>();
  for (const spec of PREP_V2_STAGE_BLOCKS) {
    const taken = takeSubsection(rest, spec.title, 3);
    if (!taken) continue;
    fixed.set(spec.id, taken.body);
    rest = taken.rest;
  }
  const chapter = (id: string, blocks: PrepBlock[] | null): PrepStageSection[] => {
    const spec = PREP_V2_STAGE_BLOCKS.find((item) => item.id === id);
    return spec && blocks ? [{ id: `prep-v2-stage-${id}`, title: spec.title, blocks }] : [];
  };
  const section = (id: "motivation" | "questions"): PrepStageSection[] => {
    const found = getPrepV2Section(doc.sections, id);
    return found ? [{ id: found.id, title: found.title, blocks: stageCardBlocks(found.blocks) }] : [];
  };
  const discipline = fixed.get("discipline");
  const opening = fixed.get("opening");
  const facts = fixed.get("facts");
  const concerns = fixed.get("concerns");
  const closing = fixed.get("closing");
  // 当日お礼不是台词，但面试一结束就要发，所以整段跟在締め后面。
  const thanks = closing ? takeSubsection(closing, PREP_V2_THANKS_TITLE, 4) : null;
  return [
    // 規律：列表项就是要带进场的几行；▷ 的出处留在稿里，不上卡。
    ...chapter("discipline", discipline ? stageCardBlocks(discipline, (block) => block.kind === "list" || block.kind === "say") : null),
    // 自我介绍不复制进准备稿，冒頭保留指向朗读节的链接行，卡上一点就能打开正本。
    ...chapter("opening", opening ? stageCardBlocks(opening, (block) => block.kind === "say"
      || ((block.kind === "paragraph" || block.kind === "note") && linksToSection(block.inline))) : null),
    // 事実カード：表里每行就是被问到时的第一句；逐社子表、确认日期与正本链接的 ▷ 也要在卡上，被问「一つずつ」时就看这里。
    ...chapter("facts", facts ? stageCardBlocks(facts, (block) => block.kind === "table" || block.kind === "say" || block.kind === "note") : null),
    ...chapter("concerns", concerns ? stageCardBlocks(concerns) : null),
    ...section("motivation"),
    ...section("questions"),
    ...chapter("closing", closing ? [...stageCardBlocks(thanks?.rest ?? closing), ...(thanks ? [thanks.heading, ...thanks.body] : [])] : null),
    ...(backup ? [{ id: backup.id, title: backup.title, blocks: stageCardBlocks(rest) }] : []),
  ].filter((item) => item.blocks.length > 0);
}
