// Alt+N inbox routing (route-gate): on an open inbox task Alt+N asks where
// the task goes after its own prompts and before the write, then acts and
// moves without following or parking. Esc cancels with nothing written;
// Shift+Enter stays in place; failures settle today's lane outcome plus the
// partial notice. Task Link lines and non-inbox notes never prompt.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  createLinkPickerHarness,
} = require("./navigation-hotkeys-harness.cjs");

const keyEvent = (key, modifiers = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
  preventDefault() {},
  stopPropagation() {},
});

const TASK_LINE = 5;

function laneFixture(taskLines, overrides = {}) {
  const sourceContent = [
    "---",
    'type: "[[area]]"',
    "parent: [[inbox]]",
    "---",
    "",
    ...taskLines,
  ].join("\n");
  const store = new Map(
    Object.entries({
      "inbox.md": ["---", 'type: "[[area]]"', "---", ""].join("\n"),
      "mac_inbox.md": sourceContent,
      "Health.md": ["---", 'type: "[[area]]"', "---", "", "## Tasks", ""].join("\n"),
      ...(overrides.extraFiles || {}),
    }),
  );
  const fileFor = (path) => ({
    path,
    basename: path.replace(/\.md$/, "").split("/").pop(),
    extension: "md",
  });
  const editor = new TransactionEditor(sourceContent, { line: TASK_LINE, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  const frontmatterByPath = {
    "mac_inbox.md": { type: "[[area]]", parent: "[[inbox]]" },
    "Health.md": { type: "[[area]]" },
    ...(overrides.frontmatter || {}),
  };
  plugin.app = {
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: frontmatterByPath[file.path] || null }),
      getFirstLinkpathDest: (linkpath) => {
        const want = String(linkpath || "").replace(/\.md$/, "");
        return (
          Array.from(store.keys())
            .map(fileFor)
            .find(
              (file) =>
                file.path.replace(/\.md$/, "") === want || file.basename === want,
            ) || null
        );
      },
    },
    vault: {
      getMarkdownFiles: () => Array.from(store.keys()).map(fileFor),
      cachedRead: async (file) => store.get(file.path),
      process: async (file, fn) => {
        store.set(file.path, fn(store.get(file.path)));
      },
    },
  };
  const sourcePath = overrides.sourcePath || "mac_inbox.md";
  const sourceFile = fileFor(sourcePath);
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === "mac_inbox.md" ? editor : undefined;
  const opened = [];
  plugin.openMarkdownFileWithLeafReuse = async (file) => {
    opened.push(file.path);
    return true;
  };
  return { plugin, store, editor, opened, sourceContent, fileFor };
}

function clearNotices() {
  notices.length = 0;
}

test("formatLaneRouteActionLabel maps the lane mode", () => {
  assert.equal(helpers.formatLaneRouteActionLabel("commit"), "commit to Next");
  assert.equal(helpers.formatLaneRouteActionLabel("release"), "release to Ready");
  assert.equal(helpers.formatLaneRouteActionLabel("toggle"), "toggle lane");
  assert.equal(helpers.formatLaneRouteActionLabel(""), "toggle lane");
  assert.equal(helpers.formatLaneRouteActionLabel(null), "toggle lane");
});

function laneActionPicker(content, taskSession) {
  const proto = helpers.BulletPropertyPickerModal.prototype;
  const picker = Object.create(proto);
  picker.cursor = { line: 0, ch: 0 };
  picker.lineText = String(content).split("\n")[0];
  picker.taskSession = taskSession || null;
  picker.isCountedSession = function () {
    return Boolean(this.taskSession && this.taskSession.explicit === true);
  };
  picker.getEditorContent = function () {
    return content;
  };
  return picker;
}

test("Task Card inbox lane labels: Ready commits, Next and Pending release", () => {
  assert.deepEqual(
    laneActionPicker("- [ ] #task Triage me ^a1").describeInboxRouteLaneAction(),
    { label: "commit to Next" },
  );
  assert.deepEqual(
    laneActionPicker("- [*] #task Triage me ^a1").describeInboxRouteLaneAction(),
    { label: "release to Ready" },
  );
  assert.deepEqual(
    laneActionPicker("- [/] #task Triage me ^a1").describeInboxRouteLaneAction(),
    { label: "release to Ready" },
  );
  assert.deepEqual(
    laneActionPicker("- [x] #task Done ^a1").describeInboxRouteLaneAction(),
    { label: "toggle lane" },
  );
});

