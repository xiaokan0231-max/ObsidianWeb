"use client";

import { trainingTopicCopy } from "@/lib/special-training-i18n";
import { useInterviewStudyCopy } from "./interview-study-copy";

import { useEffect, useMemo } from "react";
import { languagePointsForQuestion, type InterviewLanguageIndex } from "@/lib/interview-language";
import {
  QUESTION_TOPICS, groupInterviewQuestions, questionMatchesSearch, questionReviewStatus,
  type InterviewQuestion, type InterviewQuestionCollection, type QuestionSource, type QuestionVariant,
} from "@/lib/interview-question-collection";

const SOURCE_KINDS = { employer: "企业", agency: "中介", platform: "平台" };
const CONFIDENCE = { high: "较高", medium: "中等", low: "较低" };
const SCOPES = [
  { id: "primary", title: "窗口内转写提问", description: "保留原稿实见问法；ASR 转写不等于已核验录音。" },
  { id: "nonverbatim", title: "回忆与复盘", description: "回忆内容，非原句。单独阅读，不计入窗口内逐字问法。" },
  { id: "background", title: "窗口前背景", description: "用于对照的早期材料，不计入本窗口主计数。" },
] as const;
const lines = (start: number, end: number) => start === end ? `L${start}` : `L${start}–${end}`;
const nonverbatim = (source: QuestionSource) => source.transcriptType === "memory" || source.transcriptType === "review" || source.scope === "nonverbatim";
const REVIEW_VIEWS = [
  { id: "accepted", title: "已审核实问" }, { id: "pending", title: "待核候选" },
  { id: "excluded", title: "排除片段" }, { id: "memory", title: "回忆与复盘" },
] as const;
const PAGE_SIZE = 20;
export type QuestionCollectionFilterChange = { review?: string; sourceKind?: string; query?: string; page?: number };

function SourceOccurrence({ question, source, questions, sources, onOpenWiki }: {
  question: InterviewQuestion; source: QuestionSource; questions: Map<string, InterviewQuestion>; sources: Map<string, QuestionSource>; onOpenWiki: (target: string, section?: string) => void;
}) {
  const { t, label, date } = useInterviewStudyCopy();
  const previous = question.continuationOf ? questions.get(question.continuationOf) : undefined;
  const previousSource = previous ? sources.get(previous.sourceId) : undefined;
  return <details className="question-occurrence">
    <summary>{source.company} · {date(source.date)} · {label(SOURCE_KINDS[source.kind])} · {lines(question.lineStart, question.lineEnd)}</summary>
    <div className="question-evidence-body">
      <p className="question-source-type">{t(nonverbatim(source) ? "回忆内容，非原句" : "ASR 转写；未据此判断本人听力或表达能力")}</p>
      <dl><dt>{t("提问定位")}</dt><dd>{t("confidenceNote", { confidence: label(CONFIDENCE[question.confidence]) })}</dd><dt>{t("话者依据")}</dt><dd lang="zh-CN">{question.speakerBasisZh}</dd>
        {question.locator && <><dt>{t("来源定位")}</dt><dd lang="zh-CN">{question.locator}</dd></>}
        {question.reviewReasonZh && <><dt>{t("审核说明")}</dt><dd lang="zh-CN">{question.reviewReasonZh}</dd></>}
      </dl>
      {previous && previousSource && <section className="question-previous"><h5>{t("承接的前问")}</h5><p lang="ja">{previous.questionText ?? previous.originalText}</p><button type="button" onClick={() => onOpenWiki(previousSource.path)}>{previousSource.company} · {date(previousSource.date)} · {lines(previous.lineStart, previous.lineEnd)} · {t("查看原场 ↗")}</button></section>}
      <button type="button" onClick={() => onOpenWiki(source.path)}>{t("打开来源笔记 ↗")}</button>
      {question.contextBefore?.trim() && <section><h5>{t("前文")}</h5><p lang="ja">{question.contextBefore}</p></section>}
      <section><h5>{t(nonverbatim(source) ? "来源记录（非逐字）" : "原始连续转写")}</h5><p lang="ja">{question.originalText}</p></section>
      {question.contextAfter?.trim() && <section><h5>{t("后续回答与上下文")}</h5><p lang="ja">{question.contextAfter}</p></section>}
      {!!question.duplicateLocators?.length && <p>{t("duplicateLines", { lines: question.duplicateLocators.map(range => lines(range.lineStart, range.lineEnd)).join("、") })}</p>}
      {!!question.annotations.length && <section><h5>{t("批注与整理依据")}</h5>{question.annotations.map((annotation, index) => <div className="question-annotation" key={`${annotation.path}-${index}`}>
        <small>{t(annotation.nature === "self-note" ? "本人批注" : "AI 整理批注（非本人确认）")} · {lines(annotation.lineStart, annotation.lineEnd)}</small>
        <p lang="und">{annotation.excerpt}</p><button type="button" onClick={() => onOpenWiki(annotation.path)}>{t("打开批注笔记 ↗")}</button>
      </div>)}</section>}
      {(question.uncertaintyZh || source.limitations.length > 0) && <section><h5>{t("材料局限")}</h5>{question.uncertaintyZh && <p lang="zh-CN">{question.uncertaintyZh}</p>}{source.limitations.map(item => <p lang="zh-CN" key={item}>{item}</p>)}</section>}
    </div>
  </details>;
}

