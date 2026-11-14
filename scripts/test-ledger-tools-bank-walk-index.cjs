// Bank-walk index mixin: folder discovery, per-path debounce, delete/rename,
// overlay retention, and overlay-seq snapshot signatures.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const fixtureDir = path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/bank-walk");
function readMonth(name) {
  return fs.readFileSync(path.join(fixtureDir, "bank", name), "utf8");
}

function makeIndex(options = {}) {
  const files = { ...(options.files || {}) };
  const folders = { ...(options.folders || {}) };
  const markdownWalks = { count: 0 };
  const reads = [];
  const pending = [];
  const timers = [];
  const vaultHandlers = {};
  const layout = [];
  const leaves = { current: options.leaves ? options.leaves.slice() : [] };
  const folderApi = options.folderApi !== false;
  const abstractApi = options.abstractApi !== false;
  const vault = {
    cachedRead(file) {
      const filePath = file && typeof file.path === "string" ? file.path : String(file || "");
      reads.push(filePath);
      return new Promise((resolve, reject) => {
        pending.push({ path: filePath, resolve, reject });
      });
    },
    on(event, handler) {
      vaultHandlers[event] = handler;
      return {};
    },
    getMarkdownFiles() {
      markdownWalks.count += 1;
      return Object.keys(files).map((filePath) => ({ path: filePath }));
    },
  };
  if (folderApi) {
    vault.getFolderByPath = (folderPath) => folders[folderPath] || null;
  }
  if (abstractApi) {
    vault.getAbstractFileByPath = (filePath) => {
      if (folders[filePath]) return folders[filePath];
      if (Object.prototype.hasOwnProperty.call(files, filePath)) return { path: filePath };
      return null;
    };
  }
  const plugin = new LedgerToolsPlugin({
    vault,
    workspace: {
      onLayoutReady: (callback) => layout.push(callback),
      getLeavesOfType: (type) => (type === "markdown" ? leaves.current : []),
    },
  }, {});
  plugin.bankTimerApi = () => ({
    setTimeout(fn, ms) {
      const handle = { fn, ms };
      timers.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      const index = timers.indexOf(handle);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  plugin.setupBankWalk();
  return {
    plugin,
    files,
    folders,
    markdownWalks,
    reads,
    pending,
    timers,
    vaultHandlers,
    layout,
    leaves,
    async flush(filePath, content) {
      const left = pending.filter((item) => item.path === filePath);
      assert.ok(left.length, `missing read for ${filePath}`);
      for (const item of left) item.resolve(content);
      pending.splice(0, pending.length, ...pending.filter((item) => item.path !== filePath));
      await Promise.resolve();
      await Promise.resolve();
    },
    fireTimers() {
      const due = timers.splice(0, timers.length);
      for (const handle of due) handle.fn();
    },
  };
}

test("initial scan uses the bank folder and never walks every Markdown file", async () => {
  const oct = readMonth("2026-10.md");
  const nov = readMonth("2026-11.md");
  const state = makeIndex({
    files: { "bank/2026-10.md": oct, "bank/2026-11.md": nov, "note.md": "# other" },
    folders: {
      bank: {
        path: "bank",
        children: [{ path: "bank/2026-10.md" }, { path: "bank/2026-11.md" }],
      },
    },
  });
  assert.equal(state.layout.length, 1);
  state.layout[0]();
  assert.equal(state.markdownWalks.count, 0);
  await state.flush("bank/2026-10.md", oct);
  await state.flush("bank/2026-11.md", nov);
  assert.equal(state.plugin.bankWalkReady, true);
  assert.equal(state.markdownWalks.count, 0);
  const snap = state.plugin.bankWalkSnapshot();
  assert.equal(snap.available, true);
  assert.ok(snap.counts.rows > 0);
});

test("a missing bank folder becomes ready with no months and still skips the Markdown walk", () => {
  const state = makeIndex({
    files: { "note.md": "# other" },
    folders: {},
  });
  state.layout[0]();
  assert.equal(state.markdownWalks.count, 0);
  assert.equal(state.plugin.bankWalkReady, true);
  const snap = state.plugin.bankWalkSnapshot();
  assert.equal(snap.available, true);
  assert.equal(snap.counts.rows, 0);
});

test("Markdown walk is the fallback only when the vault has no folder API", () => {
  const nov = readMonth("2026-11.md");
  const state = makeIndex({
    folderApi: false,
    abstractApi: false,
    files: { "bank/2026-11.md": nov },
  });
  state.layout[0]();
  assert.equal(state.markdownWalks.count, 1);
});

test("a two-month edit burst re-reads both months after one debounce", async () => {
  const oct = readMonth("2026-10.md");
  const nov = readMonth("2026-11.md");
  const state = makeIndex({
    files: { "bank/2026-10.md": oct, "bank/2026-11.md": nov },
    folders: {
      bank: { path: "bank", children: [{ path: "bank/2026-10.md" }, { path: "bank/2026-11.md" }] },
    },
  });
  state.plugin.bankWalkReady = true;
  state.plugin.bankWalkDisk.set("bank/2026-10.md", oct);
  state.plugin.bankWalkDisk.set("bank/2026-11.md", nov);
  state.reads.length = 0;
  state.vaultHandlers.modify({ path: "bank/2026-10.md" });
  state.vaultHandlers.modify({ path: "bank/2026-11.md" });
  assert.equal(state.reads.length, 0);
  assert.equal(state.timers.length, 1);
  state.fireTimers();
  assert.deepEqual([...state.reads].sort(), ["bank/2026-10.md", "bank/2026-11.md"]);
  await state.flush("bank/2026-10.md", oct);
  await state.flush("bank/2026-11.md", nov);
});

test("delete and rename-away drop the month; rename onto a month reads it", async () => {
  const oct = readMonth("2026-10.md");
  const nov = readMonth("2026-11.md");
  const state = makeIndex({
    files: { "bank/2026-10.md": oct, "bank/2026-11.md": nov },
    folders: {
      bank: { path: "bank", children: [{ path: "bank/2026-10.md" }, { path: "bank/2026-11.md" }] },
    },
  });
  state.plugin.bankWalkReady = true;
  state.plugin.bankWalkDisk.set("bank/2026-10.md", oct);
  state.plugin.bankWalkDisk.set("bank/2026-11.md", nov);
  state.plugin.bankWalkRememberOverlay("bank/2026-10.md", oct);
  let fired = 0;
  state.plugin.onBankWalkChange(() => { fired += 1; });
  state.vaultHandlers.delete({ path: "bank/2026-10.md" });
  assert.equal(state.plugin.bankWalkDisk.has("bank/2026-10.md"), false);
  assert.equal(state.plugin.bankWalkOverlays.has("bank/2026-10.md"), false);
  assert.equal(fired, 1);
  state.reads.length = 0;
  state.vaultHandlers.rename({ path: "notes/moved.md" }, "bank/2026-11.md");
  assert.equal(state.plugin.bankWalkDisk.has("bank/2026-11.md"), false);
  assert.equal(state.reads.length, 0);
  state.files["bank/2026-12.md"] = nov;
  state.vaultHandlers.rename({ path: "bank/2026-12.md" }, "notes/inbox.md");
  assert.equal(state.timers.length, 1);
  state.fireTimers();
  assert.deepEqual(state.reads, ["bank/2026-12.md"]);
  await state.flush("bank/2026-12.md", nov);
});

test("a closed-editor tick stays out of WAITING until a later disk read", async () => {
  const oct = readMonth("2026-10.md");
  const ticked = oct.replace("- [ ] $4.25 Halloween candy", "- [x] $4.25 Halloween candy");
  const state = makeIndex({
    files: { "bank/2026-10.md": oct },
    folders: { bank: { path: "bank", children: [{ path: "bank/2026-10.md" }] } },
  });
  state.plugin.bankWalkReady = true;
  state.plugin.bankWalkDisk.set("bank/2026-10.md", oct);
  state.leaves.current = [{
    view: {
      file: { path: "bank/2026-10.md" },
      editor: { getValue: () => ticked },
    },
  }];
  const open = state.plugin.bankWalkSnapshot();
  assert.equal(open.entries.some((entry) => entry.payee === "Halloween candy"), false);
  state.leaves.current = [];
  const closed = state.plugin.bankWalkSnapshot();
  assert.equal(closed.entries.some((entry) => entry.payee === "Halloween candy"), false);
  state.vaultHandlers.modify({ path: "bank/2026-10.md" });
  state.fireTimers();
  await state.flush("bank/2026-10.md", oct);
  const after = state.plugin.bankWalkSnapshot();
  assert.equal(after.entries.some((entry) => entry.payee === "Halloween candy"), true);
});

test("an older disk read never beats a newer overlay", async () => {
  const oct = readMonth("2026-10.md");
  const ticked = oct.replace("- [ ] $4.25 Halloween candy", "- [x] $4.25 Halloween candy");
  const later = ticked.replace("Halloween candy", "Halloween candy.");
  const state = makeIndex({
    files: { "bank/2026-10.md": oct },
    folders: { bank: { path: "bank", children: [{ path: "bank/2026-10.md" }] } },
  });
  state.plugin.bankWalkReady = true;
  state.plugin.bankWalkDisk.set("bank/2026-10.md", oct);
  state.plugin.bankWalkRememberOverlay("bank/2026-10.md", ticked);
  state.vaultHandlers.modify({ path: "bank/2026-10.md" });
  state.plugin.bankWalkRememberOverlay("bank/2026-10.md", later);
  state.fireTimers();
  await state.flush("bank/2026-10.md", oct);
  assert.equal(state.plugin.bankWalkOverlays.get("bank/2026-10.md").content, later);
  const snap = state.plugin.bankWalkSnapshot();
  assert.equal(snap.entries.some((entry) => entry.payee === "Halloween candy"), false);
  assert.equal(snap.entries.some((entry) => /Halloween candy\./.test(entry.text)), false);
});

test("overlay snapshot signature uses per-path seq, not full overlay text", () => {
  const oct = readMonth("2026-10.md");
  const state = makeIndex({
    files: { "bank/2026-10.md": oct },
    folders: { bank: { path: "bank", children: [{ path: "bank/2026-10.md" }] } },
  });
  state.plugin.bankWalkReady = true;
  state.plugin.bankWalkDisk.set("bank/2026-10.md", oct);
  state.plugin.bankWalkRememberOverlay("bank/2026-10.md", oct);
  state.plugin.bankWalkSnapshot();
  const first = state.plugin.bankWalkOverlaySignature;
  assert.ok(first.includes("bank/2026-10.md"));
  assert.equal(first.includes(oct), false);
  state.plugin.bankWalkRememberOverlay("bank/2026-10.md", oct);
  state.plugin.bankWalkMemoKey = null;
  state.plugin.bankWalkSnapshot();
  assert.equal(state.plugin.bankWalkOverlaySignature, first);
  state.plugin.bankWalkRememberOverlay("bank/2026-10.md", `${oct}\n`);
  state.plugin.bankWalkMemoKey = null;
  state.plugin.bankWalkSnapshot();
  assert.notEqual(state.plugin.bankWalkOverlaySignature, first);
  assert.equal(state.plugin.bankWalkOverlaySignature.includes(`${oct}\n`), false);
});
