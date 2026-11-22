#!/usr/bin/env node
// Render LINK band states to HTML for visual review (light + dark).
//   node scripts/preview-link-band.cjs [--out DIR] [--self-test]
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const repoRoot = path.resolve(__dirname, "..");
const cssPath = path.join(repoRoot, "plugins/bob-navigation-hotkeys/styles.css");

class FakeEl {
  constructor(tag = "div") {
    this.tag = tag;
    this.classes = [];
    this.attrs = {};
    this.children = [];
    this.text = "";
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = {
      add: (...values) => { this.classes.push(...values.filter((name) => !this.classes.includes(name))); },
      remove: (value) => { this.classes = this.classes.filter((name) => name !== value); },
      contains: (value) => this.classes.includes(value),
      toggle: (value, force) => {
        const enabled = force === undefined ? !this.classes.includes(value) : Boolean(force);
        if (enabled && !this.classes.includes(value)) this.classes.push(value);
        if (!enabled) this.classList.remove(value);
        return enabled;
      },
    };
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  createEl(tag, options = {}) {
    const el = new FakeEl(tag);
    if (options.cls) el.classes.push(...String(options.cls).split(/\s+/).filter(Boolean));
    if (options.text) el.text = options.text;
    if (options.attr) Object.assign(el.attrs, options.attr);
    this.children.push(el);
    return el;
  }
  appendText(text) { const el = new FakeEl("span"); el.text = String(text); this.children.push(el); }
  empty() { this.children = []; this.text = ""; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener() {}
  toHTML() {
    const cls = this.classes.length ? ` class="${this.classes.join(" ")}"` : "";
    const attrs = Object.entries(this.attrs).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join("");
    const inner = `${escapeHtml(this.text)}${this.children.map((child) => child.toHTML()).join("")}`;
    return `<${this.tag}${cls}${attrs}>${inner}</${this.tag}>`;
  }
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function row(partial) {
  return {
    key: "n:sase.md",
    kind: "note",
    path: "sase.md",
    stem: "sase",
    folder: "",
    tier: "living",
    primary: "sase",
    matchRanges: [[0, 3]],
    resultLink: "[[sase]]",
    ...partial,
  };
}

const STATES = [
  {
    name: "notes",
    open: true,
    crumb: "notes",
    selectedKey: "n:sase.md",
    selectedIndex: 0,
    total: 3,
    rows: [row({}), row({ key: "n:sase_blog.md", path: "sase_blog.md", stem: "sase_blog", primary: "sase_blog", folder: "", matchRanges: [[0, 3]] }), row({ key: "n:sase_blog_zettel.md", path: "done/sase_blog_zettel.md", stem: "sase_blog_zettel", primary: "sase_blog_zettel", folder: "done", tier: "archive", matchRanges: [[0, 3]] })],
    view: null,
  },
  {
    name: "headings",
    open: true,
    crumb: "sase › headings",
    selectedKey: "h:sase.md:Restart readiness",
    selectedIndex: 1,
    total: 2,
    rows: [
      row({ key: "h:sase.md:Overview", kind: "heading", heading: "Overview", level: 2, primary: "Overview", resultLink: "[[sase#Overview]]" }),
      row({ key: "h:sase.md:Restart readiness", kind: "heading", heading: "Restart readiness", level: 3, primary: "Restart readiness", resultLink: "[[sase#Restart readiness]]" }),
    ],
  },
  {
    name: "blocks",
    open: true,
    crumb: "sase › blocks",
    selectedKey: "b:sase.md:ref-1",
    selectedIndex: 0,
    total: 1,
    rows: [row({ key: "b:sase.md:ref-1", kind: "block", blockId: "ref-1", primary: "Restart readiness checklist…", preview: "Restart readiness checklist…", resultLink: "[[sase#^ref-1]]" })],
  },
  {
    name: "nearby",
    open: true,
    crumb: "nearby",
    selectedKey: "n:projects/sase.md:parent",
    selectedIndex: 0,
    total: 3,
    rows: [
      row({ key: "n:projects/sase.md:parent", path: "projects/sase.md", stem: "sase", folder: "projects", primary: "sase", reason: "parent", resultLink: "[[projects/sase]]" }),
      row({ key: "n:sase_blog_zettel.md:linked", path: "sase_blog_zettel.md", stem: "sase_blog_zettel", primary: "sase_blog_zettel", reason: "linked" }),
      row({ key: "n:2026/2026-11-21.md:recent", path: "2026/2026-11-21.md", stem: "2026-11-21", folder: "2026", primary: "2026-11-21", reason: "recent", noteKind: "calendar" }),
    ],
  },
  {
    name: "no-match",
    open: true,
    crumb: "notes",
    selectedKey: null,
    selectedIndex: -1,
    total: 0,
    rows: [],
    message: "No note matches “sase_bx” — keep typing, or esc",
  },
  {
    name: "alias",
    open: true,
    aliasStage: true,
    crumb: "alias",
    selectedKey: null,
    selectedIndex: -1,
    total: 0,
    rows: [],
    resultLink: "[[sase_blog_zettel|my zettel]]",
  },
  {
    name: "dense",
    open: true,
    density: "dense",
    crumb: "notes",
    selectedKey: "n:sase.md",
    selectedIndex: 0,
    total: 2,
    rows: [row({}), row({ key: "n:sase_blog.md", stem: "sase_blog", primary: "sase_blog" })],
  },
  {
    name: "tasks-grouped",
    tasks: true,
    open: true,
    stage: "list",
    headerTitle: "\ud83d\udd17 LINK \u00b7 tasks \u203a in progress",
    headerCount: "1 of 4",
    selectedKey: "t:api#^api-docs",
    selectedIndex: 0,
    total: 4,
    rows: [
      { key: "t:api#^api-docs", status: "active", titleParts: [{ text: "Write the API docs", kind: "text" }], displayText: "Write the API docs", primary: "Write the API docs", group: "in-progress", linkTarget: "api", blockId: "api-docs", notePath: "api.md" },
      { key: "t:api#publish", status: "todo", titleParts: [{ text: "Publish the API docs site", kind: "text" }], displayText: "Publish the API docs site", primary: "Publish the API docs site", group: "open", linkTarget: "projects/api", blockId: null, suggestedId: "publish-api-docs", notePath: "projects/api.md" },
    ],
    detailLeft: "\u21b5 [[api#^api-docs]]",
    detailRight: "\u21e5 insert",
    liveText: "Task 1 of 4: Write the API docs",
  },
  {
    name: "tasks-query",
    tasks: true,
    open: true,
    stage: "list",
    headerTitle: "\ud83d\udd17 LINK \u00b7 tasks",
    headerCount: "1 of 1",
    selectedKey: "t:sync#^flaky",
    selectedIndex: 0,
    total: 1,
    rows: [
      { key: "t:sync#^flaky", status: "todo", titleParts: [{ text: "Fix the ", kind: "text" }, { text: "flaky", kind: "match" }, { text: " sync test", kind: "text" }], displayText: "Fix the flaky sync test", primary: "Fix the flaky sync test", group: "open", linkTarget: "sync", blockId: "flaky", notePath: "sync.md" },
    ],
    detailLeft: "\u21b5 [[sync#^flaky]]",
    detailRight: "\u21e5 insert",
    liveText: "Task 1 of 1: Fix the flaky sync test",
  },
  {
    name: "tasks-idless",
    tasks: true,
    open: true,
    stage: "list",
    headerTitle: "\ud83d\udd17 LINK \u00b7 tasks \u203a this note",
    headerCount: "1 of 2",
    selectedKey: "t:note#reply",
    selectedIndex: 0,
    total: 2,
    rows: [
      { key: "t:note#reply", status: "todo", titleParts: [{ text: "Reply to Dana about the offsite", kind: "text" }], displayText: "Reply to Dana about the offsite", primary: "Reply to Dana about the offsite", group: "this-note", linkTarget: "2026/2026-11-21", blockId: null, suggestedId: "reply-dana", notePath: "2026/2026-11-21.md" },
    ],
    detailLeft: "\u21b5 names it ^reply-dana in 2026/2026-11-21.md, then links it",
    detailRight: "\u21e5 insert",
    liveText: "Task 1 of 2: Reply to Dana about the offsite",
  },
  {
    name: "tasks-disabled",
    tasks: true,
    open: true,
    stage: "list",
    headerTitle: "\ud83d\udd17 LINK \u00b7 tasks",
    headerCount: "2 of 2",
    selectedKey: "t:api#^api-docs",
    selectedIndex: 0,
    total: 2,
    rows: [
      { key: "t:api#^api-docs", status: "active", titleParts: [{ text: "Write the API docs", kind: "text" }], displayText: "Write the API docs", primary: "Write the API docs", group: "this-note", linkTarget: "api", blockId: "api-docs", notePath: "api.md", disabled: { short: "this prompt", full: "The task this prompt is about" } },
    ],
    detailLeft: "\u2298 The task this prompt is about",
    detailRight: "esc close",
    liveText: "Task 1 of 2: Write the API docs. The task this prompt is about",
  },
  {
    name: "tasks-no-match",
    tasks: true,
    open: true,
    stage: "list",
    headerTitle: "\ud83d\udd17 LINK \u00b7 tasks",
    headerCount: "",
    selectedKey: null,
    selectedIndex: -1,
    total: 0,
    rows: [],
    message: "No task matches",
    detailLeft: "\u21b5 closes this list \u00b7 nothing is inserted",
    detailRight: "esc close",
    liveText: "No task matches.",
  },
  {
    name: "tasks-indexing",
    tasks: true,
    open: true,
    stage: "list",
    headerTitle: "\ud83d\udd17 LINK \u00b7 tasks \u203a open",
    headerCount: "Indexing \u00b7 1,200 of 6,500 notes",
    selectedKey: "t:q1#^q1",
    selectedIndex: 0,
    total: 24,
    rows: [
      { key: "t:q1#^q1", status: "todo", titleParts: [{ text: "Draft the Q1 plan", kind: "text" }], displayText: "Draft the Q1 plan", primary: "Draft the Q1 plan", group: "open", linkTarget: "plans", blockId: "q1", notePath: "plans.md" },
    ],
    detailLeft: "\u21b5 [[plans#^q1]]",
    detailRight: "\u21e5 insert",
    liveText: "Task 1 of 24: Draft the Q1 plan",
  },
  {
    name: "tasks-name-roomy",
    tasks: true,
    open: true,
    stage: "name",
    headerTitle: "\ud83d\udd17 LINK \u00b7 tasks \u203a name it",
    headerCount: "in projects/api.md",
    selectedKey: "t:api#publish",
    selectedIndex: 0,
    total: 1,
    density: "roomy",
    nameRow: { status: "todo", titleParts: [{ text: "Publish the API docs site", kind: "text" }], displayText: "Publish the API docs site", primary: "Publish the API docs site", notePath: "projects/api.md" },
    idLine: { value: "publish-api-docs", caret: 16, selected: true, suggestions: ["publish-api-docs", "api-docs-site"] },
    nameSuggestions: ["publish-api-docs", "api-docs-site"],
    nameValidation: { ok: true },
    namePending: false,
    detailLeft: "\u21b5 adds ^publish-api-docs, then links [[projects/api#^publish-api-docs]]",
    detailRight: "esc back",
    liveText: "Name a block ID for Publish the API docs site: publish-api-docs. Enter adds it and links.",
  },
  {
    name: "tasks-name-dense",
    tasks: true,
    open: true,
    stage: "name",
    density: "dense",
    headerTitle: "\ud83d\udd17 LINK \u00b7 tasks \u203a name it",
    headerCount: "in projects/api.md",
    selectedKey: "t:api#publish",
    selectedIndex: 0,
    total: 1,
    nameRow: { status: "todo", titleParts: [{ text: "Publish the API docs site", kind: "text" }], displayText: "Publish the API docs site", primary: "Publish the API docs site", notePath: "projects/api.md" },
    idLine: { value: "bad id!", caret: 7, selected: false, suggestions: [] },
    nameSuggestions: [],
    nameValidation: { ok: false, short: "letters, digits, - only", message: "Use letters, numbers, and dashes" },
    namePending: false,
    detailLeft: "\u2298 Use letters, numbers, and dashes",
    detailRight: "esc back",
    liveText: "Name a block ID for Publish the API docs site: bad id!. Enter adds it and links.",
  },
  {
    name: "tasks-leftover-hint",
    tasks: true,
    open: false,
    hint: "\u26a0 ((api docs)) isn't a link yet \u2014 type in it to pick a task",
  },
];

function paint(state) {
  const host = new FakeEl("div");
  const view = {
    ...state,
    view: state.view || (() => {
      const slots = state.density === "dense" ? helpers.PROSE_LINK_SLOTS_DENSE : helpers.PROSE_LINK_SLOTS_ROOMY;
      const padded = (state.rows || []).slice();
      while (padded.length < slots) padded.push(null);
      return padded.slice(0, slots);
    })(),
    listId: `preview-${state.name}`,
    fadePlayed: true,
  };
  if (state.tasks) helpers.renderProseTaskBand(host, view);
  else helpers.renderProseLinkBand(host, view);
  return host;
}

function page(theme, bodies) {
  const css = fs.readFileSync(cssPath, "utf8");
  return `<!doctype html>
<html class="theme-${theme}" data-theme="${theme}">
<head>
<meta charset="utf-8">
<title>LINK band ${theme}</title>
<style>
:root {
  --background-primary: ${theme === "dark" ? "#1e1e1e" : "#ffffff"};
  --background-modifier-border: ${theme === "dark" ? "#333" : "#ddd"};
  --text-normal: ${theme === "dark" ? "#dcddde" : "#222"};
  --text-muted: ${theme === "dark" ? "#999" : "#555"};
  --text-faint: ${theme === "dark" ? "#666" : "#888"};
  --text-accent: ${theme === "dark" ? "#7f6df2" : "#705dcf"};
  --interactive-accent: ${theme === "dark" ? "#7f6df2" : "#705dcf"};
  --font-ui-smaller: 12px;
  --font-semibold: 600;
  --font-normal: 400;
  --font-monospace: ui-monospace, SFMono-Regular, Menlo, monospace;
  --radius-m: 6px;
  --radius-s: 4px;
  --size-4-2: 8px;
  --size-2-2: 4px;
  --bob-log-recall-row-height: 24px;
}
body { background: var(--background-primary); color: var(--text-normal); font-family: system-ui, sans-serif; padding: 24px; }
section { margin-bottom: 28px; max-width: 720px; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); }
.field { border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 8px 10px; margin-bottom: 0; }
${css}
</style>
</head>
<body>
<h1>LINK band · ${theme}</h1>
${bodies}
</body>
</html>`;
}

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-link-band-preview"), selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--self-test") args.selfTest = true;
    else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/preview-link-band.cjs [--out DIRECTORY] [--self-test]");
      process.exit(0);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sections = STATES.map((state) => {
    const host = paint(state);
    const hint = new FakeEl("div");
    if (state.name === "no-match") helpers.renderProseLinkHint(hint, []);
    if (state.name === "notes") helpers.renderProseLinkHint(hint, ["⚠ [[sase_blgo]] — no such note"]);
    return `<section><h2>${state.name}</h2><div class="field">Outlined the post in [[sase_bl</div>${host.toHTML()}${hint.toHTML()}</section>`;
  }).join("\n");
  if (args.selfTest) {
    const notes = paint(STATES[0]).toHTML();
    assert.match(notes, /bob-link-band/);
    assert.match(notes, /LINK/);
    assert.match(notes, /sase/);
    const headings = paint(STATES[1]).toHTML();
    assert.match(headings, /headings/);
    const nearby = paint(STATES[3]).toHTML();
    assert.match(nearby, /parent/);
    const alias = paint(STATES[5]).toHTML();
    assert.match(alias, /alias/i);
    const grouped = paint(STATES.find((entry) => entry.name === "tasks-grouped")).toHTML();
    assert.match(grouped, /tasks/);
    assert.match(grouped, /api-docs/);
    const nameStage = paint(STATES.find((entry) => entry.name === "tasks-name-roomy")).toHTML();
    assert.match(nameStage, /publish-api-docs/);
    const invalid = paint(STATES.find((entry) => entry.name === "tasks-name-dense")).toHTML();
    assert.match(invalid, /letters, digits/);
    console.log("preview-link-band self-test ok");
    return;
  }
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, "light.html"), page("light", sections));
  fs.writeFileSync(path.join(args.out, "dark.html"), page("dark", sections));
  console.log(args.out);
}

main();
