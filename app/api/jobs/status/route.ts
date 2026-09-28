import { tokyoParts } from "@/lib/dojo/utils";
import {
  composeJobStatus,
  isJobStatus,
  JOB_CASE_ROOT,
  JOB_CASE_TYPE,
  jobStatusNoteError,
  KNOWN_CHANNELS,
  normalizeJobStatus,
  statusRequiresChannel,
} from "@/lib/jobs";

/** 終結（不採用）時に消す残骸。待ち・跟進・面談予定は死んだ案件の待办ではない（inbox-sync skill と同じ規則）。 */
const TERMINAL_CLEANUP_KEYS = ["waiting_for", "follow_up_at", "follow_up_action", "next_event_at"] as const;
import { buildJobStatusUndo, validateJobStatusRestore } from "@/lib/job-status-restore";
import { assertExpectedMtime, errorResponse, parseExpectedMtime, parseOptionalText, parseRequiredText, readJson, badRequestError } from "@/lib/server/api";
import { patchFrontmatterScalars } from "@/lib/server/frontmatter-patch";
import { readNote, readNoteOrNull, writeNote } from "@/lib/server/obsidian";
import { createKeyedSerialQueue } from "@/lib/server/serial-queue";

type Body = {
  path?: string;
  status?: string;
  /** 括弧に入る注記。空なら括弧ごと落ちる＝前の理由が新しい状態に居残らない。 */
  statusNote?: string;
  /**
   * 実際の投递渠道。応募済以降の状態でノートに channel が無い時、UI が選ばせて一緒に送る。
   * 既に channel を持つノートへ別の値は書かない（応募経路は歴史事実で、状態変更のついでに
   * 書き換えてよいものではない）。
   */
  channel?: string;
  /** 上一次已知的笔记 mtime。status_updated 只有日精度，同一天两处改同一案件会互相覆盖，所以换成 mtime。 */
  expectedMtime?: number;
  /**
   * 撤销：上一次状态写入返回的 undo 表（键 → 写入前的值，null＝原本没有这个键）。
   * 与 status 互斥——撤销不走状态规则，只把那一次动过的键原样放回。
   */
  restore?: unknown;
};

function assertJobCasePath(path: string) {
  if (!path.startsWith(JOB_CASE_ROOT) || !path.toLowerCase().endsWith(".md") || path.includes("..")) {
    throw badRequestError(`只允许修改 ${JOB_CASE_ROOT} 下的应募案件。`);
  }
}

