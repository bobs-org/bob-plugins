// api.navGroups v1: calendar group and step stops, pre-adoption ghosts,
// adopted-year cache invalidation, and periodNotes v2 ensure refusal.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
}

const originalLoad = Module._load;
Module._load = function loadObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      Notice: class { constructor() {} },
      Platform: { isDesktopApp: false },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {}, keymap: { of: (value) => value } };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let LedgerToolsPlugin;
try {
  LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
} finally {
  Module._load = originalLoad;
}

const {
  navGroupsCalendarResolve,
  navGroupsAdoptedIsoYearsFromFiles,
  navGroupsIsPreAdoption,
  navGroupsPathInBounds,
  navGroupsWeekNoteIsoYear,
  NAV_GROUPS_API_VERSION,
} = LedgerToolsPlugin.helpers;

const TODAY = "2026-11-21";

function file(path) {
  return { path };
}

function adopted2026And2027() {
  const files = { "all_time.md": file("all_time.md") };
  for (const year of [2024, 2025, 2026, 2027]) files[`${year}.md`] = file(`${year}.md`);
  for (let week = 1; week <= 48; week += 1) {
    const id = "2026-W" + String(week).padStart(2, "0");
    files[`2026/${id}.md`] = file(`2026/${id}.md`);
  }
  for (let quarter = 1; quarter <= 4; quarter += 1) {
    files[`2026/2026-Q${quarter}.md`] = file(`2026/2026-Q${quarter}.md`);
  }
  files["2027/2027-W01.md"] = file("2027/2027-W01.md");
  files["2027/2027-W02.md"] = file("2027/2027-W02.md");
  files["2027/2027-Q1.md"] = file("2027/2027-Q1.md");
  files["2026/20261109.md"] = file("2026/20261109.md");
  files["2026/20261121.md"] = file("2026/20261121.md");
  return files;
}

function makeHarness({ vaultPaths = adopted2026And2027() } = {}) {
  const vaultFiles = new Map(Object.entries(vaultPaths));
  const callbacks = {};
  const layoutReadyCallbacks = [];
  const app = {
    workspace: {
      onLayoutReady(callback) {
        layoutReadyCallbacks.push(callback);
      },
    },
    vault: {
      getAbstractFileByPath: (path) => vaultFiles.get(path) || null,
      getMarkdownFiles: () => [...vaultFiles.keys()].map((path) => ({ path })),
      on(event, callback) {
        callbacks[event] = callback;
        return { event, callback };
      },
    },
  };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = app;
  plugin.addCommand = () => {};
  plugin.registerEvent = (reference) => reference;
  plugin.navGroupsTodayOverride = TODAY;
  plugin.setupNavGroups();
  return {
    plugin,
    app,
    vaultFiles,
    callbacks,
    fireLayoutReady: () => {
      for (const callback of layoutReadyCallbacks.splice(0)) callback();
    },
  };
}

function resolve(path, vaultPaths) {
  const files = vaultPaths || adopted2026And2027();
  const adopted = navGroupsAdoptedIsoYearsFromFiles(Object.keys(files));
  return navGroupsCalendarResolve(path, {
    today: TODAY,
    vaultHas: (candidate) => Object.prototype.hasOwnProperty.call(files, candidate),
    adoptedYears: adopted,
  });
}

test("week note paths identify adopted ISO years", () => {
  assert.equal(navGroupsWeekNoteIsoYear("2026/2026-W01.md"), 2026);
  assert.equal(navGroupsWeekNoteIsoYear("2025/2026-W01.md"), null);
  assert.equal(navGroupsWeekNoteIsoYear("2026/20261121.md"), null);
  const years = navGroupsAdoptedIsoYearsFromFiles([
    "2026/2026-W01.md",
    "2027/2027-W01.md",
    "2026/20261121.md",
  ]);
  assert.equal(years.has(2026), true);
  assert.equal(years.has(2027), true);
  assert.equal(years.has(2025), false);
  assert.equal(navGroupsPathInBounds("1969/1969-W40.md"), false);
  assert.equal(navGroupsPathInBounds("1970/1970-W01.md"), true);
  assert.equal(navGroupsPathInBounds("2999/2999-Q4.md"), true);
  assert.equal(navGroupsPathInBounds("3000.md"), false);
});

