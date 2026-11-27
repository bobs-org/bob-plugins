#!/usr/bin/env node
"use strict";
// Group-rail preview matrix (bob-cli-oj rail-proof). Builds every fixture
// with the REAL Ledger Tools builders from the generated bundle — day and
// period cards through intentionCardModelFor + intentionCardBuildDom (so the
// card carries a real `navRail`), record cards through recordWalkFor +
// recordSheetBuildMounted (a real `groupRail`), and the album card through
// albumHeaderBuildEl — then renders them inside Obsidian's own Electron with
// Obsidian's own app.css (fetched from the running app; the 2.1.2 baseline
// palette is the fallback) and the committed styles.css. Light and dark at a
// 375px content width and wide, plus grayscale and real `forced-colors:
// active` emulation, for every fixture. Writes PNGs, manifest.json,
// contrast.json, contrast.md, and index.html. Run under xvfb-run -a.
// The group row is the decluttered one (bob-cli-oj.5.1 landing): skip-mark
// arms with the group name only, a track-only centre (none for a
// one-member group), and underlined (not boxed) creatable and ghost arms.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const {
  previewDocument, serialize, CdpClient, freePort, cdpTarget, sleep, sha256,
} = require("./preview-property-cards.cjs");
const baseline = require("./preview-obsidian-baseline.cjs");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN_CSS = path.join(ROOT, "plugins/bob-ledger-tools/styles.css");
const DEFAULT_OBSIDIAN = "/snap/obsidian/current/app/obsidian";
const NARROW = 375;
const WIDE = 760;
const PAGE_PAD = 24;
const HELP = [
  "Usage: node scripts/preview-group-rail.cjs [OPTIONS]",
  "",
  "Render the group-rail fixtures (day, week, quarter, year, legacy daily,",
  "grouped zettel records, single-group album, album walks-by pill) with the",
  "real Ledger Tools builders in light/dark x 375px/wide content, plus",
  "grayscale and forced-colors. Run under xvfb-run -a.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron binary",
  "  -o, --out DIRECTORY     Save screenshots, manifest.json, contrast, index.html",
  "      --only NAME         Render one fixture (repeatable)",
  "  -s, --self-test         Build and check every fixture offline; no Electron",
  "  -h, --help              Print this help",
].join("\n");

function parseArgs(argv) {
  const args = { executable: DEFAULT_OBSIDIAN, out: null, help: false, selfTest: false, only: [] };
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i += 1) {
    const v = list[i];
    const value = () => {
      const next = list[++i];
      if (next === undefined) throw new Error(`${v} requires a value`);
      return next;
    };
    if (["-h", "--help"].includes(v)) args.help = true;
    else if (["-s", "--self-test"].includes(v)) args.selfTest = true;
    else if (["-e", "--executable"].includes(v)) args.executable = value();
    else if (["-o", "--out"].includes(v)) args.out = value();
    else if (v === "--only") args.only.push(value());
    else throw new Error(`Unknown argument: ${v}`);
  }
  return args;
}

function harness() {
  return require("./ledger-tools-harness.cjs");
}

// The shared preview document plus createElementNS, so the kit's inline SVG
// skip mark serializes into the page exactly as Obsidian draws it.
function groupRailDocument() {
  const doc = previewDocument();
  doc.createElementNS = function createElementNS(_namespace, tag) { return this.createElement(tag); };
  return doc;
}

// ---- Calendar world ---------------------------------------------------------
// The contract's world: today is Saturday 2026-11-21; 2025 has no week notes
// (pre-adoption); 2026-W49–W53 do not exist yet; 2027-W01, 2027-W02, and
// 2027-Q1 exist. Dailies exist for most of W47 and the W30 workweek.

const TODAY = "2026-11-21";
const pad2 = (n) => String(n).padStart(2, "0");

function calendarPaths() {
  const paths = ["all_time.md", "2025.md", "2026.md", "2027.md"];
  for (let week = 1; week <= 48; week += 1) paths.push(`2026/2026-W${pad2(week)}.md`);
  for (let quarter = 1; quarter <= 4; quarter += 1) paths.push(`2026/2026-Q${quarter}.md`);
  paths.push("2027/2027-W01.md", "2027/2027-W02.md", "2027/2027-Q1.md");
  for (const day of [9, 16, 17, 18, 19, 20, 21]) paths.push(`2026/202611${pad2(day)}.md`);
  for (const day of [20, 21, 22, 23, 24]) paths.push(`2026/202607${pad2(day)}.md`);
  paths.push("2026/20261221.md", "2026/20261231.md", "2027/20270104.md", "2025/20251229.md", "2026/20260105.md");
  return paths;
}

function noteText(frontmatter, body) {
  return `---\n${JSON.stringify(frontmatter || {})}\n---\n\n${body || ""}`;
}

function frontmatterOf(source) {
  const match = /^---\n([\s\S]*?)\n---/.exec(String(source || ""));
  try { return match ? JSON.parse(match[1]) : {}; } catch (_) { return {}; }
}

function calendarWorld() {
  const { LedgerToolsPlugin } = harness();
  const files = new Map();
  const disk = new Map();
  const app = {
    vault: {
      getAbstractFileByPath: (p) => files.get(p) || null,
      getMarkdownFiles: () => [...files.values()],
      async read(file) { return disk.get(file.path); },
      async cachedRead(file) { return disk.get(file.path); },
      on: (name) => ({ name }),
    },
    metadataCache: {
      // Metadata agrees with the note's JSON frontmatter, so the card's
      // confirmed-source gate passes exactly as after a vault index.
      getFileCache: (file) => (files.has(file?.path) ? { frontmatter: frontmatterOf(disk.get(file.path)) } : null),
      getFirstLinkpathDest: (target) => files.get(`${String(target).replace(/\.md$/i, "")}.md`) || null,
      on: () => ({}),
    },
    workspace: {
      leaves: [], getLeavesOfType() { return this.leaves; }, on: () => ({}),
      openLinkText: () => Promise.resolve(), setActiveLeaf() {}, onLayoutReady(fn) { fn(); },
    },
    commands: { commands: {}, executeCommandById: () => true },
    plugins: { plugins: {} },
  };
  for (const p of calendarPaths()) {
    files.set(p, { path: p, extension: "md" });
    disk.set(p, noteText({}, "Body.\n"));
  }
  const plugin = new LedgerToolsPlugin(app);
  plugin.registerMarkdownPostProcessor = () => {};
  plugin.albumSetTimeout = () => 0;
  plugin.albumClearTimeout = () => {};
  plugin.intentionCardToday = () => TODAY;
  plugin.navGroupsTodayOverride = TODAY;
  plugin.intentionCardNotice = () => {};
  // Bob Navigation Hotkeys' walkMode.links v7 over Ledger's own resolver:
  // every step stop is calendar-derived unless the body authors one.
  const walkMode = {
    version: 7,
    links({ path: p, content }) {
      const provider = plugin.navGroupsResolve({ path: p, content });
      if (!provider.ok) return { ok: false };
      const stop = (value) => (value ? { ...value, text: value.landingLabel, exists: value.state === "exists" } : null);
      return {
        ok: true, prev: stop(provider.step?.prev), next: stop(provider.step?.next),
        prevGroup: stop(provider.prevGroup), nextGroup: stop(provider.nextGroup),
        group: provider.group, groupNone: provider.none, groupConflict: null, groupConflicts: [],
      };
    },
  };
  app.plugins.plugins["bob-navigation-hotkeys"] = { api: { version: 3, walkMode } };
  plugin.setupIntentionCard();
  return { app, files, disk, plugin };
}

const DAY_NAV = (prev, week, next) => `[[${prev}|prev]] · [[${week}|${week.slice(-3)}]] · [[${next}|next]]`;
const WEEK_NAV = (week) => `[[2026/2026-W${pad2(week - 1)}|‹ W${pad2(week - 1)}]] · [[2026/2026-Q${Math.ceil(week / 13.5) || 1}|↑ 2026-Q${Math.ceil(week / 13.5) || 1}]] · [[2026/2026-W${pad2(week + 1)}|W${pad2(week + 1)} ›]]`;
const W30_DAYS = [["20260720", "Mon Jul 20"], ["20260721", "Tue 21"], ["20260722", "Wed 22"], ["20260723", "Thu 23"],
  ["20260724", "Fri 24"], ["20260725", "Sat 25"], ["20260726", "Sun 26"]];
