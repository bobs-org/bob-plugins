// bob-ledger-tools JavaScript mirror of bob-cli's Pomodoro theme contract.
// The shared fixture is copied verbatim from bob-cli; the Rust suite is the
// source of truth. Cases marked `rust_only` are skipped (none exist yet).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}
class TestPlugin {
  constructor(app) {
    this.app = app;
  }
}

const EDITOR_INFO_FIELD = {};
const LIVE_PREVIEW_FIELD = {};

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      MarkdownView: TestMarkdownView,
      Notice: class {},
      Platform: { isDesktopApp: false },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
      editorInfoField: EDITOR_INFO_FIELD,
      editorLivePreviewField: LIVE_PREVIEW_FIELD,
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: { define: () => ({ of: (value) => ({ value }) }) },
      RangeSetBuilder: class {
        constructor() {
          this.adds = [];
        }

        add(from, to, value) {
          this.adds.push({ from, to, value });
        }

        finish() {
          return this.adds;
        }
      },
    };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
      ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
      Decoration: { none: {}, widget: (spec) => spec },
      WidgetType: class {},
    };
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
  pomodoroThemeComponentsOf,
  pomodoroThemeComponentsWithOffsets,
  pomodoroThemeFallbackHue,
  pomodoroThemeResolveHue,
  pomodoroThemeParseJournalLine,
  pomodoroThemeFoldEvents,
  pomodoroThemeRankHistory,
  pomodoroThemeSimilarKeys,
  pomodoroThemePillModels,
  pomodoroThemesDecodeReport,
  pomodoroThemesDecodeWrite,
  pomodoroThemeNameOffsetInLine,
} = LedgerToolsPlugin.helpers;

