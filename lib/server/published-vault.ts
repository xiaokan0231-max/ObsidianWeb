import type { ObsidianNote } from "./obsidian.ts";
import type { VaultScope } from "../vault-scope.ts";

export type PublishedVault = { schemaVersion: 2; publishedAt: string; scopes: Record<VaultScope, string[]>; chunks: Record<string, string> };

// 同一部署里的资源不可变；合并并发读取，避免每次切页重复解析全库。
export function createPublishedVaultReader(load: () => Promise<unknown>, loadNotes: (file: string) => Promise<ObsidianNote[]>) {
  let pending: Promise<PublishedVault> | undefined;
  function snapshot() {
    pending ??= load().then((value) => {
      const data = value as PublishedVault;
      if (data?.schemaVersion !== 2 || !Array.isArray(data.scopes?.all) || !data.chunks || !data.publishedAt) {
        throw new Error("云端内容格式无效，请重新发布");
      }
      return data;
    }).catch((error) => { pending = undefined; throw error; });
    return pending;
  }
  return {
    async readAll(scope: VaultScope = "all") {
      const files = (await snapshot()).scopes[scope];
      if (!Array.isArray(files)) throw new Error("云端内容范围无效");
      const groups = new Array<ObsidianNote[]>(files.length);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(files.length, 8) }, async () => {
        while (cursor < files.length) {
          const index = cursor++;
          groups[index] = await loadNotes(files[index]);
        }
      }));
      return groups.flat();
    },
    async readNote(path: string) {
      const file = (await snapshot()).chunks[path];
      if (!file) throw new Error(`Obsidian returned 404 for ${path}`);
      const note = (await loadNotes(file)).find((item) => item.path === path);
      if (!note) throw new Error(`Obsidian returned 404 for ${path}`);
      return note;
    },
  };
}
