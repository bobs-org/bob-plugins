// End-to-end Task Card subtree pass coverage for bob-cli-78.6
// (PDG8–PDG14, docs/task-dependencies.md §13.19).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  TransactionEditor,
  compatibleTasksSettings,
  parseFrontmatterFromContent,
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

const TODAY = new Date(2026, 9, 12, 12);

function projectNote(options = {}) {
  const {
    parent = null,
    prjStatus = " ",
    prjBlocked = false,
    scheduled = null,
    dependency = null,
    residents = ["- [ ] #task Project work ^project-work"],
  } = options;
  const lines = ["---", 'type: "[[project]]"', 'status: "wip"'];
  if (parent) {
    lines.push(`parent: "[[${parent}]]"`);
  }
  lines.push("---", "");
  let prj = `- [${prjStatus}] #task #prj Ship the project`;
  if (prjBlocked) {
    prj += " #prj_is_blocked";
  }
  if (scheduled) {
    prj += ` [scheduled:: ${scheduled}]`;
  }
  lines.push(`${prj} ^prj`);
  if (dependency) {
    lines.push(`  - ⛓️ **DEPENDS ON:** [[${dependency.path}#^${dependency.blockId}]]`);
  }
  lines.push(...residents);
  return lines.join("\n");
}

function areaWithTask(status = " ", blockId = "target") {
  return [
    "---",
    'type: "[[area]]"',
    "---",
    "",
    `- [${status}] #task Prerequisite ^${blockId}`,
  ].join("\n");
}

function dailyNote(lines = []) {
  return [
    "## Pomodoros",
    "",
    "- [ ] Current (0900-0930)",
    ...lines.map((line) => `  - ${line}`),
  ].join("\n");
}

