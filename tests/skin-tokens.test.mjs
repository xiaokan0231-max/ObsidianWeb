import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_UI_SKIN, resolveUiSkin, UI_SKIN_COOKIE, UI_SKINS } from "../lib/ui-theme.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

/**
 * 皮肤（app/styles/skins.css）逐套逐明暗验算。theme-tokens.test 只看 base.css 的两个默认块，
 * 皮肤块没有这份测试就没人检查——配色是脚本反解出来的，手改一个值就可能掉到 AA 以下或和危险红撞色。
 *
 * 口径与浏览器层叠一致：皮肤块叠在默认同明暗块之上，没写的 token 沿用 base.css。
 * 防撞色的下限是 min(阈值, 默认主题同一对的实测值)：默认里本来就撞的对（链接色≈危险红、青绿≈墨绿）
 * 不强求皮肤更好，但不许更差。
 */
const baseCss = readFileSync(new URL("../app/styles/base.css", import.meta.url), "utf8");
const skinsCss = readFileSync(new URL("../app/styles/skins.css", import.meta.url), "utf8");

function baseBlock(selector) {
  const start = baseCss.indexOf(`${selector} {`);
  assert.ok(start >= 0, `找不到 ${selector} 块`);
  return baseCss.slice(start, baseCss.indexOf("\n}\n", start));
}

function tokens(source) {
  const map = new Map();
  for (const match of source.matchAll(/(--[\w-]+):\s*([^;]+);/g)) map.set(match[1], match[2].trim().replace(/\s+/g, " "));
  return map;
}

const baseLight = tokens(baseBlock(":root"));
const baseDarkOverrides = tokens(baseBlock(':root:not([data-theme="light"])'));
const baseDark = new Map([...baseLight, ...baseDarkOverrides]);
const defaults = { light: baseLight, dark: baseDark };

/** skins.css 的全部规则块：[{ selectors, decls }]。注释先剥掉，免得注释里的花括号或冒号被当成规则。 */
const rules = [...skinsCss.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].split(",").map((selector) => selector.trim()).filter(Boolean),
  decls: tokens(match[2]),
}));

const LIGHT = /^:root\[data-skin(?:="([a-z]+)")?\]\[data-theme="light"\]$/;
const DARK = /^:root\[data-skin(?:="([a-z]+)")?\]:not\(\[data-theme="light"\]\)$/;

/** 某套皮肤某种明暗的最终取值：默认同明暗块 → 公共派生 → 该皮肤块（按文件顺序层叠，同特异性后写的赢）。 */
function resolveSkin(id, mode) {
  const pattern = mode === "light" ? LIGHT : DARK;
  const map = new Map(defaults[mode]);
  for (const rule of rules) {
    const hit = rule.selectors.some((selector) => {
      const match = selector.match(pattern);
      return match && (match[1] === undefined || match[1] === id);
    });
    if (hit) for (const [name, value] of rule.decls) map.set(name, value);
  }
  return map;
}

function skinBlocks(id, mode) {
  const pattern = mode === "light" ? LIGHT : DARK;
  return rules.filter((rule) => rule.selectors.some((selector) => selector.match(pattern)?.[1] === id));
}

// ===== 取色工具：WCAG 2.x 亮度与 theme-tokens.test 同一写法；OKLab 用于 ΔE 与明度 =====
function rgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16) / 255);
}