const fixturePath = path.join(
  __dirname,
  "../plugins/bob-ledger-tools/scripts/fixtures/pomodoro_themes/vectors.json",
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

test("theme vectors: components split and key like bob", () => {
  assert.ok(fixture.components.length > 0, "vectors carry components cases");
  for (const item of fixture.components) {
    if (item.rust_only) {
      continue;
    }
    const got = pomodoroThemeComponentsOf(item.input).map((component) => ({
      raw: component.raw,
      key: component.key,
    }));
    assert.deepEqual(got, item.expected, `components: ${item.name}`);
  }
});

test("theme vectors: hue rule resolves pin, exempt, area, then hash", () => {
  assert.ok(fixture.hue.length > 0, "vectors carry hue cases");
  for (const item of fixture.hue) {
    if (item.rust_only) {
      continue;
    }
    const got = pomodoroThemeResolveHue(item.key, {
      pin: item.pin,
      exempt: item.exempt,
      areas: item.areas,
    });
    assert.deepEqual(
      got,
      { hue: item.expected.hue, hue_source: item.expected.hue_source },
      `hue: ${item.name}`,
    );
  }
});

test("theme vectors: journal fold is last writer wins with rename moves", () => {
  assert.ok(fixture.fold.length > 0, "vectors carry fold cases");
  for (const item of fixture.fold) {
    if (item.rust_only) {
      continue;
    }
    const events = [];
    item.events.forEach((event, index) => {
      const parsed = pomodoroThemeParseJournalLine(
        event.raw,
        "fixture.jsonl",
        index + 1,
      );
      if (parsed) {
        events.push(parsed);
      }
    });
    const { byKey } = pomodoroThemeFoldEvents(events);
    const got = {};
    for (const [key, pref] of Object.entries(byKey)) {
      got[key] = { hidden: pref.hidden, pin: pref.pin };
    }
    assert.deepEqual(got, item.expected, `fold: ${item.name}`);
  }
});

test("theme vectors: history rank is exact, prefix, then substring", () => {
  assert.ok(fixture.rank.length > 0, "vectors carry rank cases");
  for (const item of fixture.rank) {
    if (item.rust_only) {
      continue;
    }
    const ranked = pomodoroThemeRankHistory(
      item.themes,
      item.query,
      new Set(item.exclusions),
    ).map((theme) => theme.name);
    assert.deepEqual(ranked, item.expected, `rank: ${item.name}`);
  }
});

test("theme hash hues match the known collisions", () => {
  assert.equal(pomodoroThemeFallbackHue("bob"), "magenta");
  assert.equal(pomodoroThemeFallbackHue("blog"), "orange");
  assert.equal(pomodoroThemeFallbackHue("sase"), "orange");
});

test("theme similar keys follow the near-duplicate rule", () => {
  const themes = [
    { key: "sase", name: "SASE", last_used: "2026-10-22" },
    { key: "sase v18", name: "SASE V18", last_used: "2026-10-21" },
    { key: "fix", name: "FIX", last_used: "2026-10-20" },
    { key: "fixes", name: "FIXES", last_used: "2026-10-19" },
    { key: "books", name: "BOOKS", last_used: "2026-10-21" },
    { key: "book", name: "BOOK", last_used: "2026-10-18" },
  ];
  // Punctuation modulo: SASE-V18 matches SASE V18.
  assert.deepEqual(pomodoroThemeSimilarKeys("sase-v18", themes), ["sase v18"]);
  // Plural: FIX matches FIXES.
  assert.deepEqual(pomodoroThemeSimilarKeys("fix", themes), ["fixes"]);
  // Singular: BOOKS matches BOOK.
  assert.deepEqual(pomodoroThemeSimilarKeys("books", themes), ["book"]);
  // Short queries stay quiet.
  assert.deepEqual(pomodoroThemeSimilarKeys("bo", themes), []);
  // Exact self matches are excluded.
  assert.ok(!pomodoroThemeSimilarKeys("fix", themes).includes("fix"));
});

test("theme decode accepts a schema 1 report and rejects the rest", () => {
  const good = pomodoroThemesDecodeReport(
    JSON.stringify({
      schema_version: 1,
      today: "2026-10-24",
      window_days: 90,
      counts: {},
      themes: [
        {
          key: "bob",
          name: "BOB",
          hue: "magenta",
          hue_source: "hash",
          pinned: false,
          hidden: false,
          exempt: false,
          last_used: "2026-10-24",
          days_used: 26,
          entries: 49,
          today: "open",
        },
      ],
      hints: [],
      renamed_reappeared: [],
      warnings: [],
    }),
    "",
  );
  assert.equal(good.ok, true);
  assert.equal(good.report.themes.length, 1);
  assert.equal(good.report.themes[0].hue, "magenta");
  assert.deepEqual(pomodoroThemesDecodeReport("not json", "boom").code, "bad-json");
  assert.deepEqual(
    pomodoroThemesDecodeReport(JSON.stringify({ schema_version: 2 }), "").code,
    "schema-mismatch",
  );
  assert.deepEqual(
    pomodoroThemesDecodeReport(JSON.stringify({ schema_version: 1 }), "").code,
    "bad-shape",
  );
});

test("theme write decode maps refusals and pre-writer bob output", () => {
  const ok = pomodoroThemesDecodeWrite(
    JSON.stringify({ ok: true, key: "books" }),
    "",
  );
  assert.equal(ok.ok, true);
  const refusal = pomodoroThemesDecodeWrite(
    JSON.stringify({ ok: false, code: "unknown_theme", message: "Nope." }),
    "",
  );
  assert.deepEqual(
    { ok: refusal.ok, code: refusal.code },
    { ok: false, code: "unknown_theme" },
  );
  const legacy = pomodoroThemesDecodeWrite(
    "error: unrecognized subcommand 'themes'",
    "",
  );
  assert.deepEqual(
    { ok: legacy.ok, code: legacy.code },
    { ok: false, code: "unsupported" },
  );
});

test("theme components carry byte offsets excluding quotes and plus", () => {
  const parts = pomodoroThemeComponentsWithOffsets("BOB + DECKS");
  assert.deepEqual(
    parts.map((part) => [part.raw, part.key, part.start, part.end]),
    [
      ["BOB", "bob", 0, 3],
      ["DECKS", "decks", 6, 11],
    ],
  );
});

test("theme pill models mark exempt components muted", () => {
  const pills = pomodoroThemePillModels("BOB + GTD", (key) =>
    key === "gtd" ? { hue: null, hue_source: "exempt" } : { hue: "magenta", hue_source: "hash" },
  );
  assert.deepEqual(
    pills.map((pill) => [pill.text, pill.hue, pill.hueSource, pill.muted]),
    [
      ["BOB", "magenta", "hash", false],
      ["GTD", null, "exempt", true],
    ],
  );
});

test("theme name offsets anchor at the em dash of a ledger line", () => {
  const slot = pomodoroThemeNameOffsetInLine("- [ ] (08:00-08:25) — BOB + DECKS");
  assert.ok(slot, "ledger line has a name tail");
  assert.equal("- [ ] (08:00-08:25) — BOB + DECKS".slice(slot.nameStart, slot.nameEnd), "BOB + DECKS");
  assert.equal(pomodoroThemeNameOffsetInLine("- [ ] ()"), null);
  assert.equal(pomodoroThemeNameOffsetInLine("  - [ ] () — INDENTED"), null);
});
