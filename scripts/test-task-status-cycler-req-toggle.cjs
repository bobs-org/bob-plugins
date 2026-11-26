// Ctrl+] note/req toggle (bob-cli-on.10.1.4): the cycler's Ctrl+] routes req
// lines and plain list items inside a #task block through the RW twin's
// taskReqToggle; everything else keeps today's checkbox-marker toggle.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TaskStatusCyclerPlugin,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  MarkdownView,
  notices,
  helpers,
} = require("./task-status-cycler-harness.cjs");

const { cyclerReqToggleFirstReqNotice, cyclerReqToggleKind, taskReqToggle } = helpers;

function makePlugin(path = "Daily.md") {
  notices.length = 0;
  const { app } = createInMemoryObsidianApp({ [path]: "" });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    ...app,
    workspace: {
      getActiveFile: () => ({ path }),
      getActiveViewOfType: () => null,
    },
    commands: { commands: {}, executeCommandById: () => false },
  };
  return plugin;
}

function viewFor(plugin, editor, path = "Daily.md") {
  const harness = { app: plugin.app };
  const attached = attachActiveMarkdownView(plugin, harness, editor, path);
  const view = Object.assign(new MarkdownView(), { editor, file: attached.file });
  plugin.app.workspace.getActiveViewOfType = () => view;
  return view;
}

function countingEditor(text, cursor) {
  const editor = createTextEditor(text, cursor);
  let calls = 0;
  const original = editor.replaceRange;
  editor.replaceRange = (...args) => {
    calls += 1;
    return original(...args);
  };
  editor.replaceRangeCalls = () => calls;
  return editor;
}

function press(text, cursor) {
  const plugin = makePlugin();
  const editor = countingEditor(text, cursor);
  const view = viewFor(plugin, editor);
  notices.length = 0;
  const handled = plugin.handleToggleCheckboxMarkerCommand(false, editor, view);
  return { plugin, editor, view, handled };
}

test("first note becoming a req scoops loose notes into NOTES with the notice", () => {
  const text = ["- [ ] #task Ship", "\t- loose a", "\t- loose b", "\t- note to req"].join("\n");
  const { editor, handled } = press(text, { line: 3, ch: 8 });
  assert.equal(handled, true);
  assert.equal(
    editor.getValue(),
    "- [ ] #task Ship\n\t- [ ] note to req\n\t- **Notes**\n\t\t- loose a\n\t\t- loose b",
  );
  assert.equal(editor.replaceRangeCalls(), 1);
  // Same offset into the item body: the caret sat 5 into "note to req", so
  // it lands 5 into the req text, after "\t- [ ] ".
  assert.deepEqual(editor.getCursor(), { line: 1, ch: 7 + 5 });
  assert.deepEqual(notices, ["◇ First requirement · filed 2 notes under NOTES"]);
});

test("first-req notice counts one note and none", () => {
  assert.equal(cyclerReqToggleFirstReqNotice(1), "◇ First requirement · filed 1 note under NOTES");
  assert.equal(cyclerReqToggleFirstReqNotice(2), "◇ First requirement · filed 2 notes under NOTES");
  assert.equal(cyclerReqToggleFirstReqNotice(0), "◇ First requirement");
  const text = ["- [ ] #task Ship", "\t- only note"].join("\n");
  const { editor } = press(text, { line: 1, ch: 4 });
  assert.equal(editor.getValue(), "- [ ] #task Ship\n\t- [ ] only note");
  // NOTES is born only when a note lands in it.
  assert.ok(!editor.getValue().includes("**Notes**"));
  assert.deepEqual(notices, ["◇ First requirement"]);
});

test("a later note becoming a req moves to the end of the reqs zone silently", () => {
  const text = ["- [ ] #task Ship", "\t- [ ] existing req", "\t- note to req", "\t- other note"].join("\n");
  const { editor } = press(text, { line: 2, ch: 5 });
  assert.equal(
    editor.getValue(),
    "- [ ] #task Ship\n\t- [ ] existing req\n\t- [ ] note to req\n\t- other note",
  );
  assert.equal(editor.getCursor().line, 2);
  assert.deepEqual(notices, []);
});

