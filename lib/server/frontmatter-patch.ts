const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

/**
 * 白名单 API 共用の scalar frontmatter 更新。
 * 本文を YAML と一緒に再生成すると、配列・引用・コメントまで整形し直されて差分が広がる。
 * ここでは許可済みの単純な key だけを行単位で置換し、本文と他字段を byte-for-byte で保つ。
 */
export function patchFrontmatterScalars(
  content: string,
  updates: Record<string, string | null>,
) {
  const matched = content.match(FRONTMATTER);
  if (!matched) throw new Error("这条笔记没有 frontmatter，无法安全改写。");

  const lines = matched[1].split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    if (!/^[a-z][a-z0-9_]*$/i.test(key)) throw new Error(`不安全的字段名：${key}`);
    const prefix = `${key}:`;
    const indexes: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].startsWith(prefix)) indexes.push(index);
    }
    if (indexes.length > 1) throw new Error(`frontmatter 中存在重复字段：${key}`);

    if (value === null) {
      if (indexes[0] !== undefined) lines.splice(indexes[0], 1);
      continue;
    }
    if (/\r|\n/.test(value)) throw new Error(`${key} 只允许单行值。`);
    const next = `${key}: ${value}`;
    if (indexes[0] === undefined) lines.push(next);
    else lines[indexes[0]] = next;
  }

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  return `---${newline}${lines.join(newline)}${newline}---${matched[2] || newline}${content.slice(matched[0].length)}`;
}
