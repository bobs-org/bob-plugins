// Whole-note editor writes are line-level edits (`181-editor-line-diff.js`), so
// the cursor and viewport stay on the line a gesture started on instead of
// jumping to the top of the note when the line count changes.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  TransactionEditor,
  assertLineBoundedTransaction,
} = require("./navigation-hotkeys-harness.cjs");
const { Cm6MappingEditor } = require("./cm6-mapping-editor.cjs");

const {
  alignEditorLines,
  planAlignedEditorChanges,
  mapEditorPositionThroughLineAlignment,
  applyEditorContentTransaction,
  planDependencyEdit,
} = helpers;

function splitLines(text) {
  return text.split(/\r?\n/);
}

function plan(oldText, newText) {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const lineEnding = newText.includes("\r\n") ? "\r\n" : "\n";
  const pairs = alignEditorLines(oldLines, newLines);
  const changes = planAlignedEditorChanges(oldLines, newLines, pairs, lineEnding);
  return { oldLines, newLines, pairs, changes, lineEnding };
}

// Pure applier: changes are in original coordinates and must be ascending and
// non-overlapping.
function applyChanges(oldText, changes) {
  const lineEnding = oldText.includes("\r\n") ? "\r\n" : "\n";
  const lines = splitLines(oldText);
  const offsetOf = (position) =>
    lines
      .slice(0, position.line)
      .reduce((sum, line) => sum + line.length + lineEnding.length, 0) +
    position.ch;
  let out = "";
  let at = 0;
  for (const change of changes) {
    const from = offsetOf(change.from);
    const to = offsetOf(change.to);
    assert.ok(from >= at, "changes are ascending and do not overlap");
    out += oldText.slice(at, from) + change.text;
    at = to;
  }
  return out + oldText.slice(at);
}

// The harness TransactionEditor applies changes one by one, bottom-up.
function applyThroughTransactionEditor(oldText, changes) {
  const editor = new TransactionEditor(oldText, { line: 0, ch: 0 });
  editor.transaction({ changes });
  return editor.getValue();
}

function assertPlanApplies(oldText, newText, label) {
  const { changes } = plan(oldText, newText);
  assert.equal(applyChanges(oldText, changes), newText, `${label} (pure)`);
  assert.equal(
    applyThroughTransactionEditor(oldText, changes),
    newText,
    `${label} (editor)`,
  );
  return changes;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- alignment keys ----------------------------------------------------------

test("alignment key ignores fields, the block id, the status and trailing space", () => {
  const key = helpers.editorLineAlignmentKey;
  const base = key("- [ ] #task Parent ^parent");
  assert.equal(base, "- [ ] #task Parent");
  assert.equal(key("- [?] #task Parent [dependsOn:: Tasks__t] ^parent"), base);
  assert.equal(key("- [ ] #task Parent [fresh:: 2026-10-18] ^parent  "), base);
  assert.equal(key("- [ ] #task Parent [created::2026-10-18] ^parent"), base);
  assert.equal(key("\t- [x] #task Parent [id:: A] [fresh:: B] ^parent"), "\t- [ ] #task Parent");
  assert.notEqual(key("- [ ] #task Other ^parent"), base);
  assert.notEqual(key("\t- ⛓️ **DEPENDS ON:** [[#^a]]"), key("\t- ⛓️ **DEPENDS ON:** [[#^b]]"));
});

// --- change shapes -------------------------------------------------------------

test("insertion after a modified line edits that line and inserts after it", () => {
  const before = ["# H", "- [ ] #task Parent ^parent", "- [ ] #task Tail ^tail"].join("\n");
  const after = [
    "# H",
    "- [?] #task Parent [dependsOn:: Tasks__t] ^parent",
    "\t- ⛓️ **DEPENDS ON:** [[t#^t]]",
    "- [ ] #task Tail ^tail",
  ].join("\n");
  const changes = assertPlanApplies(before, after, "insert after modified");
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0].from, { line: 1, ch: 0 });
  assert.deepEqual(changes[0].to, { line: 1, ch: "- [ ] #task Parent ^parent".length });
  assert.deepEqual(changes[1].from, { line: 1, ch: "- [ ] #task Parent ^parent".length });
  assert.deepEqual(changes[1].to, changes[1].from);
  assert.equal(changes[1].text, "\n\t- ⛓️ **DEPENDS ON:** [[t#^t]]");
});

