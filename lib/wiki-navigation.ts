import type { Note } from "./notes.ts";
import { explicitNoteLink, resolveNoteLinkResult } from "./wiki-target.ts";

export type WikiNavigationNotice = { kind: "loading" | "missing" | "ambiguous"; target: string } | null;
export type WikiResolveResult = { kind: "resolved"; path: string; section: string | null; revision?: string } | { kind: "missing" | "ambiguous" };

type Options = {
  getNotes(): readonly Note[];
  isComplete(): boolean;
  ensureAll(): Promise<readonly Note[] | null>;
  /** 查询目录索引即可完成消歧；返回 null 时才沿用未改造视图的旧读取路径。 */
  resolve?(target: string, section?: string): Promise<WikiResolveResult | null>;
  onOpen(link: { path: string; section: string | null; revision?: string }): void;
  onNotice(notice: WikiNavigationNotice): void;
};

/**
 * 短名只能在完整索引里判定唯一。等待资料时仍可换页或关闭，旧点击不能抢回阅读层。
 * 不依赖 React 和浏览器，冷启动、重名和迟到点击用真实异步顺序测试。
 */
export function createWikiNavigator(options: Options) {
  let intent = 0;
  let allRequest: Promise<readonly Note[] | null> | null = null;

  function cancel() {
    intent += 1;
    options.onNotice(null);
  }

  function ensureAll() {
    if (!allRequest) {
      const request = options.ensureAll().finally(() => {
        if (allRequest === request) allRequest = null;
      });
      allRequest = request;
    }
    return allRequest;
  }

  async function open(target: string, section?: string) {
    const current = ++intent;
    options.onNotice(null);
    if (options.resolve) {
      options.onNotice({ kind: "loading", target });
      try {
        const result = await options.resolve(target, section);
        if (current !== intent) return;
        if (result) {
          if (result.kind === "resolved") {
            options.onNotice(null);
            options.onOpen({ path: result.path, section: result.section, ...(result.revision ? { revision: result.revision } : {}) });
          } else options.onNotice({ kind: result.kind, target });
          return;
        }
      } catch {
        // 索引暂时不可用不是笔记不存在，也不能退回下载全库正文。
        if (current === intent) options.onNotice(null);
        return;
      }
    }
    const explicit = explicitNoteLink(target, section);
    let notes = options.getNotes();
    if (!options.isComplete()) {
      if (explicit && notes.some((note) => note.path === explicit.path)) {
        // 只有索引里的精确路径可直接打开；「公司/准备」也可能只是 Obsidian 的唯一后缀。
        // 未命中的路径仍需补齐索引，不能先把后缀写成不存在的 ?note= 根路径。
        options.onOpen(explicit);
        return;
      }
      options.onNotice({ kind: "loading", target });
      try {
        const complete = await ensureAll();
        if (current !== intent) return;
        if (!complete) { options.onNotice(null); return; }
        notes = complete;
      } catch {
        // 读取失败由资料同步状态解释，不把它误报为不存在。
        if (current === intent) options.onNotice(null);
        return;
      }
    }
    if (current !== intent) return;
    const result = resolveNoteLinkResult(notes, target, section);
    if (result.kind === "resolved") {
      options.onNotice(null);
      options.onOpen({ path: result.note.path, section: result.section });
    } else {
      options.onNotice({ kind: result.kind, target });
    }
  }

  return { open, cancel };
}