const W47_DAYS = [["20261116", "Mon Nov 16"], ["20261117", "Tue 17"], ["20261118", "Wed 18"], ["20261119", "Thu 19"],
  ["20261120", "Fri 20"], ["20261121", "Sat 21"], ["20261122", "Sun 22"]];
const dayChips = (days) => days.map(([id, label]) => `[[2026/${id}|${label}]]`).join(" · ");

const CALENDAR_FIXTURES = [
  {
    name: "day-midweek", path: "2026/20261118.md",
    frontmatter: { intentions: ["Draft the group-rail inspection note"] },
    body: `# 2026-11-18 Wed\n\n${DAY_NAV("2026/20261117", "2026/2026-W47", "2026/20261119")}\n\nNotes.\n`,
    expect: { groupRow: true, prev: "exists", next: "creatable", track: "ticks", derived: false },
  },
  {
    name: "today-creatable-monday", path: "2026/20261121.md",
    frontmatter: { intentions: ["Ship the rail proof", "Leave a clean handoff"] },
    body: `# 2026-11-21 Sat\n\n${DAY_NAV("2026/20261120", "2026/2026-W47", "2026/20261122")}\n\nNotes.\n`,
    expect: { groupRow: true, prev: "exists", next: "creatable", track: "ticks", derived: false, stepNext: "creatable" },
  },
  {
    name: "week-midquarter", path: "2026/2026-W30.md",
    frontmatter: { intentions: ["Hold the line on scope"] },
    body: `# 2026-W30 · Jul 20 – 26\n\n${WEEK_NAV(30).replace(/2026-Q\d/g, "2026-Q3")}\n\n${dayChips(W30_DAYS)}\n`,
    expect: { groupRow: true, prev: "exists", next: "exists", track: "ticks", derived: false },
  },
  {
    name: "week-w47-into-2027", path: "2026/2026-W47.md",
    frontmatter: { intentions: ["Finish the album", "Ship the release train"] },
    body: `# 2026-W47 · Nov 16 – 22\n\n${WEEK_NAV(47).replace(/2026-Q\d/g, "2026-Q4")}\n\n${dayChips(W47_DAYS)}\n`,
    expect: { groupRow: true, prev: "exists", next: "exists", track: "ticks", derived: false },
  },
  {
    name: "week-w01-ghost", path: "2026/2026-W01.md",
    frontmatter: {},
    body: "# 2026-W01 · Dec 29 – Jan 4\n\n[[2025/2025-W52|‹ 2025-W52]] · [[2026/2026-Q1|↑ 2026-Q1]] · [[2026/2026-W02|W02 ›]]\n",
    expect: { groupRow: true, prev: "ghost", next: "exists", track: "ticks", derived: false, stepPrev: "ghost" },
  },
  {
    name: "quarter-q4-ghost", path: "2026/2026-Q4.md",
    frontmatter: { intentions: ["The blog has been released!"] },
    body: "# 2026-Q4 · W40–W53 · Sep 28, 2026 – Jan 3, 2027\n\n[[2026/2026-Q3|‹ Q3]] · [[2026|↑ 2026]] · [[2027/2027-Q1|2027-Q1 ›]]\n\n"
      + Array.from({ length: 14 }, (_, i) => `[[2026/2026-W${40 + i}|W${40 + i}]]`).join(" · ") + "\n",
    expect: { groupRow: true, prev: "ghost", next: "exists", track: "ticks", derived: false },
  },
  {
    name: "year-no-row", path: "2026.md",
    frontmatter: {},
    body: "# 2026 · Dec 29, 2025 – Jan 3, 2027 · 53 weeks\n\n[[2025|‹ 2025]] · [[all_time|↑ All time]] · [[2027|2027 ›]]\n\n"
      + "[[2026/2026-Q1|Q1]] · [[2026/2026-Q2|Q2]] · [[2026/2026-Q3|Q3]] · [[2026/2026-Q4|Q4]]\n",
    expect: { groupRow: false, derived: false },
  },
  {
    name: "legacy-daily-derived", path: "2026/20261116.md",
    frontmatter: {},
    body: "day::2026-11-16 Mon\n\nRelated notes:\n- [[gtd_daily]]\n",
    expect: { groupRow: true, prev: "exists", next: "creatable", track: "ticks", derived: true, stepPrev: "creatable" },
  },
];

function buildCalendarCard(world, fixture, doc) {
  const { helpers: H } = harness();
  const source = noteText(fixture.frontmatter, fixture.body);
  world.disk.set(fixture.path, source);
  if (!world.files.has(fixture.path)) world.files.set(fixture.path, { path: fixture.path, extension: "md" });
  // The host reads confirmed source from its cache; seed it like a vault read.
  const prepared = world.plugin.intentionCardModelFor(fixture.path, source);
  assert.ok(prepared?.model, `${fixture.name}: intentionCardModelFor produced a model`);
  const card = H.intentionCardBuildDom(prepared.model, world.plugin, doc);
  assert.ok(card?.classList?.contains("bob-property-card"), `${fixture.name}: shared card painter ran`);
  return { card, model: prepared.model };
}

// ---- Record world -------------------------------------------------------------

const SECTION_CHOICES = [
  { value: "intro", label: "🛑 Intro" },
  { value: "body", label: "🔮 Future Work" },
  { value: "outro", label: "🏁 Conclusion" },
];
const ZETTEL = [
  { path: "z/alpha.md", title: "Why SASE Exists", section: "intro" },
  { path: "z/beta.md", title: "Beads As Memory", section: "body" },
  { path: "z/delta.md", title: "Delegated Closeouts", section: "body" },
  { path: "z/gamma.md", title: "Group Jumps", section: "body" },
  { path: "z/omega.md", title: "What We Learned", section: "outro" },
  { path: "z/zed.md", title: "Untriaged Thought" },
];

function zettelAlbum(records, walkBy, choices = SECTION_CHOICES) {
  return {
    path: "z.md", stem: "z", title: "SASE Blog Zettel", emoji: "🗂", noun: "zettel",
    singular: "zettel", plural: "zettels", label: "Zettel", records: records.length,
    parent: "writing", owner: "writing", root: "writing", issues: [], legacy: [], index: { state: "current" }, walk: { state: "current" },
    schema_fingerprint: "sha256:group-rail-preview",
    fields: [{ key: "section", label: "Section", kind: "choices", required: false, list: false, choices }],
    ...(walkBy ? { walk_by: walkBy } : {}),
  };
}

function recordWorld(options = {}) {
  const { LedgerToolsPlugin, helpers: H } = harness();
  const records = (options.records || ZETTEL).map((record) => ({ ...record }));
  const walkBy = options.walkBy === undefined ? "section" : options.walkBy;
  const frontmatter = new Map();
  frontmatter.set("z.md", { type: "[[album]]", parent: "[[writing]]", title: "SASE Blog Zettel", emoji: "🗂",
    summary: "Atomic notes that become the SASE blog posts.", ...(walkBy ? { walk_by: walkBy } : {}) });
  frontmatter.set("writing.md", { type: "[[area]]", parent: "[[type]]" });
  frontmatter.set("type.md", { type: "[[type]]" });
  for (const record of records) {
    frontmatter.set(record.path, { type: "[[record]]", parent: "[[z]]", title: record.title, ...(record.section ? { section: record.section } : {}) });
  }
  const files = new Map([...frontmatter.keys()].map((p) => [p, { path: p, extension: "md" }]));
  const hidden = new Set(options.hidden || []);
  const album = zettelAlbum(records, walkBy, options.choices || SECTION_CHOICES);
  const report = H.albumIndexReport({ schema_version: 1, ok: true, albums: [album], catalogs: [], counts: {},
    capabilities: ["record_values_v1", "record_walk_v1", "record_walk_groups_v1"] });
  const sources = new Map();
  const app = {
    vault: {
      getAbstractFileByPath: (p) => (hidden.has(p) ? null : files.get(p) || null),
      getMarkdownFiles: () => [...files.values()],
      cachedRead: async (file) => sources.get(file.path),
    },
    metadataCache: {
      getFileCache: (file) => (frontmatter.has(file?.path) ? { frontmatter: frontmatter.get(file.path) } : null),
      getFirstLinkpathDest: (target) => files.get(`${String(target).replace(/\.md$/i, "")}.md`) || null,
    },
    workspace: { trigger() {}, getLeavesOfType: () => [], getMostRecentLeaf: () => null, setActiveLeaf() {}, openLinkText: async () => {} },
    commands: { commands: {}, executeCommandById: () => true },
    plugins: { plugins: {} },
  };
  const plugin = new LedgerToolsPlugin(app);
  const state = { report, reportGeneration: 1, stale: false };
  plugin.albumReportState = () => state;
  plugin.albumScheduleSync = () => {};
  plugin.scheduleRecordSheetRefresh = () => {};
  plugin.recordSheetSourceCache = sources;
  const members = records.map((record) => ({
    path: record.path, stem: record.path.slice(2, -3), title: record.title, frontmatter: frontmatter.get(record.path),
  }));
  const grouping = walkBy ? album : null;
  const lines = H.recordWalkRenderLines({ stem: "z", title: "SASE Blog Zettel" }, members, grouping);
  const ordered = H.recordWalkGroupProjection(members, grouping).ordered.map((member) => member.path);
  ordered.forEach((p, index) => sources.set(p, `---\ntype: "[[record]]"\nparent: "[[z]]"\n---\n\n${lines[index]}\n\n## Notes\n`));
  const links = ({ path: p, content }) => {
    const answer = plugin.navGroupsResolve({ path: p, content });
    const derived = (stop) => (stop ? { ...stop, text: stop.landingLabel, exists: stop.state === "exists" } : null);
    return {
      ok: true, prev: null, next: null,
      prevGroup: derived(answer.prevGroup), nextGroup: derived(answer.nextGroup),
      group: answer.group || null, groupNone: answer.none || null, groupConflict: null, groupConflicts: [],
    };
  };
  app.plugins.plugins["bob-navigation-hotkeys"] = { api: { version: 3, walkMode: { version: 7, links } } };
  return { app, album, frontmatter, plugin, records, report, sources };
}

