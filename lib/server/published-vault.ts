import type { ObsidianNote } from "./obsidian.ts";
import type { VaultScope } from "../vault-scope.ts";

export type PublishedVaultResponse = { file: string; etag: string; gzip?: string; br?: string };
export type PublishedReadModel = { revision: string; manifestFile: string; batches: string[]; bodyIndexFile: string };
export type PublishedVault = {
  schemaVersion: 2; publishedAt: string;
  scopes: Record<VaultScope, string[]>; chunks: Record<string, string>;
  responses?: Partial<Record<VaultScope, PublishedVaultResponse>>;
  calendar?: PublishedVaultResponse;
  readModel?: PublishedReadModel;
  readModels?: PublishedReadModel[];
};

// 同一部署的清单不可变；跨请求复用解析结果，各请求自行完成首次读取。
export function createPublishedVaultReader(load: () => Promise<unknown>, loadNotes: (file: string) => Promise<ObsidianNote[]>) {
  let resolved: PublishedVault | undefined;
  async function snapshot() {
    if (resolved) return resolved;
    const data = await load() as PublishedVault;
    if (data?.schemaVersion !== 2 || !Array.isArray(data.scopes?.all) || !data.chunks || !data.publishedAt) {
      throw new Error("云端内容格式无效，请重新发布");
    }
    resolved = data;
    return data;
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
