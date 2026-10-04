"use client";

import { useCallback, useState } from "react";
import {
  isJobStatus,
  jobStatusNoteError,
  JOB_STATUSES,
  JOB_STATUS_NOTE_MAX,
  KNOWN_CHANNELS,
  statusRequiresChannel,
  statusTone,
  type JobCard,
} from "@/lib/jobs";
import { ConflictError, postJson } from "@/lib/client-api";
import { noteBasename, type Note } from "@/lib/notes";
import { changedToLabel } from "@/lib/ui-labels";
import type { UndoAction } from "./undo-flash";
import { useJobMenu } from "./jobs-copy";

/** 决策台头部的快捷判断。「见送」也落到保留（没投过的岗位不能写不採用），但先让本人补一句理由。 */
const QUICK_DECISIONS = [
  { id: "applied", label: "投了", status: "応募済" },
  { id: "hold", label: "保留", status: "保留" },
  { id: "pass", label: "见送", status: "保留", withNote: true },
] as const;

/** source 表記は channel の語彙と少しずれる（RA だけ日英が逆）。一致した時だけ初期値にする。 */
function channelFromSource(source: string) {
  if ((KNOWN_CHANNELS as readonly string[]).includes(source)) return source;
  return source === "リクルートエージェント" ? "Recruit Agent" : "";
}

/**
 * 状態と**その理由**を1つの操作にまとめる。7 枚举だけでは「募集終了」「推薦不可」「取扱終了」が
 * 全部ただの `不採用` に潰れ、後から死因を追えなくなる（2026-07-30 ある案件の
 * 募集終了で表面化）。プルダウンは今までどおり1操作で確定し、理由は任意で足す形にしてある。
 */
