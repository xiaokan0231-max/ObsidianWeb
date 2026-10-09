"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { plainSei, type ParsedSeirikou, type ReviewDecisionTask, type ReviewSentence } from "@/lib/review";
import type { ReadingHeading } from "@/lib/reading-document";
import type { UiLocale } from "@/lib/ui-locale";
import ReadingMode from "./reading-mode";
import { useUiLocale } from "./ui-locale";

type Language = "ja" | "zh";
type ReadingTurn = {
  speaker: ReviewSentence["speaker"];
  uncertain: boolean;
  sentences: ReviewSentence[];
};

/**
 * 阅读层外框（眉题、返回、计数、文末）跟界面语言走；正文里的话者、补充说明标签仍跟正文语言走——
 * 那是在读哪一版原稿，不是界面菜单。
 */
const NOVEL_COPY: Record<UiLocale, {
  eyebrow: string;
  back: string;
  meta: (chapters: number, sentences: number) => string;
  /** 正在读哪一版原稿；中文界面沿用原来的写法（日语版本身就用日语标注）。 */
  version: (language: Language) => string;
  readingNote: string;
  missing: (count: number) => string;
  end: string;
  empty: string;
  endNote: (sentences: number, chapters: number) => string;
  another: string;
}> = {
  "zh-CN": {
    eyebrow: "面试实录",
    back: "返回复盘",
    meta: (chapters, sentences) => `${chapters} 章 · ${sentences} 句`,
    version: (language) => language === "zh" ? "中文译文" : "日本語の整理稿",
    readingNote: "按对话顺序，慢慢读完这一场。",
    missing: (count) => `${count} 句暂无中文译文，已标注并保留日语。`,
    end: "本场全文完",
    empty: "这场面试暂时没有可阅读的正文",
    endNote: (sentences, chapters) => `${sentences} 句对话 · ${chapters} 个章节`,
    another: "选择另一场面试",
  },
  ja: {
    eyebrow: "面接の記録",
    back: "振り返りに戻る",
    meta: (chapters, sentences) => `${chapters} 章 · ${sentences} 文`,
    version: (language) => language === "zh" ? "中国語訳" : "日本語の整理稿",
    readingNote: "会話の順に、この回を通して読みます。",
    missing: (count) => `${count} 文は中国語訳がないため、日本語のまま表示しています。`,
    end: "この回の全文はここまで",
    empty: "この面接には、まだ読める本文がありません",
    endNote: (sentences, chapters) => `${sentences} 文の会話 · ${chapters} 章`,
    another: "別の面接を選ぶ",
  },
};

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "zh", label: "中文" },
  { value: "ja", label: "日本語" },
];

export function novelChapterId(id: string) {
  return `nr-chapter-${id}`;
}

/**
 * 面试实录的全文阅读：正文（章节 → 话轮 → 逐句 span[data-novel-sentence] → 补充说明）在这里排，
 * 阅读外壳（工具栏、目录、字号、语言切换、进度、位置记忆、焦点边界、Esc）全部交给通用 ReadingMode。
 * 以前这里自己实现了一遍同样的外壳，字号不记、重进从头读，改一处阅读体验要写两遍。
 */
