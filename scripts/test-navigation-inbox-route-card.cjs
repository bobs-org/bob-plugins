// Task Card inbox-route gate (task-card-gate): action-by-action
// conformance matrix for `runInboxRoutedCommit`, arming, and the Inbox
// header chip. Table-driven over every wrapped Task Card write; each
// action runs cancel (nothing written, card stays open), stay (today's
// write), and move (write then routed move with one `route` settle).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
} = require("./navigation-hotkeys-harness.cjs");

function clearNotices() {
  notices.length = 0;
}

function inboxPlugin(store, frontmatterByPath) {
  const fileFor = (path) => ({
    path,
    basename: path.replace(/\.md$/, "").split("/").pop(),
    extension: "md",
  });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: frontmatterByPath[file.path] || null,
      }),
      getFirstLinkpathDest: (linkpath) => {
        const want = String(linkpath || "").replace(/\.md$/, "");
        return (
          Array.from(store.keys())
            .map(fileFor)
            .find(
              (file) =>
                file.path.replace(/\.md$/, "") === want ||
                file.basename === want,
            ) || null
        );
      },
    },
    vault: {
      getMarkdownFiles: () => Array.from(store.keys()).map(fileFor),
      cachedRead: async (file) => store.get(file.path),
    },
  };
  plugin.getActiveMarkdownView = () => null;
  return plugin;
}

function armingStore() {
  const store = new Map(
    Object.entries({
      "inbox.md": ["---", 'type: "[[area]]"', "---", ""].join("\n"),
      "mac_inbox.md": [
        "---",
        'type: "[[area]]"',
        "parent: [[inbox]]",
        "---",
        "",
        "- [ ] #task Triage me",
      ].join("\n"),
      "Health.md": ["---", 'type: "[[area]]"', "---", "", "## Tasks", ""].join("\n"),
    }),
  );
  const frontmatterByPath = {
    "inbox.md": { type: "[[area]]" },
    "mac_inbox.md": { type: "[[area]]", parent: "[[inbox]]" },
    "Health.md": { type: "[[area]]" },
  };
  return { store, frontmatterByPath };
}

test("task-card-gate arms only on open inbox tasks", () => {
  const { store, frontmatterByPath } = armingStore();
  const plugin = inboxPlugin(store, frontmatterByPath);
  const content = "- [ ] #task Triage me\n- [ ] #task Second\n";
  assert.deepEqual(
    plugin.computeInboxRouteContext({
      filePath: "mac_inbox.md",
      content,
      cursor: { line: 0, ch: 0 },
      taskSession: null,
    }),
    { sourcePath: "mac_inbox.md", inboxName: "mac_inbox" },
  );
  // Non-inbox notes never arm.
  assert.equal(
    plugin.computeInboxRouteContext({
      filePath: "Health.md",
      content,
      cursor: { line: 0, ch: 0 },
      taskSession: null,
    }),
    null,
  );
  // Closed tasks never arm.
  assert.equal(
    plugin.computeInboxRouteContext({
      filePath: "mac_inbox.md",
      content: "- [x] #task Done\n",
      cursor: { line: 0, ch: 0 },
      taskSession: null,
    }),
    null,
  );
  // Non-task bullets never arm.
  assert.equal(
    plugin.computeInboxRouteContext({
      filePath: "mac_inbox.md",
      content: "- just a bullet\n",
      cursor: { line: 0, ch: 0 },
      taskSession: null,
    }),
    null,
  );
  // Counted sessions arm on the first target.
  const openSession = {
    explicit: true,
    valid: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First" },
      { line: 1, rawLine: "- [ ] #task Second" },
    ],
  };
  assert.ok(
    plugin.computeInboxRouteContext({
      filePath: "mac_inbox.md",
      content,
      cursor: { line: 0, ch: 0 },
      taskSession: openSession,
    }),
  );
  const closedFirst = {
    explicit: true,
    valid: true,
    targets: [{ line: 0, rawLine: "- [x] #task Done" }],
  };
  assert.equal(
    plugin.computeInboxRouteContext({
      filePath: "mac_inbox.md",
      content,
      cursor: { line: 0, ch: 0 },
      taskSession: closedFirst,
    }),
    null,
  );
  // The inbox note itself arms.
  assert.ok(
    plugin.computeInboxRouteContext({
      filePath: "inbox.md",
      content: "- [ ] #task Root triage\n",
      cursor: { line: 0, ch: 0 },
      taskSession: null,
    }),
  );
});

