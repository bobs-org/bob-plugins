const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {}
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class {}, MarkdownRenderer: {}, MarkdownView: {}, Modal: class {},
    Notice: class {}, Platform: { isDesktopApp: true }, Plugin: TestPlugin,
    PluginSettingTab: class {}, Setting: class {}, normalizePath: (value) => value,
    parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect: { define: () => ({ of: (value) => value }) }, StateField: { define: () => ({}) }, RangeSetBuilder: class {} };
  if (request === "@codemirror/view") return { EditorView: {}, keymap: { of: (value) => value }, ViewPlugin: { fromClass: (value) => value }, Decoration: {}, WidgetType: class {} };
  if (request === "@codemirror/language") return { syntaxTree: () => null };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { propertyCardFormatCreatedStamp: format } = LedgerToolsPlugin.helpers;
Module._load = originalLoad;

const instant = (value) => new Date(value);
const options = (extra = {}) => ({ now: instant("2026-06-11T15:00:00.000Z"), timeZone: "America/Chicago", ...extra });

test("created formatting follows the card species and represented day", () => {
  assert.equal(format(options({
    kind: "day", noteDate: "2026-06-11", value: "2026-06-11T06:43:00-05:00",
  })).text, "created 6:43 AM");
  assert.equal(format(options({
    kind: "record", value: "2026-06-11T06:43:00-0500",
  })).text, "added today, 6:43 AM");
  assert.equal(format(options({
    kind: "album", value: "2026-06-10T21:41:00-05:00",
  })).text, "created yesterday, 9:41 PM");
  assert.equal(format(options({ kind: "album", value: "2026-06-09T12:00:00Z" })).text, "created Jun 9");
  assert.equal(format(options({ kind: "album", value: "2025-06-11T12:00:00Z" })).text, "created Jun 11, 2025");
  assert.equal(format(options({ kind: "week", value: "2026-06-10T21:41:00-05:00" })).text, "created Jun 10, 9:41 PM");
});

test("date-only values never invent midnight and remain calendar dates", () => {
  const today = format(options({ kind: "album", value: "2026-06-11" }));
  assert.deepEqual(today, {
    text: "created today", tooltip: "2026-06-11 · today", state: "ok", dateOnly: true,
  });
  assert.equal(format(options({
    kind: "day", noteDate: "2026-06-11", value: "2026-06-11",
  })).text, "created Jun 11");
  assert.equal(format(options({
    kind: "year", value: "2025-06-11",
  })).text, "created Jun 11, 2025");
});

test("space-separated midnight timestamps and supported offsets parse", () => {
  const cases = [
    ["2026-06-11 00:00:00-0500", "America/Chicago", "created today, 12:00 AM"],
    ["2026-06-11T00:00:00-05:00", "America/Chicago", "created today, 12:00 AM"],
    ["2026-06-11T05:00:00+0000", "America/Chicago", "created today, 12:00 AM"],
    ["2026-06-11T05:00:00Z", "America/Chicago", "created today, 12:00 AM"],
    ["2026-06-11 00:00:00", "America/Chicago", "created today, 12:00 AM"],
  ];
  for (const [value, timeZone, expected] of cases) {
    assert.equal(format(options({ kind: "album", value, timeZone })).text, expected, value);
  }
});

test("YAML Date objects use source syntax to distinguish dates from timestamps", () => {
  const dateObject = instant("2026-06-11T00:00:00.000Z");
  const dateOnly = format(options({ kind: "album", value: dateObject, sourceScalar: "2026-06-11" }));
  assert.equal(dateOnly.dateOnly, true);
  assert.equal(dateOnly.text, "created today");
  const timestamp = format(options({ kind: "album", value: dateObject, sourceScalar: "2026-06-10T19:00:00-05:00" }));
  assert.equal(timestamp.dateOnly, false);
  assert.equal(timestamp.text, "created yesterday, 7:00 PM");
});

test("impossible dates are invalid and preserve their raw source", () => {
  const result = format(options({ kind: "record", value: "2025-02-30T12:00:00Z", sourceScalar: '"2025-02-30T12:00:00Z"' }));
  assert.deepEqual(result, {
    text: "added ⚠", tooltip: 'Invalid created value: "2025-02-30T12:00:00Z"', state: "invalid", dateOnly: false,
  });
  assert.equal(format(options({ kind: "album", present: false })).text, "no created date");
  assert.equal(format(options({ kind: "week", present: false })).text, "");
});

test("offset timestamps render in explicit viewer zones across date boundaries", () => {
  const value = "2026-06-11T00:30:00+02:00";
  const now = instant("2026-06-11T12:00:00Z");
  const newYork = format({ kind: "week", value, now, timeZone: "America/New_York" });
  const tokyo = format({ kind: "week", value, now, timeZone: "Asia/Tokyo" });
  assert.equal(newYork.text, "created Jun 10, 6:30 PM");
  assert.equal(tokyo.text, "created Jun 11, 7:30 AM");
  assert.match(newYork.tooltip, /\+02:00/);
});
