"use client";

/**
 * 路由级兜底：视图边界（view-error-boundary.tsx）之外的异常（外壳本身、布局）落到这里，
 * 至少给一个能按的「重试」而不是白屏。
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="view-error connection-error" role="alert">
      <span className="error-code">APP / ERROR</span>
      <h1>页面出错了。</h1>
      <p>刷新一次通常就好；反复出现时把下面的原文贴给 Claude。</p>
      <code>{error.message}</code>
      <button onClick={reset}>重试 <span>↻</span></button>
    </div>
  );
}
