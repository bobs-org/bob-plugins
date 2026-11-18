#!/usr/bin/env node
// Offline fixture and assertion helpers for the real-Obsidian Record Card proof.
"use strict";

const path = require("node:path");

const HELP_TEXT = [
  "Usage: node scripts/obsidian-record-card-e2e.cjs [OPTIONS]",
  "",
  "Prove the Record Card sheet and native Properties lifecycle in an isolated Obsidian vault.",
  "The default sheet scope proves rendering and hiding only; it never edits record fields.",
  "Run the real walkthrough under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron binary",
  "  -o, --out DIRECTORY    Save PNG screenshots here",
  "  -r, --report PATH      Write the structured JSON report here",
  "  -s, --self-test        Validate fixtures and probes without launching apps",
  "  -h, --help             Print this help",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const input = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < input.length; i += 1) {
    const value = input[i];
    if (value === "-e" || value === "--executable") {
      const next = input[++i];
      if (!next || next.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = next;
    } else if (value === "-o" || value === "--out") {
      const next = input[++i];
      if (!next || next.startsWith("-")) throw new Error("--out requires a DIRECTORY value");
      args.out = next;
    } else if (value === "-r" || value === "--report") {
      const next = input[++i];
      if (!next || next.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = next;
    } else if (value === "-s" || value === "--self-test") {
      args.selfTest = true;
    } else if (value === "-h" || value === "--help") {
      args.help = true;
    } else {
      throw new Error("Unknown argument: " + value);
    }
  }
  return args;
}

function albumNote({ title, parent, noun, fields, extra = "" }) {
  const lines = [
    "---",
    'type: "[[album]]"',
    'parent: "[[' + parent + ']]"',
    "summary: " + title + " record fixtures.",
    "record:",
    "  noun: " + noun,
    "  fields:",
  ];
  for (const [key, schema] of Object.entries(fields)) lines.push("    " + key + ": " + schema);
  lines.push("---", "", "# " + title, "", extra);
  return lines.join("\n");
}

function recordNote({ title, album, fields = {}, body = "", type = "[[record]]", extra = [] }) {
  const lines = [
    "---",
    'type: "' + type + '"',
    'parent: "[[' + album + ']]"',
    "title: " + JSON.stringify(title),
    "created: 2026-11-15",
    ...extra,
  ];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(key + ": " + (typeof value === "string" || Array.isArray(value) ? JSON.stringify(value) : String(value)));
  }
  lines.push("---");
  if (body) lines.push("", body);
  return lines.join("\n") + "\n";
}

