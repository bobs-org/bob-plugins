// Pomodoro themes manager: views, duplicate detection, rename preview,
// occurrences, and the stubbed-bob action flows.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  helpers,
  createPomodoroMovePickerHarness,
} = require("./navigation-hotkeys-harness.cjs");

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function textOf(element) {
  return (
    (element && element.textContent) ||
    "" + ((element && element.children) || []).map(textOf).join("")
  );
}

function themeRow(overrides = {}) {
  return {
    key: "bob",
    name: "BOB",
    hue: "magenta",
    hue_source: "hash",
    pinned: false,
    hidden: false,
    exempt: false,
    first_used: "2026-08-26",
    last_used: "2026-10-24",
    days_used: 26,
    entries: 49,
    today: "open",
    ...overrides,
  };
}

function managerReport(overrides = {}) {
  return {
    schema_version: 1,
    today: "2026-10-24",
    window_days: 90,
    counts: { known: 4, listed: 4, today: 1, hidden: 1 },
    themes: [
      themeRow(),
      themeRow({ key: "job", name: "JOB", hue: "aqua", hue_source: "area", last_used: "2026-10-23", days_used: 24, entries: 48, today: null }),
      themeRow({ key: "fixes", name: "FIXES", hue: "blue", hue_source: "hash", last_used: "2026-10-20", days_used: 6, entries: 9, today: null }),
      themeRow({ key: "fix", name: "FIX", hue: "red", hue_source: "pin", pinned: true, last_used: "2026-10-19", days_used: 2, entries: 3, today: null }),
      themeRow({ key: "books", name: "BOOKS", hue: "green", hue_source: "hash", hidden: true, last_used: "2026-10-21", days_used: 3, entries: 4, today: null }),
    ],
    hints: [
      {
        code: "theme_hue_collision",
        themes: ["SASE", "BLOG"],
        hue: "orange",
        days_together: 6,
        suggest: { name: "BLOG", hue: "red" },
      },
    ],
    renamed_reappeared: ["FIXES"],
    warnings: [],
    ...overrides,
  };
}

function dryRunReport(overrides = {}) {
  return {
    schema_version: 1,
    ok: true,
    mode: "dry_run",
    changed: true,
    from: { key: "fixes", name: "FIXES" },
    to: { key: "fix", name: "FIX" },
    merge: false,
    entries: 3,
    files: [
      {
        path: "2026/20261020.md",
        entries: 2,
        tails: [{ before: "FIXES", after: "FIX" }],
      },
      {
        path: "2026/20261021.md",
        entries: 1,
        tails: [{ before: "FIXES + JOB", after: "FIX + JOB" }],
      },
    ],
    state: { hidden_before: false, hidden_after: false, moved: false, note: "FIXES is not hidden" },
    color: { before: "blue", before_source: "hash", after: "red", after_source: "pin", note: "color blue → red with FIX" },
    commit: null,
    sync: { pre: "skipped", post: "skipped" },
    warnings: [],
    ...overrides,
  };
}

