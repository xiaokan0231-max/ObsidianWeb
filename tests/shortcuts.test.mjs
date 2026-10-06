import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { SHORTCUT_GROUPS } from "../lib/shortcuts.ts";

/*
 * 设置中心的快捷键表只是「说明」，真正的处理在各页的 keydown 里。
 * 这里给每一条配一组源码判据：实现删了某个键、表还留着，测试就红；
 * 反过来，快练与 3D 那几处有声明式的 aria-keyshortcuts／帮助表，再核对一遍它们都在表里。
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const PROBES = {
  "global:palette": [/\(event\.metaKey \|\| event\.ctrlKey\) && event\.key\.toLowerCase\(\) === "k"/, /setSearchOpen\(\(open\) => !open\)/],
  "global:reload": [/event\.key\.toLowerCase\(\) === "r"/, /!isTypingTarget\(event\.target\)/, /loadVault\(\{ fresh: true \}\)/],
  "global:escape": [/event\.key === "Escape"/, /setSearchOpen\(false\)/],

  "quick:choose": [/CHOICE_KEYS = \["1", "2", "3", "4"\]/, /actions\.choose\(/],
  "quick:rate": [/RATING_KEYS[^=]*= \{ "1": "remembered", "2": "fuzzy", "3": "forgot" \}/, /actions\.rate\(/],
  "quick:reveal": [/!session\.revealed && key === " "/, /actions\.reveal\(\)/],
  "quick:next": [/key === "Enter" \|\| key === " " \|\| key === "ArrowRight"/, /actions\.next\(\)/],
  "quick:giveUp": [/key === "\?"/, /actions\.giveUp\(\)/],
  "quick:easy": [/letter === "e"/, /actions\.easy\(\)/],
  "quick:suspend": [/letter === "x"/, /actions\.suspend\(\)/],
  "quick:undo": [/letter === "z"/, /actions\.undo\(\)/],
  "quick:back": [/key === "ArrowLeft"/, /actions\.back\(\)/],
  "quick:forward": [/key === "ArrowRight"/, /actions\.forward\(\)/],
  "quick:end": [/key === "Escape"/, /actions\.end\(\)/],

  "triage:judge": [/JUDGMENT_KEYS[^=]*= \{ "1": "known", "2": "uncertain", "3": "unknown" \}/, /judge\(judgment\)/],
  "triage:back": [/key === "ArrowLeft"/, /back\(\)/],
  "triage:forward": [/key === "ArrowRight"/, /forward\(\)/],
  "triage:done": [/key === "Enter" && !yieldsToNative\(event\)/, /onEnd\(\)/],
  "triage:end": [/key === "Escape"/, /onEnd\(\)/],

  "calendar:page": [/key === "\[" \|\| key === "\]"/, /moveMonth\(key === "\[" \? -1 : 1\)/, /moveWeek\(key === "\[" \? -1 : 1\)/],
  "calendar:today": [/key\.toLowerCase\(\) === "t"/, /goToday\(\)/],
  "calendar:day": [/key === "ArrowLeft" \|\| key === "ArrowRight"/],
  "calendar:week": [/key === "ArrowUp" \|\| key === "ArrowDown"/],
  "calendar:open": [/key === "Enter" && selectedDay/, /openEvent\(first\)/],

  "jobs:search": [/event\.key !== "\/"/, /searchRef\.current\?\.focus\(\)/],
  "jobs:close": [/event\.key === "Escape"/, /setCompareOpen\(false\)/],
  "jobs:step": [/event\.key === "j" \|\| event\.key === "ArrowDown"/, /event\.key === "k" \|\| event\.key === "ArrowUp"/],

  "library:move": [/event\.key === "j" \|\| event\.key === "k"/],
  "library:open": [/event\.key === "Enter" && current < 0/],

  "review:filter": [/"1": "all"/, /"9": "go"/, /const next = byKey\[event\.key\]/],

  "reading:step": [/event\.key === "ArrowRight" \|\| event\.key === "ArrowLeft"/, /stepStageLine\(/],
  "reading:close": [/event\.key === "Escape"/],

  "graph3d:search": [/event\.key !== "\/"/],
  "graph3d:fullscreen": [/event\.key\.toLowerCase\(\) !== "f"/, /toggleFullscreen\(\)/],
  "graph3d:dossier": [/key === "d"/, /setDossierMode/],
  "graph3d:open": [/key === "o"/, /openNode\(selectedId\)/],
  "graph3d:zoom": [/event\.key === "\+" \|\| event\.key === "="/, /event\.key === "-"/],
  "graph3d:zoomReset": [/event\.key === "0"/, /setDossierZoom\(1\)/],
  "graph3d:step": [/\["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"\]\.includes\(event\.key\)/],
  "graph3d:pause": [/key === "p"/, /setPaused/],
  "graph3d:reset": [/key === "r"/, /resetViewRef\.current\(\)/],
  "graph3d:help": [/event\.key === "\?"/, /setShortcutHelp/],

  "timeline3d:view": [/key === "v"/],
  "timeline3d:step": [/\["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"\]\.includes\(event\.key\)/],
  "timeline3d:month": [/event\.key === "PageUp" \|\| event\.key === "\["/, /event\.key === "PageDown" \|\| event\.key === "\]"/],
  "timeline3d:home": [/event\.key === "Home"/],
  "timeline3d:end": [/event\.key === "End"/],
  "timeline3d:reset": [/key === "r"/],
};

test("表的形状：组与条目 id 唯一、键帽与中日说明齐全、源文件存在", () => {
  const groupIds = SHORTCUT_GROUPS.map((group) => group.id);
  assert.equal(new Set(groupIds).size, groupIds.length);
  for (const group of SHORTCUT_GROUPS) {
    assert.ok(group.title[0] && group.title[1], group.id);
    assert.ok(group.scope[0] && group.scope[1], group.id);
    assert.ok(group.source.length > 0, group.id);
    for (const file of group.source) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
    const ids = group.entries.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, `${group.id} 里有重复 id`);
    for (const entry of group.entries) {
      assert.ok(entry.keys.length > 0 && entry.keys.every(Boolean), `${group.id}:${entry.id}`);
      assert.ok(entry.label[0] && entry.label[1], `${group.id}:${entry.id}`);
    }
  }
  // 任务要求的三组都在。
  for (const id of ["global", "quick", "triage"]) assert.ok(groupIds.includes(id), id);
});

test("表里每一条都能在对应源文件里找到按键判断", () => {
  const covered = new Set();
  for (const group of SHORTCUT_GROUPS) {
    const source = group.source.map(read).join("\n");
    for (const entry of group.entries) {
      const id = `${group.id}:${entry.id}`;
      const probes = PROBES[id];
      assert.ok(probes, `${id} 没有配源码判据：新增表项时同时在本测试里写上它在源码里的样子`);
      for (const probe of probes) assert.match(source, probe, `${id}：${group.source.join(", ")} 里找不到 ${probe}`);
      covered.add(id);
    }
  }
  assert.deepEqual(Object.keys(PROBES).filter((id) => !covered.has(id)), [], "判据里有表中已删除的条目");
});

/** aria-keyshortcuts 的写法 → 表里的键帽写法。 */
const ARIA_TO_CAP = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", Space: "Space", Enter: "Enter", "Shift+?": "?" };