test("a nested note becomes a req in place", () => {
  const text = ["- [ ] #task Ship", "\t- [ ] req one", "\t\t- nested note"].join("\n");
  const { editor } = press(text, { line: 2, ch: 6 });
  assert.equal(editor.getValue(), "- [ ] #task Ship\n\t- [ ] req one\n\t\t- [ ] nested note");
  assert.equal(editor.replaceRangeCalls(), 1);
  assert.deepEqual(editor.getCursor(), { line: 2, ch: 6 + 4 });
  assert.deepEqual(notices, []);
});

test("a depth-1 req becomes a note filed into NOTES; a nested req in place", () => {
  const text = ["- [ ] #task Ship", "\t- [ ] req one", "\t- [ ] req two"].join("\n");
  const { editor } = press(text, { line: 1, ch: 8 });
  assert.equal(editor.getValue(), "- [ ] #task Ship\n\t- [ ] req two\n\t- **Notes**\n\t\t- req one");
  assert.equal(editor.replaceRangeCalls(), 1);
  assert.equal(editor.getCursor().line, 3);
  assert.deepEqual(notices, []);

  const nested = ["- [ ] #task Ship", "\t- [ ] req one", "\t\t- [ ] nested"].join("\n");
  const second = press(nested, { line: 2, ch: 10 });
  assert.equal(second.editor.getValue(), "- [ ] #task Ship\n\t- [ ] req one\n\t\t- nested");
  assert.deepEqual(second.editor.getCursor(), { line: 2, ch: 10 - 4 });
});

test("every writer refusal shows its message and writes nothing", () => {
  const cases = [
    {
      name: "note under another note",
      text: ["- [ ] #task Ship", "\t- note", "\t\t- deeper"].join("\n"),
      cursor: { line: 2, ch: 4 },
      message: "A requirement needs a task or requirement directly above it",
    },
    {
      name: "note in a drawer",
      text: ["- [ ] #task Ship", "\t- **Notes**", "\t\t- in drawer"].join("\n"),
      cursor: { line: 2, ch: 4 },
      message: "Drawers hold notes — put the requirement directly under the task",
    },
    {
      name: "the drawer title itself",
      text: ["- [ ] #task Ship", "\t- **Notes**", "\t\t- in drawer"].join("\n"),
      cursor: { line: 1, ch: 4 },
      message: "Only a note can become a requirement",
    },
    {
      name: "dropped req",
      text: ["- [ ] #task Ship", "\t- [-] old req"].join("\n"),
      cursor: { line: 1, ch: 6 },
      message: "Dropped — restore it first",
    },
    {
      name: "carried stub",
      text: ["- [ ] #task Ship", "\t- [>] Carried [[#^abc|Alias]]"].join("\n"),
      cursor: { line: 1, ch: 6 },
      message: "Carried — open the linked task",
    },
    {
      name: "req with nested reqs",
      text: ["- [ ] #task Ship", "\t- [ ] req one", "\t\t- [ ] nested"].join("\n"),
      cursor: { line: 1, ch: 6 },
      message: "“req one” has 1 nested requirement — carry it or toggle them first",
    },
  ];
  for (const entry of cases) {
    const { editor, handled } = press(entry.text, entry.cursor);
    assert.equal(handled, true, entry.name);
    assert.equal(editor.getValue(), entry.text, entry.name);
    assert.equal(editor.replaceRangeCalls(), 0, entry.name);
    assert.deepEqual(notices, [entry.message], entry.name);
  }
});

test("a note past the depth bound refuses", () => {
  const lines = ["- [ ] #task Ship"];
  for (let depth = 1; depth <= 16; depth += 1) {
    lines.push(`${"\t".repeat(depth)}- [ ] level ${depth}`);
  }
  lines.push(`${"\t".repeat(17)}- too deep note`);
  const text = lines.join("\n");
  const { editor } = press(text, { line: 17, ch: 20 });
  assert.equal(editor.getValue(), text);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Requirements nest at most 16 deep/);
});

