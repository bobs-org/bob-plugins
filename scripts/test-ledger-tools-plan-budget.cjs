// Tests for the bob-ledger-tools plan-budget mirror (`docs/plan.md` in
// bob-cli is the authoritative definition; the vectors below encode every
// conformance example from that page verbatim).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }

  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }

  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }

  registerMarkdownCodeBlockProcessor(language, handler) {
    this.codeBlocks = this.codeBlocks || {};
    this.codeBlocks[language] = handler;
  }

  registerInterval(handle) {
    this.intervals = this.intervals || [];
    this.intervals.push(handle);
    return handle;
  }
}

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  coercePlanCaps,
  computePlanBudget,
  defaultPlanCaps,
  hasNowTag,
  loadPlanCaps,
  nowBudgetFromTasks,
  parsePlanCaps,
  planBlockModel,
  planBlockTargetPath,
} = helpers;

function codes(budget) {
  return budget.warnings.map((warning) => warning.code);
}

function makeApp(overrides = {}) {
  return {
    internalPlugins: { plugins: {} },
    vault: {
      getAbstractFileByPath: () => null,
      cachedRead: () => Promise.resolve(null),
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
    },
    metadataCache: { on: () => ({}) },
    plugins: { plugins: {} },
    ...overrides,
  };
}

// docs/plan.md conformance example 1: merged `BOB + DECKS` next to a
// separate `DECKS` counts DECKS once and raises duplicate_open_pomodoro_name.
test("conformance: merged name with duplicate", () => {
  const budget = computePlanBudget(
    "## Pomodoros\n" +
      "\n" +
      "- [ ] () — BOB + DECKS\n" +
      "    - [[a#^one]]\n" +
      "- [ ] () — DECKS\n" +
      "    - [[b#^two]]\n",
  );
  assert.equal(budget.hasSection, true);
  assert.deepEqual(budget.themeNames, ["BOB", "DECKS"]);
  assert.equal(budget.themes.count, 2);
  assert.equal(budget.themes.over, false);
  assert.equal(budget.links.count, 2);
  assert.equal(budget.status, "ok");
  assert.deepEqual(codes(budget), ["duplicate_open_pomodoro_name"]);
  assert.equal(budget.warnings[0].line, 5);
  assert.equal(budget.entries[0].highlight, true);
  assert.equal(budget.entries[1].highlight, false);
});

// docs/plan.md conformance example 2: a struck link, GTD's `[[#^gtd]]`, a
// link planned twice, an embedded link, and a `#`-marked link.
test("conformance: link forms and exclusions", () => {
  const budget = computePlanBudget(
    "## Pomodoros\n" +
      "\n" +
      "- [ ] () — GOALS\n" +
      "    - [[task#^aaa]] and ~~[[task#^struck]]~~\n" +
      "    - ![[emb#^eee]]\n" +
      "    - [[mark#^mmm]]#\n" +
      "- [ ] () — DECKS\n" +
      "    - [[task#^aaa]]\n" +
      "- [ ] () — GTD\n" +
      "    - [[#^gtd]]\n",
  );
  assert.equal(budget.links.count, 3);
  assert.equal(budget.status, "ok");
  assert.deepEqual(codes(budget), []);
  const gtd = budget.entries.find((entry) => entry.name === "GTD");
  assert.equal(gtd.exempt, true);
  assert.equal(gtd.links, 0);
});

// docs/plan.md conformance example 3: unnamed placeholders with and
// without links.
test("conformance: unnamed placeholders", () => {
  const budget = computePlanBudget(
    "## Pomodoros\n" +
      "\n" +
      "- [ ] ()\n" +
      "    - [[solo#^one]]\n" +
      "- [ ] ()\n" +
      "- [ ] () — GOALS\n",
  );
  assert.deepEqual(budget.themeNames, ["(unnamed)", "GOALS"]);
  assert.equal(budget.themes.count, 2);
  assert.equal(budget.links.count, 1);
});

