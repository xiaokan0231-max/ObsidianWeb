import {
  collectPrepExternalLinks,
  getPrepV2Section,
  prepInlineText,
  type InterviewPrepDoc,
  type PrepBlock,
} from "./interview-prep-doc.ts";

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
