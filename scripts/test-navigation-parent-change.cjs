const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
} = require("./navigation-hotkeys-harness.cjs");

const {
  readParentFrontmatterField,
  planParentFrontmatterEdit,
  buildParentPickerIndex,
  rankParentCandidates,
  buildParentAncestry,
  collapseParentBreadcrumb,
  parentChangeWouldCycle,
  parentEmptyStateText,
  PARENT_PICKER_HINTS,
  ParentNotePickerModal,
} = helpers;

function collectText(node) {
  if (!node) {
    return "";
  }
  const own = node.textContent || "";
  const kids = Array.isArray(node.children)
    ? node.children.map(collectText).join("")
    : "";
  return `${own}${kids}`;
}

function unchangedOutsideSpan(original, next, startLine, endLine) {
  const originalLines = original.split(/\r?\n/);
  const nextLines = next.split(/\r?\n/);
  const before = originalLines.slice(0, startLine);
  const after = originalLines.slice(endLine + 1);
  const nextBefore = nextLines.slice(0, startLine);
  const consumed = endLine - startLine + 1;
  const inserted = nextLines.length - originalLines.length + consumed;
  const nextAfter = nextLines.slice(startLine + inserted);
  assert.deepEqual(nextBefore, before);
  assert.deepEqual(nextAfter, after);
}

function noteInfo(kind, statusKey) {
  if (kind === "area") {
    return { kind: "area", decorated: true, statusKey: "", label: "Area" };
  }
  if (kind === "project") {
    return {
      kind: "project",
      decorated: true,
      statusKey: statusKey || "wip",
      label: statusKey || "WIP",
    };
  }
  return { kind: "plain", decorated: false, statusKey: "", label: "" };
}

function rec(path, extras = {}) {
  const basename = path.split("/").pop().replace(/\.md$/, "");
  return {
    path,
    basename,
    noteInfo: extras.noteInfo || noteInfo("plain"),
    parentPath: extras.parentPath || null,
    recentRank: extras.recentRank,
    file: extras.file || { path, basename, extension: "md" },
  };
}

test("planner replaces quoted, single-quoted, and unquoted parent wikilinks", () => {
  const quoted = "---\nparent: \"[[dev]]\"\n---\nbody\n";
  const single = "---\nparent: '[[dev]]'\n---\nbody\n";
  const unquoted = "---\nparent: [[dev]]\n---\nbody\n";
  for (const source of [quoted, single, unquoted]) {
    const plan = planParentFrontmatterEdit(source, "[[bob]]");
    assert.equal(plan.ok, true);
    assert.equal(plan.changed, true);
    assert.equal(plan.action, "replace");
    assert.equal(plan.previousTarget, "dev");
    assert.equal(plan.content, "---\nparent: \"[[bob]]\"\n---\nbody\n");
    unchangedOutsideSpan(source, plan.content, 1, 1);
  }
});

test("planner reports previousTarget before the alias and keeps trailing comments", () => {
  const aliased = '---\nparent: "[[2026/202608|202608]]"\n---\n';
  const aliasedPlan = planParentFrontmatterEdit(aliased, "[[bob]]");
  assert.equal(aliasedPlan.previousTarget, "2026/202608");
  assert.match(aliasedPlan.content, /parent: "\[\[bob\]\]"/);

  const commented =
    '---\nparent: "[[x]]"     # projection of the task\'s residence (R4)\ncreated: 1\n---\n';
  const commentPlan = planParentFrontmatterEdit(commented, "[[bob]]");
  assert.equal(commentPlan.ok, true);
  assert.equal(
    commentPlan.content,
    '---\nparent: "[[bob]]"     # projection of the task\'s residence (R4)\ncreated: 1\n---\n',
  );
  unchangedOutsideSpan(commented, commentPlan.content, 1, 1);
});

