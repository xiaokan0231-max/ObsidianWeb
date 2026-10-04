"use client";

import { useLayoutEffect, useRef } from "react";

/*
 * 数字滚动。约束都来自这个项目的现实：
 * - SSR 与首帧必须直接是终值：测试用 renderToStaticMarkup 断言数字，首屏也不该先闪一个 0。
 * - 只改 React 自己建的那个文本节点的 nodeValue，不用 textContent（会换掉节点，React 之后
 *   写进一个已脱离的节点，显示就停在旧值上）。
 * - 页面不可见时 rAF 不跑（后台标签、预览面板），直接给终值，免得停在半截。
 * - 系统开了减弱动效就不滚。
 * `as` 让调用处直接渲染 <strong>/<b>/<dd> 本身，测试锁定了标签结构的地方不会多出一层 <span>。
 */
type Tag = "span" | "strong" | "b" | "em" | "dd" | "p";

const defaultFormat = (value: number) => String(Math.round(value));

export function CountUp({
  value,
  format = defaultFormat,
  duration = 600,
  as: Element = "span",
  className,
}: {
  value: number;
  format?: (value: number) => string;
  duration?: number;
  as?: Tag;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const formatRef = useRef(format);
  useLayoutEffect(() => {
    formatRef.current = format;
  });
  useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || !Number.isFinite(value)) return;
    const text = node as Text;
    const final = formatRef.current(value);
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      || document.visibilityState !== "visible";
    if (still || value === 0) {
      text.nodeValue = final;
      return;
    }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      text.nodeValue = progress < 1 ? formatRef.current(value * eased) : final;
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    text.nodeValue = formatRef.current(0);
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      text.nodeValue = final;
    };
  }, [value, duration]);
  return (
    <Element ref={ref as never} className={className}>
      {format(value)}
    </Element>
  );
}
