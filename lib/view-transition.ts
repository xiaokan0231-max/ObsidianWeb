/*
 * 页面切换转场（View Transitions API）与业务页 chunk 预取。
 *
 * 为什么单独成文件：外壳的 navigateToView 原本是一串同步 setState + history 操作，
 * 转场要把它整体挪进 startViewTransition 的回调（只包 setView 的话，其余 state 会先于旧快照提交，
 * 旧页面被新参数重挂一次后才被截图）。「何时走转场、何时照原路同步提交、被后来的导航顶掉时谁让路」
 * 这几条规则不依赖 React，放在这里用 node:test 一步步推进验证。
 *
 * 不支持该 API、减弱动效、文档隐藏（后台面板里 rAF 不跑，转场永远等不到下一帧）时，
 * commit 同步执行，行为与没有转场时逐位一致。
 */

/** 目标页 chunk 还没到时最多等这么久再开始转场；超时照常切换，新快照里先是骨架。 */
export const VIEW_TRANSITION_PRELOAD_WAIT_MS = 150;

export type ViewTransitionCommitMode = "transition" | "instant";

type TransitionHandle = {
  ready?: Promise<unknown>;
  finished?: Promise<unknown>;
  updateCallbackDone?: Promise<unknown>;
};

export type ViewTransitionDocument = {
  startViewTransition?: (update: () => void) => TransitionHandle | undefined | void;
  visibilityState?: string;
};

/** 能不能走转场：API 存在、文档可见、没有要求减弱动效。三者缺一就同步提交。 */
export function canStartViewTransition(
  doc: ViewTransitionDocument | null | undefined,
  prefersReducedMotion: () => boolean,
): boolean {
  if (!doc || typeof doc.startViewTransition !== "function") return false;
  if (doc.visibilityState === "hidden") return false;
  try {
    return !prefersReducedMotion();
  } catch {
    return false;
  }
}

/** 转场期间挂在 <html> 上的属性。CSS 只在它存在时给侧栏、顶栏等起 view-transition-name。 */
export const VIEW_TRANSITION_ATTRIBUTE = "data-view-transition";

type AttributeTarget = {
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
};

// 同时在跑的转场数。新转场会跳过旧的，旧的 finished 先兑现：只有全部结束才摘掉属性，
// 不然新转场截新快照时名字已经没了。
const activeTransitions = new WeakMap<AttributeTarget, number>();

/**
 * 启动一次转场。
 *
 * view-transition-name 只在转场期间生效：平时挂着名字的元素会多出层叠上下文等副作用，
 * 侧栏折叠态的悬停提示、顶栏的毛玻璃都可能受影响，所以先打标记、结束后摘掉。
 * 被后来的转场顶掉时 ready 会以 InvalidStateError 拒绝——那是预期内的，
 * 不该在控制台留一条未处理的拒绝。回调本身仍由浏览器执行，状态照样提交。
 */
export function startViewTransition(doc: ViewTransitionDocument, update: () => void, root?: AttributeTarget | null) {
  const leave = () => {
    if (!root) return;
    const remaining = (activeTransitions.get(root) ?? 1) - 1;
    if (remaining > 0) {
      activeTransitions.set(root, remaining);
      return;
    }
    activeTransitions.delete(root);
    root.removeAttribute(VIEW_TRANSITION_ATTRIBUTE);
  };
  if (root) {
    activeTransitions.set(root, (activeTransitions.get(root) ?? 0) + 1);
    root.setAttribute(VIEW_TRANSITION_ATTRIBUTE, "");
  }
  let handle: TransitionHandle | undefined | void;
  try {
    handle = doc.startViewTransition?.(update);
  } catch (error) {
    leave();
    throw error;
  }
  if (!handle || typeof handle !== "object") {
    leave();
    return;
  }
  for (const promise of [handle.ready, handle.updateCallbackDone]) promise?.catch(() => undefined);
  if (handle.finished) handle.finished.then(leave, leave);
  else leave();
}

