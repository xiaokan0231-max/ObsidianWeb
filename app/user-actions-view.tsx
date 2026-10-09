"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ConflictError, postJson } from "@/lib/client-api";
import { getString, getTitle, type Note } from "@/lib/notes";
import { jobPosition } from "@/lib/jobs";
import { explicitNoteLink } from "@/lib/wiki-target";
import { buildUserActions, type ActionOwner, type UserActionCategory, type UserActionItem } from "@/lib/user-actions";
import { useUiLocale } from "./ui-locale";
import { URL_CHANGE_EVENT } from "./use-url-state";
import { userActionsHref, userActionsListPosition, userActionsRoute, type UserActionsListPosition, type UserActionsRoute } from "./user-actions-route";
import "./styles/progress-tones.css";
import "./styles/user-actions.css";

const zh = {
  title: "需要你处理", kicker: "行动与记录", currentCount: "当前已确认的本人动作",
  introduction: "这里只列出证据已审核、当前需要你亲自处理的具体事项。打开记录不会改变状态。",
  freshness: "资料读取时间", notLoaded: "尚未读取本页资料", loading: "正在读取行动与来源记录…", refreshing: "正在更新资料…",
  coverage: "资料读取时间不等于邮箱或招聘网站的最新核实时间。",
  current: "当前需要处理", review: "待核实", waiting: "等待对方", system: "AI / 系统事项", optional: "可选事项", history: "处理历史",
  currentDescription: "已核实的必要动作。处理后可在这里留下本地记录。",
  reviewDescription: "证据、关联案件或责任归属尚待核实，暂不计入当前动作。",
  waitingDescription: "下一步由对方推进，保留等待记录。", systemDescription: "由 AI 或系统推进的事项，单独查看。",
  optionalDescription: "可自行选择是否考虑，未列为当前必要动作。", historyDescription: "保留已处理与不再处理的记录，两者分开标明。",
  reviewNotice: "条记录仍待核实", openReview: "查看待核实记录", reviewNotCurrent: "待核实不等于你必须马上处理，也不计入上方数字。",
  emptyCurrent: "目前已核实的资料中，没有列入当前列表的本人动作。", emptyCurrentReview: "仍有待核实记录，不能据此认定全部事项已经确认。",
  emptyOther: "本分类暂无记录。", unavailableCompany: "公司未注明", unavailablePosition: "岗位未注明",
  why: "为什么需要处理", whyMissing: "依据尚未注明，请查看原始记录。", due: "官方期限", noDue: "未提供明确期限",
  dueText: "原文相对期限", overdue: "已过所列期限，请先核对是否仍有效", dueToday: "今天截止", suggested: "建议处理日（仅建议）",
  owner: "下一步由谁处理", ownerMissing: "尚待确认", user: "本人", ai: "AI", company: "企业 / 对方", agent: "中介 / 对方", systemOwner: "系统",
  source: "依据与原文", sourceMissing: "未提供可打开的来源，请查看原 TODO。", sourceNotLoaded: "来源笔记未载入", unsafeSource: "来源地址不可直接打开",
  openTodo: "打开原 TODO", openCase: "打开关联案件", noCase: "未确认精确关联案件", sourceNote: "打开来源笔记", externalSource: "打开来源原文",
  complete: "记录已处理", cancel: "不再处理", confirmComplete: "确认记录已处理", confirmCancel: "确认记录不再处理", back: "返回，不记录",
  confirmCompleteTitle: "核对后记录为已处理", confirmCancelTitle: "核对后记录为不再处理",
  localOnly: "这只更新本地行动记录，不会提交外部申请、发送消息、签署文件或作出授权。",
  completeMeaning: "仅在实际动作已经完成后记录。记录会保留在处理历史中。",
  cancelMeaning: "记录停止处理的原因，并移入历史；不会记为已完成。",
  noteLabel: "处理说明（必填，单行，最多 500 字）", notePlaceholder: "简要说明做了什么，或为什么不再处理；可附核实依据。", noteRequired: "请填写 500 字以内的单行处理说明。",
  saving: "正在保存本地记录…", failed: "本地记录未保存，请核对后重试。", conflict: "笔记已被更新。请重新读取页面，核对最新记录后再操作。",
  missingMtime: "笔记版本信息缺失，请重新读取页面后再记录。", invalidResponse: "未收到已保存的笔记，暂不能确认记录成功。",
  completed: "已处理", cancelled: "不再处理", historyRecord: "历史记录", savedComplete: "已记录为已处理，可在处理历史查看。", savedCancel: "已记录为不再处理，历史保留且不计为完成。",
  tabs: "行动分类", records: "行动记录", resolutionNote: "处理说明", recordedAt: "记录时间", platform: "平台 / 对方",
  reviewReasons: "待核实原因", unknownIssue: "审核字段需要核实", updateRecord: "更新本地记录", expired: "已失效", rejected: "关联案件已结束",
  backToList: "返回事项列表", detail: "事项详情", viewDetail: "查看详情", required: "需本人处理", instructions: "操作与记录说明",
  notFound: "当前已载入的资料中未找到这条事项。它可能已移动，或不在本页读取范围内。", detailNotice: "查看详情不会完成事项，也不代表批准任何外部操作。",
  dataScope: "资料时间与显示范围",
  reviewTitle: "需要核实的事项", reviewWhy: "为什么暂列待核", reviewExplanation: "核实说明", reviewUnconfirmed: "仍待确认", reviewKindUnconfirmed: "原记录仍标记为待核，尚未确认当前是否仍需执行。",
  reviewChineseMissing: "尚无可用中文说明，请先核实原记录；不因此认定为本人必办。",
  reviewOwner: "原记录责任方", reviewOwnerCaution: "原记录的责任方不等于当前已确认的执行义务。", reviewNext: "下一步", reviewNextOwner: "原记录的下一步责任方", reviewNextUnknown: "下一步责任方仍待确认", reviewNextPending: "当前需求及是否已处理仍待确认；确认前保留在待核区。",
  reviewOriginal: "原始事项（尚未确认仍需执行）", reviewOriginalNotice: "以下保留原记录表述，不是新增指示，也不代表已确认仍需由本人执行。", originalAction: "原动作表述", originalTitle: "原记录标题", originalReason: "原核实说明", originalPosition: "原岗位表述", originalActionMissing: "原记录未填写动作",
};

