import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "docs-check.sh");

function makeDir(root, ...parts) {
  const directory = path.join(root, ...parts);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function writeExecutable(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

function writeJustfile(root) {
  fs.writeFileSync(path.join(root, "justfile"), "docs-check:\n  echo ok\n");
}

function fixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bob-plugins-docs-check-"));
}

function installPlugin(root) {
  const pluginRoot = makeDir(root, "bob-plugins");
  fs.copyFileSync(SCRIPT, path.join(makeDir(pluginRoot, "scripts"), "docs-check.sh"));
  fs.chmodSync(path.join(pluginRoot, "scripts", "docs-check.sh"), 0o755);
  return pluginRoot;
}

function stubJust(bin, logDir, { exitCode = 0 } = {}) {
  writeExecutable(
    path.join(bin, "just"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf '%s\\n' "$PWD" > ${JSON.stringify(path.join(logDir, "cwd"))}`,
      `printf '%s\\n' "\${BOB_DOCS_BOB_PLUGINS_DIR-}" > ${JSON.stringify(path.join(logDir, "plugins_dir"))}`,
      `printf '%s\\n' "$*" > ${JSON.stringify(path.join(logDir, "args"))}`,
      `exit ${exitCode}`,
      "",
    ].join("\n"),
  );
}

function stubGit(bin, logDir) {
  writeExecutable(
    path.join(bin, "git"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf '%s\\n' "$@" >> ${JSON.stringify(path.join(logDir, "git_args"))}`,
      'if [[ "$1" == "clone" ]]; then',
      '  dest="${@: -1}"',
      '  mkdir -p "$dest"',
      '  printf "docs-check:\\n  echo cached\\n" > "$dest/justfile"',
      "  exit 0",
      "fi",
      'if [[ "$1" == "-C" && "$3" == "fetch" ]]; then',
      `  printf '%s\\n' "$2" > ${JSON.stringify(path.join(logDir, "fetch_dir"))}`,
      "  exit 0",
      "fi",
      'if [[ "$1" == "-C" && "$3" == "rev-parse" ]]; then',
      "  printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n'",
      "  exit 0",
      "fi",
      'if [[ "$1" == "-C" && "$3" == "reset" ]]; then',
      `  printf '%s\\n' "$2" > ${JSON.stringify(path.join(logDir, "reset_dir"))}`,
      "  exit 0",
      "fi",
      'echo "unexpected git $*" >&2',
      "exit 1",
      "",
    ].join("\n"),
  );
}

function runScript(pluginRoot, { env = {}, bin }) {
  const merged = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  delete merged.BOB_CLI_DIR;
  delete merged.BOB_DOCS_BOB_PLUGINS_DIR;
  Object.assign(merged, env);
  return spawnSync("bash", [path.join(pluginRoot, "scripts", "docs-check.sh")], {
    cwd: pluginRoot,
    encoding: "utf8",
    env: merged,
  });
}

test("BOB_CLI_DIR wins over a sibling checkout and a cache", () => {
  const root = fixtureRoot();
  const pluginRoot = installPlugin(path.join(root, "workspace with spaces"));
  const sibling = makeDir(path.dirname(pluginRoot), "bob-cli");
  writeJustfile(sibling);
  const override = makeDir(root, "explicit cli");
  writeJustfile(override);
  const cache = makeDir(root, "cache", "bob-plugins-docs", "bob-cli");
  writeJustfile(cache);
  const logDir = makeDir(root, "log");
  const bin = makeDir(root, "bin");
  stubJust(bin, logDir);
  stubGit(bin, logDir);

  const result = runScript(pluginRoot, {
    bin,
    env: {
      BOB_CLI_DIR: override,
      XDG_CACHE_HOME: path.join(root, "cache"),
      HOME: root,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(logDir, "cwd"), "utf8").trim(), override);
  assert.equal(fs.readFileSync(path.join(logDir, "plugins_dir"), "utf8").trim(), pluginRoot);
  assert.equal(fs.readFileSync(path.join(logDir, "args"), "utf8").trim(), "docs-check");
  assert.equal(fs.existsSync(path.join(logDir, "git_args")), false);
});

test("sibling bob-cli is used when BOB_CLI_DIR is unset", () => {
  const root = fixtureRoot();
  const pluginRoot = installPlugin(path.join(root, "workspace"));
  const sibling = makeDir(path.dirname(pluginRoot), "bob-cli");
  writeJustfile(sibling);
  const logDir = makeDir(root, "log");
  const bin = makeDir(root, "bin");
  stubJust(bin, logDir);

  const result = runScript(pluginRoot, {
    bin,
    env: {
      HOME: root,
      XDG_CACHE_HOME: path.join(root, "unused-cache"),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(logDir, "cwd"), "utf8").trim(), sibling);
  assert.equal(fs.readFileSync(path.join(logDir, "plugins_dir"), "utf8").trim(), pluginRoot);
});

test("an invalid BOB_CLI_DIR does not fall through", () => {
  const root = fixtureRoot();
  const pluginRoot = installPlugin(path.join(root, "workspace"));
  const sibling = makeDir(path.dirname(pluginRoot), "bob-cli");
  writeJustfile(sibling);
  const logDir = makeDir(root, "log");
  const bin = makeDir(root, "bin");
  stubJust(bin, logDir);

  const result = runScript(pluginRoot, {
    bin,
    env: {
      BOB_CLI_DIR: path.join(root, "missing cli"),
      HOME: root,
    },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /BOB_CLI_DIR/);
  assert.match(result.stderr, /never falls through/);
  assert.equal(fs.existsSync(path.join(logDir, "args")), false);
});

test("cache clone is used when no user-owned checkout exists", () => {
  const root = fixtureRoot();
  const pluginRoot = installPlugin(path.join(root, "workspace"));
  const logDir = makeDir(root, "log");
  const bin = makeDir(root, "bin");
  stubJust(bin, logDir);
  stubGit(bin, logDir);

  const result = runScript(pluginRoot, {
    bin,
    env: {
      HOME: root,
      XDG_CACHE_HOME: path.join(root, "cache home"),
    },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const cloned = path.join(root, "cache home", "bob-plugins-docs", "bob-cli");
  assert.equal(fs.readFileSync(path.join(logDir, "cwd"), "utf8").trim(), cloned);
  const gitArgs = fs.readFileSync(path.join(logDir, "git_args"), "utf8");
  assert.match(gitArgs, /^clone$/m);
  assert.match(gitArgs, /https:\/\/github.com\/bobs-org\/bob-cli/);
  assert.match(gitArgs, /^--branch$/m);
  assert.match(gitArgs, /^master$/m);
});

test("just failures propagate", () => {
  const root = fixtureRoot();
  const pluginRoot = installPlugin(path.join(root, "workspace"));
  const override = makeDir(root, "cli");
  writeJustfile(override);
  const logDir = makeDir(root, "log");
  const bin = makeDir(root, "bin");
  stubJust(bin, logDir, { exitCode: 7 });

  const result = runScript(pluginRoot, {
    bin,
    env: { BOB_CLI_DIR: override, HOME: root },
  });
  assert.equal(result.status, 7);
});