test("adjacent prerequisite and parent both change while two lines insert", () => {
  const before = [
    "# Other",
    "- [ ] #task Target ^target",
    "- [ ] #task Parent ^parent",
    "- [ ] #task Tail ^tail",
  ].join("\n");
  const after = [
    "# Other",
    "- [ ] #task Target [id:: Tasks__target] ^target",
    "\t- 🧱 **BLOCKS:** [[#^parent]]",
    "- [?] #task Parent [dependsOn:: Tasks__target] [fresh:: 2026-10-18] ^parent",
    "\t- ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Tail ^tail",
  ].join("\n");
  const { pairs } = plan(before, after);
  assert.deepEqual(pairs, [
    [0, 0],
    [1, 1],
    [2, 3],
    [3, 5],
  ]);
  const changes = assertPlanApplies(before, after, "adjacent");
  // Never a whole-document replacement.
  assert.ok(changes.every((change) => change.from.line >= 1));
});

test("deletion at the end of the document", () => {
  const before = ["a", "b", "c", "d"].join("\n");
  assertPlanApplies(before, ["a", "b"].join("\n"), "delete tail");
  assertPlanApplies(before, ["a", "d"].join("\n"), "delete middle");
  assertPlanApplies(before, ["b", "c", "d"].join("\n"), "delete head");
  const { changes } = plan(before, "a\nb");
  assert.deepEqual(changes, [
    { from: { line: 1, ch: 1 }, to: { line: 3, ch: 1 }, text: "" },
  ]);
});

test("insertion at the top and at the end of the document", () => {
  assertPlanApplies("b\nc", "a\nb\nc", "insert top");
  assertPlanApplies("b\nc", "a1\na2\nb\nc", "insert two at top");
  assertPlanApplies("a\nb", "a\nb\nc", "insert end");
  assertPlanApplies("a\nb", "a\nb\nc\nd", "insert two at end");
  // A top insertion beside a changed first line is one replacement of that
  // line: two changes starting at {0, 0} would be ambiguous.
  const changes = assertPlanApplies(
    "- [ ] t ^t\nz",
    "new\n- [?] t [dependsOn:: x] ^t\nz",
    "insert top beside modified first line",
  );
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].from, { line: 0, ch: 0 });
});

test("empty documents align and apply", () => {
  assertPlanApplies("", "a", "empty to one line");
  assertPlanApplies("", "a\nb", "empty to two lines");
  assertPlanApplies("a", "", "one line to empty");
  assertPlanApplies("a\nb", "", "two lines to empty");
  assertPlanApplies("", "", "empty to empty");
  assert.deepEqual(plan("", "").changes, []);
});

test("CRLF documents insert and delete with CRLF", () => {
  const before = ["a", "- [ ] t ^t", "z"].join("\r\n");
  const after = ["a", "- [?] t [dependsOn:: x] ^t", "\t- DEPENDS ON", "z"].join("\r\n");
  const changes = assertPlanApplies(before, after, "crlf insert");
  assert.ok(changes.some((change) => change.text.startsWith("\r\n")));
  assertPlanApplies(after, before, "crlf delete");
});