function createManagerThemesApi(report) {
  const data = JSON.parse(JSON.stringify(report));
  const writes = [];
  const listeners = new Set();
  const byKey = () => new Map(data.themes.map((entry) => [entry.key, entry]));
  return {
    version: 1,
    writes,
    available: () => ({ available: true }),
    fetch: () => Promise.resolve({ report: data, stale: false, error: null }),
    snapshot: () => data,
    componentsOf: (name) =>
      String(name || "")
        .split("+")
        .map((raw) => raw.trim())
        .filter(Boolean)
        .map((raw) => ({ raw, key: raw.toLowerCase().replace(/\s+/g, " ") })),
    hueFor: (key) => {
      const entry = byKey().get(key);
      return entry ? { hue: entry.hue, hue_source: entry.hue_source } : { hue: null, hue_source: "hash" };
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hide: (name) => {
      writes.push(["hide", name]);
      const entry = data.themes.find((row) => row.name === name);
      if (entry) {
        entry.hidden = true;
      }
      return Promise.resolve({ ok: true });
    },
    unhide: (name) => {
      writes.push(["unhide", name]);
      const entry = data.themes.find((row) => row.name === name);
      if (entry) {
        entry.hidden = false;
      }
      return Promise.resolve({ ok: true });
    },
    color: (name, hue) => {
      writes.push(["color", name, hue]);
      return Promise.resolve({ ok: true });
    },
    rename: (from, to, options = {}) => {
      writes.push(["rename", from, to, options]);
      if (options.dryRun === true) {
        return Promise.resolve({ ok: true, report: dryRunReport() });
      }
      return Promise.resolve({ ok: true, report: { renamed: [from, to] } });
    },
  };
}

function managerApp(themesApi, vault) {
  return {
    plugins: { plugins: { "bob-ledger-tools": { api: { themes: themesApi } } } },
    vault: vault || { getMarkdownFiles: () => [] },
    workspace: {},
  };
}

test("manager relative dates label today, yesterday, and older days", () => {
  const { formatPomodoroThemeManagerRelative } = helpers;
  assert.equal(formatPomodoroThemeManagerRelative("2026-10-24", "2026-10-24"), "today");
  assert.equal(formatPomodoroThemeManagerRelative("2026-10-23", "2026-10-24"), "yesterday");
  assert.equal(formatPomodoroThemeManagerRelative("2026-10-21", "2026-10-24"), "3 days ago");
  assert.equal(formatPomodoroThemeManagerRelative("2026-10-21", "2026-11-24"), "Oct 21");
  assert.equal(formatPomodoroThemeManagerRelative("2025-10-21", "2026-11-24"), "Oct 21 2025");
  assert.equal(formatPomodoroThemeManagerRelative("not-a-date", "2026-10-24"), "unknown");
});

test("manager duplicate pairs follow the near-duplicate rule", () => {
  const { pomodoroThemesManagerDuplicatePairs } = helpers;
  const themes = [
    { key: "fix", name: "FIX" },
    { key: "fixes", name: "FIXES" },
    { key: "tool", name: "TOOL" },
    { key: "tools", name: "TOOLS" },
    { key: "sase v18", name: "SASE V18" },
    { key: "sase-v18", name: "SASE-V18" },
    { key: "bob", name: "BOB" },
    { key: "job", name: "JOB" },
    { key: "ab", name: "AB" },
    { key: "ac", name: "AC" },
  ];
  const pairs = pomodoroThemesManagerDuplicatePairs(themes).map((pair) => [pair.a.key, pair.b.key].sort().join("|"));
  assert.ok(pairs.includes("fix|fixes"), "plural s qualifies");
  assert.ok(pairs.includes("tool|tools"), "plural s qualifies");
  assert.ok(pairs.includes("sase v18|sase-v18"), "punctuation-insensitive equality qualifies");
  assert.ok(!pairs.includes("bob|job"), "unrelated names stay apart");
  assert.ok(!pairs.includes("ab|ac"), "short keys skip the Levenshtein branch");
});

test("manager rows separate views, hints, and reappeared flags", () => {
  const { buildPomodoroThemesManagerRows } = helpers;
  const report = managerReport();
  const active = buildPomodoroThemesManagerRows(report, "active");
  assert.equal(active[0].kind, "hint");
  assert.match(active[0].title, /SASE and BLOG share orange/);
  const activeNames = active.filter((row) => row.kind === "theme").map((row) => row.theme.name);
  assert.deepEqual(activeNames, ["BOB", "JOB", "FIXES", "FIX"]);
  const fixes = active.find((row) => row.kind === "theme" && row.theme.key === "fixes");
  assert.ok(fixes.badges.includes("reappeared"), "renamed-reappeared names are flagged");
  assert.ok(active.find((row) => row.kind === "theme").badges.includes("today"));

  const hidden = buildPomodoroThemesManagerRows(report, "hidden");
  assert.deepEqual(
    hidden.filter((row) => row.kind === "theme").map((row) => row.theme.name),
    ["BOOKS"],
  );

  const duplicates = buildPomodoroThemesManagerRows(report, "duplicates");
  assert.deepEqual(
    duplicates.filter((row) => row.kind === "theme").map((row) => row.theme.name),
    ["FIXES", "FIX"],
    "only FIX/FIXES-adjacent themes land in duplicates",
  );

  const all = buildPomodoroThemesManagerRows(report, "all");
  assert.equal(all.filter((row) => row.kind === "theme").length, 5);

  const filtered = helpers.filterPomodoroThemesManagerRows(all, "bo");
  assert.deepEqual(
    filtered.filter((row) => row.kind === "theme").map((row) => row.theme.name).sort(),
    ["BOB", "BOOKS"],
  );
});

test("manager rename input rejects empty names and composites", () => {
  const { pomodoroThemesManagerRenameInputError } = helpers;
  assert.equal(pomodoroThemesManagerRenameInputError("fix"), null);
  assert.match(pomodoroThemesManagerRenameInputError(""), /empty/i);
  assert.match(pomodoroThemesManagerRenameInputError("A+B"), /without \+/);
});

test("manager rename preview formats files, entries, and state notes", () => {
  const { formatPomodoroThemeManagerRenamePreview } = helpers;
  const preview = formatPomodoroThemeManagerRenamePreview({ report: dryRunReport() });
  assert.equal(preview.title, "FIXES → FIX · 3 entries in 2 notes");
  assert.equal(preview.lines.length, 2);
  assert.match(preview.lines[0], /2026\/20261020\.md · 2 entries · FIXES → FIX/);
  assert.match(preview.lines[1], /FIXES \+ JOB → FIX \+ JOB/);
  assert.match(preview.stateNote, /not hidden/);
  assert.match(preview.colorNote, /blue → red/);
  const bare = formatPomodoroThemeManagerRenamePreview(dryRunReport());
  assert.equal(bare.title, preview.title, "bare reports preview without the wrapper");
});

test("manager occurrences scan skips fences and non-Pomodoro bullets", () => {
  const { collectPomodoroThemeOccurrencesInText } = helpers;
  const content = [
    "## Pomodoros",
    "- [ ] 09:00–09:25 — FIXES + JOB",
    "- [ ] 10:00–10:25 — fixes",
    "- [ ] #task not a pomodoro — FIXES",
    "```",
    "- [ ] 11:00–11:25 — FIXES",
    "```",
    "- [ ] 12:00–12:25 — UNRELATED",
  ].join("\n");
  const rows = collectPomodoroThemeOccurrencesInText("2026/20261020.md", content, "fixes");
  assert.deepEqual(
    rows.map((row) => row.line),
    [1, 2],
  );
  assert.equal(rows[0].tail, "FIXES + JOB");
  assert.deepEqual(collectPomodoroThemeOccurrencesInText("2026/20261020.md", content, ""), []);
  assert.equal(helpers.isPomodoroThemeManagerDailyPath("2026/20261020.md"), true);
  assert.equal(helpers.isPomodoroThemeManagerDailyPath("_templates/daily.md"), true);
  assert.equal(helpers.isPomodoroThemeManagerDailyPath("notes/random.md"), false);
});

test("manager opens, cycles views, filters, and hides through the stubbed api", async () => {
  notices.length = 0;
  const api = createManagerThemesApi(managerReport());
  const harness = createPomodoroMovePickerHarness({ app: managerApp(api) });
  assert.equal(harness.plugin.openPomodoroThemesManager(), true);
  const picker = helpers.PomodoroThemesManagerModal
    ? new helpers.PomodoroThemesManagerModal(harness.plugin.app, harness.plugin)
    : null;
  assert.ok(picker, "manager modal is exported");
  picker.open();
  await tick();
  await tick();
  assert.ok(picker.items.some((row) => row.kind === "hint"), "collision hints render on top");
  assert.ok(picker.items.some((row) => row.kind === "theme" && row.theme.name === "BOB"));

  picker.cycleManagerView();
  assert.equal(picker.managerView, "hidden");
  assert.deepEqual(
    picker.items.filter((row) => row.kind === "theme").map((row) => row.theme.name),
    ["BOOKS"],
  );
  picker.cycleManagerView();
  assert.equal(picker.managerView, "duplicates");
  picker.cycleManagerView();
  assert.equal(picker.managerView, "all");
  assert.equal(picker.items.filter((row) => row.kind === "theme").length, 5);
  picker.cycleManagerView();
  assert.equal(picker.managerView, "active");

  picker.inputEl.value = "job";
  picker.renderResults();
  assert.deepEqual(
    picker.visibleItems.filter((row) => row.kind === "theme").map((row) => row.theme.name),
    ["JOB"],
  );
  picker.inputEl.value = "";
  picker.renderResults();

  const job = picker.visibleItems.find((row) => row.kind === "theme" && row.theme.name === "JOB");
  picker.selectedIndex = picker.visibleItems.indexOf(job);
  picker.handleKeydown({ key: "Tab", preventDefault() {}, stopPropagation() {} });
  assert.equal(picker.managerView, "hidden");
  picker.handleKeydown({ key: "Tab", preventDefault() {}, stopPropagation() {} });
  assert.equal(picker.managerView, "duplicates");

  const event = { key: "d", ctrlKey: true, altKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} };
  const fixes = picker.items.find((row) => row.kind === "theme" && row.theme.name === "FIXES");
  await picker.toggleThemeRowVisibility(fixes);
  assert.deepEqual(api.writes, [["hide", "FIXES"]]);
  picker.close();
});

