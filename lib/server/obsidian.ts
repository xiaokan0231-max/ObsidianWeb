import { isOperationalPath } from "@/lib/vault-boundary.mjs";

export type ObsidianNote = {
  path: string;
  stat: {
    ctime: number;
    mtime: number;
    size: number;
  };
  tags: string[];
  frontmatter: Record<string, unknown>;
  content: string;
};

type VaultListing = { files?: string[] };

const OBSIDIAN_URL = (
  process.env.OBSIDIAN_API_URL ?? "http://127.0.0.1:27123"
).replace(/\/$/, "");

function headers(accept = "application/json", contentType?: string) {
  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!apiKey) throw new Error("OBSIDIAN_API_KEY is not configured");
  return {
    Accept: accept,
    Authorization: `Bearer ${apiKey}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${OBSIDIAN_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...headers(),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Obsidian returned ${response.status} for ${path}${detail ? `: ${detail.slice(0, 240)}` : ""}`,
    );
  }
  return response;
}

async function requestJson<T>(path: string, accept?: string): Promise<T> {
  const response = await request(path, {
    headers: headers(accept),
  });
  return (await response.json()) as T;
}

export async function listMarkdownFiles(prefix = ""): Promise<string[]> {
  const endpoint = prefix ? `/vault/${encodeURIComponent(prefix)}` : "/vault/";
  const listing = await requestJson<VaultListing>(endpoint);
  const notes: string[] = [];
  for (const entry of listing.files ?? []) {
    const fullPath = `${prefix}${entry}`;
    if (!isOperationalPath(fullPath)) continue;
    if (entry.endsWith("/")) {
      notes.push(...(await listMarkdownFiles(fullPath)));
    } else if (entry.toLowerCase().endsWith(".md")) {
      notes.push(fullPath);
    }
  }
  return notes;
}

async function mapConcurrent<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}

export async function readNote(path: string) {
  return requestJson<ObsidianNote>(
    `/vault/${encodeURIComponent(path)}`,
    "application/vnd.olrapi.note+json",
  );
}

export async function readAllNotes() {
  const paths = await listMarkdownFiles();
  const notes = await mapConcurrent(paths, 8, readNote);
  return notes.sort((left, right) => right.stat.mtime - left.stat.mtime);
}

// 「笔记还没建」和「Obsidian 挂了」只能靠 request() 抛出的文案区分。
// 判定收在这里：散在各 route 时它有 9 份，改一处就等于漏改八处。
export function isMissingNoteError(error: unknown) {
  return error instanceof Error && error.message.includes("returned 404");
}

// 可选读取的唯一入口：只把 404 折成 null，认证失效・连不上・500 一律照原样抛出。
// 判断放在这里而不是各个调用点，是因为「只吞 404」被抄到第五份时，
// 迟早有一份会把别的失败也吞掉——而那种失败在页面上跟「笔记还没建」长得一模一样。
export async function readNoteOrNull(path: string) {
  try {
    return await readNote(path);
  } catch (error) {
    if (isMissingNoteError(error)) return null;
    throw error;
  }
}

// 存在与否就是「读不读得到」，往返也一样是一次，所以判定不留第二份。
export async function noteExists(path: string) {
  return (await readNoteOrNull(path)) !== null;
}

export async function writeNote(path: string, content: string) {
  await request(`/vault/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: headers("application/json", "text/markdown; charset=utf-8"),
    body: content,
  });
}

export async function appendNote(path: string, content: string) {
  if (!(await noteExists(path))) {
    await writeNote(path, content.replace(/^\n+/, ""));
    return;
  }
  await request(`/vault/${encodeURIComponent(path)}`, {
    method: "POST",
    headers: headers("application/json", "text/markdown; charset=utf-8"),
    body: content,
  });
}

export async function patchHeading(
  path: string,
  heading: string,
  content: string,
) {
  await request(`/vault/${encodeURIComponent(path)}`, {
    method: "PATCH",
    headers: {
      ...headers("application/json", "text/markdown; charset=utf-8"),
      Operation: "replace",
      "Target-Type": "heading",
      Target: heading,
      "Create-Target-If-Missing": "true",
    },
    body: content,
  });
}

export async function uniquePath(path: string) {
  if (!(await noteExists(path))) return path;
  const extension = path.toLowerCase().endsWith(".md") ? ".md" : "";
  const base = extension ? path.slice(0, -3) : path;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}_${index}${extension}`;
    if (!(await noteExists(candidate))) return candidate;
  }
  throw new Error(`Could not find a unique Vault path for ${path}`);
}