test("planner collapses a block list parent and keeps the next key", () => {
  const source = [
    "---",
    "parent:",
    '  - "[[a]]"',
    '  - "[[b]]"',
    "created: 2020-01-01",
    "---",
    "body",
    "",
  ].join("\n");
  const field = readParentFrontmatterField(source);
  assert.equal(field.state, "list");
  const plan = planParentFrontmatterEdit(source, "[[bob]]");
  assert.equal(plan.ok, true);
  assert.equal(plan.action, "replace");
  assert.equal(
    plan.content,
    [
      "---",
      'parent: "[[bob]]"',
      "created: 2020-01-01",
      "---",
      "body",
      "",
    ].join("\n"),
  );
  unchangedOutsideSpan(source, plan.content, 1, 3);
});

test("planner inserts a missing key, creates frontmatter, and keeps CRLF", () => {
  const missing = "---\ncreated: 1\n---\nhello\n";
  const inserted = planParentFrontmatterEdit(missing, "[[bob]]");
  assert.equal(inserted.action, "insert-key");
  assert.equal(
    inserted.content,
    '---\nparent: "[[bob]]"\ncreated: 1\n---\nhello\n',
  );
  unchangedOutsideSpan(missing, inserted.content, 1, 0);

  const body = "hello there\nmore\n";
  const created = planParentFrontmatterEdit(body, "[[bob]]");
  assert.equal(created.action, "create-frontmatter");
  assert.equal(created.content, '---\nparent: "[[bob]]"\n---\nhello there\nmore\n');
  assert.equal(created.content.endsWith(body), true);

  const crlf = "---\r\nparent: [[dev]]\r\n---\r\nbody\r\n";
  const crlfPlan = planParentFrontmatterEdit(crlf, "[[bob]]");
  assert.equal(
    crlfPlan.content,
    "---\r\nparent: \"[[bob]]\"\r\n---\r\nbody\r\n",
  );

  const empty = planParentFrontmatterEdit("", "[[bob]]");
  assert.equal(empty.content, '---\nparent: "[[bob]]"\n---\n');
});