test("the toggle refuses a stale preimage through the writer", () => {
  const text = ["- [ ] #task Ship", "\t- note"].join("\n");
  const result = taskReqToggle(text, { lineIndex: 1, preimage: "\t- other" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "req_stale");
  assert.equal(result.message, "The line changed — try again");
});

test("legacy Ctrl+] behavior is unchanged outside task blocks", () => {
  const plainItem = press(["- plain", "- other"].join("\n"), { line: 0, ch: 4 });
  assert.equal(plainItem.handled, true);
  assert.equal(plainItem.editor.getValue(), "- [ ] plain\n- other");
  assert.deepEqual(notices, []);

  const taskLine = press(["- [ ] #task Ship", "\t- [ ] #task Sub"].join("\n"), { line: 1, ch: 10 });
  assert.equal(taskLine.handled, true);
  assert.equal(taskLine.editor.getValue(), "- [ ] #task Ship\n\t- #task Sub");

  // A pasted checklist under a note is no req: the legacy toggle owns it.
  const pasted = press(["- [ ] #task Ship", "\t- note", "\t\t- [ ] pasted"].join("\n"), { line: 2, ch: 8 });
  assert.equal(pasted.handled, true);
  assert.equal(pasted.editor.getValue(), "- [ ] #task Ship\n\t- note\n\t\t- pasted");

  // A plain line with no list marker is not handled at all.
  const prose = press("just prose\n- [ ] #task Ship", { line: 0, ch: 2 });
  assert.equal(prose.handled, false);
  assert.equal(prose.editor.getValue(), "just prose\n- [ ] #task Ship");
});

test("fenced, frontmatter, and quoted lookalikes keep the legacy toggle", () => {
  const fenced = ["- [ ] #task Ship", "  - ```", "    - in fence", "    ```"].join("\n");
  assert.equal(cyclerReqToggleKind(fenced, 2), null);
  const frontmatter = ["---", "- note", "---", "- [ ] #task Ship", "\t- x"].join("\n");
  assert.equal(cyclerReqToggleKind(frontmatter, 1), null);
  const quoted = ["- [ ] #task Ship", "\t> - quoted"].join("\n");
  assert.equal(cyclerReqToggleKind(quoted, 1), null);
  assert.equal(cyclerReqToggleKind(["- [ ] #task Ship", "\t- note"].join("\n"), 1), "note");
  assert.equal(cyclerReqToggleKind(["- [ ] #task Ship", "\t- [ ] req"].join("\n"), 1), "req");
});

test("checking mode reports the route without writing", () => {
  const text = ["- [ ] #task Ship", "\t- note"].join("\n");
  const plugin = makePlugin();
  const editor = countingEditor(text, { line: 1, ch: 4 });
  const view = viewFor(plugin, editor);
  notices.length = 0;
  assert.equal(plugin.handleToggleCheckboxMarkerCommand(true, editor, view), true);
  assert.equal(editor.getValue(), text);
  assert.equal(editor.replaceRangeCalls(), 0);
  assert.deepEqual(notices, []);
});

test("Vim Ctrl+] routes through the same toggle", () => {
  const text = ["- [ ] #task Ship", "\t- loose", "\t- note to req"].join("\n");
  const plugin = makePlugin();
  const editor = countingEditor(text, { line: 2, ch: 4 });
  viewFor(plugin, editor);
  notices.length = 0;
  plugin.handleVimToggleCheckboxMarker();
  assert.equal(editor.getValue(), "- [ ] #task Ship\n\t- [ ] note to req\n\t- **Notes**\n\t\t- loose");
  assert.equal(editor.replaceRangeCalls(), 1);
  assert.deepEqual(notices, ["◇ First requirement · filed 1 note under NOTES"]);

  // A req toggles back through the Vim path too (depth 1 files into NOTES).
  const second = countingEditor(editor.getValue(), { line: 1, ch: 6 });
  viewFor(plugin, second);
  notices.length = 0;
  plugin.handleVimToggleCheckboxMarker();
  assert.match(second.getValue(), /\*\*Notes\*\*\n\t\t- loose\n\t\t- note to req/);
  assert.deepEqual(notices, []);
});

test("CRLF notes keep the toggle byte-safe through the writer", () => {
  const text = "- [ ] #task Ship\r\n\t- note\r\n";
  const result = taskReqToggle(text, { lineIndex: 1, preimage: "\t- note\r" });
  // The editor hands lines without endings; the writer refuses a stale CRLF
  // preimage instead of writing elsewhere.
  assert.equal(result.ok, false);
  const exact = taskReqToggle(text, { lineIndex: 1, preimage: "\t- note" });
  assert.equal(exact.ok, true);
  assert.equal(exact.updated, "- [ ] #task Ship\r\n\t- [ ] note\r\n");
});
