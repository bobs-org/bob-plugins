#!/usr/bin/env node
// Offline fixtures, probe source, check inventory, and argument parsing for
// the real-Obsidian title-block walkthrough. Nothing here launches Obsidian
// or bob; the runner (obsidian-title-block-e2e.cjs) does.
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const days = require("./obsidian-intention-card-e2e-lib.cjs");

const HELP_TEXT = [
  "Usage: node scripts/obsidian-title-block-e2e.cjs [OPTIONS]",
  "",
  "Prove shipped album, record, day, and period title blocks in an isolated",
  "Obsidian vault: ownership, reveal, first-paint native fallback, teardown,",
  "denied surfaces, and fixture byte neutrality. Run under xvfb-run -a on Linux.",
  "Default executable is /snap/bin/obsidian.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron binary",
  "  -o, --out DIRECTORY    Save PNG screenshots here",
  "  -r, --report PATH      Write the structured JSON report here",
  "  -s, --self-test        Validate fixtures, inventory, and probes without launching apps",
  "  -h, --help             Print this help",
].join("\n");

const PHASE = "fail-open-proof";

// Every mandatory check this phase must run. A missing, skipped, or unrun
// name fails the walkthrough; later phases append, they do not rename these.
const REQUIRED_CHECKS = Object.freeze([
  "plugins-loaded", "test-clock-agrees",
  "species-album-live", "species-album-reading",
  "species-album-h1less-live", "species-album-h1less-reading",
  "species-album-authored-h1-live", "species-album-authored-h1-reading",
  "species-record-live", "species-record-reading",
  "species-day-today-live", "species-day-today-reading",
  "species-day-past-live", "species-day-empty-live", "species-day-future-live",
  "species-day-legacy-2024-live", "species-day-legacy-2024-reading",
  "species-day-legacy-2025-live", "species-day-legacy-2025-reading",
  "species-day-legacy-2026-live", "species-day-legacy-2026-reading",
  "species-week-live", "species-week-reading",
  "species-quarter-live", "species-quarter-reading",
  "species-year-live", "species-year-reading",
  "scope-same-note-two-panes", "scope-unrelated-note",
  "scope-frontmatter-cursor-keeps-hidden", "scope-restored-cursor-outside-range",
  "vim-gg-across-hidden", "vim-jk-across-hidden", "vim-search-into-hidden-title",
  "outline-jump-live", "outline-jump-reading",
  "heading-link-live", "heading-link-reading",
  "edit-revealed-h1-stays-visible", "edit-undo-restores-bytes",
  "passive-bytes-neutral", "screenshots-captured", "no-console-exceptions",
  "source-mode-fails-open", "source-mode-remounts", "file-switch-restores-native",
  "leaf-close-clears-owner", "plugin-disable-restores-native",
  "title-slot-unavailable-fallback", "title-slot-insert-failure-fallback",
  "plugin-reenable-remounts", "title-slot-unavailable-recovers",
  "title-slot-insert-failure-recovers", "repaint-failure-restores-native",
  "surface-embed-album", "surface-embed-record", "surface-embed-day",
  "surface-hover-album", "surface-hover-record", "surface-hover-day",
  "surface-canvas-album", "surface-canvas-record", "surface-canvas-day",
  "print-exclusion-cdp", "lifecycle-bytes-neutral",
]);

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const input = Array.isArray(argv) ? argv.slice() : [];
  const value = (flag, name, index) => {
    const next = input[index];
    if (!next || next.startsWith("-")) throw new Error(flag + " requires a " + name + " value");
    return next;
  };
  for (let i = 0; i < input.length; i += 1) {
    const flag = input[i];
    if (flag === "-e" || flag === "--executable") args.executable = value("--executable", "PATH", ++i);
    else if (flag === "-o" || flag === "--out") args.out = value("--out", "DIRECTORY", ++i);
    else if (flag === "-r" || flag === "--report") args.report = value("--report", "PATH", ++i);
    else if (flag === "-s" || flag === "--self-test") args.selfTest = true;
    else if (flag === "-h" || flag === "--help") args.help = true;
    else throw new Error("Unknown argument: " + flag);
  }
  return args;
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function inventoryStatus(assertions, required = REQUIRED_CHECKS) {
  const rows = Array.isArray(assertions) ? assertions : [];
  const byName = new Map();
  for (const row of rows) {
    const name = row && row.name;
    if (!name) continue;
    const list = byName.get(name) || [];
    list.push(row);
    byName.set(name, list);
  }
  const missing = [];
  const failed = [];
  const passed = [];
  for (const name of required) {
    const list = byName.get(name) || [];
    if (!list.length) missing.push(name);
    else if (list.some((row) => row.status !== "pass")) failed.push(name);
    else passed.push(name);
  }
  return {
    missing, failed, passed,
    extra: [...byName.keys()].filter((name) => !required.includes(name)),
    complete: missing.length === 0,
    ok: missing.length === 0 && failed.length === 0,
  };
}

function weekPath(id) {
  return id.slice(0, 4) + "/" + id;
}