export function StatusPicker({
  value,
  note,
  channel,
  sourceGuess,
  today,
  saving,
  expectedMtime,
  requestedStatus,
  quick = false,
  onChange,
}: {
  value: string;
  note: string;
  /** 打开时就摊开渠道选择（看板把缺 channel 的卡拖到応募済以降的列）。 */
  requestedStatus?: string;
  /** 决策台头部的「投了 / 保留 / 见送」。与下拉共用同一套渠道与注记流程，不另写一份。 */
  quick?: boolean;
  /** ノートの frontmatter `channel`。空なら応募記録なし＝応募済系へ変える時に選ばせる。 */
  channel: string;
  /** 求人の source。既知の渠道と一致すればセレクトの初期値に使う（Findy 起点なら Findy が既定）。 */
  sourceGuess: string;
  today: string;
  saving: boolean;
  /** 上一次已知的笔记 mtime：写入时带上，服务端不一致就 409。 */
  expectedMtime?: number;
  onChange: (
    status: string,
    note: string,
    channel?: string,
    expectedMtime?: number,
  ) => Promise<string | null>;
}) {
  const { t } = useJobMenu();
  const customValue = value && !isJobStatus(value) ? value : null;
  const needsChannel = (next: string) => statusRequiresChannel(next) && !channel;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // 注記エディタが保存時に使う状態。通常は今の状態だが、「见送」は保留へ変えつつ理由を書かせる。
  const [noteStatus, setNoteStatus] = useState<string | null>(null);
  // 応募済系を選んだが channel が無い：即座に拒否せず、ここに保留して渠道を選ばせる。
  const [pendingStatus, setPendingStatus] = useState<string | null>(
    () => (requestedStatus && needsChannel(requestedStatus) ? requestedStatus : null),
  );
  const [channelDraft, setChannelDraft] = useState(() => (requestedStatus ? channelFromSource(sourceGuess) : ""));
  const draftError = jobStatusNoteError(draft);

  const openEditor = (nextStatus: string | null = null, prefill?: string) => {
    // 既存注記があれば編集、無ければ vault 表記（日付が先頭）の書き出しを置いておく。
    // channel パネルとは排他：どちらの操作が進行中か読めなくなるので同時には開かない。
    setPendingStatus(null);
    setNoteStatus(nextStatus);
    setDraft(prefill ?? (note || `${today}・`));
    setEditing(true);
  };

  const submit = async () => {
    if (draftError) return;
    if (!(await onChange(noteStatus ?? value, draft, undefined, expectedMtime))) setEditing(false);
  };

  const pickStatus = (next: string) => {
    // channel 必須の状態（応募済〜不採用）へ、応募記録の無い案件を動かす時だけ渠道を聞く。
    // API はどのみち拒否するので、先に聞く方が「ボタンがあるのに使えない」を消せる。
    if (needsChannel(next)) {
      setEditing(false);
      setChannelDraft(channelFromSource(sourceGuess));
      setPendingStatus(next);
      return;
    }
    setPendingStatus(null);
    void onChange(next, "", undefined, expectedMtime);
  };

  const submitChannel = async () => {
    // Enter 連打での同一ノートへの並行 POST を塞ぐ（保存ボタンは disabled で守られている）。
    if (saving || !pendingStatus || !channelDraft) return;
    if (!(await onChange(pendingStatus, "", channelDraft, expectedMtime))) setPendingStatus(null);
  };

  return (
    <div className="job-status-control" onClick={(event) => event.stopPropagation()}>
      <div className="job-status-row">
        <label
          className={`job-status-picker tone-${statusTone(value)}${saving ? " saving" : ""}`}
          title={customValue ?? undefined}
        >
          <select
            value={value}
            disabled={saving}
            aria-label={t("应募状态")}
            onChange={(event) => pickStatus(event.target.value)}
          >
            {customValue && <option value={customValue}>{customValue}</option>}
            {JOB_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <span aria-hidden="true">{saving ? t("写入中…") : value}</span>
        </label>
        <button
          type="button"
          className={`job-status-note-toggle${note ? " filled" : ""}`}
          disabled={saving}
          aria-expanded={editing}
          title={note ? t("理由：{note}", { note }) : t("给这个状态补一句理由")}
          onClick={() => (editing ? setEditing(false) : openEditor())}
        >
          {note ? "✎" : "＋"}
        </button>
      </div>

      {/* 只在还没投的时候出：对面接中的案件按「投了」是倒退。 */}
      {quick && (value === "未応募" || customValue) && (
        <div className="job-quick-decisions" role="group" aria-label={t("快捷判断")}>
          {QUICK_DECISIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`job-quick-${item.id}`}
              disabled={saving}
              onClick={() => ("withNote" in item ? openEditor(item.status, `${today}・見送り`) : pickStatus(item.status))}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      )}

      {note && !editing && <p className="job-status-note">{note}</p>}

      {pendingStatus && (
        <div className="job-status-note-edit job-status-channel-edit">
          <select
            value={channelDraft}
            autoFocus
            aria-label={t("投递渠道")}
            onChange={(event) => setChannelDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); void submitChannel(); }
              // 途中破棄が抽屉ごと閉じる巻き添えにならないよう、Escape はここで止める。
              if (event.key === "Escape") { event.stopPropagation(); setPendingStatus(null); }
            }}
          >
            <option value="">{t("投递渠道…")}</option>
            {KNOWN_CHANNELS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <button type="button" disabled={saving || !channelDraft} onClick={() => void submitChannel()}>
            {t("保存")}
          </button>
          <button type="button" onClick={() => setPendingStatus(null)}>{t("取消")}</button>
          <small className="job-status-channel-hint">
            「{pendingStatus}」需要记下实际投递渠道（写入 channel，台帳按渠道统计到达率）。没投过就选「保留」并写理由。
          </small>
        </div>
      )}

      {editing && (
        <div className="job-status-note-edit">
          <input
            type="text"
            value={draft}
            autoFocus
            maxLength={JOB_STATUS_NOTE_MAX}
            placeholder={t("例：2026-07-30・募集終了で応募機会なし")}
            aria-label={t("状态理由")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); void submit(); }
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <button type="button" disabled={saving || Boolean(draftError)} onClick={() => void submit()}>
            {t("保存")}
          </button>
          <button type="button" onClick={() => setEditing(false)}>{t("取消")}</button>
          {draftError && <small className="job-status-note-error">{draftError}</small>}
        </div>
      )}
    </div>
  );
}