function buildRecordCard(world, recordPath, doc) {
  const { helpers: H } = harness();
  const walk = world.plugin.recordWalkFor(recordPath, world.sources.get(recordPath));
  assert.ok(walk, `${recordPath}: recordWalkFor produced a walk`);
  const fm = world.frontmatter.get(recordPath);
  const model = H.recordSheetModel({
    gate: { mount: true, state: "healthy", filePath: recordPath, albumPath: "z.md", album: world.album, hideEligible: true, editable: true },
    frontmatter: { ...fm, created: "2026-11-02" },
    heading: fm.title, hue: "violet", collapsed: false,
    clock: { today: TODAY, now: new Date(2026, 10, 21, 12, 0, 0) },
  });
  assert.ok(model, `${recordPath}: recordSheetModel produced a model`);
  const options = { hue: "violet", handlers: {} };
  const card = world.plugin.recordSheetBuildMounted(model, options, doc, { includeRail: true, walk });
  assert.ok(card, `${recordPath}: recordSheetBuildMounted returned a card`);
  card.classList?.add("docks-record-walk");
  return { card, walk };
}

function bigGroupRecords() {
  const intro = [{ path: "z/alpha.md", title: "Why SASE Exists", section: "intro" }];
  const body = Array.from({ length: 24 }, (_, i) => ({ path: `z/body-${pad2(i + 1)}.md`, title: `Future Note ${pad2(i + 1)}`, section: "body" }));
  const outro = [{ path: "z/omega.md", title: "What We Learned", section: "outro" }];
  return [...intro, ...body, ...outro];
}

// Bryan's 2026-11-21 screenshot (bob-cli-oj note #2): the current section
// holds one record and so does the previous one, so the step arms land on
// the neighbouring sections' heads and the old group row repeated them.
const SCREENSHOT_CHOICES = [
  { value: "what", label: "🪨 What is SASE?" },
  { value: "prompt", label: "📜 Prompt language (macros)" },
  { value: "agents", label: "🤖 Agent CLIs" },
];
const SCREENSHOT_RECORDS = [
  { path: "z/sase-is-many-abstractions.md", title: "sase is many abstractions", section: "what" },
  { path: "z/layers-of-prompt-management.md", title: "Layers of Prompt Management", section: "prompt" },
  { path: "z/memory.md", title: "Memory", section: "agents" },
  { path: "z/models-and-harnesses.md", title: "Models and Harnesses", section: "agents" },
];

const RECORD_FIXTURES = [
  { name: "record-first-wraps-prev", record: "z/alpha.md", world: {},
    expect: { groupRow: true, prev: "exists", next: "exists", prevWraps: true, track: "none" } },
  { name: "record-middle", record: "z/delta.md", world: {},
    expect: { groupRow: true, prev: "exists", next: "exists", track: "ticks" } },
  { name: "record-last-wraps-next", record: "z/zed.md", world: {},
    expect: { groupRow: true, prev: "exists", next: "exists", nextWraps: true, track: "none" } },
  { name: "record-screenshot-single-member", record: "z/layers-of-prompt-management.md",
    world: { records: SCREENSHOT_RECORDS, choices: SCREENSHOT_CHOICES },
    expect: { groupRow: true, prev: "exists", next: "exists", track: "none",
      prevLabel: "🪨 What is SASE?", nextLabel: "🤖 Agent CLIs" } },
  { name: "record-ghost-head", record: "z/delta.md", world: { hidden: ["z/omega.md"] },
    expect: { groupRow: true, prev: "exists", next: "ghost", track: "ticks" } },
  { name: "record-large-group-bar", record: "z/body-12.md", world: { records: bigGroupRecords() },
    expect: { groupRow: true, prev: "exists", next: "exists", track: "bar" } },
  { name: "record-single-group", record: "z/delta.md", world: { records: ZETTEL.map((record) => ({ ...record, section: "body" })) },
    expect: { groupRow: false, thumbTrack: true } },
];

// ---- Tree world (bob-cli-ra rail) ------------------------------------------------
// Pure link-walk rails with no card mounts yet: the preview builds the kit
// rail from the real tree index (derived stops only) and docks it as the
// card floor, so screenshots prove the disclosure table, wraps, lanes, and
// the bar above 21 members.

function treeFixtureCache(spec = {}) {
  return {
    frontmatter: spec.frontmatter || {},
    headings: Array.isArray(spec.headings) ? spec.headings : [],
    blocks: spec.blocks || {},
    listItems: Array.isArray(spec.listItems) ? spec.listItems : [],
  };
}

function treeProjectNote(parent, task = " ") {
  return treeFixtureCache({
    frontmatter: { type: "[[project]]", ...(parent === undefined ? {} : { parent }) },
    blocks: { prj: { position: { start: { line: 0 } } } },
    listItems: [{ position: { start: { line: 0 } }, task }],
  });
}

function treeAreaNote(parent) {
  return treeFixtureCache({ frontmatter: { type: "[[area]]", ...(parent === undefined ? {} : { parent }) } });
}

function treeWorldEntries(kind) {
  if (kind === "ticks-only") {
    return {
      "area.md": treeFixtureCache({}),
      "project.md": treeFixtureCache({}),
      "pig.md": treeAreaNote("[[area]]"),
      "foo.md": treeProjectNote("[[pig]]"),
      "goo.md": treeProjectNote("[[pig]]"),
      "zoo.md": treeProjectNote("[[pig]]"),
    };
  }
  if (kind === "arms-only") {
    return {
      "area.md": treeFixtureCache({}),
      "project.md": treeFixtureCache({}),
      "pig.md": treeAreaNote("[[area]]"),
      "foo.md": treeProjectNote("[[pig]]"),
      "goo.md": treeProjectNote("[[pig]]"),
      "zoo.md": treeProjectNote("[[pig]]"),
      "bar.md": treeProjectNote("[[foo]]"),
      "baz.md": treeProjectNote("[[foo]]"),
      "alpha.md": treeProjectNote("[[goo]]"),
      "beta.md": treeProjectNote("[[goo]]"),
      "solo.md": treeProjectNote("[[zoo]]"),
    };
  }
  if (kind === "bar") {
    const entries = {
      "area.md": treeFixtureCache({}),
      "project.md": treeFixtureCache({}),
      "big-area.md": treeAreaNote("[[area]]"),
      "big.md": treeProjectNote("[[big-area]]"),
    };
    for (let i = 1; i <= 22; i += 1) {
      const stem = `big-${String(i).padStart(2, "0")}`;
      entries[`${stem}.md`] = treeProjectNote("[[big]]");
    }
    return entries;
  }
  if (kind === "narrow") {
    return {
      "area.md": treeFixtureCache({}),
      "project.md": treeFixtureCache({}),
      "a-very-long-area-name-that-would-clip-without-narrowing.md": treeAreaNote("[[area]]"),
      "another-very-long-area-name-that-would-also-clip-without-narrowing.md": treeAreaNote("[[area]]"),
      "first-project-with-an-exceptionally-long-stem-for-narrow.md": treeProjectNote("[[a-very-long-area-name-that-would-clip-without-narrowing]]"),
      "second-project-with-an-exceptionally-long-stem-for-narrow.md": treeProjectNote("[[a-very-long-area-name-that-would-clip-without-narrowing]]"),
      "third-project-with-an-exceptionally-long-stem-for-narrow.md": treeProjectNote("[[another-very-long-area-name-that-would-also-clip-without-narrowing]]"),
      "fourth-project-with-an-exceptionally-long-stem-for-narrow.md": treeProjectNote("[[another-very-long-area-name-that-would-also-clip-without-narrowing]]"),
    };
  }
  return {
    "area.md": treeFixtureCache({}),
    "project.md": treeFixtureCache({}),
    "pig.md": treeAreaNote("[[area]]"),
    "foo.md": treeProjectNote("[[pig]]"),
    "goo.md": treeProjectNote("[[pig]]"),
    "zoo.md": treeProjectNote("[[pig]]"),
    "bar.md": treeProjectNote("[[foo]]"),
    "baz.md": treeProjectNote("[[foo]]"),
    "alpha.md": treeProjectNote("[[goo]]"),
    "beta.md": treeProjectNote("[[goo]]"),
  };
}