function fixtureNotes() {
  return {
    "type.md": "# Type\n",
    "area.md": '---\ntype: "[[area]]"\nparent: "[[type]]"\n---\n\n# Home\n\n## Albums\n',
    "body.md": '---\ntype: "[[area]]"\nparent: "[[area]]"\n---\n\n# Body\n\n## Albums\n',
    "proj.md": '---\ntype: "[[project]]"\nparent: "[[body]]"\nstatus: wip\n---\n\n# Project\n\n## Albums\n',
    "zettels.md": albumNote({
      title: "Zettels", parent: "body", noun: "zettel",
      fields: { status: "{required: true, values: {draft: Draft, ready: Ready}}", claim: "{required: true}", section: "{values: {future: Future Work, current: Current}}" },
    }),
    "movies.md": albumNote({
      title: "Movies", parent: "proj", noun: "movie",
      fields: { status: "{required: true, values: {planned: Planned, watched: Watched}}", verdict: "{values: {loved: Loved, liked: Liked}}", year: "{values: number, min: 1888, max: 2100}", service: "{}", watched_on: "{values: date}", url: "{values: url}" },
    }),
    "eat.md": albumNote({
      title: "Eat", parent: "body", noun: "restaurant",
      fields: { status: "{required: true, values: {to_try: To try, liked: Liked}}", location: "{required: true, suggest: true}", category: "{required: true, suggest: true}" },
    }),
    "bank.md": '---\ntype: "[[area]]"\nparent: "[[cash]]"\nbank:\n  accounts:\n    checking:\n      kind: checking\n      start: 2026-11-01\n---\n\n# Bank\n',
    "subscriptions.md": albumNote({
      title: "Subscriptions", parent: "bank", noun: "subscription",
      fields: {
        status: "{required: true, values: {to_cancel: To cancel, to_decide: To decide, active: Active, cancelled: Cancelled}}",
        amount: "{required: true, values: number, min: 0}",
        cadence: "{required: true, values: {monthly: Monthly, four_weekly: Every four weeks, quarterly: Quarterly, yearly: Yearly}}",
        pricing: "{default: fixed, values: {fixed: Fixed, variable: Variable}}",
        match: "{list: true}", category: "{suggest: true}", url: "{values: url}",
        renews: "{values: date}", ended: "{values: date}",
      },
    }),
    "missing.md": albumNote({
      title: "Missing", parent: "body", noun: "missing",
      fields: { status: "{required: true, values: {open: Open, done: Done}}", claim: "{required: true}" },
    }),
    "broken.md": [
      "---", 'type: "[[album]]"', 'parent: "[[body]]"', "summary: Broken album.",
      "record: []", "---", "", "# Broken", "",
    ].join("\n"),
    "zettels/bead_lifecycle.md": recordNote({
      title: "Bead Lifecycle", album: "zettels",
      fields: { status: "draft", claim: "Triage the lifecycle carefully.", section: "future" },
      body: "## Notes\n\n- First note bullet. See [[movies/embedded-record]].\n\n## Source\n\n- [Reference](https://example.test/source)",
      extra: ["lid: zettel-42", "source_url: https://example.test/source"],
    }),
    "zettels/frontmatter-only.md": recordNote({
      title: "Frontmatter Only", album: "zettels",
      fields: { status: "ready", claim: "No body follows the closing delimiter." },
    }),
    "zettels/legacy-heading.md": recordNote({
      title: "Legacy Heading", album: "zettels", fields: { status: "ready", claim: "Keep this authored heading." },
      body: "# Legacy Heading\n\nThe authored H1 must remain.",
    }),
    "movies/equilibrium.md": recordNote({
      title: "Equilibrium", album: "movies",
      fields: { status: "watched", verdict: "loved", year: 2002, match: ["Hulu"] },
      body: "## Notes\n\n- A sparse record with optional fields folded below.\n\n![[movies/embedded-record]]\n\n- See [[movies/embedded-record]] for more.",
      extra: ["source_url: https://example.test/movie"],
    }),
    "movies/embedded-record.md": recordNote({
      title: "Embedded Record", album: "movies", fields: { status: "planned", year: 2027 },
      body: "## Notes\n\n- Embedded note properties stay visible.",
    }),
    "eat/restaurant.md": recordNote({
      title: "Cranford Ramen", album: "eat",
      fields: { status: "liked", location: "[[nj_towns#^z-cranford|cranford]]", category: "Ramen" },
      body: "## Notes\n\n- Legacy keys and a wikilink location.",
      extra: ["lid: restaurant-7", "source_title: Local guide", "source_url: https://example.test/ramen"],
    }),
    "subscriptions/streamer.md": recordNote({
      title: "StreamCo", album: "subscriptions",
      fields: { status: "active", amount: 12.99, cadence: "monthly", match: ["StreamCo", "StreamCo Plus"] },
      body: "## Notes\n\n- Match is a list.",
    }),
    "missing/record.md": recordNote({ title: "Missing Required", album: "missing", fields: { status: "open" }, body: "## Notes\n\n- Claim is intentionally missing." }),
    "broken/record.md": recordNote({ title: "Broken Schema Record", album: "broken", fields: { status: "unknown" }, body: "## Notes\n\n- Broken album schema leaves Properties visible." }),
    "bank/2026-11.md": '---\ntype: "[[bank_month]]"\nparent: "[[bank]]"\ntitle: "November 2026"\n---\n\n# November 2026\n',
    "eat/legacy-type.md": recordNote({ title: "Legacy Noun", album: "eat", fields: { status: "liked", location: "Cranford", category: "Ramen" }, type: "[[restaurant]]", body: "## Notes\n\n- Legacy noun types fail open." }),
    "ordinary.md": '---\ntype: "[[note]]"\nparent: "[[body]]"\n---\n\n# Ordinary\n\n![[movies/equilibrium]]\n',
    "misfiled.md": recordNote({ title: "Misfiled", album: "movies", fields: { status: "planned", year: 2027 }, body: "## Notes\n\n- Outside the album folder." }),
    "nj_towns.md": '---\ntype: "[[reference]]"\n---\n\n# New Jersey towns\n\nCranford\n',
  };
}

function pathOf(element) {
  return Array.isArray(element?.path) ? element.path.map((part) => ({
    tag: String(part.tag || "").toLowerCase(),
    classes: Array.isArray(part.classes) ? part.classes.slice() : [],
  })) : [];
}