function planCardForHeader(inboxRoute) {
  const config = helpers.validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: "priority",
        values: "priority",
        schedules: "scheduled",
        levels: [
          { label: "P1", value: "high", min_days: 2, max_days: 7 },
          { label: "P2", value: "medium", min_days: 8, max_days: 30 },
        ],
      },
    ],
  });
  assert.ok(config);
  const content = "- [ ] #task Triage me\n";
  return helpers.planTaskCard({
    config,
    content,
    lineText: "- [ ] #task Triage me",
    cursorLine: 0,
    filePath: inboxRoute ? "mac_inbox.md" : "Health.md",
    propertyContext: { isObsidianTask: true, valid: true },
    taskSession: null,
    linkSession: null,
    baseDate: new Date(2026, 9, 3),
    inboxRoute: inboxRoute || null,
  });
}

test("task-card-gate header shows the Inbox chip only when armed", () => {
  const armed = planCardForHeader({ sourcePath: "mac_inbox.md", inboxName: "mac_inbox" });
  assert.ok(armed.header.chips.includes("Inbox"));
  assert.equal(armed.header.inboxRouted, true);
  assert.equal(
    armed.header.inboxTooltip,
    "Answers ask where this task goes first",
  );
  const plain = planCardForHeader(null);
  assert.ok(!plain.header.chips.includes("Inbox"));
  assert.equal(plain.header.inboxRouted, false);
});

// Minimal picker harness around the real gate mixin: a bare object on
// the real picker prototype with a fake editor, modal chrome, and a
// stubbed plugin. Exercises `runInboxRoutedCommit` itself, not copies.
function gatePicker(overrides = {}) {
  const proto = helpers.BulletPropertyPickerModal.prototype;
  assert.equal(typeof proto.runInboxRoutedCommit, "function");
  const editorContent = overrides.editorContent ?? "- [ ] #task Triage me\n- [ ] #task Next\n";
  const editor = new TransactionEditor(editorContent, { line: 0, ch: 0 });
  const focusLog = [];
  const modalEl = {
    addClass: () => {},
    removeClass: () => {},
  };
  const picker = Object.create(proto);
  picker.filePath = overrides.filePath ?? "mac_inbox.md";
  picker.editor = editor;
  picker.cursor = { line: 0, ch: 0 };
  picker.lineText = "- [ ] #task Triage me";
  picker.reviewLineIndex = 0;
  picker.reviewBeforeLine = "- [ ] #task Triage me";
  picker.taskSession = overrides.taskSession ?? null;
  picker.linkSession = overrides.linkSession ?? null;
  picker.inboxRoute =
    Object.hasOwn(overrides, "inboxRoute") && overrides.inboxRoute === null
      ? null
      : (overrides.inboxRoute ?? {
          sourcePath: "mac_inbox.md",
          inboxName: "mac_inbox",
        });
  picker.reviewOrigin = overrides.reviewOrigin ?? null;
  picker.reviewSettleDeferred = false;
  picker.inboxRouteCommitInFlight = false;
  picker.inboxRouteResult = null;
  picker.modalEl = modalEl;
  picker.stage = "task-card";
  picker.taskCardListEl = { focus: () => focusLog.push("list") };
  picker.inputEl = { focus: () => focusLog.push("input") };
  picker.pickerOpen = true;
  picker.isLinkSession =
    overrides.isLinkSession ??
    function () {
      return Boolean(this.linkSession);
    };
  picker.isCountedSession = function () {
    return Boolean(
      this.taskSession && this.taskSession.explicit === true,
    );
  };
  picker.getEditorContent = function () {
    return String(this.editor.getValue() || "");
  };
  const calls = { continue: [], notices: 0 };
  const routeMode = overrides.routeMode ?? "move";
  const destPath = overrides.destPath ?? "Health.md";
  const commitOk = overrides.commitOk ?? true;
  picker.plugin = {
    promptInboxRoute: async (request) => {
      calls.promptRequest = request;
      assert.ok(request.suspend);
      assert.equal(request.sourcePath, "mac_inbox.md");
      assert.ok(typeof request.actionLabel === "string" && request.actionLabel);
      if (routeMode === "cancel") return { kind: "cancel" };
      if (routeMode === "stay") return { kind: "stay" };
      return { kind: "move", path: destPath, name: "Health" };
    },
    commitInboxRoute: async (request) => {
      calls.commitRequest = request;
      assert.equal(request.destinationPath, destPath);
      assert.ok(Array.isArray(request.expected) && request.expected.length > 0);
      if (!commitOk) {
        return {
          ok: false,
          reason: "Destination is no longer eligible",
          notice: "Not moved: Destination is no longer eligible · still in mac_inbox",
          handledRefs: [],
        };
      }
      return {
        ok: true,
        count: request.expected.length,
        destinationName: "Health",
        destinationPath: destPath,
        notice:
          request.expected.length === 1
            ? "Moved to Health"
            : `Moved ${request.expected.length} tasks to Health`,
        handledRefs: request.expected.map((entry) => ({
          path: "mac_inbox.md",
          line: entry.line,
          raw: entry.raw,
        })),
      };
    },
    continueReviewWalkAfter: async (origin, outcome) => {
      calls.continue.push({ origin, outcome });
      return { ok: true };
    },
  };
  return { picker, editor, calls, focusLog };
}

