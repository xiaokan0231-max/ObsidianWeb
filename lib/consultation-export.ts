import type { ConsultationCatalog, ConsultationTranscript } from "./consultation-library";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const encoder = new TextEncoder();

function xml(value: string): string {
  // 仅移除 XML 1.0 不允许的控制字符，保留发言原文与换行。
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function textRun(text: string, bold = false): string {
  const content = text.split(/(\r\n|\r|\n|\t)/).map((part) => {
    if (/^(?:\r\n|\r|\n)$/.test(part)) return "<w:br/>";
    if (part === "\t") return "<w:tab/>";
    return `<w:t xml:space="preserve">${xml(part)}</w:t>`;
  }).join("");
  return `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}${content}</w:r>`;
}

function paragraph(text: string, style = "Normal"): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${textRun(text)}</w:p>`;
}

function shown(value: string | undefined | null, fallback = "未確認"): string {
  return value?.trim() || fallback;
}

function metadata(label: string, value: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="Metadata"/></w:pPr>${textRun(`${label}　`, true)}${textRun(value)}</w:p>`;
}

function table(headers: string[], rows: string[][]): string {
  const widths = [3020, 2180, 1420, 1420, 1598];
  const border = '<w:top w:val="single" w:sz="4" w:color="D9D9D9"/><w:left w:val="single" w:sz="4" w:color="D9D9D9"/><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/><w:right w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideH w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideV w:val="single" w:sz="4" w:color="D9D9D9"/>';
  const row = (cells: string[], header: boolean) => `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.map((cell, index) => `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/><w:vAlign w:val="center"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EEF4"/>' : ""}</w:tcPr><w:p><w:pPr><w:pStyle w:val="TableText"/>${index > 1 && index < 4 ? '<w:jc w:val="center"/>' : ""}</w:pPr>${textRun(cell, header)}</w:p></w:tc>`).join("")}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${row(headers, true)}${rows.map((cells) => row(cells, false)).join("")}</w:tbl>`;
}

const styles = `${XML_HEADER}<w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Yu Gothic"/><w:color w:val="000000"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="260"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="27"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Metadata"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Speaker"><w:name w:val="Speaker"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style></w:styles>`;

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: [string, string][]): Uint8Array {
  // 使用标准 ZIP 无压缩封装，让 Cloudflare Worker 无需 Node 或文件系统也能生成 Word。
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;
  for (const [path, source] of entries) {
    const name = encoder.encode(path);
    const data = encoder.encode(source);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(12, 33, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    centralSize += central.length;
    offset += local.length + data.length;
  }
  const footer = new Uint8Array(22);
  const fv = new DataView(footer.buffer);
  fv.setUint32(0, 0x06054b50, true);
  fv.setUint16(8, entries.length, true);
  fv.setUint16(10, entries.length, true);
  fv.setUint32(12, centralSize, true);
  fv.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + footer.length);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, footer]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

function document(title: string, body: string): Uint8Array {
  const relationships = `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${OFFICE_REL_NS}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const contentTypes = `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const doc = `${XML_HEADER}<w:document xmlns:w="${WORD_NS}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`;
  return zip([
    ["[Content_Types].xml", contentTypes],
    ["_rels/.rels", relationships],
    ["docProps/core.xml", `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title></cp:coreProperties>`],
    ["docProps/app.xml", `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ObsidianWeb</Application></Properties>`],
    ["word/document.xml", doc],
    ["word/_rels/document.xml.rels", `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${OFFICE_REL_NS}/settings" Target="settings.xml"/></Relationships>`],
    ["word/styles.xml", styles],
    ["word/settings.xml", `${XML_HEADER}<w:settings xmlns:w="${WORD_NS}"><w:defaultTabStop w:val="420"/><w:characterSpacingControl w:val="doNotCompress"/></w:settings>`],
  ]);
}

