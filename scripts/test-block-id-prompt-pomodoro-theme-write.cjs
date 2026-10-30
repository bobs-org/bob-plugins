const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const {
  Plugin,
  helpers,
  noticeMessages,
  resetNotices,
  lastNotice,
  localDate,
  createEditor,
  sourceForPomodoroLink,
  createTaskModeHarness,
  installMockInboxRoute,
} = require("./block-id-prompt-harness.cjs");

const originalModuleLoad = Module._load;
Module._load = function loadLedgerToolsWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      MarkdownView: class {},
      Notice: class {},
      Platform: { isDesktopApp: false },
      Plugin: class {},
      normalizePath: (value) => value,
      parseYaml: () => ({}),
      editorInfoField: {},
      editorLivePreviewField: {},
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: { define: () => ({ of: (value) => ({ value }) }) },
      RangeSetBuilder: class {
        add() {}
        finish() { return []; }
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
  return originalModuleLoad.call(this, request, parent, isMain);
};
let LedgerThemeHelpers;
try {
  LedgerThemeHelpers = require("../plugins/bob-ledger-tools/main.js").helpers;
} finally {
  Module._load = originalModuleLoad;
}

function noteSuggestion(overrides = {}) {
  return {
    theme: { key: "write", name: "WRITE", known: true, hue: "violet", hue_source: "hash" },
    source: "note",
    label: "from sase_blog",
    from: {
      path: "Areas/sase_blog.md",
      stem: "sase_blog",
      kind: "area",
      chain: ["Areas/sase_blog.md"],
      hue: "aqua",
    },
    ...overrides,
  };
}

function stubClearTaskTheme(line) {
  return String(line).replace(/[ \t]*[\[(](?:theme|type)::[^\]\n\)]*[\]\)]/g, "");
}

function stubSetTaskTheme(line, name) {
  const cleared = stubClearTaskTheme(line).replace(/[ \t]+$/g, "");
  const idMatch = cleared.match(/^(.*?)([ \t]+\^[A-Za-z0-9_-]+)$/);
  if (idMatch) {
    return `${idMatch[1]} [type:: ${name}]${idMatch[2]}`;
  }
  return `${cleared} [type:: ${name}]`;
}

function stubTaskThemeOf(line) {
  const matches = [...String(line).matchAll(/[\[(](?:theme|type)::\s*([^\]\n\)]*)[\]\)]/g)];
  if (matches.length === 0) {
    return { state: "none" };
  }
  if (matches.length > 1) {
    return { state: "repair", repair: "duplicate", fields: matches };
  }
  const value = matches[0][1].trim();
  if (!value || /[+]|[^A-Za-z0-9 &'(),./-]/.test(value)) {
    return { state: "repair", repair: "invalid", fields: matches };
  }
  return { state: "set", value: value.toUpperCase(), key: value.toLowerCase(), fields: matches };
}

function suggestionKeyOf(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase() || null;
  }
  const theme = value.theme && typeof value.theme === "object" ? value.theme : value;
  const key = theme && typeof theme.key === "string" ? theme.key.trim().toLowerCase() : "";
  return key || null;
}

function suggestionNameOf(value) {
  if (typeof value === "string") {
    return value.trim().toUpperCase();
  }
  const theme = value && value.theme && typeof value.theme === "object" ? value.theme : value;
  if (theme && typeof theme.name === "string" && theme.name) {
    return theme.name;
  }
  const key = suggestionKeyOf(value);
  return key ? key.toUpperCase() : "";
}

