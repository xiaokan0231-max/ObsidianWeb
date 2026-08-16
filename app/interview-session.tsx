"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildPrepKillQuestions,
  extractPrepKillMap,
  extractPrepTalentMap,
  findInterviewPrepDocs,
  groupPrepSections,
  prepBlockText,
  prepInlineText,
  shortLabel,
  type InterviewPrepDoc,
  type PrepBlock,
  type PrepExternalLink,
  type PrepKillQuestion,
  type PrepSection,
} from "@/lib/interview-prep-doc";
import {
  groupInterviewPrepDocs,
  interviewPrepSeriesForDoc,
  interviewPrepTemporalStatus,
  mergePrepExternalLinks,
  prepDocsThroughRound,
  selectRelevantInterviewPrepDoc,
} from "@/lib/interview-prep-index";
import {
  calendarCompanyIdentity,
  countdownLabel,
  localDateKey,
} from "@/lib/memory-atlas-data";
import { formatDate, getType, type Note } from "@/lib/notes";
import { REVIEW_DIMENSION_META } from "@/lib/review-deep";
import {
  buildCardCoverage,
  buildInterviewTrends,
  reviewTrendEntry,
} from "@/lib/interview-trends.mjs";
import {
  companyMotivationAssetTarget,
  type SharedAssetTarget,
} from "@/lib/interview-shared-assets";
import { Blocks, Inlines } from "./prep-doc-render";
import { copySelectionWithoutRuby } from "./ruby-copy";
import { isTypingTarget, PrepSearchBox, useSlashFocus } from "./prep-search";

// 会社／応募案件を選び、その中の各回を履歴のまま読む画面。
// 回答库（面试准备）は平時に引く辞書、こちらは当日に読む一枚。用途が違うので分けている。
// 共通の話術は各社ノートに ![[…]] で埋め込まれており、ここで展開済みの本文として読める。

/** 全社共通の資産。準備ドキュメントから外れた話を確認したいときの入口。 */
type SessionAsset =
  | SharedAssetTarget
  | { cardId: string; label: string; hint: string };

const SHARED_ASSETS: SessionAsset[] = [
  {
    cardId: "p01",
    label: "自己紹介",
    hint: "回答库 p01・标准答案／30秒版／边界／证据",
  },
  {
    cardId: "p35",
    label: "最近の退職理由",
    hint: "回答库 p35・前の会社を辞めた理由／事前说明／长期就职",
  },
  {
    cardId: "p10",
    label: "来日理由",
    hint: "回答库 p10・为什么来日本／为什么长期留下",
  },
  { note: "当日フレーズ集", label: "当日フレーズ", hint: "受付・入室・聞き返し・締め" },
  {
    note: "単語文法帳",
    label: "単語文法帳",
    hint: "数字の読み方は G表",
    defaultSection: "G. ⭐実績数字の読み方（5秒以内で言えるまで）",
  },
  { note: "NG集_禁句と口癖", label: "NG集", hint: "禁句・口癖・one-liner" },
  { note: "面接傾向_横断", label: "横断傾向", hint: "五維の推移・反復タグ" },
];

function hasInterviewDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

type SessionMode = "confirm" | "sprint" | "deep";

const SESSION_MODES: {
  id: SessionMode;
  duration: string;
  label: string;
  description: string;
}[] = [
  { id: "confirm", duration: "30秒", label: "确认", description: "只看开场、定位与收尾" },
  { id: "sprint", duration: "5分钟", label: "冲刺", description: "按临场顺序快速热身" },
  { id: "deep", duration: "完整", label: "深度准备", description: "公司、问答与全部材料" },
];

function prepSectionNumber(title: string) {
  return Number(title.normalize("NFKC").match(/^(\d+)[.、．]/)?.[1] ?? 0);
}

function prepSectionByNumber(doc: InterviewPrepDoc, number: number) {
  return doc.sections.find((section) => prepSectionNumber(section.title) === number) ?? null;
}

// 準備稿ごとに「この節だけ／この枠だけ」と表記が揺れる。ここが外れると冲刺が §1 全文に
// フォールバックして「1画面」の意味が消えるので、表記揺れを吸収する。
const LIVE_FRAME_RE = /面接中に見るのはこの(節|枠|画面|ブロック)だけ/;

/** 标题以下、下一个同级标题以前的块。准备稿缺某段时返回空，不让临战页崩掉。 */
function prepSubsection(section: PrepSection | null, title: RegExp) {
  if (!section) return [];
  const start = section.blocks.findIndex(
    (block) => block.kind === "heading" && title.test(prepInlineText(block.inline)),
  );
  if (start < 0) return [];
  const heading = section.blocks[start];
  const depth = heading.kind === "heading" ? heading.depth : 0;
  const end = section.blocks.findIndex(
    (block, index) => index > start && block.kind === "heading" && block.depth <= depth,
  );
  return section.blocks.slice(start + 1, end < 0 ? undefined : end);
}

function prepBlockAfterLead(blocks: PrepBlock[], label: RegExp) {
  const index = blocks.findIndex((block) => label.test(prepBlockText(block)));
  return index >= 0 ? blocks.slice(index + 1, index + 2) : [];
}

function prepTableValue(blocks: PrepBlock[], label: string) {
  for (const block of blocks) {
    if (block.kind !== "table") continue;
    const row = block.rows.find((cells) => prepInlineText(cells[0] ?? []) === label);
    if (row?.[1]) return prepInlineText(row[1]);
  }
  return "";
}

