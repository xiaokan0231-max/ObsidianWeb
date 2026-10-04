/*
 * 笔记详情・场景阅读层的「先退场、再关闭」。
 *
 * 为什么不用 animationend：减弱动效时 base.css 把时长压到近 0，有的浏览器干脆不派发；
 * 退场又必须在关闭逻辑（history.back / 清空 selectedPath）之前播完，所以用同一个常量起计时器，
 * CSS 的退场时长也从这个常量经内联变量拿，两边不会各写一个数。
 *
 * 不依赖 React，计时器可注入——测试能一步步推进，不必真等 200ms。
 */

/** 退场时长（ms）。CSS 经 --note-exit-duration 读同一个值。 */
export const NOTE_EXIT_MS = 200;

/**
 * finish 走 history.back() 时，selectedPath 要等 popstate 才变。万一回到的仍是同一篇
 * （同一篇被连开两次），退场状态就没人复位，一层看不见的模态框会挡住整页——过这么久兜底解除。
 */
export const NOTE_EXIT_SETTLE_MS = 400;

export type ExitScheduler = {
  set: (callback: () => void, ms: number) => number;
  clear: (id: number) => void;
};

export type ExitController = {
  /** 请求关闭。返回 false 表示这一篇已在退场中，本次重复请求被忽略。 */
  exit: (finish: () => void) => boolean;
  dispose: () => void;
};

export function createExitController({ current, reducedMotion, onExiting, onRelease, scheduler, durationMs = NOTE_EXIT_MS }: {
  /** 此刻打开着的那一篇（没有则 null）。 */
  current: () => string | null;
  reducedMotion: () => boolean;
  onExiting: (key: string) => void;
  /** 解除 key 的退场状态；调用方只在仍是这个 key 时清掉，别误伤后来打开的。 */
  onRelease: (key: string) => void;
  scheduler: ExitScheduler;
  durationMs?: number;
}): ExitController {
  let pending: { key: string; timer: number } | null = null;
  let settle: number | null = null;
  // 每次开始退场递增；兜底计时器只解除自己那一轮，不会把后来又一次的退场提前打断。
  let generation = 0;

  const clearSettle = () => {
    if (settle !== null) scheduler.clear(settle);
    settle = null;
  };

  return {
    exit(finish) {
      const key = current();
      if (key !== null && pending?.key === key) return false;
      if (pending) scheduler.clear(pending.timer);
      pending = null;
      clearSettle();
      if (key === null || reducedMotion()) {
        finish();
        return true;
      }
      const run = ++generation;
      onExiting(key);
      const timer = scheduler.set(() => {
        pending = null;
        // 退场途中换成了另一篇（或已经被别的入口关掉）：取消这次关闭，新的一篇照常显示。
        if (current() !== key) {
          onRelease(key);
          return;
        }
        finish();
        settle = scheduler.set(() => {
          settle = null;
          if (run === generation) onRelease(key);
        }, NOTE_EXIT_SETTLE_MS);
      }, durationMs);
      pending = { key, timer };
      return true;
    },
    dispose() {
      if (pending) scheduler.clear(pending.timer);
      pending = null;
      clearSettle();
      generation += 1;
    },
  };
}