function stubPlanRetype(options = {}) {
  const destination = String(options.destination || options.destinationName || "");
  const parts = destination.split("+").map((part) => part.trim()).filter(Boolean);
  const typeParts = parts.filter((part) => part.toLowerCase() !== "later");
  if (typeParts.length === 0) {
    return { kind: "container" };
  }
  const effectiveKey = suggestionKeyOf(options.effective || options.suggestion);
  const destKeys = parts.map((part) => part.toLowerCase());
  if (effectiveKey && destKeys.includes(effectiveKey)) {
    return { kind: "consistent" };
  }
  if (options.keepType === true) {
    return { kind: "merge", name: `${destination.trim()} + ${suggestionNameOf(options.effective || options.suggestion)}` };
  }
  let chosen = null;
  if (options.tabPick) {
    const want = String(options.tabPick).trim().toLowerCase();
    chosen = typeParts.find((part) => part.toLowerCase() === want) || null;
  }
  if (!chosen) {
    const exempt = new Set(
      (Array.isArray(options.exemptKeys) ? options.exemptKeys : ["PLAN"])
        .map((key) => String(key).trim().toLowerCase()),
    );
    chosen = typeParts.find((part) => !exempt.has(part.toLowerCase())) || typeParts[0];
  }
  const inheritedKey = suggestionKeyOf(options.inherited);
  if (inheritedKey && inheritedKey === chosen.toLowerCase()) {
    return { kind: "clear" };
  }
  return { kind: "set", name: chosen.toUpperCase(), key: chosen.toLowerCase() };
}

function realPlanRetype(options = {}, catalog = [], exempt = ["PLAN"]) {
  return LedgerThemeHelpers.planRetype({
    effectiveKey: suggestionKeyOf(options.effective || options.suggestion),
    effectiveName: suggestionNameOf(options.effective || options.suggestion),
    inheritedKey: suggestionKeyOf(options.inherited),
    destination: options.destination || options.destinationName,
    keepType: options.keepType === true,
    tabPick: options.tabPick,
  }, {
    vocab: catalog.map((theme) => theme.key),
    exempt,
    inventory: ["LATER"],
  });
}

function suggestForLine(text, lineIndex, fallback) {
  const lines = String(text || "").split("\n");
  const line = Number.isInteger(lineIndex) && lineIndex >= 0 ? lines[lineIndex] || "" : "";
  const field = stubTaskThemeOf(line);
  if (field.state === "set") {
    return {
      theme: { key: field.key, name: field.value, known: true, hue: "orange", hue_source: "hash" },
      source: "task",
      inherited: fallback,
    };
  }
  return fallback;
}

function installThemeWriteApis(plugin, options = {}) {
  const suggestion = Object.prototype.hasOwnProperty.call(options, "suggestion")
    ? options.suggestion
    : noteSuggestion();
  const catalog = options.catalog || [
    { key: "write", name: "WRITE" },
    { key: "fix", name: "FIX" },
    { key: "build", name: "BUILD" },
  ];
  const setterCalls = options.setterCalls || [];
  plugin.app = plugin.app || {};
  plugin.app.plugins = plugin.app.plugins || { plugins: {} };
  const existing = plugin.app.plugins.plugins || {};
  plugin.app.plugins.plugins = {
    ...existing,
    "bob-ledger-tools": {
      api: {
        version: 3,
        ...(!options.noCaps ? {
          caps: options.caps || (() => ({
            exempt: options.exempt || ["PLAN"],
            strict: false,
            maxThemes: 3,
          })),
        } : {}),
        planBudget: options.planBudget || (() => null),
        themes: {
          version: 1,
          suggestFor: options.suggestFor || ((request) => {
            const oneBased = request && Number.isInteger(request.line) ? request.line : 1;
            return suggestForLine(request && request.text, oneBased - 1, suggestion);
          }),
          taskThemeOf: options.taskThemeOf || (options.useRealHelpers
            ? LedgerThemeHelpers.pomodoroThemeTaskFieldState
            : stubTaskThemeOf),
          setTaskTheme: (text, name) => {
            setterCalls.push(["set", text, name]);
            return options.useRealHelpers
              ? LedgerThemeHelpers.pomodoroThemeSetTaskTheme(text, name)
              : stubSetTaskTheme(text, name);
          },
          clearTaskTheme: (text) => {
            setterCalls.push(["clear", text]);
            return options.useRealHelpers
              ? LedgerThemeHelpers.pomodoroThemeClearTaskTheme(text)
              : stubClearTaskTheme(text);
          },
          planRetype: options.planRetype || ((opts) => (options.useRealHelpers
            ? realPlanRetype(opts, catalog, options.exempt || ["PLAN"])
            : stubPlanRetype(opts))),
          typeComponentsOf: (name) => String(name || "")
            .split("+")
            .map((raw) => raw.trim())
            .filter(Boolean)
            .map((component) => ({
              name: component,
              key: component.toLowerCase(),
              isType: component.toLowerCase() !== "later",
            })),
          snapshot: () => ({ themes: catalog }),
          isKnownTheme: (key) => catalog.some((theme) => theme.key === String(key).toLowerCase()),
        },
        ...(options.freshness ? { freshness: options.freshness } : {}),
      },
    },
  };
  return setterCalls;
}

