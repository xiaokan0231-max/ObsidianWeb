import { access, cp, lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const sealedMagic = Buffer.from("OWSEALED1", "ascii");
const minimumSealedBytes = sealedMagic.length + 12 + 16;

async function sealedFile(path: string): Promise<boolean> {
  let file;
  try {
    file = await open(path, "r");
    const prefix = Buffer.alloc(minimumSealedBytes);
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    return bytesRead === prefix.length && prefix.subarray(0, sealedMagic.length).equals(sealedMagic);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  } finally { await file?.close(); }
}

async function validateSealedDirectory(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !await sealedFile(resolve(directory, entry.name))) {
      throw new Error("发布快照包含未加密或非普通文件，拒绝包装。");
    }
  }
}

/** 平台可能先提供静态文件；构建产物只能含密文，不能依赖 Worker 路由来遮住明文。 */
export async function copySealedPublishedVault(source: string, destination: string): Promise<boolean> {
  const sourcePath = resolve(source), outputPath = resolve(destination);
  const overlap = (parent: string, child: string) => {
    const part = relative(parent, child);
    return part === "" || (part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part));
  };
  if (overlap(sourcePath, outputPath) || overlap(outputPath, sourcePath)) throw new Error("快照输入与输出目录不能重叠。");
  const temporary = outputPath + ".sealed-tmp";
  // Vite 会先复制 public；即使本机未执行加密，也要移除已复制的明文与上轮资产。
  await rm(outputPath, { recursive: true, force: true });
  await rm(temporary, { recursive: true, force: true });
  const sourceStat = await lstat(sourcePath).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!sourceStat) return false;
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error("发布快照必须是普通目录。");
  const manifest = (await readdir(sourcePath, { withFileTypes: true })).find(entry => entry.name === "manifest.json");
  if (!manifest?.isFile()) return false;
  if (!await sealedFile(resolve(sourcePath, "manifest.json"))) return false;
  await validateSealedDirectory(sourcePath);
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await cp(sourcePath, temporary, { recursive: true });
    await validateSealedDirectory(temporary);
    await rename(temporary, outputPath);
    return true;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

// Packages Sites metadata and migrations after Vite finishes compiling.
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const outputDirectory = resolve(root, "dist", ".openai");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "drizzle");
      const publishedSource = resolve(root, "public", "_published-vault");
      const publishedOutput = resolve(root, "dist", "client", "_published-vault");

      await copySealedPublishedVault(publishedSource, publishedOutput);

      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });

      if (await exists(hostingConfig)) {
        await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
      }
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(outputDirectory, "drizzle"), {
          recursive: true,
        });
      }
    },
  };
}
