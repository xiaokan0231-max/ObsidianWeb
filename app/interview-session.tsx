"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildPrepKillQuestions,
  extractPrepBriefing,
  extractPrepKillMap,
  extractPrepTalentMap,
  findInterviewPrepDocs,
  groupPrepSections,
  prepBlockText,
  prepInlineText,
  prepSectionNumber,
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
import PrepMaterialReader from "./prep-material-reader";
import InterviewSessionV2 from "./interview-session-v2";
import { buildCompanyOverviews, resolveCompanyOverview, type CompanyOverview } from "@/lib/company-overview";
import CompanyOverviewContent, { COMPANY_COMPARE_LIMIT, CompanyCompare, CompanyCompareButton, CompanyCompareSelector, CompanyCompareTray, toggleCompanyComparison } from "./company-overview";
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

type SessionMode = "brief" | "sprint" | "deep";

const SESSION_MODES: {
  id: SessionMode;
  duration: string;
  label: string;
  description: string;
}[] = [
  { id: "brief", duration: "通读", label: "导读", description: "这场面谈的来龙去脉" },
  { id: "sprint", duration: "5分钟", label: "冲刺", description: "按临场顺序快速热身" },
  { id: "deep", duration: "完整", label: "深度准备", description: "公司、问答与全部材料" },
];

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

function prepTableValue(blocks: PrepBlock[], label: string) {
  for (const block of blocks) {
    if (block.kind !== "table") continue;
    const row = block.rows.find((cells) => prepInlineText(cells[0] ?? []) === label);
    if (row?.[1]) return prepInlineText(row[1]);
  }
  return "";
}

/**
 * 当日〜前日は「開く道具」、それより前は「まず一度通して読む」。
 * 導読を持たない回（他社の準備稿）は従来どおり深度準備から入る。
 */