function capsOf(group) {
  const caps = new Set();
  for (const entry of group.entries) {
    for (const key of entry.keys) {
      caps.add(key);
      const range = /^(\d)–(\d)$/.exec(key);
      if (range) for (let digit = Number(range[1]); digit <= Number(range[2]); digit += 1) caps.add(String(digit));
    }
  }
  return caps;
}

test("快练与快速过一遍里声明的 aria-keyshortcuts 都在表里", () => {
  for (const [groupId, file] of [["quick", "app/language-quick-drill.tsx"], ["triage", "app/language-quick-triage.tsx"]]) {
    const caps = capsOf(SHORTCUT_GROUPS.find((group) => group.id === groupId));
    const declared = [...read(file).matchAll(/aria-keyshortcuts="([^"]+)"/g)].flatMap((match) => match[1].split(" "));
    assert.ok(declared.length >= 4, `${file} 只扫到 ${declared.length} 个声明`);
    for (const key of declared) {
      const cap = ARIA_TO_CAP[key] ?? key;
      assert.ok(caps.has(cap), `${file} 声明了 ${key}，快捷键表的 ${groupId} 组里没有`);
    }
  }
});

test("3D 星图与航道自带的快捷键帮助表与设置页的表一致", () => {
  const normalize = (key) => key.replace("＋", "+").replace("－", "−");
  const graphCaps = capsOf(SHORTCUT_GROUPS.find((group) => group.id === "graph3d"));
  const timelineCaps = new Set([...graphCaps, ...capsOf(SHORTCUT_GROUPS.find((group) => group.id === "timeline3d"))]);
  for (const [file, caps] of [["app/knowledge-graph-three.tsx", graphCaps], ["app/timeline-three.tsx", timelineCaps]]) {
    const block = /entries=\{\[([\s\S]*?)\]\}/.exec(read(file));
    assert.ok(block, `${file} 里找不到 StageShortcuts 的 entries`);
    const keys = [...block[1].matchAll(/keys: \[([^\]]+)\]/g)].flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((key) => normalize(key[1])));
    assert.ok(keys.length >= 8, `${file} 只扫到 ${keys.length} 个键`);
    for (const key of keys) assert.ok(caps.has(key), `${file} 的帮助表有 ${key}，设置页的表里没有`);
  }
});
