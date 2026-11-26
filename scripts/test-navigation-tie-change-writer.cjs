// Writer-level coverage for converting task dependency and plain-link ties.
// `docs/task-dependencies.md` §§6.6 and 15.6 are authoritative.
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  NavigationHotkeysPlugin,
  TransactionEditor,
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

const owner = Object.freeze({ path: "Tasks.md", blockId: "owner" });
const other = Object.freeze({ path: "Tasks.md", blockId: "other" });
const task = (label, id, dependency = "") =>
  `- [ ] #task ${label}${dependency} ^${id}`;
const deps = (links) => `\t- ⛓️ **DEPENDS ON:** ${links}`;
const links = (targets) => `\t- 🪢 **LINKS:** ${targets}`;

function makePlugin(notes) {
  const plugin = new NavigationHotkeysPlugin();
  const live = new Map(Object.entries(notes));
  plugin.readDependencyNoteContent = async (path) =>
    live.has(path) ? live.get(path) : null;
  plugin.dependencyLinkpathResolver = () => (note, from) =>
    !note ? from : `${note}.md`;
  plugin.readDependencyVaultFileList = () => [...live.keys()];
  return { plugin, live };
}

function installDependencyWriter(plugin, live, events, options = {}) {
  plugin.applyDependencyEdit = async (args) => {
    events.push("dependency");
    if (options.dependencyResult) return options.dependencyResult;
    const content = live.get(args.parentPath);
    const plan = helpers.planDependencyEdit({
      content,
      parentLine: args.parentLine,
      parentPath: args.parentPath,
      add: args.add,
      remove: args.remove,
      files: live,
      vaultFiles: [...live.keys()],
      resolveLinkpath: plugin.dependencyLinkpathResolver(),
    });
    if (!plan.ok) return { ok: false, reason: plan.reason };
    let nextContent = plan.nextContent;
    const tieLinks = helpers.applyTieLinksToContent(
      nextContent,
      args.parentPath,
      args.tieLinks,
      {
        resolveLinkpath: plugin.dependencyLinkpathResolver(),
        vaultFiles: [...live.keys()],
      },
    );
    nextContent = tieLinks.nextContent;
    live.set(args.parentPath, nextContent);
    return {
      ok: true,
      reason: null,
      notice: plan.notice,
      committed: [args.parentPath],
      tieLinks,
    };
  };
}

function installRelationWriter(plugin, events, result = null) {
  plugin.applyRelationEdit = async (args) => {
    events.push("relation");
    if (result) return result;
    return {
      ok: true,
      committed: [args.sources[0].path],
      mirrorFailed: [],
    };
  };
}

