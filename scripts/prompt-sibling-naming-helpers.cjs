// Host-safety fixture (T11): "name a sibling task while a prompt is open".
//
// `((` in a prompt can name an ID-less task before linking it. That is the one
// vault write a prompt's field makes, and it happens while the host prompt is
// still open over its own pending write. This helper runs the REAL
// block-id-prompt `api.taskLinks` session (`session.name`) against the same
// editors and vault store the host under test reads, so a host test can
//
//   1. open the prompt (the host snapshots its note),
//   2. name an ID-less sibling in the subject's note through the API,
//   3. let the host submit, and
//   4. assert the host's write lands on the right line and never refuses
//      as stale.
//
// `subjects` is the host's own subject list, so the helper also proves the
// subject row stays disabled and that naming it is refused.
"use strict";

const assert = require("node:assert/strict");
const { Plugin, helpers } = require("./block-id-prompt-harness.cjs");

// An editor-like object only needs getValue / getLine / replaceRange (the
// editor primitives `session.name` uses for an open note).
// `files` is the host test's own vault store (`path -> text`): notes that are
// not open in an editor are written in place through `vault.process`, so the
// host under test sees the naming in its own reads. `editors` are the open
// buffers (`{ path, editor }`), whose text wins exactly as it does in bip.
function createSiblingNamer({ files = {}, editors = [], sourcePath = null, subjects = [], now } = {}) {
  const store = files;
  const buffers = new Map(editors.map(({ path, editor }) => [path, editor]));
  const textOf = (notePath) => (buffers.has(notePath)
    ? buffers.get(notePath).getValue()
    : Object.hasOwn(store, notePath) ? store[notePath] : null);
  const allPaths = [...new Set([...Object.keys(store), ...buffers.keys()])];
  const fileObjects = new Map(allPaths.map((notePath) => [notePath, {
    path: notePath,
    extension: "md",
    stat: { mtime: 1, size: String(textOf(notePath)).length },
  }]));
  const leaves = editors.map(({ path, editor }) => ({ view: { file: { path }, editor } }));
  const app = {
    workspace: { getLeavesOfType: () => leaves },
    vault: {
      getMarkdownFiles: () => [...fileObjects.values()],
      getAbstractFileByPath: (notePath) => fileObjects.get(notePath) || null,
      read: async (file) => textOf(file.path),
      cachedRead: async (file) => textOf(file.path),
      process: async (file, transform) => {
        const next = transform(store[file.path]);
        store[file.path] = next;
        file.stat = { mtime: file.stat.mtime + 1, size: String(next).length };
      },
      modify: async (file, content) => { store[file.path] = content; },
    },
    metadataCache: { getFirstLinkpathDest: (target) => ({ path: `${target}.md` }) },
  };
  const plugin = new Plugin();
  plugin.app = app;
  plugin.taskWikilinkIndex = new helpers.TaskWikilinkIndex();
  plugin.ensureTaskWikilinkIndex = () => plugin.taskWikilinkIndex;
  plugin.activeTaskLinksSessions = new Set();
  plugin.suppressEditorScans = () => {};
  plugin.now = () => (now instanceof Date ? now : new Date(2026, 10, 22, 14, 30));
  for (const notePath of allPaths) {
    plugin.taskWikilinkIndex.ingestNote(notePath, textOf(notePath), fileObjects.get(notePath).stat);
  }
  const api = helpers.createTaskLinksApi(plugin);
  const session = api.open({ sourcePath, subjects });

  function rowFor(titleIncludes) {
    const found = session.rank("").rows.find((row) =>
      row.titleParts.map((part) => part.text).join("").includes(titleIncludes));
    assert.ok(found, `expected a task row containing ${JSON.stringify(titleIncludes)}`);
    return found;
  }

  return {
    // The REAL `api.taskLinks` (v1) object, for hosts that feature-detect it
    // through `app.plugins.plugins["block-id-prompt"].api.taskLinks`.
    api,
    session,
    store,
    rowFor,
    // The subject row is shown but disabled, and naming it is refused.
    async assertSubjectGuarded(titleIncludes) {
      const row = rowFor(titleIncludes);
      assert.ok(row.disabled, `${titleIncludes} must be disabled as the prompt's subject`);
      assert.equal(row.disabled.full, "The task this prompt is about");
      assert.equal(row.disabled.short, "this prompt");
    },
    // Name an ID-less sibling exactly like the prompt's NAME stage does.
    async nameSibling(titleIncludes, id) {
      const row = rowFor(titleIncludes);
      assert.equal(row.needsId, true, `${titleIncludes} must be ID-less`);
      assert.equal(row.disabled, null, `${titleIncludes} must be nameable (not a subject)`);
      const result = await session.name(row, id);
      assert.equal(result.ok, true, `naming ${titleIncludes} failed: ${result.message}`);
      return result;
    },
    close() { session.close(); },
  };
}

// The line-stability premise every host fix rests on: naming a sibling edits
// that one line in place and never changes the line count or any other line.
function assertOneLineInPlace(before, after, siblingLine) {
  const left = String(before).split("\n");
  const right = String(after).split("\n");
  assert.equal(right.length, left.length, "naming never shifts line numbers");
  for (let index = 0; index < left.length; index += 1) {
    if (index === siblingLine) {
      assert.ok(right[index].startsWith(left[index].replace(/\s+$/u, "")), "the sibling keeps its text");
      assert.notEqual(right[index], left[index], "the sibling gained its ID");
    } else {
      assert.equal(right[index], left[index], `line ${index} is untouched`);
    }
  }
}

module.exports = { createSiblingNamer, assertOneLineInPlace };
