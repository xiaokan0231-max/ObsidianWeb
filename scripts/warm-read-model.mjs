const origin = process.argv[2] || "http://localhost:3000";
const deadline = Date.now() + 15 * 60_000;
let last = -1;
while (Date.now() < deadline) {
  const response = await fetch(new URL("/api/read-model/warm", origin), { signal: AbortSignal.timeout(90_000), cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Index warmup failed (${response.status})`);
  if (body.completedBatches !== last) {
    console.log(`Read model ${body.state}: ${body.completedBatches}/${body.batchCount}`);
    last = body.completedBatches;
  }
  if (body.state === "ready") process.exit(0);
}
throw new Error("Read model warmup timed out; the previous complete revision remains available");
