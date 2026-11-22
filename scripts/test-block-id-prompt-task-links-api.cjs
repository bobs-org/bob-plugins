// api.taskLinks v1 — shared prose detector, ranked task snapshots, and safe naming.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  Plugin,
  helpers,
  createEditor,
} = require("./block-id-prompt-harness.cjs");

const vectors = require("./fixtures/task_wikilinks/prose_trigger_vectors.json");

function makeHarness({ files, editors = [], resolveLink, beforeProcess } = {}) {
  const store = { ...(files || {}) };
  const fileObjects = new Map(Object.keys(store).map((notePath) => [notePath, {
    path: notePath,
    extension: "md",
    stat: { mtime: 1, size: store[notePath].length },
  }]));
  let processCalls = 0;
  let readCalls = 0;
  const writes = [];
  const leaves = editors.map(({ path: notePath, editor }) => ({
    view: { file: { path: notePath }, editor },
  }));
  const app = {
    workspace: {
      getLeavesOfType: () => leaves,
    },
    vault: {
      getMarkdownFiles: () => [...fileObjects.values()],
      getAbstractFileByPath: (notePath) => fileObjects.get(notePath) || null,
      read: async (file) => {
        readCalls += 1;
        return Object.hasOwn(store, file.path) ? store[file.path] : null;
      },
      cachedRead: async (file) => Object.hasOwn(store, file.path) ? store[file.path] : null,
      process: async (file, transform) => {
        processCalls += 1;
        let current = store[file.path];
        if (typeof beforeProcess === "function") {
          current = beforeProcess(current, file.path);
        }
        const next = transform(current);
        store[file.path] = next;
        file.stat = { mtime: file.stat.mtime + 1, size: next.length };
        writes.push({ path: file.path, content: next });
      },
      modify: async (file, content) => {
        store[file.path] = content;
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (target, sourcePath) =>
        typeof resolveLink === "function"
          ? resolveLink(target, sourcePath)
          : ({ path: `${target}.md` }),
    },
  };
  const plugin = new Plugin();
  plugin.app = app;
  plugin.taskWikilinkIndex = new helpers.TaskWikilinkIndex();
  plugin.ensureTaskWikilinkIndex = () => plugin.taskWikilinkIndex;
  plugin.activeTaskLinksSessions = new Set();
  plugin.suppressEditorScans = () => {};
  plugin.now = () => new Date(2026, 10, 22, 14, 30);
  for (const [notePath, content] of Object.entries(store)) {
    plugin.taskWikilinkIndex.ingestNote(notePath, content, fileObjects.get(notePath).stat);
  }
  const api = helpers.createTaskLinksApi(plugin);
  return {
    api,
    app,
    plugin,
    store,
    writes,
    get processCalls() { return processCalls; },
    get readCalls() { return readCalls; },
  };
}

function rowWithTitle(session, title) {
  const result = session.rank("");
  const row = result.rows.find((candidate) => candidate.titleParts.map((part) => part.text).join("").includes(title));
  assert.ok(row, `expected a row containing ${title}`);
  return row;
}

test("taskLinks v1 prose detector replays bob-cli's shared vectors", () => {
  assert.equal(vectors.source, "tests/fixtures/task_wikilinks/prose_trigger_vectors.json");
  const pluginFixture = fs.readFileSync(
    path.join(__dirname, "fixtures/task_wikilinks/prose_trigger_vectors.json"),
    "utf8",
  );
  const bobFixture = fs.readFileSync(
    path.resolve(__dirname, "../../../../../tests/fixtures/task_wikilinks/prose_trigger_vectors.json"),
    "utf8",
  );
  assert.equal(pluginFixture, bobFixture, "the shared prose vectors must be byte-identical");
  const api = helpers.createTaskLinksApi({ app: {} });
  for (const vector of vectors.cases) {
    const text = vector.before + vector.after;
    const field = api.fieldAt(text, vector.before.length);
    const actual = field
      ? {
          query: field.query,
          replaced: text.slice(field.start, field.end),
          closed: field.closed,
        }
      : null;
    assert.deepEqual(actual, vector.expect, vector.name);
  }
});

test("fieldAt honors minOffset, field mode, and UTF-16 caret boundaries", () => {
  const api = helpers.createTaskLinksApi({ app: {} });
  assert.deepEqual(api.fieldAt("((task)", 6, { minOffset: 0 }), {
    start: 0,
    end: 6,
    query: "task",
    closed: false,
  });
  assert.equal(api.fieldAt("intro ((task", 12, { minOffset: 7 }), null);
  assert.equal(api.fieldAt("intro ((task", 12, { mode: "field" }), null);
  assert.equal(api.fieldAt("((task", 6, { mode: "field" }).start, 0);
  assert.equal(api.fieldAt("🎉 ((task", 1), null, "caret cannot split a surrogate pair");
});

test("rank maps statuses, groups, title spans, and task kind", () => {
  const files = {
    "Tasks.md": [
      "# Work",
      "- [/] #task Review the `API` docs [[Guide|manual]] ^review-api",
      "- [ ] #task #ref Read the book ^read-book",
    ].join("\n"),
  };
  const harness = makeHarness({ files });
  const session = harness.api.open({ sourcePath: "Tasks.md" });
  const rows = session.rank("review");
  assert.equal(rows.total, 1);
  const row = rows.rows[0];
  assert.equal(row.key, "Tasks.md|1");
  assert.equal(row.notePath, "Tasks.md");
  assert.equal(row.line, 1);
  assert.equal(row.blockId, "review-api");
  assert.equal(row.needsId, false);
  assert.equal(row.status, "active");
  assert.equal(row.glyph, "[/]");
  assert.equal(row.group, "this-note");
  assert.equal(row.section, "Work");
  assert.equal(row.disabled, null);
  assert.ok(row.titleParts.some((part) => part.kind === "match" && part.text.toLowerCase().includes("review")));
  assert.ok(row.titleParts.some((part) => part.kind === "code" && part.text === "API"));
  assert.ok(row.titleParts.some((part) => part.kind === "link" && part.text === "manual"));
  const ref = session.rank("").rows.find((candidate) => candidate.blockId === "read-book");
  assert.equal(ref.taskKind, "ref");
  assert.equal(ref.status, "todo");
  session.close();
});

test("subjects precede duplicate/archive/read-only guards and unlinkable names stay first", () => {
  const files = {
    "dupes.md": "- [ ] #task First ^same\n- [ ] #task Second ^same",
    "done/Archived.md": "- [ ] #task Archived",
    "2026/20261121.md": "- [ ] #task Yesterday",
    "bad#path.md": "- [ ] #task Unlinkable ^same",
  };
  const harness = makeHarness({ files });
  const session = harness.api.open({
    subjects: [{ blockId: "same" }, { path: "done/Archived.md", line: 0 }],
  });
  const rows = session.rank("").rows;
  assert.equal(rows.find((row) => row.notePath === "dupes.md").disabled.short, "this prompt");
  assert.equal(rows.find((row) => row.notePath === "done/Archived.md").disabled.short, "this prompt");
  assert.equal(rows.find((row) => row.notePath === "2026/20261121.md").disabled.short, "read-only");
  assert.equal(rows.find((row) => row.notePath === "bad#path.md").disabled.short, "unlinkable");
  session.close();
});

test("snapshot ranks without vault reads, reports indexing, and relays index changes", () => {
  const harness = makeHarness({ files: { "Tasks.md": "- [ ] #task Write the API docs" } });
  harness.plugin.taskWikilinkIndex.progress = { ready: false, scanned: 2, total: 5 };
  const session = harness.api.open({});
  const readsAfterOpen = harness.readCalls;
  assert.deepEqual(session.rank("api").indexing, { done: 2, total: 5 });
  session.rank("write");
  assert.equal(harness.readCalls, readsAfterOpen, "rank must not read vault files");
  let change;
  session.onChange((event) => { change = event; });
  harness.plugin.taskWikilinkIndex.progress = { ready: true, scanned: 5, total: 5 };
  harness.plugin.taskWikilinkIndex.emitForced();
  assert.deepEqual(change, { indexing: null });
  session.close();
});

test("cached rows follow changing prompt subjects without an index refresh", () => {
  const harness = makeHarness({ files: { "Tasks.md": "- [ ] #task First\n- [ ] #task Second ^second" } });
  const subjects = [{ path: "Tasks.md", line: 0 }];
  const session = harness.api.open({ subjects: () => subjects });
  assert.equal(rowWithTitle(session, "First").disabled.short, "this prompt");
  assert.equal(rowWithTitle(session, "Second").disabled, null);
  subjects[0] = { blockId: "second" };
  assert.equal(rowWithTitle(session, "First").disabled, null);
  const second = rowWithTitle(session, "Second");
  assert.equal(second.disabled.short, "this prompt");
  assert.equal(session.linkFor(second), null);
  subjects.length = 0;
  assert.equal(rowWithTitle(session, "Second").disabled, null);
  session.close();
});

test("cached title spans agree with the editor across query changes and index refresh", () => {
  const title = "Review the `API` docs [[Guide|manual]]";
  const harness = makeHarness({ files: { "Tasks.md": `- [ ] #task ${title} ^review` } });
  const session = harness.api.open({});
  for (const query of ["", "api", "a api", "manual", "rev", "docs", "api"]) {
    const expected = helpers.taskWikilinkHighlightedTitleParts(title, query).flatMap((part) =>
      part.spans.filter((span) => span.text).map((span) => ({ text: span.text, kind: span.hl ? "match" : part.type })));
    assert.deepEqual(session.rank(query).rows[0].titleParts, expected, query);
  }
  harness.plugin.taskWikilinkIndex.ingestNote("Tasks.md", "- [ ] #task Changed ^review");
  harness.plugin.taskWikilinkIndex.emitForced();
  assert.equal(session.rank("api").total, 0);
  assert.equal(rowWithTitle(session, "Changed").blockId, "review");
  session.close();
});

test("session score buckets preserve editor ranking, including fuzzy matches and ties", () => {
  const files = {};
  const words = ["Train", "API", "éclair", "Boats", "planning", "alpha"];
  const statuses = [" ", "/", "*", "x", "-", "?"];
  for (let i = 0; i < 120; i += 1) {
    const notePath = `area-${i % 3}/Note-${i % 7}.md`;
    files[notePath] = (files[notePath] || "## Section\n") +
      `- [${statuses[i % statuses.length]}] #task ${words[i % words.length]} ${words[Math.floor(i / 6) % words.length]} ${i}${i % 3 ? ` ^task-${i}` : ""}\n`;
  }
  const harness = makeHarness({ files });
  for (const sourcePath of [null, "area-0/Note-0.md", "area-1/Note-1.md"]) {
    const session = harness.api.open({ sourcePath });
    const raw = harness.plugin.taskWikilinkIndex.rowsForPicker({ ownerPath: sourcePath });
    for (const query of ["", " ", "train", "API alpha", "t n", "écl", "plng", "12", "note-1", "task-7", "zzz", "section"]) {
      const expected = helpers.orderForWikilinkPicker(raw, query, sourcePath).map(helpers.taskWikilinkRowKey);
      assert.deepEqual(session.rank(query).rows.map((row) => row.key), expected, `${sourcePath}: ${query}`);
    }
    session.close();
  }
});

test("title parts keep their query and snapshot after later ranks and refresh", () => {
  const harness = makeHarness({ files: { "Tasks.md": "- [ ] #task Review `API` docs ^review" } });
  const session = harness.api.open({});
  const first = session.rank("api");
  for (const query of ["review", "docs", "r", "", "API docs"]) session.rank(query);
  harness.plugin.taskWikilinkIndex.ingestNote("Tasks.md", "- [ ] #task Changed ^review");
  harness.plugin.taskWikilinkIndex.emitForced();
  session.close();
  const serialized = JSON.parse(JSON.stringify(first));
  assert.deepEqual(serialized.rows[0].titleParts, [
    { text: "Review ", kind: "text" }, { text: "API", kind: "match" }, { text: " docs", kind: "text" },
  ]);
});

test("linkFor rechecks note resolution and falls back to the vault path", () => {
  const harness = makeHarness({
    files: { "folder/Tasks.md": "- [ ] #task Finish this ^finish" },
    resolveLink: () => ({ path: "elsewhere/Tasks.md" }),
  });
  const session = harness.api.open({ sourcePath: "Draft.md" });
  const row = rowWithTitle(session, "Finish this");
  assert.equal(session.linkFor(row), "[[folder/Tasks#^finish]]");
  assert.equal(session.linkFor({ ...row, blockId: null }), null);
  session.close();
});

test("suggestions reserve every block ID in the note and validate duplicates", async () => {
  const harness = makeHarness({
    files: {
      "Tasks.md": "Existing paragraph ^write-team-newsletter\n- [ ] #task Write team newsletter",
    },
  });
  const session = harness.api.open({});
  const row = rowWithTitle(session, "Write team newsletter");
  assert.equal(row.suggestedId, "write-team-newsletter-2");
  assert.deepEqual(await session.suggestions(row), ["write-team-newsletter-2"]);
  assert.equal(session.validate(row, "write-team-newsletter").short, "already in Tasks.md");
  assert.deepEqual(session.validate(row, "fresh-id"), { ok: true });
  session.close();
});

test("name writes the ID into an open editor after a preimage check", async () => {
  const original = "- [ ] #task Publish the API docs";
  const editor = createEditor(original);
  const harness = makeHarness({ files: { "Tasks.md": "stale disk" }, editors: [{ path: "Tasks.md", editor }] });
  // The index snapshot sees the live editor overlay, not the disk copy.
  const session = harness.api.open({ sourcePath: "Draft.md" });
  const row = rowWithTitle(session, "Publish the API docs");
  const result = await session.name(row, "publish-api-docs");
  assert.deepEqual(result, {
    ok: true,
    link: "[[Tasks#^publish-api-docs]]",
    notePath: "Tasks.md",
    id: "publish-api-docs",
  });
  assert.equal(editor.getValue(), "- [ ] #task Publish the API docs ^publish-api-docs");
  assert.equal(harness.processCalls, 0);
  session.close();
});

test("name writes a closed note through vault.process", async () => {
  const harness = makeHarness({ files: { "Tasks.md": "- [ ] #task Ship the feature" } });
  const session = harness.api.open({});
  const row = rowWithTitle(session, "Ship the feature");
  const result = await session.name(row, "ship-feature");
  assert.equal(result.ok, true);
  assert.equal(result.link, "[[Tasks#^ship-feature]]");
  assert.equal(harness.store["Tasks.md"], "- [ ] #task Ship the feature ^ship-feature");
  assert.equal(harness.processCalls, 1);
  session.close();
});

test("name refuses stale or ambiguously relocated rows", async (t) => {
  await t.test("changed task", async () => {
    const harness = makeHarness({ files: { "Tasks.md": "- [ ] #task Original title" } });
    const session = harness.api.open({});
    const row = rowWithTitle(session, "Original title");
    harness.store["Tasks.md"] = "- [ ] #task Edited title";
    const result = await session.name(row, "original-title");
    assert.equal(result.ok, false);
    assert.equal(result.stale, true);
    assert.match(result.message, /moved or changed/);
    session.close();
  });
  await t.test("ambiguous duplicate line after relocation", async () => {
    const content = "# One\n- [ ] #task Same task";
    const harness = makeHarness({ files: { "Tasks.md": content } });
    const session = harness.api.open({});
    const row = rowWithTitle(session, "Same task");
    harness.store["Tasks.md"] = "# One\nOther line\n- [ ] #task Same task\n- [ ] #task Same task";
    const result = await session.name(row, "same-task");
    assert.equal(result.ok, false);
    assert.equal(result.stale, true);
    session.close();
  });
});

test("name recognizes an already identified line and refuses duplicate IDs", async () => {
  const harness = makeHarness({ files: { "Tasks.md": "- [ ] #task Ready to ship" } });
  const session = harness.api.open({});
  const row = rowWithTitle(session, "Ready to ship");
  harness.store["Tasks.md"] = "- [ ] #task Ready to ship ^ready-to-ship";
  const already = await session.name(row, "ready-to-ship");
  assert.deepEqual(already, { ok: false, message: "The task already has a block ID", stale: true });
  assert.equal(session.rank("").rows[0].blockId, "ready-to-ship");
  session.close();

  const duplicateHarness = makeHarness({
    files: { "Tasks.md": "- [ ] #task Target task\nA paragraph ^taken" },
  });
  const duplicateSession = duplicateHarness.api.open({});
  const target = rowWithTitle(duplicateSession, "Target task");
  const result = await duplicateSession.name(target, "taken");
  assert.deepEqual(result, { ok: false, message: "^taken already exists in Tasks.md", stale: false });
  assert.equal(duplicateHarness.processCalls, 0);
  duplicateSession.close();
});

test("name refuses two open editors that disagree", async () => {
  const first = createEditor("- [ ] #task Pick the task");
  const second = createEditor("- [ ] #task Different live version");
  const harness = makeHarness({
    files: { "Tasks.md": "- [ ] #task Pick the task" },
    editors: [{ path: "Tasks.md", editor: first }, { path: "Tasks.md", editor: second }],
  });
  const session = harness.api.open({});
  const row = rowWithTitle(session, "Different live version");
  const result = await session.name(row, "pick-task");
  assert.equal(result.ok, false);
  assert.equal(result.message, "The note is open twice with different text");
  assert.equal(harness.processCalls, 0);
  session.close();
});

test("vault.process rechecks identity and duplicate IDs inside its callback", async (t) => {
  await t.test("identity changed before the atomic callback", async () => {
    const harness = makeHarness({
      files: { "Tasks.md": "- [ ] #task Stable task" },
      beforeProcess: () => "- [ ] #task Concurrently changed",
    });
    const session = harness.api.open({});
    const row = rowWithTitle(session, "Stable task");
    const result = await session.name(row, "stable-task");
    assert.equal(result.ok, false);
    assert.equal(harness.store["Tasks.md"], "- [ ] #task Concurrently changed");
    session.close();
  });
  await t.test("duplicate ID appeared before the atomic callback", async () => {
    const harness = makeHarness({
      files: { "Tasks.md": "- [ ] #task Stable task" },
      beforeProcess: () => "- [ ] #task Stable task\nAnother line ^raced-id",
    });
    const session = harness.api.open({});
    const row = rowWithTitle(session, "Stable task");
    const result = await session.name(row, "raced-id");
    assert.deepEqual(result, { ok: false, message: "^raced-id already exists in Tasks.md", stale: true });
    assert.match(harness.store["Tasks.md"], /\^raced-id/);
    assert.doesNotMatch(harness.store["Tasks.md"], /Stable task \^raced-id/);
    session.close();
  });
});

test("taskLinks lifecycle closes sessions and exposes a null-backed API on unload", () => {
  const harness = makeHarness({ files: { "Tasks.md": "- [ ] #task Keep me" } });
  const plugin = harness.plugin;
  plugin.addCommand = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.register = () => {};
  plugin.startTaskWikilinkIndex = () => {};
  plugin.onload();
  plugin.taskWikilinkIndex = harness.plugin.taskWikilinkIndex;
  const session = plugin.api.taskLinks.open({});
  assert.equal(session.rank("").total, 1);
  assert.ok(plugin.activeTaskLinksSessions.has(session));
  plugin.onunload();
  assert.deepEqual(session.rank(""), { rows: [], total: 0, indexing: null });
  const dead = plugin.api.taskLinks.open({});
  assert.deepEqual(dead.rank(""), { rows: [], total: 0, indexing: null });
  assert.equal(plugin.api.taskLinks.fieldAt("((x", 3), null);
});
