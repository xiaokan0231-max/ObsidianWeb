import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { sealAsset } from "../lib/server/sealed-assets.ts";

const magic = Buffer.from("OWSEALED1", "ascii");
class SealingError extends Error {}

function inside(parent, child) {
  const part = relative(parent, child);
  return part === "" || (part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part));
}

async function canonicalPath(path) {
  try { return await realpath(path); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}

async function metadata(path) {
  try { return await lstat(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/** 密钥只保留于调用内存；目标必须为空，避免覆盖原资料或把明密文混装。 */
export async function sealPublishedVault(input) {
  if (!input || typeof input !== "object" || !/^[a-f0-9]{64}$/iu.test(input.secret ?? "")) {
    throw new SealingError("Provide a 64-hex-character encryption secret through stdin.");
  }
  const { secret, source, destination } = input;
  if (typeof source !== "string" || typeof destination !== "string" || !isAbsolute(source) || !isAbsolute(destination)) {
    throw new SealingError("Snapshot source and destination must be absolute directories.");
  }
  const sourceStat = await metadata(source);
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) throw new SealingError("Snapshot source must be a regular directory.");
  if ((await metadata(resolve(destination)))?.isSymbolicLink()) throw new SealingError("Snapshot destination must not be a symbolic link.");
  const sourcePath = await realpath(source), destinationPath = await canonicalPath(resolve(destination));
  if (inside(sourcePath, destinationPath) || inside(destinationPath, sourcePath)) throw new SealingError("Snapshot source and destination must not overlap.");
  const destinationStat = await metadata(destinationPath);
  if (destinationStat && (!destinationStat.isDirectory() || destinationStat.isSymbolicLink() || (await readdir(destinationPath)).length)) {
    throw new SealingError("Snapshot destination must be new or empty.");
  }
  const entries = await readdir(sourcePath, { withFileTypes: true });
  if (!entries.some(entry => entry.name === "manifest.json") || entries.some(entry => !entry.isFile())) {
    throw new SealingError("Snapshot must contain manifest.json and regular files only.");
  }
  const manifest = await readFile(resolve(sourcePath, "manifest.json"));
  if (manifest.subarray(0, magic.length).equals(magic)) throw new SealingError("Snapshot source is already encrypted.");
  try { JSON.parse(manifest.toString("utf8")); } catch { throw new SealingError("Snapshot source manifest must be plaintext JSON."); }
  await mkdir(dirname(destinationPath), { recursive: true });
  const temporary = await mkdtemp(resolve(dirname(destinationPath), basename(destinationPath) + ".seal-"));
  try {
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const bytes = await readFile(resolve(sourcePath, entry.name));
      if (bytes.subarray(0, magic.length).equals(magic)) throw new SealingError("Snapshot source contains an already encrypted file.");
      await writeFile(resolve(temporary, entry.name), await sealAsset(bytes, secret), { mode: 0o600 });
    }
    if (destinationStat) await rmdir(destinationPath);
    await rename(temporary, destinationPath);
    return { files: entries.length, destination: destinationPath };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function readInput() {
  const terminal = process.stdin.isTTY;
  return new Promise((resolveInput, reject) => {
    let value = "", finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      process.stdin.removeListener("data", data);
      process.stdin.removeListener("end", end);
      if (terminal) process.stdin.setRawMode(false);
      process.stdin.pause();
      if (error) reject(error);
      else resolveInput(value);
    };
    const data = chunk => {
      value += chunk;
      if (value.includes("\u0003")) finish(new SealingError("Snapshot encryption cancelled."));
      else if (value.length > 65536) finish(new SealingError("Snapshot input is too large."));
      else if (/[\r\n]/u.test(value)) finish();
    };
    const end = () => finish();
    if (terminal) {
      process.stdin.setRawMode(true);
      process.stderr.write("Ready for snapshot sealing JSON on stdin (input is hidden).\n");
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", data);
    process.stdin.once("end", end);
    process.stdin.resume();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new SealingError("Provide snapshot settings as one JSON object on stdin, without arguments.");
    let input;
    try { input = JSON.parse(await readInput()); } catch (error) {
      if (error instanceof SealingError) throw error;
      throw new SealingError("Provide snapshot settings as one JSON object on stdin.");
    }
    console.log(JSON.stringify(await sealPublishedVault(input)));
  } catch (error) {
    process.stderr.write((error instanceof SealingError ? error.message : "Unable to encrypt the published snapshot.") + "\n");
    process.exitCode = 1;
  }
}
