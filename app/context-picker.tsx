"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  filterContextPickerGroups,
  findContextPickerItem,
  formatContextPickerEvent,
  pinCurrentContextPickerGroup,
  type ContextPickerGroup,
  type ContextPickerItem,
} from "@/lib/context-picker";
import { useDialogFocus } from "./use-dialog-focus";

// 「公司／岗位或面谈」的切换入口。原来是一个原生 <select>，上百个 option 一字排开，
// 同公司多条只差一个日文岗位名，也看不出哪条是面接中、哪条早已不採用。
// 现在触发器本身就把「当前是谁」说清楚，面板按此刻关心程度分组，保留与已结束默认折叠。
// 与同页的公司对比选择器共用 .co-picker-* 外壳，只是这里是单选、选完即关。

const KIND_LABEL: Record<ContextPickerItem["kind"], string> = { case: "", meeting: "面谈", series: "历史准备稿" };

// 选中后外壳可能整树重挂载（公司总览壳 ↔ v2 准备稿壳），useDialogFocus 归还焦点时
// 触发器已经是脱离 DOM 的旧节点。所以由下一次挂载的触发器自己把焦点接回来。
let refocusPending = false;

function ItemMeta({ item, today }: { item: ContextPickerItem; today: string }) {
  const label = item.status || KIND_LABEL[item.kind];
  return <span className="co-context-meta">
    {label && <em className="co-context-pill" title={item.detail || undefined}>{label}</em>}
    {item.eventAt && <time dateTime={item.eventAt.replace(" ", "T")}>{formatContextPickerEvent(item.eventAt, today)}</time>}
    {item.assessed && <small>已评估</small>}
    {item.rounds > 0 && <small>{item.rounds} 轮</small>}
  </span>;
}

/** option 的 id 要进 aria-activedescendant，路径里的斜杠和空格不能直接用。 */
function optionDomId(itemId: string) {
  return itemId.replace(/[^A-Za-z0-9_-]/g, (char) => `_${char.codePointAt(0)!.toString(16)}`);
}

