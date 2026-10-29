const test = require("node:test");
const assert = require("node:assert/strict");
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
  return String(line).replace(/[ \t]*[\[(]theme::[^\]\n\)]*[\]\)]/g, "");
}

function stubSetTaskTheme(line, name) {
  const cleared = stubClearTaskTheme(line).replace(/[ \t]+$/g, "");
  const idMatch = cleared.match(/^(.*?)([ \t]+\^[A-Za-z0-9_-]+)$/);
  if (idMatch) {
    return `${idMatch[1]} [theme:: ${name}]${idMatch[2]}`;
  }
  return `${cleared} [theme:: ${name}]`;
}

function stubTaskThemeOf(line) {
  const matches = [...String(line).matchAll(/[\[(]theme::\s*([^\]\n\)]*)[\]\)]/g)];
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

function stubPlanThemeChange(options = {}) {
  if (options.deliberate !== true) {
    return { action: "none" };
  }
  const suggestion = options.suggestion;
  const shownKey = suggestion && suggestion.theme && suggestion.theme.key
    ? String(suggestion.theme.key).toLowerCase()
    : "";
  if (!shownKey) {
    return { action: "none" };
  }
  const exempt = new Set(
    (Array.isArray(options.exemptKeys) ? options.exemptKeys : [])
      .map((key) => String(key).trim().toLowerCase()),
  );
  const parts = String(options.destinationName || "")
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part && !exempt.has(part.toLowerCase()));
  if (parts.length !== 1) {
    return { action: "none" };
  }
  const destKey = parts[0].toLowerCase();
  const destName = parts[0].toUpperCase();
  const inherited = options.inherited;
  const inheritedKey = inherited && inherited.theme && inherited.theme.key
    ? String(inherited.theme.key).toLowerCase()
    : "";
  const field = options.field && typeof options.field === "object" ? options.field : {};
  if (inheritedKey && inheritedKey === destKey) {
    return field.state === "none" ? { action: "none" } : { action: "clear" };
  }
  if (field.state === "set" && field.key === destKey) {
    return { action: "none" };
  }
  return { action: "set", name: destName, key: destKey };
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
        caps: () => ({
          exempt: options.exempt || ["PLAN"],
          strict: false,
          maxThemes: 3,
        }),
        planBudget: options.planBudget || (() => null),
        themes: {
          version: 1,
          suggestFor: options.suggestFor || (() => suggestion),
          taskThemeOf: options.taskThemeOf || stubTaskThemeOf,
          setTaskTheme: (text, name) => {
            setterCalls.push(["set", text, name]);
            return stubSetTaskTheme(text, name);
          },
          clearTaskTheme: (text) => {
            setterCalls.push(["clear", text]);
            return stubClearTaskTheme(text);
          },
          planThemeChange: options.planThemeChange || stubPlanThemeChange,
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
  assert.equal(plan.content, "- [*] #task Ship it [theme:: FIX] ^ship");
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
  assert.equal(plan.content, "- [*] #task Ship it [theme:: FIX] ^ship");
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
  assert.deepEqual(seen, ["- [*] #task Ship it [theme:: FIX] ^ship"]);
  assert.equal(plan.content, "- [*] #task Ship it [theme:: FIX] ^ship [fresh:: 2026-08-15]");
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

test("a deliberate named destination sets the task theme in the same cross-note write", async () => {
  const { result, editor, writes, setterCalls } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX"),
    intent: deliberateIntent(),
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it [theme:: FIX] ^ship");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "Daily.md");
  assert.ok(writes[0].content.includes("[[Tasks#^ship]]"));
  assert.equal(setterCalls.length, 1);
  assert.equal(lastNotice(), "Linked under FIX · stays Next · task theme FIX");
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
      "- [*] #task Ship it [theme:: FIX] ^ship",
      "  - 🗓️ **SCHEDULE LOG**",
      "  \t- _2026-08-20 → 2026-08-15_ — 🍅 pulled into today's Pomodoro",
    ].join("\n"),
  );
  assert.equal(
    lastNotice(),
    "Linked under FIX · Next · removed future schedule · logged schedule change · task theme FIX",
  );
});

test("choosing the inherited destination clears an existing task theme", async () => {
  const { result, editor, setterCalls } = await linkWithIntent({
    taskContent: "- [*] #task Ship it [theme:: FIX] ^ship",
    dailyContent: namedDaily("WRITE"),
    destination: "WRITE",
    intent: deliberateIntent(),
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(setterCalls[0][0], "clear");
  assert.equal(lastNotice(), "Linked under WRITE · stays Next · task theme cleared");
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
  assert.ok(seen[0].includes("[theme:: FIX]"));
  assert.equal(
    editor.getValue(),
    "- [*] #task Ship it [theme:: FIX] ^ship [fresh:: 2026-08-15]",
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
  assert.equal(editor.getValue(), "- [*] #task Ship it [theme:: BUILD] ^ship");
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
    "Linked to FIX · stays Next · task theme unchanged (suggestion changed)",
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
  assert.equal(editor.getValue(), "- [*] #task Ship it [theme:: FIX] ^ship");
});

test("Alt+Enter link-once never writes a task theme", async () => {
  const { result, editor, setterCalls } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX"),
    intent: { deliberate: false, linkOnce: true, shown: noteSuggestion() },
  });
  assert.equal(result, true);
  assert.equal(editor.getValue(), "- [*] #task Ship it ^ship");
  assert.equal(setterCalls.length, 0);
  assert.equal(lastNotice(), "Linked to FIX · stays Next");
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
  assert.equal(lastNotice(), "Linked to FIX · stays Next");
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
  assert.ok(next.includes("- [*] #task Ship it [theme:: FIX] ^ship"));
  assert.ok(next.includes("[[#^ship]]"));
  assert.equal(lastNotice(), "Linked under FIX · stays Next · task theme FIX");
});

test("a failed daily write after a saved theme reports the theme and the link failure", async () => {
  const { result, editor } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX"),
    intent: deliberateIntent(),
    dailyFailAfter: 1,
  });
  assert.equal(result, false);
  assert.equal(editor.getValue(), "- [*] #task Ship it [theme:: FIX] ^ship");
  assert.equal(lastNotice(), "Task theme FIX saved, but Daily.md could not be updated");
});

test("catalog spelling wins over a canonical planThemeChange name", async () => {
  const { editor } = await linkWithIntent({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: namedDaily("FIX"),
    intent: deliberateIntent(),
    apis: {
      catalog: [{ key: "fix", name: "Fix" }],
      planThemeChange: () => ({ action: "set", name: "FIX", key: "fix" }),
    },
  });
  assert.equal(editor.getValue(), "- [*] #task Ship it [theme:: Fix] ^ship");
  assert.equal(lastNotice(), "Linked under Fix · stays Next · task theme Fix");
});

test("an inbox task with no shown suggestion does not remember a destination default", async () => {
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
  assert.equal(h.editor.getValue(), "- [*] #task Ship it ^ship");
  assert.doesNotMatch(lastNotice(), /task theme/);
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
      themeIntent: { deliberate: true, linkOnce: false, shown },
    }),
    {
      kind: "new",
      name: "FIX",
      themeIntent: { deliberate: true, linkOnce: false, shown },
    },
  );
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