test("the contract's worked examples land on the first member of the adjacent group", () => {
  const w30 = resolve("2026/2026-W30.md");
  assert.equal(w30.ok, true);
  assert.equal(w30.route, "calendar");
  assert.equal(w30.kind, "week");
  assert.equal(w30.prevGroup.path, "2026/2026-W14.md");
  assert.equal(w30.prevGroup.target, "2026/2026-W14");
  assert.equal(w30.prevGroup.groupLabel, "Q2");
  assert.equal(w30.prevGroup.landingLabel, "W14");
  assert.equal(w30.prevGroup.state, "exists");
  assert.equal(w30.prevGroup.source, "calendar");
  assert.equal(w30.prevGroup.wraps, false);
  assert.equal(w30.nextGroup.path, "2026/2026-W40.md");
  assert.equal(w30.nextGroup.groupLabel, "Q4");
  assert.equal(w30.nextGroup.landingLabel, "W40");
  assert.equal(w30.nextGroup.state, "exists");
  assert.equal(w30.group.noun, "week");
  assert.equal(w30.group.label, "Q3");
  assert.equal(w30.group.position, 4);
  assert.equal(w30.group.size, 13);
  assert.equal(w30.group.members.length, 13);

  const w47 = resolve("2026/2026-W47.md");
  assert.equal(w47.prevGroup.path, "2026/2026-W27.md");
  assert.equal(w47.prevGroup.groupLabel, "Q3");
  assert.equal(w47.nextGroup.path, "2027/2027-W01.md");
  assert.equal(w47.nextGroup.groupLabel, "2027-Q1");
  assert.equal(w47.nextGroup.landingLabel, "W01");
  assert.equal(w47.nextGroup.shortLabel, "2027-Q1");
  assert.equal(w47.nextGroup.state, "exists");
  assert.equal(w47.group.position, 8);
  assert.equal(w47.group.size, 14);
  assert.equal(w47.group.members.length, 14);

  const w01 = resolve("2026/2026-W01.md");
  assert.equal(w01.prevGroup.path, "2025/2025-W40.md");
  assert.equal(w01.prevGroup.groupLabel, "2025-Q4");
  assert.equal(w01.prevGroup.landingLabel, "W40");
  assert.equal(w01.prevGroup.state, "ghost");
  assert.match(w01.prevGroup.ghostReason, /2025-W40/);
  assert.equal(w01.nextGroup.path, "2026/2026-W14.md");
  assert.equal(w01.nextGroup.state, "exists");

  const q4 = resolve("2026/2026-Q4.md");
  assert.equal(q4.kind, "quarter");
  assert.equal(q4.prevGroup.path, "2025/2025-Q1.md");
  assert.equal(q4.prevGroup.groupLabel, "2025");
  assert.equal(q4.prevGroup.landingLabel, "Q1");
  assert.equal(q4.prevGroup.state, "ghost");
  assert.match(q4.prevGroup.ghostReason, /2025-Q1/);
  assert.equal(q4.nextGroup.path, "2027/2027-Q1.md");
  assert.equal(q4.nextGroup.groupLabel, "2027");
  assert.equal(q4.nextGroup.landingLabel, "Q1");
  assert.equal(q4.nextGroup.state, "exists");
  assert.equal(q4.group.noun, "quarter");
  assert.equal(q4.group.label, "2026");
  assert.equal(q4.group.position, 4);
  assert.equal(q4.group.size, 4);
  assert.equal(q4.group.members.length, 4);

  const saturday = resolve("2026/20261121.md");
  assert.equal(saturday.kind, "day");
  assert.equal(saturday.prevGroup.path, "2026/20261109.md");
  assert.equal(saturday.prevGroup.groupLabel, "W46");
  assert.equal(saturday.prevGroup.landingLabel, "Mon Nov 9");
  assert.equal(saturday.prevGroup.state, "exists");
  assert.equal(saturday.nextGroup.path, "2026/20261123.md");
  assert.equal(saturday.nextGroup.groupLabel, "W48");
  assert.equal(saturday.nextGroup.landingLabel, "Mon Nov 23");
  assert.equal(saturday.nextGroup.state, "creatable");
  assert.equal(saturday.group.noun, "day");
  assert.equal(saturday.group.label, "W47");
  assert.equal(saturday.group.position, 6);
  assert.equal(saturday.group.size, 7);
  assert.equal(saturday.group.members.length, 7);
  assert.equal(saturday.group.atEnd, false);
  assert.equal(saturday.step.parent.path, "2026/2026-W47.md");

  const w53day = resolve("2026/20261231.md");
  assert.equal(w53day.prevGroup.path, "2026/20261221.md");
  assert.equal(w53day.prevGroup.landingLabel, "Mon Dec 21");
  assert.equal(w53day.prevGroup.state, "creatable");
  assert.equal(w53day.nextGroup.path, "2027/20270104.md");
  assert.equal(w53day.nextGroup.landingLabel, "Mon Jan 4");
  assert.equal(w53day.nextGroup.groupLabel, "2027-W01");
  assert.equal(w53day.nextGroup.state, "creatable");
  assert.equal(w53day.group.label, "W53");
  assert.equal(w53day.group.size, 7);

  const w01monday = resolve("2025/20251229.md");
  assert.equal(w01monday.kind, "day");
  assert.equal(w01monday.group.label, "W01");
  assert.equal(w01monday.prevGroup.path, "2025/20251222.md");
  assert.equal(w01monday.prevGroup.state, "ghost");
  assert.equal(w01monday.nextGroup.path, "2026/20260105.md");
  assert.equal(w01monday.nextGroup.state, "creatable");
  const memberPaths = w01monday.group.members.map((member) => member.path);
  assert.equal(memberPaths[0], "2025/20251229.md");
  assert.equal(memberPaths[3], "2026/20260101.md");
});