const ja: typeof zh = {
  title: "あなたの対応が必要", kicker: "対応と記録", currentCount: "確認済みの本人対応",
  introduction: "根拠を確認し、現在あなた自身の対応が必要な具体的な事項を表示します。記録を開いても状態は変わりません。",
  freshness: "データ読込時刻", notLoaded: "このページのデータは未読込です", loading: "対応事項と根拠を読み込んでいます…", refreshing: "データを更新しています…",
  coverage: "データ読込時刻は、メールや求人サイトを最後に確認した時刻とは異なります。",
  current: "現在の対応", review: "確認が必要", waiting: "相手の対応待ち", system: "AI / システム", optional: "任意の事項", history: "対応履歴",
  currentDescription: "必要性を確認済みの対応です。実際に対応した後、ローカルに記録できます。",
  reviewDescription: "根拠、関連案件、対応者などが未確認のため、現在の対応件数には含めていません。",
  waitingDescription: "次は相手が進める事項です。待機中の記録を残します。", systemDescription: "AI またはシステムが進める事項を別に表示します。",
  optionalDescription: "検討するかどうかは任意です。現在必要な対応には含めていません。", historyDescription: "対応済みと対応中止の記録を、区別して残します。",
  reviewNotice: "件の記録に確認が必要です", openReview: "未確認の記録を見る", reviewNotCurrent: "未確認は即時対応の指示ではありません。上の件数には含めていません。",
  emptyCurrent: "確認済みの資料では、現在の本人対応に分類された事項はありません。", emptyCurrentReview: "未確認の記録が残っているため、すべて確認済みとは限りません。",
  emptyOther: "この分類には記録がありません。", unavailableCompany: "会社の記載なし", unavailablePosition: "職種の記載なし",
  why: "対応が必要な理由", whyMissing: "根拠の記載がありません。元の記録をご確認ください。", due: "先方が指定した期限", noDue: "明確な期限の記載なし",
  dueText: "原文の相対期限", overdue: "記載の期限を過ぎています。有効か先にご確認ください", dueToday: "本日が期限", suggested: "推奨対応日（提案のみ）",
  owner: "次に対応する人", ownerMissing: "未確認", user: "本人", ai: "AI", company: "企業 / 相手", agent: "エージェント / 相手", systemOwner: "システム",
  source: "根拠と原文", sourceMissing: "開ける出典がありません。元の TODO をご確認ください。", sourceNotLoaded: "出典ノートは未読込です", unsafeSource: "直接開けない出典アドレス",
  openTodo: "元の TODO を開く", openCase: "関連案件を開く", noCase: "対応する案件は未確認です", sourceNote: "出典ノートを開く", externalSource: "出典の原文を開く",
  complete: "対応済みと記録", cancel: "対応を中止する", confirmComplete: "確認して対応済みと記録", confirmCancel: "確認して対応中止と記録", back: "戻る（記録しない）",
  confirmCompleteTitle: "確認して対応済みにする", confirmCancelTitle: "確認して対応中止にする",
  localOnly: "ローカルの対応記録だけを更新します。外部への応募、メッセージ送信、署名、同意や権限付与は行いません。",
  completeMeaning: "実際の対応が完了している場合に記録してください。対応履歴に残ります。",
  cancelMeaning: "対応を中止する理由を記録し、履歴に移します。完了としては扱いません。",
  noteLabel: "対応の説明（必須・1 行・500 文字以内）", notePlaceholder: "実施したこと、または中止する理由を簡潔に記入してください。確認した根拠も記載できます。", noteRequired: "500 文字以内、1 行で対応の説明を記入してください。",
  saving: "ローカルの記録を保存しています…", failed: "ローカルの記録を保存できませんでした。確認してから再試行してください。", conflict: "ノートが更新されています。ページを読み直し、最新の記録を確認してから操作してください。",
  missingMtime: "ノートの版情報がありません。ページを読み直してから記録してください。", invalidResponse: "保存後のノートを取得できず、記録の成功を確認できません。",
  completed: "対応済み", cancelled: "対応中止", historyRecord: "過去の記録", savedComplete: "対応済みと記録しました。対応履歴で確認できます。", savedCancel: "対応中止と記録しました。履歴を残し、完了とは区別します。",
  tabs: "対応の分類", records: "対応記録", resolutionNote: "対応の説明", recordedAt: "記録日時", platform: "プラットフォーム / 相手",
  reviewReasons: "確認が必要な理由", unknownIssue: "確認項目の点検が必要です", updateRecord: "ローカルの記録を更新", expired: "有効期間終了", rejected: "関連案件は終了しています",
  backToList: "事項一覧に戻る", detail: "事項の詳細", viewDetail: "詳細を見る", required: "本人の対応が必要", instructions: "操作と記録の説明",
  notFound: "読み込んだ資料にこの事項が見つかりません。移動済み、またはこのページの読込範囲外の可能性があります。", detailNotice: "詳細を開いても対応完了にはならず、外部操作への承認にもなりません。",
  dataScope: "資料の時刻と表示範囲",
  reviewTitle: "確認が必要な事項", reviewWhy: "未確認に分類した理由", reviewExplanation: "確認に関する説明", reviewUnconfirmed: "未確認の項目", reviewKindUnconfirmed: "元の記録は未確認のままで、現在も対応が必要かは確認できていません。",
  reviewChineseMissing: "利用できる中国語の説明がありません。元の記録は未確認で、本人の必須対応とは判断しません。",
  reviewOwner: "元の記録の対応者", reviewOwnerCaution: "元の記録の対応者は、現在の対応義務を意味しません。", reviewNext: "次の段階", reviewNextOwner: "元の記録の次の対応者", reviewNextUnknown: "次の対応者は未確認です", reviewNextPending: "現在の必要性と対応済みかが未確認のため、確認待ちに残します。",
  reviewOriginal: "元の事項（現在の必要性は未確認）", reviewOriginalNotice: "元の記録の表現です。新しい指示ではなく、本人の対応義務が確認されたことも意味しません。", originalAction: "元の対応内容", originalTitle: "元の記録の見出し", originalReason: "元の確認説明", originalPosition: "元の職種表記", originalActionMissing: "元の記録に対応内容の記載なし",
};

