// Output pager: ANSI (including split sequences), linkify, JSON pretty-print,
// keys, history, copy formats, and writer stop confirmation.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  BobCommandModePlugin,
  helpers,
  installDocument,
  makeApp,
  makeRunner,
  takeToastNotices,
} = require("./command-mode-harness.cjs");
const { pressKey } = require("./modal-harness.cjs");

function defaultStyle(overrides = {}) {
  return {
    bold: false, dim: false, italic: false, underline: false,
    fg: null, bg: null, muted: false, ...overrides,
  };
}

function seedRun(tmpState, record, stdout = "", stderr = "") {
  const runsDir = path.join(tmpState, "bob-cli", "command-mode", "runs");
  fs.mkdirSync(runsDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(runsDir, record.id + ".json"), JSON.stringify(record, null, 2) + "\n");
  fs.writeFileSync(path.join(runsDir, record.id + ".out"), stdout);
  fs.writeFileSync(path.join(runsDir, record.id + ".err"), stderr);
}

function finishedRecord(overrides = {}) {
  return helpers.cmNewRecord({
    id: "20261026-150000-abcd",
    argv: ["/usr/bin/bob", "plan"],
    entryId: "plan",
    title: "Today's plan",
    effect: "reads",
    presentation: "report",
    bobPath: "/usr/bin/bob",
    startedAt: "2026-10-26T15:00:00.000Z",
    ...overrides,
  });
}

test("ANSI parsing keeps SGR that splits across chunks", () => {
  const parser = helpers.cmCreateAnsiParser();
  const first = helpers.cmParseAnsiChunk(parser, "ok \u001b[1;31");
  assert.deepEqual(first.map((node) => node.text), ["ok "]);
  assert.equal(parser.leftover, "\u001b[1;31");
  const second = helpers.cmParseAnsiChunk(parser, "mred\u001b[0m!");
  assert.equal(parser.leftover, "");
  assert.equal(second[0].text, "red");
  assert.equal(second[0].style.bold, true);
  assert.match(String(second[0].style.fg), /color-red/);
  assert.equal(second[1].text, "!");
  assert.deepEqual(second[1].style, defaultStyle());
  const truecolor = helpers.cmParseAnsi("\u001b[38;2;10;20;30mrgb\u001b[0m");
  assert.equal(truecolor[0].style.fg, "rgb(10,20,30)");
  const indexed = helpers.cmParseAnsi("\u001b[38;5;196mx\u001b[0m");
  assert.ok(indexed[0].style.fg);
  const stripped = helpers.cmParseAnsi("a\u001b[2Kb\u001b]8;;http://x\u0007c");
  assert.equal(stripped.map((node) => node.text).join(""), "abc");
});

test("linkify positives resolve and negatives stay plain", () => {
  const app = {
    vault: {
      getAbstractFileByPath: (target) => (target === "areas/work.md" ? { path: "areas/work.md" } : null),
    },
    metadataCache: {
      getFirstLinkpathDest: (name) => (name === "Work" ? { path: "areas/work.md" } : null),
    },
  };
  const spans = helpers.cmFindLinkSpans(
    "see [[Work]] and missing.md and areas/work.md:12 and [[Nope]] and /vault/areas/work.md#^id",
    { app, vaultBase: "/vault" },
  );
  const hrefs = spans.map((span) => [span.href, span.line, span.kind]);
  assert.deepEqual(hrefs, [
    ["Work", null, "wiki"],
    ["areas/work.md", 12, "path"],
    ["areas/work.md#^id", null, "absolute"],
  ]);
  assert.equal(helpers.cmFindLinkSpans("nope.md", { app }).length, 0);
  assert.equal(helpers.cmFindLinkSpans("[[Nope]]", { app }).length, 0);
});

test("JSON pretty-print mutes keys on a single document", () => {
  const parsed = helpers.cmTryParseJsonBody('\u001b[32m{"ok":true,"name":"plan"}\u001b[0m\n');
  assert.equal(parsed.ok, true);
  const nodes = helpers.cmJsonPrettyNodes(parsed);
  const keys = nodes.filter((node) => node.kind === "key").map((node) => node.text);
  assert.deepEqual(keys, ['"ok"', '"name"']);
  assert.ok(nodes.every((node) => node.kind !== "key" || node.style.muted));
  assert.equal(helpers.cmTryParseJsonBody("hello {nope}"), null);
  const chunks = helpers.cmMaybePrettyJsonChunks([{ stream: "out", text: '{"a":1}' }]);
  assert.ok(chunks[0].nodes.some((node) => node.kind === "key" && node.text === '"a"'));
  assert.ok(chunks[0].nodes.some((node) => String(node.text).includes("{")));
});

