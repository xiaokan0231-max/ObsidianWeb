"use client";

import {
  cardIdFromRef,
  type PrepBlock,
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

export function Blocks({ blocks, refs }: { blocks: PrepBlock[]; refs?: PrepRefHandlers }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            // 節内ジャンプの着地点。長い節（単語文法帳は 10 小節・134 行）では必須
            return block.level === 3
              ? <h3 key={index} id={`prep-h-${index}`}><Inlines nodes={block.inline} refs={refs} /></h3>
              : <h4 key={index} id={`prep-h-${index}`}><Inlines nodes={block.inline} refs={refs} /></h4>;
          case "say":
            return (
              <p key={index} className={`prep-doc-say ${block.speaker}`} lang="ja">
                <span>{block.speaker === "you" ? "あなた" : "面接官"}</span>
                <Inlines nodes={block.inline} refs={refs} />
              </p>
            );
          case "note":
            return (
              <p key={index} className={`prep-doc-note ${block.tone}`}>
                <Inlines nodes={block.inline} refs={refs} />
              </p>
            );
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
      })}
    </>
  );
}