/**
 * 状态与跟进的写入，以及写入中・写入失败的记录。卡片、看板、决策台与抽屉共用同一份，
 * 由视图顶层持有（理由见 statusErrors 的注释），各部件只拿稳定的回调。
 */
export function useJobStatusWrites({
  onFlash,
  onNoteWritten,
  onVaultChanged,
}: {
  onFlash?: (message: string, undo?: UndoAction) => void;
  onNoteWritten?: (note: Note) => void;
  onVaultChanged?: () => void | Promise<void>;
}) {
  const [savingPaths, setSavingPaths] = useState<string[]>([]);
  /**
   * 🔴 書込み失敗は **path をキーにここへ持つ**。操作部品（StatusPicker）の中に持つと、
   * 応答が返る前に抽屉を閉じられた瞬間に部品ごとアンマウントされ、`setFailure` が
   * React の静かな no-op になってエラーが消える。抽屉は背景クリック・×・Esc の
   * どれでも閉じられ、どれも書込み中を待たない。
   */
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({});

  /**
   * 🔴 楽観更新はしない。以前は即座に新 status を当てていたが、既定のフィルタが
   * `statuses: ["未応募"]` なので、その瞬間にカードが `visible` から外れて StatusPicker ごと
   * アンマウントされ、書込みが失敗しても**エラーを出す相手がもう居ない**。
   * 抽屉は `visible` を経由しないので抽屉だけエラーが出る、という非対称が実際に起きた
   * （2026-07-30 の実案件）。`saving` が「写入中…」を出すので楽観更新は元々不要。
   *
   * 失敗理由は `statusErrors[path]` に積む（部品ローカルに持てない理由はそこのコメント）。
   * 戻り値は呼び出し元が「注記エディタを閉じてよいか」を判断するためだけのもの。
   */
  const dismissStatusError = useCallback((path: string) => {
    setStatusErrors((current) => {
      if (!(path in current)) return current;
      const next = { ...current };
      delete next[path];
      return next;
    });
  }, []);

  /**
   * 撤销＝把服务端记下的旧值原样放回。只对「刚写完的那个版本」有效（expectedMtime 必填）：
   * 中间有别处改过就 409，这时放回旧值会连那次修改一起抹掉，所以只报告、不重试。
   * 撤销成功不再弹条幅——条幅本身会收起，再弹一条「已改为」反而分不清哪次是哪次。
   */
  const statusUndo = useCallback(
    (path: string, restore: Record<string, string | null> | undefined, mtime: number | undefined): UndoAction | undefined => {
      if (!restore || mtime === undefined) return undefined;
      return async () => {
        setSavingPaths((current) => current.includes(path) ? current : [...current, path]);
        try {
          const payload = await postJson<{ ok?: boolean; error?: string; note?: Note }>("/api/jobs/status", {
            path,
            restore,
            expectedMtime: mtime,
          });
          if (payload.note && onNoteWritten) onNoteWritten(payload.note);
          else await onVaultChanged?.();
          return null;
        } catch (error) {
          if (error instanceof ConflictError) {
            // 画面の版が古いままだと次の操作も 409 になる。撤销はしないが最新は取り直す。
            await onVaultChanged?.();
            return "已在别处更新，无法撤销";
          }
          return error instanceof Error ? error.message : "撤销失败";
        } finally {
          setSavingPaths((current) => current.filter((item) => item !== path));
        }
      };
    },
    [onNoteWritten, onVaultChanged],
  );

  const changeStatus = useCallback(
    async (
      path: string,
      status: string,
      statusNote = "",
      channel?: string,
      expectedMtime?: number,
    ): Promise<string | null> => {
      setSavingPaths((current) => current.includes(path) ? current : [...current, path]);
      setStatusErrors((current) => {
        if (!(path in current)) return current;
        const next = { ...current };
        delete next[path];
        return next;
      });
      try {
        let payload: {
          ok?: boolean;
          error?: string;
          note?: Note;
          derivedState?: "fresh" | "stale";
          unchanged?: boolean;
          /** 这次写入动过的键的旧值。服务端判断无法按标量写回时不给。 */
          undo?: Record<string, string | null>;
        };
        try {
          payload = await postJson("/api/jobs/status", {
            path,
            status,
            statusNote,
            ...(channel ? { channel } : {}),
            ...(expectedMtime !== undefined ? { expectedMtime } : {}),
          });
        } catch (writeError) {
          if (writeError instanceof ConflictError) {
            await onVaultChanged?.();
            throw new Error(writeError.message || "状态已更新，已自动刷新到最新版本，请重新点击。");
          }
          throw writeError;
        }
        // 画面へ反映してから savingPaths を落とす（finally は下の分岐の後）。
        // そうしないと一瞬だけ古い値に戻って、書けたのか失敗したのか読めなくなる。
        // 応答が更新後の note を持っているので単条差し替えで足りる。
        // 無い場合（unchanged 応答・旧サーバ）だけ全量再取得へ退く。
        if (payload.note && onNoteWritten) onNoteWritten(payload.note);
        else await onVaultChanged?.();
        if (!payload.unchanged) onFlash?.(changedToLabel(status), statusUndo(path, payload.undo, payload.note?.stat.mtime));
        return null;
      } catch (error) {
        const message = error instanceof Error ? error.message : "写入 Vault 失败";
        setStatusErrors((current) => ({ ...current, [path]: message }));
        return message;
      } finally {
        setSavingPaths((current) => current.filter((item) => item !== path));
      }
    },
    [onFlash, onNoteWritten, onVaultChanged, statusUndo],
  );

  const changeFollowUp = useCallback(async (
    path: string,
    values: { waitingFor: string | null; followUpAt: string | null; nextEventAt: string | null },
    expectedMtime?: number,
  ): Promise<string | null> => {
    setSavingPaths((current) => current.includes(path) ? current : [...current, path]);
    dismissStatusError(path);
    try {
      const payload = await postJson<{ ok?: boolean; error?: string; note?: Note }>("/api/jobs/follow-up", { path, ...values, ...(expectedMtime !== undefined ? { expectedMtime } : {}) });
      if (!payload.note) throw new Error(payload.error || "写入 Vault 失败");
      onNoteWritten?.(payload.note);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "写入 Vault 失败";
      setStatusErrors((current) => ({ ...current, [path]: message }));
      return message;
    } finally {
      setSavingPaths((current) => current.filter((item) => item !== path));
    }
  }, [dismissStatusError, onNoteWritten]);

  return { savingPaths, statusErrors, dismissStatusError, changeStatus, changeFollowUp };
}