// 「読む→status を差し替える→書く」は原子的ではない。看板の連打や二重送信が
// 同時に来ると後勝ちで片方が消えるので、他の書込ルートと同じく短い直列区間にする。
const inStatusQueue = createKeyedSerialQueue();

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    if (body.restore !== undefined) return await restoreStatus(body);
    const path = parseRequiredText(body.path, "path");
    const status = parseRequiredText(body.status, "status");
    const statusNote = parseOptionalText(body.statusNote, "statusNote") ?? "";
    const channel = parseOptionalText(body.channel, "channel") ?? "";
    const expectedMtime = parseExpectedMtime(body.expectedMtime);

    assertJobCasePath(path);
    if (!isJobStatus(status)) {
      throw badRequestError(`未知的应募状态：${status || "(空)"}`);
    }
    const noteError = jobStatusNoteError(statusNote);
    if (noteError) throw badRequestError(noteError);
    if (channel && !(KNOWN_CHANNELS as readonly string[]).includes(channel)) {
      throw badRequestError(`未知的投递渠道：${channel}。既知は ${KNOWN_CHANNELS.join(" / ")}`);
    }

    const value = composeJobStatus(status, statusNote);

    return await inStatusQueue(path, async () => {
      const note = await readNote(path);
      if (note.frontmatter.type !== JOB_CASE_TYPE) {
        throw badRequestError("这条笔记不是应募案件，拒绝写入。");
      }
      const currentStatusUpdated = String(note.frontmatter.status_updated ?? "").trim();
      assertExpectedMtime(expectedMtime, note.stat.mtime);

      const existingChannel = String(note.frontmatter.channel ?? "").trim();
      // 応募経路は歴史事実：一度書いた channel を状態変更のついでに上書きさせない。
      if (channel && existingChannel && channel !== existingChannel) {
        throw badRequestError(
          `这条案件的 channel 已经是「${existingChannel}」。投递渠道是历史事实，` +
            `不随状态一起改写；确实记错了的话去笔记里改，并在正文里写明原因。`,
        );
      }
      // channel を要求するのは台帳が経路別の面接到達率をこの値で集計しているから
      // （scripts/vault-stats.mjs）。空の channel を通すと集計に無名のバケツが生えて、
      // generated 区块の数字が静かに壊れる。だから緩めず、UI 側で選ばせて一緒に受け取る。
      if (statusRequiresChannel(status) && !existingChannel && !channel) {
        throw badRequestError(
          `「${status}」是応募之后的状态，必须有 channel 记录实际投递渠道（source 是求人来源，不能代替）。` +
            `这条案件还没有 channel＝系统里没有应募记录。真投过就在状态旁边的渠道选择里选一个；` +
            `没投过（例如募集終了・取扱終了）就选「保留」，把理由写进括号。`,
        );
      }
      // channel を書くのは「応募記録が要る状態」への変更時だけ。未応募 + channel という
      // 「channel 有り＝応募記録あり」の不変条件を破る記録は API 直叩きでも作らせない。
      const channelToWrite =
        channel && !existingChannel && statusRequiresChannel(status) ? channel : undefined;
      const sameStatus = note.frontmatter.status === value;
      const sameBaseStatus =
        typeof note.frontmatter.status === "string" && note.frontmatter.status.startsWith(status);
      // channel の追記だけが目的の再選択（状態は同じ）も書込みに進める。
      if (sameStatus && !channelToWrite) {
        return Response.json({
          ok: true,
          path,
          status: value,
          statusUpdated: currentStatusUpdated,
          note: note,
          unchanged: true,
          derivedState: "fresh",
        });
      }

      // channel のバックフィル（base status を変えずに channel だけ足す書込み）は状態変化ではない：
      // status_updated を今日へ進めると台帳の月別集計・通知日という歴史事実が動くので、既存値を守り、
      // 注記も呼び出し側が空なら既存のものを残す。channel を伴わない同状態書込みは従来どおり
      // （空の注記で上書き＝注記の明示的な削除）——UI の注記エディタがその挙動に依存している。
      const preserveHistory = sameBaseStatus && !statusNote && Boolean(channelToWrite);
      const existingUpdated = String(note.frontmatter.status_updated ?? "").trim();
      const { date: today } = tokyoParts();
      const date = preserveHistory && existingUpdated ? existingUpdated : today;
      const valueToWrite = preserveHistory ? String(note.frontmatter.status) : value;
      const previousBase = normalizeJobStatus(String(note.frontmatter.status ?? "")) ?? "";
      const extra: Record<string, string | null> = {};
      // 応募日は応募済に入った瞬間の日付が唯一の記録。以後 status_updated は拒否日・面接日で上書きされて
      // 応募日が永久に消えるので、別枠 applied_on に残す（既に書いてあれば触らない）。
      if (status === "応募済" && !preserveHistory && !String(note.frontmatter.applied_on ?? "").trim()) extra.applied_on = today;
      if (status === "不採用" && previousBase !== "不採用") {
        for (const key of TERMINAL_CLEANUP_KEYS) if (note.frontmatter[key] !== undefined) extra[key] = null;
      }
      const updates: Record<string, string | null> = {
        status: valueToWrite,
        status_updated: date,
        ...(channelToWrite ? { channel: channelToWrite } : {}),
        ...extra,
      };
      // 撤销表要在写之前按「这次动过的键」取旧值；写完再取就只剩新值了。
      const undo = buildJobStatusUndo(note.frontmatter, Object.keys(updates));
      const content = patchFrontmatterScalars(note.content, updates);
      await writeNote(path, content);
      // mtime は楽観ロックの版そのもの。Date.now() を返すと次のクリックが必ず 409 になるので、
      // 書いた直後にディスクの stat を読み直す（内容と frontmatter は手元の値を使う）。
      const written = await readNoteOrNull(path);
      // 更新後のノートを応答へ載せる。サーバは全文を手元に持っているのに、
      // クライアントが1件の差し替えのために全庫を再取得する理由はない。
      const frontmatter: Record<string, unknown> = {
        ...note.frontmatter,
        status: valueToWrite,
        status_updated: date,
        ...(channelToWrite ? { channel: channelToWrite } : {}),
      };
      for (const [key, extraValue] of Object.entries(extra)) {
        if (extraValue === null) delete frontmatter[key];
        else frontmatter[key] = extraValue;
      }
      const updated = {
        ...note,
        content,
        stat: written?.stat ?? { ...note.stat, mtime: Date.now(), size: content.length },
        frontmatter,
      };
      return Response.json({
        ok: true,
        path,
        status: valueToWrite,
        statusUpdated: date,
        note: updated,
        // 旧值里有数组・对象等无法按标量写回的形状时不给撤销（buildJobStatusUndo 返回 null）。
        ...(undo ? { undo } : {}),
        // Workers 运行时不能执行本机 vault:stats。主事实已经安全写入，但所有派生图表
        // 必须明确标成待重算，不能继续伪装成同一时点的数据。
        derivedState: "stale",
      });
    });
  } catch (error) {
    return errorResponse(error, "更新应募状态失败");
  }
}

/**
 * 撤销上一次状态写入。只认「刚写完的那个版本」：expectedMtime 必填且必须与磁盘一致，
 * 否则中间已有别处（另一个标签页、Codex、inbox-sync）改过，放回旧值会把那次修改一起抹掉。
 */
async function restoreStatus(body: Body) {
  if (body.status !== undefined) throw Object.assign(new Error("restore 与 status 不能同时提交。"), { status: 400 });
  const path = parseRequiredText(body.path, "path");
  assertJobCasePath(path);
  const restore = validateJobStatusRestore(body.restore);
  const expectedMtime = parseExpectedMtime(body.expectedMtime);
  if (expectedMtime === undefined) {
    throw Object.assign(new Error("撤销必须带 expectedMtime（只能撤销刚写入的那个版本）。"), { status: 400 });
  }

  return await inStatusQueue(path, async () => {
    const note = await readNote(path);
    if (note.frontmatter.type !== JOB_CASE_TYPE) {
      throw badRequestError("这条笔记不是应募案件，拒绝写入。");
    }
    assertExpectedMtime(expectedMtime, note.stat.mtime);
    const content = patchFrontmatterScalars(note.content, restore);
    await writeNote(path, content);
    // 与状态写入同理：返回磁盘上的 mtime，下一次写入（或再改一次状态）才不会被自己的撤销 409。
    const written = await readNoteOrNull(path);
    const frontmatter: Record<string, unknown> = { ...note.frontmatter };
    for (const [key, value] of Object.entries(restore)) {
      if (value === null) delete frontmatter[key];
      else frontmatter[key] = value;
    }
    return Response.json({
      ok: true,
      path,
      note: {
        ...note,
        content,
        stat: written?.stat ?? { ...note.stat, mtime: Date.now(), size: content.length },
        frontmatter,
      },
      derivedState: "stale",
    });
  });
}