function treeWorld(kind = "full") {
  const { LedgerToolsPlugin } = harness();
  const entries = treeWorldEntries(kind);
  const files = new Map();
  const caches = new Map();
  for (const [path, spec] of Object.entries(entries)) {
    files.set(path, { path, extension: "md" });
    caches.set(path, spec);
  }
  const app = {
    vault: {
      getAbstractFileByPath: (p) => files.get(p) || null,
      getMarkdownFiles: () => [...files.values()],
      async read(file) { return ""; },
      async cachedRead(file) { return ""; },
      on: () => ({}),
    },
    metadataCache: {
      getFileCache: (file) => caches.get(file?.path) || null,
      getFirstLinkpathDest: (target, fromPath) => {
        const clean = String(target || "").replace(/\.md$/i, "");
        const dir = String(fromPath || "").split("/").slice(0, -1).join("/");
        const candidates = [];
        if (dir) candidates.push(`${dir}/${clean}.md`);
        candidates.push(`${clean}.md`);
        for (const candidate of candidates) {
          if (files.has(candidate)) return { path: candidate };
        }
        const base = `${clean.split("/").pop()}.md`;
        const hits = [...files.keys()].filter((p) => p === base || p.endsWith(`/${base}`)).sort();
        return hits.length ? { path: hits[0] } : null;
      },
      on: () => ({}),
    },
    workspace: { onLayoutReady(fn) { try { fn(); } catch (_) {} }, on: () => ({}) },
    commands: { commands: {}, executeCommandById: () => false },
    plugins: { plugins: {} },
  };
  const plugin = new LedgerToolsPlugin(app);
  plugin.navGroupsTodayOverride = TODAY;
  plugin.setupNavGroups();
  return { app, files, caches, plugin };
}

function buildTreeCard(kind, targetPath, doc) {
  const { helpers: H } = harness();
  const world = treeWorld(kind);
  const provider = world.plugin.navGroupsResolve({ path: targetPath });
  assert.ok(provider && provider.ok === true && provider.route === "tree", `${targetPath}: tree provider resolved`);
  const model = H.treeWalkRailModel({
    answer: {
      ok: true, prev: provider.step?.prev || null, next: provider.step?.next || null,
      prevGroup: provider.prevGroup, nextGroup: provider.nextGroup, group: provider.group, groupConflicts: [],
    },
    provider,
  });
  assert.ok(model, `${targetPath}: tree rail model built`);
  const built = world.plugin.treeWalkRailBuild(doc, model, {});
  assert.ok(built && built.element, `${targetPath}: tree rail built`);
  const card = doc.createElement("div");
  card.setAttribute("class", "bob-property-card");
  card.setAttribute("data-card-kind", "project");
  card.setAttribute("data-root-hue", "210");
  const title = doc.createElement("div");
  title.setAttribute("class", "bob-property-card-title-block");
  title.appendChild(doc.createTextNode(targetPath));
  card.appendChild(title);
  H.propertyCardFloorDock(card, built.element);
  return { card, model };
}

const TREE_FIXTURES = [
  { name: "tree-full", kind: "full", record: "bar.md",
    expect: { groupRow: true, prev: "exists", next: "exists", track: "ticks" } },
  { name: "tree-ticks-only", kind: "ticks-only", record: "foo.md",
    expect: { groupRow: true, track: "ticks" } },
  { name: "tree-arms-only", kind: "arms-only", record: "solo.md",
    expect: { groupRow: true, track: "none" } },
  { name: "tree-bar-above-21", kind: "bar", record: "big-12.md",
    expect: { groupRow: true, prev: "exists", next: "exists", nextWraps: true, track: "bar" } },
  { name: "tree-narrow", kind: "narrow", record: "second-project-with-an-exceptionally-long-stem-for-narrow.md",
    expect: { groupRow: true, prev: "exists", next: "exists", prevWraps: true, track: "ticks" } },
];

// ---- Album card ------------------------------------------------------------------

function buildAlbumCard(doc) {
  const { helpers: H, LedgerToolsPlugin } = harness();
  const world = recordWorld();
  const model = H.albumHeaderCardModel(world.report, "z.md", {
    sourcePath: "z.md", sourceText: "---\ntype: \"[[album]]\"\nparent: \"[[writing]]\"\nwalk_by: section\n---\n",
    metadataCache: world.app.metadataCache, vault: world.app.vault,
  });
  assert.ok(model, "albumHeaderCardModel returned a model");
  assert.equal(model.walkBy || model.body?.walkBy, "section", "album model carries walk_by");
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  const card = plugin.albumHeaderBuildEl(model, { sourcePath: "z.md", desktop: true, expanded: false, hue: "violet", handlers: {} }, doc);
  assert.ok(card, "albumHeaderBuildEl returned a card");
  return { card };
}

// ---- Fixtures and offline checks -----------------------------------------------------

function walkNodes(node, visit) {
  for (const child of node?.children || []) {
    if (child.nodeType === 1) { visit(child); walkNodes(child, visit); }
  }
}

function findAll(node, predicate) {
  const out = [];
  walkNodes(node, (child) => { if (predicate(child)) out.push(child); });
  return out;
}

const hasClass = (node, name) => (node.getAttribute?.("class") || "").split(/\s+/).includes(name);