// docs/plan.md conformance example 4: `### Notes` inside the section.
test("conformance: subheading in the section", () => {
  const budget = computePlanBudget(
    "## Pomodoros\n" +
      "\n" +
      "- [ ] () — GOALS\n" +
      "    - [[task#^aaa]]\n" +
      "\n" +
      "### Notes\n" +
      "\n" +
      "- [[task#^bbb]] is just prose, not a link under GOALS\n",
  );
  assert.equal(budget.links.count, 1);
  assert.deepEqual(codes(budget), ["subheading_in_pomodoros"]);
});

// docs/plan.md conformance example 5: an open `LATER`.
test("conformance: open inventory label", () => {
  const budget = computePlanBudget(
    "## Pomodoros\n" + "\n" + "- [ ] () — LATER\n" + "    - [[task#^aaa]]\n",
  );
  assert.deepEqual(budget.themeNames, ["LATER"]);
  assert.equal(budget.themes.count, 1);
  assert.deepEqual(codes(budget), ["inventory_label_open"]);
});

// docs/plan.md conformance example 6: four themes (over the cap).
test("conformance: over the cap", () => {
  const budget = computePlanBudget(
    "## Pomodoros\n" +
      "\n" +
      "- [ ] () — ONE\n" +
      "- [ ] () — TWO\n" +
      "- [ ] () — THREE\n" +
      "- [ ] () — FOUR\n",
  );
  assert.equal(budget.themes.count, 4);
  assert.equal(budget.status, "over");
  assert.deepEqual(codes(budget), ["plan_theme_cap_exceeded"]);
});

// docs/plan.md conformance example 7: a `[-]` entry and a completed entry.
test("conformance: cancelled and completed entries", () => {
  const budget = computePlanBudget(
    "## Pomodoros\n" +
      "\n" +
      "- [-] () — GONE\n" +
      "    - [[task#^aaa]]\n" +
      "- [x] () — DONE\n" +
      "    - [[task#^bbb]]\n" +
      "- [ ] () — GOALS\n" +
      "    - [[task#^ccc]]\n",
  );
  assert.deepEqual(budget.themeNames, ["GOALS"]);
  assert.equal(budget.themes.count, 1);
  assert.equal(budget.links.count, 1);
});

test("exactly at the cap is fine", () => {
  const budget = computePlanBudget(
    "## Pomodoros\n" +
      "\n" +
      "- [ ] () — ONE\n" +
      "- [ ] () — TWO\n" +
      "- [ ] () — THREE\n",
  );
  assert.equal(budget.status, "ok");
  assert.deepEqual(codes(budget), []);
});

test("no Pomodoros section degrades to an empty budget", () => {
  const budget = computePlanBudget("# Notes\n\n- [ ] () — GOALS\n");
  assert.equal(budget.hasSection, false);
  assert.equal(budget.status, "ok");
  assert.deepEqual(budget.themeNames, []);
});

test("fenced code never counts", () => {
  const budget = computePlanBudget(
    "## Pomodoros\n" +
      "\n" +
      "- [ ] () — GOALS\n" +
      "    - [[task#^aaa]]\n" +
      "```\n" +
      "- [[task#^bbb]]\n" +
      "```\n",
  );
  assert.equal(budget.links.count, 1);
});

test("highlight is the first open non-exempt entry; running is the timed one", () => {
  const budget = computePlanBudget(
    "## Pomodoros\n" +
      "\n" +
      "- [ ] () — GTD\n" +
      "- [ ] (0945-1015) — GOALS\n" +
      "    - [[a#^one]]\n" +
      "- [ ] () — DECKS\n",
  );
  assert.equal(budget.entries[0].exempt, true);
  assert.equal(budget.entries[0].highlight, false);
  assert.equal(budget.entries[1].highlight, true);
  assert.equal(budget.entries[1].running, true);
  assert.equal(budget.entries[1].timeRange, "0945-1015");
  assert.equal(budget.entries[2].running, false);
});

