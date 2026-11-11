const test = require("node:test");
const assert = require("node:assert/strict");

const { helpers } = require("./navigation-hotkeys-harness.cjs");

const {
  COPY_CARD_BUILTIN_ROWS,
  COPY_CARD_RESERVED_KEYS,
  resolveCopyCardTask,
  parseCopyTemplate,
  renderCopyTemplate,
  buildCopyCardModel,
  resolveCopyCardKey,
  formatCopiedNotice,
  loadCopyCardTemplates,
  resetCopyCardTemplatesCache,
} = helpers;

const BRYAN_HOME = "/Users/bbugyi";
const BRYAN_VAULT = "/Users/bbugyi/bob";
const TASK_REF_TEMPLATE = "the ^{block_id} task in the {path}";

function cursor(line, ch = 0) {
  return [{ anchor: { line, ch }, head: { line, ch } }];
}

function selection(anchorLine, anchorCh, headLine, headCh) {
  return [
    {
      anchor: { line: anchorLine, ch: anchorCh },
      head: { line: headLine, ch: headCh },
    },
  ];
}

function readyTask(overrides = {}) {
  return {
    state: "ready",
    line: 0,
    blockId: "bank-records",
    title: "Use records to start tracking bank transactions",
    ...overrides,
  };
}

function bryanModel(overrides = {}) {
  return buildCopyCardModel({
    filePath: "bob.md",
    basePath: BRYAN_VAULT,
    homePath: BRYAN_HOME,
    task: readyTask(),
    templates: [
      { label: "Task ref", key: "t", template: TASK_REF_TEMPLATE },
    ],
    ...overrides,
  });
}

function row(model, id) {
  return model.rows.find((entry) => entry.id === id) || null;
}

function keyEvent(key, extras = {}) {
  return { key, ...extras };
}

