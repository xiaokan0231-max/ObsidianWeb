"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * 单个视图的错误边界。
 *
 * 整个应用是一个客户端外壳，某篇笔记的 frontmatter 形状不对就能让一个视图在渲染时抛错——
 * 没有边界时 React 卸掉整棵树，白屏，连侧栏都没了。边界把损失限制在当前视图，
 * 其它页面照常，并给一个「重试」（重新挂载）和错误原文。
 */
type Props = { children: ReactNode; label: string };
type State = { error: Error | null };

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
    return (
      <div className="view-error" role="alert">
        <span className="error-code">RENDER / {this.props.label}</span>
        <h1>这个视图渲染时出错了。</h1>
        <p>其它页面不受影响。多半是某篇笔记的 frontmatter 形状不符合预期；错误原文如下，可以先跑 npm run vault:check。</p>
        <code>{this.state.error.message}</code>
        <button onClick={() => this.setState({ error: null })}>重试 <span>↻</span></button>
      </div>
    );
  }
}
