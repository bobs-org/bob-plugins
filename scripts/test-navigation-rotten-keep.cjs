const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const harness = require("./modal-harness.cjs");
const { ModalStub, defer, pressKey } = harness;
global.window = { setTimeout: defer };
const notices = [], modals = [];
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Plugin: class {}, parseYaml: () => ({}),
    Modal: class extends ModalStub { constructor(app) { super(app); modals.push(this); } },
    Notice: class { constructor(message) { notices.push(String(message)); } },
  };
  if (request === "@codemirror/state") return { Prec: { highest: (v) => v } };
  if (request === "@codemirror/view") return { EditorView: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require("../plugins/bob-navigation-hotkeys/main.js");
const h = Plugin.helpers;
const ledger = require("../plugins/bob-ledger-tools/main.js").helpers;
Module._load = originalLoad;
const DATE = "2026-10-23";
const RAW = "- [ ] #task Read primer #ref [fresh:: 2026-10-14] [keeps:: 2] ^primer";
const keep = (raw, date, options) => ledger.freshnessKeepLine(raw, date, options).line;
const stamp = (raw, date) => ledger.freshnessStampLine(raw, date).line;
function row(raw = RAW, overrides = {}) {
  return { path: "a.md", line: 1, key: "a.md:1", originalMarkdown: raw,
    text: "Read primer", fresh: "2026-10-14", tier: "rotten", tierLabel: "ROTTEN",
    lane: "ready", state: "rotten", rank: 1, keeps: 2, ...overrides };
}
function text(el) { return [el.textContent, ...el.children.map(text)].join(" "); }
function fixture({ content = RAW, entry = row(), version = 6, keepLine = keep } = {}) {
  notices.length = 0; modals.length = 0;
  const editor = {
    content, cursor: { line: 0, ch: 0 }, transactions: [], undoStack: [],
    getValue() { return this.content; }, getLine(line) { return this.content.split(/\r?\n/)[line]; },
    getCursor() { return this.cursor; }, getScrollInfo() { return null; },
    transaction(tx) {
      this.undoStack.push(this.content); this.transactions.push(tx);
      const ending = this.content.includes("\r\n") ? "\r\n" : "\n";
      const offset = (p) => this.content.split(/\r?\n/).slice(0, p.line).reduce((n, line) => n + line.length + ending.length, 0) + p.ch;
      for (const c of [...tx.changes].sort((a,b) => offset(b.from) - offset(a.from))) {
        this.content = this.content.slice(0, offset(c.from)) + c.text + this.content.slice(offset(c.to || c.from));
      }
    },
    undo() { this.content = this.undoStack.pop(); },
  };
  const plugin = Object.create(Plugin.prototype);
  const freshness = { version, keepLine, stampLine: stamp, queue: () => entry ? [entry] : [], counts: () => ({ due: 1 }) };
  plugin.app = { plugins: { plugins: { "bob-ledger-tools": { api: { version: 3, freshness } } } },
    workspace: { getActiveViewOfType: () => ({ file: { path: "a.md", extension: "md" }, editor }) },
    vault: { getAbstractFileByPath: () => null } };
  plugin.laneReleaseDateText = (options = {}) => options.dateText || DATE;
  plugin.reviewAnchor = { before: true };
  const run = (options = {}) => plugin.refreshTaskFreshness(editor, { dateText: DATE, ...options });
  return { plugin, editor, run, freshness };
}

for (const reason of ["still the primer", ""]) {
  test(`single keep logs ${reason || "blank"} with stamp in one undo`, async () => {
    const { editor, run } = fixture();
    const pending = run();
    const modal = modals.at(-1);
    assert.equal(editor.content, RAW);
    assert.equal(harness.activeElement, modal.inputEl);
    modal.inputEl.value = reason;
    modal.inputEl.listeners.input();
    assert.match(text(modal.previewEl), reason ? /still the primer · kept 3×/ : /🤷 no reason given · kept 3×/);
    pressKey(modal, "Enter"); modal.submit();
    assert.equal(await pending, true);
    assert.equal(editor.transactions.length, 1);
    assert.match(editor.content, /fresh:: 2026-10-23/);
    assert.match(editor.content, /keeps:: 3/);
    assert.equal(h.readRottenLog(editor.content, 0).entries.length, 1);
    assert.match(notices.at(-1), /Rotten Log updated/);
    editor.undo(); assert.equal(editor.content, RAW);
  });
}

test("Esc retains the document and walk anchor; repeat command cannot open another prompt", async () => {
  const { plugin, editor, run } = fixture();
  const anchor = plugin.reviewAnchor;
  let advances = 0; plugin.jumpToDueTask = async () => { advances++; };
  const pending = run({ advance: true });
  assert.equal(await run({ advance: true }), false);
  assert.equal(modals.length, 1);
  pressKey(modals[0], "Escape");
  assert.equal(await pending, false);
  assert.equal(editor.content, RAW); assert.equal(editor.transactions.length, 0);
  assert.equal(plugin.reviewAnchor, anchor); assert.equal(advances, 0);
});

test("same-day repeat never prompts or appends, including saturated 999", async () => {
  for (const count of [2, 999]) {
    const raw = RAW.replace("keeps:: 2", `keeps:: ${count}`);
    const f = fixture({ content: raw, entry: row(raw) });
    assert.equal(await f.run({ keepReason: "still needed" }), true);
    const written = f.editor.content;
    assert.match(written, new RegExp(`kept ${Math.min(count + 1, 999)}×`));
    f.freshness.queue = () => [row(f.editor.getLine(0))];
    assert.equal(await f.run(), true);
    assert.equal(modals.length, 0); assert.equal(f.editor.content, written);
    assert.equal(f.editor.transactions.length, 1);
  }
});

for (const [label, overrides, raw, expected] of [
  ["scheduled tickler", { tier: "tickler", returnedBy: "scheduled" }, RAW, true],
  ["unblock tickler", { tier: "tickler", returnedBy: "unblocked" }, RAW, false],
  ["new", { tier: "new" }, RAW.replace(/ \[fresh:: [^\]]+\]/, ""), false],
  ["Pending", { tier: "pending", lane: "pending" }, RAW.replace("[ ]", "[/]"), false],
  ["Next", { tier: "next", lane: "next" }, RAW.replace("[ ]", "[*]"), false],
  ["PROJECTS", { tier: "projects" }, RAW, false],
  ["recurring", {}, RAW + " 🔁 every day", false],
  ["checklist", { tier: "pre" }, RAW.replace("#task", "#gtd #pre"), false],
  ["closed", {}, RAW.replace("[ ]", "[x]"), false],
  ["early", { tier: null, state: "fresh" }, RAW, false],
]) {
  test(`counted predicate: ${label}`, () => {
    const match = h.matchFreshStampExactEntry([row(raw, overrides)], { path: "a.md", line: 0, raw });
    assert.equal(h.classifyRottenKeepTarget({ match, raw, stamper: keep, dateText: DATE }).counted, expected);
  });
}

