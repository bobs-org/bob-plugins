#!/usr/bin/env node
// Pure fixture, probe, and assertion helpers for the album UI real-Obsidian e2e.
// Offline self-test imports these so missing cards, fold math, and argv
// mistakes fail without launching Obsidian.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FIXTURE_TODAY = "2026-11-12";
const FIXTURE_NOW = `${FIXTURE_TODAY}T12:00:00-05:00`;

const HELP_TEXT = [
  "Usage: node scripts/obsidian-album-ui-e2e.cjs [OPTIONS]",
  "",
  "Drive album owner cards, record folds, date chips, header, and sync",
  "in an isolated scratch vault through CDP. Never opens the live vault.",
  "Run under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian executable (default: /snap/obsidian/current/app/obsidian)",
  "  -h, --help              Print this help and exit",
  "  -o, --out DIRECTORY     Screenshot output directory",
  "  -r, --report PATH       Write the structured JSON report to PATH",
  "  -s, --self-test         Run offline self-tests (no Obsidian needed)",
].join("\n");

function scratchRoot(repoRoot) {
  return path.join(path.resolve(repoRoot), ".tmp-album-e2e");
}

function makeScratch(repoRoot, prefix) {
  const root = scratchRoot(repoRoot);
  fs.mkdirSync(root, { recursive: true });
  const safe = String(prefix || "run").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "") || "run";
  return fs.mkdtempSync(path.join(root, `${safe}-`));
}