test("manager refuses without the desktop api", () => {
  notices.length = 0;
  const harness = createPomodoroMovePickerHarness({ app: { plugins: { plugins: {} } } });
  assert.equal(harness.plugin.openPomodoroThemesManager(), false);
  assert.match(notices.at(-1), /desktop/);
});

test("color modal pins hues and Auto through the stubbed api", async () => {
  notices.length = 0;
  const api = createManagerThemesApi(managerReport());
  const app = managerApp(api);
  const manager = { app, themesApi: api, refreshManagerReport: async () => {} };
  const modal = new helpers.PomodoroThemeColorModal(app, manager, themeRow());
  modal.open();
  assert.equal(modal.items.length, 9, "eight hues plus Auto");
  modal.inputEl.value = "";
  modal.handleKeydown({ key: "1", ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.deepEqual(api.writes, [["color", "BOB", "blue"]]);
  assert.match(notices.at(-1), /wears blue/);

  modal.inputEl.value = "re";
  modal.handleKeydown({ key: "1", ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.equal(api.writes.length, 1, "number keys type while filtering");
  modal.close();
});

test("action modal jumps to actions with single keys when the filter is empty", async () => {
  const calls = [];
  const fakeManager = {
    openThemeRename: (row) => calls.push(["rename", row.theme.name]),
    openThemeColor: (row) => calls.push(["color", row.theme.name]),
    toggleThemeRowVisibility: (row) => calls.push(["hide", row.theme.name]),
    openThemeOccurrences: (row) => calls.push(["occurrences", row.theme.name]),
  };
  const app = managerApp(createManagerThemesApi(managerReport()));
  const themeRowModel = { kind: "theme", key: "theme-bob", theme: themeRow(), badges: [] };
  const modal = new helpers.PomodoroThemeActionModal(app, fakeManager, themeRowModel);
  modal.open();
  modal.inputEl.value = "";
  modal.handleKeydown({ key: "r", ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.deepEqual(calls, [["rename", "BOB"]]);
  modal.inputEl.value = "re";
  modal.handleKeydown({ key: "c", ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.equal(calls.length, 1, "shortcut keys type while filtering");
  modal.close();
});

test("rename modal previews the dry run and applies one merge commit", async () => {
  notices.length = 0;
  const api = createManagerThemesApi(managerReport());
  const app = managerApp(api);
  const refreshed = [];
  const manager = { app, themesApi: api, refreshManagerReport: async () => refreshed.push(true) };
  const modal = new helpers.PomodoroThemeRenameModal(app, manager, themeRow({ key: "fixes", name: "FIXES" }));
  modal.open();
  modal.nameInput.value = "";
  await modal.previewRename();
  assert.match(modal.renameError, /empty/i);

  modal.nameInput.value = "A+B";
  await modal.previewRename();
  assert.match(modal.renameError, /without \+/);

  modal.nameInput.value = "fix";
  const preview = await modal.previewRename();
  assert.equal(preview.title, "FIXES → FIX · 3 entries in 2 notes");
  assert.match(textOf(modal.previewEl), /2026\/20261020\.md/);

  modal.mergeToggle.checked = true;
  await modal.applyRename();
  assert.ok(api.writes.some((write) => write[0] === "rename" && write[3] && write[3].merge === true), "apply passes --merge");
  assert.match(notices.at(-1), /Renamed FIXES → FIX in 2 notes · one commit/);
  assert.equal(refreshed.length, 1);
});

test("rename apply saves touched notes and refuses on a failed save", async () => {
  notices.length = 0;
  const api = createManagerThemesApi(managerReport());
  const saved = [];
  const failingView = { file: { path: "2026/20261021.md" }, save: async () => { throw new Error("locked"); } };
  const okView = { file: { path: "2026/20261020.md" }, save: async () => saved.push("2026/20261020.md") };
  const app = managerApp(api);
  app.workspace = {
    iterateAllLeaves: (callback) => [{ view: okView }, { view: failingView }].forEach(callback),
  };
  const manager = { app, themesApi: api, refreshManagerReport: async () => {} };
  const modal = new helpers.PomodoroThemeRenameModal(app, manager, themeRow({ key: "fixes", name: "FIXES" }));
  modal.open();
  modal.nameInput.value = "fix";
  await modal.previewRename();
  await modal.applyRename();
  assert.match(notices.at(-1), /Save the listed notes first/);
  assert.ok(!api.writes.some((write) => write[0] === "rename" && write[3].merge !== undefined && !write[3].dryRun), "no write follows a refused save");
});

test("occurrences modal lists daily notes and opens the entry", async () => {
  const files = [
    { path: "2026/20261020.md", basename: "20261020" },
    { path: "2026/20261021.md", basename: "20261021" },
    { path: "notes/random.md", basename: "random" },
  ];
  const bodies = {
    "2026/20261020.md": ["## Pomodoros", "- [ ] 09:00–09:25 — FIXES + JOB"].join("\n"),
    "2026/20261021.md": ["## Pomodoros", "- [ ] 10:00–10:25 — fixes"].join("\n"),
    "notes/random.md": ["- [ ] — FIXES"].join("\n"),
  };
  const vault = {
    getMarkdownFiles: () => files,
    cachedRead: async (file) => bodies[file.path] || "",
  };
  const opened = [];
  const plugin = { app: managerApp(createManagerThemesApi(managerReport()), vault) };
  const modal = new helpers.PomodoroThemeOccurrencesModal(
    plugin.app,
    plugin,
    themeRow({ key: "fixes", name: "FIXES" }),
    { opener: async (row) => opened.push(row) },
  );
  modal.open();
  await tick();
  await tick();
  assert.equal(modal.items.length, 2, "only canonical daily notes are scanned");
  assert.equal(modal.items[0].path, "2026/20261021.md", "newest first");
  assert.equal(modal.items[0].line, 1);
  modal.selectedIndex = 0;
  await modal.openOccurrence(modal.items[0]);
  assert.deepEqual(opened.map((row) => row.path), ["2026/20261021.md"]);
  modal.close();
});
