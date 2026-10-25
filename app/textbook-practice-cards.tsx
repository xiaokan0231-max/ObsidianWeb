"use client";

import { useState } from "react";
import type { TextbookPoint } from "@/lib/language-textbook-module";
import { useTextbookCopy } from "./language-textbook-copy";

type Side = "A" | "B";
type ContrastState = { pointId: string; index: number; selected: Side | null; explained: boolean };
type ExampleState = { pointId: string; index: number; revealed: boolean };

export function ContrastStep({ point, pointIndex = 0 }: { point: TextbookPoint; pointIndex?: number }) {
  const { t, locale } = useTextbookCopy();
  const [state, setState] = useState<ContrastState>({ pointId: point.id, index: 0, selected: null, explained: false });
  const current = state.pointId === point.id ? Math.min(state.index, Math.max(point.contrasts.length - 1, 0)) : 0;
  const active = state.pointId === point.id && state.index === current;
  const selected = active ? state.selected : null;
  const explained = active && state.explained;
  const contrast = point.contrasts[current];
  if (!contrast) return <p className="learning-card-empty" lang={locale}>{t("这个知识点暂时没有对比素材。")}</p>;

  // 每个知识点可能只有一对；跨知识点也交替目标，避免始终提示 A。
  const targetMeaning = (current + pointIndex) % 2 === 0 ? contrast.leftZh : contrast.rightZh;
  // 两句可能都适用；教材只有含义说明，没有足以判定唯一答案的上下文。
  const explanationId = `learning-contrast-explanation-${encodeURIComponent(point.id)}-${current}`;
  const update = (next: Partial<ContrastState>) => setState({ pointId: point.id, index: current, selected, explained, ...next });
  const move = (index: number) => setState({ pointId: point.id, index: Math.max(0, Math.min(index, point.contrasts.length - 1)), selected: null, explained: false });

  return <div className="learning-contrasts" lang={locale}>
    <div className="learning-card-position"><strong>{t("第 {current} / {total} 对", { current: current + 1, total: point.contrasts.length })}</strong><span>{t("当前重点的易混对比")}</span></div>
    <p className="learning-example-instruction">{t("先选一句，也可以直接看解释。比较的是含义，不是语法对错。")}</p>
    <section className="learning-contrast">
      <div className="learning-contrast-prompt"><small>{t("想表达这个意思，你会选哪一句？")}</small><p className="learning-example-chinese" lang="zh-CN">{targetMeaning}</p></div>
      <div className="learning-contrast-options learning-contrast-pair" role="group" aria-label={t("两句日语选项")}>
        {([{ side: "A", ja: contrast.leftJa, zh: contrast.leftZh }, { side: "B", ja: contrast.rightJa, zh: contrast.rightZh }] as const).map(option => <button
          key={option.side} type="button" className="learning-reveal-example learning-contrast-option"
          aria-pressed={selected === option.side} disabled={explained}
          onClick={() => update({ selected: option.side, explained: true })}
        ><b>{option.side}</b><span lang="ja">{option.ja}</span>{explained && <span className="learning-option-meaning" lang="zh-CN">{option.zh}</span>}</button>)}
      </div>
      {explained && <div id={explanationId} className="learning-contrast-explanation">
        {selected && <div className="learning-contrast-feedback" role="status"><p>{t("你选了 {choice}。看看两句各自强调什么。", { choice: selected })}</p></div>}
        <p className="learning-contrast-note"><b>{t("区别在这里")}</b><span lang="zh-CN">{contrast.explanationZh}</span></p>
      </div>}
      <div className="learning-card-nav learning-card-actions">
        {explained ? <button type="button" onClick={() => update({ selected: null, explained: false })}>{t("重新试一遍")}</button>
          : <button type="button" aria-expanded={false} aria-controls={explanationId} onClick={() => update({ explained: true })}>{t("直接看解释")}</button>}
      </div>
    </section>
    {point.contrasts.length > 1 && <nav className="learning-card-nav" aria-label={t("易混对比翻页")}>
      <button type="button" disabled={current === 0} onClick={() => move(current - 1)}>{t("← 上一对")}</button>
      <button type="button" disabled={current === point.contrasts.length - 1} onClick={() => move(current + 1)}>{t("下一对 →")}</button>
    </nav>}
  </div>;
}

export function ExampleStep({ point }: { point: TextbookPoint }) {
  const { t, locale } = useTextbookCopy();
  const [state, setState] = useState<ExampleState>({ pointId: point.id, index: 0, revealed: false });
  const current = state.pointId === point.id ? Math.min(state.index, Math.max(point.examples.length - 1, 0)) : 0;
  const active = state.pointId === point.id && state.index === current;
  const revealed = active && state.revealed;
  const example = point.examples[current];
  if (!example) return <p className="learning-card-empty" lang={locale}>{t("这个知识点暂时没有例句。")}</p>;

  const referenceId = `learning-example-japanese-${encodeURIComponent(point.id)}-${current}`;
  const update = (next: Partial<ExampleState>) => setState({ pointId: point.id, index: current, revealed, ...next });
  const move = (index: number) => setState({ pointId: point.id, index: Math.max(0, Math.min(index, point.examples.length - 1)), revealed: false });

  return <div className="learning-examples" lang={locale}>
    <div className="learning-card-position"><strong>{t("例句 {current} / {total}", { current: current + 1, total: point.examples.length })}</strong><span lang={example.labelZh ? "zh-CN" : locale}>{example.labelZh || t("教学例句")}</span></div>
    <p className="learning-example-instruction">{t("先试着用日语说一句，也可以直接看参考。")}</p>
    <div className="learning-example-card"><small>{t("想表达的意思")}</small><p className="learning-example-chinese" lang="zh-CN">{example.zh}</p>
      <button type="button" className="learning-reveal-example" aria-expanded={revealed} aria-controls={referenceId} onClick={() => update({ revealed: !revealed })}>{t(revealed ? "收起日语，再看中文" : "显示日语")}</button>
      {revealed && <div className="learning-example-japanese" id={referenceId}><small>{t("参考日语")}</small><p lang="ja">{example.ja}</p></div>}
      <p className="learning-example-instruction">{t("教学例句不代表本人的经历。")}</p>
    </div>
    {point.examples.length > 1 && <nav className="learning-card-nav" aria-label={t("例句翻页")}>
      <button type="button" disabled={current === 0} onClick={() => move(current - 1)}>{t("← 上一例句")}</button>
      <button type="button" disabled={current === point.examples.length - 1} onClick={() => move(current + 1)}>{t("下一例句 →")}</button>
    </nav>}
  </div>;
}
