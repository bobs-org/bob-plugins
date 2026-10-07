// Runtime tests for the Ctrl+Shift+Enter "Link to today" picker wiring
// (bob-cli-54.3 gesture phase). Drives openPomodoroTaskLink through the
// picker seam: preflight, choice routing, stale-safe commit, inbox order,
// review-walk, and promptOpen re-entry.
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
  createTFile,
  createMarkdownView,
  createTaskModeHarness,
  createTaskLinkHarness,
  installMockInboxRoute,
  LINKED_DAILY,
  UNLINKED_DAILY,
} = require("./block-id-prompt-harness.cjs");

function installMockReviewWalk(plugin, calls, { busy = false } = {}) {
  const origin = busy ? { busy: true } : { seq: 7 };
  const api = {
    version: 3,
    reviewWalk: {
      version: 1,
      capture(editor) {
        calls.push(["capture", editor]);
        return origin;
      },
      continue(passedOrigin, outcome) {
        calls.push(["continue", passedOrigin, outcome]);
        return Promise.resolve(
          Object.freeze({ ok: true, advanced: true, stopped: false }),
        );
      },
    },
  };
  plugin.app = plugin.app || {};
  plugin.app.plugins = { plugins: { "bob-navigation-hotkeys": { api } } };
  return { api, origin };
}

function reviewContinueCalls(calls) {
  return calls.filter((entry) => entry[0] === "continue");
}

const TWO_OPEN_DAILY = [
  "## Pomodoros",
  "- [ ] (09:00-09:25) — ONE",
  "- [ ] () — TWO",
].join("\n");

const MULTI_RUNNING_DAILY = [
  "## Pomodoros",
  "- [ ] (09:00-09:25) — ONE",
  "- [ ] (09:30-09:55) — TWO",
].join("\n");

test("picker opens only on the link direction, never on unlink", async () => {
  const linked = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: LINKED_DAILY,
  });
  await linked.plugin.openPomodoroTaskLink(linked.editor, linked.view);
  assert.equal(linked.plugin.pickerRequests.length, 0);
  assert.equal(lastNotice(), "Unlinked · stays Next");

  const unlinked = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: UNLINKED_DAILY,
  });
  await unlinked.plugin.openPomodoroTaskLink(unlinked.editor, unlinked.view);
  assert.equal(unlinked.plugin.pickerRequests.length, 1);
  assert.equal(lastNotice(), "Linked to Current · stays Next");
  assert.ok(unlinked.writes[0].content.includes("[[Tasks#^ship]]"));
});

test("picker never opens in task-link mode", async () => {
  const h = createTaskLinkHarness({
    files: {
      "Daily.md": [
        "## Pomodoros",
        "- [ ] Current (10:00-10:25)",
        "  - [[Tasks#^ship]]",
        "    - nested note",
        "  - keep",
        "- [ ] Later ()",
        "  - [[Tasks#^ship]]",
        "- [x] Done (09:00-09:25)",
        "  - [[Tasks#^ship]]",
      ].join("\n"),
      "Tasks.md": "- [*] #task Ship it ^ship",
    },
    activePath: "Daily.md",
    cursor: { line: 2, ch: 6 },
  });
  h.plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.equal(h.plugin.pickerRequests.length, 0);
});

test("Depends-On refusals never open the picker", async () => {
  resetNotices();
  const depLine = "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]";
  const content = ["- [?] #task Dependent ^dep", depLine].join("\n");
  const editor = createEditor(content);
  editor.setCursor({ line: 1, ch: depLine.indexOf("[[#^a]]") + 2 });
  const plugin = new Plugin();
  plugin.pickerRequests = [];
  plugin.promptPomodoroLinkTarget = async (request) => {
    plugin.pickerRequests.push(request);
    return null;
  };
  await plugin.startTaskLinkOpen(editor, { path: "Tasks.md" });
  assert.equal(editor.getValue(), content);
  assert.equal(lastNotice(), "⛓ Dependency link — edit it with Ctrl+Shift+P");
  assert.deepEqual(plugin.pickerRequests, []);
});