function dailyPath(date = TODAY) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${year}${month}${day}.md`;
}

function taskLine(content, blockId) {
  const lines = String(content || "").split(/\r?\n/);
  const line = lines.findIndex((value) => new RegExp(`\\^${blockId}(?:\\s|$)`).test(value));
  assert.notEqual(line, -1, `missing ^${blockId} task`);
  return lines[line];
}

function taskStatus(content, blockId) {
  const match = /^\s*[-*+] \[([ */?])\]/.exec(taskLine(content, blockId));
  assert.ok(match, `missing task status for ^${blockId}`);
  return match[1];
}

function hasBlockedTag(content, blockId) {
  return /#prj_is_blocked/.test(taskLine(content, blockId));
}

function hasUnblockedStamp(content, blockId) {
  return /\[unblocked:: [^\]]+\]/.test(taskLine(content, blockId));
}

function createCascadeHarness(notes, options = {}) {
  const rootPath = options.rootPath || "N.md";
  const contents = new Map(Object.entries(notes));
  const files = new Map();
  for (const path of contents.keys()) {
    const basename = path.split("/").pop().replace(/\.md$/i, "");
    files.set(path, { path, basename, extension: "md" });
  }
  const rootFile = files.get(rootPath);
  assert.ok(rootFile, `missing root file ${rootPath}`);
  const rootEditor = new TransactionEditor(contents.get(rootPath), {
    line: String(contents.get(rootPath)).split(/\r?\n/).findIndex((line) => /\^prj(?:\s|$)/.test(line)),
    ch: 0,
  });
  const openEditors = new Map([[rootPath, rootEditor]]);
  const cachedReads = [];
  const processWrites = [];
  const getContent = (path) => {
    const editor = openEditors.get(path);
    return editor ? editor.getValue() : contents.get(path);
  };
  const resolveLink = (linkText) => {
    const clean = String(linkText || "").split(/[|#]/, 1)[0].replace(/\.md$/i, "");
    const direct = files.get(`${clean}.md`) || files.get(clean);
    if (direct) {
      return direct;
    }
    const basename = clean.split("/").pop().toLowerCase();
    const matches = [...files.values()].filter((file) => file.basename.toLowerCase() === basename);
    return matches.length === 1 ? matches[0] : null;
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: {
      getActiveFile: () => rootFile,
      getLeavesOfType: (type) => type === "markdown"
        ? [...openEditors.entries()].map(([path, editor]) => ({ view: { file: files.get(path), editor } }))
        : [],
    },
    vault: {
      adapter: { read: async () => JSON.stringify(compatibleTasksSettings()) },
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (path) => files.get(path) || null,
      read: async (file) => getContent(file.path),
      cachedRead: async (file) => {
        cachedReads.push(file.path);
        if (!contents.has(file.path) && !openEditors.has(file.path)) {
          throw new Error(`missing ${file.path}`);
        }
        return getContent(file.path);
      },
      process: async (file, transform) => {
        processWrites.push(file.path);
        const before = getContent(file.path);
        const after = transform(before);
        contents.set(file.path, after);
        return after;
      },
    },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: parseFrontmatterFromContent(getContent(file.path)) }),
      getFirstLinkpathDest: (linkText) => resolveLink(linkText),
    },
  };
  plugin.getActiveMarkdownView = () => ({ editor: rootEditor, file: rootFile });
  plugin.getFreshnessStampLine = () => null;
  plugin.getFreshnessApi = () => ({
    markUnblockedLine(line, { today } = {}) {
      const date = today instanceof Date
        ? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
        : "2026-10-12";
      return String(line).replace(/(?= \^[A-Za-z0-9-]+\s*$)/, ` [unblocked:: ${date}]`);
    },
  });
  const rootContent = () => rootEditor.getValue();
  const rootLine = (blockId = "prj") => rootContent().split(/\r?\n/).findIndex((line) => new RegExp(`\\^${blockId}(?:\\s|$)`).test(line));
  return {
    plugin,
    rootEditor,
    rootFile,
    rootPath,
    contents,
    files,
    cachedReads,
    processWrites,
    rootContent,
    rootLine,
  };
}

async function editDependency(harness, { add = [], remove = [] } = {}) {
  return harness.plugin.applyDependencyEdit({
    editor: harness.rootEditor,
    parentPath: harness.rootPath,
    parentLine: harness.rootLine(),
    add,
    remove,
    today: TODAY,
  });
}

async function setProjectSchedule(harness, value, expectedValue = "") {
  const line = harness.rootLine();
  const expectedLine = harness.rootContent().split(/\r?\n/)[line];
  return harness.plugin.setProjectNoteScheduledValue(
    harness.rootEditor,
    { line, ch: 0 },
    harness.rootPath,
    expectedLine,
    expectedValue,
    value,
    { today: TODAY },
  );
}

function resetNotices() {
  notices.length = 0;
}

test("PDG8: Depends on blocks the project subtree, transfers the strongest lane, and consumes live links", async () => {
  resetNotices();
  const datePath = dailyPath();
  const harness = createCascadeHarness({
    "N.md": projectNote({ residents: ["- [/] #task Parent work ^parent-work"] }),
    "K.md": projectNote({ parent: "N", residents: ["- [*] #task Child work ^child-work"] }),
    "G.md": projectNote({ parent: "K", residents: ["- [ ] #task Deep work ^deep-work"] }),
    "Target.md": areaWithTask(" ", "target"),
    [datePath]: dailyNote([
      "[[N#^prj]]",
      "[[N#^parent-work]]",
      "[[K#^prj]]",
      "[[K#^child-work]]",
      "[[G#^prj]]",
      "[[G#^deep-work]]",
    ]),
  });

  const outcome = await editDependency(harness, {
    add: [{ path: "Target.md", blockId: "target" }],
  });

  assert.equal(outcome.ok, true, outcome.reason);
  assert.equal(taskStatus(harness.rootContent(), "parent-work"), "?");
  assert.equal(hasBlockedTag(harness.rootContent(), "parent-work"), true);
  for (const [path, blockIds] of [["K.md", ["prj", "child-work"]], ["G.md", ["prj", "deep-work"]]]) {
    for (const blockId of blockIds) {
      assert.equal(taskStatus(harness.contents.get(path), blockId), "?");
      assert.equal(hasBlockedTag(harness.contents.get(path), blockId), true);
    }
  }
  assert.equal(taskStatus(harness.contents.get("Target.md"), "target"), "/");
  assert.doesNotMatch(harness.contents.get(datePath), /\[\[(?:N|K|G)#\^(?:prj|parent-work|child-work|deep-work)\]\]/);
  assert.match(outcome.notice, /· 2 sub-projects Blocked/);
});

test("PDG9: removing the last open Depends on target recovers descendants with unblocked stamps", async () => {
  resetNotices();
  const dependency = { path: "Target", blockId: "target" };
  const harness = createCascadeHarness({
    "N.md": projectNote({
      prjStatus: "?",
      dependency,
      residents: ["- [?] #task Parent work #prj_is_blocked ^parent-work"],
    }),
    "K.md": projectNote({
      parent: "N",
      prjStatus: "?",
      prjBlocked: true,
      residents: ["- [?] #task Child work #prj_is_blocked ^child-work"],
    }),
    "G.md": projectNote({
      parent: "K",
      prjStatus: "?",
      prjBlocked: true,
      residents: ["- [?] #task Deep work #prj_is_blocked ^deep-work"],
    }),
    "Target.md": areaWithTask("x", "target"),
  });

  const outcome = await editDependency(harness, {
    remove: [{ path: "Target.md", blockId: "target" }],
  });

  assert.equal(outcome.ok, true, outcome.reason);
  for (const [path, blockIds] of [["K.md", ["prj", "child-work"]], ["G.md", ["prj", "deep-work"]]]) {
    for (const blockId of blockIds) {
      assert.notEqual(taskStatus(harness.contents.get(path), blockId), "?");
      assert.equal(hasBlockedTag(harness.contents.get(path), blockId), false);
      assert.equal(hasUnblockedStamp(harness.contents.get(path), blockId), true);
    }
  }
  assert.match(outcome.notice, /· 2 sub-projects Ready again/);
});

test("PDG10: a child's own open target keeps its project Blocked while inherited residents stay tagged", async () => {
  const harness = createCascadeHarness({
    "N.md": projectNote({ prjStatus: "?", dependency: { path: "Target", blockId: "target" } }),
    "K.md": projectNote({
      parent: "N",
      prjStatus: "?",
      prjBlocked: true,
      dependency: { path: "ChildTarget", blockId: "child-target" },
      residents: ["- [?] #task Child work #prj_is_blocked ^child-work"],
    }),
    "G.md": projectNote({ parent: "K", prjStatus: "?", prjBlocked: true, residents: ["- [?] #task Deep work #prj_is_blocked ^deep-work"] }),
    "Target.md": areaWithTask("x", "target"),
    "ChildTarget.md": areaWithTask(" ", "child-target"),
  });

  const outcome = await editDependency(harness, { remove: [{ path: "Target.md", blockId: "target" }] });

  assert.equal(outcome.ok, true, outcome.reason);
  assert.equal(taskStatus(harness.contents.get("K.md"), "prj"), "?");
  assert.equal(hasBlockedTag(harness.contents.get("K.md"), "prj"), false);
  assert.equal(taskStatus(harness.contents.get("K.md"), "child-work"), "?");
  assert.equal(hasBlockedTag(harness.contents.get("K.md"), "child-work"), true);
  assert.equal(taskStatus(harness.contents.get("G.md"), "deep-work"), "?");
  assert.equal(hasBlockedTag(harness.contents.get("G.md"), "deep-work"), true);
});

test("PDG11: a tagged root gesture reasserts descendant tags and recovers nothing", async () => {
  const harness = createCascadeHarness({
    "Parent.md": projectNote(),
    "N.md": projectNote({ parent: "Parent", prjStatus: "?", prjBlocked: true, dependency: { path: "Target", blockId: "target" } }),
    "K.md": projectNote({ parent: "N", residents: ["- [ ] #task Child work ^child-work"] }),
    "G.md": projectNote({ parent: "K", residents: ["- [ ] #task Deep work ^deep-work"] }),
    "Target.md": areaWithTask("x", "target"),
  });

  const outcome = await editDependency(harness, { remove: [{ path: "Target.md", blockId: "target" }] });

  assert.equal(outcome.ok, true, outcome.reason);
  assert.equal(hasBlockedTag(harness.rootContent(), "prj"), true);
  assert.equal(taskStatus(harness.contents.get("K.md"), "child-work"), "?");
  assert.equal(hasBlockedTag(harness.contents.get("K.md"), "prj"), true);
  assert.equal(hasBlockedTag(harness.contents.get("K.md"), "child-work"), true);
  assert.equal(taskStatus(harness.contents.get("G.md"), "deep-work"), "?");
  assert.equal(hasBlockedTag(harness.contents.get("G.md"), "deep-work"), true);
  assert.doesNotMatch(`${harness.contents.get("K.md")}\n${harness.contents.get("G.md")}`, /\[unblocked::/);
});

test("PDG12: setting a future project date cascades to descendants and consumes their Pomodoro links", async () => {
  resetNotices();
  const datePath = dailyPath();
  const harness = createCascadeHarness({
    "N.md": projectNote(),
    "K.md": projectNote({ parent: "N", residents: ["- [*] #task Child work ^child-work"] }),
    "G.md": projectNote({ parent: "K", residents: ["- [ ] #task Deep work ^deep-work"] }),
    [datePath]: dailyNote(["[[K#^prj]]", "[[K#^child-work]]", "[[G#^deep-work]]"]),
  });

  assert.equal(await setProjectSchedule(harness, "2099-01-01"), true);
  for (const [path, blockIds] of [["K.md", ["prj", "child-work"]], ["G.md", ["prj", "deep-work"]]]) {
    for (const blockId of blockIds) {
      assert.equal(taskStatus(harness.contents.get(path), blockId), "?");
      assert.equal(hasBlockedTag(harness.contents.get(path), blockId), true);
    }
  }
  assert.doesNotMatch(harness.contents.get(datePath), /\[\[(?:K|G)#\^(?:prj|child-work|deep-work)\]\]/);
  assert.match(notices.at(-1), /· 2 sub-projects Blocked/);
});

test("PDG12: moving the project date due recovers descendants", async () => {
  resetNotices();
  const harness = createCascadeHarness({
    "N.md": projectNote({ prjStatus: "?", scheduled: "2099-01-01", residents: ["- [?] #task Parent work #prj_is_blocked ^parent-work"] }),
    "K.md": projectNote({ parent: "N", prjStatus: "?", prjBlocked: true, residents: ["- [?] #task Child work #prj_is_blocked ^child-work"] }),
    "G.md": projectNote({ parent: "K", prjStatus: "?", prjBlocked: true, residents: ["- [?] #task Deep work #prj_is_blocked ^deep-work"] }),
  });

  assert.equal(await setProjectSchedule(harness, "2000-01-01", "2099-01-01"), true);
  for (const [path, blockIds] of [["K.md", ["prj", "child-work"]], ["G.md", ["prj", "deep-work"]]]) {
    for (const blockId of blockIds) {
      assert.equal(hasBlockedTag(harness.contents.get(path), blockId), false);
      assert.equal(hasUnblockedStamp(harness.contents.get(path), blockId), true);
    }
  }
  assert.match(notices.at(-1), /· 2 sub-projects Ready again/);
});

test("PDG12: deleting the project date recovers descendants", async () => {
  resetNotices();
  const harness = createCascadeHarness({
    "N.md": projectNote({ prjStatus: "?", scheduled: "2099-01-01", residents: ["- [?] #task Parent work #prj_is_blocked ^parent-work"] }),
    "K.md": projectNote({ parent: "N", prjStatus: "?", prjBlocked: true, residents: ["- [?] #task Child work #prj_is_blocked ^child-work"] }),
    "G.md": projectNote({ parent: "K", prjStatus: "?", prjBlocked: true, residents: ["- [?] #task Deep work #prj_is_blocked ^deep-work"] }),
  });
  const line = harness.rootLine();
  const expectedLine = harness.rootContent().split(/\r?\n/)[line];

  const result = await harness.plugin.deleteProjectNoteScheduledValue(
    harness.rootEditor,
    { line, ch: 0 },
    harness.rootPath,
    expectedLine,
    "2099-01-01",
  );

  assert.equal(result.deleted, true);
  assert.doesNotMatch(taskLine(harness.rootContent(), "prj"), /\[scheduled::/);
  assert.equal(hasBlockedTag(harness.contents.get("K.md"), "child-work"), false);
  assert.equal(hasUnblockedStamp(harness.contents.get("K.md"), "child-work"), true);
  assert.equal(hasBlockedTag(harness.contents.get("G.md"), "deep-work"), false);
  assert.equal(hasUnblockedStamp(harness.contents.get("G.md"), "deep-work"), true);
  assert.match(notices.at(-1), /· 2 sub-projects Ready again/);
});

test("PDG12: a tagged project task keeps its tag through future, due, and delete Schedule writes", async () => {
  const harness = createCascadeHarness({
    "Parent.md": projectNote(),
    "N.md": projectNote({ parent: "Parent", prjStatus: "?", prjBlocked: true }),
    "K.md": projectNote({ parent: "N", prjStatus: "?", prjBlocked: true }),
  });

  assert.equal(await setProjectSchedule(harness, "2099-01-01"), true);
  assert.equal(hasBlockedTag(harness.rootContent(), "prj"), true);
  assert.equal(await setProjectSchedule(harness, "2000-01-01", "2099-01-01"), true);
  assert.equal(hasBlockedTag(harness.rootContent(), "prj"), true);
  const line = harness.rootLine();
  const expectedLine = harness.rootContent().split(/\r?\n/)[line];
  const result = await harness.plugin.deleteProjectNoteScheduledValue(
    harness.rootEditor,
    { line, ch: 0 },
    harness.rootPath,
    expectedLine,
    "2000-01-01",
  );
  assert.equal(result.deleted, true);
  assert.equal(hasBlockedTag(harness.rootContent(), "prj"), true);
  assert.equal(hasBlockedTag(harness.contents.get("K.md"), "prj"), true);
});

test("PDG14: a stale descendant is skipped, the root write stands, and the notice reports it", async () => {
  resetNotices();
  const harness = createCascadeHarness({
    "N.md": projectNote(),
    "K.md": projectNote({ parent: "N" }),
    "G.md": projectNote({ parent: "K", residents: ["- [ ] #task Deep work ^deep-work"] }),
    "Target.md": areaWithTask(" ", "target"),
  });
  const originalPlanner = harness.plugin.planSubtreePassForPrjEdit.bind(harness.plugin);
  let mutated = false;
  harness.plugin.planSubtreePassForPrjEdit = async (...args) => {
    const planned = await originalPlanner(...args);
    if (planned && !mutated) {
      mutated = true;
      harness.contents.set("K.md", `${harness.contents.get("K.md")}\n<!-- concurrent edit -->`);
    }
    return planned;
  };

  const outcome = await editDependency(harness, { add: [{ path: "Target.md", blockId: "target" }] });

  assert.equal(outcome.ok, true, outcome.reason);
  assert.match(harness.rootContent(), /\[\[Target#\^target\]\]/);
  assert.match(harness.contents.get("K.md"), /<!-- concurrent edit -->/);
  assert.equal(hasBlockedTag(harness.contents.get("G.md"), "deep-work"), true);
  assert.match(outcome.notice, /· 1 sub-project not updated/);
});

test("Task Link Depends on writer preserves the internal-target guard on a project task", () => {
  const harness = createCascadeHarness({
    "N.md": projectNote(),
    "K.md": projectNote({ parent: "N" }),
  });
  const before = harness.rootContent();
  const result = harness.plugin.setLocalTaskDependencyLink(
    harness.rootEditor,
    { line: harness.rootLine(), ch: 0 },
    "child-work",
    { filePath: "N.md", linkBlockId: "child-work", showNotice: false },
  );

  assert.equal(result, false);
  assert.equal(harness.rootContent(), before);
  assert.equal(hasBlockedTag(harness.contents.get("K.md"), "prj"), false);
});

test("api v3 removeDependencyByRef runs the recovery cascade for a linked project task", async () => {
  const dependency = { path: "Target", blockId: "target" };
  const harness = createCascadeHarness({
    "N.md": projectNote({ prjStatus: "?", dependency }),
    "K.md": projectNote({ parent: "N", prjStatus: "?", prjBlocked: true }),
    "G.md": projectNote({ parent: "K", prjStatus: "?", prjBlocked: true }),
    "Target.md": areaWithTask("x", "target"),
  });
  const result = await harness.plugin.removeDependencyByRef(
    { path: "N.md", line: harness.rootLine() },
    { path: "Target.md", blockId: "target" },
  );

  assert.equal(result.ok, true, result.reason);
  assert.equal(hasBlockedTag(harness.contents.get("K.md"), "prj"), false);
  assert.equal(hasUnblockedStamp(harness.contents.get("K.md"), "prj"), true);
  assert.equal(hasBlockedTag(harness.contents.get("G.md"), "prj"), false);
  assert.equal(hasUnblockedStamp(harness.contents.get("G.md"), "prj"), true);
});

test("counted Schedule writer cascades a future date through descendants", async () => {
  resetNotices();
  const harness = createCascadeHarness({
    "N.md": projectNote(),
    "K.md": projectNote({ parent: "N" }),
    "G.md": projectNote({ parent: "K" }),
  });
  const line = harness.rootLine();
  const session = helpers.discoverCountedObsidianTaskTargets(harness.rootContent(), line, line);

  const result = await harness.plugin.setCountedBulletPropertyValue(
    harness.rootEditor,
    { line, ch: 0 },
    "N.md",
    session,
    "scheduled",
    "2099-01-01",
  );

  assert.equal(result, true);
  assert.equal(taskStatus(harness.contents.get("K.md"), "prj"), "?");
  assert.equal(hasBlockedTag(harness.contents.get("K.md"), "prj"), true);
  assert.equal(taskStatus(harness.contents.get("G.md"), "prj"), "?");
  assert.equal(hasBlockedTag(harness.contents.get("G.md"), "prj"), true);
  assert.match(notices.at(-1), /· 2 sub-projects Blocked/);
});

test("counted subtree roots are ancestor-first and each descendant note is planned once", async () => {
  const harness = createCascadeHarness({
    "N.md": projectNote(),
    "K.md": projectNote({ parent: "N" }),
    "G.md": projectNote({ parent: "K" }),
  });
  const children = harness.plugin.buildSubtreeChildrenMap();
  const ordered = helpers.orderSubtreeRootsAncestorFirst(
    [{ path: "K.md" }, { path: "N.md" }],
    children.childrenMap,
  );
  assert.deepEqual(ordered.map((root) => root.path), ["N.md", "K.md"]);

  const before = harness.rootContent();
  const after = before.replace("- [ ] #task #prj", "- [?] #task #prj").replace("^prj", "[scheduled:: 2099-01-01] ^prj");
  const planRoots = [];
  const originalPlanner = harness.plugin.planSubtreePassForPrjEdit.bind(harness.plugin);
  harness.plugin.planSubtreePassForPrjEdit = async (path, ...args) => {
    planRoots.push(path);
    return originalPlanner(path, ...args);
  };
  await harness.plugin.applySubtreePassesForRoots(
    [
      { path: "K.md", beforeText: harness.contents.get("K.md"), afterText: harness.contents.get("K.md") },
      { path: "N.md", beforeText: before, afterText: after },
    ],
    { today: TODAY },
  );

  assert.deepEqual(planRoots, ["N.md"]);
  for (const path of ["K.md", "G.md"]) {
    assert.equal(harness.cachedReads.filter((read) => read === path).length, 1);
  }
});

test("Ctrl+D on the Depends on row removes the line and recovers the subtree", async () => {
  const harness = createCascadeHarness({
    "N.md": projectNote({ prjStatus: "?", dependency: { path: "Target", blockId: "target" } }),
    "K.md": projectNote({ parent: "N", prjStatus: "?", prjBlocked: true }),
    "G.md": projectNote({ parent: "K", prjStatus: "?", prjBlocked: true }),
    "Target.md": areaWithTask("x", "target"),
  });
  const depLine = harness.rootContent().split(/\r?\n/).findIndex((line) => line.includes("DEPENDS ON"));

  const result = await harness.plugin.deleteDependencyLineAndField(
    harness.rootEditor,
    { line: depLine, ch: 0 },
    { filePath: "N.md" },
  );

  assert.equal(result.deleted, true);
  assert.doesNotMatch(harness.rootContent(), /DEPENDS ON|\[dependsOn::/);
  assert.equal(hasBlockedTag(harness.contents.get("K.md"), "prj"), false);
  assert.equal(hasUnblockedStamp(harness.contents.get("K.md"), "prj"), true);
  assert.equal(hasBlockedTag(harness.contents.get("G.md"), "prj"), false);
  assert.equal(hasUnblockedStamp(harness.contents.get("G.md"), "prj"), true);
});

test("a ^prj with no children reads no other note", async () => {
  const harness = createCascadeHarness({ "N.md": projectNote() });
  const before = harness.rootContent();
  const after = before.replace("^prj", "[scheduled:: 2099-01-01] ^prj");
  const pass = await harness.plugin.planSubtreePassForPrjEdit(
    "N.md",
    before,
    after,
    { today: TODAY },
  );

  assert.equal(pass, null);
  assert.deepEqual(harness.cachedReads, []);
});
