// MediaPipe の wasm と手勢モデルを public/mediapipe/ に用意する。
//
// なぜ自托管か：graph-hand-controls は以前 jsdelivr（wasm）と
// storage.googleapis.com（モデル、しかもバージョン無しの latest URL）を
// 実行時に引いていた。オフラインや CSP を締めた環境で手勢が静かに死ぬ上、
// Google 側がモデルを差し替えると挙動が黙って変わる。
//
// wasm は node_modules（package.json が 1.0.1 に固定）からコピー、
// モデルはバージョン付きの正規 URL から一度だけ取得する。
// 生成物は 34MB あるので git には入れない（.gitignore 済み）。
// dev / build の前段で毎回呼ばれるが、揃っていれば何もしない。
// 取得に失敗しても exit 0——クライアント側が CDN へフォールバックする。
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wasmSource = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmTarget = join(root, "public/mediapipe/wasm");
const modelTarget = join(root, "public/mediapipe/gesture_recognizer.task");

// バージョンを固定した正規配布 URL（コード内の latest URL と違い、勝手に変わらない）
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const MODEL_MIN_BYTES = 1_000_000;

const WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

let copied = 0;
await mkdir(wasmTarget, { recursive: true });
for (const name of WASM_FILES) {
  const source = join(wasmSource, name);
  const target = join(wasmTarget, name);
  const sourceSize = await fileSize(source);
  if (sourceSize < 0) continue; // node_modules 未整備なら黙って任せる
  if (sourceSize === (await fileSize(target))) continue;
  await copyFile(source, target);
  copied += 1;
}

let model = "cached";
if ((await fileSize(modelTarget)) < MODEL_MIN_BYTES) {
  try {
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length < MODEL_MIN_BYTES) throw new Error(`suspiciously small: ${body.length}B`);
    await writeFile(modelTarget, body);
    model = `downloaded ${(body.length / 1024 / 1024).toFixed(1)}MB`;
  } catch (error) {
    model = `unavailable (${error instanceof Error ? error.message : error}); クライアントは CDN へフォールバック`;
  }
}

console.log(`[mediapipe] wasm: ${copied ? `${copied} 件コピー` : "最新"} / model: ${model}`);
