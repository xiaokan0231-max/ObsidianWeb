"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

/** 全屏 drawer / palette 共用的焦点边界。 */
export function useDialogFocus(dialogRef: RefObject<HTMLElement | null>, isolateAncestors = false) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const shell = dialog.closest(".app-shell");
    const inerted: { element: HTMLElement; previous: boolean }[] = [];
    if (shell) {
      // 场景内的阅读层不能禁用整个 app-shell，否则连阅读器自己也无法点击。
      // 逐层隔离兄弟节点，同时锁住画布、场景搜索和外层导航，关闭后恢复原有状态。
      let parent: HTMLElement | null = isolateAncestors ? dialog.parentElement : shell as HTMLElement;
      while (parent) {
        for (const child of parent.children) {
          if (!(child instanceof HTMLElement) || child.contains(dialog)) continue;
          inerted.push({ element: child, previous: child.inert });
          child.setAttribute("inert", "");
        }
        if (parent === shell || !isolateAncestors) break;
        parent = parent.parentElement;
      }
    }
    const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog).focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((element) => !element.hidden && element.offsetParent !== null);
      if (focusable.length === 0) { event.preventDefault(); dialog.focus(); return; }
      const current = document.activeElement;
      const index = focusable.indexOf(current as HTMLElement);
      const next = event.shiftKey
        ? focusable[index <= 0 ? focusable.length - 1 : index - 1]
        : focusable[index < 0 || index === focusable.length - 1 ? 0 : index + 1];
      if ((event.shiftKey && index <= 0) || (!event.shiftKey && (index < 0 || index === focusable.length - 1))) {
        event.preventDefault();
        next.focus();
      }
    };
    dialog.addEventListener("keydown", trap);
    return () => {
      dialog.removeEventListener("keydown", trap);
      inerted.forEach(({ element, previous: wasInert }) => { element.inert = wasInert; });
      previous?.focus({ preventScroll: true });
    };
  }, [dialogRef, isolateAncestors]);
}
