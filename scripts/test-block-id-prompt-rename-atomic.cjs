const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  helpers,
  noticeMessages,
  noticeCalls,
  resetNotices,
  createTFile,
  createMarkdownView,
} = require("./block-id-prompt-harness.cjs");

// ---------------------------------------------------------------------------
// Block-ID rename atomicity (plan 202611/lost_task_guards.md, rename_atomic):
// one editor transaction per open note, compare-and-swap for closed notes,
// and an undone rename followed into the other notes it rewrote.
// ---------------------------------------------------------------------------

const pendingTimers = [];
global.window = global.window || {};
global.window.setTimeout = (fn) => {
  pendingTimers.push(fn);
  return pendingTimers.length;
};
global.window.clearTimeout = () => {};

const BOB = "bob.md";
const DAILY = "daily.md";
const DONE = "done/bob_done.md";

function bobNote(id) {
  return [
    "# Bob",
    "- [ ] #task Gmail sync ^gmail-sync",
    `  - 🧱 **BLOCKS:** [[bob#^${id}]]`,
    "",
    "Filler paragraph.",
    "",
    `- [*] #task Auto-label emails ^${id}`,
    "",
  ].join("\n");
}

function dailyNote(id) {
  return ["## Pomodoros", "- [ ] BUILD (10:00-10:30)", `  - [[bob#^${id}]]`, ""].join("\n");
}

function doneNote(id) {
  return ["- [x] #task Untracked poms ^untracked-poms", `  - 🧱 **BLOCKS:** [[bob#^${id}]]`, ""].join("\n");
}

function positionToIndex(value, position) {
  const lines = value.split("\n");
  let index = 0;
  for (let line = 0; line < position.line; line += 1) {
    index += lines[line].length + 1;
  }
  return index + position.ch;
}

// An editor double with CM6-like history grouping: every `transaction` call
// and every `replaceRange` call is its own undo event, exactly the property
// the real-Obsidian e2e measures.
function createHistoryEditor(content) {
  let value = content;
  const undoStack = [];
  const redoStack = [];
  const editor = {
    cm: {},
    transactions: [],
    replaceCalls: 0,
    getValue: () => value,
    getLine: (line) => value.split("\n")[line] || "",
    getCursor: () => ({ line: 0, ch: 0 }),
    setCursor() {},
    listSelections: () => [],
    replaceRange(text, from, to = from) {
      undoStack.push(value);
      redoStack.length = 0;
      editor.replaceCalls += 1;
      const start = positionToIndex(value, from);
      const end = positionToIndex(value, to);
      value = value.slice(0, start) + text + value.slice(end);
    },
    transaction({ changes }) {
      undoStack.push(value);
      redoStack.length = 0;
      editor.transactions.push(changes);
      const planned = changes
        .map((change) => ({
          start: positionToIndex(value, change.from),
          end: positionToIndex(value, change.to || change.from),
          text: change.text,
        }))
        .sort((left, right) => right.start - left.start);
      for (const change of planned) {
        value = value.slice(0, change.start) + change.text + value.slice(change.end);
      }
    },
    undo() {
      redoStack.push(value);
      value = undoStack.pop();
    },
    redo() {
      undoStack.push(value);
      value = redoStack.pop();
    },
    type(text) {
      undoStack.push(value);
      redoStack.length = 0;
      value += text;
    },
  };
  return editor;
}