test("preflight refusals open nothing", async () => {
  const missing = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: UNLINKED_DAILY,
    dailyPath: null,
  });
  // createTaskModeHarness resolves null daily only when dailyPath is null,
  // but its vault.read still closes over the old dailyPath; force the
  // resolver to null to simulate a missing daily note.
  missing.plugin.resolveTodayDailyFile = () => null;
  await missing.plugin.openPomodoroTaskLink(missing.editor, missing.view);
  assert.equal(missing.plugin.pickerRequests.length, 0);
  assert.equal(lastNotice(), "Task link blocked: today's daily note could not be found");
  assert.deepEqual(missing.writes, []);

  const unreadable = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: UNLINKED_DAILY,
  });
  unreadable.plugin.app.vault.read = async () => null;
  await unreadable.plugin.openPomodoroTaskLink(unreadable.editor, unreadable.view);
  assert.equal(unreadable.plugin.pickerRequests.length, 0);
  assert.equal(lastNotice(), "Task toggle blocked: Daily.md could not be read");
  assert.deepEqual(unreadable.writes, []);

  const noSection = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: "# Notes\nNothing here",
  });
  await noSection.plugin.openPomodoroTaskLink(noSection.editor, noSection.view);
  assert.equal(noSection.plugin.pickerRequests.length, 0);
  assert.equal(lastNotice(), "Task link blocked: Daily.md has no Pomodoros section");
  assert.deepEqual(noSection.writes, []);
});

test("picking a non-default entry links there", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: TWO_OPEN_DAILY,
  });
  h.plugin.promptPomodoroLinkTarget = async (request) => {
    h.plugin.pickerRequests.push(request);
    const two = request.model.entries.find((entry) => entry.title === "TWO");
    assert.ok(two);
    return {
      kind: "existing",
      entryLine: two.entryLine,
      entryText: two.entryText,
      title: two.title,
    };
  };
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.equal(h.plugin.pickerRequests.length, 1);
  assert.equal(lastNotice(), "Linked to TWO · stays Next");
  const written = h.writes[0].content;
  const lines = written.split("\n");
  const twoIndex = lines.findIndex((line) => line.includes("— TWO"));
  assert.ok(twoIndex !== -1);
  assert.ok(
    written.slice(written.indexOf("— TWO")).includes("[[Tasks#^ship]]"),
    "link lands under TWO",
  );
  assert.ok(
    !written.slice(0, written.indexOf("— TWO")).includes("[[Tasks#^ship]]"),
    "link does not land under ONE",
  );
});

test("cancel writes nothing with no Notice and settles the walk null", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: UNLINKED_DAILY,
  });
  const calls = [];
  const { origin } = installMockReviewWalk(h.plugin, calls);
  h.plugin.promptPomodoroLinkTarget = async (request) => {
    h.plugin.pickerRequests.push(request);
    return null;
  };
  const before = h.editor.getValue();
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.equal(h.editor.getValue(), before);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(noticeMessages, []);
  assert.deepEqual(reviewContinueCalls(calls), [["continue", origin, null]]);
});

test("a no-ID task gets picker, then the block-ID prompt with the target carried", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it",
    dailyContent: UNLINKED_DAILY,
  });
  let promptedWith = null;
  h.plugin.openBlockIdPrompt = (source) => {
    promptedWith = source;
    h.plugin.promptOpen = true;
  };
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.ok(promptedWith);
  assert.ok(promptedWith.pomodoroTarget);
  assert.equal(promptedWith.pomodoroTarget.title, "Current");
  assert.equal(h.plugin.pickerRequests.length, 1);
  assert.equal(h.plugin.pickerRequests[0].task.displayText, "Ship it");
  assert.equal(h.plugin.pickerRequests[0].needsBlockId, true);

  h.plugin.promptOpen = false;
  const result = await h.plugin.submitPomodoroTaskLinkBlockId(promptedWith, "ship");
  assert.equal(result, true);
  assert.equal(h.editor.getValue(), "- [*] #task Ship it ^ship");
  assert.ok(h.writes[0].content.includes("[[Tasks#^ship]]"));
  assert.equal(lastNotice(), "Linked to Current · stays Next");
});

