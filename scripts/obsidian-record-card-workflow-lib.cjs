"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Obsidian's Vim adapter does not infer JavaScript block indentation. Its
// native reindent does normalize this overindented Markdown line; an empty
// prefix in a fenced code block can stay unchanged with or without Bob.
const VIM_PROBE_BODY = "\nVim probe start.\n      indent probe\nVim probe end.\n";

function assertVimReindent(before, after) {
  const probe = /^[ \t]*indent probe$/m;
  assert.match(before, /^ {6}indent probe$/m, "missing overindented probe");
  assert.match(after, probe, "native reindent removed the probe");
  assert.notEqual(after.match(probe)[0], before.match(probe)[0], "native reindent left indentation unchanged");
  assert.equal(after.replace(probe, "<INDENT PROBE>"), before.replace(probe, "<INDENT PROBE>"),
    "native reindent changed bytes outside the probe indentation");
}

const TYPED_FIELDS = [
  { field: "year", kind: "number", value: "2003", persisted: 2003 },
  { field: "service", kind: "text", value: "A keyboard edit", persisted: "A keyboard edit" },
  { field: "watched_on", kind: "date", value: "2026-11-17", persisted: "2026-11-17" },
  { field: "url", kind: "url", value: "https://example.test/edited", persisted: "https://example.test/edited" },
  { field: "category", kind: "suggest", value: "Science fiction", persisted: "Science fiction" },
  { field: "reference", kind: "link", value: "[[nj_towns]]", persisted: "[[nj_towns]]" },
  { field: "tags", kind: "list", value: "Science, fiction", persisted: ["Science, fiction"] },
];
const ENTRY_CASES = [
  { name: "toolbar", note: "zettels/bead_lifecycle.md", selector: "[data-record-sheet-focus='edit']", field: "status" },
  { name: "row", note: "zettels/bead_lifecycle.md", selector: ".bob-record-sheet-row[data-record-key='claim'] .bob-record-sheet-label", field: "claim" },
  { name: "value", note: "zettels/bead_lifecycle.md", selector: ".bob-record-sheet-chip[data-record-key='status']", field: "status", stage: "choices" },
  { name: "ghost", note: "movies/equilibrium.md", selector: ".bob-record-sheet-ghost[data-record-key='service']", field: "service", stage: "text" },
  { name: "missing", note: "missing/record.md", selector: ".bob-record-sheet-missing[data-record-key='claim']", field: "claim", stage: "text" },
];
const WORKFLOW_ASSERTIONS = [
  ...ENTRY_CASES.flatMap(({ name }) => ["entry-click-" + name, "entry-keyboard-" + name]),
  "entry-double-equals", "double-equals-no-indent-or-undo", "counted-equals-reindents",
  "source-equals-reindents", "ordinary-equals-reindents", "entry-control-shift-p",
  "entry-palette", "entry-command-mode", "opening-navigation-cancel-byte-neutral",
  "record-shift-j-k", "record-has-no-schema-keycaps", "schema-same-field",
  "schema-control-j-k-digit-three", "schema-shift-j-byte-neutral", "yaml-done-returns",
  "digit-one-guarded-write", "digit-only-status-and-callout", "digit-regroups",
  "sheet-no-old-value-flash", "no-duplicate-album-sync", "undo-restores-value-and-group",
  ...TYPED_FIELDS.map(({ kind }) => "typed-tab-" + kind), "typed-shift-tab",
  "today-shortcut", "optional-clear", "invalid-refuses-and-keeps-draft",
  "required-empty-refuses-and-keeps-draft", "stale-refuses-and-keeps-draft",
  "stale-retry-saves-after-preview",
];

function focusControlSource(selector) {
  return `(() => {
    const describe = (el) => el ? {
      tag: el.tagName, classes: el.className, connected: el.isConnected,
      key: el.getAttribute('data-record-key'), tabIndex: el.tabIndex,
      display: getComputedStyle(el).display,
      rects: Array.from(el.getClientRects()).map(r => ({x:r.x,y:r.y,width:r.width,height:r.height}))
    } : null;
    const matches = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const el = matches.find(e => e.isConnected && e.getClientRects().length);
    if (el) { el.scrollIntoView({block:'center'}); el.focus(); }
    return {selector:${JSON.stringify(selector)},ok:Boolean(el && document.activeElement === el),
      candidates:matches.map(describe),active:describe(document.activeElement)};
  })()`;
}

