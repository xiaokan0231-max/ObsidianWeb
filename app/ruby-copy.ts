import type { ClipboardEvent } from "react";

/** 表示上のルビは残し、通常の選択コピーからは読みだけを除く。 */
export function copySelectionWithoutRuby(event: ClipboardEvent<HTMLElement>) {
  const selection = event.currentTarget.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

  const fragment = selection.getRangeAt(0).cloneContents();
  fragment.querySelectorAll("rt, rp").forEach((node) => node.remove());
  const text = fragment.textContent;
  if (!text) return;

  event.preventDefault();
  event.clipboardData.setData("text/plain", text);
}
