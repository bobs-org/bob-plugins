const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];

function parseTestYaml(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) {
      continue;
    }
    const match = /^([^:]+):(.*)$/.exec(line);
    if (!match) {
      throw new Error("malformed yaml");
    }
    const key = match[1].trim();
    let value = match[2].trim().replace(/\s+#.*$/, "");
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value || null;
  }
  return result;
}

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
    return ref;
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
    notices.push(String(message));
  }
}

class EmptyClass {}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: EmptyClass,
      Modal: EmptyClass,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => parseTestYaml(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    class TestEditorView {}
    TestEditorView.updateListener = { of: (listener) => ({ listener }) };
    return {
      EditorView: TestEditorView,
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: ledgerHelpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const DATE = "2026-10-08";
const stamp = (line, dateText) =>
  ledgerHelpers.freshnessStampLine(line, dateText || DATE).line;
const refresh = (line, days, dateText) =>
  ledgerHelpers.freshnessSetRefreshLine(line, days, dateText || DATE).line;

function freshnessApiStub(configInterval = 7) {
  return {
    config: () => ({ interval: configInterval, rottenDailyBudget: null, invalid: false }),
    stampLine: stamp,
    setRefreshLine: refresh,
  };
}

function countedSession(lines) {
  return Object.freeze({
    valid: true,
    error: null,
    explicit: true,
    startLine: 0,
    requestedAdditionalCount: lines.length - 1,
    requestedCount: lines.length,
    actualCount: lines.length,
    clamped: false,
    targets: Object.freeze(
      lines.map((rawLine, line) => Object.freeze({ line, rawLine })),
    ),
  });
}

test("lane commit stamps an open Ready task", () => {
  const content = "- [ ] #task Buy milk [priority:: P2]";
  const session = countedSession([content]);
  const plan = helpers.planTaskLaneBatch(content, session, {
    summary: "",
    dateText: DATE,
    stampLine: stamp,
    freshDateText: DATE,
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.mode, "commit");
  assert.match(plan.content, /\[fresh:: 2026-10-08\]/);
  // Stamp lands before the Tasks suffix, not appended at the end.
  assert.match(
    plan.content,
    /\[fresh:: 2026-10-08\] \[priority:: P2\]/,
  );
});

test("lane release stamps an open Next task", () => {
  const content = "- [*] #task Write more";
  const session = countedSession([content]);
  const plan = helpers.planTaskLaneBatch(content, session, {
    summary: "",
    dateText: DATE,
    stampLine: stamp,
    freshDateText: DATE,
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.mode, "release");
  assert.match(plan.content, /\[fresh:: 2026-10-08\]/);
});

test("lane without a stamper leaves lines as they were", () => {
  const content = "- [ ] #task Buy milk";
  const session = countedSession([content]);
  const plan = helpers.planTaskLaneBatch(content, session, {
    summary: "",
    dateText: DATE,
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.content, "- [*] #task Buy milk");
  assert.doesNotMatch(plan.content, /fresh::/);
});

test("counted property set stamps every rewritten open task", () => {
  const content = [
    "- [ ] #task Buy milk",
    "- [ ] #task Walk dog [priority:: P3]",
  ].join("\n");
  const session = countedSession(content.split("\n"));
  const plan = helpers.planCountedBulletPropertyBatch(
    content,
    session,
    "scheduled",
    "2026-10-20",
    {
      operation: "set",
      today: new Date(2026, 9, 8),
      stampLine: stamp,
      freshDateText: DATE,
    },
  );
  assert.equal(plan.valid, true);
  for (const line of plan.content.split("\n")) {
    assert.match(line, /\[fresh:: 2026-10-08\]/);
  }
});

test("counted delete-property stamps the rewritten task", () => {
  const content = "- [ ] #task Buy milk [scheduled:: 2026-10-20]";
  const session = countedSession([content]);
  const plan = helpers.planCountedBulletPropertyBatch(
    content,
    session,
    "scheduled",
    null,
    {
      operation: "delete",
      stampLine: stamp,
      freshDateText: DATE,
    },
  );
  assert.equal(plan.valid, true);
  assert.match(plan.content, /\[fresh:: 2026-10-08\]/);
  assert.doesNotMatch(plan.content, /scheduled::/);
});

test("stamp lands before the suffix after a priority edit on a stamped line", () => {
  const content = "- [ ] #task Buy milk [fresh:: 2026-10-01] [priority:: P3]";
  const session = countedSession([content]);
  const plan = helpers.planCountedBulletPropertyBatch(
    content,
    session,
    "priority",
    "P1",
    {
      operation: "set",
      today: new Date(2026, 9, 8),
      stampLine: stamp,
      freshDateText: DATE,
    },
  );
  assert.equal(plan.valid, true);
  assert.match(plan.content, /\[fresh:: 2026-10-08\]/);
  assert.doesNotMatch(plan.content, /2026-10-01/);
  const freshIndex = plan.content.indexOf("[fresh::");
  const priorityIndex = plan.content.indexOf("[priority::");
  assert.ok(freshIndex !== -1 && priorityIndex !== -1 && freshIndex < priorityIndex);
});

test("recurring tasks are never stamped", () => {
  const content = "- [ ] #task Water plants [repeat:: every day]";
  const session = countedSession([content]);
  const plan = helpers.planTaskLaneBatch(content, session, {
    summary: "",
    dateText: DATE,
    stampLine: stamp,
    freshDateText: DATE,
  });
  assert.equal(plan.valid, true);
  assert.doesNotMatch(plan.content, /fresh::/);
});

test("cancel never stamps", () => {
  const content = "- [*] #task Buy milk ^buy";
  const session = helpers.discoverCountedObsidianTaskTargets(content, 0, 0);
  const plan = helpers.planTaskCancelBatch(content, session, {
    date: DATE,
    reason: "dropped",
  });
  assert.equal(plan.valid, true);
  assert.doesNotMatch(plan.content, /fresh::/);
  assert.match(plan.content, /\[-\]/);
});

test("fresh and refresh never go through the end-append writers", () => {
  for (const name of ["fresh", "refresh"]) {
    const upserted = helpers.upsertBulletProperty("- [ ] #task T", name, "x");
    assert.equal(upserted.changed, false);
    assert.equal(upserted.reason, "fresh-guarded");
    const inserted = helpers.insertMissingBulletProperty("- [ ] #task T", name, "x");
    assert.equal(inserted.changed, false);
    assert.equal(inserted.reason, "fresh-guarded");
  }
  const ok = helpers.upsertBulletProperty("- [ ] #task T", "scheduled", "2026-10-20");
  assert.equal(ok.changed, true);
});

test("counted dependency edit stamps the rewritten parent", () => {
  const content = [
    "- [ ] #task Parent ^aaa",
    "- [ ] #task Child ^bbb",
  ].join("\n");
  const session = countedSession(["- [ ] #task Parent ^aaa"]);
  const dependencyTask = {
    line: 1,
    rawLine: "- [ ] #task Child ^bbb",
    existingIdField: "",
    existingBlockId: "bbb",
  };
  const plan = helpers.planCountedLocalTaskDependency(
    content,
    session,
    dependencyTask,
    "Note.md",
    { stampLine: stamp, freshDateText: DATE },
  );
  assert.equal(plan.valid, true);
  const parent = plan.content.split("\n")[0];
  assert.match(parent, /dependsOn::/);
  assert.match(parent, /\[fresh:: 2026-10-08\]/);
});

test("moved tasks are stamped at their destination", () => {
  const source = "- [ ] #task Move me ^mmm";
  const destination = ["---", 'type: "[[area]]"', "---", "# Area", "Body"].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(source, 0, 0);
  const plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Area.md",
    sourceContent: source,
    destinationContent: destination,
    targets: discovery.targets,
    stampLine: stamp,
    freshDateText: DATE,
  });
  assert.equal(plan.valid, true, plan.error);
  const dest = plan.changes.get("Area.md").after;
  assert.match(dest, /\[fresh:: 2026-10-08\]/);
});

test("move without a stamper leaves lines as they were", () => {
  const source = "- [ ] #task Move me ^mmm";
  const destination = ["---", 'type: "[[area]]"', "---", "# Area", "Body"].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(source, 0, 0);
  const plan = helpers.planTaskMoveAcrossFiles({
    sourcePath: "Source.md",
    destinationPath: "Area.md",
    sourceContent: source,
    destinationContent: destination,
    targets: discovery.targets,
  });
  assert.equal(plan.valid, true, plan.error);
  assert.doesNotMatch(plan.changes.get("Area.md").after, /fresh::/);
});

test("refresh row shows the effective interval in task mode", () => {
  const api = freshnessApiStub(7);
  const single = helpers.describeRefreshRow("- [ ] #task T", {
    cursorLine: 0,
    freshnessApi: api,
  });
  assert.equal(single.detail, "refresh · every 7 d (config)");

  const task = helpers.describeRefreshRow("- [ ] #task T [refresh:: 30]", {
    cursorLine: 0,
    freshnessApi: api,
  });
  assert.equal(task.days, 30);
  assert.equal(task.source, "task");

  const note = helpers.describeRefreshRow(
    "---\ntask_refresh: 3\n---\n- [ ] #task T",
    { cursorLine: 3, freshnessApi: api },
  );
  assert.equal(note.days, 3);
  assert.equal(note.source, "note");
});

test("refresh row hides without the api and on closed tasks", () => {
  assert.equal(
    helpers.describeRefreshRow("- [ ] #task T", { cursorLine: 0, freshnessApi: null }),
    null,
  );
  assert.equal(
    helpers.describeRefreshRow("- [ ] #task T", {
      cursorLine: 0,
      freshnessApi: { config: () => ({ interval: 7 }) },
    }),
    null,
  );
  const api = freshnessApiStub();
  assert.equal(
    helpers.describeRefreshRow("- [x] #task Done", { cursorLine: 0, freshnessApi: api }),
    null,
  );
});

test("refresh row covers counted and link modes, including mixed", () => {
  const api = freshnessApiStub();
  const counted = helpers.describeRefreshRow(
    "- [ ] #task A\n- [ ] #task B [refresh:: 14]",
    {
      taskSession: countedSession(["- [ ] #task A", "- [ ] #task B [refresh:: 14]"]),
      freshnessApi: api,
    },
  );
  assert.equal(counted.kind, "task");
  assert.equal(counted.mixed, true);
  assert.equal(counted.detail, "refresh · mixed");

  const link = helpers.describeRefreshRow("", {
    linkResolved: [
      { rawLine: "- [ ] #task A" },
      { rawLine: "- [ ] #task B" },
    ],
    freshnessApi: api,
  });
  assert.equal(link.kind, "link");
  assert.equal(link.detail, "refresh · every 7 d (config)");
});

test("refresh value items offer presets and use default", () => {
  const items = helpers.createRefreshValueItems(7);
  const days = items.map((item) => item.refreshDays);
  assert.deepEqual(days, [2, 3, 7, 14, 30, 90, 180, 365, null]);
  assert.equal(items.find((item) => item.refreshDays === 7).current, true);
  assert.equal(helpers.parseRefreshCustomValue("30"), 30);
  assert.equal(helpers.parseRefreshCustomValue("0"), null);
  assert.equal(helpers.parseRefreshCustomValue("366"), null);
  assert.equal(helpers.parseRefreshCustomValue("x"), null);
});

test("setRefreshLine stamps and sets or clears the interval", () => {
  const set = refresh("- [ ] #task T", 14, DATE);
  assert.match(set, /\[fresh:: 2026-10-08\]/);
  assert.match(set, /\[refresh:: 14\]/);
  const freshIndex = set.indexOf("[fresh::");
  const refreshIndex = set.indexOf("[refresh::");
  assert.ok(freshIndex !== -1 && refreshIndex !== -1 && freshIndex < refreshIndex);

  const cleared = refresh("- [ ] #task T [fresh:: 2026-10-01] [refresh:: 14]", null, DATE);
  assert.match(cleared, /\[fresh:: 2026-10-08\]/);
  assert.doesNotMatch(cleared, /refresh::/);
});