test("Q4 of a 53-week year has 14 week members and W53 is in bounds", () => {
  const w53 = resolve("2026/2026-W53.md");
  assert.equal(w53.ok, true);
  assert.equal(w53.kind, "week");
  assert.equal(w53.group.size, 14);
  assert.equal(w53.group.position, 14);
  assert.equal(w53.group.atEnd, true);
  assert.equal(w53.group.members[13].path, "2026/2026-W53.md");
  assert.equal(w53.group.members[13].state, "current");
  assert.equal(w53.prevGroup.path, "2026/2026-W27.md");
  assert.equal(w53.nextGroup.path, "2027/2027-W01.md");
});

test("year and all_time notes have no group jump", () => {
  const year = resolve("2026.md");
  assert.equal(year.route, "calendar");
  assert.equal(year.kind, "year");
  assert.equal(year.group, null);
  assert.equal(year.prevGroup, null);
  assert.equal(year.nextGroup, null);
  assert.equal(year.none.message, "Years have no group jump — ]n steps years");
  assert.equal(year.step.prev.path, "2025.md");
  assert.equal(year.step.next.path, "2027.md");
  assert.equal(year.step.parent.path, "all_time.md");
  assert.equal(year.step.parent.state, "exists");

  const all = resolve("all_time.md");
  assert.equal(all.kind, "all");
  assert.equal(all.none.message, "All time has no group jump");
  assert.equal(all.step.prev, null);
  assert.equal(all.step.next, null);
  assert.equal(all.step.parent, null);
});

test("1970 and 2999 bounds return null stops and never throw", () => {
  const early = navGroupsCalendarResolve("1970/1970-W01.md", {
    today: TODAY,
    vaultHas: () => false,
    adoptedYears: new Set(),
  });
  assert.equal(early.ok, true);
  assert.equal(early.prevGroup, null);
  const late = navGroupsCalendarResolve("2999/2999-Q4.md", {
    today: TODAY,
    vaultHas: () => false,
    adoptedYears: new Set([2999]),
  });
  assert.equal(late.ok, true);
  assert.equal(late.nextGroup, null);
  assert.doesNotThrow(() => navGroupsCalendarResolve("1969/1969-W40.md", {
    today: TODAY,
    vaultHas: () => false,
    adoptedYears: new Set(),
  }));
});

test("missing dailies in adopted years and the future are creatable; pre-adoption is ghost", () => {
  const futureMonday = resolve("2026/20261121.md").nextGroup;
  assert.equal(futureMonday.state, "creatable");
  const pastUnadopted = resolve("2026/2026-W01.md").prevGroup;
  assert.equal(pastUnadopted.state, "ghost");
  const pastAdoptedDaily = resolve("2026/20261231.md").prevGroup;
  assert.equal(pastAdoptedDaily.state, "creatable");
  assert.equal(navGroupsIsPreAdoption("2025-10-05", 2025, TODAY, new Set()), true);
  assert.equal(navGroupsIsPreAdoption("2025-10-05", 2025, TODAY, new Set([2025])), false);
  assert.equal(navGroupsIsPreAdoption("2027-01-04", 2027, TODAY, new Set()), false);
});

test("derived step stops fill in prev, next, and parent on calendar notes", () => {
  const saturday = resolve("2026/20261121.md");
  assert.equal(saturday.step.prev.path, "2026/20261120.md");
  assert.equal(saturday.step.next.path, "2026/20261122.md");
  assert.equal(saturday.step.parent.path, "2026/2026-W47.md");
  assert.equal(saturday.step.next.state, "creatable");
  const week = resolve("2026/2026-W30.md");
  assert.equal(week.step.prev.path, "2026/2026-W29.md");
  assert.equal(week.step.next.path, "2026/2026-W31.md");
  assert.equal(week.step.parent.path, "2026/2026-Q3.md");
});

