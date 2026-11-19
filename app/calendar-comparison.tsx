"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { COMPANY_COMPARE_LIMIT } from "@/lib/company-compare";
import type { CalendarComparisonTarget } from "@/lib/calendar-snapshot";
import { useUiLocale } from "./ui-locale";

const COPY = {
  "zh-CN": {
    add: "加入对比", remove: "移出对比", heading: "企业对比", open: "开始比较",
    removeShort: "移出", clear: "清空", menu: "企业对比操作",
    selectHint: "右击面试场次或从日程详情加入，选两项即可比较。",
    minimum: "再加入 1 项", maximum: "已选满 8 项，可先移出一项",
    count: (count: number) => `已选 ${count} 项`,
  },
  ja: {
    add: "比較に追加", remove: "比較から外す", heading: "企業比較", open: "比較を開始",
    removeShort: "外す", clear: "クリア", menu: "企業比較の操作",
    selectHint: "面接の予定を右クリックするか、日程の詳細から追加。2件から比較できます。",
    minimum: "あと1件追加", maximum: "上限の8件に達しました",
    count: (count: number) => `${count}件を選択中`,
  },
} as const;

export function toggleCalendarComparison(selection: CalendarComparisonTarget[], target: CalendarComparisonTarget) {
  if (selection.some(({ path }) => path === target.path)) return selection.filter(({ path }) => path !== target.path);
  return selection.length < COMPANY_COMPARE_LIMIT ? [...selection, target] : selection;
}

export type CalendarComparisonActions = {
  eventProps: ReturnType<typeof useCalendarComparison>["eventProps"];
  eventAction: ReturnType<typeof useCalendarComparison>["eventAction"];
};

export function useCalendarComparison(
  targets: ReadonlyMap<string, CalendarComparisonTarget> | undefined,
  selection: CalendarComparisonTarget[],
  onToggle: ((target: CalendarComparisonTarget) => void) | undefined,
) {
  const { locale } = useUiLocale();
  const copy = COPY[locale];
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; trigger: HTMLButtonElement } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuAction = useRef<HTMLButtonElement>(null);
  const selectedPaths = new Set(selection.map(({ path }) => path));
  const full = selection.length >= COMPANY_COMPARE_LIMIT;
  const target = menu && targets?.get(menu.id);

  useEffect(() => {
    if (!menu || !target) return;
    const close = () => setMenu(null);
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const moveFocus = (event: FocusEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    menuAction.current?.focus();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", moveFocus);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", moveFocus);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu, target]);

  const menuAt = (id: string, x: number, y: number, trigger: HTMLButtonElement) => {
    setMenu({ id, x: Math.max(8, Math.min(x, window.innerWidth - 204)), y: Math.max(8, Math.min(y, window.innerHeight - 66)), trigger });
  };
  const finishMenu = () => {
    setMenu(null);
    menu?.trigger.focus();
  };
  const isSelected = (item: CalendarComparisonTarget) => selectedPaths.has(item.path);
  const actionLabel = (item: CalendarComparisonTarget) => isSelected(item) ? copy.remove : copy.add;
  const blocked = (item: CalendarComparisonTarget) => full && !isSelected(item);

  const eventProps = (id: string) => {
    const item = targets?.get(id);
    if (!item || !onToggle) return {};
    return {
      "data-compared": isSelected(item) ? "" : undefined,
      "aria-haspopup": "menu" as const,
      "aria-keyshortcuts": "Shift+F10",
      onContextMenu: (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        menuAt(id, event.clientX, event.clientY, event.currentTarget);
      },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        menuAt(id, rect.left, rect.bottom, event.currentTarget);
      },
    };
  };
  const eventAction = (id: string) => {
    const item = targets?.get(id);
    if (!item || !onToggle) return null;
    return <button type="button" className="calendar-comparison-action" aria-label={`${item.company} · ${actionLabel(item)}`}
      title={blocked(item) ? copy.maximum : actionLabel(item)} aria-pressed={isSelected(item)}
      disabled={blocked(item)} onClick={() => onToggle(item)}>
      {actionLabel(item)}
    </button>;
  };
  const popup = menu && target && onToggle ? createPortal(
    <div className="calendar-comparison-menu" ref={menuRef} role="menu" aria-label={copy.menu}
      style={{ left: menu.x, top: menu.y }} onKeyDown={(event) => {
        if (event.key !== "Escape" && event.key !== "Tab") return;
        if (event.key === "Escape") event.preventDefault();
        event.stopPropagation();
        finishMenu();
      }}>
      <button type="button" ref={menuAction} role="menuitem" aria-disabled={blocked(target)} onClick={() => {
        if (blocked(target)) return;
        onToggle(target);
        finishMenu();
      }}>{blocked(target) ? copy.maximum : actionLabel(target)}</button>
    </div>, document.body,
  ) : null;
  return { eventProps, eventAction, popup };
}

export function CalendarComparisonToolbar({ selection, onToggle, onClear, onOpen }: {
  selection: CalendarComparisonTarget[];
  onToggle: (target: CalendarComparisonTarget) => void;
  onClear: () => void;
  onOpen: () => void;
}) {
  const { locale } = useUiLocale();
  const copy = COPY[locale];
  return <section className="calendar-comparison-toolbar" aria-labelledby="calendar-comparison-heading">
    <div className="calendar-comparison-summary">
      <h3 id="calendar-comparison-heading">{copy.heading}</h3>
      <span role="status">{copy.count(selection.length)}</span>
    </div>
    {selection.length ? <ul className="calendar-comparison-items">
      {selection.map((item) => <li key={item.path}>
        <span><strong>{item.company}</strong>{item.role && <small>{item.role}</small>}</span>
        <button type="button" aria-label={[copy.remove, item.company, item.role].filter(Boolean).join(" · ")}
          onClick={() => onToggle(item)}>{copy.removeShort}</button>
      </li>)}
    </ul> : <p className="calendar-comparison-hint">{copy.selectHint}</p>}
    <div className="calendar-comparison-controls">
      {selection.length === 1 && <span className="calendar-comparison-hint">{copy.minimum}</span>}
      {selection.length >= 2 && <button type="button" className="calendar-comparison-clear" onClick={onClear}>{copy.clear}</button>}
      <button type="button" className="calendar-comparison-open" disabled={selection.length < 2} onClick={onOpen}>{copy.open}</button>
    </div>
  </section>;
}