function namedDaily(name = "FIX") {
  return ["## Pomodoros", `- [ ] () — ${name}`].join("\n");
}

function existingTarget(name, intent) {
  return {
    kind: "existing",
    entryLine: 1,
    entryText: `- [ ] () — ${name}`,
    title: name,
    themeIntent: intent,
  };
}

function taskFieldSuggestion(name, inherited = noteSuggestion()) {
  return {
    theme: { key: name.toLowerCase(), name, known: true, hue: "orange", hue_source: "hash" },
    source: "task",
    inherited,
  };
}

function deliberateIntent(shown = noteSuggestion()) {
  return { deliberate: true, linkOnce: false, shown };
}

async function linkWithIntent({
  taskContent,
  dailyContent,
  taskPath = "Tasks.md",
  intent,
  destination = "FIX",
  isNewId = false,
  id = "ship",
  apis,
  dailyFailAfter = 0,
}) {
  resetNotices();
  const editor = createEditor(taskContent);
  const source = sourceForPomodoroLink(editor, taskPath, 0);
  source.pomodoroTarget = existingTarget(destination, intent);
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === taskPath ? { path: taskPath } : null);
  const writes = [];
  let dailyReads = 0;
  plugin.app = {
    vault: {
      read: async (file) => {
        if (file.path !== "Daily.md") {
          return null;
        }
        dailyReads += 1;
        if (dailyFailAfter > 0 && dailyReads > dailyFailAfter) {
          return `${dailyContent}\n# drifted`;
        }
        return dailyContent;
      },
      modify: async (file, content) => {
        writes.push({ path: file.path, content });
      },
    },
    metadataCache: {
      fileToLinktext: (file) => file.path.replace(/\.md$/, ""),
    },
  };
  plugin.resolveReferenceDestination = () => null;
  plugin.suppressEditorScans = () => {};
  const setterCalls = installThemeWriteApis(plugin, apis || {});
  const result = await plugin.applyPomodoroTaskLink(source, id, isNewId);
  return { result, editor, writes, setterCalls, plugin };
}

test("theme suggestion identity ignores decorative hue and catalog flags", () => {
  const left = helpers.pomodoroThemeSuggestionIdentity(noteSuggestion({
    theme: { key: "write", name: "Write", known: true, hue: "violet", hue_source: "hash", configured: true },
  }));
  const right = helpers.pomodoroThemeSuggestionIdentity(noteSuggestion({
    theme: { key: "WRITE", name: "WRITE", known: false, hue: "blue", hue_source: "pin" },
  }));
  assert.equal(helpers.pomodoroThemeSuggestionsMatch(left, right), true);
});

