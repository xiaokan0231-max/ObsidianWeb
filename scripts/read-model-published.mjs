import { createHash } from "node:crypto";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildApplicationReadModel } from "./read-model-source.mjs";

/** 只处理明确发布的同一批资料；全文资源和索引始终指向同一版本。 */
export async function writeReadModelAssets(notes, directory, publishedAt) {
  const write = async (value) => {
    const text = JSON.stringify(value);
    const file = `${createHash("sha256").update(text).digest("hex").slice(0, 24)}.json`;
    await writeFile(join(directory, file), text, { mode: 0o600 });
    return file;
  };
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const artifact = await buildApplicationReadModel(notes, today, publishedAt);
  const batches = [];
  for (const batch of artifact.batches) batches.push(await write(batch));
  const bodies = {};
  for (const note of notes) bodies[note.path] = await write(note);
  return { revision: artifact.manifest.revision, manifestFile: await write(artifact.manifest), batches, bodyIndexFile: await write(bodies) };
}

const assetName = /^[a-f0-9]{24}\.json(?:\.(?:br|gz))?$/;
async function indexFiles(directory, index) {
  const result = [index?.manifestFile, ...(index?.batches ?? []), index?.bodyIndexFile].filter((name) => typeof name === "string" && assetName.test(name));
  if (index?.bodyIndexFile && assetName.test(index.bodyIndexFile)) {
    const bodies = JSON.parse(await readFile(join(directory, index.bodyIndexFile), "utf8"));
    result.push(...Object.values(bodies).filter((name) => typeof name === "string" && assetName.test(name)));
  }
  return result;
}

/** 导出使用全新暂存目录；只复制最近的完整派生版本，不能把未发布的本地资料混入。 */
export async function copyRetainedReadModelAssets(sourceDirectory, directory, indexes) {
  const retained = [];
  for (const index of indexes) {
    try {
      const files = await indexFiles(sourceDirectory, index);
      for (const file of files) await copyFile(join(sourceDirectory, file), join(directory, file));
      retained.push(index);
    } catch { /* 旧资源缺失时不能宣布它是可回退的完整版本。 */ }
  }
  return retained;
}

/** 只删除已退休索引曾引用的派生资源；当前正文分片与最近三个版本的共享文件都保留。 */
export async function garbageCollectReadModelAssets(directory, manifest, previous = []) {
  const files = async (index) => { try { return await indexFiles(directory, index); } catch { return []; } };
  const retained = new Set(Object.values(manifest.chunks ?? {}));
  for (const group of Object.values(manifest.scopes ?? {})) for (const file of group) retained.add(file);
  for (const response of [...Object.values(manifest.responses ?? {}), manifest.calendar].filter(Boolean)) for (const key of ["file", "gzip", "br"]) if (response[key]) retained.add(response[key]);
  for (const index of [manifest.readModel, ...(manifest.readModels ?? [])].filter(Boolean)) for (const file of await files(index)) retained.add(file);
  const obsolete = new Set();
  for (const index of previous) for (const file of await files(index)) if (!retained.has(file)) obsolete.add(file);
  await Promise.all([...obsolete].map((file) => rm(join(directory, file), { force: true })));
}