function offlineCheck(fixture, card) {
  const problems = [];
  const expect = fixture.expect || {};
  const rows = findAll(card, (n) => hasClass(n, "bob-property-card-group-row"));
  if (expect.groupRow === true && rows.length !== 1) problems.push(`expected one group row, found ${rows.length}`);
  if (expect.groupRow === false && rows.length) problems.push(`expected no group row, found ${rows.length}`);
  const row = rows[0];
  if (row) {
    for (const direction of ["prev", "next"]) {
      if (!expect[direction]) continue;
      const arm = findAll(row, (n) => hasClass(n, "bob-property-card-group-arm") && n.getAttribute("data-group") === direction)[0];
      if (!arm) { problems.push(`missing ${direction} arm`); continue; }
      if (arm.getAttribute("data-state") !== expect[direction]) problems.push(`${direction} arm is ${arm.getAttribute("data-state")}, expected ${expect[direction]}`);
      const wraps = findAll(arm, (n) => hasClass(n, "bob-property-card-group-wrap")).length > 0;
      const wantWrap = expect[`${direction}Wraps`] === true;
      if (wraps !== wantWrap) problems.push(`${direction} arm wrap glyph ${wraps ? "present" : "absent"}`);
      // The declutter: the mark and the group name, no landing, no « / ».
      const mark = findAll(arm, (n) => hasClass(n, "bob-property-card-group-glyph"))[0];
      const icon = direction === "prev" ? "skip-back" : "skip-forward";
      if (!mark || mark.getAttribute("data-icon") !== icon || mark.getAttribute("aria-hidden") !== "true") problems.push(`${direction} arm lacks the ${icon} mark`);
      else if (!findAll(mark, (n) => String(n.tagName).toLowerCase() === "svg").length) problems.push(`${direction} arm mark has no inline SVG`);
      if (findAll(arm, (n) => hasClass(n, "bob-property-card-group-landing") || hasClass(n, "bob-property-card-group-sep")).length) problems.push(`${direction} arm paints its landing`);
      if (/[«»]/.test(arm.textContent)) problems.push(`${direction} arm still shows « / »`);
      const label = findAll(arm, (n) => hasClass(n, "bob-property-card-group-label"))[0];
      const wantLabel = expect[`${direction}Label`];
      if (wantLabel && label?.textContent !== wantLabel) problems.push(`${direction} arm reads ${JSON.stringify(label?.textContent)}, expected ${JSON.stringify(wantLabel)}`);
      if (!/→|isn't created yet|not in the vault|before Bob/.test(arm.getAttribute("title") || "")) problems.push(`${direction} arm tooltip does not name its landing`);
    }
    const ticks = findAll(row, (n) => hasClass(n, "bob-property-card-group-tick"));
    const thumbs = findAll(row, (n) => hasClass(n, "bob-property-card-group-thumb"));
    const center = findAll(row, (n) => hasClass(n, "bob-property-card-group-center"))[0];
    if (expect.track === "ticks" && !ticks.length) problems.push("expected member ticks");
    if (expect.track === "bar" && (ticks.length || thumbs.length !== 1)) problems.push(`expected a bar and one thumb, saw ${ticks.length} ticks and ${thumbs.length} thumbs`);
    if (expect.track === "none" && (center || ticks.length || thumbs.length)) problems.push("a one-member group still draws a centre or track");
    if (center) {
      if (findAll(center, (n) => /group-(?:name|position-wide|position-narrow)/.test(n.getAttribute?.("class") || "")).length) problems.push("centre paints visible text");
      if (!center.getAttribute("title")) problems.push("centre has no title");
      if (!findAll(center, (n) => hasClass(n, "bob-property-card-group-position-label")).length) problems.push("centre lost its hidden position label");
    }
  }
  const stepRows = findAll(card, (n) => hasClass(n, "bob-property-card-rail-row"));
  for (const [key, role] of [["stepPrev", "prev"], ["stepNext", "next"]]) {
    if (!expect[key]) continue;
    const item = findAll(card, (n) => n.getAttribute?.("data-rail") === role)[0];
    if (!item) problems.push(`missing step ${role} item`);
    else if (item.getAttribute("data-state") !== expect[key]) problems.push(`step ${role} is ${item.getAttribute("data-state")}, expected ${expect[key]}`);
  }
  if (expect.derived === true && !stepRows.length) problems.push("expected a derived step row");
  if (expect.thumbTrack === true && !findAll(card, (n) => hasClass(n, "bob-record-walk-track")).length) problems.push("expected the whole-walk thumb track");
  if (fixture.name === "album-walks-by") {
    const pill = findAll(card, (n) => hasClass(n, "bob-album-schema-walks-by"))[0];
    if (!pill) problems.push("missing walks-by pill");
    else if (pill.textContent !== "walks by Section") problems.push(`pill reads ${JSON.stringify(pill.textContent)}`);
  }
  return problems;
}

function buildFixtures(only = []) {
  const calendar = calendarWorld();
  const fixtures = [];
  for (const fixture of CALENDAR_FIXTURES) {
    fixtures.push({ ...fixture, family: "calendar", build: (doc) => buildCalendarCard(calendar, fixture, doc) });
  }
  for (const fixture of RECORD_FIXTURES) {
    fixtures.push({ ...fixture, family: "record", build: (doc) => buildRecordCard(recordWorld(fixture.world), fixture.record, doc) });
  }
  for (const fixture of TREE_FIXTURES) {
    fixtures.push({ ...fixture, family: "tree", build: (doc) => buildTreeCard(fixture.kind, fixture.record, doc) });
  }
  fixtures.push({ name: "album-walks-by", family: "album", expect: {}, build: (doc) => buildAlbumCard(doc) });
  const selected = only.length ? fixtures.filter((f) => only.includes(f.name)) : fixtures;
  if (only.length && selected.length !== only.length) {
    const known = new Set(fixtures.map((f) => f.name));
    throw new Error(`Unknown fixture(s): ${only.filter((name) => !known.has(name)).join(", ")}`);
  }
  return selected.map((fixture) => {
    const { card } = fixture.build(groupRailDocument());
    const problems = offlineCheck(fixture, card);
    return { ...fixture, html: serialize(card), problems };
  });
}

// ---- Page ------------------------------------------------------------------------

const PAGE_LAYOUT = `
/* Obsidian's app.css sizes body to the window with contain: strict; undo it
   the way its own print rules do, or nothing paints past a 0px body. */
html, body { margin: 0 !important; height: auto !important; min-height: 100%; overflow: visible !important; contain: initial !important; }
body { padding: ${PAGE_PAD}px !important; box-sizing: border-box; background: var(--background-primary); color: var(--text-normal); }
.bob-preview-frame { box-sizing: border-box; }
.bob-preview-frame .markdown-reading-view,
.bob-preview-frame .markdown-preview-view { padding: 0 !important; overflow: visible !important; height: auto !important; }
.bob-preview-frame .markdown-preview-sizer { min-height: 0 !important; padding: 0 !important; max-width: none !important; }
html.bob-preview-grayscale body { filter: grayscale(1); }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

// Fallback tokens when Obsidian's own app.css cannot be fetched.
function fallbackThemeCss() {
  return [
    baseline.ROOT_CSS,
    baseline.PALETTE_LIGHT.replace('body[data-theme="light"]', "body.theme-light"),
    baseline.PALETTE_DARK.replace('body[data-theme="dark"]', "body.theme-dark"),
    "body.theme-light { --text-normal:#222222; --font-ui-smaller: 12px; } body.theme-dark { --font-ui-smaller: 12px; }",
  ].join("\n");
}

function pageHtml(themeCss, pluginCss, cardHtml, { theme, grayscale, width, base }) {
  const safe = (css) => css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html${grayscale ? ' class="bob-preview-grayscale"' : ""}><head><meta charset="utf-8">${base ? `<base href="${base}">` : ""}`
    + `<style>${safe(themeCss)}</style><style>${PAGE_LAYOUT}</style><style>${safe(pluginCss)}</style></head>`
    + `<body class="theme-${theme} is-preview-matrix"><div class="bob-preview-frame" style="width:${width}px">`
    + `<div class="markdown-reading-view"><div class="markdown-preview-view markdown-rendered"><div class="markdown-preview-sizer">${cardHtml}</div></div></div>`
    + "</div></body></html>";
}

async function fetchObsidianCss(client) {
  const result = await client.call("Runtime.evaluate", {
    expression: `(async () => {
      const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href);
      const href = links.find((h) => /\\/app\\.css(\\?|$)/.test(h)) || new URL("app.css", location.href).href;
      const response = await fetch(href);
      if (!response.ok) return { ok: false, href, status: response.status };
      return { ok: true, href, base: new URL(".", href).href, css: await response.text(), version: (window.electron && process?.versions?.electron) || "" };
    })()`,
    awaitPromise: true, returnByValue: true,
  });
  const value = result.result?.value;
  if (!value?.ok || !value.css || value.css.length < 10_000) return null;
  return value;
}

async function installPage(client, html) {
  const encoded = Buffer.from(html).toString("base64");
  const result = await client.call("Runtime.evaluate", {
    expression: `(() => { const html = new TextDecoder("utf-8").decode(Uint8Array.from(atob("${encoded}"), (c) => c.charCodeAt(0))); document.open(); document.write(html); document.close(); return true; })()`,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Could not install preview page");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await client.call("Runtime.evaluate", {
      expression: "document.readyState === 'complete' && Boolean(document.querySelector('.bob-preview-frame > * .bob-property-card, .bob-preview-frame .bob-property-card'))",
      returnByValue: true,
    });
    if (state.result?.value === true) {
      await client.call("Runtime.evaluate", { expression: "document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))", awaitPromise: true, returnByValue: true });
      return;
    }
    await sleep(50);
  }
  throw new Error("Preview page did not finish rendering a property card");
}