test("interleave replay preserves arrival order for copy", () => {
  const chunks = helpers.cmReplayInterleave("OUT", "ERR", [["err", 3], ["out", 3]]);
  assert.deepEqual(chunks.map((chunk) => chunk.stream + ":" + chunk.text), ["err:ERR", "out:OUT"]);
  assert.equal(helpers.cmPagerCopyOutput(chunks), "ERROUT");
  const record = { argv: ["/usr/bin/bob", "vault-sync", "run"] };
  assert.equal(helpers.cmPagerCopyCommand(record), "bob vault-sync run");
});

test("stamped sequence runs add a step label to the pager header", () => {
  const restore = installDocument({ focused: true });
  try {
    const view = helpers.cmBuildPagerView({
      record: {
        id: "seq-step",
        argv: ["/usr/bin/bob", "task", "reconcile"],
        outcome: "completed",
        started_at: "2026-10-26T15:00:00.000Z",
        sequence: { id: "seq-one", index: 2, total: 3 },
      },
      stdout: Buffer.from("done\n"),
      stderr: Buffer.alloc(0),
    });
    assert.deepEqual(view.sequence, { index: 2, total: 3 });
    const { ElementStub } = require("./modal-harness.cjs");
    const root = new ElementStub({ tag: "div" });
    helpers.cmRenderPagerView(root, view);
    const header = root.children.find((child) => child.classList.contains("bob-cmd-pager-header"));
    const sequence = header.children.find((child) => child.classList.contains("bob-cmd-pager-seq"));
    assert.equal(sequence.textContent, "step 2 of 3");
    assert.ok(header.children.indexOf(sequence) > header.children.findIndex((child) => child.classList.contains("bob-cmd-pager-argv")));
  } finally {
    restore();
  }
});

test("pager keys: scroll, wrap, search, copy, history, stop, close", () => {
  const searchOff = helpers.cmDefaultPagerSearch();
  assert.deepEqual(helpers.cmHandlePagerKey({ key: "j" }, { search: searchOff }), { type: "scroll", delta: "line", dir: 1 });
  assert.deepEqual(helpers.cmHandlePagerKey({ key: "k" }, { search: searchOff }), { type: "scroll", delta: "line", dir: -1 });
  assert.deepEqual(helpers.cmHandlePagerKey({ key: "d" }, { search: searchOff }), { type: "scroll", delta: "half", dir: 1 });
  assert.deepEqual(helpers.cmHandlePagerKey({ key: "u" }, { search: searchOff }), { type: "scroll", delta: "half", dir: -1 });
  assert.deepEqual(helpers.cmHandlePagerKey({ key: "g" }, { search: searchOff }), { type: "scroll", delta: "home" });
  assert.deepEqual(helpers.cmHandlePagerKey({ key: "G" }, { search: searchOff }), { type: "scroll", delta: "end" });
  assert.equal(helpers.cmHandlePagerKey({ key: "w" }, { search: searchOff }).type, "wrap");
  assert.equal(helpers.cmHandlePagerKey({ key: "y" }, { search: searchOff }).type, "copy-output");
  assert.equal(helpers.cmHandlePagerKey({ key: "Y" }, { search: searchOff }).type, "copy-command");
  assert.equal(helpers.cmHandlePagerKey({ key: "r" }, { search: searchOff }).type, "rerun");
  assert.deepEqual(helpers.cmHandlePagerKey({ key: "[" }, { search: searchOff }), { type: "history", dir: 1 });
  assert.deepEqual(helpers.cmHandlePagerKey({ key: "]" }, { search: searchOff }), { type: "history", dir: -1 });
  assert.equal(helpers.cmHandlePagerKey({ key: ":" }, { search: searchOff }).type, "back");
  assert.equal(helpers.cmHandlePagerKey({ key: "Escape" }, { search: searchOff }).type, "escape");
  assert.equal(helpers.cmHandlePagerKey({ key: "q" }, { search: searchOff }).type, "close");
  assert.equal(helpers.cmHandlePagerKey({ key: "c", ctrlKey: true }, { search: searchOff, hasSelection: false }).type, "stop-request");
  assert.equal(helpers.cmHandlePagerKey({ key: "c", ctrlKey: true }, { search: searchOff, hasSelection: true }).type, "none");
  assert.equal(helpers.cmHandlePagerKey({ key: "y" }, { search: searchOff, stopConfirm: true }).type, "stop");
  assert.equal(helpers.cmHandlePagerKey({ key: "Escape" }, { search: searchOff, stopConfirm: true }).type, "stop-cancel");
  assert.equal(helpers.cmHandlePagerKey({ key: "/" }, { search: searchOff }).type, "search-start");
  assert.deepEqual(helpers.cmHandlePagerKey({ key: "n" }, { search: { mode: "editing", query: "" } }), { type: "search-type", char: "n" });
  assert.equal(helpers.cmHandlePagerKey({ key: "n" }, { search: { mode: "idle", query: "x" } }).type, "search-next");
  assert.equal(helpers.cmHandlePagerKey({ key: "N" }, { search: { mode: "idle", query: "x" } }).type, "search-prev");
  assert.equal(helpers.cmPagerApplyScroll({ top: 0, view: 100, height: 500 }, { delta: "line", dir: 1 }), helpers.CM_PAGER_LINE_PX);
});

