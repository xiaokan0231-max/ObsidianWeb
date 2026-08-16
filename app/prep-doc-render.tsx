"use client";

import { useMemo, useState } from "react";
import {
  cardIdFromRef,
  prepBlockText,
  prepInlineText,
  type PrepBlock,
  type PrepEmbedOrigin,
  type PrepInline,
} from "@/lib/interview-prep-doc";

// 面接準備ドキュメントの描画だけを持つ。記法の意味は lib/interview-prep-doc.ts、
// 同じ記法の HTML 版は skill の build_interview_html.py にある（三者の見た目を揃えている）。

type PrepRefHandlers = {
  /** 回答库のカードへ飛ぶ（[[面接標準回答集#pNN …]] の参照） */
  onOpenCard?: (cardId: string) => void;
  /** それ以外の vault ノートを開く */
  onOpenWiki?: (target: string, section?: string) => void;
  /**
   * 検索語。**一度に1節しか描画しない**設計なのでブラウザの Ctrl+F が効かない。
   * その代わりを自前で持つ必要がある（面接中に「冪等」を引けないと意味がない）。
   */
  query?: string;
};

/** 検索語に一致する部分を <mark> で包む。ルビの親字も対象にする（探す語は漢字側にある）。 */
function Marked({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>;
  const haystack = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (;;) {
    const hit = haystack.indexOf(needle, cursor);
    if (hit < 0) {
      parts.push(text.slice(cursor));
      break;
    }
    if (hit > cursor) parts.push(text.slice(cursor, hit));
    parts.push(
      <mark key={hit} className="prep-doc-hit">{text.slice(hit, hit + query.length)}</mark>,
    );
    cursor = hit + query.length;
  }
  return <>{parts}</>;
}

/** 面接直前に声に出すための表示なので、注音は括弧ではなく頭上のルビで出す。 */
export function Inlines({ nodes, refs }: { nodes: PrepInline[]; refs?: PrepRefHandlers }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case "ruby":
            return (
              <ruby key={index}>
                <Marked text={node.base} query={refs?.query} />
                <rt>{node.reading}</rt>
              </ruby>
            );
          case "strong":
            return <strong key={index}><Inlines nodes={node.children} refs={refs} /></strong>;
          case "link":
            return (
              <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
                <Inlines nodes={node.children} refs={refs} />
              </a>
            );
          case "ref": {
            const cardId = cardIdFromRef(node);
            if (cardId && refs?.onOpenCard) {
              return (
                <button
                  key={index}
                  type="button"
                  className="prep-doc-ref card"
                  onClick={() => refs.onOpenCard?.(cardId)}
                  title={`回答库の ${cardId} を開く`}
                >{node.text}</button>
              );
            }
            if (refs?.onOpenWiki) {
              return (
                <button
                  key={index}
                  type="button"
                  className="prep-doc-ref"
                  onClick={() => refs.onOpenWiki?.(node.target, node.section)}
                  title={`${node.target}${node.section ? ` > ${node.section}` : ""} を開く`}
                >{node.text}</button>
              );
            }
            return <span key={index} className="prep-doc-ref">{node.text}</span>;
          }
          default:
            return <span key={index}><Marked text={node.text} query={refs?.query} /></span>;
        }
      })}
    </>
  );
}

