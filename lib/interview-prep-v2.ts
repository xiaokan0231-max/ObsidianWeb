import {
  collectPrepExternalLinks,
  getPrepV2Section,
  prepInlineText,
  type InterviewPrepDoc,
  type PrepBlock,
  type PrepInline,
} from "./interview-prep-doc.ts";
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
 * 临场卡按面试流程排：冒頭 → 懸念 → 志望動機 → 逆質問 → 締め，其余临场备用（被问到才用的短答）垫底。
 * 三个固定块住在临场备用里（不新增 H2），这里按标题取出；没有这三块的旧稿，顺序和内容都与以前相同。
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
  const opening = fixed.get("opening");
  const concerns = fixed.get("concerns");
  const closing = fixed.get("closing");
  // 当日お礼不是台词，但面试一结束就要发，所以整段跟在締め后面。
  const thanks = closing ? takeSubsection(closing, PREP_V2_THANKS_TITLE, 4) : null;
  return [
    // 自我介绍不复制进准备稿，冒頭保留指向朗读节的链接行，卡上一点就能打开正本。
    ...chapter("opening", opening ? stageCardBlocks(opening, (block) => block.kind === "say"
      || ((block.kind === "paragraph" || block.kind === "note") && linksToSection(block.inline))) : null),
    ...chapter("concerns", concerns ? stageCardBlocks(concerns) : null),
    ...section("motivation"),
    ...section("questions"),
    ...chapter("closing", closing ? [...stageCardBlocks(thanks?.rest ?? closing), ...(thanks ? [thanks.heading, ...thanks.body] : [])] : null),
    ...(backup ? [{ id: backup.id, title: backup.title, blocks: stageCardBlocks(rest) }] : []),
  ].filter((item) => item.blocks.length > 0);
}
