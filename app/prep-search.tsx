"use client";

import { useEffect, type ChangeEvent, type KeyboardEvent, type RefObject } from "react";

/**
 * ショートカットを握りつぶしてよいか＝いま文字を打っている最中か。
 *
 * 各画面が自前で書くと `instanceof HTMLInputElement` 止まりの弱い版になり、
 * contentEditable や <select> の上で数字キーやスラッシュを奪ってしまう。
 * 判定は強い方に一本化する——弱い側に合わせると、直したはずの画面がまた壊れる。
 */
export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * 「/」で検索欄へ飛ぶ。1節ずつしか描画しない画面ではブラウザの Ctrl+F が使えないので、
 * この一打鍵が実質の検索入口になる。
 *
 * Escape（消してフォーカスを外す）はここに入れない：window で拾うと、
 * 同じ画面の別の入力欄で Escape を押しただけで検索語が消える。
 * 消すのは検索欄自身の役目なので PrepSearchBox が持つ。
 */
export function useSlashFocus(searchRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent<Element> | globalThis.KeyboardEvent) => {
      if (event.key !== "/" || isTypingTarget(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown as EventListener);
    return () => window.removeEventListener("keydown", onKeyDown as EventListener);
  }, [searchRef]);
}

/**
 * 章節ビューの検索欄。3画面が別々に組んでいて、消去ボタンの記号が
 * 「×」と「✕」に割れ、回答库の欄には消去ボタン自体が無かった。
 * 見た目の話に見えて、実際は「消せると気づけるか」が画面ごとに違っていた。
 */
export function PrepSearchBox({
  value,
  onChange,
  placeholder,
  label,
  inputRef,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** 画面ごとの配置は各自の CSS が持つ。中身の構造だけをここで揃える。 */
  className?: string;
}) {
  return (
    <label className={className}>
      <span aria-hidden="true">⌕</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key !== "Escape") return;
          // 上位のショートカット（一覧へ戻る等）まで巻き込まないよう、ここで止める。
          event.stopPropagation();
          onChange("");
          event.currentTarget.blur();
        }}
        placeholder={placeholder}
        aria-label={label}
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="清除搜索">✕</button>
      )}
    </label>
  );
}