test("planner refuses unclosed, duplicate, stale, and unquotable values", () => {
  const unclosed = "---\nparent: [[dev]]\nbody\n";
  const unclosedPlan = planParentFrontmatterEdit(unclosed, "[[bob]]");
  assert.equal(unclosedPlan.ok, false);
  assert.equal(unclosedPlan.reason, "unclosed-frontmatter");
  assert.equal(readParentFrontmatterField(unclosed).state, "unclosed");

  const duplicate = "---\nparent: [[a]]\nparent: [[b]]\n---\n";
  const duplicatePlan = planParentFrontmatterEdit(duplicate, "[[bob]]");
  assert.equal(duplicatePlan.ok, false);
  assert.equal(duplicatePlan.reason, "duplicate-parent-keys");
  assert.equal(duplicatePlan.count, 2);

  const source = '---\nparent: "[[dev]]"\n---\n';
  const stale = planParentFrontmatterEdit(source, "[[bob]]", {
    expectedRaw: ' "[[other]]"',
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "stale");

  const unquotable = planParentFrontmatterEdit(source, '[[say "hi"]]');
  assert.equal(unquotable.ok, false);
  assert.equal(unquotable.reason, "unquotable-link");
});

test("planner ignores indented, similarly named, and body parent lines", () => {
  const source = [
    "---",
    "parents: [[nope]]",
    "parent_task: [[nope]]",
    "  parent: [[indented]]",
    'parent: "[[dev]]"',
    "---",
    "parent: [[body]]",
    "",
  ].join("\n");
  const field = readParentFrontmatterField(source);
  assert.equal(field.state, "scalar");
  assert.equal(field.target, "dev");
  const plan = planParentFrontmatterEdit(source, "[[bob]]");
  assert.match(plan.content, /^---\nparents: \[\[nope\]\]\nparent_task: \[\[nope\]\]\n  parent: \[\[indented\]\]\nparent: "\[\[bob\]\]"\n---\nparent: \[\[body\]\]\n$/);
  unchangedOutsideSpan(source, plan.content, 4, 4);
});

test("planner replaces a Templater parent value and no-ops the same link", () => {
  const source = '---\nparent: "<% tp.file.folder() %>"\n---\n';
  const replaced = planParentFrontmatterEdit(source, "[[bob]]");
  assert.equal(replaced.ok, true);
  assert.equal(replaced.content, '---\nparent: "[[bob]]"\n---\n');

  const same = '---\nparent: "[[dev]]"\n---\n';
  const noop = planParentFrontmatterEdit(same, "[[dev]]");
  assert.equal(noop.ok, true);
  assert.equal(noop.changed, false);
  assert.equal(noop.content, same);
});

test("ranking uses exact > prefix > word-start > substring > path > fuzzy", () => {
  const records = [
    rec("fuzzy.md"), // aeiou contains d-e-v? no; "dxeyv.md" 
    rec("adev.md"), // substring
    rec("devise.md"), // prefix
    rec("dev.md"), // exact
    rec("ops/dev-tools.md", { file: { path: "ops/dev-tools.md", basename: "dev-tools" } }),
    rec("foo_dev.md"), // word-start
    rec("notes/other.md"),
    rec("path/only/devish.md", { file: { path: "path/only/devish.md", basename: "othername" } }),
  ];
  records[7].basename = "othername";
  records.push(rec("area.md"));
  const fuzzy = rec("dxeyv.md");
  records.push(fuzzy);
  const index = buildParentPickerIndex(records, { sourcePath: "notes/other.md" });
  const ranked = rankParentCandidates(index, "dev");
  const names = ranked.items.map((item) => item.basename);
  assert.equal(names[0], "dev");
  assert.ok(names.indexOf("devise") < names.indexOf("foo_dev"));
  assert.ok(names.indexOf("foo_dev") < names.indexOf("adev"));
  const pathOnly = ranked.items.find((item) => item.basename === "othername");
  assert.ok(pathOnly);
  const fuzzyRow = ranked.items.find((item) => item.basename === "dxeyv");
  assert.ok(fuzzyRow);
  assert.ok(names.indexOf("adev") < names.indexOf("othername"));
  assert.ok(names.indexOf("othername") < names.indexOf("dxeyv"));
});

test("ranking prefers the current parent, kind weight, children, and recency", () => {
  const records = [
    rec("plain.md", { noteInfo: noteInfo("plain"), recentRank: 0 }),
    rec("area.md", { noteInfo: noteInfo("area") }),
    rec("open.md", { noteInfo: noteInfo("project", "wip") }),
    rec("done.md", { noteInfo: noteInfo("project", "done") }),
    rec("current.md", { noteInfo: noteInfo("plain") }),
    rec("child-a.md", { parentPath: "popular.md" }),
    rec("child-b.md", { parentPath: "popular.md" }),
    rec("popular.md", { noteInfo: noteInfo("plain") }),
    rec("recent.md", { noteInfo: noteInfo("plain"), recentRank: 1 }),
    rec("source.md", { parentPath: "current.md" }),
  ];
  const index = buildParentPickerIndex(records, { sourcePath: "source.md" });
  const ranked = rankParentCandidates(index, "md");
  const names = ranked.items.map((item) => item.basename);
  assert.equal(names[0], "current");
  const areaAt = names.indexOf("area");
  const openAt = names.indexOf("open");
  const plainAt = names.indexOf("plain");
  const doneAt = names.indexOf("done");
  assert.ok(areaAt < plainAt);
  assert.ok(openAt < plainAt);
  assert.ok(plainAt < doneAt);
  assert.ok(names.indexOf("popular") < names.indexOf("plain") || names.indexOf("popular") < names.indexOf("recent"));
});

test("ranking excludes self, descendants, and _conflicts, and caps at 50", () => {
  const records = [
    rec("root.md"),
    rec("self.md", { parentPath: "root.md" }),
    rec("child.md", { parentPath: "self.md" }),
    rec("grand.md", { parentPath: "child.md" }),
    rec("_conflicts/dup.md"),
    rec("ok.md"),
  ];
  for (let i = 0; i < 60; i += 1) {
    records.push(rec(`n${String(i).padStart(2, "0")}.md`));
  }
  const index = buildParentPickerIndex(records, { sourcePath: "self.md" });
  const ranked = rankParentCandidates(index, "md");
  const paths = new Set(ranked.items.map((item) => item.path));
  assert.equal(paths.has("self.md"), false);
  assert.equal(paths.has("child.md"), false);
  assert.equal(paths.has("grand.md"), false);
  assert.equal(paths.has("_conflicts/dup.md"), false);
  assert.equal(ranked.items.length, 50);
  assert.ok(ranked.total > 50);
});

test("empty-query order is current, up a level, recent, then popular", () => {
  const records = [
    rec("source.md", { parentPath: "current.md" }),
    rec("current.md", { parentPath: "up.md" }),
    rec("up.md"),
    rec("recent-b.md", { recentRank: 1 }),
    rec("recent-a.md", { recentRank: 0 }),
    rec("kid-1.md", { parentPath: "popular.md" }),
    rec("kid-2.md", { parentPath: "popular.md" }),
    rec("popular.md"),
    rec("other.md"),
  ];
  const index = buildParentPickerIndex(records, { sourcePath: "source.md" });
  const ranked = rankParentCandidates(index, "");
  assert.deepEqual(
    ranked.items.slice(0, 5).map((item) => item.basename),
    ["current", "up", "recent-a", "recent-b", "popular"],
  );
});

test("ancestry stops at 16 hops and on repeats, breadcrumbs collapse at 5", () => {
  const records = [];
  for (let i = 0; i < 20; i += 1) {
    records.push(
      rec(`n${i}.md`, { parentPath: i === 0 ? null : `n${i - 1}.md` }),
    );
  }
  const index = buildParentPickerIndex(records, { sourcePath: "n19.md" });
  const ancestry = buildParentAncestry(index, "n19.md", 16);
  assert.equal(ancestry.length, 16);
  assert.equal(ancestry[ancestry.length - 1].basename, "n19");

  const cycle = [
    rec("a.md", { parentPath: "b.md" }),
    rec("b.md", { parentPath: "a.md" }),
  ];
  const cycleIndex = buildParentPickerIndex(cycle, { sourcePath: "a.md" });
  const walked = buildParentAncestry(cycleIndex, "a.md", 16);
  assert.ok(walked.length <= 2);

  const long = [
    { path: "a", basename: "a" },
    { path: "b", basename: "b" },
    { path: "c", basename: "c" },
    { path: "d", basename: "d" },
    { path: "e", basename: "e" },
    { path: "f", basename: "f" },
  ];
  const collapsed = collapseParentBreadcrumb(long, 5);
  assert.equal(collapsed.length, 5);
  assert.equal(collapsed[0].basename, "a");
  assert.equal(collapsed[1].ellipsis, true);
  assert.deepEqual(
    collapsed.slice(2).map((item) => item.basename),
    ["d", "e", "f"],
  );
});

test("excluded-only matches use the cycle empty-state text", () => {
  const records = [
    rec("self.md"),
    rec("child.md", { parentPath: "self.md" }),
  ];
  const index = buildParentPickerIndex(records, { sourcePath: "self.md" });
  const ranked = rankParentCandidates(index, "child");
  assert.equal(ranked.items.length, 0);
  assert.equal(ranked.excludedOnly, true);
  assert.match(
    parentEmptyStateText("child", true),
    /inside this note's own subtree/,
  );
});

test("unquoted parent cycles are detected at commit time", () => {
  const records = [
    rec("a.md", { parentPath: "b.md" }),
    rec("b.md", { parentPath: "a.md" }),
  ];
  const index = buildParentPickerIndex(records, { sourcePath: "a.md" });
  assert.equal(parentChangeWouldCycle(index, "a.md", "b.md"), true);
  assert.equal(parentChangeWouldCycle(index, "a.md", "a.md"), true);
});

function makeParentChangeHarness(options = {}) {
  const filesByPath = new Map();
  const contents = new Map();
  const frontmatter = new Map();
  const addFile = (path, body, parentTarget) => {
    const basename = path.split("/").pop().replace(/\.md$/, "");
    const file = { path, basename, extension: "md", name: `${basename}.md` };
    filesByPath.set(path, file);
    contents.set(path, body);
    const fm = {};
    if (parentTarget) {
      fm.parent = `[[${parentTarget}]]`;
    }
    if (options.frontmatter && options.frontmatter[path]) {
      Object.assign(fm, options.frontmatter[path]);
    }
    frontmatter.set(path, fm);
    return file;
  };

  const org = addFile("org.md", "---\n---\n");
  const dev = addFile("dev.md", '---\nparent: "[[org]]"\n---\n', "org");
  const ai = addFile(
    "ai.md",
    options.aiContent || '---\nparent: "[[dev]]"\n---\nbody\n',
    options.aiParent === undefined ? "dev" : options.aiParent,
  );
  const bob = addFile("bob.md", "---\n---\n");
  if (options.extraFiles) {
    for (const extra of options.extraFiles) {
      addFile(extra.path, extra.body || "---\n---\n", extra.parent);
    }
  }

  const processCalls = [];
  const editor = options.editor || null;
  const view = {
    file: ai,
    editor,
    getMode: () => options.mode || (editor ? "source" : "preview"),
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: {
      getActiveFile: () => (options.noFile ? null : ai),
      getActiveViewOfType: () => (options.noView ? null : view),
      getLastOpenFiles: () => options.lastOpen || ["dev.md"],
      on: () => ({}),
      onLayoutReady: (callback) => callback && callback(),
    },
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: frontmatter.get(file.path) || {},
      }),
      getFirstLinkpathDest: (lookup) => {
        const needle = String(lookup || "").replace(/\.md$/, "");
        for (const file of filesByPath.values()) {
          if (file.basename === needle || file.path.replace(/\.md$/, "") === needle) {
            return file;
          }
        }
        return null;
      },
    },
    vault: {
      getMarkdownFiles: () => Array.from(filesByPath.values()),
      cachedRead: async (file) => contents.get(file.path) || "",
      process: async (file, fn) => {
        processCalls.push(file.path);
        const next = fn(contents.get(file.path) || "");
        contents.set(file.path, next);
        return next;
      },
    },
  };
  plugin.addCommand = () => {};
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.registerVimJumpHistoryVaultEvents = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerReviewRefreshInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerCountedLaneToggleInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
  plugin.activeParentNotePicker = null;
  plugin.parentChangePickerOpening = false;
  notices.length = 0;
  return {
    plugin,
    files: { org, dev, ai, bob },
    contents,
    processCalls,
    view,
    editor,
  };
}