function QuestionCard({ variant, sources, questions, onOpenWiki, languageIndex, onOpenLanguage, focusedQuestionId }: {
  variant: QuestionVariant; sources: Map<string, QuestionSource>; questions: Map<string, InterviewQuestion>; onOpenWiki: (target: string, section?: string) => void;
  languageIndex?: InterviewLanguageIndex; onOpenLanguage?: (dimensionId?: string, pointId?: string, questionId?: string) => void; focusedQuestionId?: string;
}) {
  const { t, label } = useInterviewStudyCopy();
  const question = variant.question;
  const source = sources.get(question.sourceId)!;
  const kinds = [...new Set(variant.occurrences.map(item => label(SOURCE_KINDS[sources.get(item.sourceId)!.kind])))];
  const pending = variant.occurrences.some(item => questionReviewStatus(item) === "pending");
  const memoryRecords = variant.occurrences.filter(item => nonverbatim(sources.get(item.sourceId)!)).length;
  const recordLabel = memoryRecords === variant.occurrences.length ? "回忆内容，非原句" : memoryRecords > 0 ? "含回忆记录，非逐字内容另见来源" : "尚未作为已审核实问";
  const related = languageIndex ? [...new Map(variant.occurrences.flatMap(item => languagePointsForQuestion(languageIndex, item.id).map(point => [point.id, {point, questionId:item.id}] as const))).values()] : [];
  return <article className="question-reading-card" id={`question-${question.id}`} tabIndex={-1} data-located={focusedQuestionId === question.id ? "true" : undefined}>
    <div className="question-card-meta"><span>{pending ? `${t("待核候选")} · ${t(recordLabel)}` : t(nonverbatim(source) ? "回忆内容，非原句" : "已审核提问记录 · ASR")} · {kinds.join("／")}</span><span>{t("sourceRecords", {count: variant.occurrences.length})}</span></div>
    <p className="question-japanese" lang="ja">{question.questionText ?? question.originalText}</p>
    {question.readableJa && <div className="question-readable"><small>{t("可读整理 · 不是现场原句")}</small><p lang="ja">{question.readableJa}</p></div>}
    <div className="question-learning-copy"><section><h4>{t("中文意译")}</h4><p lang="zh-CN">{question.meaningZh}</p></section><section><h4>{t("具体要回答什么")}</h4><p lang="zh-CN">{question.answerScopeZh}</p></section></div>
    {question.detailsZh.length > 0 && <section className="question-qualifiers"><h4>{t("易漏限定")}</h4><ul>{question.detailsZh.map(item => <li lang="zh-CN" key={item}>{item}</li>)}</ul></section>}
    {question.structureZh.length > 0 && <details className="question-structure"><summary>{t("展开复杂句结构")}</summary><ul>{question.structureZh.map(item => <li lang="zh-CN" key={item}>{item}</li>)}</ul></details>}
    {question.uncertaintyZh && <p className="question-uncertainty">{t("转写／资料提示：")}<span lang="zh-CN">{question.uncertaintyZh}</span></p>}
    {pending && question.reviewReasonZh && <p className="question-uncertainty">{t("待核原因：")}<span lang="zh-CN">{question.reviewReasonZh}</span></p>}
    {onOpenLanguage && related.length > 0 && <nav className="question-related-language" aria-label={t("这句中的语言知识点")}><small>{t("从这句继续学")}</small>{related.map(({point,questionId}) => <button type="button" key={point.id} onClick={() => onOpenLanguage(point.dimension,point.id,questionId)}><span lang="zh-CN">{point.titleZh}</span> →</button>)}</nav>}
    <details className="question-sources"><summary>{t("sourcesSummary", {count: variant.occurrences.length})}</summary>
      {variant.occurrences.map(item => <SourceOccurrence key={item.id} question={item} source={sources.get(item.sourceId)!} questions={questions} sources={sources} onOpenWiki={onOpenWiki} />)}
    </details>
  </article>;
}

