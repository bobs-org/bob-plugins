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
      Decoration: { none: {}, mark: (spec) => spec, widget: (spec) => spec },
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
  pomodoroThemeNormalizeKey,
  pomodoroThemeCanonicalName,
  pomodoroThemeInlineFields,
  pomodoroThemeTaskFieldState,
  pomodoroThemeSetTaskTheme,
  pomodoroThemeClearTaskTheme,
  pomodoroThemePlanChange,
  pomodoroThemeLedgerNames,
  pomodoroThemeSuggestWithDiagnostics,
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

test("theme vectors: hue rule includes configured colors and unconfigured mute", () => {
  assert.ok(fixture.hue.length > 0, "vectors carry hue cases");
  for (const item of fixture.hue) {
    if (item.rust_only) {
      continue;
    }
    const got = pomodoroThemeResolveHue(item.key, {
      pin: item.pin,
      exempt: item.exempt,
      areas: item.areas,
      configured: item.configured,
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

test("theme decode keeps configured vocabulary and row flags", () => {
  const decoded = pomodoroThemesDecodeReport(
    JSON.stringify({
      schema_version: 1,
      counts: { configured: 1 },
      configured_themes: [{ key: "build", name: "BUILD", color: "yellow" }],
      themes: [
        { key: "build", name: "BUILD", hue: "yellow", hue_source: "config", configured: true },
        { key: "snack", name: "SNACK", hue: null, hue_source: "unconfigured", configured: false },
      ],
    }),
    "",
  );
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.report.configured_themes, [
    { key: "build", name: "BUILD", color: "yellow" },
  ]);
  assert.equal(decoded.report.counts.configured, 1);
  assert.equal(decoded.report.themes[0].hue_source, "config");
  assert.equal(decoded.report.themes[0].configured, true);
  assert.equal(decoded.report.themes[1].hue_source, "unconfigured");
  assert.equal(decoded.report.themes[1].configured, false);
});

test("themes API reports vocabulary membership and returns null without a configured block", () => {
  const plugin = new LedgerToolsPlugin({});
  plugin.pomodoroThemesCache = {
    report: {
      ...LedgerToolsPlugin.helpers.pomodoroThemesEmptyReport(),
      configured_themes: [{ key: "build", name: "BUILD", color: "yellow" }],
      themes: [
        { key: "build", name: "BUILD", configured: true },
        { key: "inventory", name: "INVENTORY", configured: true },
        { key: "snack", name: "SNACK", configured: false },
      ],
    },
  };
  assert.equal(plugin.pomodoroThemeIsConfigured("BUILD"), true);
  assert.equal(plugin.pomodoroThemeIsConfigured("INVENTORY"), true);
  assert.equal(plugin.pomodoroThemeIsConfigured("SNACK"), false);
  plugin.pomodoroThemesCache = {
    report: LedgerToolsPlugin.helpers.pomodoroThemesEmptyReport(),
  };
  assert.equal(plugin.pomodoroThemeIsConfigured("SNACK"), null);
});

test("themes API Recent rows include configured never-used names in config order and omit strays", () => {
  const plugin = new LedgerToolsPlugin({});
  plugin.pomodoroThemesCache = {
    report: {
      ...LedgerToolsPlugin.helpers.pomodoroThemesEmptyReport(),
      configured_themes: [
        { key: "build", name: "BUILD", color: "yellow" },
        { key: "write", name: "WRITE", color: "violet" },
      ],
      themes: [
        { key: "build", name: "BUILD", hue: "yellow", hue_source: "config", configured: true, hidden: false, last_used: "2026-10-23", days_used: 4 },
        { key: "snack", name: "SNACK", hue: null, hue_source: "unconfigured", configured: false, hidden: false, last_used: "2026-10-24", days_used: 1 },
      ],
    },
  };
  const rows = plugin.pomodoroThemeHistoryRows({ query: "", limit: 12 });
  assert.deepEqual(rows.map((row) => row.name), ["BUILD", "WRITE"]);
  assert.deepEqual(rows.map((row) => row.configured_order), [0, 1]);
  assert.equal(rows[1].last_used, "");
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

test("theme pill models mark unconfigured components muted and outlined", () => {
  const pills = pomodoroThemePillModels("SNACK", () => ({
    hue: null,
    hue_source: "unconfigured",
    configured: false,
  }));
  assert.deepEqual(
    [pills[0].configured, pills[0].unconfigured, pills[0].muted],
    [false, true, true],
  );
});

test("Live Preview waits until the cursor leaves an unconfigured theme name", () => {
  const plugin = new LedgerToolsPlugin({});
  const name = "SNACK";
  plugin.pomodoroThemesCache = {
    report: {
      ...LedgerToolsPlugin.helpers.pomodoroThemesEmptyReport(),
      configured_themes: [{ key: "build", name: "BUILD", color: "yellow" }],
      themes: [{
        key: "snack",
        name,
        hue: null,
        hue_source: "unconfigured",
        configured: false,
        hidden: false,
        days_used: 1,
      }],
    },
  };
  const content = `## Pomodoros\n- [ ] () — ${name}`;
  const nameOffset = content.indexOf(name);
  const makeView = (head) => ({
    state: {
      doc: {
        toString: () => content,
        lineAt: (position) => ({
          number: content.slice(0, position).split("\n").length,
        }),
      },
      field: (field) => field === EDITOR_INFO_FIELD
        ? { file: { path: "2026/20261028.md" } }
        : true,
      selection: { main: { head } },
    },
  });
  const duringTyping = plugin.buildPomodoroThemeDecorations(makeView(nameOffset + 1));
  const typingClass = duringTyping[0].value.class;
  assert.ok(typingClass.includes("bob-pomo-theme-unknown"));
  assert.ok(!typingClass.includes("bob-pomo-theme-unconfigured"));

  const afterTyping = plugin.buildPomodoroThemeDecorations(makeView(0));
  const committedClass = afterTyping[0].value.class;
  assert.ok(committedClass.includes("bob-pomo-theme-unconfigured"));
  assert.ok(committedClass.includes("bob-pomo-theme-muted"));
  assert.match(afterTyping[0].value.attributes.title, /not in your themes$/);
});

test("theme name offsets anchor at the em dash of a ledger line", () => {
  const slot = pomodoroThemeNameOffsetInLine("- [ ] (08:00-08:25) — BOB + DECKS");
  assert.ok(slot, "ledger line has a name tail");
  assert.equal("- [ ] (08:00-08:25) — BOB + DECKS".slice(slot.nameStart, slot.nameEnd), "BOB + DECKS");
  assert.equal(pomodoroThemeNameOffsetInLine("- [ ] ()"), null);
  assert.equal(pomodoroThemeNameOffsetInLine("  - [ ] () — INDENTED"), null);
});

function obsidianYamlScalar(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return null;
  }
  if (text.startsWith("[[") && text.endsWith("]]")) {
    return [[text.slice(2, -2)]];
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    return text
      .slice(1, -1)
      .split(",")
      .map((item) => obsidianYamlScalar(item));
  }
  if (text.startsWith('"') && text.endsWith('"')) {
    return JSON.parse(text);
  }
  if (text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (/^(?:true|false)$/i.test(text)) {
    return text.toLowerCase() === "true";
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return Number(text);
  }
  return text;
}

function obsidianFrontmatter(markdown) {
  const lines = String(markdown || "").split("\n");
  if (String(lines[0] || "").trimEnd() !== "---") {
    return {};
  }
  let close = 1;
  while (close < lines.length && String(lines[close] || "").trimEnd() !== "---") {
    close += 1;
  }
  const yamlLines = lines.slice(1, close);
  const frontmatter = {};
  for (let index = 0; index < yamlLines.length; index += 1) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]*(.*))$/.exec(yamlLines[index]);
    if (!match) {
      continue;
    }
    const key = match[1];
    const raw = match[2];
    if (raw) {
      frontmatter[key] = obsidianYamlScalar(raw);
      continue;
    }
    const values = [];
    let next = index + 1;
    while (next < yamlLines.length) {
      const child = /^[ \t]*-[ \t]*(.*)$/.exec(yamlLines[next]);
      if (child) {
        values.push(obsidianYamlScalar(child[1]));
        next += 1;
        continue;
      }
      if (!String(yamlLines[next] || "").trim()) {
        next += 1;
        continue;
      }
      break;
    }
    frontmatter[key] = values.length > 0 ? values : null;
  }
  return frontmatter;
}

function createThemeMiniVault(notes) {
  const files = new Map();
  const caches = new Map();
  for (const [pathName, markdown] of Object.entries(notes || {})) {
    const file = { path: pathName };
    files.set(pathName, file);
    caches.set(pathName, { frontmatter: obsidianFrontmatter(markdown) });
  }
  const normalizeTarget = (target) => {
    const value = String(target || "").split("|")[0].split("#")[0].trim();
    return value.replace(/\.md$/i, "").replace(/^\/+/, "");
  };
  const metadataCache = {
    getFileCache(file) {
      return file && caches.get(file.path) || null;
    },
    getCache(file) {
      return file && caches.get(file.path) || null;
    },
    getFirstLinkpathDest(target, sourcePath) {
      const value = normalizeTarget(target);
      if (!value) {
        return null;
      }
      const withExtension = /\.md$/i.test(value) ? value : `${value}.md`;
      if (files.has(withExtension)) {
        return files.get(withExtension);
      }
      const sourceDir = String(sourcePath || "").split("/").slice(0, -1).join("/");
      const relative = sourceDir ? `${sourceDir}/${withExtension}` : withExtension;
      if (files.has(relative)) {
        return files.get(relative);
      }
      const basename = withExtension.split("/").pop();
      const matches = [...files.entries()].filter(([pathName]) => pathName.split("/").pop() === basename);
      return matches.length === 1 ? matches[0][1] : null;
    },
  };
  const vault = {
    getAbstractFileByPath(pathName) {
      return files.get(pathName) || null;
    },
  };
  return { files, caches, metadataCache, vault };
}

function catalogForSuggest(live = []) {
  const names = new Map([
    ["write", "WRITE"],
    ["build", "BUILD"],
    ["read", "READ"],
    ["fix", "FIX"],
    ["plan", "PLAN"],
    ["chore", "CHORE"],
  ]);
  const known = new Set(names.keys());
  for (const item of live) {
    const key = pomodoroThemeNormalizeKey(item);
    if (key) {
      known.add(key);
      if (!names.has(key)) {
        names.set(key, key.replace(/[a-z]/g, (letter) => letter.toUpperCase()));
      }
    }
  }
  return { names, known };
}

function assertThemeSuggestion(id, expected, got) {
  if (expected == null) {
    assert.equal(got, null, id);
    return;
  }
  assert.ok(got, `${id}: expected a suggestion`);
  assert.equal(got.source, expected.source, id);
  assert.equal(got.label, expected.label, id);
  assert.equal(got.theme.key, expected.theme_key, id);
  assert.equal(got.theme.name, expected.theme_name, id);
  assert.equal(got.theme.known !== false, expected.known, id);
  assert.equal(got.repair || null, expected.repair || null, id);
  if (expected.from) {
    assert.ok(got.from, `${id}: expected note origin`);
    for (const key of ["path", "stem", "kind"]) {
      assert.equal(got.from[key], expected.from[key], `${id}: from.${key}`);
    }
    assert.deepEqual(got.from.chain, expected.from.chain, `${id}: from.chain`);
  } else {
    assert.equal(Object.hasOwn(got, "from"), false, `${id}: unexpected from`);
  }
  if (expected.inherited) {
    assert.ok(got.inherited, `${id}: expected inherited suggestion`);
    assertThemeSuggestion(id + ".inherited", expected.inherited, got.inherited);
  } else if (got.source === "task") {
    assert.equal(Object.hasOwn(got, "inherited"), true, `${id}: task carries explicit inherited null`);
    assert.equal(got.inherited, null, `${id}: inherited is null`);
  } else {
    assert.equal(Object.hasOwn(got, "inherited"), false, `${id}: no inherited member`);
  }
}

test("theme task-field vectors execute parse, byte-preserving setters, and clear", () => {
  assert.ok(fixture.task_field.length > 0);
  for (const item of fixture.task_field) {
    if (item.rust_only) {
      continue;
    }
    if (item.op === "parse") {
      const result = pomodoroThemeTaskFieldState(item.line);
      assert.equal(result.state, item.state, `task_field: ${item.id}`);
      if (item.state === "set") {
        assert.equal(result.value, item.value, `task_field: ${item.id}`);
      }
      if (item.state === "repair") {
        assert.equal(result.repair, item.repair, `task_field: ${item.id}`);
      }
    } else if (item.op === "set") {
      assert.equal(
        pomodoroThemeSetTaskTheme(item.before, item.name),
        item.after,
        `task_field: ${item.id}`,
      );
    } else if (item.op === "clear") {
      assert.equal(
        pomodoroThemeClearTaskTheme(item.before),
        item.after,
        `task_field: ${item.id}`,
      );
    } else {
      assert.fail(`unknown task_field op ${item.op}`);
    }
  }
});

test("theme write-rule vectors execute the deliberate-choice decision", () => {
  assert.ok(fixture.write_rule.length > 0);
  for (const item of fixture.write_rule) {
    if (item.rust_only) {
      continue;
    }
    const field =
      item.field === "none"
        ? { state: "none" }
        : item.field === "set"
          ? { state: "set", key: item.field_key }
          : { state: "repair", repair: "invalid" };
    const change = pomodoroThemePlanChange({
      field,
      suggestion: item.suggestion,
      inherited: item.inherited,
      destinationName: item.destination,
      exemptKeys: item.exempt,
      deliberate: item.deliberate,
    });
    assert.equal(change.action, item.expected, `write_rule: ${item.id}`);
    if (item.expected === "set") {
      assert.equal(change.name, item.name, `write_rule: ${item.id}`);
    }
  }
});

test("theme suggestion vectors execute Rust precedence, origins, diagnostics, and live names", () => {
  assert.ok(fixture.suggest.cases.length > 0);
  assert.deepEqual(obsidianFrontmatter(fixture.suggest.notes["unindented_list.md"]).theme, ["WRITE"]);
  const miniVault = createThemeMiniVault(fixture.suggest.notes);
  for (const item of fixture.suggest.cases) {
    const config = item.config
      ? { reading_theme: item.config.reading_theme, exempt: item.config.exempt }
      : { readingTheme: "READ", exempt: ["PLAN"] };
    const result = pomodoroThemeSuggestWithDiagnostics({
      path: item.residence,
      line: item.line || "",
      newTask: item.new_task === true,
      dailyPath: "2026/20261028.md",
      metadataCache: miniVault.metadataCache,
      vault: miniVault.vault,
      catalog: catalogForSuggest(item.live || []),
      config,
    });
    assertThemeSuggestion(item.id, item.expected, result.suggestion);
    assert.deepEqual(
      result.warnings.map((warning) => [warning.code, warning.path || null]),
      (item.warnings || []).map((warning) => [warning.code, warning.path || null]),
      `suggest warnings: ${item.id}; result=${JSON.stringify(result)}`,
    );
  }
});

test("task-theme API is additive, synchronous, path-bound, and read-only", () => {
  const todayPath = "2026/20261028.md";
  const todayText = "## Pomodoros\n- [ ] () — UNSAVED\n";
  const taskText = "- [ ] Write the tests ^write-tests";
  const miniVault = createThemeMiniVault({
    "Task.md": "---\ntype: [[project]]\ntheme: BUILD\n---\n",
    "NoTheme.md": "---\ntype: [[note]]\n---\n",
  });
  const leaves = [
    { view: { file: { path: "Other.md" }, editor: { getValue: () => "- [ ] Wrong active file" } } },
    { view: { file: { path: todayPath }, editor: { getValue: () => todayText } } },
    { view: { file: { path: "Task.md" }, editor: { getValue: () => "- [ ] Current editor [theme:: FIX] ^id" } } },
    { view: { file: { path: "NoTheme.md" }, editor: { getValue: () => "- [ ] Explicit [theme:: CUSTOM] ^id" } } },
  ];
  const plugin = new LedgerToolsPlugin({
    metadataCache: miniVault.metadataCache,
    vault: miniVault.vault,
    workspace: { getLeavesOfType: () => leaves },
  });
  plugin.currentTodayDailyPath = () => todayPath;
  plugin.pomodoroThemesCache = {
    report: {
      ...LedgerToolsPlugin.helpers.pomodoroThemesEmptyReport(),
      themes: [{ key: "hidden", name: "HIDDEN", hidden: true }],
      configured_themes: [],
    },
  };
  plugin.pomodoroThemeHueFor = () => ({ hue: "blue", hue_source: "area", configured: null });
  let spawned = 0;
  let writes = 0;
  plugin.themesSpawnFetch = () => {
    spawned += 1;
  };
  miniVault.vault.modify = () => {
    writes += 1;
  };

  const api = plugin.pomodoroThemesApi();
  assert.equal(Object.isFrozen(api), true);
  for (const member of [
    "available", "fetch", "snapshot", "isConfigured", "hueFor", "componentsOf",
    "historyRows", "similarTo", "hide", "unhide", "color", "rename", "onChange",
    "suggestFor", "taskThemeOf", "setTaskTheme", "clearTaskTheme", "planThemeChange", "isKnownTheme",
  ]) {
    assert.equal(typeof api[member], "function", `themes.${member} is present`);
  }
  assert.equal(api.isKnownTheme("HIDDEN"), true, "hidden catalog entries stay known");
  assert.equal(api.isKnownTheme("UNSAVED"), true, "open daily editor names are known");
  const knownThemeSuggestion = api.suggestFor({
    path: "Task.md",
    line: 1,
    text: "- [ ] Explicit [theme:: UNSAVED] ^unsaved-theme",
  });
  assert.equal(knownThemeSuggestion.theme.key, "unsaved");
  assert.equal(Object.hasOwn(knownThemeSuggestion.theme, "known"), false,
    "Rust ThemeRef omits known=true");
  assert.equal(Object.hasOwn(knownThemeSuggestion.theme, "configured"), false,
    "Rust ThemeRef omits an unavailable configured flag");
  const liveSuggestion = api.suggestFor({ path: "Task.md", line: 1, text: taskText });
  assert.equal(liveSuggestion.source, "note");
  assert.equal(liveSuggestion.theme.name, "BUILD");
  assert.equal(Object.hasOwn(liveSuggestion.theme, "known"), true);
  assert.equal(liveSuggestion.theme.known, false, "catalog-only spelling stays explicitly unknown");

  const editorSuggestion = api.suggestFor({ path: "Task.md", line: 1 });
  assert.equal(editorSuggestion.source, "task");
  assert.equal(editorSuggestion.theme.key, "fix");
  assert.equal(editorSuggestion.inherited.theme.key, "build");
  const nullInherited = api.suggestFor({ path: "NoTheme.md", line: 1 });
  assert.equal(nullInherited.source, "task");
  assert.equal(Object.hasOwn(nullInherited, "inherited"), true);
  assert.equal(nullInherited.inherited, null);

  assert.equal(api.suggestFor({ path: "Task.md", line: 3 }), null);
  assert.equal(api.suggestFor({ path: "Missing.md", line: 1, text: "- [ ] Plain task" }), null);
  assert.equal(api.taskThemeOf("- [ ] X (theme ::  WRITE )").value, "WRITE");
  assert.equal(api.setTaskTheme("- [ ] 😀 Café [fresh:: 2026-10-28]", "WRITE"),
    "- [ ] 😀 Café [theme:: WRITE] [fresh:: 2026-10-28]");
  assert.equal(api.clearTaskTheme("- [ ] Café [theme:: WRITE] ^id"), "- [ ] Café ^id");
  assert.deepEqual(
    api.planThemeChange({
      field: api.taskThemeOf("- [ ] Task"),
      suggestion: liveSuggestion,
      inherited: liveSuggestion,
      destinationName: "BUILD",
      exemptKeys: ["PLAN"],
      deliberate: true,
    }),
    { action: "none" },
  );
  assert.equal(spawned, 0, "synchronous suggestions do not fetch history");
  assert.equal(writes, 0, "field helpers do not mutate the vault");
});