function renderBlock(
  block: PrepBlock,
  index: number,
  refs?: PrepRefHandlers,
  numbers?: Map<number, number>,
) {
  switch (block.kind) {
    case "heading": {
      // 節内ジャンプの着地点。長い節（単語文法帳は 10 小節・134 行）では必須。
      // 番号は「この節の構成」目次と同じ採番——長い節の途中でも今どこかが分かる
      const no = numbers?.get(index);
      const badge =
        no !== undefined ? (
          <i className="prep-h-no" aria-hidden="true">{String(no).padStart(2, "0")}</i>
        ) : null;
      return block.level === 3
        ? <h3 key={index} id={`prep-h-${index}`}>{badge}<Inlines nodes={block.inline} refs={refs} /></h3>
        : <h4 key={index} id={`prep-h-${index}`}><Inlines nodes={block.inline} refs={refs} /></h4>;
    }
    case "say":
      return (
        <p key={index} className={`prep-doc-say ${block.speaker}`} lang="ja">
          <span>{block.speaker === "you" ? "あなた" : "面接官"}</span>
          <Inlines nodes={block.inline} refs={refs} />
        </p>
      );
    case "note": {
      // > 引用は大半が「当日そのまま口に出す内容」（開幕・救場・逆質問・締め）。
      // ⚠️🔴 で始まる行だけが本当の注意書きなので、そちらだけ警戒色にする
      const lead = block.tone === "tip" ? prepInlineText(block.inline).trimStart() : "";
      const warn =
        lead.startsWith("⚠") || lead.startsWith("🔴") || lead.startsWith("❗");
      return (
        <p key={index} className={`prep-doc-note ${block.tone}${warn ? " warn" : ""}`}>
          <Inlines nodes={block.inline} refs={refs} />
        </p>
      );
    }
    case "list":
      return block.ordered ? (
        <ol key={index} className="prep-doc-list" start={block.start}>
          {block.items.map((item, row) => (
            <li key={row}><Inlines nodes={item} refs={refs} /></li>
          ))}
        </ol>
      ) : (
        <ul key={index} className="prep-doc-list">
          {block.items.map((item, row) => (
            <li key={row}><Inlines nodes={item} refs={refs} /></li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div key={index} className="prep-doc-tablewrap">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, col) => (
                  <th key={col}><Inlines nodes={cell} refs={refs} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, col) => (
                    <td key={col}><Inlines nodes={cell} refs={refs} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return <pre key={index} className="prep-doc-code">{block.text}</pre>;
    default:
      return <p key={index}><Inlines nodes={block.inline} refs={refs} /></p>;
  }
}

type EmbedRun = { origin: PrepEmbedOrigin | null; start: number; blocks: PrepBlock[] };

/** 連続する同じ embed 由来のブロックを一つの束にする。origin 無しの区間もそのまま束として返す。 */
function groupByEmbed(blocks: PrepBlock[]): EmbedRun[] {
  const runs: EmbedRun[] = [];
  blocks.forEach((block, index) => {
    const origin = block.embed ?? null;
    const last = runs[runs.length - 1];
    const sameRun =
      last &&
      (last.origin === origin ||
        (last.origin !== null &&
          origin !== null &&
          last.origin.target === origin.target &&
          last.origin.section === origin.section));
    if (sameRun) last.blocks.push(block);
    else runs.push({ origin, start: index, blocks: [block] });
  });
  return runs;
}

/**
 * 展開された共通資産の畳み。展開のまま地の文に混ぜると「どの輪を開いても同じ長文」になり、
 * その輪だけの増分が埋もれる——それがこの画面の一番の不満だった。既定は畳み、
 * 検索がヒットした時だけ自動で開く（手で開閉した後はその操作を優先する）。
 */
function EmbedFold({
  origin,
  blocks,
  start,
  refs,
  number,
}: {
  origin: PrepEmbedOrigin;
  blocks: PrepBlock[];
  start: number;
  refs?: PrepRefHandlers;
  /** 「この節の構成」目次での採番。目次の項とカードを同じ番号で対応させる。 */
  number?: number;
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const query = refs?.query?.trim().toLocaleLowerCase() ?? "";
  const hasHit = useMemo(
    () =>
      query
        ? blocks.map(prepBlockText).join("\n").toLocaleLowerCase().includes(query)
        : false,
    [blocks, query],
  );
  const open = userOpen ?? hasHit;
  return (
    <section className={`prep-doc-embed${open ? " open" : ""}`} id={`prep-embed-${start}`}>
      <div className="prep-doc-embed-head">
        <button
          type="button"
          className="prep-doc-embed-toggle"
          aria-expanded={open}
          onClick={() => setUserOpen(!open)}
          title={`${origin.target}${origin.section ? ` › ${origin.section}` : ""}（vault 正本の埋め込み）`}
        >
          <i aria-hidden="true">{open ? "▾" : "▸"}</i>
          {number !== undefined && (
            <em className="prep-h-no" aria-hidden="true">{String(number).padStart(2, "0")}</em>
          )}
          <b>📎 {origin.target}</b>
          {origin.section && <span className="section">› {origin.section}</span>}
          <span className="scope">全局共用 · 各轮相同</span>
          {!open && hasHit && <em className="hit">含命中</em>}
        </button>
        {refs?.onOpenWiki && (
          <button
            type="button"
            className="prep-doc-embed-open"
            onClick={() => refs.onOpenWiki?.(origin.target, origin.section || undefined)}
          >
            全屏打开
          </button>
        )}
      </div>
      {open && (
        <div className="prep-doc-embed-body">
          {blocks.map((block, offset) => renderBlock(block, start + offset, refs))}
        </div>
      )}
    </section>
  );
}

export function Blocks({
  blocks,
  refs,
  collapseEmbeds,
  headingNumbers,
}: {
  blocks: PrepBlock[];
  refs?: PrepRefHandlers;
  /**
   * 共通資産の展開を畳んで出すか。本文リーダー（深度準備）だけが有効にする。
   * 冲刺・确认・殺傷7題は「その場で読み上げる」画面なので、参照で引いた本文も地の文のまま出す。
   */
  collapseEmbeds?: boolean;
  /** 「この節の構成」目次と同じ採番（ブロック下標→番号）。渡した画面だけ見出しに番号が付く。 */
  headingNumbers?: Map<number, number>;
}) {
  if (!collapseEmbeds) {
    return <>{blocks.map((block, index) => renderBlock(block, index, refs, headingNumbers))}</>;
  }
  return (
    <>
      {groupByEmbed(blocks).map((run) =>
        run.origin ? (
          <EmbedFold
            // key に資産名を含める：節を切り替えても同じ資産の開閉状態が引き継がれる
            key={`embed-${run.origin.target}#${run.origin.section}-${run.start}`}
            origin={run.origin}
            blocks={run.blocks}
            start={run.start}
            refs={refs}
            number={headingNumbers?.get(run.start)}
          />
        ) : (
          run.blocks.map((block, offset) =>
            renderBlock(block, run.start + offset, refs, headingNumbers),
          )
        ),
      )}
    </>
  );
}
