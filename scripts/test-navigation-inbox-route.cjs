// Inbox routing core (route-core): classifier, destination filtering,
// preflight, route picker modal, routed move commit, the `route` walk
// outcome, and the nav api `inboxRoute` v1 namespace.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
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

// Parent values that all resolve to inbox.md, mirroring
// `frontmatterFieldPointsToFile` resolution.
const pointsToInbox = (frontmatter) => {
  const raw = frontmatter && frontmatter.parent;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.some((value) => {
    const text = String(value || "").trim();
    const match = /^\[\[([^\]|#]+)/.exec(text);
    const target = (match ? match[1] : text).trim().replace(/\.md$/, "");
    return target === "inbox";
  });
};

const INBOX_FILE = { path: "inbox.md", basename: "inbox", extension: "md" };

test("inbox classifier covers the inbox contract", () => {
  assert.equal(
    helpers.classifyInboxNote({ path: "inbox.md", frontmatter: null }, INBOX_FILE, pointsToInbox),
    true,
  );
  assert.equal(
    helpers.classifyInboxNote(
      { path: "mac_inbox.md", frontmatter: { type: "[[area]]", parent: "[[inbox]]" } },
      INBOX_FILE,
      pointsToInbox,
    ),
    true,
  );
  // A project filed under an inbox is not an inbox note.
  assert.equal(
    helpers.classifyInboxNote(
      {
        path: "ship.md",
        frontmatter: { type: "[[project]]", status: "wip", parent: "[[mac_inbox]]" },
      },
      INBOX_FILE,
      () => true,
    ),
    false,
  );
  // An area with another parent is not an inbox note.
  assert.equal(
    helpers.classifyInboxNote(
      { path: "health.md", frontmatter: { type: "[[area]]", parent: "[[life]]" } },
      INBOX_FILE,
      pointsToInbox,
    ),
    false,
  );
  // Missing inbox.md means nothing else can be an inbox note.
  assert.equal(
    helpers.classifyInboxNote(
      { path: "mac_inbox.md", frontmatter: { type: "[[area]]", parent: "[[inbox]]" } },
      null,
      pointsToInbox,
    ),
    false,
  );
  // The parent resolves whether written as a path or an alias link.
  for (const parent of ["inbox", "inbox.md", "[[inbox]]", "[[inbox|Inbox]]", "[[inbox.md]]"]) {
    assert.equal(
      helpers.classifyInboxNote(
        { path: "gkeep_inbox.md", frontmatter: { type: "[[area]]", parent } },
        INBOX_FILE,
        pointsToInbox,
      ),
      true,
      `parent form: ${parent}`,
    );
  }
  assert.equal(
    helpers.classifyInboxNote({ path: "", frontmatter: null }, INBOX_FILE, pointsToInbox),
    false,
  );
  assert.equal(helpers.classifyInboxNote(null, INBOX_FILE, pointsToInbox), false);
});

function inboxVault() {
  const store = new Map(
    Object.entries({
      "inbox.md": ["---", 'type: "[[area]]"', "---", ""].join("\n"),
      "mac_inbox.md": [
        "---",
        'type: "[[area]]"',
        "parent: [[inbox]]",
        "---",
        "",
        "- [ ] #task Triage me ^abc",
        "  - child kept",
        "- [ ] #task Second ^second",
      ].join("\n"),
      "gkeep_inbox.md": ["---", 'type: "[[area]]"', "parent: [[inbox]]", "---", ""].join("\n"),
      "Health.md": ["---", 'type: "[[area]]"', "---", "", "## Tasks", ""].join("\n"),
      "Ship.md": ["---", 'type: "[[project]]"', "status: wip", "---", "", "## Tasks", ""].join("\n"),
    }),
  );
  const frontmatterByPath = {
    "inbox.md": { type: "[[area]]" },
    "mac_inbox.md": { type: "[[area]]", parent: "[[inbox]]" },
    "gkeep_inbox.md": { type: "[[area]]", parent: "[[inbox]]" },
    "Health.md": { type: "[[area]]" },
    "Ship.md": { type: "[[project]]", status: "wip" },
  };
  const fileFor = (path) => ({
    path,
    basename: path.replace(/\.md$/, "").split("/").pop(),
    extension: "md",
  });
  const plugin = new NavigationHotkeysPlugin();
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
        const before = store.get(file.path);
        store.set(file.path, fn(before));
      },
    },
  };
  return { plugin, store, fileFor };
}