test("theme suggestion identity treats a changed declaring note as a different suggestion", () => {
  const left = helpers.pomodoroThemeSuggestionIdentity(noteSuggestion());
  const right = helpers.pomodoroThemeSuggestionIdentity(noteSuggestion({
    from: {
      path: "Areas/dev.md",
      stem: "dev",
      kind: "area",
      chain: ["Areas/dev.md"],
      hue: "aqua",
    },
  }));
  assert.equal(helpers.pomodoroThemeSuggestionsMatch(left, right), false);
});

test("current exempt keys distinguish valid empty configuration from unavailable caps", () => {
  const unavailable = [
    null,
    {},
    { caps: () => { throw new Error("caps failed"); } },
    { caps: () => Promise.resolve({ exempt: [] }) },
    { caps: () => null },
    { caps: () => ({ exempt: "PLAN" }) },
    { caps: () => ({ exempt: ["PLAN", null] }) },
    { caps: () => ({ exempt: ["PLAN + FIX"] }) },
  ];
  for (const api of unavailable) {
    assert.deepEqual(
      helpers.pomodoroThemeWriteExemptKeys(api),
      { available: false, keys: [] },
    );
  }
  assert.deepEqual(
    helpers.pomodoroThemeWriteExemptKeys({ caps: () => ({ exempt: [] }) }),
    { available: true, keys: [] },
  );
  assert.deepEqual(
    helpers.pomodoroThemeWriteExemptKeys({ caps: () => ({ exempt: [" Custom "] }) }),
    { available: true, keys: ["Custom"] },
  );
});

test("planTargetTaskUpdate applies themeEdit after lane changes and before a new block ID", () => {
  const seen = [];
  const plan = helpers.planTargetTaskUpdate("- [ ] #task Ship it", 0, {
    activationEligible: true,
    forceNext: true,
    newBlockId: "ship",
    now: localDate(2026, 8, 15),
    themeEdit: {
      action: "set",
      name: "FIX",
      apply: (line) => {
        seen.push(line);
        return stubSetTaskTheme(line, "FIX");
      },
    },
  });
  assert.deepEqual(seen, ["- [*] #task Ship it"]);
  assert.equal(plan.themeChanged, true);
  assert.equal(plan.themeAction, "set");
  assert.equal(plan.themeName, "FIX");
  assert.equal(plan.content, "- [*] #task Ship it [type:: FIX] ^ship");
  assert.equal(plan.hasChanges, true);
});

test("planTargetTaskUpdate theme-only Next task never stamps freshness", () => {
  let calls = 0;
  const plan = helpers.planTargetTaskUpdate("- [*] #task Ship it ^ship", 0, {
    activationEligible: true,
    forceNext: true,
    now: localDate(2026, 8, 15),
    stampLine: (line, dateText) => {
      calls += 1;
      return `${line} [fresh:: ${dateText}]`;
    },
    freshDateText: "2026-08-15",
    themeEdit: {
      action: "set",
      name: "FIX",
      apply: (line) => stubSetTaskTheme(line, "FIX"),
    },
  });
  assert.equal(calls, 0);
  assert.equal(plan.freshnessChanged, false);
  assert.equal(plan.statusChanged, false);
  assert.equal(plan.themeChanged, true);
  assert.equal(plan.hasChanges, true);
  assert.equal(plan.content, "- [*] #task Ship it [type:: FIX] ^ship");
});

test("planTargetTaskUpdate stamps a lane rewrite after the theme field is in place", () => {
  const seen = [];
  const plan = helpers.planTargetTaskUpdate("- [ ] #task Ship it ^ship", 0, {
    activationEligible: true,
    forceNext: true,
    now: localDate(2026, 8, 15),
    stampLine: (line, dateText) => {
      seen.push(line);
      return `${line} [fresh:: ${dateText}]`;
    },
    freshDateText: "2026-08-15",
    themeEdit: {
      action: "set",
      name: "FIX",
      apply: (line) => stubSetTaskTheme(line, "FIX"),
    },
  });
  assert.equal(plan.statusChanged, true);
  assert.equal(plan.themeChanged, true);
  assert.equal(plan.freshnessChanged, true);
  assert.deepEqual(seen, ["- [*] #task Ship it [type:: FIX] ^ship"]);
  assert.equal(plan.content, "- [*] #task Ship it [type:: FIX] ^ship [fresh:: 2026-08-15]");
});

