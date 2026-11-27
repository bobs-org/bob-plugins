"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_RETAINED_FAILURES = 1;
const OWNER_FILE = ".e2e-scratch-owner.json";
const KEEP_ENV = "BOB_E2E_KEEP_SCRATCH";

function keepEverythingFromEnv(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env[KEEP_ENV] || ""));
}

function createScratch({ root = os.tmpdir(), prefix } = {}) {
  if (typeof prefix !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prefix)) {
    throw new TypeError("e2e scratch prefix must be a simple nonempty directory prefix");
  }
  const resolvedRoot = path.resolve(root);
  fs.mkdirSync(resolvedRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(resolvedRoot, prefix));
  fs.writeFileSync(path.join(dir, OWNER_FILE), JSON.stringify({ pid: process.pid, prefix, state: "active" }) + "\n", { mode: 0o600, flag: "wx" });
  return Object.freeze({ dir, root: resolvedRoot, prefix });
}

function finishScratch(run, { success, keep = keepEverythingFromEnv(), log = (line) => process.stdout.write(line) } = {}) {
  if (!run || typeof run.dir !== "string" || typeof run.root !== "string" || typeof run.prefix !== "string") {
    throw new TypeError("finishScratch requires the run returned by createScratch");
  }
  const dir = path.resolve(run.dir);
  const root = path.resolve(run.root);
  if (path.dirname(dir) !== root || !path.basename(dir).startsWith(run.prefix)) {
    throw new Error("refusing to finish scratch outside its runner-owned root");
  }
  const current = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!current || !current.isDirectory()) return null;
  if (success && !keep) {
    fs.rmSync(dir, { recursive: true, force: true });
    pruneFailures(run);
    return null;
  }

  const state = keep ? "kept" : "retained";
  fs.writeFileSync(path.join(dir, OWNER_FILE), JSON.stringify({ pid: process.pid, prefix: run.prefix, state }) + "\n", { mode: 0o600 });
  if (!keep) pruneFailures(run);
  log(`Retained e2e scratch: ${dir}\n`);
  return dir;
}

function pruneFailures(run) {
  if (typeof process.getuid !== "function") return;
  const uid = process.getuid();
  const dirs = [];
  for (const entry of fs.readdirSync(run.root, { withFileTypes: true })) {
    if (!entry.name.startsWith(run.prefix)) continue;
    const dir = path.join(run.root, entry.name);
    let stat;
    try { stat = fs.lstatSync(dir); } catch (_) { continue; }
    if (!stat.isDirectory() || stat.uid !== uid) continue;
    const owner = readOwner(dir);
    if (!owner || owner.prefix !== run.prefix) continue;
    if (owner.state === "kept") continue;
    const active = owner.state === "active" && isProcessAlive(owner.pid);
    if (owner.state !== "retained" && !(owner.state === "active" && !active)) continue;
    dirs.push({ dir, mtimeMs: stat.mtimeMs, active });
  }

  const currentDir = path.resolve(run.dir);
  const protectedDirs = dirs.filter((entry) => entry.dir === currentDir || entry.active);
  const retained = new Set(protectedDirs.map((entry) => entry.dir));
  const inactive = dirs.filter((entry) => !retained.has(entry.dir))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const remainingSlots = Math.max(0, MAX_RETAINED_FAILURES - retained.size);
  for (const entry of inactive.slice(0, remainingSlots)) retained.add(entry.dir);
  for (const entry of dirs) {
    if (!retained.has(entry.dir)) fs.rmSync(entry.dir, { recursive: true, force: true });
  }
}

function readOwner(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, OWNER_FILE), "utf8"));
  } catch (_) {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

module.exports = { MAX_RETAINED_FAILURES, KEEP_ENV, createScratch, finishScratch, keepEverythingFromEnv };
