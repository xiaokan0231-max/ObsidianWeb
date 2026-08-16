import { readFile, readdir } from "node:fs/promises";

/**
 * globals.css は @import の目次になり、実体は app/styles/ に分かれた。
 * CSS のセレクタを断言するテストは、ここで全ファイルを結合した1枚を読む。
 * 断言は「含まれるか」だけなので結合順は問わない。
 */
export async function readAppCss() {
  const dir = "app/styles";
  const names = (await readdir(dir)).filter((name) => name.endsWith(".css")).sort();
  const chunks = await Promise.all(
    names.map((name) => readFile(`${dir}/${name}`, "utf8")),
  );
  return chunks.join("\n");
}