test("hasNowTag matches only whole tokens", () => {
  assert.equal(hasNowTag("#now"), true);
  assert.equal(hasNowTag("fix it #now today"), true);
  assert.equal(hasNowTag("#nowadays"), false);
  assert.equal(hasNowTag("#now/x"), false);
  assert.equal(hasNowTag("x#now"), false);
  assert.equal(hasNowTag("#now!"), false);
  assert.equal(hasNowTag(""), false);
});

test("parsePlanCaps defaults, overrides, and invalid fallbacks", () => {
  assert.deepEqual(parsePlanCaps(null), defaultPlanCaps());
  assert.deepEqual(parsePlanCaps({}), defaultPlanCaps());
  const caps = parsePlanCaps({
    plan: {
      max_themes: 5,
      max_links: 12,
      max_now: 20,
      strict: true,
      exempt: ["GTD", "ADMIN"],
      inventory_labels: ["LATER"],
    },
  });
  assert.deepEqual(caps, {
    maxThemes: 5,
    maxLinks: 12,
    maxNow: 20,
    strict: true,
    exempt: ["GTD", "ADMIN"],
    inventoryLabels: ["LATER"],
  });
  assert.deepEqual(
    parsePlanCaps({
      plan: {
        max_themes: 0,
        max_links: 2.5,
        max_now: "many",
        strict: "yes",
        exempt: [""],
        inventory_labels: "LATER",
      },
    }),
    defaultPlanCaps(),
  );
});

function nowTask(overrides = {}) {
  return {
    status: { type: "TODO", name: "Task" },
    tags: [],
    path: "notes/a.md",
    ...overrides,
  };
}

test("nowBudgetFromTasks mirrors the NOW query", () => {
  const today = new Date(2026, 8, 30);
  const tasks = [
    nowTask({ description: "open #now", tags: ["#now", "#task"] }),
    nowTask({
      description: "done #now",
      tags: ["#now"],
      status: { type: "DONE", name: "Done" },
    }),
    nowTask({
      description: "cancelled #now",
      tags: ["#now"],
      status: { type: "CANCELLED", name: "Cancelled" },
    }),
    nowTask({ description: "hidden #now", tags: ["#now", "#hide"] }),
    nowTask({ description: "tmpl #now", tags: ["#now"], path: "_templates/x.md" }),
    nowTask({
      description: "conflict #now",
      tags: ["#now"],
      path: "notes/_conflicts/a.md",
    }),
    nowTask({
      description: "future #now",
      tags: ["#now"],
      scheduledDate: new Date(2026, 9, 1),
    }),
    nowTask({
      description: "today #now",
      tags: ["#now"],
      scheduledDate: new Date(2026, 8, 30),
    }),
    nowTask({
      description: "blocked #now",
      tags: ["#now"],
      isBlocked: () => true,
    }),
    nowTask({ description: "#nowadays", tags: ["#task"] }),
    nowTask({ description: "subtag", tags: ["#now/x"] }),
  ];
  const budget = nowBudgetFromTasks(tasks, today);
  assert.equal(budget.count, 2);
  assert.equal(budget.cap, 15);
  assert.equal(budget.over, false);
});

test("nowBudgetFromTasks flags the over-cap week", () => {
  const tasks = Array.from({ length: 16 }, (_, index) =>
    nowTask({ description: `bet ${index} #now`, tags: ["#now"] }),
  );
  const budget = nowBudgetFromTasks(tasks, new Date(2026, 8, 30));
  assert.equal(budget.count, 16);
  assert.equal(budget.over, true);
});

test("loadPlanCaps falls back to defaults without fs", () => {
  const loaded = loadPlanCaps({
    fsModule: null,
    Platform: { isDesktopApp: true },
  });
  assert.deepEqual(loaded.caps, defaultPlanCaps());
  assert.equal(loaded.invalid, false);
});