test("planTargetTaskUpdate without themeEdit preserves an authored theme field", () => {
  const line = "- [ ] #task Ship it [theme:: FIX] ^ship";
  const plan = helpers.planTargetTaskUpdate(line, 0, {
    activationEligible: true,
    forceNext: true,
    now: localDate(2026, 8, 15),
  });
  assert.equal(plan.themeChanged, false);
  assert.equal(plan.content, "- [*] #task Ship it [theme:: FIX] ^ship");
});

test("planTargetTaskUpdate clears a theme field and keeps CRLF plus a trailing block ID", () => {
  const plan = helpers.planTargetTaskUpdate("- [*] #task Ship it [theme:: FIX] ^ship\r", 0, {
    activationEligible: true,
    forceNext: true,
    now: localDate(2026, 8, 15),
    themeEdit: {
      action: "clear",
      apply: (line) => stubClearTaskTheme(line),
    },
  });
  assert.equal(plan.themeChanged, true);
  assert.equal(plan.themeAction, "clear");
  assert.equal(plan.content, "- [*] #task Ship it ^ship\r");
});

test("a named destination retypes the task in the same cross-note write", async () => {
  const { result, editor, writes, setterCalls } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX"),
    intent: deliberateIntent(),
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it [type:: FIX] ^ship");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "Daily.md");
  assert.ok(writes[0].content.includes("[[Tasks#^ship]]"));
  assert.equal(setterCalls.length, 1);
  assert.equal(lastNotice(), "Linked under FIX · stays Next · type FIX");
});

test("unavailable current caps still retype the task and retain lane, ID, and freshness edits", async () => {
  const invalidCaps = [
    { noCaps: true },
    { caps: () => { throw new Error("caps failed"); } },
    { caps: () => Promise.resolve({ exempt: ["PLAN"] }) },
    { caps: () => ({ exempt: "PLAN" }) },
    { caps: () => ({ exempt: ["PLAN", null] }) },
  ];
  for (const apis of invalidCaps) {
    const { result, editor, setterCalls } = await linkWithIntent({
      taskContent: "- [ ] #task Ship it [theme:: authored]",
      dailyContent: namedDaily("FIX"),
      intent: deliberateIntent(taskFieldSuggestion("AUTHORED")),
      isNewId: true,
      apis: {
        useRealHelpers: true,
        freshness: {
          stampLine: (line, dateText) => `${line} [fresh:: ${dateText}]`,
        },
        ...apis,
      },
    });
    assert.equal(result, true);
    assert.equal(
      editor.getValue(),
      "- [*] #task Ship it [type:: FIX] ^ship [fresh:: 2026-08-15]",
    );
    assert.equal(setterCalls.length, 1);
    assert.match(lastNotice(), /type FIX$/);
  }
});

test("real Ledger Tools planner writes with an empty exempt list and custom exemptions", async () => {
  const writes = [
    { destination: "PLAN", exempt: [], expected: "Plan" },
    { destination: "CUSTOM + FIX", exempt: ["CUSTOM"], expected: "Fix" },
    { destination: "PLAN + FIX", exempt: ["PLAN"], expected: "Fix" },
  ];
  for (const item of writes) {
    const { result, editor, setterCalls } = await linkWithIntent({
      taskContent: "- [*] #task Ship it ^ship",
      dailyContent: namedDaily(item.destination),
      intent: deliberateIntent(),
      destination: item.destination,
      apis: {
        useRealHelpers: true,
        exempt: item.exempt,
        catalog: [
          { key: "plan", name: "Plan" },
          { key: "fix", name: "Fix" },
        ],
      },
    });
    assert.equal(result, true);
    assert.equal(editor.getValue(), `- [*] #task Ship it [type:: ${item.expected}] ^ship`);
    assert.equal(setterCalls[0][0], "set");
    assert.match(lastNotice(), new RegExp(`type ${item.expected}$`));
  }
});

