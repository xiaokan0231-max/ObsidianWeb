"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useCommonMenu } from "./common-menu-copy";

/**
 * 单个视图的错误边界。
 *
 * 整个应用是一个客户端外壳，某篇笔记的 frontmatter 形状不对就能让一个视图在渲染时抛错——
 * 没有边界时 React 卸掉整棵树，白屏，连侧栏都没了。边界把损失限制在当前视图，
 * 其它页面照常，并给一个「重试」（重新挂载）和错误原文。
 */
type Props = { children: ReactNode; label: string };
type State = { error: Error | null };

function ViewErrorNotice({ error, label, onRetry }: { error: Error; label: string; onRetry: () => void }) {
  const menu = useCommonMenu();
  return <div className="view-error" role="alert">
    <span className="error-code">RENDER / {label}</span>
    <h1>{menu("这个页面暂时无法显示。")}</h1>
    <p>{menu("可以先重试；如果页面内容仍未载入，请重新载入页面。侧栏仍可切换到其它页面。")}</p>
    <code>{error.message}</code>
    <button onClick={onRetry}>{menu("重试")} <span>↻</span></button>
    <button onClick={() => window.location.reload()}>{menu("重新载入页面")}</button>
  </div>;
}

export default class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}] 视图渲染失败`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    // lazy 会缓存失败的模块请求；保留整页恢复入口，文案随当前语言切换。
    return <ViewErrorNotice error={this.state.error} label={this.props.label} onRetry={() => this.setState({ error: null })} />;
  }
}
