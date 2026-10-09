"use client";

import { useCallback, useState } from "react";

/**
 * 「複製しました」の表示が消えるまで。
 * 画面ごとに書くと 1.5 秒と 1.6 秒に割れていた——直接の害は無いが、
 * 同じ操作の手応えが画面で違うのは、揃える理由としては十分。
 */
const COPY_FLASH_MS = 1600;

/**
 * コピー直後だけ印を出す。
 *
 * 消す時に「まだ自分の番か」を確かめるのが要点：確かめずに消すと、
 * 続けて別の項目をコピーした時に、先のタイマーが後の印を消してしまう。
 * 単一対象の画面でも同じ関数を使えるよう、対象は id で区別する。
 */
export function useCopyFlash() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const flash = useCallback((id: string) => {
    setCopiedId(id);
    window.setTimeout(
      () => setCopiedId((current) => (current === id ? null : current)),
      COPY_FLASH_MS,
    );
  }, []);
  return { copiedId, flash, clear: () => setCopiedId(null) };
}
