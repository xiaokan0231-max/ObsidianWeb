/*
 * 代码块的轻量着色：只分注释／字符串／数字／关键字四类。
 * 不引第三方高亮库——vault 里的代码多是命令、配置和几行示例，四类已够分辨结构，
 * 完整语法树换来的体积和主题适配成本不值得。认不出的语言原样输出，不猜。
 */
export type CodeToken = { kind: "plain" | "comment" | "string" | "number" | "keyword"; text: string };

type Family = { comment: string; keywords: string };

const C_LIKE = "//.*|/\\*[\\s\\S]*?\\*/";
const FAMILIES: Record<string, Family> = {
  ts: { comment: C_LIKE, keywords: "const let var function return if else for while do switch case break continue new class extends implements interface type enum import export from as default async await try catch finally throw typeof instanceof in of void null undefined true false this super yield readonly public private protected static" },
  json: { comment: C_LIKE, keywords: "true false null" },
  bash: { comment: "(?<![\\w$])#.*", keywords: "if then else elif fi for while do done case esac in function return export local echo cd exit set unset source sudo npm npx node git" },
  sql: { comment: "--.*|/\\*[\\s\\S]*?\\*/", keywords: "select from where and or not insert into values update set delete create table index drop alter join left right inner outer on group by order having limit offset as distinct union all null is in like between case when then else end primary key" },
  yaml: { comment: "(?<!\\S)#.*", keywords: "true false null yes no on off" },
  py: { comment: "#.*", keywords: "def class return if elif else for while in not and or is import from as with try except finally raise lambda yield pass break continue global nonlocal None True False async await self" },
};
const ALIASES: Record<string, string> = {
  typescript: "ts", tsx: "ts", javascript: "ts", js: "ts", jsx: "ts", mjs: "ts", cjs: "ts", jsonc: "json",
  sh: "bash", shell: "bash", zsh: "bash", console: "bash", yml: "yaml", python: "py", postgresql: "sql", mysql: "sql",
};

export function codeFamily(language: string) {
  const key = ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  return FAMILIES[key] ? key : null;
}

export function highlightCode(code: string, language: string): CodeToken[] {
  const key = codeFamily(language);
  if (!key) return [{ kind: "plain", text: code }];
  const family = FAMILIES[key];
  // SQL 的关键字不分大小写，其余语言区分（Python 的 None 与 none 不是一回事）。
  const keywords = `\\b(?:${family.keywords.split(" ").join("|")})\\b`;
  const pattern = new RegExp(
    `(${family.comment})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|(${keywords})`,
    key === "sql" ? "gi" : "g",
  );
  const tokens: CodeToken[] = [];
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    if (match.index > last) tokens.push({ kind: "plain", text: code.slice(last, match.index) });
    const kind = match[1] ? "comment" : match[2] ? "string" : match[3] ? "number" : "keyword";
    tokens.push({ kind, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < code.length) tokens.push({ kind: "plain", text: code.slice(last) });
  return tokens;
}