test("non-calendar paths and bad input do not throw", () => {
  const note = resolve("Notes/idea.md");
  assert.equal(note.ok, true);
  assert.equal(note.route, null);
  assert.equal(note.kind, null);
  const record = resolve("eat/place.md");
  assert.equal(record.route, null);
  const harnessed = makeHarness();
  const api = harnessed.plugin.navGroupsApi();
  assert.equal(api.version, NAV_GROUPS_API_VERSION);
  assert.equal(api.resolve(null).reason, "invalid-input");
  assert.equal(api.resolve("2026/2026-W30.md").reason, "invalid-input");
  assert.equal(api.resolve({}).reason, "invalid-input");
  const ok = api.resolve({ path: "2026/2026-W30.md", content: "ignored" });
  assert.equal(ok.ok, true);
  assert.equal(ok.prevGroup.path, "2026/2026-W14.md");
  assert.doesNotThrow(() => api.resolve({ path: "///" }));
});

test("the adopted-year cache invalidates on week-note create, delete, and rename", () => {
  const harnessed = makeHarness();
  harnessed.fireLayoutReady();
  const before = harnessed.plugin.navGroupsResolve({ path: "2026/2026-W01.md" });
  assert.equal(before.prevGroup.state, "ghost");
  harnessed.vaultFiles.set("2025/2025-W01.md", file("2025/2025-W01.md"));
  harnessed.callbacks.create({ path: "2025/2025-W01.md" });
  const afterCreate = harnessed.plugin.navGroupsResolve({ path: "2026/2026-W01.md" });
  assert.equal(afterCreate.prevGroup.state, "creatable");
  harnessed.vaultFiles.delete("2025/2025-W01.md");
  harnessed.callbacks.delete({ path: "2025/2025-W01.md" });
  const afterDelete = harnessed.plugin.navGroupsResolve({ path: "2026/2026-W01.md" });
  assert.equal(afterDelete.prevGroup.state, "ghost");
  harnessed.vaultFiles.set("2025/2025-W01.md", file("2025/2025-W01.md"));
  harnessed.callbacks.rename({ path: "2025/2025-W01.md" }, "scratch.md");
  const afterRenameIn = harnessed.plugin.navGroupsResolve({ path: "2026/2026-W01.md" });
  assert.equal(afterRenameIn.prevGroup.state, "creatable");
  harnessed.vaultFiles.delete("2025/2025-W01.md");
  harnessed.callbacks.rename({ path: "scratch.md" }, "2025/2025-W01.md");
  const afterRenameOut = harnessed.plugin.navGroupsResolve({ path: "2026/2026-W01.md" });
  assert.equal(afterRenameOut.prevGroup.state, "ghost");
  harnessed.callbacks.create({ path: "2026/20261122.md" });
  assert.equal(
    harnessed.plugin.navGroupsResolve({ path: "2026/2026-W01.md" }).prevGroup.state,
    "ghost",
    "daily create does not adopt a year",
  );
});

test("api.periodNotes v2 refuses pre-adoption past targets and still creates current ones", async () => {
  const harnessed = makeHarness();
  const spawns = [];
  harnessed.plugin.periodNotesRunSpawn = async (args) => {
    spawns.push(args.slice());
    const path = args.includes("-d") ? "created" : "created";
    void path;
    if (args.includes("2025-09-29") || String(args).includes("2025")) {
      harnessed.vaultFiles.set("2025/2025-W40.md", file("2025/2025-W40.md"));
    }
    if (args.includes("2027-01-04")) {
      harnessed.vaultFiles.set("2027.md", file("2027.md"));
    }
    return {
      ok: true,
      report: { ok: true, schema_version: 1, created: [], filled: [], existing: [], dry_run: false },
    };
  };
  const api = harnessed.plugin.periodNotesApi();
  assert.equal(api.version, 2);
  const refused = await api.ensureNote("2025/2025-W40.md");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "pre-adoption");
  assert.match(refused.message, /2025-W40/);
  assert.equal(spawns.length, 0);
  const allowed = await api.ensureNote("2025/2025-W40.md", { allowPreAdoption: true, waitMs: 0 });
  assert.equal(allowed.ok, true);
  assert.equal(spawns.length, 1);
  const current = await api.ensureNote("2027.md", { waitMs: 0 });
  assert.equal(current.ok, true);
});