export default function InterviewNovelReader({
  company, date, round, parsed, decisionTasks, language, onLanguageChange, onExit, onBack, documentKey, overlay,
}: {
  company: string;
  date: string;
  round: string;
  parsed: ParsedSeirikou;
  decisionTasks: ReviewDecisionTask[];
  language: Language;
  onLanguageChange: (language: Language) => void;
  onExit: () => void;
  onBack: () => void;
  /** 阅读位置按它记忆；不给时按公司・日期・轮次拼一个。 */
  documentKey?: string;
  /** 复盘页的写入提示：阅读层打开时外壳 inert，提示要挂进阅读层里才点得到。 */
  overlay?: ReactNode;
}) {
  const copy = NOVEL_COPY[useUiLocale().locale];
  const chapters = useMemo(() => {
    const decisions = new Map(decisionTasks
      .filter((task) => task.target === "speaker" && task.resolvedBy)
      .map((task) => [task.sentenceId, task.resolution]));
    return parsed.blocks.map((block) => {
      const turns: ReadingTurn[] = [];
      for (const sentence of block.sentences) {
        const decision = decisions.get(sentence.id);
        const speaker = decision === "speaker-interviewer" ? "面"
          : decision === "speaker-self" ? "私" : sentence.speaker;
        const uncertain = sentence.uncertainSpeaker
          && decision !== "speaker-interviewer" && decision !== "speaker-self";
        const last = turns[turns.length - 1];
        // 注释紧跟对应发言，不能被后续同话者的长段落隔开，也不能混成现场原话。
        if (last && last.speaker === speaker && last.uncertain === uncertain
          && !last.sentences[last.sentences.length - 1].notes.some((note) => note.trim())) {
          last.sentences.push(sentence);
        } else {
          turns.push({ speaker, uncertain, sentences: [sentence] });
        }
      }
      return { ...block, turns };
    });
  }, [parsed, decisionTasks]);
  // 目录与「正在读哪一章」按章节 section 的 id 走；章名是日语原稿，目录里按日语字体排。
  const headings = useMemo<ReadingHeading[]>(
    () => chapters.map((chapter) => ({ id: novelChapterId(chapter.id), text: chapter.title, lang: "ja" })),
    [chapters],
  );
  const sentenceCount = parsed.sentences.length;
  const missingTranslations = parsed.sentences.filter((sentence) => !sentence.yaku?.trim()).length;

  // 进入全文阅读时复盘页整页换成阅读层，入口按钮随之卸载；退出后复盘页重新挂载，
  // 阅读层自己的焦点恢复只能回到已不存在的旧节点，所以这里等新页面挂好后把焦点还给新的入口。
  useEffect(() => () => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("[data-novel-entry]")?.focus({ preventScroll: true });
    });
  }, []);

  return (
    <ReadingMode
      documentKey={documentKey ?? `review-novel:${company}\n${date}\n${round}`}
      title={company}
      eyebrow={copy.eyebrow}
      backLabel={copy.back}
      metadata={[date, round, copy.meta(chapters.length, sentenceCount)]}
      headings={headings}
      languageSwitch={{ value: language, options: LANGUAGE_OPTIONS, onChange: (value) => onLanguageChange(value === "zh" ? "zh" : "ja") }}
      headerNote={<>
        <p className="nr-reading-note">{copy.version(language)}<span> · </span>{copy.readingNote}</p>
        {language === "zh" && missingTranslations > 0 && <p className="nr-translation-note">{copy.missing(missingTranslations)}</p>}
      </>}
      endLabel={sentenceCount > 0 ? copy.end : copy.empty}
      endNote={copy.endNote(sentenceCount, chapters.length)}
      footerActions={<button type="button" onClick={onBack}>{copy.another}</button>}
      onClose={onExit}
      overlay={overlay}
    >
      {chapters.map((chapter, chapterIndex) => (
        <section key={chapter.id} id={novelChapterId(chapter.id)} className="nr-chapter" aria-labelledby={`nr-heading-${chapter.id}`}>
          <header>
            <span className="nr-chapter-number">{String(chapterIndex + 1).padStart(2, "0")}</span>
            <h2 id={`nr-heading-${chapter.id}`} lang="ja">{chapter.title}</h2>
          </header>
          {chapter.turns.map((turn) => (
            <div className="nr-turn" key={turn.sentences[0].id}>
              <p className="nr-speaker">
                {language === "zh" ? (turn.speaker === "私" ? "我" : "面试官") : (turn.speaker === "私" ? "私" : "面接官")}
                {turn.uncertain && <span>{language === "zh" ? " · 话者待确认" : " · 話者未確定"}</span>}
              </p>
              <p className="nr-paragraph" lang={language === "zh" ? "zh-CN" : "ja"}>
                {turn.sentences.map((sentence, index) => {
                  const translated = language === "zh" && Boolean(sentence.yaku?.trim());
                  return (
                    <span
                      key={sentence.id}
                      id={`nr-sentence-${sentence.id}`}
                      data-novel-sentence
                      aria-describedby={sentence.notes.some((note) => note.trim()) ? `nr-notes-${sentence.id}` : undefined}
                      lang={translated ? "zh-CN" : "ja"}
                    >
                      {index > 0 ? " " : ""}{translated ? sentence.yaku : plainSei(sentence)}
                      {language === "zh" && !translated && <small className="nr-missing">（暂无译文）</small>}
                    </span>
                  );
                })}
              </p>
              {turn.sentences.filter((sentence) => sentence.notes.some((note) => note.trim())).map((sentence) => (
                <div key={sentence.id} id={`nr-notes-${sentence.id}`} className="nr-turn-notes" role="note" aria-label={`${language === "zh" ? "补充说明" : "補足注記"} · ${sentence.id}`}>
                  <p className="nr-note-label">{language === "zh" ? "补充说明（非逐字原话）" : "補足注記（逐語録外）"}<span> · {sentence.id}</span></p>
                  {sentence.notes.filter((note) => note.trim()).map((note, index) => <p key={index}>{note}</p>)}
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </ReadingMode>
  );
}
