"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createExitController, NOTE_EXIT_MS, type ExitController } from "@/lib/exit-transition";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * 给「按 key 打开的一层」加退场：exit(finish) 先把 exiting 置真、等退场播完再执行原来的关闭逻辑。
 * key 一变（关闭途中又打开了别的笔记、或被导航清空），退场状态在渲染期就复位，
 * 新的一篇不会带着半透明出现一帧。
 */
export function useExitTransition(current: string | null, durationMs = NOTE_EXIT_MS) {
  const [exitingKey, setExitingKey] = useState<string | null>(null);
  const [trackedKey, setTrackedKey] = useState(current);
  if (trackedKey !== current) {
    setTrackedKey(current);
    setExitingKey(null);
  }

  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const controllerRef = useRef<ExitController | null>(null);
  useEffect(() => {
    const controller = createExitController({
      current: () => currentRef.current,
      // 每次退场时现问：设置里切成「总是减弱」后，不用重挂也立刻生效。
      reducedMotion: prefersReducedMotion,
      onExiting: (key) => setExitingKey(key),
      onRelease: (key) => setExitingKey((value) => (value === key ? null : value)),
      scheduler: {
        set: (callback, ms) => window.setTimeout(callback, ms),
        clear: (id) => window.clearTimeout(id),
      },
      durationMs,
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [durationMs]);

  const exit = useCallback((finish: () => void) => {
    // 挂载前（理论上不会发生）没有控制器就直接关，不能让关闭按钮失灵。
    if (controllerRef.current) controllerRef.current.exit(finish);
    else finish();
  }, []);

  return { exiting: exitingKey !== null && exitingKey === current, exit };
}