function defaultSessionMode(doc: InterviewPrepDoc, today: string, hasBriefing: boolean): SessionMode {
  if (!hasInterviewDate(doc.date)) return hasBriefing ? "brief" : "deep";
  const interviewDay = new Date(`${doc.date}T00:00:00`).getTime();
  const currentDay = new Date(`${today}T00:00:00`).getTime();
  const days = Math.round((interviewDay - currentDay) / 86_400_000);
  if (days <= 1) return "sprint";
  return hasBriefing ? "brief" : "deep";
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
  const number = prepSectionNumber(title);
  return SECTION_TAB_LABELS[number] ?? shortLabel(normalized.replace(/^\d+[.、．]\s*/, ""), 10);
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

/**
 * 導読＝この面接がどういう局面なのかを、面談の数日前に一度通して読むための本文。
 * 速査や想定問答と違って**その場で引く道具ではない**ので、探すための装飾（チップ・
 * 折り畳み・目次）は付けず、読みやすい一段組みの文章としてだけ出す。
 */
function SessionBrief({
  briefing,
  meta,
}: {
  briefing: PrepSection;
  meta: { company: string; round: string };
}) {
  // 見出しの id は Blocks が付ける `prep-h-<ブロック下標>`。同じ配列を渡すので下標は一致する。
  const headings = useMemo(
    () =>
      briefing.blocks
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => block.kind === "heading")
        .map(({ block, index }) => ({
          id: `prep-h-${index}`,
          label: block.kind === "heading" ? prepInlineText(block.inline).trim() : "",
        })),
    [briefing.blocks],
  );
  const [active, setActive] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  // 長い読み物なので現在地が分からないと目次が飾りになる（冲刺と同じ扱い）
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || headings.length === 0) return;
    const targets = headings
      .map((heading) => root.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`))
      .filter((node): node is HTMLElement => node !== null);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-10% 0px -72% 0px", threshold: 0 },
    );
    targets.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [headings]);

  return (
    <article className="session-brief" aria-label="导读">
      <header>
        <div>
          <span>面谈前通读一次</span>
          <h2>{meta.company}／{meta.round}</h2>
          <p>
            读完这一篇，就能整体明白这场面谈是怎么回事：对方是谁、这家公司和这个岗位是什么、
            我的定位在哪、以及我自己最容易栽的地方。具体话术在「冲刺」和「深度准备」里。
          </p>
        </div>
      </header>
      <div className="session-brief-main">
        {headings.length > 1 && (
          <nav className="session-brief-index" aria-label="导读目录">
            <span>目录</span>
            <ol>
              {headings.map((heading, index) => (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    className={heading.id === active ? "active" : ""}
                    aria-current={heading.id === active ? "true" : undefined}
                  >
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span>{heading.label}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="session-brief-body" ref={bodyRef}>
          <Blocks blocks={briefing.blocks} />
        </div>
      </div>
    </article>
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
  const [readerOpen, setReaderOpen] = useState(false);
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
        <button type="button" className="reader-entry" onClick={() => setReaderOpen(true)}>
          全文阅读
        </button>
        {readerOpen && (
          <PrepMaterialReader
            documentKey={`prep-document:${doc.note.path}`}
            title={doc.title}
            sections={doc.sections}
            notice={broken.length > 0 ? `${broken.length} 处引用未解析，相关内容可能不完整。` : undefined}
            onClose={() => setReaderOpen(false)}
            onOpenCard={onOpenCard}
            onOpenWiki={onOpenWiki}
          />
        )}

        {/* 子項目の行に群名は出さない。上のモジュール pill が既に示しており、
            同じ語が2行に並ぶと、どれが選択中の子項目かが読み取りにくくなる */}
        {currentGroup?.sectionIndexes.length > 1 && (
          <nav className="prep-doc-section-tabs" aria-label={`${currentGroup.label}の子項目`}>
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
          「王明おう・めい」のようにコピー結果へ読みが混ざる——当日いちばん多く
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

function InterviewSession({
  notes,
  today,
  onOpen,
  onOpenWiki,
  onOpenCard,
  onOpenAsset,
  initialCompany = "",
  initialPath = "",
  initialContextPath = "",
  forceOverviewOnly = false,
  onContextChange,
  onSelectionChange,
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  onOpenWiki: (target: string, section?: string) => void;
  onOpenCard: (cardId: string) => void;
  onOpenAsset: (asset: SharedAssetTarget) => void;
  initialCompany?: string;
  initialPath?: string;
  initialContextPath?: string;
  /** 日历已判定本场无准备稿时，只显示公司画像，不借用同案件其他轮次。 */
  forceOverviewOnly?: boolean;
  onContextChange?: (company: string, contextPath: string, prepPath: string) => void;
  onSelectionChange?: (company: string, prepPath: string) => void;
  /** 「今日」は殻が持つ。memo 越しなので中で求めると、日付を跨いでも昨日のまま凍る
   *  ——当日かどうかで既定モード（确认/冲刺/深度）が変わる画面なので、ここが一番効く。 */
  today: string;
}) {
  const docs = useMemo(() => findInterviewPrepDocs(notes), [notes]);
  const series = useMemo(() => groupInterviewPrepDocs(docs), [docs]);
  const digest = useMemo(() => buildDigest(notes), [notes]);
  const contexts = useMemo(() => buildCompanyOverviews(notes), [notes]);
  const docContexts = useMemo(() => new Map(docs.map((doc) => [doc.note.path, resolveCompanyOverview(notes, doc.note)])), [docs, notes]);
  const [selection, setSelection] = useState<{ prepPath: string | null; contextPath: string | null }>(() => {
    const exact = initialPath ? docs.find((doc) => doc.note.path === initialPath) ?? null : null;
    if (exact) return { prepPath: exact.note.path, contextPath: docContexts.get(exact.note.path)?.note.path ?? null };
    const context = initialContextPath ? resolveCompanyOverview(notes, initialContextPath) : null;
    if (context) {
      if (forceOverviewOnly) return { prepPath: null, contextPath: context.note.path };
      const next = selectRelevantInterviewPrepDoc(docs.filter((doc) => docContexts.get(doc.note.path)?.key === context.key), today);
      return { prepPath: next?.note.path ?? null, contextPath: context.note.path };
    }
    // 指定了正本却无法解析时不能打开另一家公司的准备稿。
    if (initialContextPath || initialPath) return { prepPath: null, contextPath: initialContextPath || null };
    const companyKey = calendarCompanyIdentity(initialCompany);
    const candidates = companyKey ? docs.filter((doc) => calendarCompanyIdentity(doc.company) === companyKey) : docs;
    const next = selectRelevantInterviewPrepDoc(candidates, today);
    const companyContext = !next && companyKey ? contexts.find((item) => calendarCompanyIdentity(item.company) === companyKey) : null;
    return { prepPath: next?.note.path ?? null, contextPath: next ? docContexts.get(next.note.path)?.note.path ?? null : companyContext?.note.path ?? null };
  });
  const selected = docs.find((doc) => doc.note.path === selection.prepPath) ?? null;
  const context = selected ? docContexts.get(selected.note.path) ?? null : contexts.find((item) => item.note.path === selection.contextPath) ?? null;
  const [legacyPrepPath, setLegacyPrepPath] = useState<string | null>(null);
  const [comparePaths, setComparePaths] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareSelectorOpen, setCompareSelectorOpen] = useState(false);
  const compared = comparePaths.flatMap((path) => { const item = contexts.find((candidate) => candidate.note.path === path); return item ? [item] : []; });
  const selectDoc = (doc: InterviewPrepDoc) => {
    const nextContext = docContexts.get(doc.note.path) ?? null;
    setSelection({ prepPath: doc.note.path, contextPath: nextContext?.note.path ?? null });
    setLegacyPrepPath(null);
    if (nextContext && onContextChange) onContextChange(doc.company, nextContext.note.path, doc.note.path);
    else onSelectionChange?.(doc.company, doc.note.path);
  };
  const selectContext = (nextContext: CompanyOverview) => {
    const calendarContext = forceOverviewOnly && initialContextPath ? resolveCompanyOverview(notes, initialContextPath) : null;
    const next = calendarContext?.key === nextContext.key ? null : selectRelevantInterviewPrepDoc(docs.filter((doc) => docContexts.get(doc.note.path)?.key === nextContext.key), today);
    setSelection({ prepPath: next?.note.path ?? null, contextPath: nextContext.note.path });
    setLegacyPrepPath(null);
    onContextChange?.(nextContext.company, nextContext.note.path, next?.note.path ?? "");
  };
  const removeCompare = (path: string) => {
    setComparePaths((current) => current.filter((item) => item !== path));
    if (compared.length <= 2) setCompareOpen(false);
  };
  const openCompareSelector = () => {
    setCompareOpen(false);
    if (!compared.length && context) setComparePaths([context.note.path]);
    setCompareSelectorOpen(true);
  };
  const companyAction = <div className="co-header-actions"><button type="button" className="co-compare-entry" onClick={openCompareSelector}>公司对比<span aria-hidden="true">{compared.length ? ` ${compared.length} / 3` : " ↗"}</span></button><CompanyCompareButton context={context} compared={!!context && compared.some((item) => item.key === context.key)} full={compared.length >= COMPANY_COMPARE_LIMIT} onToggle={() => {
    if (!context) return;
    if (compared.some((item) => item.key === context.key)) removeCompare(context.note.path);
    else setComparePaths((current) => toggleCompanyComparison(current, context.note.path));
  }} /></div>;
  const contextPicker = <label className="co-context-picker">公司／岗位或面谈<select aria-label="切换公司、案件或面谈" value={context ? `context:${context.note.path}` : selectedSeriesKey()} onChange={(event) => {
    const value = event.target.value;
    if (value.startsWith("context:")) { const next = contexts.find((item) => item.note.path === value.slice(8)); if (next) selectContext(next); }
    else { const item = series.find((item) => `series:${item.key}` === value); const next = item && selectRelevantInterviewPrepDoc(item.rounds, today); if (next) selectDoc(next); }
  }}>
    {!context && !selected && <option value="">请选择公司／岗位或面谈</option>}
    {[...contexts].sort((left, right) => Number(!!right.assessment) - Number(!!left.assessment) || left.company.localeCompare(right.company)).map((item) => <option key={item.key} value={`context:${item.note.path}`}>{item.company}｜{item.title}{item.assessment ? " · 已评估" : ""}</option>)}
    {series.filter((item) => !item.rounds.some((doc) => docContexts.get(doc.note.path))).map((item) => <option key={item.key} value={`series:${item.key}`}>{item.company}｜{item.caseLink || item.meetingLink || "历史准备"}（{item.rounds.length}轮）</option>)}
  </select></label>;
  function selectedSeriesKey() { const item = selected ? interviewPrepSeriesForDoc(series, selected) : null; return item ? `series:${item.key}` : ""; }
  const companyContent = <CompanyOverviewContent context={context} historical={!!selected && ["past", "completed", "cancelled"].includes(interviewPrepTemporalStatus(selected, today))} onOpenWiki={onOpenWiki} />;
  const compareUI = <><CompanyCompareTray contexts={compared} onRemove={removeCompare} onClear={() => { setComparePaths([]); setCompareOpen(false); }} onOpen={() => setCompareOpen(true)} />
    {compareSelectorOpen && <CompanyCompareSelector contexts={contexts} selected={compared} onToggle={(path) => setComparePaths((current) => toggleCompanyComparison(current, path))} onClose={() => setCompareSelectorOpen(false)} onCompare={() => { setCompareSelectorOpen(false); setCompareOpen(true); }} />}
    {compareOpen && compared.length >= 2 && <CompanyCompare contexts={compared} onClose={() => setCompareOpen(false)} onEdit={openCompareSelector} onRemove={removeCompare} onDetail={(item) => { setCompareOpen(false); selectContext(item); window.scrollTo({ top: 0, behavior: "instant" }); }} onOpenWiki={(target) => { setCompareOpen(false); onOpenWiki(target); }} />}</>;
  // 導読を持たない準備稿ではモード自体を出さない。空のモードに入れると
  // 「壊れている」と読めてしまうし、既存の他社ノートは全部それに当たる。
  const briefing = useMemo(
    () => (selected ? extractPrepBriefing(selected.sections) : null),
    [selected],
  );
  const availableModes = useMemo(
    () => SESSION_MODES.filter((mode) => mode.id !== "brief" || briefing !== null),
    [briefing],
  );
  const [sessionModeChoice, setSessionModeChoice] = useState<{
    path: string | null;
    mode: SessionMode;
  }>(() => ({
    path: selected?.note.path ?? null,
    mode: selected ? defaultSessionMode(selected, today, briefing !== null) : "deep",
  }));
  const chosenMode =
    selected && sessionModeChoice.path === selected.note.path
      ? sessionModeChoice.mode
      : selected
        ? defaultSessionMode(selected, today, briefing !== null)
        : "deep";
  // 導読の無い回へ切り替えた直後も、選択が "brief" のまま残ると本文が消える
  const sessionMode: SessionMode =
    availableModes.some((mode) => mode.id === chosenMode) ? chosenMode : "deep";
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
        {/* 「最近一场仍出现」を各チップに繰り返すと、同じ橙のラベルが3つ並んで
            他の情報を潰す。印は点だけにして、意味は行末に一度だけ置く */}
        <ul className="prep-weakness-peek">
          {digest.tags.filter((tag) => tag.repeated).slice(0, 3).map((tag) => (
            <li key={tag.tag} className={tag.inLatest ? "hot" : ""}>
              {tag.inLatest && <i aria-hidden="true" />}
              {tag.label}
            </li>
          ))}
        </ul>
        {digest.tags.some((tag) => tag.repeated && tag.inLatest) && (
          <small className="prep-weakness-legend">● 最近一场仍出现</small>
        )}
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

  if (selected?.prepVersion === 2) {
    return <><InterviewSessionV2 key={selected.note.path} doc={selected} series={series} selectedSeries={selectedSeries}
      sources={externalLinks} today={today} onSelect={selectDoc} onOpen={onOpen} onOpenWiki={onOpenWiki}
      onOpenCard={onOpenCard} onOpenAsset={onOpenAsset} companyOverview={companyContent} contextPicker={contextPicker} companyAction={companyAction} />{compareUI}</>;
  }

  if (!selected || legacyPrepPath !== selected.note.path) {
    return <><div className="co-shell"><header className="co-shell-head"><div><p className="co-kicker">公司画像{context?.kind === "meeting" ? " · 面谈" : ""}</p><h1>{context?.company || selected?.company || initialCompany || "公司总览"}</h1><p className="co-context-title">{context?.title || selected?.round || "选择一个真实案件或面谈，查看公司与岗位的最新资料。"}</p></div><div className="co-shell-controls">{contextPicker}{companyAction}</div></header>
      <nav className="co-legacy-tabs" aria-label="公司与面谈视图"><button type="button" aria-pressed="true">公司总览</button><button type="button" disabled={!selected} aria-pressed="false" onClick={() => selected && setLegacyPrepPath(selected.note.path)}>面谈准备</button>{!selected && <span className="co-prep-unavailable">本场尚无准备稿</span>}</nav>
      {companyContent}{context && <button type="button" className="co-compare-toggle" onClick={() => onOpen(context.note)}>{context.kind === "meeting" ? "打开面谈记录" : "打开案件记录"} ↗</button>}
    </div>{compareUI}</>;
  }

  return (
    <><div className="co-legacy-tabs co-legacy-return" role="navigation" aria-label="公司与面谈视图"><button type="button" aria-pressed="false" onClick={() => { setLegacyPrepPath(null); window.scrollTo({ top: 0, behavior: "instant" }); }}>公司总览</button><button type="button" aria-pressed="true">面谈准备</button>{companyAction}</div>
    <div className={`prep-view session-view mode-${sessionMode}`}>
      {selected && (
        <>
          <header className="session-hero feature-shell feature-shell-light">
            <div className="session-hero-main">
              <p className="eyebrow">
                <i />
                {["past", "completed", "cancelled"].includes(interviewPrepTemporalStatus(selected, today))
                  ? "最近一场"
                  : "当前面试"}
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
                  <span>公司／案件或面谈</span>
                  <select
                    aria-label="切换公司、案件或面谈"
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
                        {duplicateCompanyNames.get(item.company)! > 1 && (item.caseLink || item.meetingLink)
                          ? `｜${item.caseLink || item.meetingLink}`
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
                  {(selected.caseLink || selected.meetingLink) && (
                    <button type="button" onClick={() => onOpenWiki(selected.caseLink || selected.meetingLink)}>
                      {selected.caseLink ? "打开案件正本" : "打开面谈记录"} ↗
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
            <div data-modes={availableModes.length}>
              {availableModes.map((mode) => (
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

          {sessionMode === "brief" && briefing && (
            <SessionBrief
              briefing={briefing}
              meta={{
                company: selected.company || selected.title,
                round: selected.round || "面談",
              }}
            />
          )}
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
    </div>{compareUI}</>
  );
}

// 外壳的 UI state（⌘K・overlay）变化时不重渲染整个视圖。props 都是稳定引用。
export default memo(InterviewSession);
