import { writeFile } from "node:fs/promises";

// 内閣府每年公布下一年的祝日后，运行 node scripts/update-japanese-holidays.mjs。
const url = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";
const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`内閣府祝日 CSV: HTTP ${response.status}`);

const [header, ...rows] = new TextDecoder("shift_jis", { fatal: true })
  .decode(await response.arrayBuffer()).trim().split(/\r?\n/);
if (header !== "国民の祝日・休日月日,国民の祝日・休日名称" || !rows.length) {
  throw new Error("内閣府祝日 CSV 格式异常");
}

const holidays = new Map();
for (const row of rows) {
  const fields = /^(\d{4})\/(\d{1,2})\/(\d{1,2}),([^,]+)$/.exec(row);
  if (!fields) throw new Error(`无法读取祝日: ${row}`);
  const [, year, month, day, name] = fields;
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const timestamp = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString().slice(0, 10) !== date || holidays.has(date)) {
    throw new Error(`祝日日期无效或重复: ${row}`);
  }
  holidays.set(date, name);
}

await writeFile(new URL("../lib/japanese-holidays.json", import.meta.url),
  `${JSON.stringify(Object.fromEntries([...holidays].sort(([left], [right]) => left.localeCompare(right))), null, 2)}\n`);