function stubOnload(plugin, commands) {
  plugin.addCommand = (command) => commands.push(command);
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.registerVimJumpHistoryVaultEvents = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerReviewRefreshInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerCountedLaneToggleInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
}

test("change-parent-note is registered with Ctrl+Shift+-", () => {
  const plugin = new NavigationHotkeysPlugin();
  const commands = [];
  plugin.app = {
    workspace: {
      getActiveFile: () => null,
      on: () => ({}),
      onLayoutReady: () => {},
    },
  };
  stubOnload(plugin, commands);
  plugin.onload();
  const command = commands.find((item) => item.id === "change-parent-note");
  assert.ok(command);
  assert.equal(command.name, "Change parent note");
  assert.deepEqual(command.hotkeys, [{ modifiers: ["Ctrl", "Shift"], key: "-" }]);
  assert.equal(typeof command.callback, "function");
  assert.equal(command.editorCallback, undefined);
});

test("opening the panel pre-fills the parent name, selects it, and shows ancestry", async () => {
  const { plugin, files } = makeParentChangeHarness();
  const picker = await plugin.openParentChangePickerNow(files.ai);
  assert.equal(picker instanceof ParentNotePickerModal, true);
  assert.equal(picker.inputEl.value, "dev");
  assert.equal(picker.inputEl.selectionStart, 0);
  assert.equal(picker.inputEl.selectionEnd, 3);
  assert.match(collectText(picker.subtitleEl), /ai/);
  assert.equal(plugin.activeParentNotePicker, picker);
});