test("inbox order is picker, then route, then write", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: UNLINKED_DAILY,
  });
  const order = [];
  const originalPrompt = h.plugin.promptPomodoroLinkTarget;
  h.plugin.promptPomodoroLinkTarget = async (request) => {
    order.push("picker");
    return originalPrompt(request);
  };
  const routeCalls = [];
  installMockInboxRoute(h.plugin, routeCalls, {
    inboxPaths: ["Tasks.md"],
    prompt: (request) => {
      order.push("route-prompt");
      return { kind: "stay" };
    },
  });
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.deepEqual(order, ["picker", "route-prompt"]);
  assert.equal(h.writes.length, 1);
  assert.equal(lastNotice(), "Linked to Current · stays Next");
});

test("a review-walk landing continues with link-today and the new text", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: UNLINKED_DAILY,
  });
  const calls = [];
  const { origin } = installMockReviewWalk(h.plugin, calls);
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.ok(h.writes[0].content.includes("[[Tasks#^ship]]"));
  assert.deepEqual(reviewContinueCalls(calls), [
    ["continue", origin, { kind: "link-today", notice: "Linked to Current · stays Next" }],
  ]);
  assert.deepEqual(noticeMessages, []);
});

test("an all-closed ledger creates a new entry after the last completed block", async () => {
  const daily = [
    "## Pomodoros",
    "- [x] DONE (09:00-09:25)",
    "  - [[Tasks#^other]]",
  ].join("\n");
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: daily,
  });
  h.plugin.promptPomodoroLinkTarget = async (request) => {
    h.plugin.pickerRequests.push(request);
    assert.equal(request.model.defaultIndex, -1);
    return { kind: "new", name: "DEEP WORK" };
  };
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.equal(h.plugin.pickerRequests.length, 1);
  const written = h.writes[0].content;
  assert.ok(written.includes("- [ ] () — DEEP WORK"));
  const lines = written.split("\n");
  const createdIndex = lines.findIndex((line) => line.includes("— DEEP WORK"));
  const doneIndex = lines.findIndex((line) => line.includes("— DONE"));
  assert.ok(createdIndex > doneIndex);
  assert.ok(written.includes("[[Tasks#^ship]]"));
  assert.equal(lastNotice(), "Linked to new DEEP WORK · stays Next");
});

test("several running entries allow an explicit pick", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: MULTI_RUNNING_DAILY,
  });
  h.plugin.promptPomodoroLinkTarget = async (request) => {
    h.plugin.pickerRequests.push(request);
    assert.equal(request.model.multipleRunning, true);
    const two = request.model.entries.find((entry) => entry.title === "TWO");
    return {
      kind: "existing",
      entryLine: two.entryLine,
      entryText: two.entryText,
      title: two.title,
    };
  };
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.equal(lastNotice(), "Linked to TWO · stays Next");
  assert.ok(h.writes[0].content.includes("[[Tasks#^ship]]"));
});

test("a target that changed before commit refuses with no writes", async () => {
  const plannedDaily = ["## Pomodoros", "- [ ] Current (10:00-10:25)"].join("\n");
  const renamedDaily = ["## Pomodoros", "- [ ] Renamed (10:00-10:25)"].join("\n");
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: plannedDaily,
  });
  let reads = 0;
  h.plugin.app.vault.read = async () => {
    reads += 1;
    // Presence + picker see the planned note; the commit sees the rename.
    return reads <= 2 ? plannedDaily : renamedDaily;
  };
  const before = h.editor.getValue();
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.equal(h.editor.getValue(), before);
  assert.deepEqual(h.writes, []);
  assert.equal(lastNotice(), "Task link blocked: Pomodoro Current changed in Daily.md");
});