test("same-note tie conversion folds dependency and LINKS into one writer", async () => {
  const initial = [
    task("Owner", "owner"),
    links("[[#^other]]"),
    task("Other", "other"),
  ].join("\n");
  const { plugin, live } = makePlugin({ "Tasks.md": initial });
  const events = [];
  installDependencyWriter(plugin, live, events);
  installRelationWriter(plugin, events);

  const result = await plugin.applyTieChange(owner, other, "owner-waits");

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(events, ["dependency"]);
  assert.match(live.get("Tasks.md"), /DEPENDS ON:\*\* \[\[#\^other\]\]/);
  assert.doesNotMatch(live.get("Tasks.md"), /\*\*LINKS:\*\*/);
});

test("same-note conversion is one actual editor undo group", async () => {
  const initial = [
    task("Owner", "owner"),
    links("[[#^other]]"),
    task("Other", "other"),
  ].join("\n");
  const editor = new TransactionEditor(initial, { line: 0, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [
        { view: { file: { path: "Tasks.md" }, editor } },
      ],
    },
    plugins: { plugins: {} },
  };
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  plugin.readDependencyNoteContent = async (path, openEditor) =>
    path === "Tasks.md"
      ? String(openEditor && openEditor.getValue ? openEditor.getValue() : editor.getValue())
      : null;
  plugin.readDependencyVaultFileList = () => ["Tasks.md"];
  plugin.dependencyLinkpathResolver = () => (note, from) =>
    !note ? from : `${note}.md`;
  plugin.readDependencyRecoveryVaultContents = async () =>
    new Map([["Tasks.md", editor.getValue()]]);
  plugin.prepareSubtreeForDependencyPlan = async () => null;
  plugin.readDeferredPomodoroSnapshot = async () => ({
    ok: true,
    contents: new Map(),
  });
  plugin.getFreshnessApi = () => null;

  const result = await plugin.applyTieChange(owner, other, "owner-waits", {
    editor,
    editorPath: "Tasks.md",
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /\[dependsOn:: Tasks__other\]/);
  assert.match(editor.content, /DEPENDS ON:\*\* \[\[#\^other\]\]/);
  assert.match(editor.content, /BLOCKS:\*\* \[\[#\^owner\]\]/);
  assert.doesNotMatch(editor.content, /\*\*LINKS:\*\*/);
});

test("cross-note release writes the dependency before adding the plain link", async () => {
  const source = [
    task("Owner", "owner"),
    deps("[[Other#^other]]"),
  ].join("\n");
  const target = task("Other", "other");
  const crossOwner = { path: "Tasks.md", blockId: "owner" };
  const crossOther = { path: "Other.md", blockId: "other" };
  const { plugin, live } = makePlugin({ "Tasks.md": source, "Other.md": target });
  const events = [];
  installDependencyWriter(plugin, live, events);
  installRelationWriter(plugin, events);

  const result = await plugin.applyTieChange(
    crossOwner,
    crossOther,
    "plain-out",
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(events, ["dependency", "relation"]);
  assert.doesNotMatch(live.get("Tasks.md"), /DEPENDS ON/);
  assert.equal(result.linkSucceeded, true);
});

test("a failed dependency step leaves a cross-note relation untouched", async () => {
  const { plugin } = makePlugin({
    "Tasks.md": [task("Owner", "owner"), deps("[[Other#^other]]")].join("\n"),
    "Other.md": task("Other", "other"),
  });
  const events = [];
  plugin.applyDependencyEdit = async () => {
    events.push("dependency");
    return { ok: false, reason: "target-not-found" };
  };
  installRelationWriter(plugin, events);

  const result = await plugin.applyTieChange(
    { path: "Tasks.md", blockId: "owner" },
    { path: "Other.md", blockId: "other" },
    "plain-out",
  );

  assert.equal(result.ok, false);
  assert.deepEqual(events, ["dependency"]);
});

test("a later cross-note relation failure reports that the link was not added", async () => {
  const { plugin, live } = makePlugin({
    "Tasks.md": [task("Owner", "owner"), deps("[[Other#^other]]")].join("\n"),
    "Other.md": task("Other", "other"),
  });
  const events = [];
  installDependencyWriter(plugin, live, events);
  installRelationWriter(plugin, events, {
    ok: false,
    reason: "target-unavailable",
    committed: [],
    mirrorFailed: [],
  });

  const result = await plugin.applyTieChange(
    { path: "Tasks.md", blockId: "owner" },
    { path: "Other.md", blockId: "other" },
    "plain-out",
  );

  assert.equal(result.ok, true);
  assert.equal(result.linkSucceeded, false);
  assert.match(result.notice, /link not added/);
  assert.deepEqual(events, ["dependency", "relation"]);
});

test("stale snapshots and no-op ties never call a writer", async () => {
  const current = [
    task("Owner", "owner"),
    deps("[[#^other]]"),
    task("Other", "other"),
  ].join("\n");
  const { plugin, live } = makePlugin({ "Tasks.md": current });
  const events = [];
  installDependencyWriter(plugin, live, events);

  const stale = await plugin.applyTieChange(owner, other, "plain-out", {
    expected: { "Tasks.md": `${current}\nconcurrent edit` },
  });
  assert.equal(stale.stale, true);
  const unchanged = await plugin.applyTieChange(owner, other, "owner-waits");
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.reason, "unchanged");
  assert.deepEqual(events, []);
  assert.equal(live.get("Tasks.md"), current);
});

test("missing target ids use the block-id prompt before the relation writer", async () => {
  const { plugin } = makePlugin({
    "Tasks.md": [task("Owner", "owner"), task("Other", "other")].join("\n"),
  });
  const events = [];
  installRelationWriter(plugin, events);
  let prompt = null;

  const result = await plugin.applyTieChange(
    owner,
    { path: "Tasks.md", line: 1 },
    "plain-out",
    {
      promptBlockId: async (request) => {
        prompt = request;
        return { blockId: "other" };
      },
    },
  );

  assert.equal(prompt.missing.path, "Tasks.md");
  assert.equal(result.ok, true);
  assert.deepEqual(events, ["relation"]);
});

test("project-root dependency release routes through the dependency writer", async () => {
  const project = Object.freeze({ path: "Project.md", blockId: "prj" });
  const target = Object.freeze({ path: "Tasks.md", blockId: "other" });
  const { plugin, live } = makePlugin({
    "Project.md": [task("Project", "prj"), deps("[[Tasks#^other]]")].join("\n"),
    "Tasks.md": task("Other", "other"),
  });
  const events = [];
  let dependencyArgs = null;
  plugin.applyDependencyEdit = async (args) => {
    events.push("dependency");
    dependencyArgs = args;
    const content = live.get(args.parentPath);
    const plan = helpers.planDependencyEdit({
      content,
      parentLine: args.parentLine,
      parentPath: args.parentPath,
      add: args.add,
      remove: args.remove,
      files: live,
      vaultFiles: [...live.keys()],
      resolveLinkpath: plugin.dependencyLinkpathResolver(),
    });
    assert.equal(plan.ok, true, JSON.stringify(plan));
    live.set(args.parentPath, plan.nextContent);
    return { ok: true, notice: "⛓ Dependency removed", committed: ["Project.md"] };
  };
  installRelationWriter(plugin, events);

  const result = await plugin.applyTieChange(project, target, "plain-out");

  assert.equal(result.ok, true);
  assert.deepEqual(events, ["dependency", "relation"]);
  assert.equal(dependencyArgs.parentPath, "Project.md");
  assert.deepEqual(dependencyArgs.remove, [target]);
  assert.match(live.get("Project.md"), /\^prj/);
  assert.doesNotMatch(live.get("Project.md"), /dependsOn|DEPENDS ON/);
});

test("dependency removal clears dependsOn only when its last target is removed", () => {
  const content = [
    "- [ ] #task Owner [dependsOn:: Tasks__one, Tasks__two] ^owner",
    deps("[[#^one]] • [[#^two]]"),
    task("One", "one"),
    task("Two", "two"),
  ].join("\n");
  const removeOne = helpers.planDependencyEdit({
    content,
    parentLine: 0,
    parentPath: "Tasks.md",
    add: [],
    remove: [{ path: "Tasks.md", blockId: "one" }],
    files: { "Tasks.md": content },
    vaultFiles: ["Tasks.md"],
    resolveLinkpath: (note, from) => (note ? `${note}.md` : from),
  });
  assert.equal(removeOne.ok, true);
  assert.match(removeOne.nextContent, /\[dependsOn:: Tasks__two\]/);
  assert.match(removeOne.nextContent, /DEPENDS ON:\*\* \[\[#\^two\]\]/);

  const removeLast = helpers.planDependencyEdit({
    content: removeOne.nextContent,
    parentLine: 0,
    parentPath: "Tasks.md",
    add: [],
    remove: [{ path: "Tasks.md", blockId: "two" }],
    files: { "Tasks.md": content },
    vaultFiles: ["Tasks.md"],
    resolveLinkpath: (note, from) => (note ? `${note}.md` : from),
  });
  assert.equal(removeLast.ok, true);
  assert.doesNotMatch(removeLast.nextContent, /dependsOn|DEPENDS ON/);
});

test("stale relation-stage reopen preserves the counted task session", () => {
  const calls = [];
  const modal = Object.create(helpers.BulletPropertyPickerModal.prototype);
  const taskSession = { id: "counted-session" };
  modal.plugin = {
    openBulletPropertyPicker: (editor, options) => calls.push({ editor, options }),
  };
  modal.editor = { id: "editor" };
  modal.relationStage = true;
  modal.relationStageDirection = "from";
  modal.inboxRoute = { id: "route" };
  modal.taskSession = taskSession;
  modal.close = () => {};

  modal.reopenDependencyStageFresh();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.reopenLinkedFromStage, true);
  assert.equal(calls[0].options.taskSession, taskSession);
  assert.deepEqual(calls[0].options.inboxRoute, { id: "route" });
});