function frontmatterBodyCursorExpression(notePath, closingDelimiter = false) {
  const note = JSON.stringify(String(notePath || ""));
  return String.raw`(() => {
    const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === ${note});
    const cm = leaf?.view?.editor?.cm;
    if (!cm) return { ok: false, reason: "Live Preview CodeMirror view unavailable" };
    const text = cm.state.doc.toString();
    const close = text.indexOf("\n---", text.indexOf("---") + 3);
    if (close < 0) return { ok: false, reason: "frontmatter closing delimiter missing" };
    const firstBodyLine = text.indexOf("\n", close + 1);
    const target = ${closingDelimiter} ? close + 4 : firstBodyLine < 0 ? cm.state.doc.length : firstBodyLine + 1;
    cm.dispatch({ selection: { anchor: target }, scrollIntoView: true });
    return { ok: cm.state.selection.main.head === target, target, actual: cm.state.selection.main.head, textLength: cm.state.doc.length,
      delimiter: text.slice(close + 1, close + 4), bodyLine: text.slice(target).split(/\r?\n/)[0] };
  })()`;
}

function assertNativeVisibility(probe, shouldHide) {
  if (!probe || probe.status !== "pass") throw new Error("DOM probe is missing or failed");
  const elements = [probe.properties, probe.inlineTitle, probe.addProperty];
  const labels = ["native Properties", "native inline title", "Add property"];
  for (let index = 0; index < elements.length; index += 1) {
    const item = elements[index];
    if (!item || item.present !== true) throw new Error(labels[index] + " is absent; presence must be checked");
    const hidden = item.display === "none" || item.visibility === "hidden" || item.rectVisible === false;
    const expectedHidden = index === 1 && shouldHide;
    if (hidden !== expectedHidden) {
      throw new Error(labels[index] + " visibility mismatch: expected " + (expectedHidden ? "hidden" : "visible") + ", saw " + JSON.stringify(item));
    }
  }
  if (!Array.isArray(probe.propertyRows) || !probe.propertyRows.length) throw new Error("native Properties rows are absent");
  const expectedKeys = probe.authoredKeys || [];
  const rows = probe.propertyRows;
  for (const key of expectedKeys) {
    if (rows.filter((row) => row.key === key).length !== 1) throw new Error("native Properties key missing or duplicated: " + key);
  }
  const schemaKeys = new Set(probe.schemaKeys || []);
  if (probe.titlePropertyInSheet) schemaKeys.add("title");
  for (const row of rows) {
    if (row.present !== true) throw new Error("native property row is absent: " + row.key);
    const hidden = row.display === "none" || row.visibility === "hidden" || row.rectVisible === false;
    if (hidden !== (shouldHide && schemaKeys.has(row.key))) {
      throw new Error("native property visibility mismatch: " + row.key);
    }
  }
  return true;
}

function isExpectedFixtureAlbumSync(result) {
  const report = result?.report;
  if (!result || result.exitCode !== 1 || result.signal || report?.command !== "sync" ||
      report.ok !== false || report.schema_version !== 1) return false;
  if (report.counts?.errors !== 2 || report.counts?.damaged !== 1 || report.counts?.warnings !== 0 ||
      report.sync?.pre !== "ok" || report.sync?.post !== "ok" ||
      !Array.isArray(report.io_errors) || report.io_errors.length !== 0 ||
      !Array.isArray(report.findings) || report.findings.length !== 3) return false;
  const findings = report.findings.map(({ code, path, severity }) => [path, code, severity].join("\u0000")).sort();
  const expected = [
    ["broken.md", "album_index_damaged", "error"],
    ["broken.md", "album_schema_invalid", "error"],
    ["misfiled.md", "album_child_reparent", "info"],
  ].map((row) => row.join("\u0000")).sort();
  return findings.every((finding, index) => finding === expected[index]);
}

function isExpectedFixtureAlbumList(result) {
  const report = result?.report;
  const expectedArgs = ["albums", "list", "-f", "json"];
  if (!result || result.exitCode !== 0 || result.signal ||
      !Array.isArray(result.args) || result.args.length !== expectedArgs.length ||
      !result.args.every((arg, index) => arg === expectedArgs[index]) ||
      report?.schema_version !== 1 || report.ok !== false ||
      report.counts?.errors !== 2 || report.counts?.warnings !== 0 ||
      report.counts?.records !== 10 ||
      !Array.isArray(report.capabilities) || !report.capabilities.includes("record_values_v1") ||
      !Array.isArray(report.albums)) return false;
  const issues = report.albums.flatMap((album) => (album.issues || []).map(({ code, path, severity }) =>
    [path, code, severity].join("\u0000"))).sort();
  const expected = [
    ["broken.md", "album_index_damaged", "error"],
    ["broken.md", "album_schema_invalid", "error"],
    ["misfiled.md", "album_child_reparent", "info"],
  ].map((row) => row.join("\u0000")).sort();
  return issues.length === expected.length && issues.every((issue, index) => issue === expected[index]);
}