test("a target that closed before commit refuses with no writes", async () => {
  resetNotices();
  const editor = createEditor("- [*] #task Ship it ^ship");
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  source.pomodoroTarget = {
    kind: "existing",
    entryLine: 1,
    entryText: "- [x] Current (10:00-10:25)",
    title: "Current",
  };
  const plugin = new Plugin();
  plugin.now = () => localDate(2026, 8, 15);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  plugin.app = {
    vault: {
      read: async () => ["## Pomodoros", "- [x] Current (10:00-10:25)"].join("\n"),
      modify: async () => {
        throw new Error("should not write");
      },
    },
    metadataCache: { fileToLinktext: (file) => file.path.replace(/\.md$/, "") },
  };
  plugin.resolveReferenceDestination = () => null;
  plugin.suppressEditorScans = () => {};
  const before = editor.getValue();
  const result = await plugin.applyPomodoroTaskLink(source, "ship", false);
  assert.equal(result, false);
  assert.equal(editor.getValue(), before);
  assert.equal(lastNotice(), "Task link blocked: Pomodoro Current is already closed");
});

test("the task note being the daily note uses one editor transaction", async () => {
  const content = [
    "- [*] #task Ship it ^ship",
    "## Pomodoros",
    "- [ ] Current (10:00-10:25)",
  ].join("\n");
  const editor = createEditor(content);
  editor.setCursor({ line: 0, ch: 4 });
  const file = createTFile("Daily.md");
  const view = createMarkdownView(file);
  const plugin = new Plugin();
  plugin.app = {
    workspace: { getActiveViewOfType: () => view, getActiveFile: () => file },
    vault: {
      read: async () => {
        throw new Error("daily is the active note; no vault read expected");
      },
      modify: async () => {
        throw new Error("same-note links never use vault.modify");
      },
    },
    metadataCache: { fileToLinktext: () => "" },
  };
  plugin.resolveTaskFile = (path) => (path === "Daily.md" ? { path: "Daily.md" } : null);
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveReferenceDestination = (reference, sourcePath) =>
    reference.targetText === "" ? { path: "Daily.md" } : null;
  plugin.suppressEditorScans = () => {};
  plugin.now = () => localDate(2026, 8, 15);
  plugin.pickerRequests = [];
  plugin.promptPomodoroLinkTarget = async (request) => {
    plugin.pickerRequests.push(request);
    return helpers.defaultPomodoroLinkChoice(request.model);
  };
  await plugin.openPomodoroTaskLink(editor, view);
  assert.equal(plugin.pickerRequests.length, 1);
  assert.ok(editor.getValue().includes("[[#^ship]]"));
  assert.equal(lastNotice(), "Linked to Current · stays Next");
});

test("promptOpen blocks re-entry while the picker is open", async () => {
  const h = createTaskModeHarness({
    taskContent: "- [*] #task Ship it ^ship",
    dailyContent: UNLINKED_DAILY,
  });
  let releasePicker = null;
  let pickerSawOpen = null;
  h.plugin.promptPomodoroLinkTarget = (request) => {
    h.plugin.pickerRequests.push(request);
    pickerSawOpen = h.plugin.promptOpen;
    return new Promise((resolve) => {
      releasePicker = () => resolve(helpers.defaultPomodoroLinkChoice(request.model));
    });
  };
  const first = h.plugin.openPomodoroTaskLink(h.editor, h.view);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.plugin.pickerRequests.length, 1);
  assert.equal(pickerSawOpen, true);
  // A second gesture while the picker holds promptOpen is swallowed.
  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.equal(h.plugin.pickerRequests.length, 1);
  releasePicker();
  await first;
  assert.equal(h.plugin.promptOpen, false);
  assert.equal(lastNotice(), "Linked to Current · stays Next");
});
