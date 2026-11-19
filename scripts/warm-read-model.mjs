/** @param {string} origin
 * @param {{ signal?: AbortSignal, onProgress?: (status: import('../lib/read-model.ts').ReadModelStatus) => void }} [options]
 */
export async function warmReadModel(origin, { signal, onProgress } = {}) {
  const url = new URL("/api/read-model/warm", origin);
  const deadline = Date.now() + 15 * 60_000;
  let last = -1;
  for (let remaining = deadline - Date.now(); remaining > 0; remaining = deadline - Date.now()) {
    const timeout = AbortSignal.timeout(Math.min(90_000, remaining));
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Index warmup failed (${response.status})`);
    if (body.completedBatches !== last) {
      onProgress?.(body);
      last = body.completedBatches;
    }
    if (body.state === "ready") return body;
  }
  throw new Error("Read model warmup timed out; the previous complete revision remains available");
}

if (import.meta.main) {
  await warmReadModel(process.argv[2] || "http://localhost:3000", {
    onProgress: (status) => console.log(`Read model ${status.state}: ${status.completedBatches}/${status.batchCount}`),
  });
}