test("scheduled tickler logs; unblocked and legacy keeps never prompt", async () => {
  const scheduled = fixture({ entry: row(RAW, { tier: "tickler", returnedBy: "scheduled" }) });
  assert.equal(await scheduled.run({ keepReason: "next weekend" }), true);
  assert.match(scheduled.editor.content, /next weekend · kept 3×/);
  for (const options of [{ entry: row(RAW, { tier: "tickler", returnedBy: "unblocked" }) }, { version: 4 }]) {
    const f = fixture(options);
    assert.equal(await f.run(), true); assert.equal(modals.length, 0);
    assert.doesNotMatch(f.editor.content, /ROTTEN LOG/);
  }
});

test("Pending retains its Work summary prompt", async () => {
  const raw = RAW.replace("[ ]", "[/]");
  const f = fixture({ content: raw, entry: row(raw, { tier: "pending", lane: "pending" }) });
  const pending = f.run(); const modal = modals.at(-1);
  assert.equal(modal.inputEl.getAttribute("aria-label"), "Work summary");
  modal.inputEl.value = "Read intro"; pressKey(modal, "Enter");
  assert.equal(await pending, true); assert.match(f.editor.content, /WORK LOG/);
  assert.doesNotMatch(f.editor.content, /ROTTEN LOG/);
});

test("unavailable decay card falls through the reason planner", async () => {
  const f = fixture({ entry: row(RAW, { decide: true }) });
  let opened = 0; f.plugin.maybeOpenFreshnessDecayCard = async () => { opened++; return false; };
  const pending = f.run();
  assert.equal(f.editor.content, RAW);
  await Promise.resolve();
  const modal = modals.at(-1); assert.ok(modal);
  pressKey(modal, "Enter");
  assert.equal(await pending, true); assert.equal(opened, 1);
  assert.equal(f.editor.transactions.length, 1); assert.match(f.editor.content, /🤷 no reason given · kept 3×/);
});

