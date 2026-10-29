import { writeFile } from "node:fs/promises";

const origin = process.argv[2] || "http://localhost:3000";
const samples = Math.max(5, Math.min(50, Number(process.env.READ_MODEL_SAMPLES) || 20));
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
const month = today.slice(0, 7);
const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
const paths = [
  `/api/read-model/calendar/range?from=${month}-01&to=${month}-${last}&month=${month}`,
  "/api/read-model/library?limit=24", "/api/read-model/search?q=面接", "/api/read-model/search?q=数",
  "/api/interview/catalog?view=session", "/api/interview/catalog?view=review", "/api/interview/catalog?view=insights",
];
const results = [];
for (const path of paths) {
  const timings = [];
  let bytes = 0;
  for (let sample = 0; sample <= samples; sample++) {
    const start = performance.now();
    const response = await fetch(new URL(path, origin), { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    const value = JSON.parse(text);
    if (!response.ok || value.syncState && value.syncState !== "ready") throw new Error(`${path}: ${response.status} ${value.error || value.syncState}`);
    timings.push(performance.now() - start);
    bytes = Buffer.byteLength(text);
  }
  const warm = timings.slice(1).sort((a, b) => a - b);
  const row = { path, firstMs: Math.round(timings[0]), warmP50Ms: Math.round(warm[Math.floor(warm.length / 2)]), warmP95Ms: Math.round(warm[Math.ceil(warm.length * 0.95) - 1]), bytes, samples };
  results.push(row);
  console.log(JSON.stringify(row));
}
const report = { measuredAt: new Date().toISOString(), origin, results };
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2));