// Every wrapped Task Card write, table-driven. The fake `write`
// simulates the action's writer (mutates the editor, returns the
// shape its caller uses to close); the gate must prompt exactly once.
const GATE_ACTIONS = [
  { id: "priority", action: { label: "set P2" }, writeKind: "bool" },
  { id: "scheduled", action: { label: "schedule 2026-10-09" }, writeKind: "bool" },
  { id: "generic-property", action: { label: "set effort large" }, writeKind: "bool" },
  { id: "refresh-interval", action: { label: "review every 30d" }, writeKind: "bool" },
  { id: "refresh-custom", action: { label: "review every 45d" }, writeKind: "bool" },
  { id: "clear-priority", action: { label: "clear priority" }, writeKind: "deleted" },
  { id: "recommended-roll", action: { label: "roll to 2026-10-09" }, writeKind: "bool" },
  { id: "recommended-decay", action: { label: "decay to P3" }, writeKind: "bool" },
  { id: "counted-roll", action: { label: "apply 3 rolls" }, writeKind: "bool" },
  { id: "lane-toggle", action: { label: "release to Ready" }, writeKind: "bool" },
  { id: "dependency-single", action: { label: "add 1 prerequisite" }, writeKind: "bool" },
  { id: "dependency-marked", action: { label: "add 2 prerequisites" }, writeKind: "bool" },
  { id: "dependency-vault", action: { label: "edit dependencies" }, writeKind: "bool" },
  { id: "dependency-counted", action: { label: "add 2 prerequisites" }, writeKind: "bool" },
];

function makeWrite(picker, kind) {
  return async () => {
    const before = String(picker.editor.getValue() || "");
    picker.editor.content = `${before}#route-test\n`;
    if (kind === "deleted") return { deleted: true };
    return true;
  };
}