function h1lessDaily(date) {
  const week = days.weekId(date);
  return [
    "---",
    "parent: '[[" + weekPath(week) + "]]'",
    'type: "[[day]]"',
    "date: " + date,
    "tags:",
    "  - daily",
    "---",
    "day::" + date + " " + days.shortDayLabel(date).slice(0, 3),
    "",
    "Related notes:",
    "- Body sentinel for the H1-less daily " + date + ".",
    "",
  ].join("\n");
}

function recognizedLegacy2026() {
  return [
    "---",
    'type: "[[day]]"',
    "date: 2026-06-01",
    "id: 20260601",
    "---",
    "",
    "# 2026-06-01 Mon",
    "",
    "[[2026/20260531|prev]] | [[2026/20260601|day]] | [[2026/20260602|next]]",
    "",
    "## Source heading",
    "",
    "- Body sentinel for the recognized 2026 legacy daily.",
    "",
  ].join("\n");
}

function albumNote({ parent, title, summary, noun, emoji, titleKey, heading, extra = "" }) {
  const lines = ["---", 'type: "[[album]]"', 'parent: "[[' + parent + ']]"', "summary: " + summary];
  if (titleKey) lines.push("title: " + titleKey);
  if (emoji) lines.push("emoji: " + emoji);
  lines.push("record:", "  noun: " + noun, "---", "");
  if (heading) lines.push("# " + heading, "");
  if (extra) lines.push(extra.replace(/\n+$/, ""), "");
  return lines.join("\n");
}

function recordNote({ album, title }) {
  return [
    "---",
    'parent: "[[' + album + ']]"',
    'type: "[[record]]"',
    "title: " + JSON.stringify(title),
    "status: liked",
    "created: 2026-11-01",
    "---",
    "",
    "## Notes",
    "",
    "- Body sentinel for record " + title + ".",
    "",
  ].join("\n");
}

function weeksInIsoYear(year) {
  return days.isoWeek(year + "-12-28").week;
}

function isoWeekMonday(year, week) {
  return days.shiftDays(days.isoWeek(year + "-01-04").monday, (week - 1) * 7);
}

function yearNote(year) {
  const y = Number(year);
  const weeks = weeksInIsoYear(y);
  const start = isoWeekMonday(y, 1);
  const end = days.shiftDays(isoWeekMonday(y, weeks), 6);
  const title = year + " · " + days.periodRangeLabel(start, end) + " · " + weeks + " weeks";
  const prev = String(y - 1);
  const next = String(y + 1);
  const kids = ["Q1", "Q2", "Q3", "Q4"].map((q) => "[[" + year + "/" + year + "-" + q + "|" + q + "]]").join(" · ");
  return [
    "---",
    'parent: "[[all_time]]"',
    'type: "[[day]]"',
    "id: " + year,
    "aliases:",
    '  - "' + title + '"',
    "tags:",
    "  - yearly",
    "---",
    "",
    "# " + title,
    "",
    "[[" + prev + "|‹ " + prev + "]] · [[all_time|↑ All time]] · [[" + next + "|" + next + " ›]]",
    "",
    kids,
    "",
    "## Notes",
    "",
    "- Year body sentinel " + year + ".",
    "",
  ].join("\n");
}

function quarterNote(id) {
  const year = Number(id.slice(0, 4));
  const q = Number(id.slice(-1));
  const firstWeek = (q - 1) * 13 + 1;
  const lastWeek = q === 4 ? weeksInIsoYear(year) : q * 13;
  const start = isoWeekMonday(year, firstWeek);
  const end = days.shiftDays(isoWeekMonday(year, lastWeek), 6);
  const title = id + " · W" + firstWeek + "–W" + lastWeek + " · " + days.periodRangeLabel(start, end);
  const prevQ = q === 1 ? (year - 1) + "-Q4" : year + "-Q" + (q - 1);
  const nextQ = q === 4 ? (year + 1) + "-Q1" : year + "-Q" + (q + 1);
  const prevPath = String(prevQ).slice(0, 4) + "/" + prevQ;
  const nextPath = String(nextQ).slice(0, 4) + "/" + nextQ;
  const kids = [];
  for (let w = firstWeek; w <= lastWeek; w += 1) {
    const ww = String(w).padStart(2, "0");
    kids.push("[[" + year + "/" + year + "-W" + ww + "|W" + ww + "]]");
  }
  return [
    "---",
    'parent: "[[' + year + ']]"',
    'type: "[[day]]"',
    "id: " + id,
    "aliases:",
    '  - "' + title + '"',
    "tags:",
    "  - quarterly",
    "---",
    "",
    "# " + title,
    "",
    "[[" + prevPath + "|‹ " + String(prevQ).slice(5) + "]] · [[" + year + "|↑ " + year + "]] · [[" + nextPath + "|" + String(nextQ).slice(5) + " ›]]",
    "",
    kids.join(" · "),
    "",
    "## Notes",
    "",
    "- Quarter body sentinel " + id + ".",
    "",
  ].join("\n");
}

