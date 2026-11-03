// `]n` / `[n` on period notes (`‹ W44` · `W46 ›`) and bob-owned creation of
// missing week, quarter, year, and all-time notes (bob-cli docs/periods.md).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
global.Notice = class {
  constructor(message) {
    notices.push(String(message));
  }
};

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Modal: class {},
      Notice: global.Notice,
      Platform: { isDesktopApp: true },
      Plugin: class {},
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    class TestEditorView {}
    TestEditorView.updateListener = { of: (listener) => ({ listener }) };
    return { EditorView: TestEditorView, keymap: { of: (value) => value } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
Module._load = originalLoad;

const { isPeriodNoteCreationPath, renderedLinkMatchesNavLabel } = NavigationHotkeysPlugin.helpers;

const WEEK_NOTE = [
  "---",
  'parent: "[[2026/2026-Q4]]"',
  "aliases:",
  '  - "2026-W45 · Nov 2 – 8"',
  "---",
  "",
  "# 2026-W45 · Nov 2 – 8",
  "",
  "[[2026/2026-W44|‹ W44]] · [[2026/2026-Q4|↑ 2026-Q4]] · [[2026/2026-W46|W46 ›]]",
  "[[2026/20261102|Mon Nov 2]] · [[2026/20261103|Tue 3]]",
  "",
  "```bob-stats-strip",
  "[[decoy|‹ fenced]]",
  "```",
].join("\n");

const DAILY_NOTE = [
  "---",
  "parent: '[[2026/2026-W45]]'",
  "---",
  "",
  "# 2026-11-03 Tue",
  "",
  "[[2026/20261102|prev]] · [[2026/2026-W45|W45]] · [[2026/20261104|next]]",
].join("\n");

function plugin() {
  return Object.create(NavigationHotkeysPlugin.prototype);
}

test("prev labels are exact or open with ‹ / <; next labels are exact or carry › / > at either end", () => {
  for (const text of ["prev", "‹ W44", "‹ 2025-W52", "< Q2", "<back"]) {
    assert.equal(renderedLinkMatchesNavLabel(text, "prev"), true, text);
  }
  for (const text of ["next", "W46 ›", "2027-W01 ›", "Q4 >", "> Q4", "› W46"]) {
    assert.equal(renderedLinkMatchesNavLabel(text, "next"), true, text);
  }
  for (const text of ["W46 ›", "↑ 2026-Q4", "Mon Nov 2", "previous", ""]) {
    assert.equal(renderedLinkMatchesNavLabel(text, "prev"), false, text);
  }
  for (const text of ["‹ W44", "↑ 2026", "nextly", "W45"]) {
    assert.equal(renderedLinkMatchesNavLabel(text, "next"), false, text);
  }
  assert.equal(renderedLinkMatchesNavLabel("parent", "parent"), true, "other labels stay exact");
  assert.equal(renderedLinkMatchesNavLabel("‹ parent", "parent"), false);
});

test("]n / [n find the period nav links and keep the daily prev / next links", () => {
  const nav = plugin();
  assert.equal(nav.findFirstRenderedLink(WEEK_NOTE, "prev").target, "2026/2026-W44");
  assert.equal(nav.findFirstRenderedLink(WEEK_NOTE, "next").target, "2026/2026-W46");
  assert.equal(nav.findFirstRenderedLink(DAILY_NOTE, "prev").target, "2026/20261102");
  assert.equal(nav.findFirstRenderedLink(DAILY_NOTE, "next").target, "2026/20261104");
  assert.equal(
    nav.findFirstRenderedLink("[[2025|‹ 2025]] · [[all_time|↑ All time]] · [[2027|2027 ›]]", "next").target,
    "2027",
  );
  assert.equal(nav.findFirstRenderedLink("# All time\n\n[[org|↑ org]]\n", "next"), null);
});

test("period-note creation paths are weeks, quarters, years, and all_time", () => {
  for (const path of ["2026/2026-W47.md", "2026/2026-W53.md", "2026/2026-Q4.md", "2027.md", "all_time.md"]) {
    assert.equal(isPeriodNoteCreationPath(path), true, path);
  }
  for (const path of ["2026/20261103.md", "2026/202611.md", "2025/2026-W01.md", "2026/2026-W54.md", "2026/2026-Q5.md", "notes/2026.md", "org.md"]) {
    assert.equal(isPeriodNoteCreationPath(path), false, path);
  }
});

function creationHarness(api) {
  const nav = plugin();
  const opened = [];
  let templaterCalls = 0;
  nav.app = {
    vault: { getAbstractFileByPath: () => null },
    plugins: { plugins: api ? { "bob-ledger-tools": { api: { periodNotes: api } } } : {} },
  };
  nav.isMarkdownFile = (file) => Boolean(file && typeof file.path === "string" && file.path.endsWith(".md"));
  nav.openMarkdownFileWithLeafReuse = async (file) => {
    opened.push(file.path);
    return true;
  };
  nav.getTemplaterPlugin = () => {
    templaterCalls += 1;
    return null;
  };
  return { nav, opened, templaterCalls: () => templaterCalls };
}

test("a missing period note is created through bob-ledger-tools api.periodNotes, never a template", async () => {
  const asked = [];
  const api = {
    version: 1,
    ensureNote: async (path) => {
      asked.push(path);
      return { ok: true, file: { path }, code: null, message: "" };
    },
  };
  const { nav, opened, templaterCalls } = creationHarness(api);
  const creation = { basename: "2026-W47", folderPath: "2026", path: "2026/2026-W47.md" };
  assert.equal(await nav.createNoteFromLinkCandidate({ creation, target: "2026/2026-W47" }), true);
  assert.deepEqual(asked, ["2026/2026-W47.md"]);
  assert.deepEqual(opened, ["2026/2026-W47.md"]);
  assert.equal(templaterCalls(), 0);
});

test("without bob-ledger-tools, or when ensure fails, a period link explains and creates nothing", async () => {
  notices.length = 0;
  const missing = creationHarness(null);
  const year = { basename: "2027", folderPath: "", path: "2027.md" };
  assert.equal(await missing.nav.createNoteFromLinkCandidate({ creation: year, target: "2027" }), false);
  assert.equal(missing.templaterCalls(), 0);
  assert.match(notices.at(-1), /No 2027 note yet — bob periods ensure creates period notes/);

  const failing = creationHarness({
    version: 1,
    ensureNote: async () => ({ ok: false, file: null, code: "lock_busy", message: "vault busy" }),
  });
  assert.equal(await failing.nav.createNoteFromLinkCandidate({ creation: year, target: "2027" }), false);
  assert.deepEqual(failing.opened, []);
  assert.match(notices.at(-1), /Could not create 2027 — vault busy/);
});