for (const row of GATE_ACTIONS) {
  test(`task-card-gate ${row.id}: cancel writes nothing`, async () => {
    clearNotices();
    const { picker, editor, calls } = gatePicker({ routeMode: "cancel" });
    const before = String(editor.getValue() || "");
    const result = await picker.runInboxRoutedCommit(row.action, makeWrite(picker, row.writeKind));
    assert.equal(result, false);
    assert.equal(String(editor.getValue() || ""), before);
    assert.ok(calls.promptRequest);
    assert.equal(calls.promptRequest.actionLabel, row.action.label);
    assert.equal(picker.reviewSettleDeferred, false);
    assert.equal(picker.inboxRouteCommitInFlight, false);
  });

  test(`task-card-gate ${row.id}: stay runs today's write`, async () => {
    clearNotices();
    const { picker, editor, calls } = gatePicker({ routeMode: "stay" });
    const before = String(editor.getValue() || "");
    const result = await picker.runInboxRoutedCommit(row.action, makeWrite(picker, row.writeKind));
    assert.ok(result === true || (result && result.deleted === true));
    assert.ok(String(editor.getValue() || "").length > before.length);
    assert.equal(picker.inboxRouteResult, null);
    assert.equal(picker.reviewSettleDeferred, false);
  });

  test(`task-card-gate ${row.id}: move writes then moves`, async () => {
    clearNotices();
    const { picker, editor, calls } = gatePicker({ routeMode: "move" });
    const result = await picker.runInboxRoutedCommit(row.action, makeWrite(picker, row.writeKind));
    assert.ok(result === true || (result && result.deleted === true));
    assert.ok(String(editor.getValue() || "").includes("#route-test"));
    assert.ok(calls.commitRequest);
    assert.ok(picker.inboxRouteResult && picker.inboxRouteResult.ok === true);
    assert.equal(picker.inboxRouteResult.notice, "Moved to Health");
  });
}

test("task-card-gate negative rows never prompt", async () => {
  clearNotices();
  // Closing actions bypass.
  {
    const { picker, calls } = gatePicker({ routeMode: "move" });
    let wrote = false;
    const result = await picker.runInboxRoutedCommit({ label: "cancel", closing: true }, async () => {
      wrote = true;
      return true;
    });
    assert.equal(result, true);
    assert.equal(wrote, true);
    assert.equal(calls.promptRequest, undefined);
  }
  // Unarmed pickers (non-inbox) bypass.
  {
    const { picker, calls } = gatePicker({ routeMode: "move", inboxRoute: null });
    let wrote = false;
    const result = await picker.runInboxRoutedCommit({ label: "set P2" }, async () => {
      wrote = true;
      return true;
    });
    assert.equal(result, true);
    assert.equal(wrote, true);
    assert.equal(calls.promptRequest, undefined);
  }
  // Task Link sessions bypass via isLinkSession.
  {
    const { picker, calls } = gatePicker({
      routeMode: "move",
      linkSession: { kind: "task-link", resolved: [] },
    });
    let wrote = false;
    const result = await picker.runInboxRoutedCommit({ label: "set P2" }, async () => {
      wrote = true;
      return true;
    });
    assert.equal(result, true);
    assert.equal(wrote, true);
    assert.equal(calls.promptRequest, undefined);
  }
  // Re-entrant nested writers bypass (single prompt).
  {
    const { picker, calls } = gatePicker({ routeMode: "move" });
    picker.inboxRouteCommitInFlight = true;
    let wrote = false;
    const result = await picker.runInboxRoutedCommit({ label: "set P2" }, async () => {
      wrote = true;
      return true;
    });
    assert.equal(result, true);
    assert.equal(wrote, true);
    assert.equal(calls.promptRequest, undefined);
  }
  // A write that commits nothing never moves.
  {
    const { picker, calls } = gatePicker({ routeMode: "move" });
    const result = await picker.runInboxRoutedCommit({ label: "set P2" }, async () => false);
    assert.equal(result, false);
    assert.equal(calls.commitRequest, undefined);
  }
  // A truthy unchanged writer (e.g. Refresh unchanged) never moves.
  {
    const { picker, editor, calls } = gatePicker({ routeMode: "move" });
    const before = String(editor.getValue() || "");
    const result = await picker.runInboxRoutedCommit({ label: "review every 30d" }, async () => true);
    assert.equal(result, true);
    assert.equal(String(editor.getValue() || ""), before);
    assert.equal(calls.commitRequest, undefined);
    assert.equal(picker.inboxRouteResult, null);
    assert.equal(picker.reviewSettleDeferred, false);
  }
  // Closing the card while awaiting the route writes nothing.
  {
    const { picker, editor, calls } = gatePicker({ routeMode: "move", reviewOrigin: { key: "row-9", seq: 9, epoch: 9 } });
    let wrote = false;
    picker.plugin.promptInboxRoute = async () => {
      picker.pickerOpen = false;
      return { kind: "move", path: "Health.md", name: "Health" };
    };
    const before = String(editor.getValue() || "");
    const result = await picker.runInboxRoutedCommit({ label: "set P2" }, async () => {
      wrote = true;
      return true;
    });
    assert.equal(result, false);
    assert.equal(wrote, false);
    assert.equal(String(editor.getValue() || ""), before);
    assert.equal(calls.continue.length, 1);
    assert.equal(calls.continue[0].outcome, null);
  }
});