test("Task Card counted lane labels follow the batch probe", () => {
  const commitContent = "- [ ] #task One ^a1\n- [ ] #task Two ^b1";
  const commitSession = helpers.discoverCountedObsidianTaskTargets(commitContent, 0, 1);
  assert.equal(commitSession.valid, true);
  assert.deepEqual(
    laneActionPicker(commitContent, commitSession).describeInboxRouteLaneAction(),
    { label: "commit to Next" },
  );
  const releaseContent = "- [*] #task One ^a1\n- [/] #task Two ^b1";
  const releaseSession = helpers.discoverCountedObsidianTaskTargets(releaseContent, 0, 1);
  assert.deepEqual(
    laneActionPicker(releaseContent, releaseSession).describeInboxRouteLaneAction(),
    { label: "release to Ready" },
  );
});

test("a commit on an inbox Ready task routes with the picker title and moves on Enter", async () => {
  clearNotices();
  const { plugin, store, editor, opened } = laneFixture([
    "- [ ] #task Triage me ^abc",
    "  - child kept",
    "- [ ] #task Second ^second",
  ]);
  const pending = plugin.toggleTaskLane(editor);
  const picker = plugin.activeTaskMoveDestinationPicker;
  assert.ok(picker instanceof helpers.InboxRoutePickerModal);
  assert.equal(picker.titleEl.textContent, "Route out of mac_inbox");
  assert.equal(picker.subtitleEl.textContent, "Triage me · then commit to Next");
  picker.handleKeydown(keyEvent("Enter"));
  assert.equal(await pending, true);
  // The task commits to Next with children and leaves the inbox.
  assert.ok(!String(editor.getValue()).includes("Triage me"));
  assert.match(String(editor.getValue()), /Second/);
  assert.match(store.get("Health.md"), /- \[\*\] #task Triage me/);
  assert.match(store.get("Health.md"), /child kept/);
  // The cursor stays in the inbox on the line the move leaves it on.
  assert.equal(editor.getCursor().line, TASK_LINE);
  assert.equal(editor.getLine(TASK_LINE), "- [ ] #task Second ^second");
  // One toast: the lane text, then the move.
  assert.equal(notices.length, 1, `one composed toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /→ Next · 1 task/);
  assert.match(notices[0], /Moved to Health/);
  // A routed move never opens the destination.
  assert.deepEqual(opened, []);
});

test("a release on an inbox Next task labels release to Ready, then moves", async () => {
  clearNotices();
  const { plugin, store, editor } = laneFixture(["- [*] #task Triage me ^abc"]);
  const calls = {};
  plugin.promptInboxRoute = async (request) => {
    calls.prompt = request;
    return { kind: "move", path: "Health.md", name: "Health" };
  };
  assert.equal(await plugin.toggleTaskLane(editor), true);
  assert.equal(calls.prompt.actionLabel, "release to Ready");
  assert.equal(calls.prompt.cancelLabel, "cancel");
  assert.equal(calls.prompt.startLine, TASK_LINE);
  assert.equal(calls.prompt.additionalTaskCount, 0);
  assert.deepEqual([...calls.prompt.reservedBlockIds], []);
  assert.ok(!String(editor.getValue()).includes("Triage me"));
  assert.match(store.get("Health.md"), /- \[ \] #task Triage me/);
  assert.equal(notices.length, 1, `one composed toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /→ Ready · 1 task/);
  assert.match(notices[0], /Moved to Health/);
});

test("a Pending release prompts for the Work Log first, then routes", async () => {
  clearNotices();
  const { plugin, store, editor } = laneFixture(["- [/] #task Working ^w1"]);
  const calls = {};
  plugin.requestLaneReleaseSummary = async () => {
    calls.summaryAsked = true;
    return { cancelled: false, summary: "did stuff" };
  };
  plugin.promptInboxRoute = async (request) => {
    calls.prompt = request;
    assert.equal(calls.summaryAsked, true, "the Work Log prompt comes first");
    return { kind: "move", path: "Health.md", name: "Health" };
  };
  assert.equal(await plugin.toggleTaskLane(editor), true);
  assert.equal(calls.prompt.actionLabel, "release to Ready");
  assert.ok(!String(editor.getValue()).includes("Working"));
  assert.match(store.get("Health.md"), /- \[ \] #task Working/);
  assert.match(store.get("Health.md"), /WORK LOG/);
  assert.match(store.get("Health.md"), /did stuff/);
  assert.match(notices[0], /→ Ready · 1 task/);
  assert.match(notices[0], /Moved to Health/);
});

test("Esc on the Pending Work Log prompt opens no picker and writes nothing", async () => {
  clearNotices();
  const { plugin, editor, sourceContent } = laneFixture(["- [/] #task Working ^w1"]);
  let prompted = false;
  plugin.requestLaneReleaseSummary = async () => ({ cancelled: true, summary: "" });
  plugin.promptInboxRoute = async () => {
    prompted = true;
    return { kind: "move", path: "Health.md", name: "Health" };
  };
  assert.equal(await plugin.toggleTaskLane(editor), false);
  assert.equal(prompted, false);
  assert.equal(String(editor.getValue()), sourceContent);
  assert.deepEqual(notices, []);
  assert.equal(plugin.reviewWalkBusy(), false, "the lock is free after a cancel");
});

test("route Esc writes nothing and shows no notice", async () => {
  clearNotices();
  const { plugin, editor, sourceContent } = laneFixture(["- [ ] #task Triage me ^abc"]);
  plugin.promptInboxRoute = async () => ({ kind: "cancel" });
  // A landing is armed so the lock behavior is observable.
  plugin.reviewLanding = {
    path: "mac_inbox.md",
    text: "- [ ] #task Triage me ^abc",
    key: "mac_inbox.md:6",
    tier: "new",
    day: plugin.laneReleaseDateText({}),
  };
  assert.equal(await plugin.toggleTaskLane(editor), false);
  assert.equal(String(editor.getValue()), sourceContent);
  assert.deepEqual(notices, []);
  assert.equal(plugin.reviewWalkBusy(), false, "the lock is free after route Esc");
});

test("Shift+Enter gives today's in-place write with no move", async () => {
  clearNotices();
  const { plugin, store, editor } = laneFixture([
    "- [ ] #task Triage me ^abc",
    "  - child kept",
  ]);
  plugin.promptInboxRoute = async () => ({ kind: "stay" });
  assert.equal(await plugin.toggleTaskLane(editor), true);
  assert.match(String(editor.getValue()), /- \[\*\] #task Triage me/);
  assert.doesNotMatch(store.get("Health.md"), /Triage me/);
  assert.equal(notices.length, 1, `the plain lane notice only, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /→ Next · 1 task/);
  assert.doesNotMatch(notices[0], /Moved/);
});

test("a counted run routes N tasks with one composed toast", async () => {
  clearNotices();
  const { plugin, store, editor } = laneFixture([
    "- [ ] #task One ^a1",
    "- [ ] #task Two ^b1",
    "- [ ] #task Three ^c1",
  ]);
  const calls = {};
  plugin.promptInboxRoute = async (request) => {
    calls.prompt = request;
    return { kind: "move", path: "Health.md", name: "Health" };
  };
  assert.equal(
    await plugin.toggleTaskLane(editor, {
      countExplicit: true,
      additionalTaskCount: 1,
    }),
    true,
  );
  assert.equal(calls.prompt.additionalTaskCount, 1);
  assert.equal(calls.prompt.actionLabel, "commit to Next");
  assert.ok(!String(editor.getValue()).includes("One"));
  assert.ok(!String(editor.getValue()).includes("Two"));
  assert.match(String(editor.getValue()), /Three/);
  assert.match(store.get("Health.md"), /One/);
  assert.match(store.get("Health.md"), /Two/);
  assert.equal(notices.length, 1, `one composed toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /→ Next · 2 tasks/);
  assert.match(notices[0], /Moved 2 tasks to Health/);
});

test("a counted route picker subtitles N tasks", async () => {
  clearNotices();
  const { plugin, editor } = laneFixture([
    "- [ ] #task One ^a1",
    "- [ ] #task Two ^b1",
  ]);
  const pending = plugin.promptInboxRoute({
    editor,
    sourcePath: "mac_inbox.md",
    startLine: TASK_LINE,
    additionalTaskCount: 1,
    actionLabel: "commit to Next",
  });
  const picker = plugin.activeTaskMoveDestinationPicker;
  assert.ok(picker instanceof helpers.InboxRoutePickerModal);
  assert.equal(picker.titleEl.textContent, "Route out of mac_inbox");
  assert.equal(picker.subtitleEl.textContent, "2 tasks · then commit to Next");
  picker.close();
  assert.deepEqual(await pending, { kind: "cancel" });
});

test("a failed move after the lane write settles lane plus the partial notice", async () => {
  clearNotices();
  const { plugin, store, editor } = laneFixture(["- [ ] #task Triage me ^abc"]);
  plugin.promptInboxRoute = async () => ({ kind: "move", path: "Health.md", name: "Health" });
  // Simulate an outside edit landing between the lane write and the move:
  // the re-discovered task no longer verifies, so the move refuses.
  const realCommit = plugin.commitInboxRoute.bind(plugin);
  plugin.commitInboxRoute = async (request) => {
    const line = editor.getLine(request.startLine);
    editor.replaceRange(`${line} edited`, { line: request.startLine, ch: 0 }, { line: request.startLine, ch: line.length });
    return await realCommit(request);
  };
  const continued = [];
  plugin.captureReviewGesture = () => ({ seq: 1, epoch: 0, day: "2026-10-31", key: "fake" });
  plugin.continueReviewWalkAfter = async (origin, outcome) => {
    continued.push(outcome);
    return { ok: true };
  };
  assert.equal(await plugin.toggleTaskLane(editor), true);
  // The lane write stays applied.
  assert.match(editor.getLine(TASK_LINE), /^- \[\*\] #task Triage me/);
  assert.doesNotMatch(store.get("Health.md"), /Triage me/);
  // Today's lane outcome settles the walk; the partial notice stands alone.
  assert.equal(continued.length, 1);
  assert.equal(continued[0].kind, "lane");
  assert.match(continued[0].notice, /→ Next · 1 task/);
  assert.equal(notices.length, 1, `the partial notice only, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /still in mac_inbox/);
});

test("a routed commit settles route through a walk origin", async () => {
  clearNotices();
  const { plugin, store, editor } = laneFixture(["- [ ] #task Triage me ^abc"]);
  plugin.promptInboxRoute = async () => ({ kind: "move", path: "Health.md", name: "Health" });
  const continued = [];
  plugin.captureReviewGesture = () => ({ seq: 1, epoch: 0, day: "2026-10-31", key: "fake" });
  plugin.continueReviewWalkAfter = async (origin, outcome) => {
    continued.push(outcome);
    return { ok: true };
  };
  assert.equal(await plugin.toggleTaskLane(editor), true);
  assert.match(store.get("Health.md"), /- \[\*\] #task Triage me/);
  assert.equal(continued.length, 1);
  assert.equal(continued[0].kind, "route");
  assert.match(continued[0].notice, /→ Next · 1 task/);
  assert.match(continued[0].notice, /Moved to Health/);
  assert.equal(continued[0].handledRefs.length, 1);
});

test("a non-inbox note writes today's bytes with no prompt", async () => {
  clearNotices();
  const { plugin, editor } = laneFixture(["- [ ] #task Triage me ^abc"], {
    sourcePath: "Health.md",
    frontmatter: {
      "Health.md": { type: "[[area]]" },
    },
  });
  let prompted = false;
  plugin.promptInboxRoute = async () => {
    prompted = true;
    return { kind: "move", path: "Health.md", name: "Health" };
  };
  assert.equal(await plugin.toggleTaskLane(editor), true);
  assert.equal(prompted, false);
  assert.match(String(editor.getValue()), /- \[\*\] #task Triage me/);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /→ Next · 1 task/);
});

test("a project filed under an inbox never prompts", async () => {
  clearNotices();
  const { plugin, editor } = laneFixture(["- [ ] #task Triage me ^abc"], {
    frontmatter: {
      "mac_inbox.md": { type: "[[project]]", status: "wip", parent: "[[inbox]]" },
      "Health.md": { type: "[[area]]" },
    },
  });
  let prompted = false;
  plugin.promptInboxRoute = async () => {
    prompted = true;
    return { kind: "move", path: "Health.md", name: "Health" };
  };
  assert.equal(await plugin.toggleTaskLane(editor), true);
  assert.equal(prompted, false);
  assert.match(String(editor.getValue()), /- \[\*\] #task Triage me/);
});

test("closed and Blocked-only tasks keep today's refusal with no prompt", async () => {
  for (const line of ["- [x] #task Done ^d1", "- [?] #task Waiting ^b1"]) {
    clearNotices();
    const { plugin, editor, sourceContent } = laneFixture([line]);
    let prompted = false;
    plugin.promptInboxRoute = async () => {
      prompted = true;
      return { kind: "move", path: "Health.md", name: "Health" };
    };
    assert.equal(await plugin.toggleTaskLane(editor), false);
    assert.equal(prompted, false);
    assert.equal(String(editor.getValue()), sourceContent);
  }
  clearNotices();
  const blocked = laneFixture(["- [?] #task Waiting ^b1"]);
  blocked.plugin.promptInboxRoute = async () => ({ kind: "move" });
  assert.equal(await blocked.plugin.toggleTaskLane(blocked.editor), false);
  assert.match(notices[0], /Blocked is derived/);
});

test("Alt+N on a Task Link line never prompts", async () => {
  clearNotices();
  const nextEditor = new TransactionEditor("- [ ] #task Ship it ^a1", {
    line: 0,
    ch: 0,
  });
  const harness = createLinkPickerHarness({
    linkContent: "- [[Tasks#^a1]]",
    notes: { "Tasks.md": "- [ ] #task Ship it ^a1" },
    openEditors: { "Tasks.md": nextEditor },
  });
  harness.plugin.app.plugins = { plugins: {} };
  let prompted = false;
  const realPrompt = harness.plugin.promptInboxRoute.bind(harness.plugin);
  harness.plugin.promptInboxRoute = async (request) => {
    prompted = true;
    return await realPrompt(request);
  };
  assert.equal(await harness.plugin.toggleTaskLane(harness.linkEditor), true);
  assert.equal(prompted, false);
  assert.equal(nextEditor.content, "- [*] #task Ship it ^a1");
});
