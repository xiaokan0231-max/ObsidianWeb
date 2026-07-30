import assert from "node:assert/strict";
import test from "node:test";
import { findInterviewPrepDocs, prepWikiTarget } from "../lib/interview-prep-doc.ts";
import {
  groupInterviewPrepDocs,
  interviewPrepTemporalStatus,
  mergePrepExternalLinks,
  prepDocsThroughRound,
  selectRelevantInterviewPrepDoc,
} from "../lib/interview-prep-index.ts";

function prep({
  path,
  company = "株式会社テスト",
  caseLink = "テスト_案件A",
  date = "未定",
  round = "一次面接",
  sessionId = "",
  sessionOrder,
  sessionStatus = "",
  links = [],
}) {
  const sourceLines = links.map(
    (link) => `- ${link.starred ? "★ " : ""}[${link.label}](${link.href})`,
  );
  const content = `# ${company} ${round}

## １１．会社研究リンク集

### ① 公式
${sourceLines.join("\n")}
`;
  return {
    path,
    stat: { ctime: 0, mtime: 0, size: content.length },
    tags: [],
    frontmatter: {
      type: "interview-prep",
      company,
      case: `[[${caseLink}]]`,
      date,
      round,
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(sessionOrder !== undefined ? { session_order: sessionOrder } : {}),
      ...(sessionStatus ? { session_status: sessionStatus } : {}),
    },
    content,
  };
}

test("case が会社表示名より優先され、同じ案件の全輪を一系列に保つ", () => {
  const docs = findInterviewPrepDocs([
    prep({
      path: "20_求職/テスト/面接準備_2026-07-01.md",
      company: "株式会社テスト",
      caseLink: "テスト_案件A",
      date: "2026-07-01",
      round: "カジュアル面談",
    }),
    prep({
      path: "20_求職/テスト/面接準備_s02_一次面接.md",
      company: "テスト",
      caseLink: "テスト_案件A",
      round: "一次面接",
      sessionOrder: 2,
      sessionStatus: "preparing",
    }),
    prep({
      path: "20_求職/テスト/面接準備_案件B.md",
      company: "株式会社テスト",
      caseLink: "テスト_案件B",
      date: "2026-08-10",
      round: "一次面接",
    }),
  ]);
  const series = groupInterviewPrepDocs(docs);
  assert.equal(series.length, 2, "同じ会社でも job-case が違えば混ぜない");
  const caseA = series.find((item) => item.caseLink === "テスト_案件A");
  assert.deepEqual(
    caseA.rounds.map((doc) => doc.round),
    ["カジュアル面談", "一次面接"],
  );
});

test("確定した次回を優先し、無ければ日程未定の preparing を開く", () => {
  const docs = findInterviewPrepDocs([
    prep({
      path: "20_求職/A/old.md",
      caseLink: "A",
      date: "2026-07-20",
      round: "カジュアル面談",
    }),
    prep({
      path: "20_求職/A/preparing.md",
      caseLink: "A",
      round: "一次面接",
      sessionOrder: 2,
      sessionStatus: "preparing",
    }),
    prep({
      path: "20_求職/B/scheduled.md",
      caseLink: "B",
      date: "2026-08-05",
      round: "二次面接",
      sessionStatus: "scheduled",
    }),
  ]);
  assert.equal(
    selectRelevantInterviewPrepDoc(docs, "2026-07-29").note.path,
    "20_求職/B/scheduled.md",
  );
  assert.equal(
    selectRelevantInterviewPrepDoc(
      docs.filter((doc) => doc.caseLink === "A"),
      "2026-07-29",
    ).note.path,
    "20_求職/A/preparing.md",
  );
  assert.equal(
    interviewPrepTemporalStatus(
      docs.find((doc) => doc.note.path.endsWith("preparing.md")),
      "2026-07-29",
    ),
    "preparing",
  );
});

test("案件共用リンクは選択回までだけ累積し、未来回の資料を過去へ混ぜない", () => {
  const docs = findInterviewPrepDocs([
    prep({
      path: "20_求職/A/s01.md",
      caseLink: "A",
      date: "2026-07-01",
      round: "カジュアル面談",
      sessionOrder: 1,
      links: [
        { label: "求人", href: "https://example.com/job", starred: false },
      ],
    }),
    prep({
      path: "20_求職/A/s02.md",
      caseLink: "A",
      date: "2026-07-20",
      round: "一次面接",
      sessionOrder: 2,
      links: [
        { label: "求人再確認", href: "https://example.com/job", starred: true },
        { label: "製品", href: "https://example.com/product", starred: true },
      ],
    }),
    prep({
      path: "20_求職/A/s03.md",
      caseLink: "A",
      date: "2026-08-10",
      round: "最終面接",
      sessionOrder: 3,
      links: [
        { label: "最終前だけ", href: "https://example.com/final", starred: true },
      ],
    }),
  ]);
  const [series] = groupInterviewPrepDocs(docs);
  const selected = series.rounds.find((doc) => doc.sessionOrder === 2);
  const through = prepDocsThroughRound(series, selected);
  const links = mergePrepExternalLinks(through);
  assert.deepEqual(through.map((doc) => doc.sessionOrder), [2, 1]);
  assert.deepEqual(
    links.map((link) => link.href),
    ["https://example.com/job", "https://example.com/product"],
  );
  assert.equal(links[0].starred, true, "現在回の ★ を重複 URL に反映する");
});

test("case の wiki 別名と節を除いて安定した参照先を得る", () => {
  assert.equal(
    prepWikiTarget("[[Sharing_Innovations_データAI責任者候補#概要|表示名]]"),
    "Sharing_Innovations_データAI責任者候補",
  );
});
