import { badRequest, obsidianErrorResponse } from "@/lib/server/api";
import { upsertAppendNote } from "@/lib/server/note-append";
import { createSerialQueue } from "@/lib/server/serial-queue";
import { tokyoParts } from "@/lib/dojo/utils";
import { isReviewNotePath } from "@/lib/review-paths";
import { parseAnnotations } from "@/lib/review";

// 批注ノートは事実層・追記のみ。ここは「新エントリを末尾に足す」以外の操作を持たない。
// 既存エントリの書き換え・削除は Web からはできない仕様（撤回も新エントリで表現する）。

const KINDS = new Set(["批注", "裁定", "聴解"]);

type AnnotateRequest = {
  notePath?: string;
  sentenceId?: string;
  kind?: string;
  text?: string;
  target?: string;
};

// REST API の追記は原子的でも、「読む→採番→追記」は原子的ではない。
// 連打や二重送信が同時に来ても a 番号と事実を重複させないため、短い直列区間にする。
const inAnnotationQueue = createSerialQueue();

function todayInTokyo() {
  return tokyoParts().date;
}

// 批注ノートは初回の追記で生まれる。整理稿を生成しただけでは存在せず、
// 以前は面接ごとに「最初の一件だけ 404 で書き込めない」状態だった。
// frontmatter の無いノートにならないよう、規格どおりの骨組みを先に置く。
// 応答へ返す frontmatter（クライアントが notes 配列を差し替える材料）も一緒に返し、
// 本文とオブジェクトが食い違わないようにする。
function annotationSkeleton(notePath: string) {
  const segments = notePath.split("/");
  const company = segments.at(-2) ?? "";
  const parsed = /^(\d{4}-\d{2}-\d{2})_(.+)_批注\.md$/.exec(segments.at(-1) ?? "");
  const date = parsed?.[1] ?? todayInTokyo();
  const round = parsed?.[2] ?? "面接";
  const frontmatter = {
    type: "study-annotation",
    company,
    date,
    round,
    target_note: `[[${date}_${round}_整理稿]]`,
    updated: todayInTokyo(),
  };
  const content = [
    "---",
    "type: study-annotation",
    `company: ${company}`,
    `date: ${date}`,
    `round: ${round}`,
    `target_note: "[[${date}_${round}_整理稿]]"`,
    `updated: ${todayInTokyo()}`,
    "---",
    `# ${date} ${company} ${round} 批注`,
    "",
    "> 形式：[[_整理稿スペック]]。**追記のみ**（既存エントリの `我::` は書き換えない）。",
    "> 種別＝`批注`（質問・意見）／`裁定`（疑の確定・話者確定）／`聴解`（×聞き取れず・△推測）。",
    "> 状態＝`open` → `answered` → `applied`。",
    "",
    "## エントリ",
    "",
  ].join("\n");
  return { frontmatter, content };
}

export async function POST(request: Request) {
  let body: AnnotateRequest;
  try {
    body = (await request.json()) as AnnotateRequest;
  } catch {
    return badRequest("请求体不是合法 JSON");
  }

  const notePath = body.notePath ?? "";
  const sentenceId = body.sentenceId ?? "";
  const kind = body.kind ?? "";
  const target = body.target ?? "";
  // trim が先。順序を逆にすると、改行だけの入力が「；」に化けてから非空判定に通り、
  // 追記のみ・削除経路の無い事実層に中身が全角セミコロン1個だけの条目が残る。
  const text = (body.text ?? "").trim().replace(/\s*\n\s*/g, "；");

  // ここだけ入口が整理稿ではなく批注ノート自身。「整理稿に揃える」と自分の書き込み先を弾く。
  if (!isReviewNotePath(notePath, "annotation")) {
    return badRequest("notePath 不是批注笔记");
  }
  if (!/^s\d+[a-z]?$/.test(sentenceId)) {
    return badRequest("sentenceId 格式不对");
  }
  if (!KINDS.has(kind)) {
    return badRequest("kind 必须是 批注/裁定/聴解");
  }
  if (target && !/^(?:speaker|error:\d+)$/.test(target)) {
    return badRequest("target 格式不对");
  }
  if (!text || text.length > 2000) {
    return badRequest("text 为空或超长");
  }

  try {
    const outcome = await inAnnotationQueue(() =>
      upsertAppendNote({
        path: notePath,
        plan: (existing) => {
          // 判定は「ノートが在るか」であって「本文が空でないか」ではない。
          // content で判定すると、中身が空の既存ノートを骨組みで上書きしてしまう——
          // 批注は追記のみの事実層なので、その上書きはそのまま事実の消失になる。
          const skeleton = existing === null ? annotationSkeleton(notePath) : null;
          const content = existing?.content ?? skeleton?.content ?? "";
          const duplicate = parseAnnotations(content).find(
            (annotation) =>
              annotation.sentenceId === sentenceId &&
              annotation.kind === kind &&
              annotation.mine === text &&
              (!target || !annotation.target || annotation.target === target),
          );
          if (duplicate) return { duplicate: { id: duplicate.id } };

          let maxId = 0;
          for (const match of content.matchAll(/\*\*a(\d+)｜/g)) {
            maxId = Math.max(maxId, Number(match[1]));
          }
          const id = `a${String(maxId + 1).padStart(3, "0")}`;
          const targetLine = target ? `    - 対象:: ${target}\n` : "";
          const entry = `\n- **${id}｜${sentenceId}｜${kind}｜open｜${todayInTokyo()}**\n${targetLine}    - 我:: ${text}\n`;
          return {
            nextContent: `${content}${entry}`,
            value: { id },
            ...(skeleton ? { frontmatterForNew: skeleton.frontmatter } : {}),
          };
        },
      }),
    );
    return Response.json({
      ok: true,
      ...outcome.value,
      deduplicated: outcome.deduplicated,
      note: outcome.note,
    });
  } catch (error) {
    return obsidianErrorResponse(error, "Obsidian 写入失败");
  }
}