test("loadPlanCaps falls back to defaults on mobile", () => {
  const loaded = loadPlanCaps({
    fsModule: { readFileSync: () => "{}" },
    Platform: { isDesktopApp: false },
  });
  assert.deepEqual(loaded.caps, defaultPlanCaps());
  assert.equal(loaded.invalid, false);
});

test("loadPlanCaps reads plan: and flags invalid values", () => {
  const good = loadPlanCaps({
    fsModule: {
      readFileSync: () =>
        JSON.stringify({ plan: { max_themes: 2, strict: true } }),
    },
    parseYaml: (text) => JSON.parse(text),
    Platform: { isDesktopApp: true },
    configPath: "/cfg/bob/config.yml",
  });
  assert.equal(good.caps.maxThemes, 2);
  assert.equal(good.caps.strict, true);
  assert.equal(good.caps.maxLinks, 10);
  assert.equal(good.invalid, false);
  assert.equal(good.configPath, "/cfg/bob/config.yml");

  const bad = loadPlanCaps({
    fsModule: {
      readFileSync: () => JSON.stringify({ plan: { max_themes: 0 } }),
    },
    parseYaml: (text) => JSON.parse(text),
    Platform: { isDesktopApp: true },
    configPath: "/cfg/bob/config.yml",
  });
  assert.deepEqual(bad.caps, defaultPlanCaps());
  assert.equal(bad.invalid, true);

  const missing = loadPlanCaps({
    fsModule: {
      readFileSync: () => {
        const error = new Error("no such file");
        error.code = "ENOENT";
        throw error;
      },
    },
    parseYaml: (text) => JSON.parse(text),
    Platform: { isDesktopApp: true },
  });
  assert.deepEqual(missing.caps, defaultPlanCaps());
  assert.equal(missing.invalid, false);
});

test("planBlockTargetPath prefers the containing daily note", () => {
  assert.equal(
    planBlockTargetPath({}, "2026/20260930.md"),
    "2026/20260930.md",
  );
  const fallback = planBlockTargetPath({}, "dash.md");
  assert.match(fallback, /^\d{4}\/\d{8}\.md$/);
});

test("planBlockModel degrades to placeholders, never an error", () => {
  const model = planBlockModel({ content: null, tasks: null, today: new Date() });
  assert.equal(model.planText, "PLAN –");
  assert.equal(model.nowText, "NOW –");
  assert.equal(model.themesText, "");
  assert.deepEqual(model.lints, []);
  assert.equal(model.over, false);
});

test("planBlockModel renders chips, themes, and lints", () => {
  const tasks = [
    nowTask({ description: "open #now", tags: ["#now", "#task"] }),
  ];
  const model = planBlockModel({
    content: "## Pomodoros\n\n- [ ] () — GOALS\n    - [[a#^aaa]]\n",
    tasks,
    today: new Date(2026, 8, 30),
    caps: defaultPlanCaps(),
    sourcePath: "2026/20260930.md",
    app: {},
  });
  assert.equal(model.planText, "PLAN 1/3 · 1/10");
  assert.equal(model.nowText, "NOW 1/15");
  assert.equal(model.themesText, "★ GOALS");
  assert.equal(model.over, false);
});

test("planBlockModel adds now_cap_exceeded when the week is over", () => {
  const tasks = Array.from({ length: 16 }, (_, index) =>
    nowTask({ description: `bet ${index} #now`, tags: ["#now"] }),
  );
  const model = planBlockModel({
    content: "## Pomodoros\n\n- [ ] () — GOALS\n",
    tasks,
    today: new Date(2026, 8, 30),
    caps: defaultPlanCaps(),
  });
  assert.equal(model.over, true);
  assert.ok(
    model.lints.some((lint) => lint.endsWith("now_cap_exceeded")),
    `expected a now_cap_exceeded lint, got ${JSON.stringify(model.lints)}`,
  );
});

