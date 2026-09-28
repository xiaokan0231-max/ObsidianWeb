/**
 * 「这个视图要的笔记还没到」的骨架。
 *
 * 外壳按视图分 scope 懒加载，任何一个 scope 到了页面就开始画；各视图原来分不清
 * 「没加载」和「没有」，从首页切过去会先闪一下「还没有标准回答库」之类的假空态。
 * 空态组件在 loading 时改画这个，等 scope 到了再判断真空。
 */
export default function ScopeLoading({ label }: { label: string }) {
  return (
    <div className="scope-loading" role="status" aria-live="polite">
      <span className="scope-loading-dot" aria-hidden="true" />
      <p>正在读取{label}…</p>
    </div>
  );
}