function defaultSessionMode(doc: InterviewPrepDoc, today: string): SessionMode {
  if (!hasInterviewDate(doc.date)) return "deep";
  const interviewDay = new Date(`${doc.date}T00:00:00`).getTime();
  const currentDay = new Date(`${today}T00:00:00`).getTime();
  const days = Math.round((interviewDay - currentDay) / 86_400_000);
  if (days <= 0) return "confirm";
  if (days <= 1) return "sprint";
  return "deep";
}

function buildDigest(notes: Note[]) {
  const library = notes.find((note) => getType(note) === "interview-prep-library");
  const coverage = buildCardCoverage(library?.content ?? "");
  const entries = notes
    .filter((note) => getType(note) === "interview-answer-review")
    .map((note) => reviewTrendEntry(note.path, note.frontmatter, note.content));
  return entries.length > 0 ? buildInterviewTrends(entries, coverage) : null;
}

const SECTION_TAB_LABELS: Record<number, string> = {
  1: "速查",
  2: "胜法与雷区",
  3: "职位拆解",
  4: "面试官",
  5: "自我介绍",
  6: "想定问答",
  7: "反向提问",
  8: "转职理由",
  9: "当日短语",
  10: "单词文法",
  11: "研究来源",
  12: "NG／清单",
};

function sectionTabLabel(title: string) {
  const normalized = title.normalize("NFKC");
  const number = Number(normalized.match(/^(\d+)[.、]/)?.[1] ?? 0);
  return SECTION_TAB_LABELS[number] ?? shortLabel(normalized.replace(/^\d+[.、]\s*/, ""), 10);
}

function subsectionTabLabel(title: string) {
  const cleaned = title.replace(/^[⭐★🔴⚠️\s　]+/, "").trim();
  if (/面接中に見る/.test(cleaned)) return "面试中只看";
  return shortLabel(cleaned, 12) || cleaned;
}

/**
 * 「殺傷質問7題」を、当日これ1画面で回せる形に組む。
 * 索引だけ（どの節を見ろ）では7回ジャンプすることになるので、
 * 問い・読み上げる答案・なぜそう答えるかを1枚に並べる。答案は各所の正本からの参照。
 */