test("a Ready scheduled task sets Next, logs the date, and remembers the theme", async () => {
  const content = [
    "- [ ] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "  - 🗓️ **SCHEDULE LOG**",
  ].join("\n");
  const { result, editor } = await linkWithIntent({
    taskContent: content,
    dailyContent: namedDaily("FIX"),
    intent: deliberateIntent(),
  });
  assert.equal(result, true);
  assert.equal(
    editor.getValue(),
    [
      "- [*] #task Ship it [type:: FIX] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
    ].join("\n"),
  );
  assert.equal(
    lastNotice(),
    "Linked under FIX · Next · removed future schedule · logged schedule change · type FIX",
  );
});

test("choosing the inherited destination clears an existing task theme", async () => {
  const { result, editor, setterCalls } = await linkWithIntent({
    taskContent: "- [*] #task Ship it [theme:: FIX] ^ship",
    dailyContent: namedDaily("WRITE"),
    destination: "WRITE",
    intent: deliberateIntent(taskFieldSuggestion("FIX")),
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(setterCalls[0][0], "clear");
  assert.equal(lastNotice(), "Linked under WRITE · stays Next · type cleared");
});

test("a theme-only Next task with a new block ID still stamps because the ID rewrote the line", async () => {
  const seen = [];
  const { result, editor } = await linkWithIntent({
    taskContent: "- [*] #task Ship it",
    dailyContent: namedDaily("FIX"),
    intent: deliberateIntent(),
    isNewId: true,
    apis: {
      freshness: {
        stampLine: (line, dateText) => {
          seen.push(line);
          return `${line} [fresh:: ${dateText}]`;
        },
      },
    },
  });
  assert.equal(result, true);
  assert.ok(seen[0].includes("[type:: FIX]"));
  assert.equal(
    editor.getValue(),
    "- [*] #task Ship it [type:: FIX] ^ship [fresh:: 2026-08-15]",
  );
});

test("duplicate and paren theme fields repair only on an eligible deliberate write", async () => {
  const { result, editor } = await linkWithIntent({
    taskContent: "- [*] #task Ship it (theme:: FIX) [theme:: WRITE] ^ship",
    dailyContent: namedDaily("BUILD"),
    destination: "BUILD",
    intent: deliberateIntent(),
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it [type:: BUILD] ^ship");
});

test("a stale shown suggestion links and skips the theme edit", async () => {
  const { result, editor, setterCalls } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX"),
    intent: deliberateIntent(),
    apis: {
      suggestFor: () => noteSuggestion({
        theme: { key: "build", name: "BUILD", known: true, hue: "yellow", hue_source: "hash" },
        from: {
          path: "Areas/dev.md",
          stem: "dev",
          kind: "area",
          chain: ["Areas/dev.md"],
          hue: "blue",
        },
      }),
    },
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(setterCalls.length, 0);
  assert.equal(
    lastNotice(),
    "Linked under FIX · stays Next · type unchanged (suggestion changed)",
  );
});

test("decorative catalog metadata on a live suggestion does not skip the write", async () => {
  const { result, editor } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX"),
    intent: deliberateIntent(),
    apis: {
      suggestFor: () => noteSuggestion({
        theme: { key: "write", name: "WRITE", known: false, hue: "red", hue_source: "pin" },
      }),
    },
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it [type:: FIX] ^ship");
});

test("Alt+Enter keep-type merges the current type into the destination name", async () => {
  const { result, editor, setterCalls, writes } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX"),
    intent: { deliberate: false, linkOnce: true, shown: noteSuggestion() },
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(setterCalls.length, 0);
  assert.ok(writes[0].content.includes("— FIX + WRITE"));
  assert.ok(writes[0].content.includes("[[Tasks#^ship]]"));
  assert.equal(lastNotice(), "Linked under FIX + WRITE · stays Next · keeps WRITE");
});

test("Alt+Enter on a container equals Enter and keeps the type", async () => {
  const { result, editor, setterCalls, writes } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("LATER"),
    destination: "LATER",
    intent: { deliberate: false, linkOnce: true, shown: noteSuggestion() },
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(setterCalls.length, 0);
  assert.ok(writes[0].content.includes("— LATER"));
  assert.doesNotMatch(writes[0].content, /LATER \+/);
  assert.equal(lastNotice(), "Linked under LATER · stays Next · keeps WRITE");
});

test("untouched default (not deliberate) links without storing a field", async () => {
  const { result, editor, setterCalls } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("WRITE"),
    destination: "WRITE",
    intent: { deliberate: false, linkOnce: false, shown: noteSuggestion() },
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(setterCalls.length, 0);
  assert.equal(lastNotice(), "Linked under WRITE · stays Next · keeps WRITE");
});

test("absent theme APIs leave the picker write path usable without a field", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  source.pomodoroTarget = existingTarget("FIX", deliberateIntent());
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  plugin.app = {
    vault: {
      read: async () => namedDaily("FIX"),
      modify: async () => {},
    },
    metadataCache: { fileToLinktext: (file) => file.path.replace(/\.md$/, "") },
  };
  plugin.resolveReferenceDestination = () => null;
  plugin.suppressEditorScans = () => {};
  const result = await plugin.applyPomodoroTaskLink(source, "ship", false);
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(lastNotice(), "Linked under FIX · stays Next");
});

test("a blocked dependency consumption never writes a theme field", async () => {
  const h = createTaskModeHarness({
    taskContent: [
      "- [?] #task Apply [dependsOn:: jobs__review] ^apply",
      "- [ ] #task Review [id:: jobs__review] ^review",
    ].join("\n"),
    dailyContent: namedDaily("FIX"),
  });
  const taskFile = { path: "Tasks.md" };
  h.plugin.resolveTaskFile = () => taskFile;
  h.plugin.app.vault.getMarkdownFiles = () => [taskFile];
  installThemeWriteApis(h.plugin);
  const source = sourceForPomodoroLink(h.editor, "Tasks.md", 0);
  source.pomodoroTarget = existingTarget("FIX", deliberateIntent());
  const result = await h.plugin.applyPomodoroTaskLink(source, "apply", false);
  assert.equal(result, false);
  assert.equal(
    h.editor.getValue().split("\n")[0],
    "- [?] #task Apply [dependsOn:: jobs__review] ^apply",
  );
  assert.match(lastNotice(), /no Pomodoro link created/);
});

test("same-note combined edit writes the theme and the link in one editor transaction", async () => {
  resetNotices();
  const content = [
    "- [*] #task Ship it ^ship",
    "## Pomodoros",
    "- [ ] () — FIX",
  ].join("\n");
  const editor = createEditor(content);
  const source = sourceForPomodoroLink(editor, "Daily.md", 0);
  source.pomodoroTarget = existingTarget("FIX", deliberateIntent());
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Daily.md" ? { path: "Daily.md" } : null);
  plugin.app = {
    vault: {
      read: async () => {
        throw new Error("daily is the active note");
      },
      modify: async () => {
        throw new Error("same-note links never use vault.modify");
      },
    },
    metadataCache: { fileToLinktext: () => "" },
  };
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};
  const originalReplace = editor.replaceRange.bind(editor);
  let replaceCalls = 0;
  editor.replaceRange = (...args) => {
    replaceCalls += 1;
    return originalReplace(...args);
  };
  installThemeWriteApis(plugin);
  const result = await plugin.applyPomodoroTaskLink(source, "ship", false);
  assert.equal(result, true);
  assert.equal(replaceCalls, 2);
  const next = editor.getValue();
  assert.ok(next.includes("- [*] #task Ship it [type:: FIX] ^ship"));
  assert.ok(next.includes("[[#^ship]]"));
  assert.equal(lastNotice(), "Linked under FIX · stays Next · type FIX");
});

test("a failed daily write after a saved theme reports the theme and the link failure", async () => {
  const { result, editor } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX"),
    intent: deliberateIntent(),
    dailyFailAfter: 1,
  });
  assert.equal(result, false);
  assert.equal(editor.getValue(), "- [*] #task Ship it [type:: FIX] ^ship");
  assert.equal(lastNotice(), "Type FIX set, but Daily.md could not be updated");
});