async function selectCardField({ click, card, field }) {
  const before = await card();
  // A populated value can contain a real link at the row's center. Select its
  // label instead, then observe native focus before sending any keyboard input.
  await click(".bob-record-card-modal button[data-target-key='" + field + "'] .bob-record-card-label");
  return card(value => value?.field === field && !value.stage && value.ready && !value.busy &&
    value.focusField === field && value.activePath === before.activePath,
  "focused browse field " + field);
}

function vimProbeCursorSource() {
  return `(() => {
    const e=app.workspace.activeLeaf.view.editor;
    const line=e.getValue().split(${JSON.stringify("\n")}).findIndex(l=>l === "      indent probe");
    if (line < 0) throw new Error('Vim indentation probe line is absent');
    e.setCursor({line,ch:0}); e.focus();
  })()`;
}

function paletteSelectionSource() {
  return `(() => {
    const input = document.querySelector('.prompt-input');
    const rows = Array.from(document.querySelectorAll('.suggestion-item'))
      .filter(el => el.isConnected && el.getClientRects().length)
      .map(el => ({text:el.textContent.trim(),selected:el.classList.contains('is-selected')}));
    return input ? {query:input.value,focused:document.activeElement === input,rows} : null;
  })()`;
}

function paletteNavigation(state, title) {
  assert.ok(state?.focused, "palette query input lost focus");
  // The plugin prefix also matches "Command mode" for every catalog command.
  // Match the full command title at the end, then navigate the real selection.
  const matches = state.rows.flatMap((row, index) => row.text.endsWith(title) ? [index] : []);
  assert.equal(matches.length, 1, "palette command title must match exactly one row: " + title);
  const selected = state.rows.flatMap((row, index) => row.selected ? [index] : []);
  assert.equal(selected.length, 1, "palette must have exactly one selected row");
  return selected[0] === matches[0] ? null : selected[0] < matches[0] ? "ArrowDown" : "ArrowUp";
}

async function activatePaletteCommand({ client, key, waitFor, query, title }) {
  const source = paletteSelectionSource();
  const ready = state => state?.focused && state.query === query &&
    state.rows.some(row => row.text.endsWith(title));
  let state = await waitFor(client, source, ready, "palette command " + title);
  const trail = [state];
  const limit = state.rows.length;
  for (let count = 0; count <= limit; count++) {
    const direction = paletteNavigation(state, title);
    if (!direction) {
      await key("Enter");
      return trail;
    }
    assert.ok(count < limit, "palette selection failed to reach " + title);
    const previous = state.rows.find(row => row.selected).text;
    await key(direction);
    state = await waitFor(client, source, value => ready(value) &&
      value.rows.some(row => row.selected && row.text !== previous), "palette selection movement");
    trail.push(state);
  }
}

// Native buttons activate on Enter's character event. A keyDown without text
// only exercises JavaScript keydown listeners and silently misses that action.
function keyEvents(key, modifiers = 0) {
  const codes = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Home: 36, End: 35,
    ArrowDown: 40, ArrowUp: 38, "=": 187 };
  const vk = codes[key] || key.toUpperCase().charCodeAt(0);
  const code = /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase()
    : /^\d$/.test(key) ? "Digit" + key : key === "=" ? "Equal" : key;
  const payload = { key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  const text = modifiers & 7 ? "" : key === "Enter" ? "\r" : key.length === 1 ? key : "";
  return [
    { type: text ? "keyDown" : "rawKeyDown", ...payload, ...(text ? { text, unmodifiedText: text } : {}) },
    { type: "keyUp", ...payload },
  ];
}

function snapshotMarkdown(root) {
  const result = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", ".obsidian"].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) result[path.relative(root, file)] = fs.readFileSync(file, "utf8");
    }
  }
  walk(root);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
