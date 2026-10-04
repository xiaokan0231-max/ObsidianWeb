import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveUiTheme } from "../lib/ui-theme.ts";

/**
 * 两套主题共用同一批语义 token 名，靠 base.css 里两个 :root 块切换取值。
 * 这里钉住三件事：暗色块只覆盖浅色块里已有的名字（拼错一个字就会静默回落到浅色值）；
 * 两套的正文与关键交互配色都达到 AA；主题解析只认两个值。
 */
const baseCss = readFileSync(new URL("../app/styles/base.css", import.meta.url), "utf8");

function block(selector) {
  const start = baseCss.indexOf(`${selector} {`);
  assert.ok(start >= 0, `找不到 ${selector} 块`);
  const end = baseCss.indexOf("\n}\n", start);
  return baseCss.slice(start, end);
}

function tokens(source) {
  const map = new Map();
  for (const match of source.matchAll(/(--[\w-]+):\s*([^;]+);/g)) map.set(match[1], match[2].trim());
  return map;
}

const light = tokens(block(":root"));
const darkOverrides = tokens(block(':root:not([data-theme="light"])'));
// 暗色块没写的 token 沿用浅色值（与浏览器的层叠结果一致）。
const dark = new Map([...light, ...darkOverrides]);

function luminance(hex) {
  const channel = (value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  const value = hex.replace("#", "");
  return 0.2126 * channel(Number.parseInt(value.slice(0, 2), 16))
    + 0.7152 * channel(Number.parseInt(value.slice(2, 4), 16))
    + 0.0722 * channel(Number.parseInt(value.slice(4, 6), 16));
}

function contrast(left, right) {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function hex(theme, name) {
  const value = theme.get(name);
  assert.match(value ?? "", /^#[0-9a-f]{6}$/i, `${name} 需要是 6 位 hex 才能校验对比度`);
  return value;
}

test("暗色块只覆盖浅色块里已有的 token", () => {
  const unknown = [...darkOverrides.keys()].filter((name) => !light.has(name));
  assert.deepEqual(unknown, []);
});

test("暗色块覆盖了所有随主题变化的核心 token", () => {
  const required = [
    "--paper", "--surface", "--surface-overlay", "--surface-sunken", "--surface-raised-solid",
    "--ink", "--text-primary", "--text-secondary", "--muted", "--text-tertiary",
    "--line", "--line-strong", "--interactive", "--interactive-fill", "--on-interactive", "--on-fill",
    "--surface-inverse", "--text-on-inverse", "--success", "--warning", "--danger", "--info",
    "--green", "--violet", "--gold", "--shadow-color",
  ];
  assert.deepEqual(required.filter((name) => !darkOverrides.has(name)), []);
});

for (const [label, theme] of [["浅色", light], ["暗色", dark]]) {
  test(`${label}：正文四档对五种面都达到 4.5:1`, () => {
    const surfaces = ["--paper", "--surface", "--surface-raised-solid", "--surface-overlay", "--surface-sunken"];
    const texts = ["--text-primary", "--text-secondary", "--muted", "--text-tertiary"];
    for (const text of texts) {
      for (const surface of surfaces) {
        const ratio = contrast(hex(theme, text), hex(theme, surface));
        assert.ok(ratio >= 4.5, `${label} ${text} 对 ${surface} 只有 ${ratio.toFixed(2)}`);
      }
    }
  });

  test(`${label}：链接文字、填充按钮、反相面达到 4.5:1`, () => {
    const pairs = [
      ["--interactive", "--paper"],
      ["--on-interactive", "--interactive-fill"],
      ["--text-on-inverse", "--surface-inverse"],
    ];
    for (const [front, back] of pairs) {
      const ratio = contrast(hex(theme, front), hex(theme, back));
      assert.ok(ratio >= 4.5, `${label} ${front} 对 ${back} 只有 ${ratio.toFixed(2)}`);
    }
  });
}

test("主题只认 dark / light，其余值回落到默认", () => {
  assert.equal(resolveUiTheme("dark"), "dark");
  assert.equal(resolveUiTheme("light"), "light");
  assert.equal(resolveUiTheme("sepia"), resolveUiTheme(undefined));
});
