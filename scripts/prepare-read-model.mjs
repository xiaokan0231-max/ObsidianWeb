import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { garbageCollectReadModelAssets, writeReadModelAssets } from "./read-model-published.mjs";

// 代码发布可以重建索引，但不能顺带把尚未确认发布的本地新资料公开。
const directory = resolve("public/_published-vault");
const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
const notes = [];
for (const file of new Set(manifest.scopes.all)) {
  if (!/^[a-f0-9]{24}\.json$/.test(file)) throw new Error("发布资料分片路径无效");
  notes.push(...JSON.parse(await readFile(join(directory, file), "utf8")));
}
const previous = [manifest.readModel, ...(manifest.readModels ?? [])].filter((value, index, all) => value?.revision && all.findIndex((item) => item?.revision === value.revision) === index);
manifest.readModel = await writeReadModelAssets(notes, directory, manifest.publishedAt);
manifest.readModels = [manifest.readModel, ...previous.filter((value) => value.revision !== manifest.readModel.revision)].slice(0, 3);
const temporary = join(directory, "manifest.read-model.tmp");
await writeFile(temporary, JSON.stringify(manifest), { mode: 0o600 });
await rename(temporary, join(directory, "manifest.json"));
await garbageCollectReadModelAssets(directory, manifest, previous);
console.log(`Read model prepared from ${notes.length} published notes; ${manifest.readModel.batches.length} bounded batches.`);