test("task-card-gate counted sessions capture N targets", async () => {
  clearNotices();
  const taskSession = {
    explicit: true,
    valid: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First" },
      { line: 1, rawLine: "- [ ] #task Second" },
      { line: 2, rawLine: "- [ ] #task Third" },
    ],
  };
  const { picker, calls } = gatePicker({
    routeMode: "move",
    taskSession,
    editorContent: "- [ ] #task First\n- [ ] #task Second\n- [ ] #task Third\n",
  });
  picker.reviewLineIndex = 0;
  picker.reviewBeforeLine = "- [ ] #task First";
  const result = await picker.runInboxRoutedCommit({ label: "apply 3 rolls" }, async () => {
    picker.editor.content += "#route-test\n";
    return true;
  });
  assert.equal(result, true);
  assert.equal(calls.promptRequest.additionalTaskCount, 2);
  assert.equal(calls.commitRequest.expected.length, 3);
  assert.equal(picker.inboxRouteResult.notice, "Moved 3 tasks to Health");
});

test("task-card-gate walk: move advances once with Moved first", async () => {
  clearNotices();
  const origin = { key: "row-1", seq: 1, epoch: 1 };
  const { picker, calls } = gatePicker({ routeMode: "move", reviewOrigin: origin });
  const result = await picker.runInboxRoutedCommit({ label: "set P2" }, async () => {
    picker.editor.content += "#route-test\n";
    return true;
  });
  assert.equal(result, true);
  assert.equal(calls.continue.length, 1);
  assert.equal(calls.continue[0].outcome.kind, "route");
  assert.ok(String(calls.continue[0].outcome.notice).startsWith("Moved to"));
  assert.equal(picker.reviewOrigin, null);
});

test("task-card-gate walk: move failure falls back to card with partial", async () => {
  clearNotices();
  const origin = { key: "row-1", seq: 1, epoch: 1 };
  const { picker, calls } = gatePicker({
    routeMode: "move",
    reviewOrigin: origin,
    commitOk: false,
  });
  const result = await picker.runInboxRoutedCommit({ label: "set P2" }, async () => {
    picker.editor.content += "#route-test\n";
    return true;
  });
  assert.equal(result, true);
  assert.equal(calls.continue.length, 1);
  assert.equal(calls.continue[0].outcome.kind, "card");
  assert.ok(String(calls.continue[0].outcome.notice).includes("still in"));
});

test("task-card-gate walk: exactly one settle per origin", async () => {
  clearNotices();
  const origin = { key: "row-1", seq: 1, epoch: 1 };
  const { picker, calls } = gatePicker({ routeMode: "move", reviewOrigin: origin });
  const slowWrite = async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    picker.editor.content += "#route-test\n";
    return true;
  };
  const result = await picker.runInboxRoutedCommit({ label: "set P2" }, slowWrite);
  assert.equal(result, true);
  assert.equal(calls.continue.length, 1);
});

test("task-card-gate route outcome resolves like lane and link-today", () => {
  assert.equal(helpers.reviewOutcomeResolves("new", { kind: "route" }, "2026-10-03"), true);
  assert.equal(helpers.reviewOutcomeResolves("pre", { kind: "route" }, "2026-10-03"), false);
  assert.equal(helpers.reviewOutcomeResolves("post", { kind: "route" }, "2026-10-03"), false);
});