test("history stepping is newest-first", () => {
  const records = [
    { id: "old", started_at: "2026-10-26T14:00:00.000Z" },
    { id: "mid", started_at: "2026-10-26T15:00:00.000Z" },
    { id: "new", started_at: "2026-10-26T16:00:00.000Z" },
  ];
  const state = helpers.cmPagerHistoryState(records, "mid");
  assert.equal(state.label, "2 of 3");
  assert.equal(state.olderId, "old");
  assert.equal(state.newerId, "new");
  assert.deepEqual(helpers.cmPagerHistoryIds(records), ["new", "mid", "old"]);
});

test("search matches are exact and advance", () => {
  const matches = helpers.cmFindSearchMatches("alpha beta alpha", "alpha");
  assert.deepEqual(matches, [{ start: 0, end: 5 }, { start: 11, end: 16 }]);
  assert.deepEqual(helpers.cmFindSearchMatches("alpha", "nope"), []);
});

test("status pill covers running, outcomes, and queued-behind", () => {
  const running = helpers.cmPagerStatusMeta({
    outcome: "running", started_at: "2026-10-26T15:00:00.000Z",
  }, Date.parse("2026-10-26T15:00:12.000Z"));
  assert.equal(running.text, "running 0:12");
  assert.equal(helpers.cmPagerStatusMeta({ outcome: "completed", duration_ms: 1200 }).text, "completed · 1.2 s");
  assert.equal(helpers.cmPagerStatusMeta({ outcome: "attention", exit_code: 0 }).text, "needs attention · exit 0");
  assert.equal(helpers.cmPagerStatusMeta({ outcome: "failed", exit_code: 1 }).text, "failed · exit 1");
  assert.equal(helpers.cmPagerStatusMeta({ outcome: "unknown" }).glyph, "?");
  assert.equal(helpers.cmPagerStatusMeta({ outcome: "stopped" }).glyph, "■");
  assert.match(helpers.cmPagerStatusMeta({ outcome: "queued" }, 0, "task reconcile").text, /queued behind task reconcile/);
});

test("plugin pager opens from Output, show-last-output, history, copy, and stop", async () => {
  const restoreDocument = installDocument({ focused: true });
  const copied = [];
  const previousNavigator = global.navigator;
  global.navigator = { clipboard: { writeText: async (text) => { copied.push(text); } } };
  try {
    takeToastNotices();
    const base = makeRunner({});
    const older = finishedRecord({
      id: "20261026-140000-old1",
      startedAt: "2026-10-26T14:00:00.000Z",
      argv: ["/usr/bin/bob", "ready"],
      entryId: "ready",
      title: "Ready lanes",
    });
    older.outcome = "completed";
    older.finished_at = "2026-10-26T14:00:01.000Z";
    older.duration_ms = 1000;
    older.exit_code = 0;
    older.interleave = [["out", 4]];
    const newest = finishedRecord({
      id: "20261026-150000-new1",
      startedAt: "2026-10-26T15:00:00.000Z",
    });
    newest.outcome = "failed";
    newest.finished_at = "2026-10-26T15:00:02.000Z";
    newest.duration_ms = 2000;
    newest.exit_code = 1;
    newest.interleave = [["out", 5], ["err", 11]];
    seedRun(base.tmpState, older, "old\n", "");
    seedRun(base.tmpState, newest, "hello", "error: boom");
    const plugin = new BobCommandModePlugin(makeApp());
    plugin.commandModeRunner = base.runner;
    plugin.settings = { osNotifications: false };
    plugin.commandModeStickyNotices = new Map();
    assert.deepEqual(plugin.commandModeOpenOutput("missing"), { ok: false, reason: "run not found" });
    const opened = plugin.commandModeOpenOutput(newest.id);
    assert.equal(opened.ok, true);
    assert.equal(plugin.commandModePager.pagerOpen, true);
    assert.match(plugin.commandModePager.view.status.text, /failed · exit 1/);
    assert.match(plugin.commandModePager.view.argv, /bob plan/);
    const stderr = plugin.commandModePager.view.chunks.filter((chunk) => chunk.stream === "err");
    assert.equal(stderr.length, 1);
    plugin.commandModePager.clipboardWrite = async (text) => { copied.push(text); return { ok: true }; };
    pressKey(plugin.commandModePager, "y");
    await Promise.resolve();
    assert.equal(copied[0], "helloerror: boom");
    pressKey(plugin.commandModePager, "Y");
    await Promise.resolve();
    assert.equal(copied[1], "bob plan");
    pressKey(plugin.commandModePager, "[");
    assert.equal(plugin.commandModePager.runId, older.id);
    pressKey(plugin.commandModePager, "]");
    assert.equal(plugin.commandModePager.runId, newest.id);
    pressKey(plugin.commandModePager, "w");
    assert.equal(plugin.commandModePager.wrap, true);
    plugin.commandModePager.close();
    assert.equal(plugin.commandModePager, null);
    const shown = plugin.commandModeShowLastOutput();
    assert.equal(shown.ok, true);
    assert.equal(plugin.commandModePager.runId, newest.id);
  } finally {
    restoreDocument();
    if (previousNavigator === undefined) delete global.navigator;
    else global.navigator = previousNavigator;
  }
});

