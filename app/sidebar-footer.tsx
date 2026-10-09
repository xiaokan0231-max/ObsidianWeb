"use client";

import type { ReactNode } from "react";
import { appViewHref, type AppView } from "./app-route";
import type { NavIconName, PrimaryNavigationItem } from "./navigation";
import "./styles/sidebar-footer.css";

/**
 * 侧栏底部的入口（目前只有「设置」）。和主导航同一套 `.side-nav a` 结构：
 * 折叠态的图标条、hover 名称气泡、当前页高亮都直接复用，不另写一套。
 * 单独成文件是为了外壳只多几行接线，样式也随这里加载。
 */
export default function SidebarFooter({
  items,
  view,
  onNavigate,
  onPreload,
  renderIcon,
}: {
  items: readonly PrimaryNavigationItem[];
  view: AppView;
  onNavigate: (view: AppView) => void;
  onPreload: (view: AppView) => void;
  renderIcon: (name: NavIconName) => ReactNode;
}) {
  if (!items.length) return null;
  return (
    <nav className="side-nav side-nav-footer">
      {items.map((item) => {
        const active = item.views.includes(view);
        return (
          <a
            key={item.id}
            className={active ? "active" : ""}
            href={appViewHref(item.target)}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNavigate(item.target);
            }}
            onPointerEnter={() => onPreload(item.target)}
            onFocus={() => onPreload(item.target)}
            aria-current={active ? "page" : undefined}
            data-label={item.label}
          >
            <span className="nav-glyph" aria-hidden="true">{renderIcon(item.glyph)}</span>
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