for (const change of ["document", "day", "prediction", "guard"]) {
  test(`${change} changes while prompt is open refuse the entire keep`, async () => {
    let altered = false;
    const f = fixture({ keepLine: (raw, date, options) => altered ? stamp(raw, date) : keep(raw, date, options) });
    const pending = f.run();
    if (change === "document") f.editor.content += "\nexternal edit";
    if (change === "day") f.plugin.laneReleaseDateText = () => "2026-10-24";
    if (change === "prediction") altered = true;
    if (change === "guard") f.plugin.getCountedTaskWriteContext = () => ({ valid: false, error: "Active note changed" });
    pressKey(modals.at(-1), "Enter");
    assert.equal(await pending, false); assert.equal(f.editor.transactions.length, 0);
    assert.doesNotMatch(f.editor.content, /ROTTEN LOG/);
    assert.match(notices.at(-1), change === "day" ? /Day changed/ : change === "prediction" ? /changed/ : /note changed/);
  });
}

test("ambiguous Rotten markers disable the prompt and refuse even a bypass", async () => {
  const content = RAW + "\n  - 🥀 **ROTTEN LOG**\n  - **ROTTEN LOG**";
  const f = fixture({ content }); const pending = f.run();
  const modal = modals.at(-1); assert.equal(modal.refreshButton.disabled, true);
  assert.match(text(modal.contentEl), /log unreadable/);
  modal.submit(); assert.equal(f.editor.content, content);
  pressKey(modal, "Escape"); assert.equal(await pending, false);
  assert.equal(await f.run({ keepReason: "bypass" }), false);
  assert.equal(f.editor.content, content); assert.match(notices.at(-1), /Multiple Rotten Logs/);
});

test("combined planner inserts nested targets bottom-up and preserves CRLF", () => {
  const child = "  " + RAW.replace("primer", "child");
  const content = [RAW, child, "    - existing child", "- [/] #task Pending", ""].join("\r\n");
  const plan = h.planFreshStampBatchWithLogs(content, [0, 1, 3].map((line) => ({ line, counted: line !== 3 })), keep, DATE,
    { rottenLines: [0, 1], keepReason: "still useful", workSummary: "made progress" });
  assert.equal(plan.ok, true); assert.equal(plan.rottenLogWrittenCount, 2); assert.equal(plan.workLogWrittenCount, 1);
  assert.equal(h.readRottenLog(plan.content, 0).entries.length, 1);
  assert.equal(h.readRottenLog(plan.content, 1).entries.length, 1);
  assert.match(plan.content, /WORK LOG/); assert.doesNotMatch(plan.content, /(?<!\r)\n/);
  assert.match(plan.content, /existing child/);
});

test("prompt copy separates streak from history and previews exact formatter output", () => {
  const base = { raw: RAW, entry: row(), dateText: DATE, keepsBefore: 2, keepsAfter: 3 };
  const empty = h.buildRottenKeepPromptModel(base);
  assert.match(empty.subtitleLines[0], /ROTTEN · 9d/);
  assert.equal(empty.subtitleLines[1], "kept 2 in a row · none logged yet");
  assert.match(empty.destinationText, /last child/);
  assert.equal(empty.previewEntryText, h.formatRottenLogEntryText({ date: DATE, reason: "", keeps: 3 }));
  const entry = { date: "2026-10-16", reason: "🤷 no reason given", keeps: 2 };
  const one = h.buildRottenKeepPromptModel({ ...base, keepsBefore: 0, history: { status: "ok", entries: [entry] } });
  assert.equal(one.subtitleLines[1], "1 keep logged"); assert.equal(one.historyRows[0].date, "Oct 16");
  const many = h.buildRottenKeepPromptModel({ ...base, history: { status: "ok", entries: Array(5).fill(entry) }, advance: true });
  assert.equal(many.historyRows.length, 3); assert.equal(many.olderCount, 2);
  assert.match(many.subtitleLines[1], /5 keeps logged/); assert.equal(many.enterHint, "Keep, log & next");
});

test("keep stage warns for inline fields, ignores IME Enter, and swallows both keep chords", async () => {
  const f = fixture(); const pending = f.run(); const modal = modals.at(-1);
  modal.inputEl.value = "context:: still needed"; modal.inputEl.listeners.input();
  assert.match(text(modal.previewEl), /Dataview inline field/);
  assert.equal(modal.previewEl.getAttribute("aria-live"), "polite");
  pressKey(modal, "Enter", { isComposing: true });
  for (const ctrlKey of [false, true]) {
    assert.equal(pressKey(modal, "ƒ", { code: "KeyF", altKey: true, ctrlKey }).defaultPrevented, true);
  }
  assert.equal(f.editor.transactions.length, 0);
  pressKey(modal, "Enter"); assert.equal(await pending, true);
  assert.equal(f.editor.transactions.length, 1);
});
