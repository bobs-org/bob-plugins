#!/usr/bin/env node
// Offline schema-writer acceptance for the editable album Schema Card.
// Exercises the real `bob albums update` writer against an isolated
// Git-backed scratch vault: preview/apply/Undo, stale-save refusal,
// source validation and repair, typed semantics, no-op/refusal byte
// stability, double-apply, and post-sync failure with vault-only retry.
// Never launches Obsidian and never opens the live vault.
"use strict";

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const album = require("./obsidian-album-ui-e2e-lib.cjs");

function fail(message) {
  throw new Error(message);
}

function writeNote(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function findWorkspaceManifest() {
  let dir = path.resolve(__dirname, "..");
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, "Cargo.toml");
    try {
      const content = fs.readFileSync(candidate, "utf8");
      if (/name\s*=\s*"bob(-cli|-obsidian)?"/.test(content) || /\[workspace\]/.test(content)) return candidate;
    } catch {
      // Keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findRealBob() {
  const candidates = [];
  if (process.env.BOB_BIN) candidates.push(process.env.BOB_BIN);
  if (process.env.BOB_CLI_BIN) candidates.push(process.env.BOB_CLI_BIN);
  const manifest = findWorkspaceManifest();
  if (manifest) {
    try {
      const meta = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifest], {
        encoding: "utf8",
        timeout: 20_000,
      });
      if (meta.status === 0 && meta.stdout) {
        const parsed = JSON.parse(meta.stdout);
        if (parsed && parsed.target_directory) {
          candidates.push(path.join(parsed.target_directory, "debug", "bob"));
          candidates.push(path.join(parsed.target_directory, "release", "bob"));
        }
      }
    } catch {
      // Fall back to installed bob.
    }
  }
  if (process.env.CARGO_TARGET_DIR) {
    candidates.push(path.join(process.env.CARGO_TARGET_DIR, "debug", "bob"));
  }
  candidates.push(
    path.join(os.homedir(), ".cargo", "bin", "bob"),
    path.join(os.homedir(), ".local", "bin", "bob"),
    "bob",
  );
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (candidate === "bob") {
        const which = spawnSync("which", ["bob"], { encoding: "utf8", timeout: 5_000 });
        if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
        continue;
      }
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  return "";
}

function bobEnv(vaultDir) {
  const env = { ...process.env };
  env.BOB_DIR = vaultDir;
  env.BOB_NOW = "2026-11-12 12:00:00";
  env.BOB_CONFIG_FILE = "/definitely/missing/bob-cli-test-config.yml";
  env.NO_COLOR = "1";
  return env;
}

function runBob(bobBin, vaultDir, args, stdin) {
  return spawnSync(bobBin, args, {
    encoding: "utf8",
    env: bobEnv(vaultDir),
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    input: stdin,
  });
}

function runJson(bobBin, vaultDir, args, stdin) {
  const result = runBob(bobBin, vaultDir, args, stdin);
  let parsed = null;
  try {
    parsed = JSON.parse(String(result.stdout || ""));
  } catch (error) {
    fail(`bob ${args.slice(0, 2).join(" ")} did not emit JSON: status=${result.status} stderr=${String(result.stderr || "").slice(0, 300)}`);
  }
  return { result, parsed };
}

function ensureGitWorktree(vaultDir) {
  if (fs.existsSync(path.join(vaultDir, ".git"))) return;
  const run = (args, cwd) => spawnSync("git", args, { cwd: cwd || vaultDir, encoding: "utf8", timeout: 20_000 });
  const origin = `${vaultDir}.origin.git`;
  if (!fs.existsSync(origin)) {
    spawnSync("git", ["init", "-q", "--bare", origin], { encoding: "utf8", timeout: 20_000 });
    spawnSync("git", ["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/master"], { encoding: "utf8", timeout: 20_000 });
  }
  run(["init", "-q"]);
  run(["symbolic-ref", "HEAD", "refs/heads/master"]);
  run(["config", "user.email", "schema-writer-e2e@example.com"]);
  run(["config", "user.name", "Schema Writer E2E"]);
  run(["remote", "add", "origin", origin]);
  run(["add", "."]);
  run(["commit", "-q", "-m", "schema writer e2e fixture"]);
  run(["push", "-q", "-u", "origin", "master"]);
}