test("isInboxNotePath matches the inbox contract through the vault", () => {
  const { plugin } = inboxVault();
  assert.equal(plugin.isInboxNotePath("inbox.md"), true);
  assert.equal(plugin.isInboxNotePath("mac_inbox.md"), true);
  assert.equal(plugin.isInboxNotePath("gkeep_inbox.md"), true);
  assert.equal(plugin.isInboxNotePath("Health.md"), false);
  assert.equal(plugin.isInboxNotePath("Ship.md"), false);
  assert.equal(plugin.isInboxNotePath("missing.md"), false);
  assert.equal(plugin.isInboxNotePath(""), false);
});

test("isInboxNotePath is false without an inbox note and never throws", () => {
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    metadataCache: { getFileCache: () => null },
    vault: {
      getMarkdownFiles: () => [{ path: "Health.md", basename: "Health", extension: "md" }],
    },
  };
  assert.equal(plugin.isInboxNotePath("Health.md"), false);
  const broken = new NavigationHotkeysPlugin();
  broken.app = null;
  assert.equal(broken.isInboxNotePath("mac_inbox.md"), false);
});

test("route destinations drop every inbox note, the source, and templates", () => {
  const area = (path) => ({
    file: { path, basename: path.replace(/\.md$/, ""), extension: "md" },
    noteInfo: { kind: "area" },
  });
  const entries = [
    area("Health.md"),
    area("inbox.md"),
    area("mac_inbox.md"),
    area("mac_inbox.md").file && { file: { path: "Ship.md", basename: "Ship", extension: "md" }, noteInfo: { kind: "project", statusKey: "wip" } },
    { file: { path: "_templates/new_note.md", basename: "new_note", extension: "md" }, noteInfo: { kind: "area" } },
    area("mac_inbox.md"),
  ];
  const filtered = helpers.filterInboxRouteDestinations(
    [entries[0], entries[1], entries[3], entries[4], area("mac_inbox.md")],
    (path) => path !== "Health.md" && path !== "Ship.md",
    "mac_inbox.md",
  );
  assert.deepEqual(
    filtered.map((entry) => entry.file.path),
    ["Health.md", "Ship.md"],
  );
  assert.equal(
    helpers.filterInboxRouteDestinations(null, null, null).length,
    0,
  );
});

const AREA_DEST = ["---", 'type: "[[area]]"', "---", "", "## Tasks", ""].join("\n");
const OPEN_PROJECT_DEST = ["---", 'type: "[[project]]"', "status: wip", "---", "", "## Tasks", ""].join("\n");
const CLOSED_PROJECT_DEST = ["---", 'type: "[[project]]"', "status: done", "---", "", "## Tasks", ""].join("\n");
const TASKLESS_PROJECT_DEST = ["---", 'type: "[[project]]"', "status: wip", "---", "", "## Notes", ""].join("\n");

function routeSource(extra = []) {
  return [
    "- [ ] #task Triage me ^abc",
    "  - child kept",
    "- [ ] #task Second ^second",
    ...extra,
  ].join("\n");
}

function routeTargets(content, line = 0, additional = 0) {
  const discovery = helpers.discoverMovableObsidianTaskTargets(content, line, additional);
  assert.equal(discovery.valid, true);
  return discovery.targets;
}

