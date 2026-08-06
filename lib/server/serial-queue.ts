// 「读 → 判断 → 写」这段区间不是原子的：Obsidian REST API 单次写入是原子的，
// 但「读出内容、数出最大编号、再追加一条」中间能插进另一个请求——连打或二重提交就会写重。
// 所以每条会写 vault 的路由各自持有一段很短的串行区间。
//
// 这个形状是有意的：函数是 async，第一个 await 之前的两句
//（取走上一条 tail、把自己装成新的 tail）在调用瞬间同步跑完，
// 所以同一 tick 里涌进来的多个调用会按调用顺序排队。把 await 提到前面就会打乱这个顺序。
// tail 只在 finally 的 release() 里被 resolve，永远不会 reject：
// 某次操作失败只抛回它自己的调用方，不会毒化后面排着的请求。
export type SerialQueue = <T>(operation: () => Promise<T>) => Promise<T>;

// 可变状态留在调用方的模块变量里，这个共享模块自己不持有任何状态。
// 现在的粒度是「一条路由一条队列，路由之间互不阻塞」；用工厂而不是模块级的
// serialize(key, operation)，就是为了让这个粒度由模块图决定，而不是由一个字符串 key 决定
//（key 打错会把两条路由悄悄并进同一条队列，编译器查不出来）。
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
