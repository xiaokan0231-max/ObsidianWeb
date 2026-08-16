// 一回の面接は「整理稿・批注・回答品質復盤・…」と複数のノートに分かれて置かれる。
// それを一本に束ねる規則——**批注は company+date、復盤は company+date+round で照合する**——を
// ここ一箇所に持つ。
//
// なぜ切り出したか：同じ照合を Web の復盤画面（詳細）と記憶星図のプレビュー（要約）が
// 別々に書いていて、round を照合に入れるかどうかのような判断が二箇所に散っていた。
// 片方だけ直しても何も赤くならないので、同じ面接に別のノートが紐づく状態に静かに割れる。
//
// ここは束ねるだけ。各画面が要る派生値（統計・練習キュー・フィードバック等）は
// 呼ぶ側で足す——ここに全部積むと、要約しか要らない側まで全部の解析を払うことになる。

import {
  parseAnnotations,
  parseSeirikou,
  reviewDecisionTasks,
  uniqueAnnotations,
  type ParsedSeirikou,
  type ReviewAnnotation,
  type ReviewDecisionTask,
} from "./review.ts";
import { getString, getType, type Note } from "./notes.ts";

export type JoinedReviewNotes = {
  /** ノートのパス。同じ会社・同じ日に複数回があっても一意。 */
  key: string;
  note: Note;
  company: string;
  date: string;
  round: string;
  /** 批注は回ごとではなく日ごと（同日の複数回で1本）。だから round では照合しない。 */
  annotationNote?: Note;
  deepReviewNote?: Note;
  parsed: ParsedSeirikou;
  annotations: ReviewAnnotation[];
  decisionTasks: ReviewDecisionTask[];
};

/** 同じ面接を指すか。round を見るかどうかがノート種別ごとに違うので引数で分ける。 */
function sameInterview(candidate: Note, company: string, date: string, round?: string) {
  return (
    getString(candidate.frontmatter.company) === company &&
    getString(candidate.frontmatter.date) === date &&
    (round === undefined || getString(candidate.frontmatter.round) === round)
  );
}

/**
 * 整理稿を軸に、同じ回のノートを束ねて日付の新しい順に返す。
 * 整理稿が無ければその面接は存在しない扱い（復盤だけ在っても出さない）。
 */
export function joinReviewNotes(notes: Note[]): JoinedReviewNotes[] {
  const studies = notes.filter((note) => getType(note) === "transcript-study");
  const annotationNotes = notes.filter((note) => getType(note) === "study-annotation");
  const deepReviewNotes = notes.filter((note) => getType(note) === "interview-answer-review");

  return studies
    .map((note): JoinedReviewNotes => {
      const company = getString(note.frontmatter.company);
      const date = getString(note.frontmatter.date);
      const round = getString(note.frontmatter.round);
      const annotationNote = annotationNotes.find((candidate) =>
        sameInterview(candidate, company, date),
      );
      const deepReviewNote = deepReviewNotes.find((candidate) =>
        sameInterview(candidate, company, date, round),
      );
      const parsed = parseSeirikou(note.content);
      const annotations = annotationNote
        ? uniqueAnnotations(parseAnnotations(annotationNote.content))
        : [];
      return {
        key: note.path,
        note,
        company,
        date,
        round,
        annotationNote,
        deepReviewNote,
        parsed,
        annotations,
        decisionTasks: reviewDecisionTasks(parsed.sentences, annotations),
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}

// 種別ごとに照合の粒度が違う。二つを別名にしているのは、呼ぶ側で granularity を
// 引数で渡す形にすると「どっちだったか」を毎回思い出す必要があるから。
// 名前で見えていれば、round を入れ忘れて別の回のノートを掴む事故が読んで分かる。

/** 回ごとのノート（練習キュー・回答品質批注など）。company+date+round で照合。 */
export function findRoundNote(notes: Note[], type: string, joined: JoinedReviewNotes) {
  return notes.find(
    (candidate) =>
      getType(candidate) === type &&
      sameInterview(candidate, joined.company, joined.date, joined.round),
  );
}

/** 日ごとのノート（面接結果の復盤など、同日の複数回で1本）。company+date で照合。 */
export function findDayNote(notes: Note[], type: string, joined: JoinedReviewNotes) {
  return notes.find(
    (candidate) => getType(candidate) === type && sameInterview(candidate, joined.company, joined.date),
  );
}