function albumListReport() {
  const album = (path, stem, title, emoji, summary) => ({
    path, stem, title, emoji, summary, noun: "restaurant", label: "Restaurant",
    plural: "restaurants", singular: "restaurant", dated_notes: false, legacy: [],
    schema_fingerprint: "sha256:title-block-" + stem, parent: "body", parent_kind: "area",
    owner: "body", root: "body", breadcrumb: ["Body"], group_field: "status",
    index_by: "status", index_facets: [], records: stem === "eat" ? 1 : 0,
    groups: stem === "eat" ? [{ value: "liked", label: "Liked", count: 1, peek: [] }] : [],
    needs_status: 0, last_record: stem === "eat" ? "eat/ramen.md" : null,
    index: { state: "current" }, issues: [],
    fields: [{ key: "status", label: "Status", kind: "choice", required: false, list: false, choices: [] }],
  });
  return {
    schema_version: 1, ok: true, capabilities: ["record_values_v1"], catalogs: [],
    counts: { albums: 3, records: 1, roots: 1 },
    albums: [
      album("eat.md", "eat", "Eat", "🍽️", "Places to eat."),
      album("bites.md", "bites", "Bites", "", "H1-less album."),
      album("authored.md", "authored", "Authored", "", "Unrecognized H1 stays."),
    ],
  };
}

function fixturePlan(today) {
  const seeded = days.fixturePlan(today);
  const { today: day, yesterday, empty, future, week, weekMonday, quarter, year } = seeded.plan;
  const plan = {
    today: day, yesterday, empty, future, week, weekMonday, quarter, year,
    titles: {
      today: days.dayCardTitle(day),
      yesterday: days.dayCardTitle(yesterday),
      empty: days.dayCardTitle(empty),
      future: days.dayCardTitle(future),
      week, quarter, year,
      album: "Eat", h1less: "Bites", authored: "Authored", record: "Ramen",
      legacy2024: days.dayCardTitle("2024-01-01"),
      legacy2025: days.dayCardTitle("2025-03-01"),
      legacy2026: days.dayCardTitle("2026-06-01"),
    },
    paths: {
      today: seeded.plan.paths.today,
      yesterday: seeded.plan.paths.yesterday,
      empty: seeded.plan.paths.empty,
      future: seeded.plan.paths.future,
      week: seeded.plan.paths.week,
      quarter: seeded.plan.paths.quarter,
      year: seeded.plan.paths.year,
      legacy2024: "2024/20240101.md",
      legacy2025: seeded.plan.paths.legacy,
      legacy2026: "2026/20260601.md",
      album: "eat.md",
      h1less: "bites.md",
      authored: "authored.md",
      record: "eat/ramen.md",
      links: "links.md",
      ordinary: "ordinary.md",
      area: "body.md",
      surfaces: "title-block-surfaces.md",
      canvas: "title-block.canvas",
    },
  };
  const todayLink = plan.paths.today.replace(/\.md$/, "");
  const notes = {
    ...seeded.notes,
    "type.md": "# Type\n",
    [plan.paths.area]: '---\ntype: "[[area]]"\nparent: "[[type]]"\n---\n\n# Body\n\n## Albums\n',
    [plan.paths.album]: albumNote({
      parent: "body", title: "Eat", summary: "Places to eat.", noun: "restaurant", emoji: "🍽️",
      heading: "Eat",
      extra: "## Source heading\n\n- Body sentinel for Eat.\n",
    }),
    [plan.paths.h1less]: albumNote({
      parent: "body", title: "Bites", summary: "H1-less album.", noun: "bite", titleKey: "Bites",
      extra: "No heading here; the card still owns the title.\n",
    }),
    [plan.paths.authored]: albumNote({
      parent: "body", title: "Authored", summary: "Unrecognized H1 stays.", noun: "item", titleKey: "Authored",
      heading: "Keep this heading",
      extra: "## Source heading\n\n- Body sentinel for the authored album.\n",
    }),
    [plan.paths.record]: recordNote({ album: "eat", title: "Ramen" }),
    [plan.paths.quarter]: quarterNote(quarter),
    [plan.paths.year]: yearNote(year),
    [plan.paths.legacy2024]: h1lessDaily("2024-01-01"),
    [plan.paths.legacy2026]: recognizedLegacy2026(),
    [plan.paths.links]: [
      "---", 'type: "[[note]]"', "---", "", "# Links", "",
      "Jump to [[eat#Source heading]] and to [[" + todayLink + "#Notes]].", "",
      "- Body sentinel for the heading-link source.", "",
    ].join("\n"),
    [plan.paths.surfaces]: [
      "---", 'type: "[[note]]"', "---", "", "# Title-block surfaces", "",
      "## Embeds", "", "![[eat]]", "", "![[eat/ramen]]", "", "![[" + todayLink + "]]", "",
      "## Hover targets", "", "[[eat|Album target]]", "", "[[eat/ramen|Record target]]", "",
      "[[" + todayLink + "|Day target]]", "",
    ].join("\n"),
    [plan.paths.canvas]: "{\n\t\"nodes\":[\n\t\t" + [
      { id: "album", type: "file", file: "eat.md", x: 0, y: 0, width: 360, height: 500 },
      { id: "record", type: "file", file: "eat/ramen.md", x: 420, y: 0, width: 360, height: 500 },
      { id: "day", type: "file", file: plan.paths.today, x: 840, y: 0, width: 360, height: 500 },
    ].map((node) => JSON.stringify(node)).join(",\n\t\t") + "\n\t],\n\t\"edges\":[]\n}",
    [plan.paths.ordinary]: "---\ntype: \"[[note]]\"\n---\n\n# Ordinary\n\nNothing to own here.\n",
  };
  const relative = [plan.paths.today, plan.paths.yesterday, plan.paths.empty, plan.paths.future, plan.paths.week, plan.paths.quarter, plan.paths.year];
  const fixed = [plan.paths.legacy2024, plan.paths.legacy2025, plan.paths.legacy2026];
  for (const name of relative) {
    if (fixed.includes(name)) throw new Error("today-relative fixture collides with a legacy fixture: " + name);
  }
  return { plan, notes };
}