test("catalog spelling wins over a canonical planRetype name", async () => {
  const { editor } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX"),
    intent: deliberateIntent(),
    apis: {
      catalog: [{ key: "fix", name: "Fix" }],
      planRetype: () => ({ kind: "set", name: "FIX", key: "fix" }),
    },
  });
  assert.equal(editor.getValue(), "- [*] #task Ship it [type:: Fix] ^ship");
  assert.equal(lastNotice(), "Linked under Fix · stays Next · type Fix");
});

test("an inbox task with no shown suggestion retypes from the live suggestion", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX"),
    taskPath: "mac_inbox.md",
  });
  installMockInboxRoute(h.plugin, [], {
    inboxPaths: ["mac_inbox.md"],
    promptOutcome: { kind: "move", path: "Areas/sase_blog.md", name: "sase_blog" },
    commitResult: {
      ok: true,
      name: "sase_blog",
      count: 1,
      notice: "",
      handledRefs: [],
      reason: null,
    },
  });
  installThemeWriteApis(h.plugin, {
    suggestion: noteSuggestion(),
  });
  const source = sourceForPomodoroLink(h.editor, "mac_inbox.md", 0);
  source.pomodoroTarget = existingTarget("FIX", {
    deliberate: true,
    linkOnce: false,
    shown: null,
  });
  const result = await h.plugin.applyPomodoroTaskLink(source, "ship", false);
  assert.equal(result, true);
  assert.equal(h.editor.getValue(), "- [*] #task Ship it [type:: FIX] ^ship");
  assert.match(lastNotice(), /type FIX/);
});