test("vault.process commit writes the canonical parent and notices the change", async () => {
  const { plugin, files, contents, processCalls } = makeParentChangeHarness({
    mode: "preview",
  });
  const picker = await plugin.openParentChangePickerNow(files.ai);
  const bob = picker.index.records.find((item) => item.basename === "bob");
  assert.ok(bob);
  const ok = await plugin.commitParentChange({
    file: files.ai,
    candidate: bob,
    expected: picker.expectedRaw,
  });
  assert.equal(ok, true);
  assert.equal(processCalls.length, 1);
  assert.equal(contents.get("ai.md"), '---\nparent: "[[bob]]"\n---\nbody\n');
  assert.equal(notices.at(-1), "Parent: dev → bob");
  assert.equal(plugin.activeParentNotePicker, null);
});

test("editor commit issues one transaction and does not call vault.process", async () => {
  const editor = new TransactionEditor(
    '---\nparent: "[[dev]]"\n---\nbody\n',
    { line: 3, ch: 0 },
  );
  const { plugin, files, processCalls } = makeParentChangeHarness({ editor });
  const picker = await plugin.openParentChangePickerNow(files.ai);
  const bob = picker.index.records.find((item) => item.basename === "bob");
  const ok = await plugin.commitParentChange({
    file: files.ai,
    candidate: bob,
    expected: picker.expectedRaw,
  });
  assert.equal(ok, true);
  assert.equal(processCalls.length, 0);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.getValue(), '---\nparent: "[[bob]]"\n---\nbody\n');
  assert.equal(notices.at(-1), "Parent: dev → bob");
});

