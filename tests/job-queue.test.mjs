import assert from "node:assert/strict";
import test from "node:test";

import {
  parseQueue,
  queueCompanyKey,
  queueRefKey,
  queueStats,
  reconcileQueue,
} from "../lib/job-queue.mjs";

const QUEUE_BODY = `
## キュー本体

| 発見日 | 媒体 | 会社 | 職種名 | 求人ID/URL | kw |
|---|---|---|---|---|---|
| 2026-07-22 | Indeed | ソニー株式会社 | データ基盤エンジニア（リーダークラス） | jp.indeed.com/viewjob?jk=7a02 | Hadoop |
| 2026-07-22 | Green | 株式会社福岡銀行 | データエンジニア（データレイク＋分析基盤） | green-japan.com/job/188059 | Hadoop |
| 2026-07-21 | RA | 株式会社リクルート | データスペシャリスト | PDT検索 kw=Hive | Hive |
`;

test("parseQueue reads rows and skips the header and separator", () => {
  const rows = parseQueue(QUEUE_BODY);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    found: "2026-07-22",
    media: "Indeed",
    company: "ソニー株式会社",
    position: "データ基盤エンジニア（リーダークラス）",
    ref: "jp.indeed.com/viewjob?jk=7a02",
    kw: "Hadoop",
  });
});

test("queueCompanyKey absorbs 株式会社 position, width and bracket noise", () => {
  assert.equal(queueCompanyKey("株式会社ＳＵＮＰＩＮ　ＪＡＰＡＮ"), queueCompanyKey("SUNPIN JAPAN株式会社"));
  assert.equal(queueCompanyKey("株式会社キタムラ(カメラのキタムラ)"), queueCompanyKey("キタムラ"));
});

test("queueRefKey pulls a stable posting id out of each site's URL form", () => {
  assert.equal(queueRefKey("jp.indeed.com/viewjob?jk=7A02C827B5F44E6D"), "indeed:7a02c827b5f44e6d");
  assert.equal(queueRefKey("green-japan.com/job/188059"), "green:188059");
  assert.equal(queueRefKey("https://www.green-japan.com/company/6789/job/188059"), "green:188059");
  assert.equal(queueRefKey("https://www.r-agent.com/viewjob/jk4b9daf9a67f13b3d/"), "ra:4b9daf9a67f13b3d");
  assert.equal(queueRefKey("PDT検索 kw=Spark"), null, "IDが無い行は null");
  assert.equal(queueRefKey(""), null);
});

test("reconcile matches on posting id even when the two titles disagree", () => {
  const rows = parseQueue(QUEUE_BODY);
  // 媒体一覧のタイトルと求人票のタイトルは揃わない。ID が一次キーである理由。
  const notes = [
    {
      company: "ソニー株式会社",
      position: "データ基盤エンジニア(リーダークラス/ハイブリッド勤務/フルフレックス制度)",
      url: "https://jp.indeed.com/viewjob?jk=7a02",
      kind: "job-case",
    },
  ];
  const reconciled = reconcileQueue(rows, notes);

  assert.equal(reconciled[0].reviewed, true, "タイトルがずれていても求人IDで一致する");
  assert.equal(reconciled[0].reviewedAs, "job-case");
  assert.equal(reconciled[1].reviewed, false);
});

test("a different posting at the same company stays pending", () => {
  const rows = parseQueue(QUEUE_BODY);
  // ソニーは同社2求人あり、片方だけ起票済み。会社名で束ねると取り違える。
  const notes = [
    {
      company: "ソニー株式会社",
      position: "データ基盤エンジニア（上級担当クラス）",
      url: "https://jp.indeed.com/viewjob?jk=b82bddd19f93dd34",
      kind: "excluded-job",
    },
  ];
  const reconciled = reconcileQueue(rows, notes);
  assert.equal(reconciled[0].reviewed, false, "別求人IDのノートでは精読済みにならない");
});

test("rows without a posting id fall back to company and position matching", () => {
  const rows = parseQueue(QUEUE_BODY);
  const notes = [
    { company: "株式会社リクルート", position: "データスペシャリスト（オープンポジション）", url: "", kind: "job-case" },
  ];
  const reconciled = reconcileQueue(rows, notes);
  assert.equal(reconciled[2].reviewed, true, "RA検索行はIDが無いので会社＋職種で拾う");
});

test("queueStats counts pending rows and breaks them down by media", () => {
  const rows = parseQueue(QUEUE_BODY);
  const notes = [
    {
      company: "株式会社福岡銀行",
      position: "データエンジニア（データレイク＋分析基盤）",
      url: "green-japan.com/job/188059",
      kind: "job-case",
    },
  ];
  const stats = queueStats(rows, notes);

  assert.equal(stats.total, 3);
  assert.equal(stats.reviewed, 1);
  assert.equal(stats.pending, 2);
  assert.deepEqual(new Map(stats.byMedia), new Map([["Indeed", 1], ["RA", 1]]));
  assert.equal(stats.lastFound, "2026-07-22");
});

test("a row marked 取下げ leaves the pending count instead of sitting there forever", () => {
  const withdrawnBody = QUEUE_BODY.replace(
    "データスペシャリスト",
    "データスペシャリスト【取下げ:掲載終了】",
  );
  const stats = queueStats(parseQueue(withdrawnBody), []);

  assert.equal(stats.total, 3);
  assert.equal(stats.withdrawn, 1);
  assert.equal(stats.pending, 2, "取下げ済みは未精読に数えない");
  assert.deepEqual(new Map(stats.byMedia), new Map([["Indeed", 1], ["Green", 1]]));
});

test("an empty queue yields zero counts instead of throwing", () => {
  const stats = queueStats(parseQueue(""), []);
  assert.equal(stats.total, 0);
  assert.equal(stats.pending, 0);
  assert.equal(stats.lastFound, null);
});