// In-page probe: geometry, narrow collapse, and contrast for every stated
// item, chip, arm, tick, centre text, and the album pill.
const MEASURE = `(() => {
  const probe = document.createElement("span");
  probe.style.forcedColorAdjust = "none";
  document.body.appendChild(probe);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const parse = (value) => {
    const text = String(value || "").trim();
    let m = /^rgba?\\(([^)]+)\\)$/.exec(text);
    if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
    m = /^color\\(srgb ([^)]+)\\)$/.exec(text);
    if (m) { const p = m[1].split(/[ \\/]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }; }
    if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    // Any other syntax (oklab, lab, color-mix results): paint it over white
    // and over black; the two pixels give back the color and its alpha.
    const paint = (under) => {
      ctx.globalCompositeOperation = "copy"; ctx.fillStyle = under; ctx.fillRect(0, 0, 1, 1);
      ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = "#000"; ctx.fillStyle = text; ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data;
    };
    const w = paint("#fff"); const k = paint("#000");
    const a = Math.max(0, Math.min(1, 1 - (w[0] - k[0]) / 255));
    if (a <= 0.004) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: k[0] / a, g: k[1] / a, b: k[2] / a, a };
  };
  const over = (top, under) => {
    const a = top.a;
    return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
  };
  const effectiveBg = (el) => {
    const layers = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.a > 0) layers.push(c);
      if (c.a >= 1) break;
    }
    let base = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (!(base.a > 0)) base = { r: 255, g: 255, b: 255, a: 1 };
    if (layers.length && layers[layers.length - 1].a >= 1) base = layers.pop();
    for (let i = layers.length - 1; i >= 0; i -= 1) base = over(layers[i], base);
    return base;
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const visible = (el) => { if (!el) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  const textMeasure = (el, kind, owner) => {
    const s = getComputedStyle(el);
    const bg = effectiveBg(el);
    const fg = over(parse(s.color), bg);
    return { kind, owner, text: (el.textContent || "").trim().slice(0, 48), fg: hex(fg), bg: hex(bg), ratio: ratio(fg, bg), min: 4.5,
      opacity: Number(s.opacity) };
  };
  const borderMeasure = (el, kind, owner) => {
    const s = getComputedStyle(el);
    const bg = effectiveBg(el.parentElement || el);
    const raw = parse(s.borderTopColor);
    const edge = over(raw, bg);
    return { kind, owner, style: s.borderTopStyle, width: s.borderTopWidth, fg: hex(edge), bg: hex(bg), alpha: raw.a, ratio: ratio(edge, bg), min: 3 };
  };
  const fillMeasure = (el, kind, owner, against) => {
    const s = getComputedStyle(el);
    const bg = effectiveBg(against || el.parentElement || el);
    const fill = parse(s.backgroundColor);
    const edge = parse(s.borderTopColor);
    const useBorder = fill.a === 0 && s.borderTopStyle !== "none";
    const c = over(useBorder ? edge : fill, bg);
    return { kind, owner, via: useBorder ? "border" : "fill", fg: hex(c), bg: hex(bg), ratio: ratio(c, bg), min: 3 };
  };
  const card = document.querySelector(".bob-preview-frame .bob-property-card");
  const cardRect = card.getBoundingClientRect();
  const frame = document.querySelector(".bob-preview-frame").getBoundingClientRect();
  const out = { cardWidth: Math.round(cardRect.width * 10) / 10, cardHeight: Math.round(cardRect.height * 10) / 10,
    contentWidth: Math.round(frame.width * 10) / 10, texts: [], borders: [], fills: [], arms: [], items: [], row: null, layout: [] };
  const stateOf = (el) => el.getAttribute("data-state") || "exists";
  for (const el of card.querySelectorAll(".bob-property-card-rail-item[data-state], .bob-property-card-rail-chip[data-state]")) {
    if (!visible(el)) continue;
    const role = el.getAttribute("data-rail") || "chip";
    const owner = (el.classList.contains("bob-property-card-rail-chip") ? "chip" : "item") + ":" + stateOf(el) + ":" + role;
    out.texts.push(textMeasure(el, "item-text", owner));
    out.borders.push(borderMeasure(el, "item-edge", owner));
    const plus = el.querySelector(".bob-property-card-rail-plus");
    const note = el.querySelector(".bob-property-card-rail-note");
    if (plus && visible(plus)) out.texts.push(textMeasure(plus, "item-plus", owner));
    if (note && visible(note)) out.texts.push(textMeasure(note, "item-note", owner));
    out.items.push({ owner, text: (el.textContent || "").trim(), decoration: getComputedStyle(el).textDecorationLine, opacity: getComputedStyle(el).opacity,
      borderStyle: getComputedStyle(el).borderTopStyle });
  }
  const row = card.querySelector(".bob-property-card-group-row");
  if (row) {
    const r = row.getBoundingClientRect();
    out.row = { width: Math.round(r.width), height: Math.round(r.height), scrollOverflow: row.scrollWidth - row.clientWidth,
      label: row.getAttribute("aria-label") };
    for (const arm of row.querySelectorAll(".bob-property-card-group-arm")) {
      const owner = "arm:" + stateOf(arm) + ":" + arm.getAttribute("data-group");
      const a = arm.getBoundingClientRect();
      const spans = {};
      for (const cls of ["glyph", "label", "label-narrow", "sep", "landing", "plus", "note", "wrap"]) {
        const span = arm.querySelector(".bob-property-card-group-" + cls);
        spans[cls] = span ? { visible: visible(span), text: span.textContent, truncated: span.scrollWidth > span.clientWidth + 1 } : null;
        if (span && visible(span) && ["label", "label-narrow", "plus", "note"].includes(cls)) out.texts.push(textMeasure(span, "arm-" + cls, owner));
      }
      // The skip mark is a graphic: its stroke ink needs 3:1.
      const glyph = arm.querySelector(".bob-property-card-group-glyph");
      const svg = glyph && glyph.querySelector("svg");
      let mark = null;
      if (svg && visible(glyph)) {
        const g = svg.getBoundingClientRect();
        const bg = effectiveBg(glyph);
        const ink = over(parse(getComputedStyle(glyph).color), bg);
        mark = { width: Math.round(g.width * 10) / 10, height: Math.round(g.height * 10) / 10, icon: glyph.getAttribute("data-icon") };
        out.borders.push({ kind: "arm-mark", owner, fg: hex(ink), bg: hex(bg), ratio: ratio(ink, bg), min: 3 });
      }
      // State underlines under the visible label: style and 3:1 ink.
      const shown = [arm.querySelector(".bob-property-card-group-label"), arm.querySelector(".bob-property-card-group-label-narrow")].find(visible);
      let underline = null;
      if (shown) {
        const ls = getComputedStyle(shown);
        if (ls.textDecorationLine.includes("underline")) {
          const bg = effectiveBg(shown);
          const ink = over(parse(ls.textDecorationColor), bg);
          underline = { style: ls.textDecorationStyle, color: ls.textDecorationColor, ratio: ratio(ink, bg) };
          out.borders.push({ kind: "arm-underline", owner, style: ls.textDecorationStyle, fg: hex(ink), bg: hex(bg), ratio: underline.ratio, min: 3 });
        }
      }
      const s = getComputedStyle(arm);
      out.arms.push({ owner, width: Math.round(a.width * 10) / 10, height: Math.round(a.height * 10) / 10,
        right: Math.round(a.right - cardRect.right), left: Math.round(a.left - cardRect.left),
        borderStyle: s.borderTopStyle, borderWidth: s.borderTopWidth, borderColor: s.borderTopColor, wrapsLines: a.height > 34, spans,
        mark, underline, visibleText: (arm.innerText || "").replace(/\s+/g, " ").trim(),
        href: arm.getAttribute("href"), ariaDisabled: arm.getAttribute("aria-disabled"), title: arm.getAttribute("title"), ariaLabel: arm.getAttribute("aria-label") });
    }
    const center = row.querySelector(".bob-property-card-group-center");
    // Visible text only: the clipped screen-reader label is not on screen.
    const centerText = center ? [...center.children].filter((n) => !n.classList.contains("bob-property-card-group-position-label") && visible(n))
      .map((n) => (n.innerText || "").trim()).join("").trim() : "";
    out.row.center = center ? { title: center.getAttribute("title"), visibleText: centerText } : null;
    if (center) {
      const track = center.querySelector(".bob-property-card-group-track");
      out.row.track = track ? { visible: visible(track), mode: track.getAttribute("data-track") || "ticks" } : null;
      for (const tick of center.querySelectorAll(".bob-property-card-group-tick")) {
        if (visible(tick)) out.fills.push(fillMeasure(tick, "tick", "tick:" + stateOf(tick)));
      }
      const thumb = center.querySelector(".bob-property-card-group-thumb");
      // The thumb stands taller than the 3px bar, so it reads against the row.
      if (thumb && visible(thumb)) out.fills.push(fillMeasure(thumb, "thumb", "thumb", center));
      // The bar behind the thumb is decorative (aria-hidden; the position
      // text carries the value, like the legacy whole-walk track): recorded,
      // never held to the 3:1 non-text minimum.
      const bar = center.querySelector('.bob-property-card-group-track[data-track="bar"]');
      if (bar && visible(bar)) out.fills.push({ ...fillMeasure(bar, "bar", "bar"), min: null, decorative: true });
    }
    const cells = [...row.children].map((c) => c.getBoundingClientRect());
    for (let i = 1; i < cells.length; i += 1) {
      if (cells[i].width > 0 && cells[i - 1].width > 0 && cells[i].left < cells[i - 1].right - 0.5 && Math.abs(cells[i].top - cells[i - 1].top) < 4) {
        out.layout.push("group row cells overlap");
      }
    }
    if (r.right > cardRect.right + 0.5) out.layout.push("group row overflows the card");
  }
  const pill = card.querySelector(".bob-album-schema-walks-by");
  if (pill && visible(pill)) {
    out.texts.push(textMeasure(pill, "pill-text", "pill"));
    out.pill = { text: pill.textContent, title: pill.getAttribute("title"), wraps: pill.getBoundingClientRect().height > 30 };
  }
  const walkTrack = card.querySelector(".bob-record-walk-track");
  out.thumbTrack = Boolean(walkTrack && visible(walkTrack));
  const stepRow = card.querySelector(".bob-property-card-rail-row");
  out.stepRow = Boolean(stepRow && visible(stepRow));
  if (card.scrollWidth > card.clientWidth + 1) out.layout.push("card scrolls horizontally");
  probe.remove();
  return out;
})()`;

