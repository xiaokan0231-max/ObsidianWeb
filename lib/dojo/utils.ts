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

export function yamlString(value: string) {
  return JSON.stringify(value.replace(/\r?\n/g, " "));
}

