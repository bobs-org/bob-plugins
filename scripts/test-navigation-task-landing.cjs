// nav-jump-landing: `api.landOnTask` re-finds a task by identity, flashes
// the line, records a Vim jump, and never clamps or touches the `]s` walk.
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

function makeLandingPlugin(options = {}) {
  const content =
    options.content ||
    ["- [ ] #task Alpha ^alpha", "- [ ] #task Beta ^beta"].join("\n");
  const file = {
    path: options.path || "dev.md",
    basename: "dev",
    extension: "md",
  };
  const editor = new TransactionEditor(
    content,
    options.cursor || { line: 0, ch: 0 },
  );
  const files = new Map([[file.path, file]]);
  const plugin = new NavigationHotkeysPlugin();
  const flashes = [];
  plugin.app = {
    vault: {
      getAbstractFileByPath: (vaultPath) => files.get(vaultPath) || null,
      cachedRead: async (candidate) =>
        candidate && candidate.path === file.path ? editor.getValue() : "",
    },
    workspace: {},
  };
  plugin.captureActiveFilePosition = () => true;
  plugin.openMarkdownFileWithLeafReuse = async () => true;
  plugin.getActiveMarkdownView = () => ({ file, editor });
  plugin.isMarkdownFile = (candidate) =>
    Boolean(candidate && candidate.extension === "md");
  plugin.vimJumpHistory = helpers.createVimJumpHistory();
  plugin.vimJumpOperationToken = 0;
  plugin.vimJumpHistoryChain = Promise.resolve();
  plugin.vimJumpSuppressNativeMirror = false;
  plugin.pendingTaskMoveJumpDeferred = null;
  plugin.pendingTaskMoveJumpCompletion = null;
  plugin.pendingTaskMoveJumpLandingId = null;
  plugin.taskMoveLandingSeq = 0;
  plugin.filePositions = new Map();
  plugin.reviewLanding = options.reviewLanding || {
    path: "walk.md",
    text: "- [*] #task Walk",
    key: "walk.md:1",
    tier: "next",
    day: "2026-10-08",
  };
  const landingSnapshot = { ...plugin.reviewLanding };
  plugin.flashBobOpenNotesLandingLine = (_editor, line) => {
    flashes.push(line);
    return true;
  };
  plugin.ensureGoToTaskEditingLeaf = async () => true;
  plugin.focusGoToTaskEditor = () => {};
  return { plugin, editor, file, flashes, landingSnapshot };
}

test("resolveTaskLandingLine uses planned, block-id, unique text, and unique description", () => {
  const content = [
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "- [ ] #task Moved ^moved",
  ].join("\n");
  assert.deepEqual(
    helpers.resolveTaskLandingLine(content, {
      line: 3,
      text: "- [ ] #task Moved ^moved",
      blockId: "moved",
    }),
    { ok: true, line: 3, source: "block-id" },
  );
  assert.deepEqual(
    helpers.resolveTaskLandingLine(content, {
      line: 4,
      text: "- [ ] #task Moved ^moved",
      blockId: "moved",
    }),
    { ok: true, line: 3, source: "block-id" },
    "a 1-based planned line still matches",
  );

  const shifted = [
    "---",
    "task_count: 1",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Existing ^existing",
    "- [ ] #task Moved ^moved",
  ].join("\n");
  assert.deepEqual(
    helpers.resolveTaskLandingLine(shifted, {
      line: 3,
      text: "- [ ] #task Moved ^moved",
      blockId: "moved",
    }),
    { ok: true, line: 6, source: "block-id" },
  );
  assert.deepEqual(
    helpers.resolveTaskLandingLine(
      ["- [ ] #task Twin", "- [ ] #task Twin ^target"].join("\n"),
      {
        line: 1,
        text: "- [ ] #task Twin",
        blockId: "target",
      },
    ),
    { ok: true, line: 1, source: "block-id" },
    "a 1-based line guess cannot beat the target block ID",
  );
  assert.deepEqual(
    helpers.resolveTaskLandingLine(shifted, {
      line: 3,
      text: "- [ ] #task Moved ^moved",
      blockId: null,
    }),
    { ok: true, line: 6, source: "text" },
  );

  const stamped = [
    "- [x] #task Fix the migration  [completion:: 2026-11-20] ^fixmig",
    "- [ ] #task Other ^other",
  ].join("\n");
  assert.deepEqual(
    helpers.resolveTaskLandingLine(stamped, {
      line: 9,
      text: "- [ ] #task Fix the migration ^fixmig",
      description: "Fix the migration",
    }),
    { ok: true, line: 0, source: "description" },
  );
});