test("choosing the current parent is a no-op", async () => {
  const { plugin, files, contents, processCalls } = makeParentChangeHarness({
    mode: "preview",
  });
  const picker = await plugin.openParentChangePickerNow(files.ai);
  const dev = picker.index.records.find((item) => item.basename === "dev");
  const original = contents.get("ai.md");
  const ok = await plugin.commitParentChange({
    file: files.ai,
    candidate: dev,
    expected: picker.expectedRaw,
  });
  assert.equal(ok, false);
  assert.equal(processCalls.length, 0);
  assert.equal(contents.get("ai.md"), original);
  assert.equal(notices.at(-1), "Parent unchanged: dev");
});

test("a commit-time cycle is refused after the tree changes", async () => {
  const { plugin, files } = makeParentChangeHarness({
    extraFiles: [{ path: "child.md", parent: "ai" }],
    mode: "preview",
  });
  const picker = await plugin.openParentChangePickerNow(files.ai);
  const child = picker.index.records.find((item) => item.basename === "child");
  assert.ok(child);
  const ok = await plugin.commitParentChange({
    file: files.ai,
    candidate: child,
    expected: picker.expectedRaw,
  });
  assert.equal(ok, false);
  assert.match(notices.at(-1), /inside this note's subtree/);
});

test("a stale expectedRaw is refused", async () => {
  const { plugin, files, contents, processCalls } = makeParentChangeHarness({
    mode: "preview",
  });
  const picker = await plugin.openParentChangePickerNow(files.ai);
  const bob = picker.index.records.find((item) => item.basename === "bob");
  const original = contents.get("ai.md");
  const ok = await plugin.commitParentChange({
    file: files.ai,
    candidate: bob,
    expected: ' "[[other]]"',
  });
  assert.equal(ok, false);
  assert.equal(processCalls.length, 1);
  assert.equal(contents.get("ai.md"), original);
  assert.match(notices.at(-1), /Parent changed while the panel was open/);
});

test("a second command press focuses the open panel", async () => {
  const { plugin, files } = makeParentChangeHarness();
  const first = await plugin.openParentChangePickerNow(files.ai);
  assert.equal(plugin.activeParentNotePicker, first);
  const result = plugin.openParentChangePicker();
  assert.equal(result, true);
  assert.equal(plugin.activeParentNotePicker, first);
  assert.equal(first.inputEl.focused, true);
});

test("no active markdown file uses the existing notice", () => {
  const { plugin } = makeParentChangeHarness({ noFile: true });
  notices.length = 0;
  const result = plugin.openParentChangePicker();
  assert.equal(result, false);
  assert.equal(notices.at(-1), "No active markdown file");
});

test("footer hints and empty-state copy match the spec", () => {
  assert.deepEqual(
    PARENT_PICKER_HINTS.map((hint) => [hint.keys.join(" "), hint.label]),
    [
      ["↑ ↓", "Navigate"],
      ["^N ^P", "Move"],
      ["↵", "Set parent"],
      ["esc", "Cancel"],
    ],
  );
  assert.equal(
    parentEmptyStateText("q", false),
    "No note matches “q” — the parent must be an existing note",
  );
});
