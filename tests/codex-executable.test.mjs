import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { resolveCodexExecutable } from "../scripts/codex-executable.mjs";

const bundledPaths = [
  "ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  "ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
  "Codex.app/Contents/Resources/codex",
];

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "codex-executable-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    applicationDirectories: [join(directory, "Applications"), join(directory, "user", "Applications")],
  };
}

async function executable(path, mode = 0o755) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "#!/bin/sh\nexit 0\n");
  await chmod(path, mode);
  return path;
}

test("Codex on PATH takes precedence over desktop application binaries", async (t) => {
  const { directory, applicationDirectories } = await fixture(t);
  const pathBinary = await executable(join(directory, "bin", "codex"));
  await executable(join(applicationDirectories[0], bundledPaths[0]));

  assert.equal(resolveCodexExecutable({
    env: { PATH: dirname(pathBinary) },
    platform: "darwin",
    applicationDirectories,
  }), pathBinary);
});

for (const bundledPath of bundledPaths) {
  test(`Codex falls back to the desktop binary at ${bundledPath}`, async (t) => {
    const { applicationDirectories } = await fixture(t);
    const bundledBinary = await executable(join(applicationDirectories[0], bundledPath));

    assert.equal(resolveCodexExecutable({
      env: { PATH: "" },
      platform: "darwin",
      applicationDirectories,
    }), bundledBinary);
  });
}

test("Codex discovers desktop applications in the user's Applications directory", async (t) => {
  const { applicationDirectories } = await fixture(t);
  const bundledBinary = await executable(join(applicationDirectories[1], bundledPaths[0]));

  assert.equal(resolveCodexExecutable({
    env: { PATH: "" },
    platform: "darwin",
    applicationDirectories,
  }), bundledBinary);
});

test("an explicit Codex path takes precedence over PATH and desktop applications", async (t) => {
  const { directory, applicationDirectories } = await fixture(t);
  const configuredBinary = await executable(join(directory, "configured", "custom-codex"));
  const pathBinary = await executable(join(directory, "bin", "codex"));
  await executable(join(applicationDirectories[0], bundledPaths[0]));

  assert.equal(resolveCodexExecutable({
    env: { CODEX_BRIDGE_CODEX_PATH: configuredBinary, PATH: dirname(pathBinary) },
    platform: "darwin",
    applicationDirectories,
  }), configuredBinary);
});

test("an explicit Codex command name is resolved through PATH", async (t) => {
  const { directory, applicationDirectories } = await fixture(t);
  const configuredBinary = await executable(join(directory, "bin", "custom-codex"));
  await executable(join(directory, "bin", "codex"));

  assert.equal(resolveCodexExecutable({
    env: { CODEX_BRIDGE_CODEX_PATH: "custom-codex", PATH: dirname(configuredBinary) },
    platform: "darwin",
    applicationDirectories,
  }), configuredBinary);
});

test("an invalid explicit Codex path is not hidden by a working fallback", async (t) => {
  const { directory, applicationDirectories } = await fixture(t);
  const pathBinary = await executable(join(directory, "bin", "codex"));
  await executable(join(applicationDirectories[0], bundledPaths[0]));

  for (const configuredPath of [join(directory, "missing-codex"), "missing-command"]) {
    assert.throws(() => resolveCodexExecutable({
      env: { CODEX_BRIDGE_CODEX_PATH: configuredPath, PATH: dirname(pathBinary) },
      platform: "darwin",
      applicationDirectories,
    }), /CODEX_BRIDGE_CODEX_PATH/);
  }
});

test("Codex skips non-executable files and executable directories on PATH", async (t) => {
  const { directory, applicationDirectories } = await fixture(t);
  const nonExecutable = await executable(join(directory, "non-executable", "codex"), 0o644);
  const executableDirectory = join(directory, "directory-entry", "codex");
  await mkdir(executableDirectory, { recursive: true });
  await chmod(executableDirectory, 0o755);
  const pathBinary = await executable(join(directory, "valid", "codex"));

  assert.equal(resolveCodexExecutable({
    env: { PATH: [dirname(nonExecutable), dirname(executableDirectory), dirname(pathBinary)].join(":") },
    platform: "darwin",
    applicationDirectories,
  }), pathBinary);
});

test("Codex skips non-executable desktop files and executable directories", async (t) => {
  const { applicationDirectories } = await fixture(t);
  await executable(join(applicationDirectories[0], bundledPaths[0]), 0o644);
  const executableDirectory = join(applicationDirectories[0], bundledPaths[1]);
  await mkdir(executableDirectory, { recursive: true });
  await chmod(executableDirectory, 0o755);
  const bundledBinary = await executable(join(applicationDirectories[0], bundledPaths[2]));

  assert.equal(resolveCodexExecutable({
    env: { PATH: "" },
    platform: "darwin",
    applicationDirectories,
  }), bundledBinary);
});

test("non-executable explicit paths and executable directories fail instead of falling back", async (t) => {
  const { directory, applicationDirectories } = await fixture(t);
  const nonExecutable = await executable(join(directory, "configured-file"), 0o644);
  const executableDirectory = join(directory, "configured-directory");
  await mkdir(executableDirectory);
  await chmod(executableDirectory, 0o755);
  await executable(join(applicationDirectories[0], bundledPaths[0]));

  for (const configuredPath of [nonExecutable, executableDirectory]) {
    assert.throws(() => resolveCodexExecutable({
      env: { CODEX_BRIDGE_CODEX_PATH: configuredPath, PATH: "" },
      platform: "darwin",
      applicationDirectories,
    }), /CODEX_BRIDGE_CODEX_PATH/);
  }
});

test("Linux does not discover macOS application bundles", async (t) => {
  const { applicationDirectories } = await fixture(t);
  await executable(join(applicationDirectories[0], bundledPaths[0]));

  assert.throws(() => resolveCodexExecutable({
    env: { PATH: "" },
    platform: "linux",
    applicationDirectories,
  }), (error) => /Codex/.test(error.message) && /CODEX_BRIDGE_CODEX_PATH/.test(error.message));
});

test("missing Codex reports how to configure the executable", async (t) => {
  const { applicationDirectories } = await fixture(t);

  assert.throws(() => resolveCodexExecutable({
    env: { PATH: "" },
    platform: "darwin",
    applicationDirectories,
  }), (error) => /Codex/.test(error.message) && /CODEX_BRIDGE_CODEX_PATH/.test(error.message));
});