/**
 * 🔴 書込み失敗の表示は**ここ一箇所だけ**。操作部品の隣に出す案を2回試して2回とも
 * 見えなくなった：①部品ローカル state → 応答前に抽屉を閉じるとアンマウントで消える
 * ②カードにインライン → そのカードがスクロール外なら結局見えない。
 * 描画場所を増やすたびに「見えない条件」が増えるので、
 * マウント状態にもスクロール位置にもビュー種別にも依存しない固定層に集約する。
 * 会社名を必ず添えるので、部品から離れてもどの案件か 迷わない。
 */
export function JobStatusAlerts({
  statusErrors,
  jobs,
  onDismiss,
}: {
  statusErrors: Record<string, string>;
  jobs: JobCard[];
  onDismiss: (path: string) => void;
}) {
  const { t } = useJobMenu();
  if (Object.keys(statusErrors).length === 0) return null;
  return (
    <div className="job-status-orphan-alerts" role="alert">
      {Object.entries(statusErrors).map(([path, message]) => (
        <p key={path}>
          <b>{jobs.find((job) => job.path === path)?.company ?? noteBasename(path)}</b>
          <span>没有写入。{message}</span>
          <button type="button" onClick={() => onDismiss(path)} aria-label={t("关闭提示")}>×</button>
        </p>
      ))}
    </div>
  );
}