test("equal-count shifted edits take the aligned path", () => {
  const before = ["head", "t1", "t2", "t3", "t4", "tail"].join("\n");
  const after = ["head", "new", "t1", "t2", "t4", "tail"].join("\n");
  const { pairs } = plan(before, after);
  assert.ok(pairs.some(([oldIndex, newIndex]) => oldIndex !== newIndex));
  const editor = new TransactionEditor(before, { line: 2, ch: 1 });
  assert.equal(applyEditorContentTransaction(editor, before, after), true);
  assert.equal(editor.getValue(), after);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.transactions[0].changes.length, 2);
  // t1 moved down one line and the cursor followed it.
  assert.deepEqual(editor.getCursor(), { line: 3, ch: 1 });
});

test("pure in-place edits keep the line-bounded change shapes", () => {
  const before = ["a", "b", "c", "d"];
  const after = ["a", "B", "c", "D"];
  const editor = new TransactionEditor(before.join("\n"), { line: 1, ch: 0 });
  assert.equal(
    applyEditorContentTransaction(editor, before.join("\n"), after.join("\n")),
    true,
  );
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.transactions[0].selection, undefined);
  assertLineBoundedTransaction(editor.transactions[0], before, [1, 3]);
});

test("an unchanged document writes nothing", () => {
  const editor = new TransactionEditor("a\nb", { line: 0, ch: 0 });
  assert.equal(applyEditorContentTransaction(editor, "a\nb", "a\nb"), true);
  assert.equal(editor.transactions.length, 0);
});

test("an explicit final cursor wins over the mapped cursor", () => {
  const before = ["a", "- [ ] t ^t", "z"].join("\n");
  const after = ["a", "- [?] t [dependsOn:: x] ^t", "\t- DEPENDS ON", "z"].join("\n");
  const editor = new TransactionEditor(before, { line: 1, ch: 3 });
  applyEditorContentTransaction(editor, before, after, { line: 3, ch: 0 });
  assert.deepEqual(editor.transactions[0].selection, {
    from: { line: 3, ch: 0 },
    to: { line: 3, ch: 0 },
  });
});

test("the machine-write annotation still reaches the transaction", () => {
  const before = ["a", "- [ ] t ^t"].join("\n");
  const after = ["a", "- [ ] t ^t", "\t- BLOCKS"].join("\n");
  const editor = new TransactionEditor(before, { line: 1, ch: 0 });
  applyEditorContentTransaction(editor, before, after, null, "machine");
  assert.equal(editor.transactions[0].annotation, "machine");
});

test("an editor without transaction falls back to bottom-up replaceRange", () => {
  const before = ["a", "- [ ] t ^t", "z"].join("\n");
  const after = ["a", "new", "- [ ] t [fresh:: x] ^t", "\t- BLOCKS", "z"].join("\n");
  const events = [];
  const editor = new TransactionEditor(before, { line: 1, ch: 2 });
  editor.transaction = undefined;
  const replace = editor.replaceRange.bind(editor);
  editor.replaceRange = (text, from, to) => {
    events.push(from.line);
    replace(text, from, to);
  };
  let scrolled = null;
  editor.scrollTo = (left, top) => {
    scrolled = { left, top };
  };
  assert.equal(applyEditorContentTransaction(editor, before, after), true);
  assert.equal(editor.getValue(), after);
  assert.deepEqual(events, [...events].sort((left, right) => right - left));
  assert.deepEqual(editor.getCursor(), { line: 2, ch: 2 });
  assert.deepEqual(scrolled, { left: 0, top: 640 });
});

// --- position mapping -----------------------------------------------------------