function makeFs(contents, extras = {}) {
  const body = String(contents);
  const missing = extras.missing === true;
  const mtimeMs = extras.mtimeMs == null ? 10 : extras.mtimeMs;
  const size = extras.size == null ? body.length : extras.size;
  return {
    statSync() {
      if (missing) {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
      return { mtimeMs, size };
    },
    readFileSync() {
      if (missing) {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
      if (typeof extras.readError === "string") {
        throw new Error(extras.readError);
      }
      extras.reads = (extras.reads || 0) + 1;
      return body;
    },
  };
}

function loadTemplates(parsed, extras = {}) {
  resetCopyCardTemplatesCache();
  const calls = { parse: 0 };
  const result = loadCopyCardTemplates({
    configPath: extras.configPath || "/test/config.yml",
    fsModule: extras.fsModule || makeFs("copy:\n", extras.fs || {}),
    parseYaml: (text) => {
      calls.parse += 1;
      if (typeof extras.parseYaml === "function") {
        return extras.parseYaml(text);
      }
      if (extras.invalidYaml) {
        throw new Error("invalid");
      }
      return parsed;
    },
    env: extras.env || {},
    osModule: extras.osModule || { homedir: () => BRYAN_HOME },
  });
  result._calls = calls;
  return result;
}

test("builtin row table and reserved keys", () => {
  assert.deepEqual(
    COPY_CARD_BUILTIN_ROWS.map((entry) => entry.id),
    ["path", "absolute", "file", "note", "block-id"],
  );
  assert.deepEqual(COPY_CARD_RESERVED_KEYS, ["p", "a", "f", "n", "i"]);
  assert.equal(COPY_CARD_BUILTIN_ROWS[0].label, "Path");
  assert.equal(COPY_CARD_BUILTIN_ROWS[4].variable, "block_id");
  assert.ok(Object.isFrozen(COPY_CARD_BUILTIN_ROWS));
  assert.ok(Object.isFrozen(COPY_CARD_BUILTIN_ROWS[0]));
});

test("task rule: task line, child note, and Depends-On / LINKS child", () => {
  const lines = [
    "- [ ] #task Use records to start tracking bank transactions ^bank-records",
    "  - child note under the task",
    "  - ⛓️ **DEPENDS ON:** [[#^other]]",
    "  - 🪢 **LINKS:** see [[#^other]]",
    "",
    "plain prose",
  ];
  const onTask = resolveCopyCardTask(lines, cursor(0));
  assert.equal(onTask.state, "ready");
  assert.equal(onTask.line, 0);
  assert.equal(onTask.blockId, "bank-records");
  assert.equal(
    onTask.title,
    "Use records to start tracking bank transactions",
  );
  const onNote = resolveCopyCardTask(lines, cursor(1));
  assert.equal(onNote.state, "ready");
  assert.equal(onNote.line, 0);
  assert.equal(onNote.blockId, "bank-records");
  const onDepends = resolveCopyCardTask(lines, cursor(2));
  assert.equal(onDepends.state, "ready");
  assert.equal(onDepends.line, 0);
  const onLinks = resolveCopyCardTask(lines, cursor(3));
  assert.equal(onLinks.state, "ready");
  assert.equal(onLinks.line, 0);
  const onProse = resolveCopyCardTask(lines, cursor(5));
  assert.equal(onProse.state, "none");
  assert.equal(onProse.line, null);
});

test("task rule: closed checkbox still resolves", () => {
  const lines = ["- [x] #task Closed records ^bank-records"];
  const result = resolveCopyCardTask(lines, cursor(0));
  assert.equal(result.state, "ready");
  assert.equal(result.blockId, "bank-records");
  assert.equal(result.title, "Closed records");
});

test("task rule: task without ^id is no-id", () => {
  const lines = ["- [ ] #task Add event note to the recruiter Google event"];
  const result = resolveCopyCardTask(lines, cursor(0));
  assert.equal(result.state, "no-id");
  assert.equal(result.blockId, null);
  assert.equal(result.line, 0);
  assert.equal(result.title, "Add event note to the recruiter Google event");
});

test("task rule: cursor inside a code fence is none", () => {
  const lines = [
    "```",
    "- [ ] #task Inside fence ^fence-id",
    "```",
    "- [ ] #task Outside fence ^outside",
  ];
  const inside = resolveCopyCardTask(lines, cursor(1));
  assert.equal(inside.state, "none");
  const outside = resolveCopyCardTask(lines, cursor(3));
  assert.equal(outside.state, "ready");
  assert.equal(outside.blockId, "outside");
});

test("task rule: Pomodoro Task Link line is none", () => {
  const lines = [
    "- [ ] (09:00 - 09:25) — WORK",
    "  - [[other#^x|Some task]]",
  ];
  const onLink = resolveCopyCardTask(lines, cursor(1));
  assert.equal(onLink.state, "none");
  const onPomodoro = resolveCopyCardTask(lines, cursor(0));
  assert.equal(onPomodoro.state, "none");
});

test("task rule: two-task selection is none", () => {
  const lines = [
    "- [ ] #task First ^first",
    "  - child of first",
    "- [ ] #task Second ^second",
  ];
  const across = resolveCopyCardTask(lines, selection(0, 0, 2, 3));
  assert.equal(across.state, "none");
  const sameOwner = resolveCopyCardTask(lines, selection(0, 0, 1, 2));
  assert.equal(sameOwner.state, "ready");
  assert.equal(sameOwner.blockId, "first");
});

test("task rule: multiple selections are none", () => {
  const lines = ["- [ ] #task Only ^only"];
  assert.equal(resolveCopyCardTask(lines, []).state, "none");
  assert.equal(
    resolveCopyCardTask(lines, [
      { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
      { anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 1 } },
    ]).state,
    "none",
  );
});

test("grammar: {{ and }} are literal braces", () => {
  const literal = parseCopyTemplate("{{path}}");
  assert.equal(literal.ok, true);
  assert.deepEqual(literal.variables, []);
  assert.equal(renderCopyTemplate(literal.tokens, { path: "~/bob/bob.md" }), "{path}");

  const wrapped = parseCopyTemplate("{{" + "{path}" + "}}");
  assert.equal(wrapped.ok, true);
  assert.deepEqual(wrapped.variables, ["path"]);
  assert.equal(
    renderCopyTemplate(wrapped.tokens, { path: "~/bob/bob.md" }),
    "{~/bob/bob.md}",
  );
});

test("grammar: single pass does not rescan substituted values", () => {
  const parsed = parseCopyTemplate("{file_name}");
  assert.equal(parsed.ok, true);
  assert.equal(
    renderCopyTemplate(parsed.tokens, { file_name: "a{block_id}.md" }),
    "a{block_id}.md",
  );
});

test("grammar: unknown {task_id} hints {block_id}", () => {
  const parsed = parseCopyTemplate("the {task_id} task");
  assert.equal(parsed.ok, false);
  assert.equal(
    parsed.reason,
    "unknown {task_id} · did you mean {block_id}?",
  );
});

test("grammar: unknown {abs_file_with_tilde} hints {path}", () => {
  const parsed = parseCopyTemplate("{abs_file_with_tilde}");
  assert.equal(parsed.ok, false);
  assert.equal(
    parsed.reason,
    "unknown {abs_file_with_tilde} · did you mean {path}?",
  );
});

test("grammar: remaining aliases, nearest name, and valid-name list", () => {
  assert.equal(
    parseCopyTemplate("{abs_file}").reason,
    "unknown {abs_file} · did you mean {absolute_path}?",
  );
  assert.equal(
    parseCopyTemplate("{absolute}").reason,
    "unknown {absolute} · did you mean {absolute_path}?",
  );
  assert.equal(
    parseCopyTemplate("{basename}").reason,
    "unknown {basename} · did you mean {file_name}?",
  );
  assert.equal(
    parseCopyTemplate("{basename_no_ext}").reason,
    "unknown {basename_no_ext} · did you mean {note_name}?",
  );
  assert.equal(
    parseCopyTemplate("{stem}").reason,
    "unknown {stem} · did you mean {note_name}?",
  );
  assert.equal(
    parseCopyTemplate("{block_ref}").reason,
    "unknown {block_ref} · did you mean ^{block_id}?",
  );
  assert.equal(
    parseCopyTemplate("{paths}").reason,
    "unknown {paths} · did you mean {path}?",
  );
  assert.equal(
    parseCopyTemplate("{zzz}").reason,
    "unknown {zzz} · valid names: {path}, {absolute_path}, {file_name}, {note_name}, {block_id}",
  );
});

test("grammar: unmatched brace, empty template, mapping, and number", () => {
  assert.equal(
    parseCopyTemplate("hello {path").reason,
    "unmatched { at column 7",
  );
  assert.equal(parseCopyTemplate("").reason, "template is empty");
  assert.equal(parseCopyTemplate("   ").reason, "template is empty");
  assert.equal(
    parseCopyTemplate({ path: null }).reason,
    "quote the template — YAML read it as a mapping",
  );
  assert.equal(parseCopyTemplate(1).reason, "quote the template");
  assert.equal(parseCopyTemplate(true).reason, "quote the template");
});

test("grammar: multi-line template keeps newlines in value and ⏎ in preview", () => {
  const parsed = parseCopyTemplate("{note_name}\n{file_name}");
  assert.equal(parsed.ok, true);
  const value = renderCopyTemplate(parsed.tokens, {
    note_name: "bob",
    file_name: "bob.md",
  });
  assert.equal(value, "bob\nbob.md");
  const model = buildCopyCardModel({
    filePath: "bob.md",
    basePath: BRYAN_VAULT,
    homePath: BRYAN_HOME,
    task: { state: "none" },
    templates: [{ label: "Two lines", key: "w", template: "{note_name}\n{file_name}" }],
  });
  const templateRow = row(model, "template-1");
  assert.equal(templateRow.value, "bob\nbob.md");
  assert.equal(templateRow.preview, "bob⏎bob.md");
});

test("model: Bryan's Task ref template renders the exact clipboard string", () => {
  const model = bryanModel();
  assert.equal(model.title, "Copy");
  assert.equal(model.subtitle, "bob.md");
  assert.equal(row(model, "path").value, "~/bob/bob.md");
  assert.equal(row(model, "absolute").value, "/Users/bbugyi/bob/bob.md");
  assert.equal(row(model, "file").value, "bob.md");
  assert.equal(row(model, "note").value, "bob");
  assert.equal(row(model, "block-id").value, "^bank-records");
  const taskRef = row(model, "template-1");
  assert.equal(taskRef.label, "Task ref");
  assert.equal(taskRef.key, "t");
  assert.equal(
    taskRef.value,
    "the ^bank-records task in the ~/bob/bob.md",
  );
  assert.equal(taskRef.state, "ready");
  assert.equal(model.defaultRowId, "path");
  assert.equal(model.task.state, "ready");
  assert.ok(Object.isFrozen(model));
  assert.ok(Object.isFrozen(model.rows));
  assert.ok(Object.isFrozen(model.rows[0]));
});

test("model: vault outside home uses the absolute path for {path}", () => {
  const model = buildCopyCardModel({
    filePath: "bob.md",
    basePath: "/opt/vault",
    homePath: BRYAN_HOME,
    task: readyTask(),
    templates: [
      { label: "Task ref", key: "t", template: TASK_REF_TEMPLATE },
    ],
  });
  assert.equal(row(model, "path").value, "/opt/vault/bob.md");
  assert.equal(
    row(model, "template-1").value,
    "the ^bank-records task in the /opt/vault/bob.md",
  );
});

test("model: no base path dims path rows and defaults to File name", () => {
  const model = buildCopyCardModel({
    filePath: "bob.md",
    basePath: "",
    homePath: BRYAN_HOME,
    task: readyTask(),
    templates: [
      { label: "Task ref", key: "t", template: TASK_REF_TEMPLATE },
    ],
  });
  assert.equal(row(model, "path").state, "unavailable");
  assert.equal(row(model, "path").reason, "needs an absolute vault path");
  assert.equal(row(model, "path").value, null);
  assert.equal(row(model, "absolute").state, "unavailable");
  assert.equal(row(model, "file").state, "ready");
  assert.equal(row(model, "file").value, "bob.md");
  assert.equal(model.defaultRowId, "file");
  assert.equal(row(model, "template-1").state, "unavailable");
  assert.equal(row(model, "template-1").reason, "needs an absolute vault path");
});

test("model: TASK group hidden for none, dimmed for no-id, I copies ^id", () => {
  const noneModel = bryanModel({ task: { state: "none" } });
  assert.equal(row(noneModel, "block-id"), null);
  assert.equal(row(noneModel, "template-1"), null);
  assert.equal(noneModel.task.state, "none");
  assert.ok(noneModel.rows.every((entry) => entry.group === "file"));

  const noId = bryanModel({
    task: {
      state: "no-id",
      line: 0,
      blockId: null,
      title: "Add event note to the recruiter Google event",
    },
  });
  const idRow = row(noId, "block-id");
  assert.equal(idRow.state, "unavailable");
  assert.equal(
    idRow.reason,
    "none yet · Ctrl+6 on the task line names one",
  );
  assert.equal(idRow.value, null);
  const taskRef = row(noId, "template-1");
  assert.equal(taskRef.state, "unavailable");
  assert.equal(taskRef.reason, "needs a block ID");
  assert.equal(noId.task.title, "Add event note to the recruiter Google event");

  const ready = bryanModel();
  assert.equal(row(ready, "block-id").value, "^bank-records");
  assert.equal(row(ready, "block-id").state, "ready");
});

test("model: path previewParts split at the final slash", () => {
  const model = bryanModel();
  assert.deepEqual(row(model, "path").previewParts, {
    head: "~/bob/",
    tail: "bob.md",
  });
  assert.equal(row(model, "path").isPath, true);
  assert.deepEqual(row(model, "absolute").previewParts, {
    head: "/Users/bbugyi/bob/",
    tail: "bob.md",
  });
  assert.equal(row(model, "file").isPath, false);
});

test("model: file-only templates stay visible without a task", () => {
  const model = buildCopyCardModel({
    filePath: "bob.md",
    basePath: BRYAN_VAULT,
    homePath: BRYAN_HOME,
    task: { state: "none" },
    templates: [
      { label: "Wiki link", template: "[[{note_name}]]" },
      { label: "Task ref", key: "t", template: TASK_REF_TEMPLATE },
    ],
  });
  assert.equal(row(model, "template-1").value, "[[bob]]");
  assert.equal(row(model, "template-1").key, "1");
  assert.equal(row(model, "template-2"), null);
});

test("model: row order is file builtins, file templates, then TASK group", () => {
  const model = buildCopyCardModel({
    filePath: "notes/bob.md",
    basePath: BRYAN_VAULT,
    homePath: BRYAN_HOME,
    task: readyTask(),
    templates: [
      { label: "Task ref", key: "t", template: TASK_REF_TEMPLATE },
      { label: "Wiki link", template: "[[{note_name}]]" },
    ],
  });
  assert.deepEqual(
    model.rows.map((entry) => entry.id),
    ["path", "absolute", "file", "note", "template-2", "block-id", "template-1"],
  );
  assert.equal(model.subtitle, "notes/bob.md");
});

test("keys: letters are case-insensitive", () => {
  const model = bryanModel();
  const ui = { highlightId: "path", busy: false };
  assert.deepEqual(resolveCopyCardKey(model, keyEvent("p"), ui), {
    type: "copy",
    rowId: "path",
  });
  assert.deepEqual(resolveCopyCardKey(model, keyEvent("P"), ui), {
    type: "copy",
    rowId: "path",
  });
  assert.deepEqual(resolveCopyCardKey(model, keyEvent("t"), ui), {
    type: "copy",
    rowId: "template-1",
  });
  assert.deepEqual(resolveCopyCardKey(model, keyEvent("T"), ui), {
    type: "copy",
    rowId: "template-1",
  });
});

test("keys: Shift+letter, repeats, IME, and other modified chords are ignored", () => {
  const model = bryanModel();
  const ui = { highlightId: "path", busy: false };
  assert.equal(
    resolveCopyCardKey(model, keyEvent("P", { shiftKey: true }), ui),
    null,
  );
  assert.equal(
    resolveCopyCardKey(model, keyEvent("p", { repeat: true }), ui),
    null,
  );
  assert.equal(
    resolveCopyCardKey(model, keyEvent("p", { isComposing: true }), ui),
    null,
  );
  assert.equal(
    resolveCopyCardKey(model, keyEvent("p", { keyCode: 229 }), ui),
    null,
  );
  assert.equal(
    resolveCopyCardKey(model, keyEvent("p", { altKey: true }), ui),
    null,
  );
  assert.equal(
    resolveCopyCardKey(model, keyEvent("f", { ctrlKey: true }), ui),
    null,
  );
  assert.equal(
    resolveCopyCardKey(model, keyEvent("p", { metaKey: true }), ui),
    null,
  );
  assert.equal(resolveCopyCardKey(model, keyEvent("Shift"), ui), null);
});

test("keys: Ctrl+N/Ctrl+P and arrows wrap and skip uncopyable rows", () => {
  const model = bryanModel({
    task: {
      state: "no-id",
      line: 0,
      blockId: null,
      title: "No id yet",
    },
    templates: [
      { label: "Wiki link", template: "[[{note_name}]]" },
      { label: "Task ref", key: "t", template: TASK_REF_TEMPLATE },
    ],
  });
  const copyable = model.rows.filter(
    (entry) => entry.state === "ready" || entry.state === "collision",
  );
  assert.ok(row(model, "block-id").state === "unavailable");
  const last = copyable[copyable.length - 1];
  const ui = { highlightId: last.id, busy: false };
  const down = resolveCopyCardKey(model, keyEvent("ArrowDown"), ui);
  assert.equal(down.type, "move");
  assert.equal(down.rowId, "path");
  const ctrlN = resolveCopyCardKey(
    model,
    keyEvent("n", { ctrlKey: true }),
    ui,
  );
  assert.equal(ctrlN.rowId, "path");
  const up = resolveCopyCardKey(
    model,
    keyEvent("ArrowUp"),
    { highlightId: "path", busy: false },
  );
  assert.equal(up.type, "move");
  assert.equal(up.rowId, last.id);
  const ctrlP = resolveCopyCardKey(
    model,
    keyEvent("p", { ctrlKey: true }),
    { highlightId: "path", busy: false },
  );
  assert.equal(ctrlP.rowId, last.id);
  const fromDimmed = resolveCopyCardKey(
    model,
    keyEvent("ArrowDown"),
    { highlightId: "block-id", busy: false },
  );
  assert.equal(fromDimmed.type, "move");
  assert.notEqual(fromDimmed.rowId, "block-id");
  assert.equal(row(model, fromDimmed.rowId).state === "unavailable", false);
});

test("keys: Enter copies the highlighted row", () => {
  const model = bryanModel();
  assert.deepEqual(
    resolveCopyCardKey(
      model,
      keyEvent("Enter"),
      { highlightId: "note", busy: false },
    ),
    { type: "copy", rowId: "note" },
  );
});

test("keys: dimmed row key is refused", () => {
  const model = bryanModel({
    task: {
      state: "no-id",
      line: 0,
      blockId: null,
      title: "No id yet",
    },
  });
  const action = resolveCopyCardKey(
    model,
    keyEvent("i"),
    { highlightId: "path", busy: false },
  );
  assert.equal(action.type, "refuse");
  assert.equal(action.rowId, "block-id");
  assert.equal(
    action.reason,
    "none yet · Ctrl+6 on the task line names one",
  );
});

test("keys: reserved key whose row is hidden is consumed", () => {
  const model = bryanModel({ task: { state: "none" } });
  assert.equal(row(model, "block-id"), null);
  assert.deepEqual(
    resolveCopyCardKey(
      model,
      keyEvent("i"),
      { highlightId: "path", busy: false },
    ),
    { type: "consume" },
  );
  assert.equal(
    resolveCopyCardKey(
      model,
      keyEvent("x"),
      { highlightId: "path", busy: false },
    ),
    null,
  );
});

test("keys: digit keys default by position and explicit keys work", () => {
  const model = buildCopyCardModel({
    filePath: "bob.md",
    basePath: BRYAN_VAULT,
    homePath: BRYAN_HOME,
    task: { state: "none" },
    templates: [
      { label: "Wiki link", template: "[[{note_name}]]" },
      { label: "Stem", key: "s", template: "{note_name}" },
    ],
  });
  assert.equal(row(model, "template-1").key, "1");
  assert.equal(row(model, "template-2").key, "s");
  const ui = { highlightId: "path", busy: false };
  assert.deepEqual(resolveCopyCardKey(model, keyEvent("1"), ui), {
    type: "copy",
    rowId: "template-1",
  });
  assert.deepEqual(resolveCopyCardKey(model, keyEvent("s"), ui), {
    type: "copy",
    rowId: "template-2",
  });
});

test("keys: entries past the ninth are keyless with add key: to bind", () => {
  const templates = [];
  for (let index = 0; index < 10; index += 1) {
    templates.push({
      label: `Row ${index + 1}`,
      template: `{note_name}-${index + 1}`,
    });
  }
  const loaded = loadTemplates({ copy: { templates } });
  assert.equal(loaded.templates[0].key, "1");
  assert.equal(loaded.templates[8].key, "9");
  assert.equal(loaded.templates[9].key, null);
  assert.equal(loaded.templates[9].reason, "add key: to bind");
  assert.equal(loaded.templates[9].state, "ready");
  const model = buildCopyCardModel({
    filePath: "bob.md",
    basePath: BRYAN_VAULT,
    homePath: BRYAN_HOME,
    task: { state: "none" },
    templates,
  });
  const tenth = row(model, "template-10");
  assert.equal(tenth.key, null);
  assert.equal(tenth.state, "ready");
  assert.equal(tenth.value, "bob-10");
});

test("keys: reserved and duplicate collisions are keyless but copyable", () => {
  const templates = [
    { label: "Wiki link", key: "p", template: "[[{note_name}]]" },
    { label: "Also wiki", key: "w", template: "[[{file_name}]]" },
    { label: "Twin", key: "w", template: "{note_name}" },
  ];
  const loaded = loadTemplates({ copy: { templates } });
  assert.equal(loaded.templates[0].key, null);
  assert.equal(loaded.templates[0].state, "collision");
  assert.equal(loaded.templates[0].reason, "key p is Path's");
  assert.equal(loaded.templates[1].key, null);
  assert.equal(loaded.templates[1].state, "collision");
  assert.equal(loaded.templates[1].reason, "key w is also Twin's");
  assert.equal(loaded.templates[2].key, null);
  assert.equal(loaded.templates[2].reason, "key w is also Also wiki's");
  const configuredModel = buildCopyCardModel({
    filePath: "bob.md",
    basePath: BRYAN_VAULT,
    homePath: BRYAN_HOME,
    task: { state: "none" },
    templates: loaded.templates,
  });
  const configuredCollision = row(configuredModel, "template-1");
  assert.equal(configuredCollision.state, "collision");
  assert.equal(configuredCollision.key, null);
  assert.equal(configuredCollision.value, "[[bob]]");
  const model = buildCopyCardModel({
    filePath: "bob.md",
    basePath: BRYAN_VAULT,
    homePath: BRYAN_HOME,
    task: { state: "none" },
    templates,
  });
  const collidingPath = row(model, "template-1");
  assert.equal(collidingPath.state, "collision");
  assert.equal(collidingPath.key, null);
  assert.equal(collidingPath.value, "[[bob]]");
  const ui = { highlightId: collidingPath.id, busy: false };
  assert.deepEqual(resolveCopyCardKey(model, keyEvent("Enter"), ui), {
    type: "copy",
    rowId: "template-1",
  });
  assert.deepEqual(
    resolveCopyCardKey(model, keyEvent("p"), { highlightId: "file", busy: false }),
    { type: "copy", rowId: "path" },
  );
});

test("keys: busy consumes every key", () => {
  const model = bryanModel();
  const ui = { highlightId: "path", busy: true };
  assert.deepEqual(resolveCopyCardKey(model, keyEvent("p"), ui), {
    type: "consume",
  });
  assert.deepEqual(resolveCopyCardKey(model, keyEvent("Enter"), ui), {
    type: "consume",
  });
  assert.deepEqual(resolveCopyCardKey(model, keyEvent("Escape"), ui), {
    type: "consume",
  });
  assert.deepEqual(
    resolveCopyCardKey(model, keyEvent("y", { metaKey: true }), ui),
    { type: "consume" },
  );
});

test("keys: Mod+Y copies the highlighted row (cmd_y_twice)", () => {
  const model = bryanModel();
  const ui = { highlightId: "note", busy: false };
  assert.deepEqual(
    resolveCopyCardKey(model, keyEvent("y", { metaKey: true }), ui),
    { type: "copy", rowId: "note" },
  );
  assert.deepEqual(
    resolveCopyCardKey(model, keyEvent("Y", { ctrlKey: true }), ui),
    { type: "copy", rowId: "note" },
  );
  assert.equal(
    resolveCopyCardKey(
      model,
      keyEvent("y", { metaKey: true, repeat: true }),
      ui,
    ),
    null,
  );
  assert.deepEqual(resolveCopyCardKey(model, keyEvent("Escape"), ui), {
    type: "close",
  });
});

test("keys: YAML number 1 is the digit key", () => {
  const loaded = loadTemplates({
    copy: {
      templates: [{ label: "Wiki link", key: 1, template: "[[{note_name}]]" }],
    },
  });
  assert.equal(loaded.templates[0].key, "1");
});

test("copied notice middle-truncates and shows newlines as ⏎", () => {
  assert.equal(formatCopiedNotice("hello"), "Copied hello");
  assert.equal(formatCopiedNotice("a\nb"), "Copied a⏎b");
  const long = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const notice = formatCopiedNotice(long);
  assert.ok(notice.startsWith("Copied "));
  const value = notice.slice("Copied ".length);
  assert.equal(value.length, 60);
  assert.ok(value.includes("…"));
  assert.ok(value.startsWith("abcdefghijklmnopqrstuvwxyz012"));
  assert.ok(value.endsWith("HIJKLMNOPQRSTUVWXYZ"));
});

test("config: missing file, missing copy, and empty list yield no rows", () => {
  resetCopyCardTemplatesCache();
  const missing = loadCopyCardTemplates({
    configPath: "/missing.yml",
    fsModule: makeFs("", { missing: true }),
    parseYaml: () => {
      throw new Error("should not parse");
    },
  });
  assert.deepEqual(missing.templates, []);
  assert.equal(missing.diagnostic, undefined);

  const noCopy = loadTemplates({ other: true });
  assert.deepEqual(noCopy.templates, []);
  assert.equal(noCopy.diagnostic, undefined);

  const empty = loadTemplates({ copy: { templates: [] } });
  assert.deepEqual(empty.templates, []);
  assert.equal(empty.diagnostic, undefined);

  const noTemplatesKey = loadTemplates({ copy: {} });
  assert.deepEqual(noTemplatesKey.templates, []);
});

test("config: invalid YAML, non-mapping copy, and non-list templates diagnose", () => {
  const invalid = loadTemplates({}, { invalidYaml: true });
  assert.deepEqual(invalid.templates, []);
  assert.equal(invalid.diagnostic, "could not parse copy.templates");

  const notMapping = loadTemplates({ copy: ["nope"] });
  assert.equal(notMapping.diagnostic, "copy must be a mapping");
  assert.deepEqual(notMapping.templates, []);

  const notList = loadTemplates({ copy: { templates: { label: "x" } } });
  assert.equal(notList.diagnostic, "copy.templates must be a list");

  const model = buildCopyCardModel({
    filePath: "bob.md",
    basePath: BRYAN_VAULT,
    homePath: BRYAN_HOME,
    task: { state: "none" },
    templates: [],
    diagnostic: notList.diagnostic,
  });
  const diagnosticRow = row(model, "diagnostic");
  assert.equal(diagnosticRow.state, "error");
  assert.equal(diagnosticRow.reason, "copy.templates must be a list");
  assert.equal(row(model, "path").state, "ready");
});

test("config: mapping and number templates, blank label, and non-mapping entry", () => {
  const loaded = loadTemplates({
    copy: {
      templates: [
        { label: "Wiki link", template: { path: null } },
        { label: "Count", template: 12 },
        { template: "[[{note_name}]]" },
        "not a mapping",
      ],
    },
  });
  assert.equal(loaded.templates[0].state, "error");
  assert.equal(
    loaded.templates[0].reason,
    "quote the template — YAML read it as a mapping",
  );
  assert.equal(loaded.templates[1].reason, "quote the template");
  assert.equal(loaded.templates[2].label, "Template 3");
  assert.equal(loaded.templates[2].reason, "add a label");
  assert.equal(loaded.templates[2].state, "error");
  assert.equal(loaded.templates[3].reason, "expected label and template");
});

test("config: cache hits until mtime or size changes", () => {
  resetCopyCardTemplatesCache();
  const parsed = {
    copy: {
      templates: [{ label: "Wiki link", template: "[[{note_name}]]" }],
    },
  };
  let parseCount = 0;
  const parseYaml = () => {
    parseCount += 1;
    return parsed;
  };
  const firstFs = makeFs("copy:\n", { mtimeMs: 10, size: 8 });
  const first = loadCopyCardTemplates({
    configPath: "/cache.yml",
    fsModule: firstFs,
    parseYaml,
  });
  assert.equal(first.templates.length, 1);
  assert.equal(parseCount, 1);
  const second = loadCopyCardTemplates({
    configPath: "/cache.yml",
    fsModule: makeFs("copy:\n", { mtimeMs: 10, size: 8 }),
    parseYaml,
  });
  assert.equal(parseCount, 1);
  assert.equal(second.templates[0].label, "Wiki link");
  const mtimeChanged = loadCopyCardTemplates({
    configPath: "/cache.yml",
    fsModule: makeFs("copy:\n", { mtimeMs: 11, size: 8 }),
    parseYaml,
  });
  assert.equal(parseCount, 2);
  assert.equal(mtimeChanged.templates.length, 1);
  const sizeChanged = loadCopyCardTemplates({
    configPath: "/cache.yml",
    fsModule: makeFs("copy:\n  templates: []\n", { mtimeMs: 11, size: 99 }),
    parseYaml,
  });
  assert.equal(parseCount, 3);
  assert.equal(sizeChanged.templates.length, 1);
});

test("config: loader never throws on unreadable files", () => {
  resetCopyCardTemplatesCache();
  const fsModule = {
    statSync() {
      return { mtimeMs: 1, size: 1 };
    },
    readFileSync() {
      throw new Error("EACCES");
    },
  };
  const result = loadCopyCardTemplates({
    configPath: "/denied.yml",
    fsModule,
    parseYaml: () => ({}),
  });
  assert.deepEqual(result.templates, []);
  assert.equal(result.diagnostic, "could not read copy.templates");
});

test("renderCopyTemplate returns null when a value is missing", () => {
  const parsed = parseCopyTemplate(TASK_REF_TEMPLATE);
  assert.equal(
    renderCopyTemplate(parsed.tokens, {
      block_id: "bank-records",
      path: null,
    }),
    null,
  );
  assert.equal(
    renderCopyTemplate(parsed.tokens, {
      block_id: "bank-records",
      path: "~/bob/bob.md",
    }),
    "the ^bank-records task in the ~/bob/bob.md",
  );
});