export type ViewTransitionScheduler = {
  wait: (ms: number) => Promise<void>;
};

export type ViewTransitionNavigator = {
  /**
   * 请求一次导航。ready 返回 null 表示目标页已就绪；返回 Promise 时最多等 waitMs 再开始。
   * commit 收到 "transition" 时在转场回调里（调用方负责 flushSync），"instant" 时就在当前调用栈里。
   */
  navigate: (request: {
    ready?: () => Promise<unknown> | null;
    commit: (mode: ViewTransitionCommitMode) => void;
    /** false＝这一次不走转场（例如目标 chunk 没到又不值得等），同步提交。 */
    transition?: boolean;
  }) => void;
  /** 作废还没提交的导航（浏览器后退／前进已经换了地址，迟到的旧导航不能再 pushState）。 */
  cancel: () => void;
};

export function createViewTransitionNavigator({
  canTransition,
  start,
  scheduler,
  waitMs = VIEW_TRANSITION_PRELOAD_WAIT_MS,
}: {
  canTransition: () => boolean;
  start: (update: () => void) => void;
  scheduler: ViewTransitionScheduler;
  waitMs?: number;
}): ViewTransitionNavigator {
  // 每次导航递增。等 chunk 或等转场回调期间来了新的导航，旧的那次整体让路：
  // 只认最后一次点击，免得两次 pushState 的先后被异步等待打乱。
  let generation = 0;

  return {
    navigate({ ready, commit, transition = true }) {
      const run = ++generation;
      if (!transition || !canTransition()) {
        commit("instant");
        return;
      }
      const begin = () => {
        if (run !== generation) return;
        start(() => {
          // 浏览器在新转场开始时会跳过旧转场，但旧回调仍会被调用；这里让它什么都不做。
          if (run !== generation) return;
          commit("transition");
        });
      };
      const pending = ready?.() ?? null;
      if (!pending) {
        begin();
        return;
      }
      void Promise.race([
        pending.then(() => undefined, () => undefined),
        scheduler.wait(waitMs),
      ]).then(begin);
    },
    cancel() {
      generation += 1;
    },
  };
}

export type Preloadable<M> = {
  /** 交给 React.lazy 的加载器。已加载时返回同步兑现的 thenable，lazy 当场读到模块、不挂起。 */
  load: () => Promise<M>;
  /** 预取。永不拒绝：失败只是清掉缓存，下次 load 重新请求，错误交给页面的错误边界去显示。 */
  preload: () => Promise<void>;
  isLoaded: () => boolean;
};

/**
 * 可预取的动态导入。
 *
 * 为什么要「同步兑现」：React.lazy 拿到的即使是已经兑现的原生 Promise，then 回调也要等微任务，
 * 首次渲染照样挂起、显示 Suspense 骨架。转场回调里用 flushSync 提交新页时，这一挂起就会被截进新快照。
 * thenable 的 then 立即回调，lazy 当场标记为已兑现，新快照里就是完整的页面。
 */
export function createPreloadable<M>(importer: () => Promise<M>): Preloadable<M> {
  let state: { status: "idle" } | { status: "pending"; promise: Promise<M> } | { status: "fulfilled"; value: M } = { status: "idle" };

  const request = () => {
    if (state.status === "pending") return state.promise;
    const promise = importer().then(
      (value) => {
        state = { status: "fulfilled", value };
        return value;
      },
      (error: unknown) => {
        state = { status: "idle" };
        throw error;
      },
    );
    state = { status: "pending", promise };
    return promise;
  };

  return {
    load() {
      if (state.status === "fulfilled") {
        const value = state.value;
        const thenable = {
          then(onFulfilled?: ((value: M) => unknown) | null) {
            return Promise.resolve(onFulfilled ? onFulfilled(value) : value);
          },
        };
        return thenable as unknown as Promise<M>;
      }
      return request();
    },
    preload() {
      if (state.status === "fulfilled") return Promise.resolve();
      return request().then(() => undefined, () => undefined);
    },
    isLoaded: () => state.status === "fulfilled",
  };
}