test("resolveTaskLandingLine is lost when the match is missing or not unique", () => {
  const duplicates = [
    "- [ ] #task Twin",
    "- [ ] #task Twin",
  ].join("\n");
  assert.deepEqual(
    helpers.resolveTaskLandingLine(duplicates, {
      line: 9,
      text: "- [ ] #task Twin",
    }),
    { ok: false, reason: "lost", source: "lost" },
  );

  const missing = "- [ ] #task Only ^only";
  assert.deepEqual(
    helpers.resolveTaskLandingLine(missing, {
      line: 5,
      text: "- [ ] #task Missing ^missing",
      blockId: "missing",
    }),
    { ok: false, reason: "lost", source: "lost" },
  );

  const fencedOnly = [
    "```",
    "- [ ] #task Fenced ^fenced",
    "```",
    "- [ ] #task Real ^real",
  ].join("\n");
  assert.deepEqual(
    helpers.resolveTaskLandingLine(fencedOnly, {
      line: 0,
      text: "- [ ] #task Fenced ^fenced",
    }),
    { ok: false, reason: "lost", source: "lost" },
  );
});

test("landOnTask focuses a re-found line, flashes, records a Vim jump, and leaves the walk", async () => {
  const { plugin, editor, flashes, landingSnapshot } = makeLandingPlugin({
    cursor: { line: 0, ch: 0 },
  });
  clearNotices();
  const result = await plugin.landOnTask({
    path: "dev.md",
    text: "- [ ] #task Beta ^beta",
    blockId: "beta",
    label: "Beta",
  });
  assert.deepEqual(result, { ok: true, line: 1 });
  assert.deepEqual(editor.getCursor(), { line: 1, ch: 0 });
  assert.deepEqual(flashes, [1]);
  await plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 2);
  assert.deepEqual(plugin.vimJumpHistory.entries[0], {
    path: "dev.md",
    line: 0,
    ch: 0,
  });
  assert.deepEqual(plugin.vimJumpHistory.entries[1], {
    path: "dev.md",
    line: 1,
    ch: 0,
  });
  assert.deepEqual(plugin.reviewLanding, landingSnapshot);
  assert.deepEqual(notices, []);
});

test("landOnTask notices a lost target and does not clamp", async () => {
  const { plugin, editor, flashes, landingSnapshot } = makeLandingPlugin({
    content: "- [ ] #task Only ^only",
    cursor: { line: 0, ch: 0 },
  });
  clearNotices();
  const result = await plugin.landOnTask({
    path: "dev.md",
    line: 9,
    text: "- [ ] #task Missing ^missing",
    label: "Missing",
  });
  assert.deepEqual(result, { ok: false, reason: "lost" });
  assert.deepEqual(editor.getCursor(), { line: 0, ch: 0 });
  assert.deepEqual(flashes, []);
  assert.deepEqual(plugin.reviewLanding, landingSnapshot);
  assert.deepEqual(notices, [
    "Couldn't find “Missing” to jump to — your changes are saved",
  ]);
});

test("landOnTask waits for a no-context placement retry before reporting", async () => {
  const { plugin, editor, flashes } = makeLandingPlugin({
    cursor: { line: 0, ch: 0 },
  });
  delete plugin.vimJumpOperationToken;
  let attempts = 0;
  plugin.jumpToActiveTaskMoveDestination = (_path, _anchor, _options) => {
    attempts += 1;
    if (attempts === 1) return false;
    editor.setCursor({ line: 1, ch: 0 });
    return true;
  };
  clearNotices();
  const result = await plugin.landOnTask({
    path: "dev.md",
    text: "- [ ] #task Beta ^beta",
    blockId: "beta",
    label: "Beta",
  }, { vimJumpContext: {} });
  assert.deepEqual(result, { ok: true, line: 1 });
  assert.equal(attempts, 2, "the retry settles before landOnTask resolves");
  assert.deepEqual(editor.getCursor(), { line: 1, ch: 0 });
  assert.deepEqual(flashes, [1]);
  assert.deepEqual(notices, []);
});

test("landOnTask is lost when the file is missing", async () => {
  const { plugin } = makeLandingPlugin();
  clearNotices();
  const result = await plugin.landOnTask({
    path: "gone.md",
    text: "- [ ] #task Alpha ^alpha",
    label: "Alpha",
  });
  assert.deepEqual(result, { ok: false, reason: "lost" });
  assert.deepEqual(notices, [
    "Couldn't find “Alpha” to jump to — your changes are saved",
  ]);
});

test("nav api exposes additive landOnTask without changing the root version", async () => {
  const api = helpers.createDependencyNavApi({
    landOnTask: async () => ({ ok: true, line: 4 }),
  });
  assert.equal(api.version, 3);
  assert.equal(typeof api.landOnTask, "function");
  assert.deepEqual(await api.landOnTask({ path: "dev.md" }), {
    ok: true,
    line: 4,
  });
  const nullApi = helpers.createDependencyNavApi(null);
  assert.deepEqual(await nullApi.landOnTask({ path: "dev.md" }), {
    ok: false,
    reason: "unavailable",
  });
});
