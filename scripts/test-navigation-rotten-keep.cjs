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
  const run = (options = {}) => plugin.refreshTaskFreshness(editor, { dateText: DATE, now: new Date(2026, 9, 23, 14, 32), workLogStampText: "2026-10-23 14:32", ...options });
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
  ["Pending", { tier: "pending", lane: "pending" }, RAW.replace("[ ]", "[/]"), true],
  ["Next", { tier: "next", lane: "next" }, RAW.replace("[ ]", "[*]"), true],
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

test("due WIP keep asks why and logs a WIP entry with the stamp in one undo", async () => {
  const raw = RAW.replace("[ ]", "[/]");
  const f = fixture({ content: raw, entry: row(raw, { tier: "pending", tierLabel: "PENDING", lane: "pending", state: "pending" }) });
  const pending = f.run(); const modal = modals.at(-1);
  assert.match(text(modal.contentEl), /Why keep it in WIP\?/);
  assert.equal(modal.inputEl.getAttribute("aria-label"), "Keep reason");
  modal.inputEl.value = "still in progress"; modal.inputEl.listeners.input();
  assert.match(text(modal.previewEl), /still in progress · kept 3× in WIP/);
  pressKey(modal, "Enter"); modal.submit();
  assert.equal(await pending, true);
  assert.equal(f.editor.transactions.length, 1);
  assert.match(f.editor.content, /\[fresh:: 2026-10-23\]/);
  assert.match(f.editor.content, /\[keeps:: 3\]/);
  assert.match(f.editor.content, /\*2026-10-23\* — still in progress · kept 3× in WIP/);
  assert.doesNotMatch(f.editor.content, /WORK LOG/);
  f.editor.undo(); assert.equal(f.editor.content, raw);
});

test("blank WIP keep logs 🤷 with its rung tail", async () => {
  const raw = RAW.replace("[ ]", "[/]");
  const f = fixture({ content: raw, entry: row(raw, { tier: "pending", tierLabel: "PENDING", lane: "pending", state: "pending" }) });
  const pending = f.run({ keepReason: "" });
  assert.equal(await pending, true);
  assert.match(f.editor.content, /🤷 no reason given · kept 3× in WIP/);
});

for (const reason of ["", "still useful in Next"]) {
  test(`single Next keep ${reason || "with a blank reason"} counts and always logs`, async () => {
    const raw = RAW.replace("[ ]", "[*]");
    const nextEntry = row(raw, {
      lane: "next", tier: "next", tierLabel: "NEXT", state: "fresh",
    });
    const f = fixture({ content: raw, entry: nextEntry });
    const pending = f.run();
    const modal = modals.at(-1);
    assert.match(text(modal.contentEl), /Why keep it in Next\?/);
    assert.equal(modal.inputEl.getAttribute("placeholder"), "Why keep it in Next? (optional · ↵ logs 🤷)");
    modal.inputEl.value = reason;
    modal.inputEl.listeners.input();
    assert.match(text(modal.previewEl), reason ? /still useful in Next · kept 3× in Next/ : /🤷 no reason given · kept 3× in Next/);
    assert.equal(modal.refreshButton.textContent, "Keep & log");
    pressKey(modal, "Enter");
    assert.equal(await pending, true);
    assert.equal(f.editor.transactions.length, 1);
    assert.match(f.editor.content, /\[fresh:: 2026-10-23\]/);
    assert.match(f.editor.content, /\[keeps:: 3\]/);
    const history = h.readRottenLog(f.editor.content, 0);
    assert.equal(history.entries.length, 1);
    assert.equal(history.entries[0].lane, "next");
    assert.equal(history.entries[0].rung, "Next");
    assert.equal(history.entries[0].keeps, 3);
  });
}

test("early Next task stamps quietly with no prompt; Ctrl+Alt+F logs then advances", async () => {
  const raw = RAW.replace("[ ]", "[*]");
  const early = fixture({ content: raw, entry: null });
  assert.equal(await early.run(), true);
  assert.equal(modals.length, 0);
  assert.equal(early.editor.transactions.length, 1);
  assert.match(early.editor.content, /\[fresh:: 2026-10-23\]/);
  assert.match(early.editor.content, /\[keeps:: 2\]/);
  assert.doesNotMatch(early.editor.content, /ROTTEN LOG/);
  assert.match(notices.at(-1), /early · not counted/);

  const nextEntry = row(raw, { lane: "next", tier: "next", tierLabel: "NEXT", state: "fresh" });
  const f = fixture({ content: raw, entry: nextEntry });
  let advances = 0;
  f.plugin.jumpToDueTask = async () => { advances += 1; return true; };
  const pending = f.run({ advance: true });
  const modal = modals.at(-1);
  assert.equal(modal.refreshButton.textContent, "Keep, log & next");
  modal.inputEl.value = "stays in the lane";
  modal.inputEl.listeners.input();
  assert.equal(modal.refreshButton.textContent, "Keep, log & next");
  pressKey(modal, "Enter");
  assert.equal(await pending, true);
  assert.equal(advances, 1);
  assert.match(f.editor.content, /stays in the lane · kept 3× in Next/);
});

