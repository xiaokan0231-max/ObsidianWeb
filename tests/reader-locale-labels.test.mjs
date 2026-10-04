import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  localizedGroupLabel,
  localizedTrustLabel,
  localizedTypeLabel,
  trustLayer,
  typeLabel,
} from "../lib/memory-atlas-data.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

function note(path, type, frontmatter = {}) {
  return {
    path,
    stat: { ctime: 0, mtime: Date.parse("2026-07-01T00:00:00Z"), size: 0 },
    tags: [],
    frontmatter: { type, ...frontmatter },
    content: "# 标题\n\n正文。\n",
  };
}

test("带 locale 的类型・信任层・分区标签：中文与原函数逐字一致，日文另给译名", () => {
  for (const type of ["job-case", "self", "interview-prep", "todo", "moc", "未知の型", "some-new_type"]) {
    assert.equal(localizedTypeLabel(type, "zh-CN"), typeLabel(type));
  }
  assert.equal(localizedTypeLabel("job-case", "ja"), "応募案件");
  assert.equal(localizedTypeLabel("interview-prep-library", "ja"), "面接標準回答集");
  // 未收录的类型两种语言都按原函数的兜底写法显示，不出现 undefined。
  assert.equal(localizedTypeLabel("some-new_type", "ja"), "some new type");

  const cases = [
    [note("10_关于我/自己.md", "self"), "確定情報"],
    [note("20_求職/テスト/案件.md", "job-case"), "証拠"],
    [note("80_AI分析/観点.md", "ai-report"), "分析 / 仮説"],
    [note("99_系统/索引.md", "moc"), "案内 / 素材"],
  ];
  for (const [item, ja] of cases) {
    assert.equal(localizedTrustLabel(item, "zh-CN"), trustLayer(item).label);
    assert.equal(localizedTrustLabel(item, "ja"), ja);
  }
  assert.equal(localizedGroupLabel("career", "zh-CN"), "求职");
  assert.equal(localizedGroupLabel("career", "ja"), "就職活動");
});

for (const [locale, eyebrow, trust] of [["zh-CN", "应募案件", "证据层"], ["ja", "応募案件", "証拠"]]) {
  test(`笔记阅读层的眉题与信任层按界面语言取：${locale}`, async () => {
    let props = null;
    const { default: NoteReader } = await loadAppModule("app/note-reader.tsx", {
      stubs: {
        "./reading-mode": { default: (value) => { props = value; return null; } },
        "./ui-locale": { useUiLocale: () => ({ locale, setLocale() {} }) },
      },
    });
    renderToStaticMarkup(createElement(NoteReader, {
      note: note("20_求職/テスト/株式会社テスト.md", "job-case"), onClose() {}, onOpenWiki() {},
    }));
    assert.equal(props.eyebrow, eyebrow);
    assert.equal(props.metadata[0], trust);
  });
}

for (const [locale, eyebrow, back, meta] of [["zh-CN", "准备材料", "返回准备", ["2 个章节", "原文连读"]], ["ja", "準備資料", "準備に戻る", ["2 章", "原文を通して読む"]]]) {
  test(`准备材料阅读层的眉题・返回・元数据按界面语言取：${locale}`, async () => {
    let props = null;
    const { default: PrepMaterialReader } = await loadAppModule("app/prep-material-reader.tsx", {
      stubs: {
        "./reading-mode": { default: (value) => { props = value; return null; } },
        "./ui-locale": { useUiLocale: () => ({ locale, setLocale() {} }) },
      },
    });
    renderToStaticMarkup(createElement(PrepMaterialReader, {
      documentKey: "prep:test", title: "株式会社テスト",
      sections: [{ id: "a", title: "志望動機", blocks: [] }, { id: "b", title: "逆質問", blocks: [] }],
      onClose() {}, onOpenWiki() {}, onOpenCard() {},
    }));
    assert.equal(props.eyebrow, eyebrow);
    assert.equal(props.backLabel, back);
    assert.deepEqual(props.metadata, meta);
  });
}