function checkMetrics(fixture, pass, width, metrics) {
  const failures = [];
  const forced = pass === "forced-colors";
  const contrastPass = pass === "normal";
  for (const item of metrics.layout || []) failures.push(item);
  if (fixture.expect.groupRow === true && !metrics.row) failures.push("group row not rendered");
  if (fixture.expect.groupRow === false && metrics.row) failures.push("unexpected group row");
  if (metrics.row && metrics.row.scrollOverflow > 1) failures.push(`group row overflows by ${metrics.row.scrollOverflow}px`);
  for (const arm of metrics.arms || []) {
    if (arm.width < 32) failures.push(`${arm.owner} is ${arm.width}px wide (< 32px)`);
    if (arm.wrapsLines) failures.push(`${arm.owner} wraps (${arm.height}px tall)`);
    if (arm.spans.landing || arm.spans.sep) failures.push(`${arm.owner} paints its landing`);
    if (/[«»]/.test(arm.visibleText || "")) failures.push(`${arm.owner} shows « / »`);
    if (width === NARROW) {
      if (arm.spans.label?.visible) failures.push(`${arm.owner} shows its wide label at narrow width`);
      if (!arm.spans["label-narrow"]?.visible) failures.push(`${arm.owner} hides its narrow label`);
    } else if (!arm.spans.label?.visible) failures.push(`${arm.owner} hides its group label at wide width`);
    if (!arm.mark) failures.push(`${arm.owner} draws no skip mark`);
    else if (arm.mark.width < 8 || arm.mark.width > 24) failures.push(`${arm.owner} mark is ${arm.mark.width}px wide`);
    if (arm.owner.startsWith("arm:ghost") && (arm.href || arm.ariaDisabled !== "true")) failures.push(`${arm.owner} is linkable`);
    const boxed = arm.borderStyle !== "none" && parseFloat(arm.borderWidth || "0") > 0;
    if (boxed) {
      const box = (metrics.armBoxes = metrics.armBoxes || []);
      box.push(arm.owner);
    }
    if (arm.owner.startsWith("arm:creatable") && arm.underline?.style !== "dashed") failures.push(`${arm.owner} underline is ${arm.underline?.style || "missing"}`);
    if (arm.owner.startsWith("arm:ghost") && arm.underline?.style !== "dotted") failures.push(`${arm.owner} underline is ${arm.underline?.style || "missing"}`);
    if (arm.owner.startsWith("arm:exists") && arm.underline) failures.push(`${arm.owner} is underlined`);
  }
  if (metrics.row?.center?.visibleText) failures.push(`group centre shows text ${JSON.stringify(metrics.row.center.visibleText)}`);
  if (metrics.row?.center && !metrics.row.center.title) failures.push("group centre has no title");
  if (fixture.expect.track === "none" && metrics.row?.center) failures.push("one-member group draws a centre");
  for (const item of metrics.items || []) {
    if (item.decoration && item.decoration !== "none") failures.push(`${item.owner} keeps a ${item.decoration} decoration`);
    if (Number(item.opacity) < 1) failures.push(`${item.owner} is faded (opacity ${item.opacity})`);
    if (item.owner.includes(":creatable:") && item.borderStyle !== "dashed") failures.push(`${item.owner} border is ${item.borderStyle}`);
    if (item.owner.includes(":ghost:") && item.borderStyle !== "dotted") failures.push(`${item.owner} border is ${item.borderStyle}`);
  }
  if (width === NARROW && metrics.row?.track?.visible) failures.push("track visible at narrow width");
  if (fixture.expect.thumbTrack === true && !metrics.thumbTrack) failures.push("single-group album lost its thumb track");
  if (contrastPass) {
    for (const t of metrics.texts || []) if (t.ratio < t.min) failures.push(`${t.owner} ${t.kind} contrast ${t.ratio}:1 < ${t.min}:1 (${t.fg} on ${t.bg})`);
    for (const b of metrics.borders || []) if (b.ratio < b.min) failures.push(`${b.owner} ${b.kind} contrast ${b.ratio}:1 < ${b.min}:1 (${b.fg} on ${b.bg})`);
    for (const f of metrics.fills || []) if (f.min && f.ratio < f.min) failures.push(`${f.owner} ${f.kind} contrast ${f.ratio}:1 < ${f.min}:1 (${f.fg} on ${f.bg})`);
  }
  if (metrics.armBoxes?.length) failures.push(`${forced ? "forced-colors " : ""}draws a box around group arms: ${metrics.armBoxes.join(", ")}`);
  return failures;
}