function fixtureNotesHashShape(notes) {
  return Object.keys(notes).filter((name) => name.endsWith(".md")).sort();
}

function selfTest() {
  const notes = fixtureNotes();
  const expected = [
    "zettels/bead_lifecycle.md",
    "movies/equilibrium.md",
    "eat/restaurant.md",
    "subscriptions/streamer.md",
    "missing/record.md",
    "broken/record.md",
    "bank/2026-11.md",
    "bank.md",
    "zettels/frontmatter-only.md",
    "zettels/legacy-heading.md",
    "movies/embedded-record.md",
    "eat/legacy-type.md",
    "misfiled.md",
  ];
  for (const name of expected) {
    if (!notes[name]) throw new Error("fixture missing " + name);
  }
  for (const name of ["zettels/bead_lifecycle.md", "movies/equilibrium.md", "eat/restaurant.md", "subscriptions/streamer.md"]) {
    if (!/type: "\[\[record\]\]"/.test(notes[name])) throw new Error("positive fixture must use canonical type: " + name);
  }
  if (!notes["zettels/frontmatter-only.md"].trimEnd().endsWith("---")) throw new Error("frontmatter-only fixture must end at closing delimiter");
  if (!notes["zettels/legacy-heading.md"].includes("# Legacy Heading")) throw new Error("legacy H1 fixture is missing");
  if (!notes["movies/equilibrium.md"].includes("![[movies/embedded-record]]")) throw new Error("record embed fixture is missing");
  if (!notes["eat/restaurant.md"].includes("[[nj_towns#^z-cranford|cranford]]")) throw new Error("wikilink fixture is missing");
  if (!notes["subscriptions/streamer.md"].includes("match: [\"StreamCo\",\"StreamCo Plus\"]")) throw new Error("list fixture is missing");
  if (!notes["broken.md"].includes("record: []")) throw new Error("broken schema fixture is missing");
  if (!notes["bank/2026-11.md"].includes('type: "[[bank_month]]"')) throw new Error("bank-month lookalike is missing");
  if (notes["misfiled.md"].includes("movies/")) throw new Error("misfiled record should live outside the album folder");
  const parsed = parseArgs(["-e", "/opt/obsidian", "-o", "/tmp/shots", "-r", "/tmp/report.json", "--self-test"]);
  if (!parsed.selfTest || parsed.executable !== "/opt/obsidian" || parsed.out !== "/tmp/shots" || parsed.report !== "/tmp/report.json") {
    throw new Error("argument parser fixture failed");
  }
  const shown = { present: true, display: "block", visibility: "visible", rectVisible: true };
  const concealed = { ...shown, display: "none", rectVisible: false };
  const visible = {
    status: "pass", properties: shown, inlineTitle: shown, addProperty: shown,
    authoredKeys: ["status", "parent"], schemaKeys: ["status"],
    propertyRows: [{ key: "status", ...shown }, { key: "parent", ...shown }],
  };
  const hidden = { ...visible, inlineTitle: concealed,
    propertyRows: [{ key: "status", ...concealed }, { key: "parent", ...shown }] };
  assertNativeVisibility(hidden, true);
  assertNativeVisibility(visible, false);
  for (const wrong of [
    { ...hidden, properties: concealed },
    { ...hidden, addProperty: concealed },
    { ...hidden, addProperty: { ...shown, present: false } },
    { ...hidden, propertyRows: visible.propertyRows },
    { ...hidden, properties: { ...shown, present: false } },
    { ...hidden, propertyRows: [{ key: "status", ...concealed }, { key: "parent", ...concealed }] },
    { ...hidden, propertyRows: [] },
  ]) {
    let failed = false;
    try { assertNativeVisibility(wrong, true); }
    catch (_) { failed = true; }
    if (!failed) throw new Error("negative DOM assertion unexpectedly passed");
  }
  if (pathOf({ path: [{ tag: "DIV", classes: ["cm-sizer"] }] })[0].tag !== "div") throw new Error("DOM path normalizer failed");
  const files = fixtureNotesHashShape(notes);
  if (!files.includes("bank/2026-11.md") || !files.includes("movies/embedded-record.md")) throw new Error("fixture inventory omitted a negative case");
  process.stdout.write("offline self-test complete (record fixtures, hide assertions, and negative probes; no Obsidian or bob launched)\n");
}

module.exports = {
  HELP_TEXT,
  albumNote,
  assertNativeVisibility,
  fixtureNotes,
  fixtureNotesHashShape,
  frontmatterBodyCursorExpression,
  isExpectedFixtureAlbumSync,
  isExpectedFixtureAlbumList,
  parseArgs,
  pathOf,
  recordNote,
  selfTest,
};
