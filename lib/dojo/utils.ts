export function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function stableId(prefix: string, value: string) {
  return `${prefix}_${stableHash(value.normalize("NFKC").trim().toLowerCase())}`;
}

export function tokyoParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}:${value("second")}`,
    fileTime: `${value("hour")}${value("minute")}`,
  };
}

export function sanitizeFilename(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#[\]^]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "未命名";
}

export function normalizeAnswer(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ja")
    .replace(/[\s、。,.!?！？「」『』（）()]/g, "");
}

// 值里带换行会把 frontmatter 整块撑破，所以一律用 JSON 字符串字面量包起来：
// JSON 的转义集合完整落在 YAML 双引号字符串里，输出直接是合法 YAML。
// 这份**还会把换行压成空格**——语言道场写进去的是 model 名・考试名这类单行标识，压掉不丢信息。
export function yamlString(value: string) {
  return JSON.stringify(value.replace(/\r?\n/g, " "));
}

// 不压换行的版本（换行留成 \n 转义，读回来还是换行），review 线的写入 route 用这份。
// 不并到上面：这里写的 company/round 是从整理稿 frontmatter 原样透传的，
// 悄悄压成一行会让派生笔记和上游对不上，把坏输入伪装成好输入。
export function yamlScalar(value: string) {
  return JSON.stringify(value);
}

