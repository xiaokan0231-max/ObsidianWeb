import assert from "node:assert/strict";
import test from "node:test";
import { readAppCss } from "./css-source.mjs";

/**
 * 🔴 カード外観をそろえる一括規則が、暗い配色のパネルの背景だけを奪う事故を止める。
 *
 * ui-language.css の末尾に
 *   .panel, .calendar-board, .agenda-group, … { background-color: var(--surface-raised); }
 * が居る。単一クラス（特異性 0,1,0）で、しかも**全ての .panel より後ろ**にある。
 * だから「暗い背景＋白文字」のパネルを `.graph-preview-panel { background: …; color: #fff }`
 * のように単一クラスで書くと、背景だけこの一括規則に奪われ、文字色 #fff は残る
 * ——明るい背景に白文字＝読めない、という状態になる。
 *
 * 実際に総覧の「関係比文件夹…」パネルがこれで読めなくなっていた（本人のスクショで発覚）。
 * ページは正常にレンダリングされ console も無言なので、
 * 「ルートが描画されたか」「エラーが出ていないか」だけの確認では絶対に捕まらない。
 *
 * 対策は特異性を上げること（`.panel.graph-preview-panel`）。ここではその一点を固定する。
 */
test("暗い配色のパネルは、カード外観の一括規則に背景を奪われない特異性で書く", async () => {
  const css = await readAppCss();

  // 一括規則が今も居ること（居なくなったら、この守り自体の前提が変わる）
  assert.match(
    css,
    /\.panel,[\s\S]{0,600}?background-color:\s*var\(--surface-raised\)/,
    "カード外観の一括規則が見当たらない。前提が変わったならこのテストも書き直すこと",
  );

  // 暗いパネルは .panel と併記して特異性を上げてある
  assert.match(
    css,
    /\.panel\.graph-preview-panel\s*\{[^}]*background:\s*#1a2821/,
    "graph-preview-panel の暗い背景が単一クラスに戻っている＝一括規則に負ける",
  );
  // 単一クラスのままの定義が復活していないこと
  assert.doesNotMatch(
    css,
    /(^|\n)\.graph-preview-panel\s*\{[^}]*background:\s*#1a2821/,
    "単一クラスの .graph-preview-panel で暗い背景を指定すると一括規則に奪われる",
  );
});