function SourceInventory({ collection, onOpenWiki }: {
  collection: InterviewQuestionCollection; onOpenWiki: (target: string, section?: string) => void;
}) {
  const { t, label, date } = useInterviewStudyCopy();
  return <details className="question-inventory"><summary>{t("inventorySummary", {count: collection.sources.length})}</summary>
    <p>{t("清单表示已纳入的材料范围；主题是否可读，以目录的发布状态为准。原稿完整读取不代表录音完整，也不代表所有主题已整理完成。")}</p>
    {SCOPES.map(scope => <section key={scope.id}><h3>{label(scope.title)} · {t("materialsCount", {count: collection.sources.filter(source => source.scope === scope.id).length})}</h3>
      {collection.sources.filter(source => source.scope === scope.id).map(source => <details key={source.id} className="question-inventory-source"><summary>{date(source.date)} · {source.company} · {label(SOURCE_KINDS[source.kind])} · {t(source.readCoverage === "full" ? "全文已读" : "待补读")}</summary>
        <p>{t(nonverbatim(source) ? "回忆内容，非原句" : "ASR 转写材料")} · {t("lineCount", {count: source.lineCount})}</p>
        <button type="button" onClick={() => onOpenWiki(source.path)}>{t("打开来源笔记 ↗")}</button>
        {source.limitations.map(item => <p lang="zh-CN" key={item}>{item}</p>)}
      </details>)}
    </section>)}
    {collection.auditNotes.length > 0 && <section><h3>{t("核对说明")}</h3><ul>{collection.auditNotes.map(item => <li lang="zh-CN" key={item}>{item}</li>)}</ul></section>}
  </details>;
}

