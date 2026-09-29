"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UNDO_LABEL } from "@/lib/ui-labels";

/*
 * 写回成功后的「已改为 X · 撤销」。
 *
 * 为什么要有：看板和行动清单的状态按钮一点就写进 vault，误点后只能去原笔记里手改，
 * 还得记得原来是什么值。为什么放在外壳里只有一条：同一时刻只该有一个「刚刚做了什么」，
 * 各页各弹一条会叠在一起，也分不清哪条的撤销对应哪次写入。
 */

/** 撤销本身也是一次写入：成功返回 null，失败返回给人看的理由。 */
export type UndoAction = () => Promise<string | null>;

type Flash = { id: number; message: string; undo?: UndoAction };

/** 足够读完一句话再伸手去点；太长会盖住底部的按钮。 */
export const UNDO_FLASH_MS = 8000;

/**
 * `onStaleFailure`：撤销失败时它那条提示已被更新的一次写入顶掉了——理由不能挂到别人的提示下面，
 * 也不能丢：丢了的话人会以为撤销成功，实际上状态还停在想撤回的那个值上。交给调用方找别处显示。
 */
export function useUndoFlash({ onStaleFailure }: { onStaleFailure?: (message: string) => void } = {}) {
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  const show = useCallback((message: string, undo?: UndoAction) => {
    sequence.current += 1;
    setError("");
    setBusy(false);
    setFlash({ id: sequence.current, message, undo });
  }, []);

  const dismiss = useCallback(() => {
    setFlash(null);
    setError("");
  }, []);

  // 撤销进行中、或撤销失败正在显示理由时不自动消失：否则人还没读完，理由就没了。
  useEffect(() => {
    if (!flash || busy || error) return;
    const id = flash.id;
    const timer = window.setTimeout(() => setFlash((current) => (current?.id === id ? null : current)), UNDO_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash, busy, error]);

  const runUndo = useCallback(async () => {
    if (!flash?.undo || busy) return;
    const id = flash.id;
    setBusy(true);
    setError("");
    const failure = await flash.undo();
    // 撤销（尤其 409 后的整库重读）可能要好几秒，这期间另一次写入已经换上了新的提示。
    // 结果只能落在自己那一条上：否则成功会顺手关掉新提示、失败理由会挂到别人的「已改为」下面。
    if (sequence.current !== id) {
      if (failure) onStaleFailure?.(failure);
      return;
    }
    setBusy(false);
    if (failure) setError(failure);
    else setFlash((current) => (current?.id === id ? null : current));
  }, [busy, flash, onStaleFailure]);

  return { flash, busy, error, show, dismiss, runUndo };
}

export type UndoFlashState = ReturnType<typeof useUndoFlash>;

export function UndoFlashBar({ state }: { state: UndoFlashState }) {
  const { flash, busy, error, runUndo, dismiss } = state;
  if (!flash) return null;
  return (
    <div className="undo-flash" role="status" aria-live="polite">
      <span>{flash.message}</span>
      {flash.undo && (
        <button type="button" className="undo-flash-action" disabled={busy} onClick={() => void runUndo()}>
          {busy ? "撤销中…" : UNDO_LABEL}
        </button>
      )}
      {error && <em role="alert">{error}</em>}
      <button type="button" className="undo-flash-close" aria-label="关闭提示" onClick={dismiss}>×</button>
    </div>
  );
}
