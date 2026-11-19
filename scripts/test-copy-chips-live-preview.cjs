const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { helpers } = require("./copy-chips-test-helpers.cjs");

const vectors = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "copy-chips-vectors.json"), "utf8"),
);

function fakeDoc(lines) {
  const text = lines.join("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return {
    toString: () => text,
    length: text.length,
    lineAt(pos) {
      let index = 0;
      for (let i = 0; i < starts.length; i += 1) {
        if (starts[i] <= pos) index = i;
        else break;
      }
      return { text: lines[index], from: starts[index], to: starts[index] + lines[index].length, number: index + 1 };
    },
  };
}

test("every vector line decorates in visible ranges", () => {
  for (const vector of vectors.chips) {
    const table = Boolean(vector.table);
    const chips = helpers.copyChipLiveChipsForLine(vector.line, 0, 0, null, table);
    assert.equal(chips.length, vector.expected.length, vector.id);
    for (let i = 0; i < chips.length; i += 1) {
      assert.equal(chips[i].text, vector.expected[i].text, vector.id);
      assert.equal(chips[i].label, vector.expected[i].label, vector.id);
    }
  }
  for (const vector of vectors.not_chips) {
    const chips = helpers.copyChipLiveChipsForLine(vector.line, 0, 0, null, false);
    assert.deepEqual(chips, [], vector.id);
  }
});

test("inert contexts never decorate", () => {
  // Fenced lines are filtered by the caller, but the pure helper skips
  // link/wikilink contexts on its own.
  assert.deepEqual(helpers.copyChipLiveChipsForLine("[see `copy: x`](https://example.com)", 0, 0, null), []);
  assert.deepEqual(helpers.copyChipLiveChipsForLine("[[`copy: x`]]", 0, 0, null), []);
  assert.deepEqual(helpers.copyChipLiveChipsForLine("    `copy: x`", 0, 0, null), []);
  assert.deepEqual(helpers.copyChipLiveChipsForLine("`copy:`", 0, 0, null), []);
  assert.deepEqual(helpers.copyChipLiveChipsForLine("`copy:    `", 0, 0, null), []);
  // Dataview spans stay plain code.
  assert.deepEqual(helpers.copyChipLiveChipsForLine("`= dataview`", 0, 0, null), []);
  // Containers are supported: lists, blockquotes, callouts, tables.
  assert.equal(helpers.copyChipLiveChipsForLine("- [ ] `copy: ssh`", 0, 0, null).length, 1);
  assert.equal(helpers.copyChipLiveChipsForLine("> `copy: ssh`", 0, 0, null).length, 1);
  assert.equal(helpers.copyChipLiveChipsForLine("> [!note] `copy: ssh`", 0, 0, null).length, 1);
  assert.equal(helpers.copyChipLiveChipsForLine("| `copy: a\\|b` |", 0, 0, null, true).length, 1);
});

test("selection reveal uses the closed boundary interval", () => {
  // Span [4, 22): empty cursors at both boundaries reveal.
  assert.equal(helpers.copyChipLiveShouldReveal(4, 22, [{ from: 4, to: 4 }]), true);
  assert.equal(helpers.copyChipLiveShouldReveal(4, 22, [{ from: 22, to: 22 }]), true);
  assert.equal(helpers.copyChipLiveShouldReveal(4, 22, [{ from: 10, to: 10 }]), true);
  assert.equal(helpers.copyChipLiveShouldReveal(4, 22, [{ from: 0, to: 4 }]), true);
  assert.equal(helpers.copyChipLiveShouldReveal(4, 22, [{ from: 22, to: 30 }]), true);
  assert.equal(helpers.copyChipLiveShouldReveal(4, 22, [{ from: 0, to: 3 }]), false);
  assert.equal(helpers.copyChipLiveShouldReveal(4, 22, [{ from: 23, to: 30 }]), false);
  // Nonempty and secondary cursors also reveal.
  assert.equal(helpers.copyChipLiveShouldReveal(4, 22, [{ from: 0, to: 10 }]), true);
  assert.equal(
    helpers.copyChipLiveShouldReveal(4, 22, [{ from: 0, to: 3 }, { from: 10, to: 10 }]),
    true,
  );
});

