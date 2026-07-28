"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  findInterviewPrepDocs,
  groupPrepSections,
  prepBlockText,
  prepInlineText,
  shortLabel,
  splitPrepDocsByDate,
  type InterviewPrepDoc,
} from "@/lib/interview-prep-doc";
import { formatDate, getString, getType, noteBasename, type Note } from "@/lib/notes";
import { parseInterviewAnswerReview, REVIEW_DIMENSION_META } from "@/lib/review-deep";
import {
  buildCardCoverage,
  buildInterviewTrends,
  interviewKeyFromNoteName,
} from "@/lib/interview-trends.mjs";
import {
  companyMotivationAssetTarget,
  type SharedAssetTarget,
} from "@/lib/interview-shared-assets";
import { Blocks } from "./prep-doc-render";

// 「このタイミングでこの会社を面接する」ための画面。
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

function todayKey() {
  const now = new Date();
  return [
    now.getFullYear(),
    `${now.getMonth() + 1}`.padStart(2, "0"),
    `${now.getDate()}`.padStart(2, "0"),
  ].join("-");
}

function daysFromToday(date: string) {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  const today = new Date(`${todayKey()}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function countdownLabel(date: string) {
  const days = daysFromToday(date);
  if (days === null) return "日期未定";
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  if (days > 1) return `${days} 天后`;
  return `${-days} 天前`;
}

function buildDigest(notes: Note[]) {
  const library = notes.find((note) => getType(note) === "interview-prep-library");
  const coverage = buildCardCoverage(library?.content ?? "");
  const entries = notes
    .filter((note) => getType(note) === "interview-answer-review")
    .map((note) => ({
      key: interviewKeyFromNoteName(noteBasename(note.path)),
      company: getString(note.frontmatter.company),
      date: getString(note.frontmatter.date),
      round: getString(note.frontmatter.round),
      review: parseInterviewAnswerReview(note.content),
    }))
    .filter((entry) => entry.review);
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
  const groups = useMemo(() => groupPrepSections(doc.sections), [doc.sections]);
  const current = doc.sections[active];
  const activeGroupIndex = Math.max(
    0,
    groups.findIndex((group) => group.sectionIndexes.includes(active)),
  );
  const currentGroup = groups[activeGroupIndex];
  const broken = doc.embeds.filter((embed) => !embed.resolved);
  const keyword = query.trim();

  // 節ごとの素テキスト。1節しか描画しない＝Ctrl+F が使えないので、検索は自前で持つ
  const plain = useMemo(
    () => doc.sections.map((section) => section.blocks.map(prepBlockText).join("\n").toLocaleLowerCase()),
    [doc],
  );
  const hits = useMemo(() => {
    if (!keyword) return [];
    const needle = keyword.toLocaleLowerCase();
    return doc.sections
      .map((section, index) => ({
        index,
        title: section.title,
        navLabel: section.navLabel,
        count: plain[index].split(needle).length - 1,
      }))
      .filter((item) => item.count > 0);
  }, [doc, keyword, plain]);
  const totalHits = hits.reduce((sum, item) => sum + item.count, 0);

  // 長い節は小節へ直接飛べないと使えない（単語文法帳＝6,600px・10小節）。
  // 逆に1画面半で収まる節（会社研究リンク集＝855字）に小節ナビを出すのは邪魔なだけ。
  // 実測では 1,500字あたりが「2画面を超える」境目だった
  const needsSubnav = (plain[active]?.length ?? 0) >= 1500;
  const subheads = useMemo(
    () =>
      current
        ? current.blocks
            .map((block, index) => ({ block, index }))
            .filter(({ block }) => block.kind === "heading" && block.level === 3)
            .map(({ block, index }) => {
              const full = block.kind === "heading" ? prepInlineText(block.inline) : "";
              // 「3つの数字（信用状。開口一番の売り文句にはしない）」のような長い見出しは
              // 括弧を落として核だけ出す。全文は title で見える
              return { id: `prep-h-${index}`, text: shortLabel(full, 12) || full, full };
            })
        : [],
    [current],
  );

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && typing) {
        setQuery("");
        searchRef.current?.blur();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
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
        <label className="prep-doc-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="全章搜索（/ 聚焦）"
            aria-label="在这份准备文档里搜索"
          />
          {keyword && (
            <button type="button" onClick={() => setQuery("")} aria-label="清除搜索">✕</button>
          )}
        </label>

        {currentGroup?.sectionIndexes.length > 1 && (
          <nav className="prep-doc-section-tabs" aria-label={`${currentGroup.label}の子項目`}>
            <span>{currentGroup.label}</span>
            {currentGroup.sectionIndexes.map((sectionIndex) => {
              const section = doc.sections[sectionIndex];
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

      <article className="prep-doc-body" ref={bodyRef}>
        <h2>{current.title}</h2>
        {needsSubnav && subheads.length >= 3 && (
          <nav className="prep-doc-subnav" aria-label="小节">
            {subheads.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                title={item.full}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(item.id)?.scrollIntoView({ block: "start" });
                }}
              >{item.text}</a>
            ))}
          </nav>
        )}
        <Blocks blocks={current.blocks} refs={{ onOpenCard, onOpenWiki, query: keyword }} />
      </article>

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

function ExternalSources({ doc }: { doc: InterviewPrepDoc }) {
  const featured = [
    ...doc.externalLinks.filter((link) => link.starred),
    ...doc.externalLinks.filter((link) => !link.starred),
  ].slice(0, 3);
  const groups = [...new Set(doc.externalLinks.map((link) => link.group))];
  if (doc.externalLinks.length === 0) return null;

  return (
    <section className="session-sources" aria-label="外部资料">
      <header>
        <span>外部资料</span>
        <p>准备时实际参考的网页，可直接打开原文核对</p>
      </header>
      <div className="session-source-featured">
        {featured.map((link) => (
          <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
            <small>{link.group}</small>
            <strong>{link.label}</strong>
            <i aria-hidden="true">↗</i>
          </a>
        ))}
      </div>
      <details>
        <summary>查看全部 {doc.externalLinks.length} 条 URL</summary>
        <div className="session-source-groups">
          {groups.map((group) => (
            <section key={group}>
              <h3>{group}</h3>
              {doc.externalLinks.filter((link) => link.group === group).map((link) => (
                <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
                  {link.starred && <b>★</b>}
                  <span>{link.label}</span>
                  <small>{link.href}</small>
                </a>
              ))}
            </section>
          ))}
        </div>
      </details>
    </section>
  );
}

export default function InterviewSession({
  notes,
  onOpen,
  onOpenWiki,
  onOpenCard,
  onOpenAsset,
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  onOpenWiki: (target: string, section?: string) => void;
  onOpenCard: (cardId: string) => void;
  onOpenAsset: (asset: SharedAssetTarget) => void;
}) {
  const docs = useMemo(() => findInterviewPrepDocs(notes), [notes]);
  const { upcoming, past } = useMemo(() => splitPrepDocsByDate(docs, todayKey()), [docs]);
  const digest = useMemo(() => buildDigest(notes), [notes]);
  // 既定で開くのは「次の面接」。無ければ直近に終わったもの
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selected =
    docs.find((doc) => doc.note.path === selectedPath) ?? upcoming[0] ?? past[0] ?? null;
  const motivationAsset = useMemo(
    () => (selected ? companyMotivationAssetTarget(selected) : null),
    [selected],
  );

  // 当日は文書をすぐ読みたいので、既定は1行に畳んでおく。中身は展開すれば出る
  const digestBand = digest && (
    <details className="prep-weakness">
      <summary>
        <span>今回気をつけること</span>
        {digest.weakestDimension && (
          <em>
            五維で最弱 <b>{REVIEW_DIMENSION_META[digest.weakestDimension].label}</b>
            {" "}平均 {digest.dimensionAverages[digest.weakestDimension]}
          </em>
        )}
        <ul className="prep-weakness-peek">
          {digest.tags.filter((tag) => tag.repeated).slice(0, 3).map((tag) => (
            <li key={tag.tag} className={tag.inLatest ? "hot" : ""}>
              {tag.label}
              {tag.inLatest && <i>直近も</i>}
            </li>
          ))}
        </ul>
      </summary>
      <div className="prep-weakness-body">
        <p>{digest.interviews.length} 場の回答品質復盤から機械集計。正本は vault の 面接傾向_横断。</p>
        <ul>
          {digest.tags.filter((tag) => tag.repeated).map((tag) => (
            <li key={tag.tag} className={tag.inLatest ? "hot" : ""}>
              <strong>{tag.label}</strong>
              <span>{tag.interviews} / {digest.interviews.length} 場 · {tag.occurrences} 问</span>
              {tag.inLatest && <i>直近も</i>}
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
            （<code>20_求職/&lt;会社&gt;/面接準備_&lt;日付&gt;.md</code>）。
          </p>
          <p>
            要新建一份，把面接連絡邮件或求人 URL 交给 AI，说「帮我准备〇〇社的面试」即可
            —— <code>japan-interview-prep</code> skill 会读 vault 已有的资产，只写这家公司特有的部分。
            需要告诉它的是：<strong>日期时间・形式（対面／Teams）・面接官の氏名・对应哪个 job-case</strong>。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="prep-view session-view">
      {selected && (
        <>
          {/* 当日に開く画面なので、見出しは1つだけ・文書をできるだけ上に出す */}
          <header className="session-hero">
            <div className="session-hero-main">
              <p className="eyebrow">
                <i />
                THIS INTERVIEW
                <b className={daysFromToday(selected.date) !== null && daysFromToday(selected.date)! >= 0 ? "future" : ""}>
                  {countdownLabel(selected.date)}
                </b>
                {selected.date && <span>{formatDate(selected.date, true)}</span>}
              </p>
              <h1>{selected.company || selected.title}</h1>
              <p className="session-meta">
                {[selected.round, selected.format, selected.interviewers].filter(Boolean).join(" ／ ") || "詳細未記入"}
              </p>
            </div>
            <div className="session-hero-side">
              {docs.length > 1 && (
                <select
                  aria-label="別の面接に切り替える"
                  value={selected.note.path}
                  onChange={(event) => setSelectedPath(event.target.value)}
                >
                  {[...upcoming, ...past].map((doc) => (
                    <option key={doc.note.path} value={doc.note.path}>
                      {countdownLabel(doc.date)}｜{doc.company || doc.title}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="prep-source" onClick={() => onOpen(selected.note)}>
                打开 Obsidian 原笔记 ↗
              </button>
              {selected.caseLink && (
                <button type="button" className="prep-source" onClick={() => onOpenWiki(selected.caseLink)}>
                  打开案件正本 ↗
                </button>
              )}
            </div>
          </header>

          {digestBand}

          <ExternalSources doc={selected} />

          <section className="session-assets" aria-label="本场专属与全社共通的面试话术">
            <span>本场专属</span>
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
            <span>共通资产</span>
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

          <DocReader
            key={selected.note.path}
            doc={selected}
            onOpenCard={onOpenCard}
            onOpenWiki={onOpenWiki}
          />
        </>
      )}
    </div>
  );
}
