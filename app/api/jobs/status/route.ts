import { tokyoParts } from "@/lib/dojo/utils";
import {
  composeJobStatus,
  isJobStatus,
  JOB_CASE_ROOT,
  JOB_CASE_TYPE,
  jobStatusNoteError,
  KNOWN_CHANNELS,
  statusRequiresChannel,
} from "@/lib/jobs";
import { errorResponse, parseOptionalText, parseRequiredText, readJson } from "@/lib/server/api";
import { patchFrontmatterScalars } from "@/lib/server/frontmatter-patch";
import { readNote, writeNote } from "@/lib/server/obsidian";
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
  expectedStatusUpdated?: string;
};

// 「読む→status を差し替える→書く」は原子的ではない。看板の連打や二重送信が
// 同時に来ると後勝ちで片方が消えるので、他の書込ルートと同じく短い直列区間にする。
const inStatusQueue = createKeyedSerialQueue();

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    const path = parseRequiredText(body.path, "path");
    const status = parseRequiredText(body.status, "status");
    const statusNote = parseOptionalText(body.statusNote, "statusNote") ?? "";
    const channel = parseOptionalText(body.channel, "channel") ?? "";
    const expectedStatusUpdated = parseOptionalText(body.expectedStatusUpdated, "expectedStatusUpdated");

    if (!path.startsWith(JOB_CASE_ROOT) || !path.toLowerCase().endsWith(".md") || path.includes("..")) {
      throw new Error(`只允许修改 ${JOB_CASE_ROOT} 下的应募案件。`);
    }
    if (!isJobStatus(status)) {
      throw new Error(`未知的应募状态：${status || "(空)"}`);
    }
    const noteError = jobStatusNoteError(statusNote);
    if (noteError) throw new Error(noteError);
    if (channel && !(KNOWN_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(`未知的投递渠道：${channel}。既知は ${KNOWN_CHANNELS.join(" / ")}`);
    }

    const value = composeJobStatus(status, statusNote);

    return await inStatusQueue(path, async () => {
      const note = await readNote(path);
      if (note.frontmatter.type !== JOB_CASE_TYPE) {
        throw new Error("这条笔记不是应募案件，拒绝写入。");
      }
      const currentStatusUpdated = String(note.frontmatter.status_updated ?? "").trim();
      if (expectedStatusUpdated && expectedStatusUpdated !== currentStatusUpdated) {
        const conflict = new Error("状态已更新，版本不一致。请刷新后重试。");
        (conflict as { status?: number }).status = 409;
        throw conflict;
      }

      const existingChannel = String(note.frontmatter.channel ?? "").trim();
      // 応募経路は歴史事実：一度書いた channel を状態変更のついでに上書きさせない。
      if (channel && existingChannel && channel !== existingChannel) {
        throw new Error(
          `这条案件的 channel 已经是「${existingChannel}」。投递渠道是历史事实，` +
            `不随状态一起改写；确实记错了的话去笔记里改，并在正文里写明原因。`,
        );
      }
      // channel を要求するのは台帳が経路別の面接到達率をこの値で集計しているから
      // （scripts/vault-stats.mjs）。空の channel を通すと集計に無名のバケツが生えて、
      // generated 区块の数字が静かに壊れる。だから緩めず、UI 側で選ばせて一緒に受け取る。
      if (statusRequiresChannel(status) && !existingChannel && !channel) {
        throw new Error(
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
      const content = patchFrontmatterScalars(note.content, {
        status: valueToWrite,
        status_updated: date,
        ...(channelToWrite ? { channel: channelToWrite } : {}),
      });
      await writeNote(path, content);
      // 更新後のノートを応答へ載せる。サーバは全文を手元に持っているのに、
      // クライアントが1件の差し替えのために全庫を再取得する理由はない。
      const updated = {
        ...note,
        content,
        stat: { ...note.stat, mtime: Date.now(), size: content.length },
        frontmatter: {
          ...note.frontmatter,
          status: valueToWrite,
          status_updated: date,
          ...(channelToWrite ? { channel: channelToWrite } : {}),
        },
      };
      return Response.json({
        ok: true,
        path,
        status: valueToWrite,
        statusUpdated: date,
        note: updated,
        // Workers 运行时不能执行本机 vault:stats。主事实已经安全写入，但所有派生图表
        // 必须明确标成待重算，不能继续伪装成同一时点的数据。
        derivedState: "stale",
      });
    });
  } catch (error) {
    return errorResponse(error, "更新应募状态失败");
  }
}