function parseArgs(argv) {
  const args = { executable: null, help: false, out: null, report: null, selfTest: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (token === "-e" || token === "--executable" || token === "--obsidian-bin") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = value;
    } else if (token === "-h" || token === "--help") {
      args.help = true;
    } else if (token === "-o" || token === "--out") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--out requires a DIRECTORY value");
      args.out = value;
    } else if (token === "-r" || token === "--report") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = value;
    } else if (token === "-s" || token === "--self-test") {
      args.selfTest = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function areaNote(title, extra = "") {
  return ["---", 'type: "[[area]]"', 'parent: "[[area]]"', "---", "", `# ${title}`, "", extra].join("\n");
}

function projectNote(title, parent) {
  return ["---", 'type: "[[project]]"', `parent: "[[${parent}]]"`, "---", "", `# ${title}`, ""].join("\n");
}

function albumNote({ parent, title, summary, noun, emoji, indexBy, fields }) {
  const lines = ["---", 'type: "[[album]]"', `parent: "[[${parent}]]"`, `summary: ${summary}`];
  if (emoji) lines.push(`emoji: ${emoji}`);
  if (indexBy) lines.push(`index_by: ${indexBy}`);
  lines.push("record:");
  lines.push(`  noun: ${noun}`);
  if (fields) {
    lines.push("  fields:");
    for (const [key, body] of Object.entries(fields)) lines.push(`    ${key}: ${body}`);
  }
  lines.push("---", "", `# ${title}`, "");
  return lines.join("\n");
}

function restaurantFields() {
  return {
    status: "{required: true, values: {to_try: 🔖 To try, liked: 💚 Liked}}",
    location: "{required: true, suggest: true}",
    category: "{required: true, suggest: true}",
  };
}

function recordNote({ album, noun, title, status, location, created, visited, watchedOn }) {
  const lines = [
    "---",
    `parent: "[[${album}]]"`,
    `type: "[[${noun}]]"`,
    `title: ${JSON.stringify(title)}`,
    `status: ${status}`,
    "category: Ramen",
    `location: ${location}`,
    `created: ${created}`,
  ];
  if (visited !== undefined) lines.push(`visited: ${visited}`);
  if (watchedOn !== undefined) lines.push(`watched_on: ${watchedOn}`);
  lines.push("---", "", `# ${title}`, "");
  return lines.join("\n");
}

function fixtureNotes() {
  const notes = {
    "area.md": '---\nparent: "[[type]]"\n---\n\n# Area\n',
    "type.md": "# Type\n",
    "body.md": areaNote("Body", "## Albums\n"),
    "proj.md": projectNote("Eating Out", "body"),
    "eat.md": albumNote({
      parent: "body",
      title: "Eat",
      summary: "Places to eat around here.",
      noun: "restaurant",
      emoji: "🍽️",
      indexBy: "location",
      fields: restaurantFields(),
    }),
    "movies.md": albumNote({
      parent: "proj",
      title: "Movies",
      summary: "Films to watch.",
      noun: "movie",
      emoji: null,
      indexBy: null,
      fields: { year: "{values: number}" },
    }),
    "empty.md": albumNote({
      parent: "body",
      title: "Empty",
      summary: "Nothing here yet.",
      noun: "spot",
      emoji: null,
      indexBy: null,
      fields: { status: "{values: {to_try: To try}}" },
    }),
    "broken.md": [
      "---",
      'type: "[[album]]"',
      'parent: "[[body]]"',
      "summary: Broken.",
      "record: []",
      "---",
      "# Broken",
      "",
    ].join("\n"),
    "stale-owner.md": areaNote("Stale Owner", "## Albums\n"),
    "tools.md": ["---", 'type: "[[notebook]]"', 'parent: "[[body]]"', "summary: Kitchen tools.", "---", "", "# Tools", ""].join(
      "\n",
    ),
    "h1less-album.md": [
      "---",
      'type: "[[album]]"',
      'parent: "[[body]]"',
      "summary: H1-less album.",
      "record:",
      "  noun: bite",
      "---",
      "",
      "No heading here; the header must still render one.",
      "",
    ].join("\n"),
    "unrelated.md": ["---", 'type: "[[note]]"', 'parent: "[[body]]"', "record: {noun: stray}", "---", "", "# Unrelated", ""].join(
      "\n",
    ),
  };
  // Healthy grouped records under eat/: first group to_try (2, expanded),
  // later group liked (13, folded) with location subgroups.
  const downtown = ["Downtown", "downtown", "[[Downtown]]", "Uptown", "Midtown", "Downtown", "Uptown"];
  let seq = 0;
  const add = (name, body) => {
    notes[name] = body;
  };
  add(
    "eat/a-one.md",
    recordNote({
      album: "eat",
      noun: "restaurant",
      title: "A One",
      status: "to_try",
      location: "Downtown",
      created: "2026-11-11",
      visited: "2026-11-10",
    }),
  );
  add(
    "eat/a-two.md",
    recordNote({
      album: "eat",
      noun: "restaurant",
      title: "A Two",
      status: "to_try",
      location: "Uptown",
      created: "2026-11-11",
      watchedOn: "2026-11-01",
    }),
  );
  const extras = [
    { title: "Both Dates", visited: "2026-11-08", watchedOn: "2026-11-09" },
    { title: "Visited Only", visited: "2026-11-10" },
    { title: "Watched Only", watchedOn: "2026-11-01" },
    { title: "Bad Dates", visited: "not-a-date", watchedOn: "bogus" },
    { title: "Future Visit", visited: "2026-12-01" },
  ];
  extras.forEach((extra, index) => {
    seq += 1;
    add(
      `eat/liked-${String(index + 1).padStart(2, "0")}.md`,
      recordNote({
        album: "eat",
        noun: "restaurant",
        title: extra.title,
        status: "liked",
        location: downtown[index % downtown.length],
        created: "2026-11-01",
        visited: extra.visited,
        watchedOn: extra.watchedOn,
      }),
    );
  });
  for (let i = extras.length; i < 13; i += 1) {
    seq += 1;
    add(
      `eat/liked-${String(i + 1).padStart(2, "0")}.md`,
      recordNote({
        album: "eat",
        noun: "restaurant",
        title: `Liked ${i + 1}`,
        status: "liked",
        location: downtown[i % downtown.length],
        created: "2026-11-01",
      }),
    );
  }
  void seq;
  add(
    "movies/m-one.md",
    [
      "---",
      'parent: "[[movies]]"',
      'type: "[[movie]]"',
      'title: "M One"',
      "year: 2024",
      "created: 2026-11-02",
      "---",
      "",
      "# M One",
      "",
    ].join("\n"),
  );
  return notes;
}

function writerFixtureNotes() {
  const notes = fixtureNotes();
  notes["typed.md"] = [
    "---",
    'type: "[[album]]"',
    'parent: "[[body]]"',
    "summary: Typed checks.",
    "record:",
    "  noun: gadget",
    "  fields:",
    "    count: {values: number, min: 1, max: 10, default: 2}",
    "    flag: {required: false}",
    "    tags: {list: true}",
    "---",
    "",
    "# Typed",
    "",
  ].join("\n");
  return notes;
}

function writerRequiredNoteNames() {
  return requiredNoteNames().concat(["typed.md"]);
}

function assertUpdateShape(result, { dryRun = false } = {}) {
  if (!result || typeof result !== "object") return { ok: false, reason: "update result is not an object" };
  if (result.schema_version !== 1) return { ok: false, reason: "schema_version must be 1" };
  if (result.command !== "update") return { ok: false, reason: "command must be update" };
  if (typeof result.ok !== "boolean") return { ok: false, reason: "ok must be boolean" };
  if (result.dry_run !== dryRun) return { ok: false, reason: `dry_run must be ${dryRun}` };
  if (typeof result.stem !== "string" || !result.stem) return { ok: false, reason: "stem must be nonempty" };
  if (typeof result.changed !== "boolean") return { ok: false, reason: "changed must be boolean" };
  if (typeof result.before_fingerprint !== "string" || typeof result.after_fingerprint !== "string") {
    return { ok: false, reason: "fingerprints must be strings" };
  }
  if (!Array.isArray(result.per_op)) return { ok: false, reason: "per_op must be an array" };
  if (!Array.isArray(result.inverse_ops)) return { ok: false, reason: "inverse_ops must be an array" };
  if (!Array.isArray(result.warnings)) return { ok: false, reason: "warnings must be an array" };
  if (!("commit" in result)) return { ok: false, reason: "result must carry commit (possibly null)" };
  if (!("sync" in result)) return { ok: false, reason: "result must carry sync (possibly null)" };
  if (!("error" in result)) return { ok: false, reason: "result must carry error (possibly null)" };
  return { ok: true };
}

function assertRefusal(result, code) {
  const shaped = assertUpdateShape(result, { dryRun: result && result.dry_run === true });
  if (!shaped.ok) return shaped;
  if (result.ok !== false) return { ok: false, reason: "refusal must report ok:false" };
  if (!result.error || result.error.code !== code) {
    return { ok: false, reason: `refusal code must be ${code}, saw ${(result.error && result.error.code) || "none"}` };
  }
  if (result.changed !== false) return { ok: false, reason: "refusal must report changed:false" };
  if (result.commit !== null && result.commit !== undefined) return { ok: false, reason: "refusal must not carry a commit" };
  return { ok: true };
}

function assertLinearHistory(subjects) {
  const bad = (Array.isArray(subjects) ? subjects : []).filter((subject) =>
    /\brevert\b|\bmerge\b/i.test(String(subject || "")),
  );
  if (bad.length) return { ok: false, reason: `history must stay linear, saw: ${bad.slice(0, 3).join(" | ")}` };
  return { ok: true };
}

function requiredNoteNames() {
  return [
    "area.md",
    "type.md",
    "body.md",
    "proj.md",
    "eat.md",
    "movies.md",
    "empty.md",
    "broken.md",
    "stale-owner.md",
    "tools.md",
    "h1less-album.md",
    "unrelated.md",
    "eat/a-one.md",
    "eat/a-two.md",
    "movies/m-one.md",
  ];
}

function assertHasCallout(content, callout) {
  if (!String(content).includes(`[!${callout}]`)) return { ok: false, reason: `missing [!${callout}] callout` };
  return { ok: true };
}

function assertListShape(report) {
  if (!report || typeof report !== "object") return { ok: false, reason: "report is not an object" };
  if (report.ok !== true && report.ok !== false) return { ok: false, reason: "report.ok must be boolean" };
  if (!Array.isArray(report.albums)) return { ok: false, reason: "report.albums must be an array" };
  if (!Array.isArray(report.catalogs)) return { ok: false, reason: "report.catalogs must be an array" };
  const eat = report.albums.find((entry) => entry && entry.stem === "eat");
  if (!eat) return { ok: false, reason: "report is missing the eat album" };
  if (!eat.index || typeof eat.index.state !== "string") {
    return { ok: false, reason: "eat.index.state must be an object with a state string, never a bare string" };
  }
  if (typeof eat.index.state !== "string" || eat.index.state.length === 0) {
    return { ok: false, reason: "eat.index.state must be nonempty" };
  }
  if (!Array.isArray(eat.issues)) return { ok: false, reason: "eat.issues must be an array" };
  if (!Array.isArray(eat.groups)) return { ok: false, reason: "eat.groups must be an array" };
  for (const group of eat.groups) {
    if (!group || typeof group.value !== "string") return { ok: false, reason: "group.value must be a string" };
    if (!Array.isArray(group.peek)) return { ok: false, reason: "group.peek must be an array" };
    if (group.peek.length > 3) return { ok: false, reason: "group.peek must hold at most three titles" };
  }
  if (!("last_record" in eat)) return { ok: false, reason: "eat must carry last_record (possibly null)" };
  return { ok: true };
}

function assertFoldRule({ firstCount, laterCount, laterSubgroups }) {
  if (!(firstCount <= 12)) return { ok: false, reason: "first group fixture must stay at or below 12 for the expanded default" };
  if (!(laterCount > 12)) return { ok: false, reason: "later group fixture must exceed 12 records to fold" };
  if (!laterSubgroups) return { ok: false, reason: "later group fixture must carry index_by subgroups" };
  return { ok: true };
}

function assertNoMathLeak({ mathCount }) {
  if (Number(mathCount) !== 0) return { ok: false, reason: `presentation must not leak math (count=${mathCount})` };
  return { ok: true };
}

function assertHeaderIntegrity(probe) {
  if (!Array.isArray(probe?.activeHeaders) || probe.activeHeaders.length !== 1) {
    return { ok: false, reason: `expected one album header, saw ${probe?.activeHeaders?.length ?? "no probe"}` };
  }
  if (!Array.isArray(probe.ancestryWarnings) || probe.ancestryWarnings.length !== 0) {
    return { ok: false, reason: "resolved owner chain must not show an ancestry warning" };
  }
  if (!Array.isArray(probe.headersInRecords) || probe.headersInRecords.length !== 0) {
    return { ok: false, reason: "records callout must not contain album headers" };
  }
  return { ok: true };
}

function albumUiProbe() {
  return `(() => { try {
    const describe = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = (el.ownerDocument?.defaultView || window).getComputedStyle(el);
      return {
        className: String(el.className || ""),
        text: String(el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 220),
        href: el.getAttribute && (el.getAttribute("data-href") || el.getAttribute("href") || ""),
        card: el.getAttribute && (el.getAttribute("data-bob-album-card") || el.getAttribute("data-bob-records-card") || ""),
        state: el.getAttribute && (el.getAttribute("data-stale") || ""),
        group: el.getAttribute && (el.getAttribute("data-bob-records-group") || ""),
        folded: el.getAttribute && (el.getAttribute("data-bob-records-folded") || ""),
        tag: el.tagName,
        w: rect.width,
        h: rect.height,
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
        embed: Boolean(el.closest && el.closest(".markdown-embed, .internal-embed")),
      };
    };
    const file = window.app && window.app.workspace && window.app.workspace.getActiveFile && window.app.workspace.getActiveFile();
    const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
    const schemaRoot = plugin?.albumSchemaCardModal?.contentEl || document;
    const schemaDoc = schemaRoot.ownerDocument || document;
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map(describe);
    const schemaPick = (sel) => Array.from(schemaRoot.querySelectorAll(sel)).map(describe);
    const leafView = window.app && window.app.workspace && window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
    const state = leafView && typeof leafView.getState === "function" ? leafView.getState() : {};
    const header = pick(".bob-album-header");
    const activeSurface = leafView?.containerEl?.querySelector(state.mode === "source"
      ? ".markdown-source-view" : ".markdown-preview-view");
    const activePick = (selector) => Array.from(activeSurface?.querySelectorAll(selector) || []).map(describe);
    return {
      path: file && file.path,
      mode: state.mode || null,
      source: state.source,
      ownerCards: pick('[data-callout="albums"]'),
      recordCards: pick('[data-callout="records"]'),
      counts: pick(".bob-album-count"),
      leads: pick(".bob-album-lead"),
      peeks: pick(".bob-album-peek"),
      ages: pick(".bob-album-age"),
      health: pick(".bob-album-health"),
      actions: pick(".bob-album-action"),
      headers: header,
      activeHeaders: activePick(".bob-album-header"),
      ancestryWarnings: activePick(".bob-album-header-ancestry-note"),
      headersInRecords: activePick('[data-callout="records"] .bob-album-header'),
      crumbs: pick(".bob-album-header-crumb, .bob-album-header a.internal-link"),
      copy: pick(".bob-album-header-copy"),
      schemas: pick(".bob-album-schema-card"),
      schemaFields: pick(".bob-album-schema-field"),
      schemaOpeners: pick(".bob-album-header-schema"),
      schemaDialogs: schemaPick(".bob-album-schema-dialog"),
      schemaTargets: schemaPick("[data-target-key]"),
      schemaActions: schemaPick("[data-schema-action]"),
      schemaConsequence: schemaPick(".bob-album-schema-consequence-text"),
      schemaCounts: schemaPick(".bob-album-schema-consequence-counts"),
      schemaDerived: schemaPick(".bob-album-schema-derived-keys"),
      schemaRefusal: schemaPick(".bob-album-schema-refusal"),
      schemaRefusalHint: schemaPick(".bob-album-schema-refusal-hint"),
      schemaStage: schemaPick("[data-schema-stage]"),
      schemaInputs: schemaPick("[data-schema-input]"),
      schemaToolbar: schemaPick(".bob-album-schema-toolbar"),
      schemaFooter: schemaPick(".bob-album-schema-dialog-footer"),
      schemaUndo: schemaPick('[data-schema-action="undo"]'),
      schemaSyncWarning: schemaPick(".bob-album-schema-sync-warning"),
      schemaUnlabeled: Array.from(schemaRoot.querySelectorAll(".bob-album-schema-dialog button")).map((el) => ({
        text: String(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
        labeled: Boolean((el.getAttribute("aria-label") || "").trim() || (el.textContent || "").trim()),
      })).filter((entry) => !entry.labeled),
      recordGroups: pick(".bob-records-group"),
      folds: pick(".bob-records-fold"),
      dateChips: pick(".bob-records-age"),
      recordProps: Array.from(document.querySelectorAll('.metadata-property[data-property-key="record"]')).map(describe),
      headerSurfaces: pick(".bob-album-header-surface"),
      status: pick(".bob-album-status"),
      retry: pick(".bob-album-action[data-action-kind=\\"retry\\"], button.bob-album-action"),
      plugin: Boolean(plugin),
      active: (schemaDoc.activeElement || document.activeElement) ? {
        tag: (schemaDoc.activeElement || document.activeElement).tagName,
        className: String((schemaDoc.activeElement || document.activeElement).className || ""),
        href: (schemaDoc.activeElement || document.activeElement).getAttribute && (schemaDoc.activeElement || document.activeElement).getAttribute("data-href"),
      } : null,
    };
  } catch (e) { return { error: String(e && e.message || e) }; } })()`;
}

module.exports = {
  FIXTURE_TODAY,
  FIXTURE_NOW,
  HELP_TEXT,
  scratchRoot,
  makeScratch,
  parseArgs,
  fixtureNotes,
  requiredNoteNames,
  writerFixtureNotes,
  writerRequiredNoteNames,
  assertUpdateShape,
  assertRefusal,
  assertLinearHistory,
  assertHasCallout,
  assertListShape,
  assertFoldRule,
  assertNoMathLeak,
  assertHeaderIntegrity,
  albumUiProbe,
  albumNote,
  recordNote,
  restaurantFields,
};