function hashes(snapshot) {
  return Object.fromEntries(Object.entries(snapshot).map(([name, text]) =>
    [name, crypto.createHash("sha256").update(text).digest("hex")]));
}
function assertOnlyPaths(before, after, allowed) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), "Markdown inventory changed");
  for (const name of Object.keys(before)) {
    if (!allowed.includes(name)) assert.equal(after[name], before[name], "unrelated Markdown changed: " + name);
  }
}
function splitCallout(text) {
  const start = text.indexOf("> [!records]");
  assert.ok(start >= 0, "real generated records callout is absent");
  let cursor = start;
  while (cursor < text.length) {
    const newline = text.indexOf("\n", cursor);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(cursor, end);
    if (cursor !== start && !line.startsWith(">") && line.trim()) break;
    cursor = newline < 0 ? text.length : newline + 1;
    if (!line.startsWith(">") && !line.trim()) break;
  }
  return { before: text.slice(0, start), callout: text.slice(start, cursor), after: text.slice(cursor) };
}
function assertStatusWrite(before, after, record, album, oldValue, newValue) {
  assertOnlyPaths(before, after, [record, album]);
  const pattern = new RegExp("^status: (?:\\\"" + oldValue + "\\\"|" + oldValue + ")$", "m");
  assert.match(before[record], pattern);
  // Serialization may choose a quoted or bare scalar; every byte outside that span is fixed.
  const newPattern = new RegExp("^status: (?:\\\"" + newValue + "\\\"|" + newValue + ")$", "m");
  assert.match(after[record], newPattern);
  assert.equal(before[record].replace(pattern, "status: <VALUE>"), after[record].replace(newPattern, "status: <VALUE>"));
  const a = splitCallout(before[album]);
  const b = splitCallout(after[album]);
  assert.equal(a.before, b.before, "album prefix changed");
  assert.equal(a.after, b.after, "album suffix changed");
  assert.notEqual(a.callout, b.callout, "status did not regroup the generated index");
}
function assertStatusRestored(before, after, record, album, value) {
  assertOnlyPaths(before, after, [record, album]);
  // Undo replays typed values; the writer may canonicalize a quoted choice.
  // Every byte outside that scalar, including the whole album, must return.
  const pattern = new RegExp("^status: (?:\\\"" + value + "\\\"|" + value + ")$", "m");
  assert.match(before[record], pattern);
  assert.match(after[record], pattern);
  assert.equal(before[record].replace(pattern, "status: <VALUE>"), after[record].replace(pattern, "status: <VALUE>"));
  assert.equal(after[album], before[album], "Undo did not restore the album grouping and bytes");
}
function writerCalls(entries) {
  return entries.filter((entry) => entry.event === "start" && entry.args?.[0] === "records" &&
    entry.args[1] === "update" && !entry.args.includes("-d") && !entry.args.includes("--dry-run"));
}
function readRecordResult(result, note) {
  // records show returns the read model directly, unlike update's ok envelope.
  assert.equal(result.exitCode, 0, "records show failed");
  assert.equal(result.signal, null, "records show was interrupted");
  assert.equal(result.report?.schema_version, 1, "unsupported records show schema");
  assert.equal(result.report?.record?.path, note, "records show returned another record");
  assert.ok(Array.isArray(result.report.record.properties), "records show properties are absent");
  return result.report;
}
function assertSheetValue(sheet, expected) {
  assert.ok(sheet, "record sheet model is absent");
  if (expected === null) {
    assert.equal(sheet.row, null, "cleared field still has a value row");
    assert.equal(sheet.ghost, true, "cleared optional field has no ghost");
    return;
  }
  assert.equal(sheet.row?.state, "valid", "sheet value is absent or invalid");
  assert.equal(sheet.ghost, false, "saved field still has a ghost");
  // Sheet rows hold presentation strings; the CLI and card retain typed values.
  assert.equal(sheet.row.raw, Array.isArray(expected) ? expected.join(", ") : String(expected));
  if (Array.isArray(expected)) {
    assert.deepEqual(sheet.row.chips.map(chip => chip.value), expected);
  }
  if (typeof expected === "number") assert.equal(sheet.row.numeric, true);
}
function assertNoFlash(samples, expected) {
  const index = samples.findIndex((sample) => sample.value === expected);
  assert.ok(index >= 0, "sheet never displayed the applied value");
  assert.ok(samples.length - index >= 3, "insufficient post-apply sheet samples");
  assert.ok(samples.slice(index).every((sample) => sample.value === expected && sample.sheets === 1),
    "sheet flashed an old/missing value or duplicated after apply");
}
function requireInventory(report, scope) {
  for (const name of WORKFLOW_ASSERTIONS) {
    const rows = report.assertions.filter((row) => row.name === name);
    if (!rows.length) report.assertions.push({ name, mandatory: scope === "full",
      status: scope === "full" ? "fail" : "skipped",
      detail: scope === "full" ? "Required workflow was not executed" : "Explicit sheet-only scope" });
    else if (rows.length !== 1) throw new Error("Duplicate workflow assertion: " + name);
  }
}

module.exports = { VIM_PROBE_BODY, assertVimReindent, TYPED_FIELDS, ENTRY_CASES, WORKFLOW_ASSERTIONS, focusControlSource, selectCardField, vimProbeCursorSource, paletteSelectionSource, paletteNavigation, activatePaletteCommand, keyEvents, snapshotMarkdown, hashes,
  assertOnlyPaths, splitCallout, assertStatusWrite, assertStatusRestored, writerCalls, readRecordResult, assertSheetValue, assertNoFlash, requireInventory };