export function ContextPickerPanel({ groups, selectedId, today, onSelect, onClose }: {
  groups: ContextPickerGroup[];
  selectedId: string;
  today: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const id = useId().replaceAll(":", "");
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  // 折叠组每次打开都重新折上：噪音就该每次都折着。搜索时无条件展开，否则搜不到折叠项。
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const searching = query.trim() !== "";
  const isExpanded = (group: ContextPickerGroup) => !group.collapsible || searching || expandedGroups.has(group.id);
  const visibleGroups = useMemo(() => (searching ? filterContextPickerGroups(groups, query) : pinCurrentContextPickerGroup(groups, selectedId)), [groups, query, searching, selectedId]);
  const visibleItems = useMemo(() => visibleGroups.flatMap((group) => (group.collapsible && !searching && !expandedGroups.has(group.id) ? [] : group.items)), [visibleGroups, searching, expandedGroups]);
  const [activeId, setActiveId] = useState(selectedId);
  const activeIndex = visibleItems.findIndex((item) => item.id === activeId);
  const resolvedActive = activeIndex >= 0 ? activeId : visibleItems[0]?.id ?? "";
  useDialogFocus(dialogRef, true);
  // useDialogFocus 会把焦点放到第一个可聚焦元素＝头部的关闭按钮；这里打开就是为了打字，焦点要落在搜索框。
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { const old = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = old; }; }, []);
  useEffect(() => {
    if (!resolvedActive) return;
    document.getElementById(`${id}-${optionDomId(resolvedActive)}`)?.scrollIntoView({ block: "nearest" });
  }, [id, resolvedActive]);
  const move = (offset: number) => {
    if (!visibleItems.length) return;
    const current = Math.max(0, visibleItems.findIndex((item) => item.id === resolvedActive));
    const next = Math.min(visibleItems.length - 1, Math.max(0, current + offset));
    setActiveId(visibleItems[next].id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Home") { event.preventDefault(); move(-visibleItems.length); }
    else if (event.key === "End") { event.preventDefault(); move(visibleItems.length); }
    else if (event.key === "Enter") { event.preventDefault(); if (resolvedActive) onSelect(resolvedActive); }
  };
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const collapsedNote = groups.filter((group) => group.collapsible).map((group) => `${group.label} ${group.items.length}`).join("、");
  const listId = `${id}-list`;
  return <div className="job-compare-backdrop co-compare-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="co-compare-panel co-picker-panel co-context-panel" role="dialog" aria-modal="true" aria-label="切换公司、案件或面谈" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className="co-compare-header"><div><p>共 {total} 项{collapsedNote ? ` · ${collapsedNote} 默认折叠` : ""}</p><h2>切换公司／岗位或面谈</h2></div><button type="button" onClick={onClose} aria-label="关闭切换">关闭 ×</button></header>
    <div className="co-picker-search"><label>搜索公司或岗位<input ref={inputRef} type="search" role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={resolvedActive ? `${id}-${optionDomId(resolvedActive)}` : undefined} aria-autocomplete="list" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="输入公司名、岗位、状态或面谈主题" /></label><p>↑↓ 移动 · Enter 打开 · Esc 关闭 · 搜索时折叠组也会显示</p></div>
    <div className="co-picker-list co-context-list" role="listbox" id={listId} aria-label="可切换的公司与岗位">{visibleGroups.map((group) => {
      const expanded = isExpanded(group);
      return <section key={group.id} className="co-context-group" role="group" aria-labelledby={`${id}-${group.id}`}>
        <h3 id={`${id}-${group.id}`}><span>{group.label}<b>{group.items.length}</b></span><small>{group.hint}</small>{group.collapsible && !searching && <button type="button" aria-expanded={expanded} onClick={() => setExpandedGroups((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}>{expanded ? "收起" : `显示 ${group.items.length} 项`}</button>}</h3>
        {expanded && group.items.map((item) => {
          const current = item.id === selectedId;
          return <div key={item.id} id={`${id}-${optionDomId(item.id)}`} role="option" aria-selected={current} className={`co-context-option tone-${item.tone}${current ? " current" : ""}${item.id === resolvedActive ? " active" : ""}`} onMouseMove={() => { if (item.id !== resolvedActive) setActiveId(item.id); }} onClick={() => onSelect(item.id)}>
            <span className="co-context-main"><strong>{item.company}</strong><span>{item.title}</span></span>
            <ItemMeta item={item} today={today} />
            <b className="co-context-current" aria-hidden="true">{current ? "当前" : ""}</b>
          </div>;
        })}
      </section>;
    })}{!visibleGroups.length && <p className="co-muted co-context-empty">没有找到对应的公司、岗位或面谈。</p>}</div>
  </div></div>;
}

export default function ContextPicker({ groups, selectedId, today, onSelect, className = "" }: {
  groups: ContextPickerGroup[];
  selectedId: string;
  today: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = selectedId ? findContextPickerItem(groups, selectedId) : null;
  const kindLabel = current ? KIND_LABEL[current.kind] : "";
  useEffect(() => {
    if (open || !refocusPending) return;
    refocusPending = false;
    triggerRef.current?.focus({ preventScroll: true });
  });
  const close = () => { refocusPending = true; setOpen(false); };
  return <>
    <button ref={triggerRef} type="button" className={`co-context-trigger${current ? "" : " empty"}${className ? ` ${className}` : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-label="切换公司、案件或面谈" title={current ? `${current.company}｜${current.title}` : undefined} onClick={() => setOpen(true)} onKeyDown={(event) => {
      // 保住原生 select 的手感：方向键也能打开。
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
    }}>
      <span className="co-context-trigger-label">公司／岗位或面谈{kindLabel ? ` · ${kindLabel}` : ""}</span>
      {current
        ? <span className="co-context-main"><strong>{current.company}</strong><span>{current.title}</span></span>
        : <span className="co-context-main"><strong>请选择公司／岗位或面谈</strong><span>按状态与日期分组，可搜索</span></span>}
      <span className="co-context-trigger-foot">{current && <ItemMeta item={current} today={today} />}<b aria-hidden="true">切换 ▾</b></span>
    </button>
    {open && <ContextPickerPanel groups={groups} selectedId={selectedId} today={today} onClose={close} onSelect={(id) => { close(); if (id !== selectedId) onSelect(id); }} />}
  </>;
}
