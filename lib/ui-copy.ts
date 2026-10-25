import type { UiLocale } from "./ui-locale.ts";

/** 只供明确的界面文案调用；插入的公司、标题和正文作为参数原样保留。 */
export function uiCopy(locale: UiLocale, messages: Readonly<Record<string, string>>) {
  return (text: string, values: Record<string, string | number> = {}) => {
    const key = text.trim();
    const translated = locale === "ja" ? messages[key] ?? key : key;
    const padded = text.slice(0, text.indexOf(key)) + translated + text.slice(text.indexOf(key) + key.length);
    return padded.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
  };
}