export default function InterviewQuestionCollectionView({ collection, topicId, review = "accepted", sourceKind = "all", query = "", page = 1, onSelectTopic, onFilterChange = () => {}, onBack, onOpenWiki, languageIndex, onOpenLanguage, focusedQuestionId }: {
  collection: InterviewQuestionCollection; topicId: string; review?: string; sourceKind?: string; query?: string; page?: number;
  onSelectTopic: (topicId: string) => void; onFilterChange?: (change: QuestionCollectionFilterChange, replace?: boolean) => void;
  onBack: () => void; onOpenWiki: (target: string, section?: string) => void;
  languageIndex?: InterviewLanguageIndex; onOpenLanguage?: (dimensionId?: string, pointId?: string, questionId?: string) => void; focusedQuestionId?: string;
}) {
  const { t, label, date, number, locale } = useInterviewStudyCopy();
  useEffect(() => {
    if (!focusedQuestionId) return;
    const target = document.getElementById(`question-${focusedQuestionId}`);
    target?.scrollIntoView({block:"start"});
    target?.focus({preventScroll:true});
  }, [focusedQuestionId, topicId, page, review, query, sourceKind]);
  const sources = useMemo(() => new Map(collection.sources.map(source => [source.id, source])), [collection.sources]);
  const questionsById = useMemo(() => new Map(collection.questions.map(question => [question.id, question])), [collection.questions]);
  const activeReview = REVIEW_VIEWS.find(item => item.id === review)?.id ?? "accepted";
  const activeKind = Object.hasOwn(SOURCE_KINDS, sourceKind) ? sourceKind : "all";
  const selectedTopic = activeReview === "excluded" ? "all" : topicId;
  const topic = QUESTION_TOPICS.find(item => item.id === selectedTopic);
  const allTopics = selectedTopic === "all" || !topic;
  const published = allTopics || collection.publishedTopicIds.includes(topic!.id);
  const directoryTopics = collection.phase === "phase-one" ? QUESTION_TOPICS : QUESTION_TOPICS.filter(item => collection.publishedTopicIds.includes(item.id));
  const matchesKind = (source: QuestionSource) => activeKind === "all" || source.kind === activeKind;
  const records = collection.questions.filter(question => {
    const source = sources.get(question.sourceId)!;
    if (source.scope === "background" || !collection.publishedTopicIds.includes(question.topicId) || (!allTopics && question.topicId !== topic?.id) || !matchesKind(source)) return false;
    const memory = nonverbatim(source) || source.scope === "nonverbatim";
    if (activeReview === "excluded") return false;
    if (activeReview === "memory" && (!memory || questionReviewStatus(question) !== "accepted")) return false;
    if (activeReview === "pending" && questionReviewStatus(question) !== "pending") return false;
    if (activeReview === "accepted" && (memory || source.scope !== "primary" || questionReviewStatus(question) !== "accepted")) return false;
    return questionMatchesSearch(question, query, source);
  });
  const excluded = activeReview === "excluded" ? collection.excludedCandidates.filter(item => {
    const source = sources.get(item.sourceId)!;
    if (source.scope === "background" || !matchesKind(source)) return false;
    const text = [item.excerpt, item.reason, item.reviewReasonZh, source.company, source.date].join(" ").toLocaleLowerCase();
    return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every(word => text.includes(word));
  }) : [];
  const groups = groupInterviewQuestions(records);
  const rows = groups.flatMap(group => group.variants.map(variant => ({ groupId: group.id, variant })));
  const totalRows = activeReview === "excluded" ? excluded.length : rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const currentPage = Number.isFinite(page) ? Math.max(1, Math.min(totalPages, Math.floor(page))) : 1;
  const offset = (currentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(offset, offset + PAGE_SIZE);
  const visibleGroups = groups.map(group => ({ ...group, visible: pageRows.filter(row => row.groupId === group.id).map(row => row.variant) })).filter(group => group.visible.length > 0);
  const resultCount = activeReview === "excluded" ? excluded.length : records.length;
  const title = activeReview === "excluded" ? t("排除片段") : allTopics ? t("全部已发布主题") : trainingTopicCopy(topic!, locale).title;
  const pagination = totalPages > 1 && <nav className="question-pagination" aria-label={t("问题记录分页")}>
    <button type="button" disabled={currentPage === 1} onClick={() => onFilterChange({page:currentPage - 1})}>{t("← 上一页")}</button>
    <label>{t("pagePrefix")}<select aria-label={t("选择页码")} value={currentPage} onChange={event => onFilterChange({page:Number(event.target.value)})}>{Array.from({length:totalPages},(_,index) => <option key={index + 1} value={index + 1}>{number(index + 1)}</option>)}</select>{t("pageSuffix", {count: totalPages})}</label>
    <span>{t(activeReview === "excluded" ? "shownExcluded" : "shownVariants", {start: offset + 1, end: Math.min(offset + PAGE_SIZE,totalRows)})}</span>
    <button type="button" disabled={currentPage === totalPages} onClick={() => onFilterChange({page:currentPage + 1})}>{t("下一页 →")}</button>
  </nav>;
  return <section className="interview-question-collection" aria-label={t("面试官问题集")} lang={locale}>
    <header className="question-collection-heading"><div><small>{t("专项学习 · 按提问意图阅读")}</small><h1>{t("面试官问题集")}</h1><p>{t("看同一个意思在不同面谈里怎样问，再看这句话具体要求回答什么。")}</p></div><button type="button" onClick={onBack}>{t("← 返回研读目录")}</button></header>
    <p className="question-window">{t("materialWindow", {start: date(collection.window.start), end: date(collection.window.end)})}{collection.phase === "phase-one" && <strong>{t("分阶段发布 · 其余主题仍在整理")}</strong>}{onOpenLanguage && <button type="button" onClick={() => onOpenLanguage()}>{t("从真实提问学语言 →")}</button>}</p>
    <p className="question-mode-note">{t("languageNote")}</p>
    <div className="question-review-tabs" role="group" aria-label={t("提问记录审核范围")}>{REVIEW_VIEWS.map(item => <button aria-pressed={activeReview === item.id} type="button" key={item.id} onClick={() => onFilterChange({review:item.id})}>{label(item.title)}</button>)}</div>
    <div className="question-collection-layout"><nav className="question-topic-nav" aria-label={t("问题语义主题")}><h2>{t("按主题浏览")}</h2><button type="button" aria-current={allTopics ? "page" : undefined} onClick={() => onSelectTopic("all")}><strong>{t("全部主题")}</strong><small>{t("搜索全部已发布内容")}</small></button>{directoryTopics.map(item => <button key={item.id} type="button" aria-current={!allTopics && item.id === topic?.id ? "page" : undefined} onClick={() => onSelectTopic(item.id)}><strong>{trainingTopicCopy(item, locale).title}</strong><small>{t(collection.publishedTopicIds.includes(item.id) ? "可阅读" : "尚未发布")}</small></button>)}</nav>
      <div className="question-topic-content" key={`${selectedTopic}-${activeReview}`}><header><h2>{title}</h2><p>{activeReview === "excluded" ? t("已排除的本人逆问、企业说明或无法认定为提问的片段。未按语义主题归类，可按来源和关键词查找。") : allTopics ? t("不同意图分别成组；同意图保留全部不同问法，完全重复记录合并展示来源。") : trainingTopicCopy(topic!, locale).summary}</p>
        <small>{t(activeReview === "excluded" ? "recordsExcluded" : activeReview === "pending" ? "recordsPending" : activeReview === "memory" ? "recordsMemory" : "recordsAccepted", {count: resultCount})}{activeReview !== "excluded" && t(activeReview === "accepted" ? "variantCounts" : "recordVariantCounts", {count: rows.length, groups: groups.length})}{t("recordCountNote")}</small>
      </header>
        <div className="question-filter-bar"><label className="question-search"><span>{t(activeReview === "excluded" ? "搜索排除记录" : allTopics ? "搜索全部已发布主题" : "搜索当前主题")}</span><input type="search" value={query} placeholder={t("日语、中文、公司或日期")} onChange={event => onFilterChange({query:event.target.value},true)} /></label>
          <label className="question-kind-filter"><span>{t("来源类别")}</span><select value={activeKind} onChange={event => onFilterChange({sourceKind:event.target.value})}><option value="all">{t("全部来源")}</option><option value="employer">{t("企业")}</option><option value="agency">{t("中介")}</option><option value="platform">{t("平台")}</option></select></label>
        </div>
        {activeReview === "pending" && <p className="question-mode-note">{t("这里的片段仍需核对话者、意图或上下文，不作为已审核实问，也不用于诊断本人能力。")}</p>}
        {activeReview === "memory" && <p className="question-mode-note">{t("回忆内容，非原句。回忆与复盘记录在此单独阅读，不混入默认实问列表或计数。")}</p>}
        {!published && activeReview !== "excluded" ? <div className="question-empty"><h3>{t("这个主题尚未发布")}</h3><p>{t("可从目录阅读已发布主题；完整来源清单仍可在下方查看。")}</p></div>
          : totalRows === 0 ? <div className="question-empty"><p>{t("当前筛选下没有匹配记录。可切换主题、来源类别或记录范围。")}</p>{query && <button type="button" onClick={() => onFilterChange({query:""},true)}>{t("清空搜索")}</button>}</div>
          : <>{pagination}{activeReview === "excluded" ? excluded.slice(offset,offset + PAGE_SIZE).map((item,index) => {
            const source = sources.get(item.sourceId)!;
            return <article className="question-reading-card question-excluded" key={item.id ?? `${item.sourceId}-${item.lineStart}-${index}`}><div className="question-card-meta"><span>{t("排除片段")} · {label(SOURCE_KINDS[source.kind])}</span><span>{source.company} · {date(source.date)} · {lines(item.lineStart,item.lineEnd)}</span></div><p className="question-japanese" lang="ja">{item.excerpt}</p><h4>{t("排除原因")}</h4><p lang="zh-CN">{item.reason}</p>{item.reviewReasonZh && <p lang="zh-CN">{item.reviewReasonZh}</p>}<details className="question-sources"><summary>{t("来源与材料限制")}</summary><button type="button" onClick={() => onOpenWiki(source.path)}>{t("打开原场笔记 ↗")}</button>{source.limitations.map(value => <p lang="zh-CN" key={value}>{value}</p>)}</details></article>;
          }) : visibleGroups.map(group => <section className="question-intent-group" key={group.id}><h3><span lang="zh-CN">{group.titleZh}</span> <small>{t(activeReview === "accepted" ? "groupQuestions" : "groupExpressions", {count: group.variants.length})}{group.visible.length < group.variants.length && t("groupPage", {count: group.visible.length})}</small></h3>{group.visible.map(variant => <QuestionCard key={variant.key} variant={variant} sources={sources} questions={questionsById} onOpenWiki={onOpenWiki} languageIndex={languageIndex} onOpenLanguage={onOpenLanguage} focusedQuestionId={focusedQuestionId} />)}</section>)}{pagination}</>}
        <SourceInventory collection={collection} onOpenWiki={onOpenWiki} />
      </div>
    </div>
  </section>;
}