function KillMapPage({
  questions,
  onOpenCard,
  onOpenWiki,
  query,
}: {
  questions: PrepKillQuestion[];
  onOpenCard: (cardId: string) => void;
  onOpenWiki: (target: string, section?: string) => void;
  query: string;
}) {
  // 当日の使い方：一問ずつ声に出す。読み終えたら「言えた」を押して次へ。
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [openWhy, setOpenWhy] = useState<ReadonlySet<string>>(new Set());
  const refs = { onOpenCard, onOpenWiki, query };
  const toggle = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  return (
    <div className="kill-map">
      <header className="kill-map-head">
        <div>
          <strong>{done.size} / {questions.length}</strong>
          <span>声に出して確認できた数</span>
        </div>
        <i aria-hidden="true"><em style={{ width: `${(done.size / questions.length) * 100}%` }} /></i>
        {done.size > 0 && (
          <button type="button" onClick={() => setDone(new Set())}>リセット</button>
        )}
      </header>

      {questions.map((question, index) => (
        <section
          key={question.id}
          className={`kill-card ${done.has(question.id) ? "done" : ""}`}
          aria-label={question.ask}
        >
          <header>
            <b>{index + 1}</b>
            <div>
              <h3>{question.ask}</h3>
              {question.meta && <small>{question.meta}</small>}
            </div>
            <button
              type="button"
              className={done.has(question.id) ? "on" : ""}
              onClick={() => setDone((current) => toggle(current, question.id))}
            >{done.has(question.id) ? "✓ 言えた" : "言えた"}</button>
          </header>

          {question.resolved ? (
            <div className="kill-answer">
              <Blocks blocks={question.answer} refs={refs} />
            </div>
          ) : (
            // 参照が外れたら黙って空にしない——当日「答案が無い」ことに気づけないのが最悪
            <p className="kill-missing">
              ⚠️ 答案「{question.source}」がこの準備稿の中に見つかりません。
              vault 側の <code>答案::</code> と見出しがずれています。
            </p>
          )}

          {question.followUp.length > 0 && (
            <details className="kill-followup">
              <summary>追問されたら <i aria-hidden="true">⌄</i></summary>
              <Blocks blocks={question.followUp} refs={refs} />
            </details>
          )}

          {question.mine && (
            <p className="kill-mine">
              <span>地雷</span>
              <Inlines nodes={question.mine} refs={refs} />
            </p>
          )}

          {question.why.length > 0 && (
            <div className="kill-why">
              <button
                type="button"
                aria-expanded={openWhy.has(question.id)}
                onClick={() => setOpenWhy((current) => toggle(current, question.id))}
              >
                なぜこう答えるか <i aria-hidden="true">{openWhy.has(question.id) ? "−" : "＋"}</i>
              </button>
              {openWhy.has(question.id) &&
                question.why.map((nodes, whyIndex) => (
                  <p key={whyIndex}><Inlines nodes={nodes} refs={refs} /></p>
                ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function SessionQuickActions({
  motivationAsset,
  onOpenCard,
  onOpenAsset,
}: {
  motivationAsset: SharedAssetTarget | null;
  onOpenCard: (cardId: string) => void;
  onOpenAsset: (asset: SharedAssetTarget) => void;
}) {
  const phraseAsset = SHARED_ASSETS.find(
    (asset): asset is SharedAssetTarget => "note" in asset && asset.note === "当日フレーズ集",
  );
  return (
    <div className="session-quick-actions" aria-label="冲刺时常用话术">
      {motivationAsset && (
        <button type="button" onClick={() => onOpenAsset(motivationAsset)}>
          <span>20秒</span>
          志望動機
        </button>
      )}
      <button type="button" onClick={() => onOpenCard("p01")}>
        <span>30秒</span>
        自己紹介
      </button>
      {phraseAsset && (
        <button type="button" onClick={() => onOpenAsset(phraseAsset)}>
          <span>救场</span>
          当日フレーズ
        </button>
      )}
    </div>
  );
}

function SessionConfirm({
  doc,
  digest,
}: {
  doc: InterviewPrepDoc;
  digest: ReturnType<typeof buildDigest>;
}) {
  const quick = prepSectionByNumber(doc, 1);
  const live = prepSubsection(quick, LIVE_FRAME_RE);
  const goal = prepSubsection(quick, /今日のゴール/);
  const position = prepSubsection(quick, /一文の定位/);
  const opening = prepBlockAfterLead(live, /^開幕/);
  const closing = prepBlockAfterLead(live, /^最後/);
  const fallback = quick?.blocks.slice(0, 5) ?? [];

  return (
    <section className="session-confirm" aria-label="30秒确认">
      <header>
        <div>
          <span>本场唯一目标</span>
          <h2>现在只确认，不再学习新内容</h2>
        </div>
        {digest && digest.tags.some((tag) => tag.repeated) && (
          <ul>
            {digest.tags.filter((tag) => tag.repeated).slice(0, 3).map((tag) => (
              <li key={tag.tag}>{tag.label}</li>
            ))}
          </ul>
        )}
      </header>

      <div className="session-confirm-goal">
        {goal.length > 0 ? <Blocks blocks={goal} /> : <Blocks blocks={fallback.slice(0, 2)} />}
      </div>

      <div className="session-confirm-grid">
        <section className="session-confirm-script">
          <span>开场 · 直接朗读</span>
          {opening.length > 0 ? <Blocks blocks={opening} /> : <Blocks blocks={fallback} />}
        </section>
        <div className="session-confirm-side">
          <section>
            <span>一句定位</span>
            {position.length > 0 ? <Blocks blocks={position} /> : <p>先说结论，再用一个事实支撑。</p>}
          </section>
          <section className="session-confirm-close">
            <span>结束 · 必须说</span>
            {closing.length > 0 ? <Blocks blocks={closing} /> : <p>明确表达长期加入和贡献的意愿。</p>}
          </section>
        </div>
      </div>
    </section>
  );
}

/**
 * 冲刺の枠内は `###` を持たず、**開幕（そのまま読む）** のような太字だけの段落で区切られている。
 * その段落を小見出しとみなして、目次を作れる単位に切る。
 */
function sprintHeadingLabel(block: PrepBlock): string | null {
  if (block.kind === "heading") return prepInlineText(block.inline).trim() || null;
  if (block.kind !== "paragraph") return null;
  const meaningful = block.inline.filter(
    (node) => !(node.kind === "text" && !node.text.trim()),
  );
  if (meaningful.length === 0) return null;
  if (!meaningful.every((node) => node.kind === "strong")) return null;
  const text = prepInlineText(block.inline).trim();
  // 長い太字の一文（台詞や強調）を見出しと誤認しないための上限
  return text && text.length <= 40 ? text : null;
}

/** 目次に出す短いラベル。「🔴 受けて止めるだけの質問（時間を使わない）」→「受けて止めるだけの質問」 */
function sprintNavLabel(label: string) {
  const withoutMark = label.replace(/^[\s🔴🔺⭐⚠️✅⛔▶▷#*]+/u, "").trim();
  const head = withoutMark.split("（")[0]?.trim();
  return (head || withoutMark).slice(0, 16);
}

function sprintGroups(blocks: PrepBlock[]) {
  const groups: { id: string; navLabel: string; blocks: PrepBlock[] }[] = [];
  blocks.forEach((block, index) => {
    const label = sprintHeadingLabel(block);
    if (label) {
      groups.push({ id: `sprint-g${index}`, navLabel: sprintNavLabel(label), blocks: [block] });
      return;
    }
    if (groups.length === 0) {
      groups.push({ id: "sprint-g0", navLabel: "冒頭", blocks: [] });
    }
    groups[groups.length - 1].blocks.push(block);
  });
  return groups;
}

function SessionSprint({
  doc,
  motivationAsset,
  onOpenCard,
  onOpenAsset,
}: {
  doc: InterviewPrepDoc;
  motivationAsset: SharedAssetTarget | null;
  onOpenCard: (cardId: string) => void;
  onOpenAsset: (asset: SharedAssetTarget) => void;
}) {
  const blocks = useMemo(() => {
    const quick = prepSectionByNumber(doc, 1);
    const live = prepSubsection(quick, LIVE_FRAME_RE);
    return live.length > 0 ? live : (quick?.blocks ?? []);
  }, [doc]);
  const groups = useMemo(() => sprintGroups(blocks), [blocks]);
  const [active, setActive] = useState<string>("");
  const bodyRef = useRef<HTMLDivElement>(null);

  // 読んでいる位置を目次に映す。冲刺は縦に長いので、現在地が分からないと目次が飾りになる。
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || groups.length === 0) return;
    const targets = groups
      .map((group) => root.querySelector<HTMLElement>(`#${CSS.escape(group.id)}`))
      .filter((node): node is HTMLElement => node !== null);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-12% 0px -70% 0px", threshold: 0 },
    );
    targets.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [groups]);

  return (
    <section className="session-sprint" aria-label="5分钟冲刺">
      <header>
        <div>
          <span>5分钟冲刺</span>
          <h2>按真实开口顺序热身一次</h2>
          <p>开场 → 高概率问题第一声 → 救场话术 → 反向提问 → 收尾</p>
        </div>
        <SessionQuickActions
          motivationAsset={motivationAsset}
          onOpenCard={onOpenCard}
          onOpenAsset={onOpenAsset}
        />
      </header>
      <div className="session-sprint-layout">
        {groups.length > 1 && (
          <nav className="session-sprint-toc" aria-label="冲刺の目次">
            <span>この枠の順序</span>
            <ol>
              {groups.map((group, index) => (
                <li key={group.id}>
                  <a
                    href={`#${group.id}`}
                    className={active === group.id ? "active" : ""}
                    aria-current={active === group.id ? "true" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      bodyRef.current
                        ?.querySelector(`#${CSS.escape(group.id)}`)
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      setActive(group.id);
                    }}
                  >
                    <em>{String(index + 1).padStart(2, "0")}</em>
                    {group.navLabel}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="session-sprint-body" ref={bodyRef} onCopy={copySelectionWithoutRuby}>
          {groups.length > 1 ? (
            groups.map((group) => (
              <div key={group.id} id={group.id} className="session-sprint-group">
                <Blocks blocks={group.blocks} />
              </div>
            ))
          ) : (
            <Blocks blocks={blocks} />
          )}
        </div>
      </div>
    </section>
  );
}

function DocReader({
  doc,
  onOpenCard,
  onOpenWiki,
}: {
  doc: InterviewPrepDoc;
  onOpenCard: (cardId: string) => void;
  onOpenWiki: (target: string, section?: string) => void;
}) {
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLElement>(null);
  // §6 の「殺傷質問7題・当日の型」と「人材育成」は、当日その一枚を直接開きたいので
  // 表示層で第7・第8主模块に昇格させる。vault は12節契約のままで、実体は §6 の小節のコピー。
  const killMap = useMemo(() => extractPrepKillMap(doc.sections), [doc.sections]);
  const killQuestions = useMemo(() => buildPrepKillQuestions(doc.sections), [doc.sections]);
  const talentMap = useMemo(() => extractPrepTalentMap(doc.sections), [doc.sections]);
  const virtualSections = useMemo(
    () => [killMap, talentMap].filter((section): section is PrepSection => section !== null),
    [killMap, talentMap],
  );
  const sections = useMemo(
    () => [...doc.sections, ...virtualSections],
    [doc.sections, virtualSections],
  );
  const groups = useMemo(() => {
    const base = groupPrepSections(doc.sections);
    return [
      ...base,
      ...virtualSections.map((section, offset) => ({
        id: section.id,
        label: section.navLabel,
        sectionIndexes: [doc.sections.length + offset],
      })),
    ];
  }, [doc.sections, virtualSections]);
  const current = sections[active];
  const isKillMap =
    Boolean(killMap) && active === doc.sections.length && killQuestions.length > 0;
  const activeGroupIndex = Math.max(
    0,
    groups.findIndex((group) => group.sectionIndexes.includes(active)),
  );
  const currentGroup = groups[activeGroupIndex];
  const broken = doc.embeds.filter((embed) => !embed.resolved);
  const keyword = query.trim();

  // 節ごとの素テキスト。1節しか描画しない＝Ctrl+F が使えないので、検索は自前で持つ
  // 第7・第8模块は §6 の小節の写しなので、検索索引には入れない（同じ文が2回ヒットする）。
  // 検索は本体である §6 に当て、7・8 はあくまで当日用のショートカット表示に留める。
  const plain = useMemo(
    () =>
      sections.map((section, index) =>
        index >= doc.sections.length
          ? ""
          : section.blocks.map(prepBlockText).join("\n").toLocaleLowerCase(),
      ),
    [sections, doc.sections.length],
  );
  const hits = useMemo(() => {
    if (!keyword) return [];
    const needle = keyword.toLocaleLowerCase();
    return sections
      .map((section, index) => ({
        index,
        title: section.title,
        navLabel: section.navLabel,
        count: plain[index].split(needle).length - 1,
      }))
      .filter((item) => item.count > 0);
  }, [sections, keyword, plain]);
  const totalHits = hits.reduce((sum, item) => sum + item.count, 0);

  // 長い節は小節へ直接飛べないと使えない（単語文法帳＝6,600px・10小節）。
  // 逆に1画面半で収まる節（会社研究リンク集＝855字）に小節ナビを出すのは邪魔なだけ。
  // 実測では 1,500字あたりが「2画面を超える」境目だった
  const needsSubnav = (plain[active]?.length ?? 0) >= 1500;
  // 目次と本文見出しは同じ採番を共有する：長い節（速査は1画面に収まらない）の途中でも
  // 「05 今日のゴール」の番号から現在地と全体の骨組みが分かる。
  const { subheads, headingNumbers } = useMemo(() => {
    const items: { id: string; no: number; text: string; full: string }[] = [];
    const numbers = new Map<number, number>();
    if (!current) return { subheads: items, headingNumbers: numbers };
    // 埋め込み資産の小節見出しは小節ナビに並べない：単語文法帳だけで10小節あり、
    // 本輪の増分の目次が資産の目次に埋まってしまう。資産は畳み1枚＝ナビ1項にする。
    let lastEmbedKey: string | null = null;
    current.blocks.forEach((block, index) => {
      if (block.embed) {
        const key = `${block.embed.target}#${block.embed.section}`;
        if (key !== lastEmbedKey) {
          numbers.set(index, items.length + 1);
          items.push({
            id: `prep-embed-${index}`,
            no: items.length + 1,
            text: `📎 ${shortLabel(block.embed.target, 10)}`,
            full: `${block.embed.target}${block.embed.section ? ` › ${block.embed.section}` : ""}（全局共用）`,
          });
        }
        lastEmbedKey = key;
        return;
      }
      lastEmbedKey = null;
      if (block.kind !== "heading" || block.level !== 3) return;
      const full = prepInlineText(block.inline);
      // 「3つの数字（信用状。開口一番の売り文句にはしない）」のような長い見出しは
      // 括弧を落として核だけ出す。全文は title で見える
      numbers.set(index, items.length + 1);
      items.push({ id: `prep-h-${index}`, no: items.length + 1, text: subsectionTabLabel(full), full });
    });
    return { subheads: items, headingNumbers: numbers };
  }, [current]);

  // 側に常駐する目次の「現在地」。ヒット行スクロールや goToSection と同じく window 基準。
  // しきい値 210 は h3 の scroll-margin-top(180) より少し下——目次から跳んだ直後にその項が光る。
  const [activeSubhead, setActiveSubhead] = useState<string | null>(null);
  useEffect(() => {
    const compute = () => {
      let id: string | null = null;
      for (const item of subheads) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= 210) id = item.id;
        else break;
      }
      setActiveSubhead(id);
    };
    // 初回は描画後に一度だけ測る（effect 内の同期 setState は連鎖レンダーになるため避ける）
    const timer = window.setTimeout(compute, 0);
    window.addEventListener("scroll", compute, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", compute);
    };
  }, [subheads]);

  // 側栏の滑走インジケータ。位置は描画後の実測なので、状態を経由せず直接 style に書く
  // （scroll のたびに変わり得る値を state にすると無駄な再レンダーの波になる）。
  const subnavRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const nav = subnavRef.current;
    const indicator = nav?.querySelector<HTMLElement>(".subnav-indicator");
    if (!indicator) return;
    const link = nav?.querySelector<HTMLElement>("a.active");
    if (!link) {
      indicator.style.opacity = "0";
      return;
    }
    indicator.style.opacity = "1";
    indicator.style.top = `${link.offsetTop}px`;
    indicator.style.height = `${link.offsetHeight}px`;
  }, [activeSubhead, subheads]);

  const goToSection = useCallback((index: number) => {
    setActive(index);
    // sticky の上栏＋二層ナビの高さは群によって変わる。素の scrollIntoView だと
    // 切替後の h2 がナビの裏に隠れるため、描画後の実測高で着地点を補正する。
    window.setTimeout(() => {
      const body = bodyRef.current;
      const bar = document.querySelector<HTMLElement>(".prep-doc-bar");
      if (!body) return;
      const offset = 76 + (bar?.getBoundingClientRect().height ?? 0) + 8;
      window.scrollTo({ top: body.getBoundingClientRect().top + window.scrollY - offset });
    }, 0);
  }, []);
  const goToGroup = useCallback(
    (index: number) => {
      const firstSection = groups[index]?.sectionIndexes[0];
      if (firstSection !== undefined) goToSection(firstSection);
    },
    [goToSection, groups],
  );

  // 検索でヒットした節に入ったら、最初のヒットまでスクロールする
  useEffect(() => {
    if (!keyword) return;
    const timer = window.setTimeout(() => {
      bodyRef.current?.querySelector(".prep-doc-hit")?.scrollIntoView({ block: "center" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [keyword, active]);

  // 「/」で検索欄へ・Escape で消す、の2つは PrepSearchBox 側が持つ。
  // ここに残すのは群の左右送りだけ——以前は Escape も window で拾っていて、
  // 画面内の別の入力欄で Escape を押しただけで検索語が消えていた。
  useSlashFocus(searchRef);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowRight" && activeGroupIndex < groups.length - 1) {
        event.preventDefault();
        goToGroup(activeGroupIndex + 1);
      }
      if (event.key === "ArrowLeft" && activeGroupIndex > 0) {
        event.preventDefault();
        goToGroup(activeGroupIndex - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeGroupIndex, goToGroup, groups.length]);

  if (doc.sections.length === 0) {
    return <p className="prep-no-result">这份准备笔记还没有 ## 章节。</p>;
  }

  return (
    <>
      {broken.length > 0 && (
        <p className="prep-doc-broken">
          ⚠️ {broken.length} 处引用没解析出来，对应章节是空的：{broken.map((embed) => embed.raw).join("、")}
          <br />
          跑 <code>npm run vault:check</code> 会指出笔记名或节名哪里对不上。
        </p>
      )}

      <div className="prep-doc-bar">
        <nav className="prep-doc-nav" aria-label="主模块">
          {groups.map((group, index) => (
            <button
              key={group.id}
              type="button"
              className={index === activeGroupIndex ? "active" : ""}
              onClick={() => goToGroup(index)}
            >
              <b>{index + 1}</b>
              {group.label}
              {keyword && hits.some((hit) => group.sectionIndexes.includes(hit.index)) && <i aria-hidden="true" />}
            </button>
          ))}
        </nav>
        <PrepSearchBox
          className="prep-doc-search"
          value={query}
          onChange={setQuery}
          inputRef={searchRef}
          placeholder="全章搜索（/ 聚焦）"
          label="在这份准备文档里搜索"
        />

        {currentGroup?.sectionIndexes.length > 1 && (
          <nav className="prep-doc-section-tabs" aria-label={`${currentGroup.label}の子項目`}>
            <span>{currentGroup.label}</span>
            {currentGroup.sectionIndexes.map((sectionIndex) => {
              const section = sections[sectionIndex];
              return (
                <button
                  key={section.id}
                  type="button"
                  className={sectionIndex === active ? "active" : ""}
                  onClick={() => goToSection(sectionIndex)}
                  title={section.title}
                >
                  {sectionTabLabel(section.title)}
                  {keyword && hits.some((hit) => hit.index === sectionIndex) && <i aria-hidden="true" />}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {keyword && (
        <div className="prep-doc-hits">
          {totalHits === 0 ? (
            <span className="none">「{keyword}」在这份文档里没有命中</span>
          ) : (
            <>
              <span>{totalHits} 处命中 ·</span>
              {hits.map((hit) => (
                <button
                  key={hit.index}
                  type="button"
                  className={hit.index === active ? "active" : ""}
                  onClick={() => goToSection(hit.index)}
                  title={hit.title}
                >{hit.navLabel} <b>{hit.count}</b></button>
              ))}
            </>
          )}
        </div>
      )}

      {/* 振り仮名は読むための飾りで、貼り付け先には要らない。ここを外すと
          「肖侃しょう・かん」のようにコピー結果へ読みが混ざる——当日いちばん多く
          選択される画面なので、他の2画面と同じく rt/rp を落として渡す。 */}
      <div className="prep-doc-main">
        {!isKillMap && needsSubnav && subheads.length >= 3 && (
          <nav className="prep-doc-subnav" aria-label="小节" ref={subnavRef}>
            <span className="subnav-label">この節の構成 · {subheads.length}</span>
            <div className="subnav-items">
              <i className="subnav-indicator" aria-hidden="true" />
              {subheads.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  title={item.full}
                  className={item.id === activeSubhead ? "active" : ""}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(item.id)?.scrollIntoView({ block: "start" });
                  }}
                >
                  <b>{String(item.no).padStart(2, "0")}</b>
                  <span>{item.text}</span>
                </a>
              ))}
            </div>
          </nav>
        )}
        <article className="prep-doc-body" ref={bodyRef} onCopy={copySelectionWithoutRuby}>
          <h2>{current.title}</h2>
          {isKillMap ? (
            <KillMapPage
              questions={killQuestions}
              onOpenCard={onOpenCard}
              onOpenWiki={onOpenWiki}
              query={keyword}
            />
          ) : (
            <Blocks
              blocks={current.blocks}
              refs={{ onOpenCard, onOpenWiki, query: keyword }}
              collapseEmbeds
              headingNumbers={headingNumbers}
            />
          )}
        </article>
      </div>

      <div className="prep-doc-pager">
        <button
          type="button"
          disabled={activeGroupIndex === 0}
          onClick={() => goToGroup(activeGroupIndex - 1)}
        >← 上一模块</button>
        <span>
          {activeGroupIndex + 1} / {groups.length} · {currentGroup?.label}
          <em>←→ 切换主模块</em>
        </span>
        <button
          type="button"
          disabled={activeGroupIndex === groups.length - 1}
          onClick={() => goToGroup(activeGroupIndex + 1)}
        >下一模块 →</button>
      </div>
    </>
  );
}

function ExternalSources({
  links,
  roundCount,
}: {
  links: PrepExternalLink[];
  roundCount: number;
}) {
  const featured = [
    ...links.filter((link) => link.starred),
    ...links.filter((link) => !link.starred),
  ].slice(0, 3);
  const groups = [...new Set(links.map((link) => link.group))];
  if (links.length === 0) return null;

  return (
    <section className="session-sources" aria-label="案件共用外部资料">
      <header>
        <span>案件共用资料</span>
        <p>截至本轮累计 {roundCount} 轮；不会混入之后才获得的资料</p>
      </header>
      <div className="session-source-featured">
        {featured.map((link) => (
          <a key={link.href} href={link.href} title={link.href} target="_blank" rel="noopener noreferrer">
            <small>{link.group}</small>
            <strong>{link.label}</strong>
            <i aria-hidden="true">↗</i>
          </a>
        ))}
      </div>
      <details>
        <summary>展开全部 {links.length} 个链接</summary>
        <div className="session-source-groups">
          {groups.map((group) => (
            <section key={group}>
              <h3>{group}</h3>
              <div className="session-source-links">
                {links.filter((link) => link.group === group).map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    title={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.starred && <b>★</b>}
                    <span>{link.label}</span>
                    <i aria-hidden="true">↗</i>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      </details>
    </section>
  );
}

function SessionAssets({
  motivationAsset,
  onOpenCard,
  onOpenAsset,
}: {
  motivationAsset: SharedAssetTarget | null;
  onOpenCard: (cardId: string) => void;
  onOpenAsset: (asset: SharedAssetTarget) => void;
}) {
  return (
    <section className="session-assets" aria-label="本轮专属与全局共用的面试话术">
      <span>本轮专属</span>
      {motivationAsset ? (
        <button
          type="button"
          className="company-motivation"
          onClick={() => onOpenAsset(motivationAsset)}
          title={motivationAsset.hint}
        >
          <small>20秒</small>
          志望動機
        </button>
      ) : (
        <button
          type="button"
          className="company-motivation missing"
          disabled
          title="这份面试准备的 §6 还没有公司专属志望動機"
        >
          志望動機未准备
        </button>
      )}
      <i className="session-assets-separator" aria-hidden="true" />
      <span>全局共用</span>
      {SHARED_ASSETS.map((asset) => (
        <button
          key={"cardId" in asset ? asset.cardId : asset.note}
          type="button"
          onClick={() => {
            if ("cardId" in asset) onOpenCard(asset.cardId);
            else onOpenAsset(asset);
          }}
          title={asset.hint}
        >
          {asset.label}
        </button>
      ))}
      <button type="button" className="to-library" onClick={() => onOpenCard("p01")}>
        回答库 →
      </button>
    </section>
  );
}

export default function InterviewSession({
  notes,
  onOpen,
  onOpenWiki,
  onOpenCard,
  onOpenAsset,
  initialCompany = "",
  initialPath = "",
  onSelectionChange,
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  onOpenWiki: (target: string, section?: string) => void;
  onOpenCard: (cardId: string) => void;
  onOpenAsset: (asset: SharedAssetTarget) => void;
  initialCompany?: string;
  initialPath?: string;
  onSelectionChange?: (company: string, prepPath: string) => void;
}) {
  const docs = useMemo(() => findInterviewPrepDocs(notes), [notes]);
  const today = localDateKey();
  const series = useMemo(() => groupInterviewPrepDocs(docs), [docs]);
  const digest = useMemo(() => buildDigest(notes), [notes]);
  // 既定で開くのは「次の確定面接 → 日程調整中の次回 → 直近の終了回」。
  const [selectedPath, setSelectedPath] = useState<string | null>(() => {
    const exact = initialPath
      ? docs.find((doc) => doc.note.path === initialPath) ?? null
      : null;
    const companyKey = calendarCompanyIdentity(initialCompany);
    const companySeries = companyKey
      ? series.find((item) => calendarCompanyIdentity(item.company) === companyKey) ?? null
      : null;
    return (exact ??
      (companySeries ? selectRelevantInterviewPrepDoc(companySeries.rounds, today) : null))
      ?.note.path ?? null;
  });
  const selected =
    docs.find((doc) => doc.note.path === selectedPath) ??
    selectRelevantInterviewPrepDoc(docs, today);
  const selectDoc = (doc: InterviewPrepDoc) => {
    setSelectedPath(doc.note.path);
    onSelectionChange?.(doc.company, doc.note.path);
  };
  const [sessionModeChoice, setSessionModeChoice] = useState<{
    path: string | null;
    mode: SessionMode;
  }>(() => ({
    path: selected?.note.path ?? null,
    mode: selected ? defaultSessionMode(selected, today) : "deep",
  }));
  const sessionMode =
    selected && sessionModeChoice.path === selected.note.path
      ? sessionModeChoice.mode
      : selected
        ? defaultSessionMode(selected, today)
        : "deep";
  const selectedSeries = selected
    ? interviewPrepSeriesForDoc(series, selected)
    : null;
  const sourceDocs =
    selected && selectedSeries
      ? prepDocsThroughRound(selectedSeries, selected)
      : selected
        ? [selected]
        : [];
  const externalLinks = mergePrepExternalLinks(sourceDocs);
  const duplicateCompanyNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of series) {
      counts.set(item.company, (counts.get(item.company) ?? 0) + 1);
    }
    return counts;
  }, [series]);
  const motivationAsset = selected
    ? companyMotivationAssetTarget(selected)
    : null;
  const basicInfo = selected
    ? prepSubsection(prepSectionByNumber(selected, 1), /基本情報/)
    : [];
  const dateTimeDetail = prepTableValue(basicInfo, "日時");
  const placeDetail = prepTableValue(basicInfo, "場所");

  // 当日は文書をすぐ読みたいので、既定は1行に畳んでおく。中身は展開すれば出る
  const digestBand = digest && (
    <details className="prep-weakness">
      <summary>
        <span>本轮提醒</span>
        {digest.weakestDimension && (
          <em>
            五维最弱 <b>{REVIEW_DIMENSION_META[digest.weakestDimension].label}</b>
            {" "}平均 {digest.dimensionAverages[digest.weakestDimension]}
          </em>
        )}
        <ul className="prep-weakness-peek">
          {digest.tags.filter((tag) => tag.repeated).slice(0, 3).map((tag) => (
            <li key={tag.tag} className={tag.inLatest ? "hot" : ""}>
              {tag.label}
              {tag.inLatest && <i>最近一场仍出现</i>}
            </li>
          ))}
        </ul>
      </summary>
      <div className="prep-weakness-body">
        <p>根据 {digest.interviews.length} 场回答质量复盘统计；正本来自 vault 的「面接傾向_横断」。</p>
        <ul>
          {digest.tags.filter((tag) => tag.repeated).map((tag) => (
            <li key={tag.tag} className={tag.inLatest ? "hot" : ""}>
              <strong>{tag.label}</strong>
              <span>{tag.interviews} / {digest.interviews.length} 场 · {tag.occurrences} 问</span>
              {tag.inLatest && <i>最近一场仍出现</i>}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );

  if (docs.length === 0) {
    return (
      <div className="prep-view">
        <header className="prep-hero">
          <div>
            <p className="eyebrow"><i /> THIS INTERVIEW · 単場の準備</p>
            <h1>本场面试</h1>
            <p>某一家公司、某一场面试的准备文档。共通の話術は「面试准备」の回答库が正本で、ここには**その回に固有の内容**だけが載る。</p>
          </div>
        </header>
        {digestBand}
        <div className="prep-empty">
          <span>NO PREP DOC YET</span>
          <h1>还没有单场面试的准备文档</h1>
          <p>
            这里读取 vault 里 <code>type: interview-prep</code> 的笔记
            （每轮一份，例如 <code>20_求職/&lt;会社&gt;/面接準備_案件_s02_一次面接.md</code>）。
          </p>
          <p>
            要新建一份，把面接連絡邮件或求人 URL 交给 AI，说「帮我准备〇〇社的面试」即可
            —— <code>japan-interview-prep</code> skill 会先读同一案件的旧轮次和复盘，再新建本轮笔记。
            日程未定也可以先进入 <code>preparing</code>，不会覆盖上一轮。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`prep-view session-view mode-${sessionMode}`}>
      {selected && (
        <>
          <header className="session-hero feature-shell feature-shell-light">
            <div className="session-hero-main">
              <p className="eyebrow">
                <i />
                当前面试
                <b
                  className={
                    ["preparing", "scheduled", "upcoming"].includes(
                      interviewPrepTemporalStatus(selected, today),
                    )
                      ? "future"
                      : ""
                  }
                >
                  {countdownLabel(selected.date)}
                </b>
                {hasInterviewDate(selected.date) && (
                  <span>{formatDate(selected.date, true)}</span>
                )}
              </p>
              <h1>{selected.company || selected.title}</h1>
            </div>
            <div className="session-hero-side">
              {series.length > 1 && (
                <label className="session-company-switch">
                  <span>公司／应募案件</span>
                  <select
                    aria-label="切换公司或应募案件"
                    value={selectedSeries?.key ?? ""}
                    onChange={(event) => {
                      const nextSeries = series.find(
                        (item) => item.key === event.target.value,
                      );
                      const next = nextSeries
                        ? selectRelevantInterviewPrepDoc(nextSeries.rounds, today)
                        : null;
                      if (next) selectDoc(next);
                    }}
                  >
                    {series.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.company}
                        {duplicateCompanyNames.get(item.company)! > 1 && item.caseLink
                          ? `｜${item.caseLink}`
                          : ""}
                        {`（${item.rounds.length}轮）`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(selectedSeries?.rounds.length ?? 0) > 1 && (
                <label className="session-company-switch session-round-switch">
                  <span>面试轮次</span>
                  <select
                    aria-label="切换当前公司的面试轮次"
                    value={selected.note.path}
                    onChange={(event) => {
                      const next = docs.find((doc) => doc.note.path === event.target.value);
                      if (next) selectDoc(next);
                    }}
                  >
                    {selectedSeries?.rounds.map((doc, index) => (
                      <option key={doc.note.path} value={doc.note.path}>
                        {`第 ${doc.sessionOrder ?? index + 1}/${selectedSeries.rounds.length} 轮 · `}
                        {doc.round || "轮次未命名"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <details className="session-hero-more">
                <summary>更多</summary>
                <div>
                  <button type="button" onClick={() => onOpen(selected.note)}>
                    打开 Obsidian 原笔记 ↗
                  </button>
                  {selected.caseLink && (
                    <button type="button" onClick={() => onOpenWiki(selected.caseLink)}>
                      打开案件正本 ↗
                    </button>
                  )}
                </div>
              </details>
            </div>

            <dl className="session-context-meta">
              <div>
                <dt>时间</dt>
                <dd>{dateTimeDetail || (hasInterviewDate(selected.date) ? formatDate(selected.date, true) : "日程待定")}</dd>
              </div>
              <div>
                <dt>轮次</dt>
                <dd>{selected.round || "轮次未命名"}</dd>
              </div>
              <div>
                <dt>形式／地点</dt>
                <dd>{placeDetail || selected.format || "未填写"}</dd>
              </div>
              <div>
                <dt>面试官</dt>
                <dd>{selected.interviewers || "未定"}</dd>
              </div>
            </dl>
          </header>

          <nav className="session-mode-nav" aria-label="准备模式">
            <div>
              {SESSION_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={sessionMode === mode.id ? "active" : ""}
                  aria-current={sessionMode === mode.id ? "page" : undefined}
                  onClick={() => setSessionModeChoice({ path: selected.note.path, mode: mode.id })}
                >
                  <span>{mode.duration}</span>
                  <strong>{mode.label}</strong>
                  <small>{mode.description}</small>
                </button>
              ))}
            </div>
            <p>按离面试还有多少时间，选择现在真正需要的信息。</p>
          </nav>

          {digestBand}

          {sessionMode === "confirm" && <SessionConfirm doc={selected} digest={digest} />}
          {sessionMode === "sprint" && (
            <SessionSprint
              doc={selected}
              motivationAsset={motivationAsset}
              onOpenCard={onOpenCard}
              onOpenAsset={onOpenAsset}
            />
          )}
          {sessionMode === "deep" && (
            <DocReader
              key={selected.note.path}
              doc={selected}
              onOpenCard={onOpenCard}
              onOpenWiki={onOpenWiki}
            />
          )}

          <details className="session-toolbox">
            <summary>
              <span>资料与工具</span>
              <small>{externalLinks.length} 个研究来源 · 本轮话术与全局回答库</small>
              <i aria-hidden="true">＋</i>
            </summary>
            <div className="session-toolbox-body">
              <ExternalSources
                links={externalLinks}
                roundCount={sourceDocs.length}
              />
              <SessionAssets
                motivationAsset={motivationAsset}
                onOpenCard={onOpenCard}
                onOpenAsset={onOpenAsset}
              />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