export function exportConsultationCompanies(catalog: ConsultationCatalog): Uint8Array {
  const title = "面接した企業と選考の記録";
  const companyIds = new Set(catalog.companies.map(company => company.id));
  const sessions = new Map(catalog.sessions.filter(session => companyIds.has(session.companyId) && (session.hasRaw || session.hasReadable)).map(session => [session.id, session]));
  const companiesWithTranscripts = catalog.companies.filter(company => company.sessionIds.some(id => sessions.has(id))).length;
  const parts = [paragraph(title, "Title"), paragraph("記録から面接の実施を確認できる企業を、原稿の有無とは別に掲載しています。確認できた範囲の一覧です。職種ごとの現在の選考状況と各回の面接結果を並べ、過去の面接通過とその後の不採用を分けて表示しています。未確認の日付・結果は未確認のまま記載しています。"), metadata("面接実施を確認できる企業", `${catalog.companies.length} 社`), metadata("原稿のある企業", `${companiesWithTranscripts} 社`), metadata("読める面接原稿", `${sessions.size} 件`), metadata("情報更新", shown(catalog.updatedAt, "日時未確認"))];
  for (const company of catalog.companies) {
    parts.push(paragraph(company.company, "Heading1"));
    parts.push(metadata("現在の応募状況", shown(company.outcome)));
    const progress = [company.reachedFinal ? "最終面接に進行" : "", company.hasPassedInterview ? "面接通過の記録あり" : ""].filter(Boolean);
    if (progress.length) parts.push(metadata("面接の進行記録", progress.join(" / ")));
    const companySessions = company.sessionIds.map(id => sessions.get(id)).filter(session => session !== undefined);
    parts.push(metadata("原稿", companySessions.length ? `あり（${companySessions.length} 件）` : "未登録（面接実施の記録あり）"));
    if (company.applications.length) {
      parts.push(table(["職種", "選考状況", "応募日", "更新日", "応募経路"], company.applications.map((application) => [shown(application.position, "職種未記録"), shown(application.status), shown(application.appliedOn, "未記録"), shown(application.updatedOn, "未記録"), shown(application.channel, "未記録")])));
      parts.push(paragraph("", "Metadata"));
    } else {
      parts.push(paragraph("現在の応募案件との関連は未確認です。", "Metadata"));
    }
    if (company.interviews?.length) {
      for (const interview of company.interviews) {
        const session = interview.sessionId ? sessions.get(interview.sessionId) : undefined;
        const material = session ? session.recordKind === "memory" ? "記憶から再構成した資料あり" : "原稿あり" : "原稿未登録";
        parts.push(metadata("面接履歴", `${shown(interview.date, "日付未確認")}　${shown(interview.round, "面接段階は未確認")}　${interview.position ? `職種：${interview.position}　` : ""}${shown(interview.outcome)}　${material}`));
      }
    } else {
      for (const session of companySessions) {
        parts.push(metadata("面接履歴", `${shown(session.date, "日付未確認")}　${shown(session.round, "面接・面談")}　${shown(session.outcome)}　${session.recordKind === "memory" ? "記憶から再構成した資料あり" : "原稿あり"}`));
      }
    }
  }
  if (!catalog.companies.length) parts.push(paragraph("面接の実施を確認できる企業はありません。"));
  return document(title, parts.join(""));
}

export function exportConsultationTranscript(transcript: ConsultationTranscript, view: "readable" | "raw"): Uint8Array {
  const raw = view === "raw";
  const memory = transcript.recordKind === "memory";
  const sourceType = memory ? (raw ? "記憶から再構成した記録の原文" : "記憶から再構成した記録") : (raw ? "原始文字起こし" : "読みやすい逐句稿");
  const title = `${transcript.company} 面接記録`;
  const introduction = memory ? "本人の記憶から再構成した資料です。録音に基づく逐語記録ではありません。"
    : raw ? "文字起こしの原文です。聞き取りや話者の判定に誤りが含まれる場合があります。改行と発言の順序を保持しています。"
    : "記録にある発言を話者ごとに掲載しています。聞き取りや話者が未確認の箇所は、そのまま明示しています。整理方法と聞き取りの状況は、以下の注記をご確認ください。";
  const parts = [paragraph(title, "Title"), metadata("面接日", shown(transcript.date, "日付未確認")), metadata("面接段階", shown(transcript.round, "面接・面談")), metadata("選考結果", shown(transcript.outcome)), metadata("資料の種類", sourceType), paragraph(introduction)];
  if (transcript.notice) parts.push(paragraph(transcript.notice));
  if (raw) {
    parts.push(paragraph(sourceType, "Heading1"));
    // 按原始行拆分段落，使长稿自然分页，同时保留空行。
    for (const line of transcript.raw.split(/\r\n|\r|\n/)) parts.push(paragraph(line));
  } else {
    for (const block of transcript.blocks) {
      if (block.title) parts.push(paragraph(block.title, "Heading1"));
      for (const turn of block.turns) {
        const speaker = turn.speaker === "interviewer" ? "面接官" : turn.speaker === "self" ? "私" : "話者未確認";
        parts.push(paragraph(`${speaker}${turn.uncertain ? "　聞き取り要確認" : ""}`, "Speaker"));
        parts.push(paragraph(turn.text));
      }
    }
  }
  return document(title, parts.join(""));
}