function expectedSpecies() {
  return {
    album: { kind: "album", species: "Album", tile: "stack", hidesSource: true },
    h1less: { kind: "album", species: "Album", tile: "stack", hidesSource: false },
    authored: { kind: "album", species: "Album", tile: "stack", hidesSource: false, authoredH1: true },
    record: { kind: "record", species: "Record", tile: "sheet", hidesSource: false },
    day: { kind: "day", species: "Day", tile: "leaf", hidesSource: true },
    empty: { kind: "day", species: "Day", tile: "leaf", hidesSource: true },
    future: { kind: "day", species: "Day", tile: "leaf", hidesSource: true },
    legacy2024: { kind: "day", species: "Day", tile: "leaf", hidesSource: false },
    legacy2025: { kind: "day", species: "Day", tile: "leaf", hidesSource: false },
    legacy2026: { kind: "day", species: "Day", tile: "leaf", hidesSource: true, keepsNav: true },
    week: { kind: "week", species: "Week", tile: "leaf", hidesSource: true },
    quarter: { kind: "quarter", species: "Quarter", tile: "leaf", hidesSource: true },
    year: { kind: "year", species: "Year", tile: "leaf", hidesSource: true },
  };
}

function slotOf(mode) {
  return mode === "reading" ? "mod-header" : "cm-sizer";
}

function placementFailures(probe, expect) {
  const failures = [];
  if (!probe || probe.status !== "pass") failures.push("probe status: " + (probe && probe.status));
  if (probe.cardCount !== 1) failures.push("cardCount " + probe.cardCount);
  if (probe.embedCardCount !== 0) failures.push("embed cards " + probe.embedCardCount);
  if (!probe.card) return failures.concat("card absent");
  if (probe.card.kind !== expect.kind) failures.push("kind " + probe.card.kind);
  if (probe.card.species !== expect.species) failures.push("species " + probe.card.species);
  if (probe.card.tileForm !== expect.tile) failures.push("tile " + probe.card.tileForm);
  if (probe.card.title !== expect.title) failures.push("title " + JSON.stringify(probe.card.title));
  if (probe.card.slot !== slotOf(expect.mode)) failures.push("slot " + probe.card.slot);
  if (probe.properties.present && !probe.card.beforeProperties) failures.push("card is not before Properties");
  if (probe.title.inlineTitle !== false) failures.push("inline title visible");
  const level = probe.title.levelOne || [];
  const cardHeadings = level.filter((row) => row.card);
  if (cardHeadings.length !== 1) failures.push("card level-1 count " + cardHeadings.length);
  else if (cardHeadings[0].text !== expect.title) failures.push("card heading " + JSON.stringify(cardHeadings[0].text));
  if (expect.authoredH1) {
    if (level.length < 2) failures.push("authored H1 missing from level-1 set");
  } else if (expect.hidesSource) {
    if (level.length !== 1) failures.push("level-1 headings " + JSON.stringify(level));
    if ((probe.title.h1Shown || []).length) failures.push("source H1 visible: " + JSON.stringify(probe.title.h1Shown));
    if (!expect.keepsNav && probe.title.navShown) failures.push("nav visible");
  }
  return failures;
}