type Props = {
  notes: Note[];
  today: string;
  loading: boolean;
  fetchedAt: number | null;
  onOpen: (note: Note) => void;
  onNoteWritten: (note: Note) => void;
};

function safeExternalHref(value: string) {
  if (/\s/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

const issueLabels: Record<string, [string, string]> = {
  "invalid-today": ["今日日期无法确认", "本日の日付を確認できません"],
  "invalid-status": ["TODO 状态需要核实", "TODO の状態を確認してください"],
  "missing-action-owner": ["尚未确认责任人", "対応者が未確認です"],
  "invalid-action-owner": ["责任人字段需要核实", "対応者の記載を確認してください"],
  "missing-action-kind": ["尚未确认事项性质", "事項の種類が未確認です"],
  "invalid-action-kind": ["事项性质需要核实", "事項の種類を確認してください"],
  "missing-action-reviewed-at": ["尚无证据审核日期", "根拠の確認日がありません"],
  "invalid-action-reviewed-at": ["证据审核日期需要核实", "根拠の確認日を点検してください"],
  "future-action-reviewed-at": ["审核日期晚于今天", "根拠の確認日が未来になっています"],
  "missing-action": ["尚未明确具体动作", "具体的な対応が未確認です"],
  "missing-action-reason": ["尚未注明必要性依据", "必要性の根拠がありません"],
  "missing-action-source": ["尚未提供来源", "出典がありません"],
  "missing-case": ["未找到所指案件", "指定された案件が見つかりません"],
  "ambiguous-case-id": ["存在多个同号案件，不能确定关联", "同じ識別子の案件が複数あり、関連を特定できません"],
  "invalid-case-id": ["关联案件标识需要核实", "関連案件の識別子を確認してください"],
  "invalid-case-status": ["关联案件状态需要核实", "関連案件の状態を確認してください"],
  "invalid-due": ["官方期限需要核实", "先方指定の期限を確認してください"],
  "invalid-suggested-due": ["建议日期需要核实", "推奨対応日を確認してください"],
  "invalid-expires-at": ["失效日期需要核实", "有効期間を確認してください"],
  "expiry-before-due": ["失效日期早于期限，需要核实", "有効期間が期限より前のため確認が必要です"],
  "invalid-action-next-owner": ["下一步责任人需要核实", "次の対応者を確認してください"],
};

function ownerLabel(owner: ActionOwner | null, copy: typeof zh) {
  const labels: Record<ActionOwner, string> = { user: copy.user, ai: copy.ai, system: copy.systemOwner, company: copy.company, agent: copy.agent, platform: copy.platform };
  return owner ? labels[owner] : copy.ownerMissing;
}

/** 这里只认已有说明中的明确简体特征，不做翻译，也不因含日文引用而丢弃整段中文。 */
function chineseReviewExplanation(item: UserActionItem) {
  return /[这该仅为还过从个们须务录确实说发对让处经]/u.test(item.reason) ? item.reason : "";
}

function ActionSource({ source, notes, onOpen, copy }: { source: string; notes: Note[]; onOpen: Props["onOpen"]; copy: typeof zh }) {
  if (!source) return <span className="user-action-source-unavailable">{copy.sourceMissing}</span>;
  const href = safeExternalHref(source);
  const target = !href ? explicitNoteLink(source) : null;
  // 来源只按完整路径打开；同名笔记与公司名不能替代证据的精确关联。
  const matches = target ? notes.filter((note) => note.path === target.path) : [];
  const note = matches.length === 1 ? matches[0] : null;
  return (
    <div>
      <span>{source}</span>
      <ul className="user-action-sources">
        {href ? <li><a href={href} target="_blank" rel="noopener noreferrer">{copy.externalSource} ↗</a></li>
          : note ? <li><button type="button" onClick={() => onOpen(note)}>{copy.sourceNote}</button></li>
            : <li className="user-action-source-unavailable">{target ? copy.sourceNotLoaded : copy.unsafeSource}</li>}
      </ul>
    </div>
  );
}

type Resolution = "completed" | "cancelled";

export function UserActionCard({ item, notes, today, onOpen, onNoteWritten, onRecorded }: {
  item: UserActionItem;
  notes: Note[];
  today: string;
  onOpen: Props["onOpen"];
  onNoteWritten: Props["onNoteWritten"];
  onRecorded?: (message: string) => void;
}) {
  const { locale } = useUiLocale();
  const copy = locale === "ja" ? ja : zh;
  const [pending, setPending] = useState<{ resolution: Resolution; expectedMtime: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [recorded, setRecorded] = useState("");
  const fm = item.note.frontmatter;
  const company = getString(item.caseNote?.frontmatter.company) || getString(fm.company) || copy.unavailableCompany;
  const position = (item.caseNote ? jobPosition(item.caseNote) : getString(fm.position)) || copy.unavailablePosition;
  const chineseReview = locale !== "ja" && item.category === "review";
  const reviewExplanation = chineseReview ? chineseReviewExplanation(item) : "";
  const title = chineseReview ? copy.reviewTitle : item.action || getTitle(item.note);
  const resolution = getString(fm.action_resolution);
  const historyLabel = resolution === "cancelled" ? copy.cancelled
    : resolution === "completed" || getString(fm.status) === "完了" ? copy.completed
      : item.reasonCode === "expired" ? copy.expired : item.reasonCode === "case-rejected" ? copy.rejected : copy.historyRecord;
  const begin = (next: Resolution) => {
    if (savingRef.current) return;
    setPending({ resolution: next, expectedMtime: item.note.stat.mtime });
    setDraft("");
    setError("");
    setRecorded("");
  };
  const save = async () => {
    if (!pending || savingRef.current) return;
    if (!draft.trim() || draft.trim().length > 500 || /[\r\n]/.test(draft)) { setError(copy.noteRequired); return; }
    if (item.category !== "current") return;
    if (!Number.isFinite(pending.expectedMtime) || pending.expectedMtime <= 0) { setError(copy.missingMtime); return; }
    if (pending.expectedMtime !== item.note.stat.mtime) { setError(copy.conflict); return; }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await postJson<{ ok?: boolean; note?: Note; error?: string }>("/api/todos/status", {
        path: item.note.path,
        resolution: pending.resolution,
        resolutionNote: draft.trim(),
        expectedMtime: pending.expectedMtime,
      });
      if (!result.note || result.note.path !== item.note.path || !result.note.frontmatter || !result.note.stat) throw new Error(copy.invalidResponse);
      const message = pending.resolution === "completed" ? copy.savedComplete : copy.savedCancel;
      onNoteWritten(result.note);
      setPending(null);
      setDraft("");
      setRecorded(message);
      onRecorded?.(message);
    } catch (cause) {
      setError(cause instanceof ConflictError ? copy.conflict : `${copy.failed}${cause instanceof Error ? ` ${cause.message}` : ""}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const controls = <div className="user-action-buttons">
    <button type="button" disabled={saving} onClick={() => begin("completed")}>{copy.complete}</button>
    <button type="button" disabled={saving} onClick={() => begin("cancelled")}>{copy.cancel}</button>
  </div>;

  return (
    <article className="user-action-card" data-action-category={item.category} data-tone={actionTone(item, today)}>
      <header>
        <div className="user-action-identity"><strong>{company}</strong>{!chineseReview && <span>{position}</span>}<span className="user-action-list-status"><span aria-hidden="true">{actionToneIcon(actionTone(item, today))}</span>{actionStatus(item, copy)}</span></div>
        <h3>{title}</h3>
      </header>
      {chineseReview && <p className="user-action-review-introduction"><strong>{copy.reviewWhy}</strong>{copy.reviewDescription}</p>}
      <dl className="user-action-details">
        <div className={chineseReview ? "user-action-review-explanation" : undefined}><dt>{chineseReview ? copy.reviewExplanation : copy.why}</dt><dd>{chineseReview ? reviewExplanation || copy.reviewChineseMissing : item.reason || copy.whyMissing}</dd></div>
        <div><dt>{copy.due}</dt><dd>
          {item.due ? <time dateTime={item.due}>{item.due}</time> : item.dueText ? <><span>{copy.dueText}：</span>{item.dueText}</> : copy.noDue}
          {item.due && item.dueText && <div>{copy.dueText}：{item.dueText}</div>}
          {actionHasDeadlineRisk(item, today) && <div className="user-action-overdue" data-tone="urgent"><span aria-hidden="true">! </span>{item.due < today ? copy.overdue : copy.dueToday}</div>}
          {item.suggestedDue && <div className="user-action-suggestion">{copy.suggested}：<time dateTime={item.suggestedDue}>{item.suggestedDue}</time></div>}
        </dd></div>
        <div><dt>{chineseReview ? copy.reviewNext : copy.owner}</dt><dd>{chineseReview ? <>{item.nextOwner ? `${copy.reviewNextOwner}：${ownerLabel(item.nextOwner, copy)}` : copy.reviewNextUnknown}<div>{copy.reviewNextPending}</div></> : ownerLabel(item.nextOwner, copy)}</dd></div>
        {chineseReview && <div><dt>{copy.reviewOwner}</dt><dd>{ownerLabel(item.owner, copy)}<div className="user-action-footnote">{copy.reviewOwnerCaution}</div></dd></div>}
        {item.category === "review" && <div><dt>{chineseReview ? copy.reviewUnconfirmed : copy.reviewReasons}</dt><dd>
          {item.issues.length ? [...new Set(item.issues.map((issue) => issueLabels[issue]?.[locale === "ja" ? 1 : 0] || copy.unknownIssue))].join(locale === "ja" ? "。" : "；") : chineseReview ? copy.reviewKindUnconfirmed : copy.reviewDescription}
        </dd></div>}
      </dl>
      <details className="user-action-disclosure">
        <summary>{copy.source}</summary>
        <div className="user-action-disclosure-body">
          {chineseReview && <section className="user-action-review-original" aria-label={copy.reviewOriginal}>
            <h4>{copy.reviewOriginal}</h4><p className="user-action-footnote">{copy.reviewOriginalNotice}</p>
            <dl className="user-action-details"><div><dt>{copy.originalAction}</dt><dd>{item.action || copy.originalActionMissing}</dd></div><div><dt>{copy.originalTitle}</dt><dd>{getTitle(item.note)}</dd></div>
              {!reviewExplanation && item.reason && <div className="user-action-review-explanation"><dt>{copy.originalReason}</dt><dd>{item.reason}</dd></div>}
              <div><dt>{copy.originalPosition}</dt><dd>{position}</dd></div>
            </dl>
          </section>}
          <ActionSource source={item.source} notes={notes} onOpen={onOpen} copy={copy} />
          <div className="user-action-links">
            <button type="button" onClick={() => onOpen(item.note)}>{copy.openTodo}</button>
            {item.caseNote ? <button type="button" onClick={() => onOpen(item.caseNote!)}>{copy.openCase}</button> : <span className="user-action-footnote">{copy.noCase}</span>}
          </div>
        </div>
      </details>
      {item.category === "history" ? <div className="user-action-history">
        <strong>{historyLabel}</strong>
        {getString(fm.action_resolved_at) && <div>{copy.recordedAt}：{getString(fm.action_resolved_at)}</div>}
        {getString(fm.action_resolution_note) && <div>{copy.resolutionNote}：{getString(fm.action_resolution_note)}</div>}
      </div> : item.category === "current" && <details className="user-action-disclosure">
        <summary>{copy.instructions}</summary>
        <div className="user-action-disclosure-body"><p className="user-action-footnote">{copy.localOnly}</p><p className="user-action-footnote">{copy.completeMeaning}</p>{!pending && controls}</div>
      </details>}
      {pending && item.category === "current" && <section className="user-action-confirm" aria-label={pending.resolution === "completed" ? copy.confirmCompleteTitle : copy.confirmCancelTitle}>
        <h4>{pending.resolution === "completed" ? copy.confirmCompleteTitle : copy.confirmCancelTitle}</h4>
        <p>{copy.localOnly}</p>
        <p>{pending.resolution === "completed" ? copy.completeMeaning : copy.cancelMeaning}</p>
        <label>{copy.noteLabel}<input type="text" maxLength={500} value={draft} disabled={saving} placeholder={copy.notePlaceholder} onChange={(event) => setDraft(event.target.value)} /></label>
        <div className="user-action-buttons">
          <button className="user-action-confirm-submit" type="button" disabled={saving || !draft.trim()} onClick={() => { void save(); }}>{saving ? copy.saving : pending.resolution === "completed" ? copy.confirmComplete : copy.confirmCancel}</button>
          <button type="button" disabled={saving} onClick={() => { setPending(null); setError(""); }}>{copy.back}</button>
        </div>
      </section>}
      {error && <p className="user-action-error" role="alert">{error}</p>}
      {recorded && <p className="user-action-footnote" role="status">{recorded}</p>}
    </article>
  );
}

const categoryOrder: UserActionCategory[] = ["current", "review", "waiting", "system", "optional", "history"];

type ActionTone = "action" | "urgent" | "positive" | "info" | "neutral" | "muted";

function actionHasDeadlineRisk(item: UserActionItem, today: string) {
  return Boolean(item.due && item.due <= today && item.category !== "history");
}

function actionTone(item: UserActionItem, today: string): ActionTone {
  if (item.category === "current") return actionHasDeadlineRisk(item, today) ? "urgent" : "action";
  if (item.category === "history") {
    const resolution = getString(item.note.frontmatter.action_resolution);
    return resolution !== "cancelled" && (resolution === "completed" || getString(item.note.frontmatter.status) === "完了") ? "positive" : "muted";
  }
  return item.category === "system" ? "info" : item.category === "optional" ? "muted" : "neutral";
}

function actionToneIcon(tone: ActionTone) {
  return ({ action: "→", urgent: "!", positive: "✓", info: "i", neutral: "…", muted: "—" })[tone];
}

function actionStatus(item: UserActionItem, copy: typeof zh) {
  if (item.category !== "history") return item.category === "current" ? copy.required : copy[item.category];
  const resolution = getString(item.note.frontmatter.action_resolution);
  return resolution === "cancelled" ? copy.cancelled : resolution === "completed" || getString(item.note.frontmatter.status) === "完了"
    ? copy.completed : item.reasonCode === "expired" ? copy.expired : item.reasonCode === "case-rejected" ? copy.rejected : copy.historyRecord;
}

function actionRowId(path: string) { return `user-action-${encodeURIComponent(path)}`; }

export function UserActionListRow({ item, category, today, copy, onSelect }: {
  item: UserActionItem; category: UserActionCategory; today: string; copy: typeof zh;
  onSelect: (event: MouseEvent<HTMLAnchorElement>, item: UserActionItem) => void;
}) {
  const company = getString(item.caseNote?.frontmatter.company) || getString(item.note.frontmatter.company) || copy.unavailableCompany;
  const tone = actionTone(item, today);
  const chineseReview = copy === zh && item.category === "review";
  const title = chineseReview ? chineseReviewExplanation(item) || copy.reviewChineseMissing : item.action || getTitle(item.note);
  return <li data-action-category={item.category}>
    <a className="user-action-list-row" id={actionRowId(item.note.path)} data-tone={tone} href={userActionsHref({ category, actionPath: item.note.path })} onClick={(event) => onSelect(event, item)}>
      <div className="user-action-list-content"><div className="user-action-list-identity"><strong>{company}</strong><span className="user-action-list-status"><span aria-hidden="true">{actionToneIcon(tone)}</span>{actionStatus(item, copy)}</span></div><span className={`user-action-list-title${chineseReview ? " user-action-review-summary" : ""}`}>{title}</span></div>
      <div className="user-action-list-due">{item.due || item.dueText ? <><span>{item.due ? copy.due : copy.dueText}</span>{item.due ? <time dateTime={item.due}>{item.due}</time> : <strong>{item.dueText}</strong>}{actionHasDeadlineRisk(item, today) && <span className="user-action-overdue" data-tone="urgent"><span aria-hidden="true">! </span>{item.due < today ? copy.overdue : copy.dueToday}</span>}</> : <span>{copy.noDue}</span>}</div>
      <span className="user-action-list-arrow" aria-label={copy.viewDetail}>→</span>
    </a>
  </li>;
}

export default function UserActionsView({ notes, today, loading, fetchedAt, onOpen, onNoteWritten }: Props) {
  const { locale } = useUiLocale();
  const copy = locale === "ja" ? ja : zh;
  const groups = useMemo(() => buildUserActions(notes, today), [notes, today]);
  const [route, setRoute] = useState<UserActionsRoute>(() => userActionsRoute(typeof window === "undefined" ? "" : window.location.search));
  const [message, setMessage] = useState("");
  const listRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const pendingNavigation = useRef<{ kind: "detail" } | { kind: "list"; position: UserActionsListPosition | null } | null>(route.actionPath ? { kind: "detail" } : null);
  const descriptions: Record<UserActionCategory, string> = {
    current: copy.currentDescription, waiting: copy.waitingDescription, system: copy.systemDescription,
    optional: copy.optionalDescription, history: copy.historyDescription, review: copy.reviewDescription,
  };
  const loaded = fetchedAt !== null && Number.isFinite(fetchedAt);
  const { category, actionPath } = route;
  const items = groups[category];
  const selected = actionPath ? categoryOrder.flatMap((key) => groups[key]).find((item) => item.note.path === actionPath) : null;

  useEffect(() => {
    const syncFromUrl = () => {
      if (window.location.pathname.replace(/\/+$/, "") !== "/actions") return;
      const next = userActionsRoute(window.location.search);
      if (next.actionPath === actionPath && next.category === category) return;
      pendingNavigation.current = next.actionPath ? { kind: "detail" } : { kind: "list", position: userActionsListPosition(window.history.state) };
      setRoute(next);
    };
    window.addEventListener("popstate", syncFromUrl);
    window.addEventListener(URL_CHANGE_EVENT, syncFromUrl);
    return () => { window.removeEventListener("popstate", syncFromUrl); window.removeEventListener(URL_CHANGE_EVENT, syncFromUrl); };
  }, [actionPath, category]);

  useEffect(() => {
    if (!loaded || !pendingNavigation.current) return;
    const pending = pendingNavigation.current;
    pendingNavigation.current = null;
    const restore = () => {
      if (pending.kind === "detail") {
        detailRef.current?.focus({ preventScroll: true });
        window.scrollTo({ left: 0, top: 0, behavior: "instant" });
      } else {
        const position = pending.position?.category === category ? pending.position : null;
        const target = position ? document.getElementById(actionRowId(position.path)) : null;
        (target || listRef.current)?.focus({ preventScroll: true });
        window.scrollTo({ left: 0, top: position?.scrollY ?? 0, behavior: "instant" });
      }
    };
    restore();
    // 浏览器会在 popstate 后自行恢复滚动；等本页 DOM 落定再还原记录的位置。
    const timer = window.setTimeout(restore, 0);
    return () => window.clearTimeout(timer);
  }, [route, loaded, category]);

  const selectCategory = (next: UserActionCategory) => {
    const nextRoute = { category: next, actionPath: null };
    if (typeof window !== "undefined") {
      window.history.replaceState({ ...(window.history.state ?? {}), __echoActionsList: null, __echoActionDetail: null }, "", userActionsHref(nextRoute));
    }
    setRoute(nextRoute);
  };
  const openDetail = (event: MouseEvent<HTMLAnchorElement>, item: UserActionItem) => {
    // 保留链接本身的打开新页、复制地址和键盘语义。
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const position = { category, path: item.note.path, scrollY: window.scrollY };
    window.history.replaceState({ ...(window.history.state ?? {}), __echoActionsList: position }, "");
    const nextRoute = { category, actionPath: item.note.path };
    window.history.pushState({ ...(window.history.state ?? {}), __echoActionDetail: item.note.path }, "", userActionsHref(nextRoute));
    pendingNavigation.current = { kind: "detail" };
    setRoute(nextRoute);
  };
  const backToList = () => {
    const position = userActionsListPosition(window.history.state);
    if (window.history.state?.__echoActionDetail === actionPath && position) { window.history.back(); return; }
    // 分享链接可能从站外打开；返回按钮始终回本列表，不能把用户带离网站。
    const nextRoute = { category, actionPath: null };
    window.history.replaceState({ ...(window.history.state ?? {}), __echoActionDetail: null }, "", userActionsHref(nextRoute));
    pendingNavigation.current = { kind: "list", position };
    setRoute(nextRoute);
  };

  return (
    <section className="user-actions-view" aria-label={copy.title}>
      <header className="user-actions-header">
        <div><span className="user-actions-kicker">{copy.kicker}</span><h1>{copy.title}</h1>
          <details className="user-actions-data-scope"><summary>{copy.dataScope}</summary><p>{copy.introduction}</p>
          <div className="user-actions-freshness">{loaded ? <>{copy.freshness}：<time dateTime={new Date(fetchedAt!).toISOString()}>{new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(fetchedAt!)} JST</time></> : copy.notLoaded}</div>
          <div className="user-actions-freshness">{copy.coverage}</div>
          </details>
        </div>
        <div className="user-actions-count" data-tone={loaded && groups.current.length ? "action" : "neutral"} aria-label={copy.currentCount}><strong>{loaded ? groups.current.length : "—"}</strong><span>{copy.currentCount}</span></div>
      </header>
      {message && <p role="status">{message}</p>}
      {loading && <p role="status">{loaded ? copy.refreshing : copy.loading}</p>}
      {loaded && <>
        {actionPath ? <div className="user-action-detail-view" ref={detailRef} tabIndex={-1} aria-label={copy.detail}>
          <div className="user-action-detail-toolbar"><button type="button" onClick={backToList}>← {copy.backToList}</button><span>{selected ? copy[selected.category] : copy.detail}</span></div>
          <p className="user-action-footnote">{copy.detailNotice}</p>
          {selected ? <UserActionCard key={selected.note.path} item={selected} notes={notes} today={today} onOpen={onOpen} onNoteWritten={onNoteWritten} onRecorded={setMessage} /> : <p className="user-actions-empty" role="status">{copy.notFound}</p>}
        </div> : <>
        {groups.review.length > 0 && <aside className="user-actions-review-notice" data-tone="neutral">
          <div><strong>{groups.review.length} {copy.reviewNotice}</strong><p>{copy.reviewNotCurrent}</p></div>
          <button type="button" onClick={() => selectCategory("review")}>{copy.openReview}</button>
        </aside>}
        <nav className="user-actions-tabs" aria-label={copy.tabs}>
          {categoryOrder.map((key) => <button key={key} type="button" data-tone={key === "current" ? "action" : key === "system" ? "info" : "neutral"} aria-pressed={key === category} aria-controls="user-actions-records" onClick={() => selectCategory(key)}>{copy[key]}<span>{groups[key].length}</span></button>)}
        </nav>
        <section id="user-actions-records" ref={listRef} tabIndex={-1} aria-label={copy.records}>
          <div className="user-actions-section-heading"><h2>{copy[category]}</h2><p>{descriptions[category]}</p></div>
          {items.length ? <ul className="user-actions-list">{items.map((item) => <UserActionListRow key={item.note.path} item={item} category={category} today={today} copy={copy} onSelect={openDetail} />)}</ul>
            : <div className="user-actions-empty">{category === "current" ? <>{copy.emptyCurrent}{groups.review.length > 0 && <p>{copy.emptyCurrentReview}</p>}</> : copy.emptyOther}</div>}
        </section>
        </>}
      </>}
    </section>
  );
}