test("positions map through aligned, changed, gap and deleted lines", () => {
  const before = ["head", "- [ ] task ^t", "gone one", "gone two", "tail"];
  const after = ["head", "inserted", "- [?] task [fresh:: x] ^t", "tail"];
  const pairs = alignEditorLines(before, after);
  const map = (line, ch) =>
    mapEditorPositionThroughLineAlignment({ line, ch }, before, after, pairs);
  // Unchanged line keeps ch.
  assert.deepEqual(map(0, 3), { line: 0, ch: 3 });
  assert.deepEqual(map(4, 2), { line: 3, ch: 2 });
  // Changed line: inside the common prefix keeps ch; inside the common suffix
  // shifts by the length delta; in between it clamps.
  assert.deepEqual(map(1, 3), { line: 2, ch: 3 });
  assert.deepEqual(map(1, before[1].length), {
    line: 2,
    ch: after[2].length,
  });
  assert.deepEqual(map(1, 8), { line: 2, ch: 8 });
  // Deleted lines map to the first line after the gap.
  assert.deepEqual(map(2, 4), { line: 3, ch: 0 });
  assert.deepEqual(map(3, 0), { line: 3, ch: 0 });
});

test("a deletion at the end of the document maps to the last line", () => {
  const before = ["a", "b", "c"];
  const after = ["a"];
  const pairs = alignEditorLines(before, after);
  assert.deepEqual(
    mapEditorPositionThroughLineAlignment({ line: 2, ch: 1 }, before, after, pairs),
    { line: 0, ch: 0 },
  );
});

test("a gap with new lines maps by offset and clamps to its last line", () => {
  const before = ["a", "x1", "x2", "x3", "z"];
  const after = ["a", "y1", "z"];
  const pairs = alignEditorLines(before, after);
  const map = (line, ch) =>
    mapEditorPositionThroughLineAlignment({ line, ch }, before, after, pairs);
  assert.deepEqual(map(1, 1), { line: 1, ch: 1 });
  assert.deepEqual(map(3, 9), { line: 1, ch: 2 });
});

// --- seeded property test -----------------------------------------------------------

function randomDocument(random) {
  const lines = [];
  const count = Math.floor(random() * 14);
  for (let index = 0; index < count; index += 1) {
    const roll = random();
    if (roll < 0.35) {
      lines.push(`- [ ] #task Task ${Math.floor(random() * 6)} ^t${Math.floor(random() * 6)}`);
    } else if (roll < 0.5) {
      lines.push("");
    } else if (roll < 0.7) {
      lines.push(`\t- ⛓️ **DEPENDS ON:** [[#^t${Math.floor(random() * 6)}]]`);
    } else {
      lines.push(`prose ${Math.floor(random() * 5)}`);
    }
  }
  return lines;
}

function mutate(random, lines) {
  const out = lines.slice();
  const edits = Math.floor(random() * 5);
  for (let edit = 0; edit < edits; edit += 1) {
    const roll = random();
    const at = Math.floor(random() * (out.length + 1));
    if (roll < 0.3) {
      out.splice(at, 0, `inserted ${Math.floor(random() * 4)}`);
    } else if (roll < 0.5 && out.length > 0) {
      out.splice(Math.min(at, out.length - 1), 1);
    } else if (roll < 0.7 && out.length > 0) {
      out[Math.min(at, out.length - 1)] = `rewritten ${Math.floor(random() * 99)}`;
    } else if (out.length > 0) {
      // A key-preserving modification: what the dependency writers do to a task.
      const index = Math.min(at, out.length - 1);
      out[index] = out[index]
        .replace(/^- \[ \]/, "- [?]")
        .replace(/( \^\w+)$/, " [fresh:: 2026-10-18]$1");
    }
  }
  return out;
}

