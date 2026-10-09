"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getTitle, type Note } from "@/lib/notes";
import { getGroup, trustLayer, type GroupKey } from "@/lib/memory-atlas-data";
import { wikiPreviewExcerpt } from "@/lib/markdown-syntax";
import { headingPlainText } from "@/lib/reading-document";
import type { UiLocale } from "@/lib/ui-locale";
import { useUiLocale } from "./ui-locale";

/** 悬停多久才弹：划过正文时不该一路闪卡片，停下来看才出。 */
const PREVIEW_DELAY_MS = 300;
const CARD_WIDTH = 320;

const PREVIEW_COPY: Record<UiLocale, {
  groups: Record<GroupKey, string>;
  trust: Record<string, string>;
  empty: string;
  missing: string;
}> = {
  "zh-CN": {
    groups: { self: "关于我", career: "求职", study: "日语学习", analysis: "AI 分析", system: "系统" },
    trust: { "trust-authority": "权威事实", "trust-evidence": "证据层", "trust-analysis": "分析 / 假设", "trust-reference": "导航 / 素材" },
    empty: "这篇笔记还没有正文。",
    missing: "找不到这篇笔记，或同名笔记不止一篇",
  },
  ja: {
    groups: { self: "自己紹介", career: "就職活動", study: "日本語学習", analysis: "AI 分析", system: "システム" },
    trust: { "trust-authority": "確定情報", "trust-evidence": "証拠", "trust-analysis": "分析 / 仮説", "trust-reference": "案内 / 素材" },
    empty: "このノートにはまだ本文がありません。",
    missing: "該当するノートが見つからないか、同名のノートが複数あります",
  },
};

export function wikiMissingTitle(locale: UiLocale) {
  return PREVIEW_COPY[locale].missing;
}

type Placement = { left: number; top?: number; bottom?: number };
/** 卡片挂在哪：星图／航道全屏时只渲染全屏元素这棵子树，挂在 body 上的卡片会被压在全屏层下面。 */
type ShownCard = { placement: Placement; host: HTMLElement };

function placeCard(anchor: DOMRect): Placement {
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - CARD_WIDTH - 12));
  // 下方放不下时翻到上方；卡片高度不定，按 200px 估，宁可早翻也不压出视口。
  return anchor.bottom + 210 > window.innerHeight
    ? { left, bottom: window.innerHeight - anchor.top + 8 }
    : { left, top: anchor.bottom + 8 };
}

/**
 * 解析得到的双链：悬停 300ms 或键盘聚焦时弹出预览卡。
 * 卡片挂到 body 上并用 fixed 定位——链接常在可横向滚动的表格或阅读层里，挂在原地会被裁掉。
 * 卡片不可聚焦、不拦指针：焦点始终留在链接上，Esc 只关卡片，不连带关掉外面的阅读层。
 */
export function WikiPreviewLink({ note, onOpen, children }: {
  note: Note;
  onOpen: () => void;
  children: ReactNode;
}) {
  const [shown, setShown] = useState<ShownCard | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const anchor = useRef<HTMLButtonElement>(null);
  const tooltipId = useId();
  const copy = PREVIEW_COPY[useUiLocale().locale];

  const cancel = () => window.clearTimeout(timer.current);
  const show = () => {
    cancel();
    timer.current = window.setTimeout(() => {
      if (!anchor.current) return;
      // 全屏舞台没有 transform/filter，fixed 坐标照旧按视口算；不挂进嵌入式阅读层，那里的 backdrop-filter 会改变 fixed 的参照。
      const host = (document.fullscreenElement as HTMLElement | null) ?? document.body;
      setShown({ placement: placeCard(anchor.current.getBoundingClientRect()), host });
    }, PREVIEW_DELAY_MS);
  };
  const hide = () => { cancel(); setShown(null); };

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 捕获阶段先拿到：阅读层自己也监听 Esc，不拦的话会连阅读层一起关。
      event.stopPropagation();
      setShown(null);
    };
    // 滚动后卡片与链接脱节，直接收起比跟随重算更不晃眼；进出全屏后挂载点也变了，同样收起。
    const close = () => setShown(null);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    document.addEventListener("fullscreenchange", close);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("fullscreenchange", close);
    };
  }, [shown]);

  const title = headingPlainText(getTitle(note));
  const excerpt = shown ? wikiPreviewExcerpt(note.content) : "";
  return (
    <>
      <button className="wiki-link" ref={anchor} onClick={() => { hide(); onOpen(); }}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        aria-describedby={shown ? tooltipId : undefined}>
        {children}
      </button>
      {shown && createPortal(
        <div className="wiki-preview" role="tooltip" id={tooltipId} style={{ ...shown.placement, width: CARD_WIDTH }}>
          <strong>{title}</strong>
          <span className="wiki-preview-meta">
            <span>{copy.groups[getGroup(note.path)]}</span>
            <span className={trustLayer(note).className}>{copy.trust[trustLayer(note).className]}</span>
          </span>
          <p>{excerpt || copy.empty}</p>
        </div>,
        shown.host,
      )}
    </>
  );
}
