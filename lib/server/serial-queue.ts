// 「读 → 判断 → 写」这段区间不是原子的：Obsidian REST API 单次写入是原子的，
// 但「读出内容、数出最大编号、再追加一条」中间能插进另一个请求——连打或二重提交就会写重。
// 所以写同一资源的路由必须共用一段很短的串行区间。
//
// 这个形状是有意的：函数是 async，第一个 await 之前的两句
//（取走上一条 tail、把自己装成新的 tail）在调用瞬间同步跑完，
// 所以同一 tick 里涌进来的多个调用会按调用顺序排队。把 await 提到前面就会打乱这个顺序。
// tail 只在 finally 的 release() 里被 resolve，永远不会 reject：
// 某次操作失败只抛回它自己的调用方，不会毒化后面排着的请求。
export type SerialQueue = <T>(operation: () => Promise<T>) => Promise<T>;
export type KeyedSerialQueue = <T>(key: string, operation: () => Promise<T>) => Promise<T>;

// 可变状态留在调用方的模块变量里，这个共享模块自己不持有任何状态。
// 同一资源的调用方从共享模块导入队列；不同资源用路径分片。工厂本身不隐含全局写锁。
export function createSerialQueue(): SerialQueue {
  let tail = Promise.resolve();
  return async function run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = tail;
    let release = () => {};
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

/**
 * 按 key 分片串行：同 key 的操作保持顺序，不同 key 可并行。
 * 这里的 key 建议直接用 note.path，避免不同资源互相阻塞。
 */
export function createKeyedSerialQueue(ttlMs = 120_000): KeyedSerialQueue {
  const tails = new Map<string, Promise<void>>();
  const cleanup = new Map<string, ReturnType<typeof setTimeout>>();

  function clearCleanup(key: string) {
    const timer = cleanup.get(key);
    if (timer) {
      clearTimeout(timer);
      cleanup.delete(key);
    }
  }

  return async function run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (!key) {
      throw new Error("并发串行队列需要 key。");
    }

    const previous = tails.get(key) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    tails.set(key, current);
    clearCleanup(key);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      clearCleanup(key);
      const timer = setTimeout(() => {
        const latest = tails.get(key);
        if (latest === current) tails.delete(key);
        clearCleanup(key);
      }, Math.max(1_000, ttlMs));
      // 只是清理用的计时器：别让它把 node 进程（脚本・测试）多拖住两分钟。workerd 的 setTimeout 返回数字，没有 unref。
      (timer as { unref?: () => void }).unref?.();
      cleanup.set(key, timer);
    }
  };
}