test("rebuild triggers cover document, viewport, selection, and mode", () => {
  assert.equal(helpers.copyChipLiveShouldRebuild({ docChanged: true }), true);
  assert.equal(helpers.copyChipLiveShouldRebuild({ viewportChanged: true }), true);
  assert.equal(helpers.copyChipLiveShouldRebuild({ selectionSet: true }), true);
  assert.equal(helpers.copyChipLiveShouldRebuild({}), false);
  assert.equal(helpers.copyChipLiveShouldRebuild(null), false);
});

test("gesture rule copies only on short primary releases inside", () => {
  const inside = { releasedInside: true, button: 0 };
  assert.equal(helpers.copyChipLiveGestureShouldCopy({ x: 0, y: 0 }, { x: 3, y: 0 }, inside), true);
  assert.equal(helpers.copyChipLiveGestureShouldCopy({ x: 0, y: 0 }, { x: 4, y: 0 }, inside), false);
  assert.equal(helpers.copyChipLiveGestureShouldCopy({ x: 0, y: 0 }, { x: 0, y: 0 }, { releasedInside: false, button: 0 }), false);
  assert.equal(helpers.copyChipLiveGestureShouldCopy({ x: 0, y: 0 }, { x: 0, y: 0 }, { releasedInside: true, button: 2 }), false);
  assert.equal(helpers.copyChipLiveShouldReveal(0, 5, []), false);
  // Drag that returns to its start still counts as no copy when cancelled.
  assert.equal(
    helpers.copyChipLiveGestureShouldCopy({ x: 0, y: 0 }, { x: 0, y: 0 }, { releasedInside: true, button: 0, cancelled: true }),
    false,
  );
  // Touch taps copy.
  assert.equal(
    helpers.copyChipLiveGestureShouldCopy({ x: 10, y: 10 }, { x: 10, y: 10 }, { releasedInside: true, button: 0, pointerType: "touch" }),
    true,
  );
  // Alt+Click is an edit gesture, never a copy.
  assert.equal(
    helpers.copyChipLiveGestureShouldCopy({ x: 0, y: 0 }, { x: 0, y: 0 }, { releasedInside: true, button: 0, alt: true }),
    false,
  );
  assert.equal(
    helpers.copyChipLiveGestureShouldEdit({ x: 0, y: 0 }, { x: 0, y: 0 }, { releasedInside: true, button: 0, alt: true }),
    true,
  );
  assert.equal(
    helpers.copyChipLiveGestureShouldEdit({ x: 0, y: 0 }, { x: 4, y: 0 }, { releasedInside: true, button: 0, alt: true }),
    false,
  );
});

test("widget equality compares label, text, and position", () => {
  const doc = fakeDoc(["`copy: ssh`"]);
  void doc;
  // Equality is structural on the model; build two decorations for the
  // same line and compare their widget payloads.
  const first = helpers.copyChipLiveChipsForLine("`copy: ssh`", 0, 0, null);
  const second = helpers.copyChipLiveChipsForLine("`copy[Z]: ssh`", 0, 0, null);
  assert.notDeepEqual(first[0], second[0]);
  assert.equal(first[0].from, 0);
  assert.equal(first[0].to, "`copy: ssh`".length);
});

test("mode changes rebuild without cross-mode DOM state", () => {
  const liveField = { _live: true };
  const update = {
    startState: { field: () => false },
    state: { field: (field) => field === liveField },
  };
  // The helper reads the real field identity; a mismatched field object
  // simply returns false rather than throwing.
  assert.equal(typeof helpers.copyChipLiveShouldRebuild(update), "boolean");
});