function probeSource(notePath, options = {}) {
  const leafId = options && options.leafId;
  const leafExpr = leafId
    ? `app.workspace.getLeafById(${JSON.stringify(leafId)})`
    : `app.workspace.activeLeaf?.view?.file?.path === notePath ? app.workspace.activeLeaf
      : app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === notePath)`;
  return `(() => {
    const notePath = ${JSON.stringify(notePath)};
    const leaf = ${leafExpr};
    const view = leaf?.view;
    if (!view) return { status: "missing-view" };
    const mode = view.getMode?.() || null;
    const source = Boolean(view.getState?.().source);
    const root = mode === "preview" ? view.previewMode?.containerEl : view.contentEl?.querySelector(".markdown-source-view") || view.contentEl;
    const viewScope = mode === "preview"
      ? (root?.matches?.(".markdown-preview-view") ? root : root?.querySelector?.(".markdown-preview-view"))
      : (view.editor?.cm?.dom || root?.querySelector?.(".cm-editor"));
    const inEmbed = (node) => Boolean(node.closest(".markdown-embed, .internal-embed, .hover-popover, .canvas-node"));
    const shown = (node) => {
      if (!node || !node.isConnected) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const visible = (node) => {
      if (!node) return { present: false };
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return { present: true, display: style.display, visibility: style.visibility, rectVisible: rect.width > 0 && rect.height > 0 };
    };
    const cards = Array.from(root?.querySelectorAll(".bob-property-card") || []).filter((node) => !inEmbed(node));
    const embedCards = Array.from(root?.querySelectorAll(".bob-property-card") || []).filter(inEmbed);
    const properties = Array.from(root?.querySelectorAll(".metadata-container") || []).find((node) => !inEmbed(node)) || null;
    const propertyRows = Array.from(root?.querySelectorAll(".metadata-property") || []).filter((node) => !inEmbed(node));
    const ownedPropertyRows = propertyRows.filter((node) => node.classList?.contains("bob-property-card-owned-property"));
    const taggedTitleSources = Array.from(root?.querySelectorAll(".bob-property-card-title-source") || []).filter((node) => !inEmbed(node));
    const card = cards[0] || null;
    const lineSelector = mode === "preview" ? "p, li, h1, h2, div.el-p, .task-list-item" : ".cm-line";
    const lineShown = (needle) => Array.from(root?.querySelectorAll(lineSelector) || [])
      .filter((node) => !inEmbed(node) && !(card && card.contains(node)) && (node.textContent || "").includes(needle) && shown(node)).length;
    const levelOne = Array.from(root?.querySelectorAll('[aria-level="1"], h1, .cm-line.HyperMD-header-1') || [])
      .filter((node) => !inEmbed(node) && shown(node))
      .map((node) => ({ text: (node.textContent || "").trim().slice(0, 120), card: Boolean(card && card.contains(node)) }));
    const inlineTitle = Array.from(root?.querySelectorAll(".inline-title") || []).find((node) => !inEmbed(node)) || null;
    const cursor = (() => {
      const editor = view.editor;
      if (!editor || typeof editor.getCursor !== "function") return null;
      const pos = editor.getCursor();
      const line = editor.getLine(pos.line);
      return { line: pos.line, ch: pos.ch, text: String(line || "").slice(0, 160) };
    })();
    const slotParent = card?.parentElement;
    const heading = (needle) => {
      const nodes = Array.from(root?.querySelectorAll(mode === "preview" ? "h1, h2, h3, .el-h1, .el-h2" : ".cm-line") || [])
        .filter((node) => !inEmbed(node) && (node.textContent || "").includes(needle) && shown(node));
      const node = nodes[0];
      if (!node) return { found: false, needle };
      const rect = node.getBoundingClientRect();
      const viewRect = (root.getBoundingClientRect && root.getBoundingClientRect()) || { top: 0, bottom: innerHeight };
      return {
        found: true, needle, text: (node.textContent || "").trim().slice(0, 120),
        top: rect.top, height: rect.height,
        inViewport: rect.bottom > viewRect.top + 8 && rect.top < viewRect.bottom - 8,
      };
    };
    return {
      status: "pass", path: notePath, mode, source, leafId: leaf.id,
      cardCount: cards.length, embedCardCount: embedCards.length,
      ownsTitle: document.querySelectorAll(".bob-property-card-owns-title").length,
      ownership: {
        localTitleOwner: Boolean(viewScope?.classList?.contains("bob-property-card-owns-title")),
        titleSourceTags: taggedTitleSources.length,
        ownedPropertyRows: ownedPropertyRows.length,
        hiddenOwnedPropertyRows: ownedPropertyRows.filter((node) => getComputedStyle(node).display === "none").length,
        recordPropertyHider: Boolean(root?.querySelector?.(".bob-record-sheet-hides-properties")
          || root?.classList?.contains("bob-record-sheet-hides-properties")),
        titleSlotAvailable: (() => {
          try { return Boolean(app.plugins.plugins["bob-ledger-tools"]?.constructor?.helpers?.propertyCardTitleSlotFor?.(viewScope)); }
          catch (_) { return false; }
        })(),
        titleSlotStats: (() => {
          try { return app.plugins.plugins["bob-ledger-tools"]?.constructor?.helpers?.propertyCardTitleSlotStats?.(viewScope) || null; }
          catch (_) { return null; }
        })(),
      },
      card: card ? {
        kind: card.getAttribute("data-card-kind") || "",
        label: card.getAttribute("aria-label") || "",
        species: card.querySelector(".bob-property-card-kicker-species")?.textContent || "",
        kicker: card.querySelector(".bob-property-card-kicker")?.textContent || "",
        title: card.querySelector(".bob-property-card-title")?.textContent || "",
        tileForm: card.querySelector(".bob-property-card-tile")?.getAttribute("data-tile-form") || "",
        tileBand: card.querySelector(".bob-property-card-tile-band")?.textContent || "",
        slot: slotParent?.classList.contains("cm-sizer") ? "cm-sizer" : slotParent?.classList.contains("mod-header") ? "mod-header" : (slotParent?.className || "body"),
        beforeProperties: Boolean(properties && card.nextElementSibling === properties),
        mounted: shown(card),
        display: getComputedStyle(card).display,
        visibility: getComputedStyle(card).visibility,
      } : null,
      title: {
        inlineTitle: inlineTitle ? shown(inlineTitle) : null,
        levelOne,
        h1Shown: Array.from(root?.querySelectorAll(mode === "preview" ? "h1" : ".cm-line.HyperMD-header-1") || [])
          .filter((node) => !inEmbed(node) && !(card && card.contains(node)) && shown(node))
          .map((node) => (node.textContent || "").trim().slice(0, 120)),
        navShown: lineShown("prev") + lineShown("‹"),
      },
      properties: properties ? { ...visible(properties), rows: propertyRows.length, ownedRows: ownedPropertyRows.length } : { present: false, rows: 0, ownedRows: 0 },
      cursor,
      headings: { source: heading("Source heading"), notes: heading("Notes") },
    };
  })()`;
}