test("malformed themeIntent never enables a write", async () => {
  const { result, editor, setterCalls } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX"),
    intent: { deliberate: true, linkOnce: false, shown: { theme: { key: "" } } },
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(setterCalls.length, 0);
});

test("themeIntent survives normalizePomodoroLinkPickerChoice for a later consumer", () => {
  const shown = noteSuggestion();
  assert.deepEqual(
    helpers.normalizePomodoroLinkPickerChoice({
      kind: "new",
      name: "FIX",
      themeIntent: { deliberate: true, linkOnce: false, shown, tabPick: "fix" },
    }),
    {
      kind: "new",
      name: "FIX",
      themeIntent: { deliberate: true, linkOnce: false, shown, tabPick: "fix" },
    },
  );
});

test("Tab pick chooses that type component of a composite destination", async () => {
  const { result, editor } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX + BUILD"),
    destination: "FIX + BUILD",
    intent: { deliberate: true, linkOnce: false, shown: noteSuggestion(), tabPick: "build" },
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it [type:: BUILD] ^ship");
  assert.equal(lastNotice(), "Linked under BUILD · stays Next · type BUILD");
});

test("unlink preserves an authored task theme", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it [theme:: FIX] ^ship",
    dailyContent: [
      "## Pomodoros",
      "- [ ] () — FIX",
      "  - [[Tasks#^ship]]",
    ].join("\n"),
  });
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.equal(h.editor.getValue(), "- [*] #task Ship it [theme:: FIX] ^ship");
  assert.match(lastNotice(), /^Unlinked · stays Next/);
});
