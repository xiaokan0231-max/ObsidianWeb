import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sites } from "../build/sites-vite-plugin.ts";

test("本机明文快照不进入部署静态目录，清掉已退休资源并保留其他页面资产", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sites-build-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(["public/_published-vault", "dist/client/_published-vault", ".openai", "drizzle"].map((path) => mkdir(join(root, path), { recursive: true })));
  await writeFile(join(root, "public/_published-vault/manifest.json"), '{"readModel":"current"}');
  await writeFile(join(root, "public/_published-vault/current.json.gz"), "compressed");
  await writeFile(join(root, "dist/client/_published-vault/retired.json"), "retired");
  await writeFile(join(root, "dist/client/keep.svg"), "keep");
  await writeFile(join(root, ".openai/hosting.json"), '{"d1":"DB"}');
  await writeFile(join(root, "drizzle/0000.sql"), "SELECT 1;");
  const plugin = sites();
  plugin.configResolved({ root });
  await plugin.closeBundle();
  await assert.rejects(readdir(join(root, "dist/client/_published-vault")), { code: "ENOENT" });
  assert.equal(await readFile(join(root, "dist/client/keep.svg"), "utf8"), "keep");
  assert.equal(await readFile(join(root, "dist/.openai/drizzle/0000.sql"), "utf8"), "SELECT 1;");
  await plugin.closeBundle();
  await assert.rejects(readdir(join(root, "dist/client/_published-vault")), { code: "ENOENT" });
});