function lifecycleSnapshotSource(notePath, leafId) {
  const state = probeSource(notePath, { leafId });
  return `(() => {
    const leafId = ${JSON.stringify(leafId)};
    const notePath = ${JSON.stringify(notePath)};
    const leaf = app.workspace.getLeafById(leafId);
    const view = leaf?.view;
    const state = view?.file?.path === notePath ? (${state}) : null;
    const plugin = app.plugins.plugins["bob-ledger-tools"] || null;
    const helpers = plugin?.constructor?.helpers || {};
    const count = (selector) => document.querySelectorAll(selector).length;
    return {
      leafId, path: view?.file?.path || null, mode: view?.getMode?.() || null,
      source: Boolean(view?.getState?.().source), state,
      pluginEnabled: Boolean(app.plugins.enabledPlugins?.has?.("bob-ledger-tools")),
      pluginLoaded: Boolean(plugin),
      global: {
        titleOwners: count(".bob-property-card-owns-title"),
        hiddenSourceTags: count(".bob-property-card-title-source"),
        ownedPropertyRows: count(".metadata-property.bob-property-card-owned-property"),
        cards: count(".bob-property-card"),
        titleSlotCards: count(".bob-property-card-title-slot"),
        titleSlotEntries: (() => { try { return helpers.propertyCardTitleSlotLiveCount?.() ?? null; } catch (_) { return null; } })(),
      },
    };
  })()`;
}

function lifecycleObservationSource(notePath, leafId, actionSource) {
  const snapshot = lifecycleSnapshotSource(notePath, leafId);
  return `(() => {
    const sample = () => (${snapshot});
    const before = sample();
    let mutationCount = 0;
    let mutationFrame = null;
    let mutationFramePromise = null;
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(sample())));
    const observer = new MutationObserver((records) => {
      mutationCount += records.length;
      if (!mutationFramePromise) {
        mutationFramePromise = new Promise((resolve) => requestAnimationFrame(() => {
          mutationFrame = sample();
          resolve(mutationFrame);
        }));
      }
    });
    observer.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["class", "style", "data-property-key", "aria-level"],
    });
    return (async () => {
      let actionResult;
      try { actionResult = await (${actionSource})(); }
      finally { observer.disconnect(); }
      const firstObservedFrame = mutationFramePromise ? await mutationFramePromise : await nextFrame();
      const afterActionFrame = await nextFrame();
      return { before, firstObservedFrame, afterActionFrame, mutationCount, actionResult };
    })();
  })()`;
}