test("seeded property: planned changes rebuild the new text and map unchanged lines", () => {
  const random = mulberry32(20261018);
  let nonTrivial = 0;
  for (let caseIndex = 0; caseIndex < 400; caseIndex += 1) {
    const lineEnding = random() < 0.2 ? "\r\n" : "\n";
    const oldLines = randomDocument(random);
    const newLines = mutate(random, oldLines);
    const oldText = (oldLines.length === 0 ? [""] : oldLines).join(lineEnding);
    const newText = (newLines.length === 0 ? [""] : newLines).join(lineEnding);
    const label = `case ${caseIndex}\n--- old\n${oldText}\n--- new\n${newText}`;
    const { oldLines: oldSplit, newLines: newSplit, pairs, changes } = plan(oldText, newText);
    if (oldText !== newText) nonTrivial += 1;

    // Pairs are strictly increasing and key-equal.
    let previous = [-1, -1];
    for (const [oldIndex, newIndex] of pairs) {
      assert.ok(oldIndex > previous[0] && newIndex > previous[1], label);
      assert.equal(
        helpers.editorLineAlignmentKey(oldSplit[oldIndex]),
        helpers.editorLineAlignmentKey(newSplit[newIndex]),
        label,
      );
      previous = [oldIndex, newIndex];
    }

    assert.equal(applyChanges(oldText, changes), newText, label);
    assert.equal(applyThroughTransactionEditor(oldText, changes), newText, label);

    // Every raw-unchanged aligned line maps to its partner, ch intact; every
    // other position maps to a valid position in the new document.
    for (const [oldIndex, newIndex] of pairs) {
      if (oldSplit[oldIndex] !== newSplit[newIndex]) continue;
      for (const ch of [0, Math.floor(oldSplit[oldIndex].length / 2), oldSplit[oldIndex].length]) {
        assert.deepEqual(
          mapEditorPositionThroughLineAlignment(
            { line: oldIndex, ch },
            oldSplit,
            newSplit,
            pairs,
          ),
          { line: newIndex, ch },
          label,
        );
      }
    }
    for (let line = 0; line < oldSplit.length; line += 1) {
      const mapped = mapEditorPositionThroughLineAlignment(
        { line, ch: 999 },
        oldSplit,
        newSplit,
        pairs,
      );
      assert.ok(mapped.line >= 0 && mapped.line < newSplit.length, label);
      assert.ok(mapped.ch >= 0 && mapped.ch <= newSplit[mapped.line].length, label);
    }
  }
  assert.ok(nonTrivial > 200, "the generator produces real edits");
});

test("a diff past the edit cap becomes one unaligned gap", () => {
  const oldLines = Array.from({ length: 1500 }, (_, index) => `old ${index}`);
  const newLines = Array.from({ length: 1700 }, (_, index) => `new ${index}`);
  const oldText = ["first", ...oldLines, "last"].join("\n");
  const newText = ["first", ...newLines, "last"].join("\n");
  const { pairs, changes } = plan(oldText, newText);
  assert.deepEqual(pairs, [
    [0, 0],
    [1501, 1701],
  ]);
  assert.equal(changes.length, 1);
  assert.equal(applyChanges(oldText, changes), newText);
});

// --- CM6 position-mapping semantics -----------------------------------------------

test("the CM6 double reproduces the whole-document replacement jump", () => {
  const before = ["a", "b", "c", "d"].join("\n");
  const after = ["a", "b", "new", "c", "d"].join("\n");
  const editor = new Cm6MappingEditor(before, { line: 2, ch: 1 }, 1);
  editor.transaction({
    changes: [
      { from: { line: 0, ch: 0 }, to: { line: 3, ch: 1 }, text: after },
    ],
  });
  assert.equal(editor.getValue(), after);
  assert.deepEqual(editor.getCursor(), { line: 0, ch: 0 });
  assert.equal(editor.scrollAnchorLine, 0);
});

function longNote(prefix, body, suffix = []) {
  const filler = Array.from({ length: 30 }, (_, index) => `- [ ] #task Filler ${index} ^f${index}`);
  return [...filler, ...prefix, ...body, ...suffix].join("\n");
}

function commitThroughCm6(before, after, cursor, anchorLine) {
  const editor = new Cm6MappingEditor(before, cursor, anchorLine);
  assert.equal(applyEditorContentTransaction(editor, before, after), true);
  assert.equal(editor.getValue(), after);
  return editor;
}