test("route preflight accepts a live area destination", () => {
  const source = routeSource();
  const check = helpers.preflightInboxRoute({
    sourcePath: "mac_inbox.md",
    sourceContent: source,
    destinationPath: "Health.md",
    destinationContent: AREA_DEST,
    targets: routeTargets(source),
    reservedBlockIds: [],
  });
  assert.deepEqual(check, { ok: true, reason: null });
});

test("route preflight refuses stale and colliding destinations", () => {
  const source = routeSource();
  const base = {
    sourcePath: "mac_inbox.md",
    sourceContent: source,
    targets: routeTargets(source),
    reservedBlockIds: [],
  };
  const closed = helpers.preflightInboxRoute({
    ...base,
    destinationPath: "Done.md",
    destinationContent: CLOSED_PROJECT_DEST,
  });
  assert.equal(closed.ok, false);
  assert.match(closed.reason, /no longer open/);

  const taskless = helpers.preflightInboxRoute({
    ...base,
    destinationPath: "Ship.md",
    destinationContent: TASKLESS_PROJECT_DEST,
  });
  assert.equal(taskless.ok, false);
  assert.match(taskless.reason, /## Tasks/);

  const colliding = helpers.preflightInboxRoute({
    ...base,
    destinationPath: "Health.md",
    destinationContent: `${AREA_DEST}\n- [ ] #task Other ^abc\n`,
  });
  assert.equal(colliding.ok, false);
  assert.match(colliding.reason, /already contains block ID: abc/);

  // A block ID the pending action is about to assign counts too.
  const reserved = helpers.preflightInboxRoute({
    ...base,
    destinationPath: "Health.md",
    destinationContent: `${AREA_DEST}\n- [ ] #task Other ^fresh\n`,
    reservedBlockIds: ["fresh"],
  });
  assert.equal(reserved.ok, false);
  assert.match(reserved.reason, /already contains block ID: fresh/);

  const reservedSet = helpers.preflightInboxRoute({
    ...base,
    destinationPath: "Health.md",
    destinationContent: AREA_DEST,
    reservedBlockIds: new Set(["fresh"]),
  });
  assert.deepEqual(reservedSet, { ok: true, reason: null });
});

function routePickerDestinations() {
  const entry = (path, kind) => ({
    file: { path, basename: path.replace(/\.md$/, ""), extension: "md" },
    noteInfo: { kind, decorated: false, icon: "file-text" },
  });
  return [entry("Health.md", "area"), entry("Ship.md", "project")];
}

function openRoutePicker(overrides = {}) {
  const plugin = new NavigationHotkeysPlugin();
  const picker = new helpers.InboxRoutePickerModal({}, plugin, {
    destinations: routePickerDestinations(),
    inboxName: "mac_inbox",
    taskText: "Triage me",
    count: 1,
    actionLabel: "set P2",
    preflight: async () => ({ ok: true, reason: null }),
    ...overrides,
  });
  picker.open();
  return { plugin, picker };
}

test("route picker resolves move, stay, cancel, and close exactly once", async () => {
  {
    const { picker } = openRoutePicker();
    assert.equal(picker.titleEl.textContent, "Route out of mac_inbox");
    assert.equal(picker.subtitleEl.textContent, "Triage me · then set P2");
    assert.equal(picker.inputEl.getAttribute("placeholder"), "Where does this go? Filter areas and open projects");
    picker.handleKeydown(keyEvent("Enter"));
    const outcome = await picker.waitForRoute();
    assert.equal(outcome.kind, "move");
    assert.equal(outcome.file.path, "Health.md");
    assert.equal(picker.isOpen, false);
  }
  {
    const counted = openRoutePicker({ taskText: "ignored", count: 3, actionLabel: { label: "link to today" } });
    assert.equal(counted.picker.subtitleEl.textContent, "3 tasks · then link to today");
    counted.picker.handleKeydown(keyEvent("Enter", { shiftKey: true }));
    assert.deepEqual(await counted.picker.waitForRoute(), { kind: "stay" });
  }
  {
    const { picker } = openRoutePicker();
    const promise = picker.waitForRoute();
    picker.close();
    assert.deepEqual(await promise, { kind: "cancel" });
  }
  {
    // Esc in the stub closes the modal, which resolves cancel.
    const { picker } = openRoutePicker();
    const promise = picker.waitForRoute();
    picker.dispatchKey(keyEvent("Escape"));
    assert.deepEqual(await promise, { kind: "cancel" });
  }
  {
    // Ctrl+[ backs out like Esc.
    const { picker } = openRoutePicker();
    const promise = picker.waitForRoute();
    picker.handleKeydown(keyEvent("[", { ctrlKey: true }));
    assert.deepEqual(await promise, { kind: "cancel" });
  }
  {
    // Settling twice keeps the first resolution.
    const { picker } = openRoutePicker();
    const promise = picker.waitForRoute();
    picker.handleKeydown(keyEvent("Enter"));
    assert.equal((await promise).kind, "move");
    picker.chooseRouteStay();
    picker.close();
    assert.equal((await promise).kind, "move");
  }
});

test("route picker footer names the move, the hatch, and the way back", () => {
  const { picker } = openRoutePicker();
  const text = picker.footerEl.children
    .map((group) => group.children.map((child) => child.textContent).join(""))
    .join(" · ");
  assert.match(text, /move & set P2/);
  assert.match(text, /keep in inbox/);
  assert.match(text, /back/);
  const cancelling = openRoutePicker({ cancelLabel: "cancel" });
  const cancelText = cancelling.picker.footerEl.children
    .map((group) => group.children.map((child) => child.textContent).join(""))
    .join(" · ");
  assert.match(cancelText, /cancel/);
});

test("route picker preflight refusal keeps the picker open with a notice", async () => {
  notices.length = 0;
  let attempt = 0;
  const { picker } = openRoutePicker({
    preflight: async () => {
      attempt += 1;
      return attempt === 1
        ? { ok: false, reason: "Destination project is no longer open" }
        : { ok: true, reason: null };
    },
  });
  const before = notices.length;
  picker.handleKeydown(keyEvent("Enter"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notices.length, before + 1);
  assert.match(notices[notices.length - 1], /no longer open/);
  assert.equal(picker.isOpen, true);
  picker.handleKeydown(keyEvent("Enter"));
  const outcome = await picker.waitForRoute();
  assert.equal(outcome.kind, "move");
});

test("route picker honors the shared move-picker guard", async () => {
  const { plugin } = inboxVault();
  plugin.activeTaskMoveDestinationPicker = { pickerOpen: true };
  const editor = new TransactionEditor(
    ["- [ ] #task Triage me ^abc"].join("\n"),
    { line: 0, ch: 0 },
  );
  const outcome = await plugin.promptInboxRoute({
    editor,
    sourcePath: "mac_inbox.md",
    startLine: 0,
    actionLabel: "set P2",
  });
  assert.deepEqual(outcome, { kind: "cancel" });
  // A stale registration fails open instead of swallowing the route.
  plugin.activeTaskMoveDestinationPicker = { pickerOpen: false, close() {} };
  const pending = plugin.promptInboxRoute({
    editor,
    sourcePath: "mac_inbox.md",
    startLine: 0,
    actionLabel: "set P2",
  });
  const picker = plugin.activeTaskMoveDestinationPicker;
  assert.ok(picker instanceof helpers.InboxRoutePickerModal);
  picker.handleKeydown(keyEvent("Enter", { shiftKey: true }));
  assert.deepEqual(await pending, { kind: "stay" });
});

function promptedRoute(overrides = {}) {
  const { plugin, store } = inboxVault();
  const editor = new TransactionEditor(store.get("mac_inbox.md"), { line: 5, ch: 0 });
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === "mac_inbox.md" ? editor : undefined;
  const suspend = {
    hidden: 0,
    restored: 0,
    hide() { this.hidden += 1; },
    restore() { this.restored += 1; },
  };
  const pending = plugin.promptInboxRoute({
    editor,
    sourcePath: "mac_inbox.md",
    startLine: 5,
    actionLabel: "set P2",
    suspend,
    ...overrides,
  });
  const picker = plugin.activeTaskMoveDestinationPicker;
  return { plugin, store, editor, suspend, pending, picker };
}

test("promptInboxRoute moves, stays, and cancels with suspend pairing", async () => {
  {
    const { suspend, pending, picker } = promptedRoute();
    assert.ok(picker instanceof helpers.InboxRoutePickerModal);
    assert.equal(suspend.hidden, 1);
    picker.handleKeydown(keyEvent("Enter"));
    const outcome = await pending;
    assert.equal(outcome.kind, "move");
    assert.equal(outcome.path, "Health.md");
    assert.equal(outcome.name, "Health");
    assert.equal(suspend.restored, 1);
  }
  {
    const { suspend, pending, picker } = promptedRoute();
    picker.handleKeydown(keyEvent("Enter", { shiftKey: true }));
    assert.deepEqual(await pending, { kind: "stay" });
    assert.equal(suspend.restored, 1);
  }
  {
    const { suspend, pending, picker } = promptedRoute();
    picker.close();
    assert.deepEqual(await pending, { kind: "cancel" });
    assert.equal(suspend.restored, 1);
  }
  {
    // Off-inbox sources never prompt.
    const { plugin } = inboxVault();
    const editor = new TransactionEditor("- [ ] #task Plain ^x", { line: 0, ch: 0 });
    assert.deepEqual(
      await plugin.promptInboxRoute({ editor, sourcePath: "Health.md", startLine: 0 }),
      { kind: "cancel" },
    );
    assert.deepEqual(
      await plugin.promptInboxRoute({ editor: null, sourcePath: "mac_inbox.md", startLine: 0 }),
      { kind: "cancel" },
    );
  }
});

function routedCommitFixture() {
  const sourceContent = [
    "---",
    'type: "[[area]]"',
    "parent: [[inbox]]",
    "---",
    "",
    "- [ ] #task Triage me ^abc",
    "  - child kept",
    "- [ ] #task Second ^second",
  ].join("\n");
  const store = new Map(
    Object.entries({
      "inbox.md": ["---", 'type: "[[area]]"', "---", ""].join("\n"),
      "mac_inbox.md": sourceContent,
      "Health.md": ["---", 'type: "[[area]]"', "---", "", "## Tasks", ""].join("\n"),
      "Daily/2026-10-06.md": ["- See [[mac_inbox#^abc]] for triage", ""].join("\n"),
    }),
  );
  const fileFor = (path) => ({
    path,
    basename: path.split("/").pop().replace(/\.md$/, ""),
    extension: "md",
  });
  const editor = new TransactionEditor(sourceContent, { line: 5, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    metadataCache: {
      getFileCache: (file) =>
        file.path === "mac_inbox.md"
          ? { frontmatter: { type: "[[area]]", parent: "[[inbox]]" } }
          : file.path === "Health.md"
            ? { frontmatter: { type: "[[area]]" } }
            : null,
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
  const sourceFile = fileFor("mac_inbox.md");
  plugin.getActiveMarkdownView = () => ({ editor, file: sourceFile });
  plugin.getOpenMarkdownEditorForPath = (path) =>
    path === "mac_inbox.md" ? editor : undefined;
  const opened = [];
  plugin.openMarkdownFileWithLeafReuse = async (file) => {
    opened.push(file.path);
    return true;
  };
  return { plugin, store, editor, opened, sourceContent };
}

function replaceSourceLine(editor, line, next) {
  const current = editor.getLine(line);
  editor.replaceRange(next, { line, ch: 0 }, { line, ch: current.length });
}

test("commitInboxRoute moves the verified task with its children", async () => {
  const { plugin, store, editor, opened, sourceContent } = routedCommitFixture();
  const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 5, 0);
  const expected = helpers.captureInboxRouteExpected(discovery.targets);
  // The gated action writes first, in place, in the inbox note.
  replaceSourceLine(editor, 5, "- [ ] #task Triage me [p::2] ^abc");
  const result = await plugin.commitInboxRoute({
    editor,
    sourcePath: "mac_inbox.md",
    startLine: 5,
    expected,
    destinationPath: "Health.md",
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.destinationName, "Health");
  assert.equal(result.destinationPath, "Health.md");
  assert.equal(result.notice, "Moved to Health");
  assert.deepEqual(result.handledRefs, [
    { path: "mac_inbox.md", line: 5, raw: "- [ ] #task Triage me ^abc" },
  ]);
  const health = store.get("Health.md");
  assert.match(health, /Triage me \[p::2\]/);
  assert.match(health, /\^abc/);
  assert.match(health, /child kept/);
  // The source write lands in the open editor (Obsidian syncs the file).
  const source = editor.getValue();
  assert.ok(!source.includes("Triage me"));
  assert.match(source, /Second/);
  // The cursor stays in the inbox note on the line the move leaves it on.
  assert.equal(editor.getCursor().line, 5);
  assert.equal(editor.getLine(5), "- [ ] #task Second ^second");
  // An external Task Link follows the task to its new home.
  assert.match(store.get("Daily/2026-10-06.md"), /\[\[Health#\^abc\]\]/);
  // A routed move never opens the destination.
  assert.deepEqual(opened, []);
});

test("commitInboxRoute moves a counted run and refuses on identity drift", async () => {
  {
    const { plugin, store, editor, sourceContent } = routedCommitFixture();
    const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 5, 1);
    assert.equal(discovery.actualCount, 2);
    const expected = helpers.captureInboxRouteExpected(discovery.targets);
    const result = await plugin.commitInboxRoute({
      editor,
      sourcePath: "mac_inbox.md",
      startLine: 5,
      additionalTaskCount: 1,
      expected,
      destinationPath: "Health.md",
    });
    assert.equal(result.ok, true);
    assert.equal(result.count, 2);
    assert.equal(result.notice, "Moved 2 tasks to Health");
    assert.equal(result.handledRefs.length, 2);
    assert.match(store.get("Health.md"), /Second/);
    assert.match(store.get("Health.md"), /\^second/);
  }
  {
    const { plugin, store, editor, sourceContent } = routedCommitFixture();
    const before = new Map(store);
    const discovery = helpers.discoverMovableObsidianTaskTargets(sourceContent, 5, 0);
    const expected = helpers.captureInboxRouteExpected(discovery.targets);
    // The action dropped the block ID: the re-discovered task is not the same.
    replaceSourceLine(editor, 5, "- [ ] #task Triage me rewritten");
    const result = await plugin.commitInboxRoute({
      editor,
      sourcePath: "mac_inbox.md",
      startLine: 5,
      expected,
      destinationPath: "Health.md",
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /changed/);
    assert.match(result.notice, /still in mac_inbox/);
    assert.deepEqual(Array.from(store.entries()), Array.from(before.entries()));
  }
  {
    // No expected snapshot means no move: the route never guesses.
    const { plugin, store, editor } = routedCommitFixture();
    const before = new Map(store);
    const result = await plugin.commitInboxRoute({
      editor,
      sourcePath: "mac_inbox.md",
      startLine: 5,
      destinationPath: "Health.md",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(Array.from(store.entries()), Array.from(before.entries()));
  }
});

test("reviewOutcomeResolves treats route like lane and link-today", () => {
  assert.equal(helpers.reviewOutcomeResolves("new", { kind: "route" }, "2026-10-06"), true);
  assert.equal(helpers.reviewOutcomeResolves("next", { kind: "route" }, "2026-10-06"), true);
  assert.equal(helpers.reviewOutcomeResolves("pre", { kind: "route" }, "2026-10-06"), false);
  assert.equal(helpers.reviewOutcomeResolves("post", { kind: "route" }, "2026-10-06"), false);
  assert.equal(helpers.reviewOutcomeResolves("new", { kind: "lane" }, "2026-10-06"), true);
  assert.equal(helpers.reviewOutcomeResolves("new", { kind: "link-today" }, "2026-10-06"), true);
  assert.equal(helpers.reviewOutcomeResolves("new", null, "2026-10-06"), false);
});

test("nav api inboxRoute v1 delegates, shapes, and never throws", async () => {
  const { plugin } = inboxVault();
  const api = helpers.createDependencyNavApi(plugin);
  assert.equal(api.version, 3);
  assert.equal(api.inboxRoute.version, 1);
  assert.equal((api.inboxRoute?.version ?? 0) >= 1, true);
  assert.equal(api.inboxRoute.isInboxNote("mac_inbox.md"), true);
  assert.equal(api.inboxRoute.isInboxNote("Health.md"), false);
  assert.equal(Object.isFrozen(api.inboxRoute), true);

  const stub = {
    isInboxNotePath: () => true,
    promptInboxRoute: async () => ({ kind: "move", path: "Health.md", name: "Health" }),
    commitInboxRoute: async () => ({
      ok: true,
      count: 1,
      destinationName: "Health",
      destinationPath: "Health.md",
      notice: "Moved to Health",
      handledRefs: [{ path: "mac_inbox.md", line: 5, raw: "- [ ] #task x" }],
    }),
  };
  const stubApi = helpers.createDependencyNavApi(stub);
  assert.deepEqual(await stubApi.inboxRoute.prompt({}), {
    kind: "move",
    path: "Health.md",
    name: "Health",
  });
  const committed = await stubApi.inboxRoute.commit({});
  assert.equal(committed.ok, true);
  assert.equal(committed.name, "Health");
  assert.equal(committed.count, 1);
  assert.equal(committed.notice, "Moved to Health");
  assert.equal(committed.handledRefs.length, 1);

  // Misshapen plugin results normalize instead of leaking.
  const looseApi = helpers.createDependencyNavApi({
    promptInboxRoute: async () => ({ kind: "weird" }),
    commitInboxRoute: async () => ({ ok: true }),
  });
  assert.deepEqual(await looseApi.inboxRoute.prompt({}), { kind: "cancel" });
  const looseCommit = await looseApi.inboxRoute.commit({});
  assert.equal(looseCommit.ok, true);
  assert.equal(looseCommit.name, "");
  assert.equal(looseCommit.count, 0);

  // Throwing and rejecting plugins fall back without rejecting.
  const throwingApi = helpers.createDependencyNavApi({
    isInboxNotePath() { throw new Error("gone"); },
    promptInboxRoute() { throw new Error("gone"); },
    commitInboxRoute: async () => { throw new Error("gone"); },
  });
  assert.equal(throwingApi.inboxRoute.isInboxNote("mac_inbox.md"), false);
  assert.deepEqual(await throwingApi.inboxRoute.prompt({}), { kind: "stay" });
  const throwingCommit = await throwingApi.inboxRoute.commit({});
  assert.equal(throwingCommit.ok, false);

  // A null plugin (after unload) keeps today's behavior available.
  const nullApi = helpers.createDependencyNavApi(null);
  assert.equal(nullApi.inboxRoute.version, 1);
  assert.equal(nullApi.inboxRoute.isInboxNote("mac_inbox.md"), false);
  assert.deepEqual(await nullApi.inboxRoute.prompt({}), { kind: "stay" });
  assert.deepEqual(await nullApi.inboxRoute.commit({}), {
    ok: false,
    name: "",
    count: 0,
    notice: "",
    handledRefs: [],
    reason: "unavailable",
  });
});