function surfaceProbeSource(surfaceKind, targetPath, expectedText, surfaceLeafId, ownerPath, ownerLeafId) {
  const selector = surfaceKind === "hover" ? ".hover-popover"
    : surfaceKind === "canvas" ? ".canvas-node" : ".markdown-embed";
  // Resolve the control by its note path. Obsidian may replace a leaf while
  // splitting/restoring a workspace; a stale id must not make a healthy,
  // still-open control pane appear missing.
  const owner = probeSource(ownerPath);
  return `(() => {
    const target = ${JSON.stringify(targetPath)}.replace(/\\.md$/i, "").toLocaleLowerCase();
    const expectedText = ${JSON.stringify(expectedText)};
    const surfaceKind = ${JSON.stringify(surfaceKind)};
    const leaf = app.workspace.getLeafById(${JSON.stringify(surfaceLeafId)});
    const root = leaf?.view?.getMode?.() === "preview"
      ? leaf.view.previewMode?.containerEl : leaf?.view?.contentEl;
    const normalize = (value) => String(value || "").replace(/\\.md$/i, "").replace(/^\\.\\//, "").toLocaleLowerCase();
    const canvasRows = (() => {
      const rows = leaf?.view?.canvas?.nodes;
      if (rows && typeof rows.values === "function") return Array.from(rows.values());
      if (rows && typeof rows === "object") return Object.values(rows);
      return [];
    })();
    const canvasEntry = (node) => canvasRows.find((entry) => entry?.nodeEl === node
      || entry?.containerEl === node
      || entry?.nodeEl?.contains?.(node)
      || (node?.getAttribute?.("data-node-id") && (entry?.id === node.getAttribute("data-node-id") || entry?.data?.id === node.getAttribute("data-node-id")))) || null;
    const directRefs = (node) => [node?.getAttribute?.("data-href"), node?.getAttribute?.("data-path"), node?.getAttribute?.("src")]
      .map(normalize).filter(Boolean);
    const refs = (node) => {
      const out = directRefs(node);
      if (surfaceKind === "hover") {
        for (const embed of node?.querySelectorAll?.(".markdown-embed, .internal-embed") || []) out.push(...directRefs(embed));
      }
      if (surfaceKind === "canvas") {
        const entry = canvasEntry(node);
        const data = entry?.data || entry || {};
        const file = entry?.file;
        out.push(...[data.file, data.path, file?.path, typeof file === "string" ? file : null].map(normalize).filter(Boolean));
      }
      return [...new Set(out)];
    };
    const candidates = Array.from((surfaceKind === "hover" ? document : root)?.querySelectorAll?.(${JSON.stringify(selector)}) || []);
    const matchesTarget = (node) => refs(node).some((ref) => ref === target || ref.endsWith("/" + target));
    // Obsidian's hover popover renderer does not expose the source path on its
    // wrapper or nested markdown-embed in every supported app build. In this
    // isolated fixture, the target heading is unique, so use that rendered
    // content as the fallback identity while keeping the visibility/content
    // assertions below. Embed and Canvas checks still require path identity.
    const matched = candidates.filter((node) => matchesTarget(node)
      || (surfaceKind === "hover" && expectedText && String(node.textContent || "").includes(expectedText)));
    const visible = (node) => {
      if (!node?.isConnected) return false;
      const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const inViewport = (node) => {
      const rect = node?.getBoundingClientRect?.();
      return Boolean(rect && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth);
    };
    const rows = matched.map((node) => ({
      text: (node.textContent || "").slice(0, 500),
      visible: visible(node),
      inViewport: inViewport(node),
      refs: refs(node),
      matchedBy: matchesTarget(node) ? "path" : "fixture-heading",
      cards: node.querySelectorAll(".bob-property-card").length,
      titleOwners: node.querySelectorAll(".bob-property-card-owns-title").length,
      titleSourceTags: node.querySelectorAll(".bob-property-card-title-source").length,
      titleSlotCards: node.querySelectorAll(".bob-property-card-title-slot").length,
      ownedPropertyRows: node.querySelectorAll(".metadata-property.bob-property-card-owned-property").length,
      expectedTextVisible: Array.from(node.querySelectorAll("h1, h2, h3, p, li, .cm-line, .markdown-preview-section"))
        .some((item) => visible(item) && (item.textContent || "").includes(expectedText)),
    }));
    const control = ${owner};
    const pathValue = (value) => typeof value === "string" ? value
      : (value && typeof value.path === "string" ? value.path : null);
    return {
      surfaceKind, target, path: leaf?.view?.file?.path || null, mode: leaf?.view?.getMode?.() || null,
      candidateCount: candidates.length, matchedCount: matched.length, surfaces: rows,
      candidateDiagnostics: surfaceKind === "hover" ? candidates.map((node) => ({
        className: String(node.className || ""), refs: refs(node), text: (node.textContent || "").slice(0, 240),
        embeds: Array.from(node.querySelectorAll(".markdown-embed, .internal-embed")).map((embed) => ({
          className: String(embed.className || ""), refs: directRefs(embed), text: (embed.textContent || "").slice(0, 160),
        })),
      })) : [],
      canvasFiles: surfaceKind === "canvas" ? canvasRows.map((entry) => {
        const data = entry?.data || entry || {};
        return { id: pathValue(entry?.id) || pathValue(data.id), file: pathValue(data.file) || pathValue(entry?.file) };
      }) : [],
      control: control || null,
      controlOwned: Boolean(control?.ownership?.localTitleOwner && control.cardCount === 1),
      rootReady: Boolean(root),
    };
  })()`;
}