function luminance(hex) {
  const channel = (unit) => (unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(left, right) {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function oklab(hex) {
  const linear = (unit) => (unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaE(left, right) {
  const [l1, a1, b1] = oklab(left);
  const [l2, a2, b2] = oklab(right);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function hue(hex) {
  const [, a, b] = oklab(hex);
  const degrees = (Math.atan2(b, a) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

function hexOf(map, name, tag) {
  const value = map.get(name);
  assert.match(value ?? "", /^#[0-9a-f]{6}$/i, `${tag} ${name}=${value} 需要是 6 位 hex 才能验算`);
  return value;
}

// ===== 判定口径（与 scratchpad 草案 verify.mjs 一致） =====
const SURFACES = ["--paper", "--surface", "--surface-sunken", "--surface-raised-solid", "--surface-overlay"];
// 必须 ≥4.5 的文字色：正文四档、链接、语义文字色，以及直接当文字用的强调色。
const TEXT_AA = [
  "--text-primary", "--text-secondary", "--muted", "--text-tertiary", "--interactive",
  "--success", "--warning", "--warning-strong", "--danger", "--danger-strong", "--info",
  "--green", "--green-deep", "--violet", "--gold-text", "--teal",
];
const PAIRS_AA = [
  ["--on-interactive", "--interactive-fill"],
  ["--text-on-inverse", "--surface-inverse"],
  ["--text-on-inverse", "--surface-inverse-soft"],
  ["--text-on-inverse-muted", "--surface-inverse"],
  ["--on-fill", "--ink"],
  ["--on-fill", "--green"],
  ["--on-fill", "--violet"],
  ["--on-fill", "--danger"],
  ["--on-fill", "--success"],
];
const SEMANTIC = ["--danger", "--warning", "--success", "--info"];
// 同屏比较的分类色：图表状态（analytics.css）、日历状态（calendar-density.css）、公司卷宗 tone。
const CATEGORY_GROUPS = [
  ["--brand", "--green", "--info", "--violet", "--gold"],
  ["--green", "--info", "--gold-text", "--text-tertiary"],
  ["--brand", "--teal", "--green", "--gold"],
];
const DE_SEMANTIC = 0.085;
const DE_CATEGORY = 0.065;

/** 每块都必须自己写的 token：换了底面与品牌色，这些沿用默认值就会是墨绿或橙色的残留。 */
const REQUIRED = [
  "--paper", "--paper-deep", "--surface-sunken", "--surface", "--surface-raised-solid", "--surface-overlay",
  "--ink", "--text-primary", "--text-secondary", "--muted", "--text-tertiary", "--text-faint", "--text-disabled", "--text-display",
  "--line", "--line-strong", "--line-soft", "--line-cool",
  "--brand", "--brand-line", "--interactive", "--interactive-fill", "--on-interactive", "--on-fill",
  "--green", "--green-deep",
  "--surface-inverse", "--surface-inverse-soft", "--text-on-inverse", "--text-on-inverse-muted", "--highlight",
  "--chart-bar", "--chart-step-0", "--chart-step-1", "--chart-step-2", "--chart-step-3", "--chart-step-4", "--chart-step-5",
  "--stage-void", "--stage-bg",
];
// 浅色额外：阴影基色（暗色沿用纯黑）；默认 --gold-text 换到新底面上余量太小，每套浅色都按自己的凹陷面重算。
const REQUIRED_LIGHT = ["--shadow-color", "--gold-text"];

const SKIN_IDS = UI_SKINS.map((skin) => skin.id).filter((id) => id !== DEFAULT_UI_SKIN);

test("每条规则的选择器都带明暗条件（特异性 0,3,0）", () => {
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      assert.ok(LIGHT.test(selector) || DARK.test(selector), `「${selector}」缺少 data-theme 条件：特异性只有 0,2,0，浅色值会漏进暗色模式`);
    }
  }
});

test("只用 base.css 已有的 token 名（拼错一个字就会静默失效）", () => {
  const unknown = rules.flatMap((rule) => [...rule.decls.keys()].filter((name) => !baseLight.has(name)));
  assert.deepEqual(unknown, []);
});

test("UI_SKINS 与 skins.css 的皮肤块一一对应", () => {
  const ids = UI_SKINS.map((skin) => skin.id);
  assert.equal(new Set(ids).size, ids.length, "UI_SKINS 有重复 id");
  assert.ok(ids.includes(DEFAULT_UI_SKIN));
  const inCss = new Set(rules.flatMap((rule) => rule.selectors.map((selector) => (selector.match(LIGHT) ?? selector.match(DARK))?.[1]).filter(Boolean)));
  assert.deepEqual([...inCss].sort(), [...SKIN_IDS].sort());
  assert.ok(!inCss.has(DEFAULT_UI_SKIN), "默认皮肤不应有皮肤块：它不写 data-skin");
  for (const id of SKIN_IDS) {
    assert.equal(skinBlocks(id, "light").length, 1, `${id} 应恰好有一个浅色块`);
    assert.equal(skinBlocks(id, "dark").length, 1, `${id} 应恰好有一个暗色块`);
  }
});

test("UI_SKINS 的名称与说明中日成对，色块与实际取值一致", () => {
  for (const skin of UI_SKINS) {
    for (const pair of [skin.name, skin.description]) {
      assert.equal(pair.length, 2);
      assert.ok(pair.every((text) => typeof text === "string" && text.trim().length > 0), `${skin.id} 文案缺一边`);
    }
    for (const mode of ["light", "dark"]) {
      const map = skin.id === DEFAULT_UI_SKIN ? defaults[mode] : resolveSkin(skin.id, mode);
      // 色块顺序：纸面、表面、主色、链接色、正文色（lib/ui-theme.ts 的 UiSkinMeta 注释）。
      const expected = ["--paper", "--surface", "--brand", "--interactive", "--ink"].map((name) => map.get(name));
      assert.deepEqual([...skin.swatches[mode]], expected, `${skin.id}/${mode} 色块与 CSS 取值不一致`);
    }
  }
});

test("resolveUiSkin 只认六个 id，其余回落到默认", () => {
  for (const id of UI_SKINS.map((skin) => skin.id)) assert.equal(resolveUiSkin(id), id);
  for (const value of [undefined, null, "", "sepia", "KAIYO", "light", 1]) assert.equal(resolveUiSkin(value), DEFAULT_UI_SKIN);
  assert.equal(UI_SKIN_COOKIE, "career-room-skin");
});

test("3D 舞台底色：默认值不变、暗色块不覆盖", () => {
  assert.equal(baseLight.get("--stage-void"), "#030807");
  assert.equal(baseLight.get("--stage-bg"), "#07110d");
  assert.ok(!baseDarkOverrides.has("--stage-void") && !baseDarkOverrides.has("--stage-bg"), "舞台永远是深色，不随明暗变");
});

for (const id of SKIN_IDS) {
  for (const mode of ["light", "dark"]) {
    const tag = `${id}/${mode === "light" ? "浅色" : "暗色"}`;
    const map = resolveSkin(id, mode);
    const own = new Map(skinBlocks(id, mode).flatMap((rule) => [...rule.decls]));
    const hex = (name) => hexOf(map, name, tag);

    test(`${tag}：必需 token 齐全`, () => {
      const required = mode === "light" ? [...REQUIRED, ...REQUIRED_LIGHT] : REQUIRED;
      assert.deepEqual(required.filter((name) => !own.has(name)), []);
    });

    test(`${tag}：文字色（正文四档・链接・语义）对五种面 ≥4.5`, () => {
      for (const text of TEXT_AA) {
        for (const surface of SURFACES) {
          const ratio = contrast(hex(text), hex(surface));
          assert.ok(ratio >= 4.5, `${tag} ${text} 对 ${surface} 只有 ${ratio.toFixed(2)}`);
        }
      }
    });

    test(`${tag}：按钮字、反相面、实心填充上的字 ≥4.5`, () => {
      for (const [front, back] of PAIRS_AA) {
        const ratio = contrast(hex(front), hex(back));
        assert.ok(ratio >= 4.5, `${tag} ${front} 对 ${back} 只有 ${ratio.toFixed(2)}`);
      }
    });

    test(`${tag}：装饰灰不低于默认主题的口径`, () => {
      // 与 base.css 注释一致：浅色对五种面 ≥3（只做注音、角标）；暗色小标签多，对凸起面 ≥4.5。
      const ratio = mode === "light"
        ? Math.min(...SURFACES.map((surface) => contrast(hex("--text-faint"), hex(surface))))
        : contrast(hex("--text-faint"), hex("--surface-raised-solid"));
      assert.ok(ratio >= (mode === "light" ? 3 : 4.5), `${tag} --text-faint 只有 ${ratio.toFixed(2)}`);
    });

    test(`${tag}：品牌色・链接色与语义色不撞（不差于默认）`, () => {
      for (const accent of ["--brand", "--interactive"]) {
        for (const semantic of SEMANTIC) {
          if (accent === "--interactive" && !["--danger", "--warning"].includes(semantic)) continue;
          const floor = Math.min(DE_SEMANTIC, deltaE(hexOf(defaults[mode], accent, "默认"), hexOf(defaults[mode], semantic, "默认")));
          const distance = deltaE(hex(accent), hex(semantic));
          assert.ok(distance >= floor, `${tag} ${accent} 与 ${semantic} ΔE ${distance.toFixed(3)} < ${floor.toFixed(3)}`);
        }
      }
    });

    test(`${tag}：同屏分类色两两可分（不差于默认）`, () => {
      for (const group of CATEGORY_GROUPS) {
        for (let i = 0; i < group.length; i += 1) {
          for (let j = i + 1; j < group.length; j += 1) {
            const floor = Math.min(DE_CATEGORY, deltaE(hexOf(defaults[mode], group[i], "默认"), hexOf(defaults[mode], group[j], "默认")));
            const distance = deltaE(hex(group[i]), hex(group[j]));
            assert.ok(distance >= floor, `${tag} ${group[i]} 与 ${group[j]} ΔE ${distance.toFixed(3)} < ${floor.toFixed(3)}`);
          }
        }
      }
    });

    test(`${tag}：图表 6 档色阶单一色相、明度有序、最弱一档看得见`, () => {
      const steps = [0, 1, 2, 3, 4, 5].map((index) => hex(`--chart-step-${index}`));
      const lightness = steps.map((step) => oklab(step)[0]);
      // 序号越大越「强」：浅色里越来越深，暗色里越来越亮。
      const direction = mode === "light" ? -1 : 1;
      for (let index = 1; index < steps.length; index += 1) {
        const step = (lightness[index] - lightness[index - 1]) * direction;
        assert.ok(step >= 0.06, `${tag} --chart-step-${index - 1}→${index} 明度差只有 ${step.toFixed(3)}`);
      }
      const hues = steps.map(hue);
      assert.ok(Math.max(...hues) - Math.min(...hues) <= 12, `${tag} 色阶色相漂移 ${(Math.max(...hues) - Math.min(...hues)).toFixed(1)}°`);
      const edge = contrast(steps[0], hex("--surface"));
      assert.ok(edge >= 2, `${tag} 最弱一档对 --surface 只有 ${edge.toFixed(2)}`);
    });

    test(`${tag}：3D 舞台底色带皮肤色相、明度与默认舞台相当`, () => {
      const [voidL] = oklab(hex("--stage-void"));
      const [bgL] = oklab(hex("--stage-bg"));
      const [defaultVoidL] = oklab("#030807");
      const [defaultBgL] = oklab("#07110d");
      assert.ok(Math.abs(voidL - defaultVoidL) <= 0.02, `${tag} --stage-void 明度 ${voidL.toFixed(3)} 偏离默认 ${defaultVoidL.toFixed(3)}`);
      assert.ok(Math.abs(bgL - defaultBgL) <= 0.02, `${tag} --stage-bg 明度 ${bgL.toFixed(3)} 偏离默认 ${defaultBgL.toFixed(3)}`);
      assert.ok(voidL < bgL, `${tag} 虚空应比全屏底更深`);
    });
  }
}

/* ===== 首帧：服务端按 cookie 直接写 <html data-skin>，不靠客户端补 ===== */

async function renderLayout(cookieJar) {
  const { default: RootLayout } = await loadAppModule("app/layout.tsx", {
    stubs: {
      "next/headers": {
        cookies: async () => ({ get: (name) => (name in cookieJar ? { name, value: cookieJar[name] } : undefined) }),
        headers: async () => new Headers({ host: "localhost:3000" }),
      },
      "next/font/google": { Geist: () => ({ variable: "font-sans" }), Geist_Mono: () => ({ variable: "font-mono" }) },
    },
  });
  return renderToStaticMarkup(await RootLayout({ children: createElement("main", null, "正文") }));
}

const htmlTag = (html) => html.match(/<html[^>]*>/)?.[0] ?? "";

for (const theme of ["light", "dark"]) {
  test(`首帧：cookie 选了海（${theme}）时 <html> 直接带 data-skin="kaiyo"`, async () => {
    const tag = htmlTag(await renderLayout({ [UI_SKIN_COOKIE]: "kaiyo", "career-room-theme": theme }));
    assert.match(tag, /data-skin="kaiyo"/);
    assert.match(tag, new RegExp(`data-theme="${theme}"`));
  });
}

test("首帧：没有皮肤 cookie、选了默认或值不认识时不写 data-skin", async () => {
  for (const jar of [{}, { [UI_SKIN_COOKIE]: "default" }, { [UI_SKIN_COOKIE]: "sepia" }]) {
    const tag = htmlTag(await renderLayout(jar));
    assert.ok(tag.startsWith("<html"), "渲染结果里应有 <html>");
    assert.doesNotMatch(tag, /data-skin/);
  }
});
