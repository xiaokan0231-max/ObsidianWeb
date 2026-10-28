"use client";

import type { SelectionNotice } from "@/lib/selection-notice";
import "./selection-notice.css";

type Props = {
  notices: SelectionNotice[];
  locale: "zh" | "zh-CN" | "ja";
  rejected?: boolean;
  onOpenNote?: (path: string) => void;
};

const OUTCOME = {
  rejected: { zh: "不採用", ja: "不採用" },
  passed: { zh: "通过", ja: "通過" },
  offer: { zh: "内定", ja: "内定" },
  other: { zh: "选考通知", ja: "選考の通知" },
} as const;

export default function SelectionNoticePanel({ notices, locale, rejected = false, onOpenNote }: Props) {
  const t = (zh: string, ja: string) => locale === "ja" ? ja : zh;
  if (!notices.length && !rejected) return null;
  const rejectionMissing = rejected && !notices.some(notice => notice.outcome === "rejected");

  return <section className="selection-notice-panel" aria-label={t("选考结果与企业原文", "選考結果と企業からの原文")} lang={locale}>
    <header className="selection-notice-heading">
      <span className="selection-notice-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 4.5h14v15H5zM8 8h8M8 11.5h8M8 15h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      <div><h2>{t("选考结果与企业原文", "選考結果と企業からの原文")}</h2><p>{t("以下是同一应募案件的后续通知；面谈与通知的选考阶段可能不同。", "同じ応募案件に届いた、その後の通知です。面談と通知では、選考段階が異なる場合があります。")}</p></div>
    </header>
    {rejectionMissing && <div className="selection-notice-empty">
      <strong>{t("已记录不採用，通知原文尚未收录", "不採用の記録がありますが、通知の原文は未収録です")}</strong>
      <p>{t("目前只有结果记录，无法据此判断企业是否说明了原因。", "結果の記録だけでは、企業が理由を伝えたかどうかは判断できません。")}</p>
    </div>}
    {notices.length > 0 && <div className="selection-notice-list">{notices.map((notice, index) => {
      const outcome = OUTCOME[notice.outcome] ?? OUTCOME.other;
      const sourceUrl = notice.sourceUrl && /^https?:\/\//i.test(notice.sourceUrl) ? notice.sourceUrl : undefined;
      return <article className="selection-notice-item" key={notice.id}>
        <div className="selection-notice-meta">
          <span className="selection-notice-outcome" data-outcome={notice.outcome}>{outcome[locale === "ja" ? "ja" : "zh"]}</span>
          {notice.stage && <strong>{notice.stage}</strong>}
          <time dateTime={`${notice.date}${notice.time ? `T${notice.time}+09:00` : ""}`}>{notice.date}{notice.time ? ` ${notice.time}` : ""} JST</time>
          {notice.channel && <span>{notice.channel}</span>}
        </div>
        {notice.reasonStatus === "not-stated" && <p className="selection-notice-reason">{notice.capture === "excerpt" ? t("收录的原文节选未说明具体原因。", "収録した抜粋には、具体的な理由の記載がありません。") : t("这则通知未说明具体原因。", "この通知には、具体的な理由の記載がありません。")}</p>}
        {notice.reasonStatus === "explicit" && <p className="selection-notice-reason">{t("通知含具体说明，请结合原文讨论。", "通知に具体的な説明があります。原文を確認しながら相談できます。")}</p>}
        <details className="selection-notice-original" open={index === 0}>
          <summary><span>{t("企业通知原文", "企業から届いた原文")}</span><small>{notice.capture === "excerpt" ? t("原文节选", "原文の抜粋") : t("完整原文", "原文全文")}</small><span className="selection-notice-chevron" aria-hidden="true">⌄</span></summary>
          <blockquote>{notice.original}</blockquote>
          <p className="selection-notice-reading-note">{t("保留企业原有措辞；是否属于套话，可结合这次选考一起判断。", "企業が使った表現を確認できます。定型的な文面かどうかも、選考の経緯と合わせてお読みください。")}</p>
        </details>
        {(sourceUrl || onOpenNote && notice.sourcePath) && <div className="selection-notice-sources">
          {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">{t("查看来源 ↗", "通知の掲載元を開く ↗")}</a>}
          {onOpenNote && notice.sourcePath && <button type="button" onClick={() => onOpenNote(notice.sourcePath!)}>{t("打开原始记录", "元の記録を開く")}</button>}
        </div>}
      </article>;
    })}</div>}
  </section>;
}
