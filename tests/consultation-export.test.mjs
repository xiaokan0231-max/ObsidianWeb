import assert from "node:assert/strict";
import test from "node:test";
import { exportConsultationCompanies, exportConsultationTranscript } from "../lib/consultation-export.ts";

const summary = { id: "session-a", companyId: "company-a", company: "株式会社テスト & <研究所>", date: "2026-10-15", round: "一次面接", outcome: "結果未確認", outcomeKind: "unknown", hasRaw: true, hasReadable: true };
const transcript = { ...summary, notice: "聞き取りが不確かな箇所があります。", raw: "面接官：自己紹介をお願いします。\n\n私：開発と運用を担当しました。\n最後の行", blocks: [{ id: "intro", title: "自己紹介", turns: [{ id: "one", speaker: "interviewer", text: "自己紹介をお願いします。", uncertain: false }, { id: "two", speaker: "self", text: 'A & B < C > D "引用" \'発言\'\n二行目です。\t補足', uncertain: false }, { id: "three", speaker: "unknown", text: "確認できなかった発言", uncertain: true }] }] };

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function unpack(bytes) {
  assert.ok(bytes instanceof Uint8Array);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map();
  const offsets = new Map();
  let cursor = 0;
  while (view.getUint32(cursor, true) === 0x04034b50) {
    assert.equal(view.getUint16(cursor + 8, true), 0);
    const size = view.getUint32(cursor + 18, true);
    assert.equal(size, view.getUint32(cursor + 22, true));
    const nameLength = view.getUint16(cursor + 26, true);
    const extraLength = view.getUint16(cursor + 28, true);
    const name = decoder.decode(bytes.subarray(cursor + 30, cursor + 30 + nameLength));
    const start = cursor + 30 + nameLength + extraLength;
    const content = bytes.subarray(start, start + size);
    assert.equal(crc32(content), view.getUint32(cursor + 14, true), `CRC for ${name}`);
    files.set(name, decoder.decode(content));
    offsets.set(name, cursor);
    cursor = start + size;
  }
  const centralStart = cursor;
  let centralCount = 0;
  while (view.getUint32(cursor, true) === 0x02014b50) {
    const nameLength = view.getUint16(cursor + 28, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    assert.equal(view.getUint32(cursor + 42, true), offsets.get(name));
    cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    centralCount++;
  }
  assert.equal(view.getUint32(cursor, true), 0x06054b50);
  assert.equal(view.getUint16(cursor + 10, true), files.size);
  assert.equal(centralCount, files.size);
  assert.equal(view.getUint32(cursor + 12, true), cursor - centralStart);
  assert.equal(view.getUint32(cursor + 16, true), centralStart);
  assert.equal(cursor + 22, bytes.length);
  return files;
}

function plain(document) {
  return document.replace(/<w:br\s*\/>/g, "\n").replace(/<w:tab\s*\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

test("exports a real DOCX package with OpenXML relationships, Japanese typography and A4 layout", () => {
  const files = unpack(exportConsultationTranscript(transcript, "readable"));
  assert.equal(files.size, 8);
  assert.match(files.get("[Content_Types].xml"), /wordprocessingml.document.main\+xml/);
  assert.match(files.get("_rels/.rels"), /Target="word\/document.xml"/);
  assert.match(files.get("word/_rels/document.xml.rels"), /Target="styles.xml"/);
  assert.match(files.get("word/styles.xml"), /w:eastAsia="Yu Gothic"/);
  assert.match(files.get("word/styles.xml"), /w:eastAsia="ja-JP"/);
  assert.match(files.get("word/document.xml"), /<w:pgSz w:w="11906" w:h="16838"\/>/);
  assert.match(files.get("word/document.xml"), /w:pStyle w:val="Title"/);
  assert.doesNotMatch(files.get("docProps/core.xml"), /creator|lastModifiedBy/);
});

test("preserves Japanese speech, order, line breaks and uncertainty while escaping XML", () => {
  const source = unpack(exportConsultationTranscript(transcript, "readable")).get("word/document.xml");
  assert.match(source, /株式会社テスト &amp; &lt;研究所&gt;/);
  assert.match(source, /A &amp; B &lt; C &gt; D &quot;引用&quot; &apos;発言&apos;/);
  assert.match(source, /<w:br\/>/);
  assert.match(source, /<w:tab\/>/);
  const text = plain(source);
  assert.match(text, /一次面接/);
  assert.match(text, /結果未確認/);
  assert.match(text, /読みやすい逐句稿/);
  assert.ok(text.indexOf("自己紹介をお願いします。") < text.indexOf("A & B < C"));
  assert.ok(text.indexOf("A & B < C") < text.indexOf("確認できなかった発言"));
  assert.ok(text.includes(transcript.blocks[0].turns[1].text));
  assert.match(text, /話者未確認　聞き取り要確認/);
  assert.doesNotMatch(text, /不採用/);
});

test("raw export preserves blank lines and only includes the original transcription", () => {
  const text = plain(unpack(exportConsultationTranscript(transcript, "raw")).get("word/document.xml"));
  assert.ok(text.includes(transcript.raw));
  assert.match(text, /原始文字起こし/);
  assert.doesNotMatch(text, /確認できなかった発言|A & B < C/);
});

test("memory reconstructions cannot be mislabeled as actual transcriptions", () => {
  const memory = { ...transcript, recordKind: "memory", notice: "本人の記憶から再構成した資料です。実際の逐語発言とは区別してください。" };
  for (const mode of ["raw", "readable"]) {
    const text = plain(unpack(exportConsultationTranscript(memory, mode)).get("word/document.xml"));
    assert.match(text, /記憶から再構成した記録/);
    assert.match(text, /録音に基づく逐語記録ではありません。/);
    assert.doesNotMatch(text, /原始文字起こし|読みやすい逐句稿/);
  }
});

test("long transcripts are never truncated and flow without fixed-height rows", () => {
  const lines = Array.from({ length: 1200 }, (_, index) => `${index + 1}行目　面接で説明した開発経験と具体的な対応について記録しています。`);
  const long = { ...transcript, raw: lines.join("\n"), blocks: [{ id: "long", title: "長い面接", turns: lines.map((text, index) => ({ id: `${index}`, speaker: index % 2 ? "self" : "interviewer", text, uncertain: false })) }] };
  for (const mode of ["raw", "readable"]) {
    const source = unpack(exportConsultationTranscript(long, mode)).get("word/document.xml");
    const text = plain(source);
    let previous = -1;
    for (const line of lines) {
      const position = text.indexOf(line);
      assert.ok(position > previous, `${mode}: ${line}`);
      previous = position;
    }
    assert.doesNotMatch(source, /w:trHeight|w:pageBreakBefore/);
  }
});

test("company exports retain all companies and positions with exact known or unknown outcomes", () => {
  const catalog = { updatedAt: "2026-10-18", sessions: [summary], companies: [{ id: "company-a", company: summary.company, applications: [{ id: "job-a", position: "開発エンジニア", status: "結果未確認", appliedOn: "2026-10-01", updatedOn: "2026-10-15", channel: "直接応募" }, { id: "job-b", position: "運用エンジニア", status: "面接中", appliedOn: "2026-10-02", updatedOn: "2026-10-16", channel: "求人サイト" }], sessionIds: [summary.id], latestDate: summary.date, outcome: "複数の選考状況あり" }, ...Array.from({ length: 7 }, (_, index) => ({ id: `other-${index}`, company: `株式会社テスト${index}`, applications: [], sessionIds: [], latestDate: "", outcome: "未確認" }))] };
  const source = unpack(exportConsultationCompanies(catalog)).get("word/document.xml");
  const text = plain(source);
  assert.match(text, /面接した企業と選考の記録/);
  assert.match(text, /記録から面接の実施を確認できる企業を、原稿の有無とは別に掲載しています。/);
  for (const company of catalog.companies) assert.ok(text.includes(company.company));
  assert.match(text, /開発エンジニア/);
  assert.match(text, /運用エンジニア/);
  assert.match(text, /結果未確認/);
  assert.match(text, /面接中/);
  assert.match(text, /一次面接/);
  assert.match(source, /<w:tblHeader\/>/);
  assert.doesNotMatch(text, /最終面接に進行|面接通過の記録あり/);
});

test("company histories retain earlier interview success alongside later final-round rejection", () => {
  const first = { ...summary, id: "first", date: "2026-10-01", round: "一次面接", outcome: "次の選考へ進行", outcomeKind: "passed" };
  const last = { ...summary, id: "final", date: "2026-10-15", round: "最終面接", outcome: "不採用", outcomeKind: "rejected" };
  const catalog = { updatedAt: "2026-10-18", sessions: [first, last], companies: [{ id: summary.companyId, company: summary.company, applications: [{ id: "job-a", position: "開発エンジニア", status: "不採用", appliedOn: "2026-09-15", updatedOn: "2026-10-16", channel: "直接応募" }, { id: "job-b", position: "運用エンジニア", status: "面接中", appliedOn: "2026-10-02", updatedOn: "2026-10-16", channel: "求人サイト" }], sessionIds: [first.id, last.id], latestDate: last.date, outcome: "不採用 / 面接中", reachedFinal: true, hasPassedInterview: true }] };
  const text = plain(unpack(exportConsultationCompanies(catalog)).get("word/document.xml"));
  assert.match(text, /現在の応募状況　不採用 \/ 面接中/);
  assert.match(text, /最終面接に進行 \/ 面接通過の記録あり/);
  assert.match(text, /2026-10-01　一次面接　次の選考へ進行/);
  assert.match(text, /2026-10-15　最終面接　不採用/);
  assert.match(text, /開発エンジニア\n不採用/);
  assert.match(text, /運用エンジニア\n面接中/);
});

test("absent or false interview milestones do not imply rejection or claim progress", () => {
  for (const milestones of [{}, { reachedFinal: false, hasPassedInterview: false }]) {
    const catalog = { updatedAt: "", sessions: [summary], companies: [{ id: summary.companyId, company: summary.company, applications: [], sessionIds: [summary.id], latestDate: summary.date, outcome: "結果未確認", ...milestones }] };
    const text = plain(unpack(exportConsultationCompanies(catalog)).get("word/document.xml"));
    assert.match(text, /現在の応募状況　結果未確認/);
    assert.doesNotMatch(text, /最終面接に進行|面接通過の記録あり|面接の進行記録/);
    assert.doesNotMatch(text.split("情報更新")[1], /不採用/);
  }
});

test("company counts include completed interviews without scripts and show readable scripts as a subset", () => {
  const first = { ...summary, id: "first", date: "2026-10-01", round: "一次面接", outcome: "次の選考へ進行", outcomeKind: "passed" };
  const last = { ...summary, id: "final", date: "2026-10-15", round: "最終面接", outcome: "不採用", outcomeKind: "rejected" };
  const withScripts = { id: summary.companyId, company: summary.company, applications: [], sessionIds: [first.id, last.id], latestDate: last.date, outcome: "不採用", hasTranscript: true,
    interviews: [first, last].map(session => ({ id: `history-${session.id}`, date: session.date, round: session.round, stage: session.round === "最終面接" ? "final" : "round-1", outcome: session.outcome, outcomeKind: session.outcomeKind, sessionId: session.id, evidenceKind: "transcript" })) };
  const withoutScript = { id: "without-script", company: "株式会社原稿なしテスト", applications: [{ id: "no-script-job", position: "品質エンジニア", status: "不採用", appliedOn: "2026-09-01", updatedOn: "2026-10-20", channel: "直接応募" }], sessionIds: [], latestDate: "", outcome: "不採用", hasTranscript: false,
    interviews: [{ id: "completed", date: "", round: "", stage: "", outcome: "不採用", outcomeKind: "rejected", evidenceKind: "history" }] };
  const catalog = { updatedAt: "2026-10-21", companies: [withScripts, withoutScript], sessions: [first, last] };
  const text = plain(unpack(exportConsultationCompanies(catalog)).get("word/document.xml"));
  assert.match(text, /確認できた範囲の一覧です。/);
  assert.match(text, /面接実施を確認できる企業　2 社/);
  assert.match(text, /原稿のある企業　1 社/);
  assert.match(text, /読める面接原稿　2 件/);
  assert.match(text, /原稿　あり（2 件）/);
  assert.match(text, /株式会社原稿なしテスト/);
  assert.match(text, /原稿　未登録（面接実施の記録あり）/);
  assert.match(text, /面接履歴　日付未確認　面接段階は未確認　不採用　原稿未登録/);
  assert.doesNotMatch(text, /面接履歴　2026-10-20/);
  assert.match(text, /2026-10-01　一次面接　次の選考へ進行　原稿あり/);
  assert.match(text, /2026-10-15　最終面接　不採用　原稿あり/);
});

test("historical positions remain visible when no current application is linked", () => {
  const catalog = { updatedAt: "", sessions: [], companies: [{ id: "historical", company: "株式会社履歴テスト", applications: [], sessionIds: [], latestDate: "", outcome: "不採用", hasTranscript: false,
    interviews: [{ id: "history-a", date: "", round: "一次面接", stage: "round-1", outcome: "不採用", outcomeKind: "rejected", evidenceKind: "history", position: "品質 & 運用エンジニア" }] }] };
  const source = unpack(exportConsultationCompanies(catalog)).get("word/document.xml");
  const text = plain(source);
  assert.match(text, /現在の応募案件との関連は未確認です。/);
  assert.match(text, /面接履歴　日付未確認　一次面接　職種：品質 & 運用エンジニア　不採用　原稿未登録/);
  assert.match(source, /職種：品質 &amp; 運用エンジニア/);
  assert.doesNotMatch(text, /職種別の応募情報は記録されていません/);
});

test("empty catalogs and XML-invalid control characters still produce a readable package", () => {
  const empty = plain(unpack(exportConsultationCompanies({ companies: [], sessions: [], updatedAt: "" })).get("word/document.xml"));
  assert.match(empty, /面接の実施を確認できる企業はありません。/);
  const unsafe = { ...transcript, raw: "有効な文字\u0000\u000b\u000cと日本語😀" };
  const source = unpack(exportConsultationTranscript(unsafe, "raw")).get("word/document.xml");
  assert.doesNotMatch(source, /[\u0000\u000b\u000c]/);
  assert.match(plain(source), /有効な文字と日本語😀/);
});