test("plugin exposes the versioned api and registers the bob-plan block", async () => {
  const files = {
    "2026/20260930.md": "## Pomodoros\n\n- [ ] () — GOALS\n    - [[a#^aaa]]\n",
  };
  const app = makeApp({
    vault: {
      getAbstractFileByPath: (path) =>
        files[path] ? { path } : null,
      cachedRead: (file) => Promise.resolve(files[file.path] || null),
    },
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": {
          getTasks: () => [
            nowTask({ description: "open #now", tags: ["#now", "#task"] }),
          ],
        },
      },
    },
  });
  const plugin = new LedgerToolsPlugin(app, {});
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/bob-plan-test";
  try {
    plugin.onload();
    assert.equal(plugin.api.version, 1);
    assert.deepEqual(plugin.api.caps(), defaultPlanCaps());
    assert.equal(typeof plugin.codeBlocks["bob-plan"], "function");

    const sync = plugin.api.planBudget({ content: files["2026/20260930.md"] });
    assert.equal(sync.themeNames.join(","), "GOALS");

    const asyncBudget = await plugin.api.planBudget({
      path: "2026/20260930.md",
    });
    assert.equal(asyncBudget.themeNames.join(","), "GOALS");

    const now = plugin.api.nowBudget();
    assert.equal(now.count, 1);

    plugin.onunload();
    assert.equal(plugin.planBlockViews.size, 0);
  } finally {
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
  }
});

test("invalid plan block falls back to full defaults", () => {
  for (const block of [
    { max_themes: "many" },
    { strict: "yes" },
    { exempt: "GTD" },
    { max_themes: 5, exempt: ["GTD", 7] },
  ]) {
    const { caps, invalid } = coercePlanCaps(block);
    assert.equal(invalid, true);
    assert.deepEqual(caps, defaultPlanCaps());
  }
});

test("entries require column-0 dash-space with one status char", () => {
  for (const content of [
    "## Pomodoros\n\n- [] — GOALS\n    - [[a#^one]]\n",
    "## Pomodoros\n\n-\t[ ] — GOALS\n    - [[a#^one]]\n",
    "## Pomodoros\n\n- [ab] — GOALS\n    - [[a#^one]]\n",
  ]) {
    const budget = computePlanBudget(content);
    assert.equal(budget.links.count, 0, content);
    assert.equal(budget.themes.count, 0, content);
  }
});

test("crlf line endings split like lf", () => {
  const lf = computePlanBudget("## Pomodoros\n\n- [ ] () — GOALS\n    - [[a#^one]]\n");
  const crlf = computePlanBudget("## Pomodoros\r\n\r\n- [ ] () — GOALS\r\n    - [[a#^one]]\r\n");
  assert.deepEqual(crlf, lf);
});

test("conformance: empty target means the daily note", () => {
  const content =
    "## Pomodoros\n\n- [ ] () — GOALS\n" +
    "    - [[#^aaa]]\n" +
    "    - [[2026/20260930#^aaa]]\n" +
    "    - [[20260930#^aaa]]\n";
  const budget = computePlanBudget(content, undefined, "2026/20260930.md");
  assert.equal(budget.links.count, 1);
  assert.equal(budget.entries[0].links, 1);
});

test("now predicate matches hide subtags, case, and non-task", () => {
  const today = new Date(2026, 8, 30);
  const base = (overrides = {}) => ({
    description: "bet #now",
    tags: ["#now"],
    path: "notes/a.md",
    status: { type: "TODO", name: "Todo" },
    isBlocked: () => false,
    ...overrides,
  });
  const tasks = [
    base({ tags: ["#now", "#hide/x"] }),
    base({ tags: ["#now", "#Hide"] }),
    base({ path: "Notes/_TEMPLATES/x.md" }),
    base({ path: "notes/_CONFLICTS/a.md" }),
    base({ status: { type: "NON_TASK", name: "Note" } }),
    base(),
  ];
  const budget = nowBudgetFromTasks(tasks, today);
  assert.equal(budget.count, 1);
});