function selfTest() {
  assert.equal(new Set(REQUIRED_CHECKS).size, REQUIRED_CHECKS.length);
  assert.equal(PHASE, "fail-open-proof");
  const args = parseArgs(["--executable", "/x/obsidian", "--out", "/tmp/a", "--report", "/tmp/r.json", "-s", "-h"]);
  assert.deepEqual(args, { executable: "/x/obsidian", out: "/tmp/a", report: "/tmp/r.json", selfTest: true, help: true });
  assert.throws(() => parseArgs(["-e"]), /--executable requires a PATH value/);
  assert.throws(() => parseArgs(["--verbose"]), /Unknown argument: --verbose/);

  const { plan, notes } = fixturePlan("2026-11-20");
  assert.equal(plan.paths.today, "2026/20261120.md");
  assert.equal(plan.paths.week, "2026/2026-W47.md");
  assert.equal(plan.paths.quarter, "2026/2026-Q4.md");
  assert.equal(plan.paths.year, "2026.md");
  assert.equal(plan.titles.today, "Fri, Nov 20, 2026");
  assert.ok(notes["eat.md"].includes("\n# Eat\n"), "before-tidy album keeps its H1");
  assert.ok(!/\ntitle:/.test(notes["eat.md"]), "before-tidy album has no title: key");
  assert.ok(notes["eat.md"].includes("## Source heading"));
  assert.ok(notes["bites.md"].includes("\ntitle: Bites\n"));
  assert.ok(!/\n# /.test(notes["bites.md"]), "h1-less album has no H1");
  assert.ok(notes["authored.md"].includes("\n# Keep this heading\n"));
  assert.ok(notes["authored.md"].includes("\ntitle: Authored\n"));
  assert.ok(notes["eat/ramen.md"].includes('title: "Ramen"'));
  assert.ok(notes["eat/ramen.md"].includes('type: "[[record]]"'));
  assert.ok(!/\n# /.test(notes["eat/ramen.md"]), "record stays H1-less");
  assert.ok(notes[plan.paths.legacy2024].includes("\nday::2024-01-01 Mon\n"));
  assert.ok(!/\n# /.test(notes[plan.paths.legacy2024]), "2024 H1-less");
  assert.ok(notes[plan.paths.legacy2025].includes("\nday::2025-03-01 Sat\n"));
  assert.ok(!/\n# /.test(notes[plan.paths.legacy2025]), "2025 H1-less");
  assert.ok(notes[plan.paths.legacy2026].includes("\n# 2026-06-01 Mon\n"));
  assert.ok(notes[plan.paths.legacy2026].includes(" | "), "recognized 2026 uses the pipe nav");
  assert.ok(notes[plan.paths.week].includes("\n# 2026-W47 · Nov 16 – 22\n"));
  assert.ok(notes[plan.paths.quarter].includes("\n# 2026-Q4 · W40–W53 · Sep 28, 2026 – Jan 3, 2027\n"));
  assert.ok(notes[plan.paths.year].includes("\n# 2026 · Dec 29, 2025 – Jan 3, 2027 · 53 weeks\n"));
  assert.ok(notes[plan.paths.year].includes("[[all_time|↑ All time]]"));
  assert.ok(notes["links.md"].includes("[[eat#Source heading]]"));
  assert.ok(notes["links.md"].includes("[[2026/20261120#Notes]]"));
  fixturePlan("2026-06-15");
  assert.throws(() => fixturePlan("2024-01-01"), /collides/);
  assert.throws(() => fixturePlan("2025-03-01"), /collides/);
  assert.throws(() => fixturePlan("2026-06-01"), /collides/);

  const source = probeSource("eat.md");
  assert.doesNotThrow(() => new Function("return " + source));
  assert.match(source, /^\(\(\) => \{/);
  assert.match(source, /bob-property-card/);
  assert.match(source, /aria-level="1"/);
  assert.doesNotThrow(() => new Function("return " + lifecycleSnapshotSource("eat.md", "leaf-id")));
  assert.doesNotThrow(() => new Function("return " + lifecycleObservationSource("eat.md", "leaf-id", "async () => true")));
  assert.doesNotThrow(() => new Function("return " + surfaceProbeSource("embed", "eat.md", "Eat", "surface", "eat.md", "owner")));

  const healthy = REQUIRED_CHECKS.map((name) => ({ name, status: "pass", mandatory: true }));
  assert.equal(inventoryStatus(healthy).ok, true);
  assert.deepEqual(inventoryStatus(healthy.filter((row) => row.name !== "vim-gg-across-hidden")).missing, ["vim-gg-across-hidden"]);
  const failed = healthy.map((row) => row.name === "edit-undo-restores-bytes" ? { ...row, status: "fail" } : row);
  assert.deepEqual(inventoryStatus(failed).failed, ["edit-undo-restores-bytes"]);
  assert.equal(inventoryStatus([]).ok, false);
  assert.equal(inventoryStatus([]).complete, false);

  const album = { status: "pass", cardCount: 1, embedCardCount: 0, properties: { present: true },
    card: { kind: "album", species: "Album", tileForm: "stack", title: "Eat", slot: "cm-sizer", beforeProperties: true },
    title: { inlineTitle: false, levelOne: [{ text: "Eat", card: true }], h1Shown: [], navShown: 0 } };
  assert.deepEqual(placementFailures(album, { ...expectedSpecies().album, title: "Eat", mode: "live" }), []);
  assert.ok(placementFailures(album, { ...expectedSpecies().album, title: "Eat", mode: "reading" }).length);
}

module.exports = {
  HELP_TEXT, PHASE, REQUIRED_CHECKS, parseArgs, sha256Text, inventoryStatus,
  fixturePlan, expectedSpecies, slotOf, placementFailures, probeSource,
  lifecycleSnapshotSource, lifecycleObservationSource, surfaceProbeSource, selfTest,
  albumListReport, keyEvents: days.keyEvents, dayCardTitle: days.dayCardTitle, localToday: days.localToday,
};
