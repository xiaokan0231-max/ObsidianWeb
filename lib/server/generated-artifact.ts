import { writeNote, type ObsidianNote } from "./obsidian";

// CRLF を受けないと lib/vault-compact.mjs 側の同名処理とズレ、片方だけが
// 「frontmatter が無い」と誤判定して current が2件残る。
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

export function applyArtifactFrontmatter(
  content: string,
  fields: Record<string, string | number>,
) {
  const matched = content.match(FRONTMATTER);
  if (!matched) throw new Error("生成物没有 frontmatter，无法安全更新生命周期。");
  const lines = matched[1].split("\n");
  for (const [key, value] of Object.entries(fields)) {
    const next = `${key}: ${value}`;
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (index >= 0) lines[index] = next;
    else lines.push(next);
  }
  return `---\n${lines.join("\n")}\n---${matched[2] || "\n"}${content.slice(matched[0].length)}`;
}

/** 新版を書き込む直前に旧 current だけを superseded にする。historical は触らない。 */
export async function supersedeCurrentArtifacts(
  notes: ObsidianNote[],
  type: "language-bank" | "language-curriculum",
) {
  const current = notes.filter(
    (note) => note.frontmatter.type === type && note.frontmatter.lifecycle === "current",
  );
  await Promise.all(current.map(async (note) => {
    await writeNote(note.path, applyArtifactFrontmatter(note.content, { lifecycle: "superseded" }));
  }));
  return current.map((note) => note.path);
}