function createWorld({ files, open = [], active = BOB }) {
  resetNotices();
  pendingTimers.length = 0;
  const store = { ...files };
  const tfiles = {};
  const fileFor = (path) => {
    if (!(path in store)) {
      return null;
    }
    tfiles[path] = tfiles[path] || createTFile(path);
    return tfiles[path];
  };
  const editors = {};
  for (const path of open) {
    editors[path] = createHistoryEditor(store[path]);
  }
  const calls = { process: [], modify: [], hooks: {} };
  const leaves = () =>
    Object.entries(editors).map(([path, editor]) => {
      const view = createMarkdownView(fileFor(path));
      view.editor = editor;
      return { view };
    });
  const plugin = new Plugin();
  plugin.app = {
    workspace: {
      getLeavesOfType: () => leaves(),
      getActiveViewOfType: () => null,
      getActiveFile: () => fileFor(active),
    },
    vault: {
      getAbstractFileByPath: (path) => fileFor(path),
      read: async (file) => store[file.path],
      modify: async (file, content) => {
        calls.modify.push(file.path);
        store[file.path] = content;
      },
      process: async (file, transform) => {
        calls.process.push(file.path);
        if (calls.hooks.beforeProcess) {
          calls.hooks.beforeProcess(file.path);
        }
        const next = transform(store[file.path]);
        store[file.path] = next;
        return next;
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (linkText) => {
        const stem = String(linkText).replace(/\.md$/u, "");
        const path = Object.keys(store).find((candidate) => candidate.replace(/\.md$/u, "") === stem);
        return path ? fileFor(path) : null;
      },
      resolvedLinks: Object.fromEntries(
        Object.keys(files)
          .filter((path) => path !== BOB)
          .map((path) => [path, { [BOB]: 1 }]),
      ),
    },
  };
  plugin.suppressEditorScans = () => {};
  let clock = new Date(2026, 10, 9, 6, 49, 53);
  plugin.now = () => clock;
  return {
    plugin,
    store,
    editors,
    calls,
    advance: (ms) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

function textOf(world, path) {
  return world.editors[path] ? world.editors[path].getValue() : world.store[path];
}

function renameSource(world, oldId) {
  const editor = world.editors[BOB];
  const content = editor.getValue();
  const lines = content.split("\n");
  const line = lines.findIndex((text) => text.endsWith(`^${oldId}`) && text.includes("#task"));
  const startCh = lines[line].lastIndexOf(`^${oldId}`);
  return {
    kind: "direct-rename",
    editor,
    sourcePath: BOB,
    targetText: "",
    oldId,
    aliasSuffix: "",
    blockPrefix: "#^",
    line,
    startCh,
    endCh: startCh + oldId.length + 1,
    raw: `^${oldId}`,
    prefillId: true,
  };
}

async function renameBob(world, oldId, newId) {
  return world.plugin.submitBlockId(renameSource(world, oldId), newId);
}

// Deliver the editor update an edit of `path` produces, then let the
// debounced follow run.
async function deliverUpdate(world, path) {
  pendingTimers.length = 0;
  world.plugin.noteBlockRenameUpdate({ docChanged: true, view: world.editors[path].cm });
  assert.equal(pendingTimers.length, 1, `an edit of ${path} schedules one follow check`);
  await world.plugin.runBlockRenameFollow();
}

function threeNotes(options = {}) {
  return createWorld({
    files: { [BOB]: bobNote("old"), [DAILY]: dailyNote("old"), [DONE]: doneNote("old") },
    open: [BOB, ...(options.open || [])],
  });
}

test("a rename writes each open note as one editor transaction and undoes in one step", async () => {
  const world = threeNotes();

  assert.equal(await renameBob(world, "old", "new"), true);

  const bob = world.editors[BOB];
  assert.equal(bob.transactions.length, 1);
  assert.equal(bob.transactions[0].length, 2, "the same-note link and the ^id share one transaction");
  assert.equal(bob.replaceCalls, 0);
  assert.equal(bob.getValue(), bobNote("new"));
  assert.equal(world.store[DAILY], dailyNote("new"));
  assert.equal(world.store[DONE], doneNote("new"));
  assert.deepEqual(world.calls.modify, []);
  assert.deepEqual(world.calls.process, [DAILY, DONE]);
  assert.equal(noticeMessages[noticeMessages.length - 1], "Renamed block ID and updated 3 links");

  bob.undo();
  assert.equal(bob.getValue(), bobNote("old"), "one undo reverts the id and the same-note link");
});

test("a note open in a non-active leaf is edited through its editor, unsaved text included", async () => {
  const world = threeNotes({ open: [DAILY] });
  world.editors[DAILY].type("- typed but not saved yet\n");
  const unsaved = world.editors[DAILY].getValue();
  assert.notEqual(unsaved, world.store[DAILY]);

  assert.equal(await renameBob(world, "old", "new"), true);

  const daily = world.editors[DAILY];
  assert.equal(daily.transactions.length, 1);
  assert.equal(daily.replaceCalls, 0, "the rename never falls back to replaceRange");
  assert.equal(daily.getValue(), `${dailyNote("new")}- typed but not saved yet\n`);
  assert.deepEqual(world.calls.process, [DONE], "only the closed note uses vault.process");
  assert.equal(world.store[DAILY], dailyNote("old"), "the editor owns the open note's disk write");
});

test("disagreeing open buffers for one note refuse the rename", async () => {
  const world = threeNotes({ open: [DAILY] });
  const second = createHistoryEditor(`${dailyNote("old")}other buffer\n`);
  const leaves = world.plugin.app.workspace.getLeavesOfType;
  world.plugin.app.workspace.getLeavesOfType = () => {
    const view = createMarkdownView(createTFile(DAILY));
    view.editor = second;
    return [...leaves(), { view }];
  };

  assert.equal(await renameBob(world, "old", "new"), false, "refused while planning");

  assert.equal(world.editors[BOB].getValue(), bobNote("old"));
  assert.equal(world.store[DONE], doneNote("old"));
  assert.deepEqual(world.calls.process, []);
  assert.match(noticeMessages[noticeMessages.length - 1], /daily\.md changed before rewrite/);
});

test("a closed note that changed since planning refuses and earlier writes roll back", async () => {
  const world = threeNotes();
  world.calls.hooks.beforeProcess = (path) => {
    if (path === DONE) {
      world.store[DONE] = `${doneNote("old")}- concurrent sync pull\n`;
    }
  };

  assert.equal(await renameBob(world, "old", "new"), true);

  assert.equal(world.store[DAILY], dailyNote("old"), "the daily note write was rolled back");
  assert.equal(world.store[DONE], `${doneNote("old")}- concurrent sync pull\n`, "the changed note is kept");
  assert.equal(world.editors[BOB].transactions.length, 0, "no open note was touched");
  assert.equal(world.editors[BOB].getValue(), bobNote("old"));
  assert.ok(noticeMessages.includes(`Block ID rename blocked: ${DONE} changed before rewrite`));
});

test("an open note that changed while closed notes were written refuses and rolls back", async () => {
  const world = threeNotes();
  const originalWrite = world.plugin.writeClosedRenameTarget.bind(world.plugin);
  let typed = false;
  world.plugin.writeClosedRenameTarget = async (target) => {
    const outcome = await originalWrite(target);
    if (!typed) {
      typed = true;
      world.editors[BOB].type("half-typed bullet");
    }
    return outcome;
  };

  assert.equal(await renameBob(world, "old", "new"), true);

  assert.equal(world.store[DAILY], dailyNote("old"));
  assert.equal(world.store[DONE], doneNote("old"));
  assert.equal(world.editors[BOB].transactions.length, 0);
  assert.equal(world.editors[BOB].getValue(), `${bobNote("old")}half-typed bullet`);
  assert.match(noticeMessages[noticeMessages.length - 1], /bob\.md changed before rewrite/);
});

test("undoing the rename in its note rewrites the other notes back, and redo re-applies it", async () => {
  const world = threeNotes();
  await renameBob(world, "old", "new");
  const bob = world.editors[BOB];
  resetNotices();

  bob.undo();
  assert.equal(world.store[DAILY], dailyNote("new"), "other notes still point at the new id");
  await deliverUpdate(world, BOB);

  assert.equal(world.store[DAILY], dailyNote("old"));
  assert.equal(world.store[DONE], doneNote("old"));
  assert.equal(bob.getValue(), bobNote("old"));
  assert.deepEqual(noticeMessages, ["Undid block ID rename in 2 notes"]);

  resetNotices();
  bob.redo();
  await deliverUpdate(world, BOB);

  assert.equal(world.store[DAILY], dailyNote("new"));
  assert.equal(world.store[DONE], doneNote("new"));
  assert.deepEqual(noticeMessages, ["Redid block ID rename in 2 notes"]);
});

test("undoing in a referencing note follows into the destination and the other notes", async () => {
  const world = threeNotes({ open: [DAILY] });
  await renameBob(world, "old", "new");
  resetNotices();

  world.editors[DAILY].undo();
  await deliverUpdate(world, DAILY);

  assert.equal(world.editors[BOB].getValue(), bobNote("old"));
  assert.equal(world.editors[BOB].transactions.length, 2, "the follow is one transaction in the open destination");
  assert.equal(world.store[DONE], doneNote("old"));
  assert.deepEqual(noticeMessages, ["Undid block ID rename in 2 notes"]);

  // Our own writes are not mistaken for a new undo or redo.
  resetNotices();
  await deliverUpdate(world, BOB);
  assert.deepEqual(noticeMessages, []);
  assert.equal(world.store[DONE], doneNote("old"));
});

test("an ambiguous note is left alone and named in a sticky Notice", async () => {
  const world = threeNotes();
  await renameBob(world, "old", "new");
  world.store[DONE] = `${doneNote("new")}- see also [[bob#^new]]\n`;
  resetNotices();

  world.editors[BOB].undo();
  await deliverUpdate(world, BOB);

  assert.equal(world.store[DAILY], dailyNote("old"), "the unambiguous note follows");
  assert.equal(world.store[DONE], `${doneNote("new")}- see also [[bob#^new]]\n`, "the ambiguous note is untouched");
  assert.equal(noticeCalls.length, 1);
  assert.equal(noticeCalls[0].duration, 0, "sticky");
  assert.match(noticeCalls[0].message, /done\/bob_done\.md/);
  assert.match(noticeCalls[0].message, /\^new/);
  assert.match(noticeCalls[0].message, /undone in 1 note,/);
});

test("a recorded span that was edited makes its note ambiguous", async () => {
  const world = threeNotes();
  await renameBob(world, "old", "new");
  world.store[DAILY] = dailyNote("new").replace("[[bob#^new]]", "[[bob#^new|the task]]");
  resetNotices();

  world.editors[BOB].undo();
  await deliverUpdate(world, BOB);

  assert.equal(world.store[DAILY], dailyNote("new").replace("[[bob#^new]]", "[[bob#^new|the task]]"));
  assert.equal(world.store[DONE], doneNote("old"));
  assert.equal(noticeCalls[0].duration, 0);
  assert.match(noticeCalls[0].message, /daily\.md/);
});

test("editing a note the follow could not rewrite never redoes the rename", async () => {
  const world = threeNotes({ open: [DONE] });
  await renameBob(world, "old", "new");
  world.editors[DONE].type("- see also [[bob#^new]]\n");
  world.editors[BOB].undo();
  await deliverUpdate(world, BOB);
  const doneAfterUndo = world.editors[DONE].getValue();
  assert.match(doneAfterUndo, /\^new/);
  resetNotices();

  world.editors[DONE].type("more typing\n");
  await deliverUpdate(world, DONE);

  assert.equal(world.editors[BOB].getValue(), bobNote("old"), "the destination is not renamed again");
  assert.equal(world.store[DAILY], dailyNote("old"));
  assert.deepEqual(noticeMessages, []);
});

test("records expire, and edits without a live record schedule nothing", async () => {
  const none = threeNotes();
  pendingTimers.length = 0;
  none.plugin.noteBlockRenameUpdate({ docChanged: true, view: none.editors[BOB].cm });
  assert.equal(pendingTimers.length, 0, "no record, no timer");

  const world = threeNotes();
  await renameBob(world, "old", "new");
  world.advance(helpers.BLOCK_RENAME_FOLLOW_WINDOW_MS + 1000);
  world.editors[BOB].undo();
  pendingTimers.length = 0;
  world.plugin.noteBlockRenameUpdate({ docChanged: true, view: world.editors[BOB].cm });

  assert.equal(pendingTimers.length, 0, "an expired record is pruned");
  assert.equal(world.store[DAILY], dailyNote("new"), "nothing follows after the window");

  const unrelated = threeNotes();
  await renameBob(unrelated, "old", "new");
  pendingTimers.length = 0;
  unrelated.plugin.noteBlockRenameUpdate({ docChanged: true, view: {} });
  unrelated.plugin.noteBlockRenameUpdate({ docChanged: false, view: unrelated.editors[BOB].cm });
  assert.equal(pendingTimers.length, 0, "unknown views and unchanged documents are ignored");
});

test("a redo during closed-note undo follow converges on the latest editor form", async () => {
  const world = threeNotes();
  await renameBob(world, "old", "new");
  resetNotices();
  world.editors[BOB].undo();
  let redone = false;
  world.calls.hooks.beforeProcess = () => {
    if (redone) {
      return;
    }
    redone = true;
    world.editors[BOB].redo();
    world.plugin.noteBlockRenameUpdate({
      docChanged: true,
      view: world.editors[BOB].cm,
    });
  };
  await deliverUpdate(world, BOB);

  assert.equal(world.editors[BOB].getValue(), bobNote("new"));
  assert.equal(world.store[DAILY], dailyNote("new"));
  assert.equal(world.store[DONE], doneNote("new"));
  assert.equal((world.plugin.renameFollowPending || new Set()).size, 0);
  assert.ok(
    !noticeMessages.includes("Undid block ID rename in 2 notes"),
    `stale undo success is dishonest after a redo: ${JSON.stringify(noticeMessages)}`,
  );
});

test("an undo during closed-note redo follow converges on the latest editor form", async () => {
  const world = threeNotes();
  await renameBob(world, "old", "new");
  world.editors[BOB].undo();
  await deliverUpdate(world, BOB);
  resetNotices();
  world.editors[BOB].redo();
  let undone = false;
  world.calls.hooks.beforeProcess = () => {
    if (undone) {
      return;
    }
    undone = true;
    world.editors[BOB].undo();
    world.plugin.noteBlockRenameUpdate({
      docChanged: true,
      view: world.editors[BOB].cm,
    });
  };
  await deliverUpdate(world, BOB);

  assert.equal(world.editors[BOB].getValue(), bobNote("old"));
  assert.equal(world.store[DAILY], dailyNote("old"));
  assert.equal(world.store[DONE], doneNote("old"));
  assert.equal((world.plugin.renameFollowPending || new Set()).size, 0);
  assert.ok(
    !noticeMessages.includes("Redid block ID rename in 2 notes"),
    `stale redo success is dishonest after an undo: ${JSON.stringify(noticeMessages)}`,
  );
});

test("an unrelated edit in a second editor during closed follow is preserved", async () => {
  const world = threeNotes({ open: [DAILY] });
  await renameBob(world, "old", "new");
  resetNotices();
  world.editors[BOB].undo();
  let typed = false;
  world.calls.hooks.beforeProcess = () => {
    if (typed) {
      return;
    }
    typed = true;
    world.editors[DAILY].type("- unrelated\n");
    world.plugin.noteBlockRenameUpdate({
      docChanged: true,
      view: world.editors[DAILY].cm,
    });
  };
  await deliverUpdate(world, BOB);

  assert.equal(world.editors[BOB].getValue(), bobNote("old"));
  assert.ok(
    world.editors[DAILY].getValue().includes("- unrelated\n"),
    "the typed buffer is kept",
  );
  assert.match(world.editors[DAILY].getValue(), /\^new/);
  assert.equal(world.store[DONE], doneNote("new"));
  assert.ok(
    noticeCalls.some((call) => call.duration === 0),
    `expected a sticky dangling notice, got ${JSON.stringify(noticeMessages)}`,
  );
  assert.ok(
    noticeCalls.some((call) => /daily\.md|done\/bob_done\.md/.test(call.message)),
    `sticky notice should name the dangling notes: ${JSON.stringify(noticeMessages)}`,
  );
  assert.ok(
    !noticeMessages.includes("Undid block ID rename in 2 notes"),
    `success from stale observed fields: ${JSON.stringify(noticeMessages)}`,
  );
});

test("blockRenameNoteForm reads token and link forms and refuses mixed or missing states", () => {
  const record = { oldId: "old", newId: "new" };
  const note = {
    path: BOB,
    token: true,
    links: [{ before: "[[bob#^old]]", after: "[[bob#^new]]" }],
    observed: "new",
  };

  assert.equal(helpers.blockRenameNoteForm(note, bobNote("new"), record), "new");
  assert.equal(helpers.blockRenameNoteForm(note, bobNote("old"), record), "old");
  const split = bobNote("new").replace(/\^new$/mu, "^old");
  assert.equal(helpers.blockRenameNoteForm(note, split, record), null, "the 2026-11-09 split is mixed");
  assert.equal(helpers.blockRenameNoteForm(note, "# gone\n", record), null);

  const linksOnly = { path: DAILY, token: false, links: note.links, observed: "new" };
  assert.equal(helpers.blockRenameNoteForm(linksOnly, dailyNote("new"), record), "new");
  assert.equal(helpers.blockRenameNoteForm(linksOnly, dailyNote("old"), record), "old");
  assert.equal(
    helpers.blockRenameNoteForm(linksOnly, `${dailyNote("old")}[[bob#^new]]\n`, record),
    null,
  );
});