test("Esc on a Next keep writes nothing and does not advance", async () => {
  const raw = RAW.replace("[ ]", "[*]");
  const f = fixture({ content: raw, entry: row(raw, { lane: "next", tier: "next" }) });
  let advances = 0;
  f.plugin.jumpToDueTask = async () => { advances += 1; };
  const pending = f.run({ advance: true });
  pressKey(modals.at(-1), "Escape");
  assert.equal(await pending, false);
  assert.equal(f.editor.content, raw);
  assert.equal(f.editor.transactions.length, 0);
  assert.equal(advances, 0);
});

test("counted mixed sessions use one Rotten prompt and log each rung tail", async () => {
  const pendingRaw = "- [/] #task Finish intro [fresh:: 2026-10-14] ^pending";
  const content = [pendingRaw, RAW].join("\n");
  const f = fixture({ content, entry: null });
  f.freshness.queue = () => [
    row(pendingRaw, {
      key: "a.md:1", line: 1, tier: "pending", tierLabel: "PENDING",
      state: "pending", lane: "pending", fresh: "2026-10-14", keeps: 0,
    }),
    row(RAW, { key: "a.md:2", line: 2 }),
  ];
  const pending = f.run({ countExplicit: true, additionalTaskCount: 1 });
  assert.equal(modals.length, 1);
  const modal = modals[0];
  assert.equal(modal.workInputEl, undefined);
  assert.ok(modal.keepInputEl);
  assert.equal(modal.keepInputEl.getAttribute("aria-label"), "Keep reason");
  assert.match(text(modal.keepPreviewEl), /Read primer #ref · Ready · none logged yet/);
  assert.match(text(modal.keepPreviewEl), /Finish intro · WIP · none logged yet/);

  modal.keepInputEl.value = "still going";
  modal.keepInputEl.listeners.input();
  pressKey(modal, "Enter");

  assert.equal(await pending, true);
  assert.equal(f.editor.transactions.length, 1);
  assert.doesNotMatch(f.editor.content, /WORK LOG/);
  assert.match(f.editor.content, /\*2026-10-23\* — still going · kept 1× in WIP/);
  assert.match(f.editor.content, /\*2026-10-23\* — still going · kept 3× in Ready/);
});

test("counted at-limit Rotten targets skip without opening a prompt or logging", async () => {
  const atLimit = RAW.replace("keeps:: 2", "keeps:: 3");
  const f = fixture({ content: atLimit, entry: row(atLimit, { decide: true, keeps: 3 }) });
  assert.equal(await f.run({ countExplicit: true }), true);
  assert.equal(modals.length, 0);
  assert.equal(f.editor.transactions.length, 0);
  assert.equal(f.editor.content, atLimit);
  assert.match(notices.at(-1), /needs a decision/);
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
  assert.equal(f.editor.content, content); assert.match(notices.at(-1), /Repair the duplicate/);
});

test("combined planner inserts nested targets bottom-up and preserves CRLF", () => {
  const child = "  " + RAW.replace("primer", "child");
  const content = [RAW, child, "    - existing child", "- [/] #task Pending", ""].join("\r\n");
  const plan = h.planFreshStampBatchWithLogs(content, [0, 1, 3].map((line) => ({ line, counted: line !== 3 })), keep, DATE,
    { rottenTargets: [{ line: 0, rung: "Ready" }, { line: 1, rung: "Ready" }], keepReason: "still useful" });
  assert.equal(plan.ok, true); assert.equal(plan.rottenLogWrittenCount, 2); assert.equal(plan.workLogWrittenCount, 0);
  assert.equal(h.readRottenLog(plan.content, 0).entries.length, 1);
  assert.equal(h.readRottenLog(plan.content, 1).entries.length, 1);
  assert.doesNotMatch(plan.content, /WORK LOG/); assert.doesNotMatch(plan.content, /(?<!\r)\n/);
  assert.match(plan.content, /existing child/);
  assert.match(plan.content, /still useful · kept 3× in Ready/);
});

test("lane keeps always log with their rung tail and refuse ambiguous markers", () => {
  const next = "- [*] #task Next task [fresh:: 2026-10-14] [keeps:: 2]";
  for (const reason of ["", "still needed"]) {
    const planned = h.planFreshStampBatchWithLogs(next, [{ line: 0, counted: true }], keep, DATE,
      { laneTargets: [{ line: 0, rung: "Next" }], keepReason: reason });
    assert.equal(planned.ok, true);
    assert.equal(planned.rottenLogWrittenCount, 1);
    assert.match(planned.content, reason
      ? /\*2026-10-23\* — still needed · kept 3× in Next/
      : /\*2026-10-23\* — 🤷 no reason given · kept 3× in Next/);
    assert.match(planned.content, /\[keeps:: 3\]/);
  }
  const logged = h.planFreshStampBatchWithLogs(next, [{ line: 0, counted: true }], keep, DATE,
    { laneTargets: [{ line: 0, rung: "Next" }], keepReason: "still needed" });
  assert.deepEqual(h.readRottenLog(logged.content, 0).entries[0], {
    indent: "\t\t", marker: "-", date: "2026-10-23", reason: "still needed",
    keeps: 3, rung: "Next", lane: "next", kind: "kept",
  });

  const existing = next + "\n\t- 🥀 **ROTTEN LOG**\n\t\t- *2026-10-16* — old · kept 1×";
  const reused = h.planFreshStampBatchWithLogs(existing, [{ line: 0, counted: true }], keep, DATE,
    { laneTargets: [{ line: 0, rung: "Next" }], keepReason: "still useful" });
  assert.equal(reused.ok, true);
  assert.equal((reused.content.match(/🥀 \*\*ROTTEN LOG\*\*/g) || []).length, 1);
  assert.match(reused.content, /\*2026-10-23\* — still useful · kept 3× in Next/);

  const ambiguous = next + "\n\t- 🥀 **ROTTEN LOG**\n\t- 🥀 **ROTTEN LOG**";
  const refused = h.planFreshStampBatchWithLogs(ambiguous, [{ line: 0, counted: true }], keep, DATE,
    { laneTargets: [{ line: 0, rung: "Next" }], keepReason: "still useful" });
  assert.equal(refused.ok, false);
  assert.equal(refused.refusal, "rotten-log-ambiguous");
  assert.equal(refused.rottenLogWrittenCount, 0);
});

test("rung classification follows status, lane, and priority", () => {
  assert.equal(h.rottenKeepRungForTarget("- [/] #task W", { lane: "pending" }), "WIP");
  assert.equal(h.rottenKeepRungForTarget("- [*] #task N", { lane: "next" }), "Next");
  assert.equal(h.rottenKeepRungForTarget("- [ ] #task R", { lane: "ready" }), "Ready");
  assert.equal(h.rottenKeepRungForTarget("- [ ] #task P [priority:: P2]", { lane: "ready" }), "P2");
  assert.equal(h.rottenKeepRungForTarget("- [?] #task B", { lane: "pending" }), "WIP");
  assert.equal(h.rottenKeepRungForTarget("- [?] #task B", { lane: "next" }), "Next");
  assert.equal(h.rottenKeepIsDueRung("pending", "pending"), true);
  assert.equal(h.rottenKeepIsDueRung("next", "next"), true);
  assert.equal(h.rottenKeepIsDueRung("ready", "rotten"), true);
  assert.equal(h.rottenKeepIsDueRung("ready", "tickler"), true);
  assert.equal(h.rottenKeepIsDueRung("pending", "next"), false);
  assert.equal(h.rottenKeepIsDueRung("ready", "next"), false);
  assert.equal(h.rottenKeepAllowanceSubtitle("Next", 1, 2, false), "keep 1 of 2 in Next");
  assert.equal(h.rottenKeepAllowanceSubtitle("Next", 2, 2, false), "keep 2 of 2 in Next");
  assert.equal(h.rottenKeepAllowanceSubtitle("Ready", 2, 2, false), "keep 2 of 2 in Ready · the next due keep opens the decay card");
  assert.equal(h.rottenKeepAllowanceSubtitle("P2", 2, 2, false), "keep 2 of 2 at P2 · the next due keep opens the decay card");
  assert.equal(h.rottenKeepAllowanceSubtitle("Next", 3, false, false), "keep 3 in Next · decay off for Next");
  const tallies = h.formatRottenLogRungTallies([
    { rung: "Next", keeps: 2 }, { rung: "WIP", keeps: 1 }, { rung: "Next", keeps: 1 },
    { rung: "Ready", keeps: 3 }, { rung: null },
  ]);
  assert.equal(tallies, "WIP 1 · Next 2 · Ready 1");
  assert.equal(h.formatRottenLogRungTallies([]), "");
});

test("prompt copy shows the rung question, allowance, and tallies", () => {
  const base = { raw: RAW, entry: row(), dateText: DATE, keepsBefore: 2, keepsAfter: 3, rung: "Ready", allowance: 2 };
  const empty = h.buildRottenKeepPromptModel(base);
  assert.equal(empty.title, "Why keep it in Ready?");
  assert.match(empty.subtitleLines[0], /ROTTEN · 9d/);
  assert.equal(empty.subtitleLines[1], "keep 3 of 2 in Ready · the next due keep opens the decay card · none logged yet");
  assert.equal(empty.placeholder, "Why keep it in Ready? (optional · ↵ logs 🤷)");
  assert.match(empty.destinationText, /last child/);
  assert.equal(empty.previewEntryText, h.formatRottenLogEntryText({ date: DATE, reason: "", keeps: 3, rung: "Ready" }));
  assert.equal(empty.enterHint, "Keep & log");
  const entry = { date: "2026-10-16", reason: "🤷 no reason given", keeps: 2, rung: "Ready", lane: null, kind: "kept" };
  const one = h.buildRottenKeepPromptModel({ ...base, keepsBefore: 0, keepsAfter: 1, allowance: 3, history: { status: "ok", entries: [entry] } });
  assert.equal(one.subtitleLines[1], "keep 1 of 3 in Ready · Ready 1");
  assert.equal(one.historyRows[0].date, "Oct 16");
  assert.equal(one.historyRows[0].kept, "kept 2× in Ready");
  const many = h.buildRottenKeepPromptModel({ ...base, history: { status: "ok", entries: Array(5).fill(entry) }, advance: true });
  assert.equal(many.historyRows.length, 3); assert.equal(many.olderCount, 2);
  assert.match(many.subtitleLines[1], /Ready 5/); assert.equal(many.enterHint, "Keep, log & next");
  const off = h.buildRottenKeepPromptModel({ ...base, allowance: false });
  assert.equal(off.subtitleLines[1], "keep 3 in Ready · decay off for Ready · none logged yet");
});

test("Next keep model always logs with its rung tail and gates unreadable history", () => {
  const base = {
    raw: "- [*] #task Keep next [fresh:: 2026-10-14] [keeps:: 2]",
    rung: "Next", allowance: 2, dateText: DATE, keepsBefore: 2,
    entry: { fresh: "2026-10-14", ageDays: 9, tierLabel: "NEXT" },
    history: { status: "missing", entries: [] },
  };
  const blank = h.buildRottenKeepPromptModel(base);
  assert.equal(blank.title, "Why keep it in Next?");
  assert.match(blank.subtitleLines[0], /NEXT · 9d/);
  assert.equal(blank.subtitleLines[1], "keep 3 of 2 in Next · the next due keep opens the decay card · none logged yet");
  assert.equal(blank.placeholder, "Why keep it in Next? (optional · ↵ logs 🤷)");
  assert.equal(blank.previewTitle, "*2026-10-23* — 🤷 no reason given · kept 3× in Next");
  assert.equal(blank.enterHint, "Keep & log");
  assert.equal(h.buildRottenKeepPromptModel({ ...base, advance: true }).enterHint, "Keep, log & next");

  const typed = h.buildRottenKeepPromptModel({ ...base, reason: "still needed", keepsAfter: 3 });
  assert.equal(typed.previewEntryText, "*2026-10-23* — still needed · kept 3× in Next");
  assert.equal(typed.enterHint, "Keep & log");
  assert.equal(h.buildRottenKeepPromptModel({ ...base, reason: "still needed", advance: true }).enterHint, "Keep, log & next");

  const unreadable = { ...base, history: { status: "ambiguous", entries: [] } };
  assert.equal(h.buildRottenKeepPromptModel(unreadable).disabled, true);
  const nextEntry = { date: "2026-10-16", reason: "keep in lane", keeps: null, rung: "Next", lane: "next", kind: "kept" };
  const earlier = h.buildRottenKeepPromptModel({
    ...base, history: { status: "ok", entries: [nextEntry] },
  });
  assert.equal(earlier.historyRows[0].kept, "kept in Next");
  assert.match(earlier.subtitleLines[1], /Next 1/);
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