test("writer stop needs confirmation; reads stop immediately", () => {
  const restoreDocument = installDocument({ focused: true });
  try {
    const base = makeRunner({});
    const writer = finishedRecord({
      id: "20261026-150000-wrt1",
      argv: ["/usr/bin/bob", "ref", "create", "https://example.com"],
      entryId: "ref-create",
      title: "Create reference",
      effect: "writes",
    });
    writer.outcome = "running";
    const reader = finishedRecord({
      id: "20261026-150000-rd01",
      effect: "reads",
    });
    reader.outcome = "running";
    seedRun(base.tmpState, writer, "ingesting\n", "");
    seedRun(base.tmpState, reader, "plan\n", "");
    const stopped = [];
    base.runner.live.set(writer.id, { record: writer, state: { stdout: "ingesting\n", stderr: "", truncated: false } });
    base.runner.live.set(reader.id, { record: reader, state: { stdout: "plan\n", stderr: "", truncated: false } });
    base.runner.stop = (id) => { stopped.push(id); return { ok: true, runId: id }; };
    const plugin = new BobCommandModePlugin(makeApp());
    plugin.commandModeRunner = base.runner;
    plugin.commandModeOpenOutput(writer.id);
    pressKey(plugin.commandModePager, "c", { ctrlKey: true });
    assert.equal(plugin.commandModePager.stopConfirm, true);
    assert.deepEqual(stopped, []);
    pressKey(plugin.commandModePager, "y");
    assert.deepEqual(stopped, [writer.id]);
    plugin.commandModePager.close();
    plugin.commandModeOpenOutput(reader.id);
    pressKey(plugin.commandModePager, "c", { ctrlKey: true });
    assert.deepEqual(stopped, [writer.id, reader.id]);
  } finally {
    restoreDocument();
  }
});

test("watching a run skips the toast", () => {
  const restoreDocument = installDocument({ focused: true });
  try {
    takeToastNotices();
    const base = makeRunner({});
    const record = finishedRecord({ id: "20261026-151111-watch" });
    record.outcome = "completed";
    record.duration_ms = 800;
    seedRun(base.tmpState, record, "done\n", "");
    const plugin = new BobCommandModePlugin(makeApp());
    plugin.commandModeRunner = base.runner;
    plugin.settings = { osNotifications: false };
    plugin.commandModeStickyNotices = new Map();
    plugin.commandModeOpenOutput(record.id);
    takeToastNotices();
    const skipped = plugin.commandModeNotify({
      outcome: "completed",
      runId: record.id,
      record,
    });
    assert.equal(skipped, null);
    assert.equal(takeToastNotices().length, 0);
    plugin.commandModePager.close();
  } finally {
    restoreDocument();
  }
});

test("pretty JSON and ANSI land in the pager body", () => {
  const restoreDocument = installDocument({ focused: true });
  try {
    const base = makeRunner({});
    const record = finishedRecord({ id: "20261026-152222-json" });
    record.outcome = "completed";
    record.duration_ms = 400;
    record.exit_code = 0;
    record.interleave = [["out", 16]];
    seedRun(base.tmpState, record, '{"ok":true}\n', "");
    const plugin = new BobCommandModePlugin(makeApp({
      vault: {
        adapter: { getBasePath: () => base.tmpState },
        getAbstractFileByPath: () => null,
      },
      metadataCache: { getFirstLinkpathDest: () => null },
      workspace: makeApp().workspace,
    }));
    plugin.commandModeRunner = base.runner;
    plugin.commandModeOpenOutput(record.id);
    const keys = [];
    const walk = (node) => {
      if (!node) return;
      if (node.style && String(node.getAttribute && node.getAttribute("style") || "").includes("text-muted")) keys.push(node.textContent);
      for (const child of node.children || []) walk(child);
    };
    walk(plugin.commandModePager.viewEl);
    assert.ok(plugin.commandModePager.view.chunks[0].nodes.some((node) => node.kind === "key"));
    plugin.commandModePager.close();
  } finally {
    restoreDocument();
  }
});