function gitCount(vaultDir) {
  const run = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: vaultDir, encoding: "utf8", timeout: 20_000 });
  return Number(String(run.stdout || "").trim());
}

function gitSubjects(vaultDir, count) {
  const run = spawnSync("git", ["log", `--max-count=${count}`, "--format=%s"], {
    cwd: vaultDir,
    encoding: "utf8",
    timeout: 20_000,
  });
  return String(run.stdout || "").split("\n").filter(Boolean);
}

function hashNotes(vaultDir) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".obsidian" || entry.name === ".git" || entry.name.startsWith(".tmp")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith(".origin.git")) continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out[path.relative(vaultDir, full)] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
      }
    }
  };
  walk(vaultDir);
  return out;
}

function albumFingerprint(bobBin, vaultDir, stem) {
  const { parsed } = runJson(bobBin, vaultDir, ["albums", "list", "-f", "json"]);
  const entry = (parsed.albums || []).find((item) => item && item.stem === stem);
  if (!entry) fail(`report is missing the ${stem} album`);
  return { entry, fingerprint: entry.schema_fingerprint, report: parsed };
}

function check(shaped, label) {
  if (!shaped.ok) fail(`${label}: ${shaped.reason}`);
}

function selfTest() {
  const bobBin = findRealBob();
  if (!bobBin) {
    process.stdout.write("offline schema-writer self-test complete (bob unavailable; skipped real-bob fixture assertions)\n");
    return;
  }

  // Acceptance fixtures: healthy grouped, empty schema, invalid schema,
  // unrelated `record` property, record-note parent entry, typed album.
  const notes = album.writerFixtureNotes();
  for (const name of album.writerRequiredNoteNames()) {
    if (!notes[name] || !String(notes[name]).trim()) fail(`missing writer fixture note ${name}`);
  }
  if (!notes["eat.md"].includes('type: "[[album]]"')) fail("eat must be an album note");
  if (!notes["empty.md"].includes('type: "[[album]]"')) fail("empty must be an album note");
  if (!notes["broken.md"].includes("record: []")) fail("broken must carry the invalid record schema");
  if (!notes["unrelated.md"].includes("record:") || notes["unrelated.md"].includes("[[album]]")) {
    fail("unrelated must carry a stray record property without being an album");
  }
  if (!notes["movies/m-one.md"].includes('parent: "[[movies]]"')) fail("m-one must resolve its record parent to the movies album");
  if (!notes["typed.md"].includes("values: number")) fail("typed must carry a numeric field");

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-schema-writer-e2e-"));
  try {
    const vaultDir = path.join(scratch, "vault");
    fs.mkdirSync(vaultDir, { recursive: true });
    for (const [name, body] of Object.entries(notes)) writeNote(path.join(vaultDir, name), body);
    ensureGitWorktree(vaultDir);

    const synced = runBob(bobBin, vaultDir, ["albums", "sync", "-f", "json"]);
    try {
      const syncReport = JSON.parse(String(synced.stdout || ""));
      if (!syncReport || syncReport.command !== "sync") fail("not a sync report");
    } catch {
      fail(`fixture sync failed: ${String(synced.stderr || "").slice(0, 300)}`);
    }

    // Healthy grouped album, empty schema, invalid schema stay distinct.
    const eat = albumFingerprint(bobBin, vaultDir, "eat");
    if (!eat.fingerprint || !eat.fingerprint.startsWith("sha256:")) fail("eat must report a semantic fingerprint");
    const empty = albumFingerprint(bobBin, vaultDir, "empty");
    const broken = albumFingerprint(bobBin, vaultDir, "broken");
    if (!Array.isArray(broken.entry.issues) || !broken.entry.issues.length) fail("broken must report schema issues");
    const typed = albumFingerprint(bobBin, vaultDir, "typed");
    if (!typed.fingerprint) fail("typed must report a semantic fingerprint");
    const listed = runJson(bobBin, vaultDir, ["albums", "list", "-f", "json"]).parsed;
    if (listed.albums.some((item) => item && item.stem === "unrelated")) {
      fail("the unrelated note must not appear as an album");
    }

    const commitCount = () => gitCount(vaultDir);
    const update = (stem, envelope) =>
      runJson(bobBin, vaultDir, ["albums", "update", stem, "-f", "json", "-i", "-"], JSON.stringify(envelope));
    const preview = (stem, envelope) =>
      runJson(bobBin, vaultDir, ["albums", "update", stem, "-d", "-f", "json", "-i", "-"], JSON.stringify(envelope));

    // Preview a new choice: consequence names the derived value, the dry
    // run writes nothing and makes no commit.
    const beforePreview = hashNotes(vaultDir);
    const commitsBeforePreview = commitCount();
    const dryAdd = preview("eat", {
      schema_version: 1,
      expect: eat.fingerprint,
      ops: [{ op: "choice.add", field: "status", label: "Regular", emoji: "🔁", position: 2 }],
    });
    check(album.assertUpdateShape(dryAdd.parsed, { dryRun: true }), "dry-run shape");
    if (dryAdd.parsed.ok !== true || dryAdd.parsed.changed !== true) fail("dry run must succeed with changes");
    if (!String(dryAdd.parsed.consequence || "").includes("regular")) {
      fail(`consequence must name the derived value: ${dryAdd.parsed.consequence}`);
    }
    if (JSON.stringify(dryAdd.parsed.derived_keys) !== JSON.stringify(["regular"])) {
      fail(`derived keys must be ["regular"]: ${JSON.stringify(dryAdd.parsed.derived_keys)}`);
    }
    const dryOp = (dryAdd.parsed.per_op || [])[0] || {};
    if (!Number.isInteger(dryOp.count)) fail("preview per-op must report complete scan counts");
    if (!Array.isArray(dryAdd.parsed.inverse_ops) || !dryAdd.parsed.inverse_ops.length) {
      fail("preview must return inverse ops for Undo");
    }
    if (dryAdd.parsed.commit !== null && dryAdd.parsed.commit !== undefined) fail("dry run must not commit");
    const afterPreview = hashNotes(vaultDir);
    for (const name of Object.keys(beforePreview)) {
      if (beforePreview[name] !== afterPreview[name]) fail(`preview wrote vault bytes: ${name}`);
    }
    if (commitCount() !== commitsBeforePreview) fail("preview must not change the commit count");

    // Apply once: one scoped commit, rebuilt index, record bytes unchanged.
    const recordBefore = hashNotes(vaultDir);
    const addEnvelope = {
      schema_version: 1,
      expect: eat.fingerprint,
      ops: [{ op: "choice.add", field: "status", label: "Regular", emoji: "🔁", position: 2 }],
    };
    const applied = update("eat", addEnvelope);
    check(album.assertUpdateShape(applied.parsed, { dryRun: false }), "apply shape");
    if (applied.parsed.ok !== true || applied.parsed.changed !== true) fail("apply must succeed with changes");
    if (!applied.parsed.commit || !/^albums: update eat\.md \(.+\)$/.test(applied.parsed.commit.subject || "")) {
      fail(`apply must make one scoped commit: ${JSON.stringify(applied.parsed.commit)}`);
    }
    if (commitCount() !== commitsBeforePreview + 1) fail("one envelope is one commit");
    const afterFp = applied.parsed.after_fingerprint;
    if (!afterFp || afterFp === eat.fingerprint) fail("apply must advance the fingerprint");
    if (JSON.stringify(applied.parsed.inverse_ops) !== JSON.stringify(dryAdd.parsed.inverse_ops)) {
      fail("apply inverse ops must match the preview");
    }
    for (const name of Object.keys(recordBefore)) {
      if (name.startsWith("eat/") && recordBefore[name] !== hashNotes(vaultDir)[name]) {
        fail(`apply changed record bytes: ${name}`);
      }
    }
    const eatAfterApply = fs.readFileSync(path.join(vaultDir, "eat.md"), "utf8");
    check(album.assertHasCallout(eatAfterApply, "records"), "apply rebuilds the index");

    // Double Enter repeats the exact envelope: the second apply is stale
    // and no second mutation is committed.
    const commitsBeforeDouble = commitCount();
    const repeated = update("eat", addEnvelope);
    check(album.assertRefusal(repeated.parsed, "stale_schema"), "double apply");
    if (repeated.result.status !== 2) fail(`stale refusal must exit 2, saw ${repeated.result.status}`);
    if (commitCount() !== commitsBeforeDouble) fail("double apply must not duplicate the mutation");

    // Relabel keeps stored keys: the value survives and record bytes stay put.
    const relabelEnvelope = {
      schema_version: 1,
      expect: afterFp,
      ops: [{ op: "choice.set", field: "status", value: "regular", set: { label: "Reg" } }],
    };
    const relabeled = update("eat", relabelEnvelope);
    if (!relabeledOk(relabeled)) fail("relabel must succeed");
    const relabelYaml = fs.readFileSync(path.join(vaultDir, "eat.md"), "utf8");
    if (!relabelYaml.includes("regular:")) fail("relabel must keep the stored choice key");
    for (const name of Object.keys(recordBefore)) {
      if (name.startsWith("eat/") && recordBefore[name] !== hashNotes(vaultDir)[name]) {
        fail(`relabel changed record bytes: ${name}`);
      }
    }
    const relabelFp = relabeled.parsed.after_fingerprint;

    // Undo previews and commits inverse ops, restoring the fingerprint and
    // preserving linear history.
    const undoPreview = preview("eat", {
      schema_version: 1,
      expect: relabelFp,
      ops: relabeled.parsed.inverse_ops,
    });
    check(album.assertUpdateShape(undoPreview.parsed, { dryRun: true }), "undo preview shape");
    const undone = update("eat", {
      schema_version: 1,
      expect: relabelFp,
      ops: relabeled.parsed.inverse_ops,
    });
    if (undone.parsed.ok !== true) fail("undo apply must succeed");
    if (undone.parsed.after_fingerprint !== afterFp) fail("undo must restore the pre-relabel fingerprint");
    check(album.assertLinearHistory(gitSubjects(vaultDir, 12)), "undo history");
    // Undo the choice.add itself to leave eat exactly as the fixture found it.
    const undoneAdd = update("eat", { schema_version: 1, expect: afterFp, ops: applied.parsed.inverse_ops });
    if (undoneAdd.parsed.ok !== true) fail("undo of the add must succeed");
    if (undoneAdd.parsed.after_fingerprint !== eat.fingerprint) {
      fail("undo of the add must restore the original fingerprint");
    }

    // No-op and refusals leave vault bytes and commit counts unchanged.
    const stableHashes = hashNotes(vaultDir);
    const stableCommits = commitCount();
    const noop = update("eat", { schema_version: 1, expect: eat.fingerprint, ops: [] });
    check(album.assertUpdateShape(noop.parsed, { dryRun: false }), "no-op shape");
    if (noop.parsed.ok !== true || noop.parsed.changed !== false) fail("empty envelope must be a no-op success");
    const likedCount = Object.entries(notes).filter(
      ([name, body]) => name.startsWith("eat/") && /^status: liked$/m.test(String(body)),
    ).length;
    const statusCount = Object.entries(notes).filter(
      ([name, body]) => name.startsWith("eat/") && /^status: /m.test(String(body)),
    ).length;
    const usedChoice = preview("eat", {
      schema_version: 1,
      expect: eat.fingerprint,
      ops: [{ op: "choice.remove", field: "status", value: "liked" }],
    });
    check(album.assertRefusal(usedChoice.parsed, "choice_used"), "used choice removal");
    if (usedChoice.parsed.error.affected !== likedCount) {
      fail(`used removal must report complete counts, saw ${usedChoice.parsed.error.affected}, want ${likedCount}`);
    }
    const usedField = preview("eat", {
      schema_version: 1,
      expect: eat.fingerprint,
      ops: [{ op: "field.remove", field: "status" }],
    });
    check(album.assertRefusal(usedField.parsed, "field_used"), "used field removal");
    if (usedField.parsed.error.affected !== statusCount) {
      fail(`used field removal must report complete counts, saw ${usedField.parsed.error.affected}, want ${statusCount}`);
    }
    if (!/YAML/.test(String(usedField.parsed.error.hint || ""))) fail("used removal must hint the YAML route");
    const stale = update("eat", {
      schema_version: 1,
      expect: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      ops: [{ op: "choice.add", field: "status", label: "Ghost", position: 0 }],
    });
    check(album.assertRefusal(stale.parsed, "stale_schema"), "stale expect");
    if (stale.result.status !== 2) fail("stale refusal must exit 2");
    const stableAfter = hashNotes(vaultDir);
    for (const name of Object.keys(stableHashes)) {
      if (stableHashes[name] !== stableAfter[name]) fail(`refusal path wrote vault bytes: ${name}`);
    }
    if (commitCount() !== stableCommits) fail("no-op/refusal paths must not commit");

    // Typed semantics: 0 distinct from absent, unset removes the key, list
    // and text defaults write distinctly, invalid defaults refuse.
    const typedBefore = typed.fingerprint;
    const typedSet = update("typed", {
      schema_version: 1,
      expect: typedBefore,
      ops: [
        { op: "field.set", field: "count", set: { default: 0 }, unset: ["min"] },
        { op: "field.set", field: "flag", set: { default: "n/a" } },
        { op: "field.set", field: "tags", set: { default: [] } },
      ],
    });
    if (typedSet.parsed.ok !== true) fail(`typed edits must succeed: ${JSON.stringify(typedSet.parsed.error)}`);
    const typedYaml = fs.readFileSync(path.join(vaultDir, "typed.md"), "utf8");
    if (!/default: 0\b/.test(typedYaml)) fail("numeric 0 must write as a number, not absent");
    if (/min:/.test(typedYaml)) fail("unset must remove the min key");
    if (!/default: \[\]/.test(typedYaml)) fail("empty list default must write distinctly");
    const typedFp = typedSet.parsed.after_fingerprint;
    const typedInvalid = update("typed", {
      schema_version: 1,
      expect: typedFp,
      ops: [{ op: "field.set", field: "flag", set: { default: "" } }],
    });
    check(album.assertRefusal(typedInvalid.parsed, "invalid_default"), "invalid default");
    const typedUnset = update("typed", {
      schema_version: 1,
      expect: typedFp,
      ops: [{ op: "field.set", field: "count", unset: ["default"] }],
    });
    if (typedUnset.parsed.ok !== true) fail("default unset must succeed");
    if (/default: 0\b/.test(fs.readFileSync(path.join(vaultDir, "typed.md"), "utf8"))) {
      fail("unset default must remove the key");
    }
    const typedFresh = albumFingerprint(bobBin, vaultDir, "typed");
    if (typedFresh.fingerprint !== typedUnset.parsed.after_fingerprint) {
      fail("typed semantics must survive a fresh report");
    }

    // Post-sync failure keeps the local success; retry is vault-sync only.
    const origin = `${vaultDir}.origin.git`;
    const hookPath = path.join(origin, "hooks", "pre-receive");
    fs.writeFileSync(
      hookPath,
      "#!/bin/sh\nwhile read old new ref; do\n  for c in $(git rev-list \"$old\"..\"$new\" 2>/dev/null); do\n    if git log -1 --format=%s $c | grep -q 'albums: update'; then\n      echo 'pre-receive: simulated post-sync transport failure' >&2\n      exit 1\n    fi\n  done\ndone\nexit 0\n",
      { mode: 0o755 },
    );
    const postSync = update("eat", {
      schema_version: 1,
      expect: eat.fingerprint,
      ops: [{ op: "choice.add", field: "status", label: "PostSync", position: 0 }],
    });
    check(album.assertUpdateShape(postSync.parsed, { dryRun: false }), "post-sync shape");
    if (postSync.parsed.ok !== true || postSync.parsed.changed !== true) fail("post-sync failure must keep local success");
    if (!postSync.parsed.commit) fail("post-sync failure must keep the local commit");
    if (!postSync.parsed.sync || postSync.parsed.sync.post !== "failed") {
      fail(`post-sync must report failed, saw ${JSON.stringify(postSync.parsed.sync)}`);
    }
    if (!/vault-sync/.test((postSync.parsed.warnings || []).join(" "))) {
      fail("post-sync failure must point at vault-sync, not op replay");
    }
    const postSyncCommits = commitCount();
    fs.rmSync(hookPath, { force: true });
    const syncedRetry = runBob(bobBin, vaultDir, ["vault-sync"]);
    if (syncedRetry.status !== 0) fail(`vault-sync retry failed: ${String(syncedRetry.stderr || "").slice(0, 300)}`);
    if (commitCount() !== postSyncCommits) fail("vault-sync retry must create no second schema edit");
    const diverged = spawnSync("git", ["-c", "color.status=false", "status", "-sb"], { cwd: vaultDir, encoding: "utf8", timeout: 20_000 });
    if (/\[/.test(String(diverged.stdout || "").split("\n")[0] || "")) {
      fail(`vault must be in sync after retry: ${String(diverged.stdout || "").slice(0, 120)}`);
    }

    // Source validation: corrupt the schema, confirm the invalid report,
    // repair it, and confirm the valid report returns.
    const eatPath = path.join(vaultDir, "eat.md");
    const eatValid = fs.readFileSync(eatPath, "utf8");
    fs.writeFileSync(eatPath, eatValid.replace("  fields:", "  fields: []\n  orphan: true\n  fields:"));
    const corruptList = runJson(bobBin, vaultDir, ["albums", "list", "-f", "json"]).parsed;
    const corruptEat = (corruptList.albums || []).find((item) => item && item.stem === "eat");
    if (!corruptEat || !Array.isArray(corruptEat.issues) || !corruptEat.issues.length) {
      fail("corrupt source must surface schema issues");
    }
    fs.writeFileSync(eatPath, eatValid);
    const repairedEat = albumFingerprint(bobBin, vaultDir, "eat");
    if (!repairedEat.fingerprint) fail("repaired source must report a valid fingerprint");
    if (Array.isArray(repairedEat.entry.issues) && repairedEat.entry.issues.length) {
      fail("repaired source must report no issues");
    }

    process.stdout.write("offline schema-writer self-test complete\n");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function relabeledOk({ result, parsed }) {
  return result.status === 0 && parsed && parsed.ok === true && parsed.changed === true;
}

function main(argv) {
  const args = album.parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      [
        "Usage: node scripts/obsidian-album-schema-writer-e2e.cjs [OPTIONS]",
        "",
        "Offline schema-writer acceptance against the real bob writer in an",
        "isolated Git-backed scratch vault. Never launches Obsidian.",
        "",
        "Options:",
        "  -h, --help          Print this help and exit",
        "  -s, --self-test     Run offline checks (no Obsidian needed)",
      ].join("\n") + "\n",
    );
    return;
  }
  if (args.selfTest) {
    selfTest();
    return;
  }
  fail("no CDP walkthrough here: real-Obsidian schema-card proof lives in scripts/obsidian-album-ui-e2e.cjs; rerun with -s/--self-test");
}

main(process.argv.slice(2));