test("first cross-note prerequisite keeps the cursor and the viewport", () => {
  const parent = "- [ ] #task Parent ^parent";
  const before = longNote([], [parent, "- [ ] #task Tail ^tail"]);
  const planned = planDependencyEdit({
    content: before,
    parentLine: 30,
    parentPath: "A.md",
    add: [{ path: "B.md", blockId: "target" }],
    remove: [],
    files: { "A.md": before, "B.md": "- [ ] #task Target ^target" },
    vaultFiles: ["A.md", "B.md"],
  });
  assert.equal(planned.ok, true, planned.reason);
  assert.equal(planned.nextContent.split("\n").length, before.split("\n").length + 1);
  const editor = commitThroughCm6(before, planned.nextContent, { line: 30, ch: 4 }, 12);
  assert.equal(editor.getCursor().line, planned.parentLineNext);
  assert.equal(editor.getLine(editor.getCursor().line).includes("#task Parent"), true);
  assert.equal(editor.scrollAnchorLine, 12);
  assert.equal(editor.undoGroups, 1);
});

test("same-note prerequisite directly above keeps the dependent's line", () => {
  const before = longNote([], [
    "- [ ] #task Target ^target",
    "- [ ] #task Parent ^parent",
    "- [ ] #task Tail ^tail",
  ]);
  const planned = planDependencyEdit({
    content: before,
    parentLine: 31,
    parentPath: "A.md",
    add: [{ path: "A.md", blockId: "target" }],
    remove: [],
    files: { "A.md": before },
    vaultFiles: ["A.md"],
    blocksLinesEnabled: true,
  });
  assert.equal(planned.ok, true, planned.reason);
  assert.equal(planned.parentLineNext, 32);
  const editor = commitThroughCm6(before, planned.nextContent, { line: 31, ch: 6 }, 20);
  assert.equal(editor.getCursor().line, 32);
  assert.match(editor.getLine(32), /#task Parent/);
  assert.equal(editor.scrollAnchorLine, 20);
});

test("removing the last prerequisite keeps the dependent's line", () => {
  const parentLine = "- [?] #task Parent [dependsOn:: Tasks__target] ^parent";
  const before = longNote([], [
    "- [ ] #task Target [id:: Tasks__target] ^target",
    "\t- 🧱 **BLOCKS:** [[#^parent]]",
    parentLine,
    "\t- ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Tail ^tail",
  ]);
  const planned = planDependencyEdit({
    content: before,
    parentLine: 32,
    parentPath: "A.md",
    add: [],
    remove: [{ path: "A.md", blockId: "target" }],
    files: { "A.md": before },
    vaultFiles: ["A.md"],
    blocksLinesEnabled: true,
  });
  assert.equal(planned.ok, true, planned.reason);
  assert.equal(planned.nextContent.split("\n").length, before.split("\n").length - 2);
  const editor = commitThroughCm6(before, planned.nextContent, { line: 32, ch: 4 }, 15);
  assert.equal(editor.getCursor().line, planned.parentLineNext);
  assert.match(editor.getLine(editor.getCursor().line), /#task Parent/);
  assert.equal(editor.scrollAnchorLine, 15);
});

test("a Blocks source gaining its first BLOCKS line keeps its line", () => {
  const before = longNote([], [
    "- [ ] #task Dependent ^t",
    "- [ ] #task Source ^n",
    "- [ ] #task Tail ^tail",
  ]);
  const after = longNote([], [
    "- [?] #task Dependent [dependsOn:: Tasks__n] [fresh:: 2026-10-18] ^t",
    "\t- ⛓️ **DEPENDS ON:** [[#^n]]",
    "- [ ] #task Source [id:: Tasks__n] ^n",
    "\t- 🧱 **BLOCKS:** [[#^t]]",
    "- [ ] #task Tail ^tail",
  ]);
  const editor = commitThroughCm6(before, after, { line: 31, ch: 5 }, 18);
  assert.equal(editor.getCursor().line, 32);
  assert.match(editor.getLine(32), /#task Source/);
  assert.equal(editor.scrollAnchorLine, 18);
});