async function captureCard(client, outPath) {
  const bounds = await client.call("Runtime.evaluate", {
    expression: "(() => { const r = document.querySelector('.bob-preview-frame .bob-property-card').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()",
    returnByValue: true,
  });
  const rect = bounds.result?.value;
  if (!rect || !(rect.width > 0 && rect.height > 0)) throw new Error("Rendered card has no visible bounds");
  const padding = 10;
  const image = await client.call("Page.captureScreenshot", {
    format: "png", fromSurface: true, captureBeyondViewport: true,
    clip: { x: Math.max(0, Math.floor(rect.x) - padding), y: Math.max(0, Math.floor(rect.y) - padding), width: Math.ceil(rect.width) + padding * 2, height: Math.ceil(rect.height) + padding * 2, scale: 1 },
  });
  const bytes = Buffer.from(image.data, "base64");
  fs.writeFileSync(outPath, bytes);
  return { file: path.basename(outPath), sha256: sha256(bytes), bytes: bytes.length };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function indexHtml(manifest) {
  const groups = new Map();
  for (const row of manifest.renders) {
    const list = groups.get(row.fixture) || [];
    list.push(row); groups.set(row.fixture, list);
  }
  const sections = [...groups.entries()].map(([fixture, list]) => {
    const figures = list.map((row) => {
      const status = row.failures.length ? `<b class="fail">FAIL: ${escapeHtml(row.failures.join("; "))}</b>` : "ok";
      return `<figure><img src="${row.screenshot.file}" alt="${escapeHtml(row.case)}"><figcaption>${row.pass} · ${row.theme} · content ${row.contentWidth}px · card ${row.metrics.cardWidth}px · ${status}</figcaption></figure>`;
    }).join("");
    return `<section><h2>${escapeHtml(fixture)}</h2><div class="grid">${figures}</div></section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Group rail preview matrix</title><style>
body{font:14px/1.4 system-ui,sans-serif;margin:24px;background:#fafafa;color:#222}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
figure{margin:0;padding:8px;background:#fff;border:1px solid #ddd;border-radius:6px;max-width:100%}
img{display:block;max-width:100%;height:auto}figcaption{margin-top:6px;font-size:12px;color:#555}.fail{color:#b00020}
</style></head><body><h1>Group rail preview matrix (real builders)</h1>
<p>Source ${escapeHtml(manifest.sourceSha)} · Ledger Tools ${escapeHtml(manifest.ledgerToolsVersion)} · theme CSS: ${escapeHtml(manifest.themeCss)} · ${manifest.renders.length} renders · ${manifest.errors.length} failing.</p>
${sections}</body></html>\n`;
}

// Worst ratio per (theme, state owner, kind) across normal renders.
function contrastTable(renders) {
  const table = new Map();
  for (const row of renders) {
    if (row.pass !== "normal") continue;
    for (const entry of [...(row.metrics.texts || []), ...(row.metrics.borders || []), ...(row.metrics.fills || [])]) {
      const owner = entry.owner.replace(/:(prev|next|parent|chip|[0-9]+)$/, "");
      const key = `${row.theme}|${owner}|${entry.kind}`;
      const seen = table.get(key);
      if (!seen || entry.ratio < seen.ratio) table.set(key, { theme: row.theme, owner, kind: entry.kind, ratio: entry.ratio, min: entry.min, fg: entry.fg, bg: entry.bg, case: row.case });
    }
  }
  return [...table.values()].sort((a, b) => a.theme.localeCompare(b.theme) || a.owner.localeCompare(b.owner) || a.kind.localeCompare(b.kind));
}

function contrastMarkdown(rows) {
  const lines = ["# Group rail contrast (worst case per theme, state, and element)", "",
    "| Theme | Owner (role:state) | Element | Worst ratio | Minimum | Ink | Background | Worst render |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const row of rows) {
    const min = row.min ? `${row.min}:1` : "decorative";
    lines.push(`| ${row.theme} | ${row.owner} | ${row.kind} | ${row.ratio}:1 | ${min} | ${row.fg} | ${row.bg} | ${row.case} |`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(`${HELP}\n`); return; }
  const built = buildFixtures(args.only);
  const offline = built.filter((f) => f.problems.length).map((f) => `${f.name}: ${f.problems.join("; ")}`);
  if (args.selfTest) {
    process.stdout.write(`Group rail self-test: ${built.length} fixtures built, ${offline.length} with problems\n`);
    if (offline.length) throw new Error(`Offline fixture checks failed:\n${offline.join("\n")}`);
    return;
  }
  if (offline.length) throw new Error(`Offline fixture checks failed:\n${offline.join("\n")}`);
  if (!args.out) throw new Error("--out is required");
  if (!fs.existsSync(args.executable)) throw new Error(`Obsidian executable not found: ${args.executable}`);
  const pluginCss = fs.readFileSync(PLUGIN_CSS, "utf8");
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "group-rail-preview-"));
  const vaultPath = path.join(tempRoot, "vault");
  fs.mkdirSync(path.join(vaultPath, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "README.md"), "# Preview scratch vault\n");
  const port = await freePort();
  const child = spawn(args.executable, [
    "--no-sandbox", `--user-data-dir=${path.join(tempRoot, "profile")}`, `--remote-debugging-port=${port}`,
    "--remote-allow-origins=http://127.0.0.1/*", vaultPath,
  ], { cwd: vaultPath, env: { ...process.env, TMPDIR: "/tmp" }, detached: process.platform !== "win32", stdio: "ignore" });

  let client = null;
  try {
    let endpoint;
    try { endpoint = await cdpTarget(port, child); } catch (e) { throw new Error(`${e.message}; run under xvfb-run -a`); }
    let WS = globalThis.WebSocket;
    if (typeof WS !== "function") { try { WS = require("undici").WebSocket; } catch (_) { WS = null; } }
    if (!WS) throw new Error("WebSocket is required (Node 22+ or undici)");
    client = new CdpClient(endpoint, WS);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    // Obsidian's own stylesheet from the running app, so tokens, fonts, and
    // link rules are what the vault shows; the baseline palette otherwise.
    let obsidianCss = null;
    for (let attempt = 0; attempt < 40 && !obsidianCss; attempt += 1) {
      try { obsidianCss = await fetchObsidianCss(client); } catch (_) { obsidianCss = null; }
      if (!obsidianCss) await sleep(250);
    }
    const themeCss = obsidianCss ? obsidianCss.css : fallbackThemeCss();
    const appInfo = await client.call("Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true });
    // A blank page paints reliably; the vault window may not.
    await client.call("Page.navigate", { url: "about:blank" });
    await sleep(250);

    const renders = [];
    const render = async (fixture, pass, theme, width) => {
      const forced = pass === "forced-colors";
      const grayscale = pass === "grayscale";
      const caseName = `${fixture.name}-${pass}-${theme}-${width === NARROW ? "375" : "wide"}`;
      await client.call("Emulation.setDeviceMetricsOverride", { width: width + PAGE_PAD * 2, height: 900, deviceScaleFactor: 1, mobile: false });
      await client.call("Emulation.setEmulatedMedia", { media: "screen", features: [
        { name: "prefers-color-scheme", value: theme },
        { name: "prefers-reduced-motion", value: "reduce" },
        { name: "forced-colors", value: forced ? "active" : "none" },
      ] });
      await installPage(client, pageHtml(themeCss, pluginCss, fixture.html, { theme, grayscale, width, base: obsidianCss?.base }));
      const measured = await client.call("Runtime.evaluate", { expression: MEASURE, returnByValue: true });
      if (measured.exceptionDetails) throw new Error(`${caseName}: ${measured.exceptionDetails.exception?.description || measured.exceptionDetails.text}`);
      const metrics = measured.result?.value || {};
      const failures = checkMetrics(fixture, pass, width, metrics);
      const screenshot = await captureCard(client, path.join(outDir, `${caseName}.png`));
      renders.push({ case: caseName, fixture: fixture.name, family: fixture.family, pass, theme, width: width === NARROW ? "375" : "wide",
        contentWidth: metrics.contentWidth, metrics, failures, screenshot });
    };

    for (const fixture of built) {
      for (const theme of ["light", "dark"]) {
        for (const width of [NARROW, WIDE]) await render(fixture, "normal", theme, width);
        await render(fixture, "grayscale", theme, WIDE);
        await render(fixture, "forced-colors", theme, WIDE);
      }
    }

    const errors = renders.filter((r) => r.failures.length).map((r) => `${r.case}: ${r.failures.join("; ")}`);
    const contrast = contrastTable(renders);
    const manifest = {
      generator: "scripts/preview-group-rail.cjs",
      sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      sourceDirty: execFileSync("git", ["status", "--porcelain", "--", "plugins/bob-ledger-tools", "scripts/preview-group-rail.cjs"], { cwd: ROOT, encoding: "utf8" }).trim().length > 0,
      ledgerToolsVersion: JSON.parse(fs.readFileSync(path.join(ROOT, "plugins/bob-ledger-tools/manifest.json"), "utf8")).version,
      stylesSha256: sha256(Buffer.from(pluginCss)),
      themeCss: obsidianCss ? `Obsidian app.css from ${obsidianCss.href} (sha256 ${sha256(Buffer.from(obsidianCss.css))})` : "fallback: preview-obsidian-baseline 2.1.2 palette",
      userAgent: appInfo.result?.value || "",
      contentWidths: { narrow: NARROW, wide: WIDE },
      passes: ["normal (light/dark x 375/wide)", "grayscale (light/dark, wide)", "forced-colors (light/dark, wide)"],
      fixtures: built.map((f) => ({ name: f.name, family: f.family, expect: f.expect })),
      renderCount: renders.length,
      renders,
      contrast,
      errors,
      outcome: errors.length ? "fail" : "pass",
    };
    fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, "contrast.json"), `${JSON.stringify(contrast, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, "contrast.md"), contrastMarkdown(contrast));
    fs.writeFileSync(path.join(outDir, "index.html"), indexHtml(manifest));
    process.stdout.write(`Group rail matrix: ${renders.length} renders of ${built.length} fixtures, ${errors.length} failing → ${outDir}\n`);
    if (errors.length) {
      process.stderr.write(`${errors.join("\n")}\n`);
      process.exitCode = 1;
    }
  } finally {
    client?.close();
    try { if (child.pid && child.exitCode === null) { if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); } } catch (_) {}
    await sleep(200);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`preview-group-rail: ${error.stack || error.message}\n`); process.exitCode = 1; });
}

module.exports = { parseArgs, buildFixtures, CALENDAR_FIXTURES, RECORD_FIXTURES, offlineCheck, checkMetrics };
