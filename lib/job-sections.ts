function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 读取一个二级标题正文；最后一个章节没有后续标题时也必须能匹配。 */
export function jobSectionBody(content: string, heading: string) {
  const pattern = new RegExp(
    `^##\\s*${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`,
    "m",
  );
  return content.match(pattern)?.[1] ?? "";
}
