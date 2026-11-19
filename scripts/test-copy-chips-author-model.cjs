const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers, FakeNotice } = require("./copy-chips-test-helpers.cjs");

function offsetOf(source, needle, occurrence) {
  let from = 0;
  const want = occurrence || 0;
  for (let index = 0; index <= want; index += 1) {
    const found = source.indexOf(needle, from);
    if (found < 0) throw new Error("missing " + JSON.stringify(needle));
    if (index === want) return found;
    from = found + 1;
  }
  return -1;
}

function key(partial) {
  return Object.assign({
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 0,
  }, partial);
}

test("resolve refuses multiple selections", () => {
  const resolved = helpers.copyChipAuthorResolve({
    source: "hello",
    selections: [{ from: 0, to: 1 }, { from: 2, to: 3 }],
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, helpers.COPY_CHIP_AUTHOR_ONE_SELECTION);
});

test("resolve wraps a nonempty selection, including reversed ranges", () => {
  const source = "see hello world";
  const from = offsetOf(source, "hello");
  const to = from + "hello".length;
  const forward = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from, to }],
  });
  assert.equal(forward.ok, true);
  assert.equal(forward.snapshot.mode, "select");
  assert.equal(forward.snapshot.text, "hello");
  assert.equal(forward.snapshot.from, from);
  assert.equal(forward.snapshot.to, to);
  assert.equal(forward.snapshot.focus, "label");
  assert.equal(forward.snapshot.form, "inline");
  const reversed = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: to, to: from }],
  });
  assert.equal(reversed.ok, true);
  assert.equal(reversed.snapshot.from, from);
  assert.equal(reversed.snapshot.to, to);
  assert.equal(reversed.snapshot.text, "hello");
});

test("resolve wraps a multiline selection as a block", () => {
  const source = "prefix hello\nworld suffix";
  const from = offsetOf(source, "hello");
  const to = offsetOf(source, "world") + "world".length;
  const resolved = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from, to }],
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.snapshot.form, "block");
  assert.equal(resolved.snapshot.text, "hello\nworld");
});

test("resolve edits the chip under the cursor and refuses ambiguous lines", () => {
  const source = "see `copy: ssh apollo` and `copy: pwd`";
  const chips = helpers.copyChipScanLine(source);
  const first = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: chips[0].from + 1, to: chips[0].from + 1 }],
  });
  assert.equal(first.ok, true);
  assert.equal(first.snapshot.mode, "edit");
  assert.equal(first.snapshot.title, "Edit copy chip");
  assert.equal(first.snapshot.text, "ssh apollo");
  assert.equal(first.snapshot.from, chips[0].from);
  assert.equal(first.snapshot.to, chips[0].to);
  const gap = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: chips[0].to, to: chips[0].to }],
  });
  assert.equal(gap.ok, false);
  assert.equal(gap.reason, "2 chips on this line · move onto one");
});

test("resolve uses a block fence range, not the flash line range", () => {
  const source = "intro\n```bob-copy Hi\nhello\n```\nafter";
  const lines = source.split("\n");
  const cursor = offsetOf(source, "hello");
  const flash = helpers.copyChipAt({ lines, line: 2, ch: 0 });
  assert.equal(flash.state, "ready");
  assert.equal(flash.chip.form, "block");
  assert.equal(flash.chip.line, 2);
  const resolved = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: cursor, to: cursor }],
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.snapshot.mode, "edit");
  assert.equal(resolved.snapshot.form, "block");
  assert.equal(resolved.snapshot.text, "hello");
  assert.equal(resolved.snapshot.label, "Hi");
  assert.equal(resolved.snapshot.from, offsetOf(source, "```bob-copy Hi"));
  assert.equal(resolved.snapshot.to, offsetOf(source, "```\nafter") + 3);
  assert.notEqual(resolved.snapshot.from, flash.chip.from);
});

test("resolve captures an unclosed fence through EOF", () => {
  const source = "```bob-copy Open\nbody line";
  const resolved = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: offsetOf(source, "body"), to: offsetOf(source, "body") }],
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.snapshot.to, source.length);
  assert.equal(resolved.snapshot.text, "body line");
});

test("resolve converts a plain code span and skips inert contexts", () => {
  const source = "run `ssh apollo` now";
  const spanFrom = offsetOf(source, "`ssh apollo`");
  const resolved = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: spanFrom + 1, to: spanFrom + 1 }],
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.snapshot.mode, "convert");
  assert.equal(resolved.snapshot.text, "ssh apollo");
  assert.equal(resolved.snapshot.focus, "label");

  const fenced = helpers.copyChipAuthorResolve({
    source: "```\n`ssh apollo`\n```",
    selections: [{ from: 5, to: 5 }],
  });
  assert.equal(fenced.ok, true);
  assert.equal(fenced.snapshot.mode, "insert");

  const link = helpers.copyChipAuthorResolve({
    source: "[see `ssh apollo`](https://example.com)",
    selections: [{ from: offsetOf("[see `ssh apollo`](https://example.com)", "`ssh") + 1, to: offsetOf("[see `ssh apollo`](https://example.com)", "`ssh") + 1 }],
  });
  assert.equal(link.snapshot.mode, "insert");

  const wiki = helpers.copyChipAuthorResolve({
    source: "[[`ssh apollo`]]",
    selections: [{ from: 4, to: 4 }],
  });
  assert.equal(wiki.snapshot.mode, "insert");

  const math = helpers.copyChipAuthorResolve({
    source: "$`ssh apollo`$",
    selections: [{ from: 2, to: 2 }],
  });
  assert.equal(math.snapshot.mode, "insert");

  const comment = helpers.copyChipAuthorResolve({
    source: "<!-- `ssh apollo` -->",
    selections: [{ from: 6, to: 6 }],
  });
  assert.equal(comment.snapshot.mode, "insert");

  const front = helpers.copyChipAuthorResolve({
    source: "---\n`ssh apollo`\n---\nbody",
    selections: [{ from: 6, to: 6 }],
  });
  assert.equal(front.snapshot.mode, "insert");
});

test("resolve inserts at the cursor and may preload clipboard text", () => {
  const source = "hello";
  const empty = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: 5, to: 5 }],
  });
  assert.equal(empty.ok, true);
  assert.equal(empty.snapshot.mode, "insert");
  assert.equal(empty.snapshot.text, "");
  assert.equal(empty.snapshot.focus, "text");
  assert.equal(empty.snapshot.selectText, false);
  const clip = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: 5, to: 5 }],
    clipboardText: "paste me",
  });
  assert.equal(clip.snapshot.text, "paste me");
  assert.equal(clip.snapshot.selectText, true);
  assert.equal(clip.snapshot.form, "inline");
  const blockClip = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: 5, to: 5 }],
    clipboardText: "a\nb",
  });
  assert.equal(blockClip.snapshot.form, "block");
});

test("resolve honors UTF-16 offsets", () => {
  const source = "`copy: café 日本語 🙂`";
  const chips = helpers.copyChipScanLine(source);
  const resolved = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: chips[0].from + 6, to: chips[0].from + 6 }],
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.snapshot.text, "café 日本語 🙂");
  assert.equal(resolved.snapshot.from, 0);
  assert.equal(resolved.snapshot.to, source.length);
});

test("list indent uses the item content column", () => {
  assert.equal(helpers.copyChipAuthorListContentIndent("- hello"), "  ");
  assert.equal(helpers.copyChipAuthorListContentIndent("* hello"), "  ");
  assert.equal(helpers.copyChipAuthorListContentIndent("1. hello"), "   ");
  assert.equal(helpers.copyChipAuthorListContentIndent("12. hello"), "    ");
  assert.equal(helpers.copyChipAuthorListContentIndent("- [ ] hello"), "      ");
  assert.equal(helpers.copyChipAuthorListContentIndent("  - nested"), "    ");
  assert.equal(helpers.copyChipAuthorListContentIndent("    continued"), "    ");
  assert.equal(helpers.copyChipAuthorListContentIndent("plain"), "");
});

test("plan wraps an inline selection exactly", () => {
  const source = "see hello world";
  const from = offsetOf(source, "hello");
  const to = from + 5;
  const snap = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from, to }],
  }).snapshot;
  const plan = helpers.copyChipAuthorPlan(snap, { label: "", text: "hello" });
  assert.equal(plan.ok, true);
  assert.equal(plan.form, "inline");
  assert.equal(plan.markdown, "`copy: hello`");
  assert.equal(source.slice(0, from) + plan.markdown + source.slice(to), "see `copy: hello` world");
  assert.equal(plan.caption, "inline chip");
});

test("plan inserts a fence with mid-line separators", () => {
  const source = "prefix hello\nworld suffix";
  const from = offsetOf(source, "hello");
  const to = offsetOf(source, "world") + "world".length;
  const snap = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from, to }],
  }).snapshot;
  const plan = helpers.copyChipAuthorPlan(snap, { label: "", text: "hello\nworld" });
  assert.equal(plan.ok, true);
  assert.equal(plan.form, "block");
  assert.equal(plan.markdown, "\n```bob-copy\nhello\nworld\n```\n");
  const next = source.slice(0, from) + plan.markdown + source.slice(to);
  assert.equal(next, "prefix \n```bob-copy\nhello\nworld\n```\n suffix");
  assert.equal(plan.caption, "block card · 2 lines");
});

test("plan indents a list-item insert to the content column", () => {
  const source = "- item ";
  const snap = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: source.length, to: source.length }],
    clipboardText: "hello\nworld",
  }).snapshot;
  assert.equal(snap.indent, "  ");
  const plan = helpers.copyChipAuthorPlan(snap, { label: "Prompt", text: "hello\nworld" });
  assert.equal(plan.ok, true);
  assert.equal(
    plan.markdown,
    "\n  ```bob-copy Prompt\n  hello\n  world\n  ```",
  );
  const next = source.slice(0, snap.from) + plan.markdown + source.slice(snap.to);
  assert.equal(next, "- item \n  ```bob-copy Prompt\n  hello\n  world\n  ```");
});

test("plan keeps payload whitespace under nested and task lists", () => {
  const nested = "  - note ";
  const nestedSnap = helpers.copyChipAuthorResolve({
    source: nested,
    selections: [{ from: nested.length, to: nested.length }],
    clipboardText: "  padded  \n",
  }).snapshot;
  const nestedPlan = helpers.copyChipAuthorPlan(nestedSnap, { label: "", text: "  padded  \n" });
  assert.equal(
    nestedPlan.markdown,
    "\n    ```bob-copy\n      padded  \n    \n    ```",
  );
  const task = "- [ ] do ";
  const taskSnap = helpers.copyChipAuthorResolve({
    source: task,
    selections: [{ from: task.length, to: task.length }],
    clipboardText: "a\nb",
  }).snapshot;
  assert.equal(taskSnap.indent, "      ");
  const taskPlan = helpers.copyChipAuthorPlan(taskSnap, { label: "", text: "a\nb" });
  assert.equal(
    taskPlan.markdown,
    "\n      ```bob-copy\n      a\n      b\n      ```",
  );
});

test("plan serializes table pipes and refuses a table-cell fence", () => {
  const source = "| keep | cell |";
  const from = offsetOf(source, "cell");
  const snap = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from, to: from + 4 }],
  }).snapshot;
  assert.equal(snap.table, true);
  const inline = helpers.copyChipAuthorPlan(snap, { label: "", text: "a|b" });
  assert.equal(inline.ok, true);
  assert.equal(inline.markdown, "`copy: a\\|b`");
  const block = helpers.copyChipAuthorPlan(snap, { label: "", text: "a\nb" });
  assert.equal(block.ok, false);
  assert.equal(block.reason, helpers.COPY_CHIP_AUTHOR_TABLE_BLOCK);
});

test("plan round-trips backticks, labels, and trailing whitespace", () => {
  const source = "x";
  const snap = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: 1, to: 1 }],
  }).snapshot;
  const ticks = helpers.copyChipAuthorPlan(snap, { label: "", text: "run `bob plan` first" });
  assert.equal(ticks.ok, true);
  assert.equal(ticks.markdown, "``copy: run `bob plan` first``");
  const labeled = helpers.copyChipAuthorPlan(snap, { label: "Zoom", text: "https://zoom.us/j/1" });
  assert.equal(labeled.markdown, "`copy[Zoom]: https://zoom.us/j/1`");
  const trailing = helpers.copyChipAuthorPlan(snap, { label: "", text: "hello  \n" });
  assert.equal(trailing.form, "block");
  assert.match(trailing.markdown, /hello  \n\n```$/);
});

test("plan replaces a fence with an inline chip and keeps opening indent", () => {
  const source = "- item\n  ```bob-copy L\n  hello\n  world\n  ```\nafter";
  const cursor = offsetOf(source, "hello");
  const snap = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: cursor, to: cursor }],
  }).snapshot;
  assert.equal(snap.form, "block");
  assert.equal(snap.openingIndent, "  ");
  const plan = helpers.copyChipAuthorPlan(snap, { label: "L", text: "hello" });
  assert.equal(plan.ok, true);
  assert.equal(plan.form, "inline");
  assert.equal(plan.markdown, "  `copy[L]: hello`");
  const next = source.slice(0, snap.from) + plan.markdown + source.slice(snap.to);
  assert.equal(next, "- item\n  `copy[L]: hello`\nafter");
});

test("plan and validation refuse empty, whitespace, and multiline labels", () => {
  const snap = helpers.copyChipAuthorSnapshot({
    originalSource: "x",
    from: 1,
    to: 1,
  });
  assert.equal(helpers.copyChipAuthorPlan(snap, { label: "", text: "" }).reason, helpers.COPY_CHIP_NOTHING_TO_COPY);
  assert.equal(helpers.copyChipAuthorPlan(snap, { label: "", text: "   " }).reason, helpers.COPY_CHIP_AUTHOR_WHITESPACE);
  assert.equal(helpers.copyChipAuthorPlan(snap, { label: "a\nb", text: "x" }).reason, helpers.COPY_CHIP_LABELS_ARE_ONE_LINE);
  const draft = helpers.copyChipAuthorDraftState(snap, "", "hi");
  assert.equal(draft.valid, true);
  assert.equal(draft.markdown, "`copy: hi`");
});

test("stale detection compares the full original buffer", () => {
  const snap = helpers.copyChipAuthorSnapshot({ originalSource: "abc", from: 1, to: 1 });
  assert.equal(helpers.copyChipAuthorIsStale(snap, "abc"), false);
  assert.equal(helpers.copyChipAuthorIsStale(snap, "abC"), true);
  assert.equal(helpers.copyChipAuthorIsStale(snap, "ab"), true);
  assert.equal(helpers.copyChipAuthorIsStale(null, "abc"), true);
});

test("key actions save, cancel, type q in fields, and ignore composition", () => {
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "Enter" })).type, "save");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "y", ctrlKey: true, shiftKey: true })).type, "save");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "y", metaKey: true, shiftKey: true })).type, "save");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "Escape" })).type, "cancel");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "[", code: "BracketLeft", ctrlKey: true })).type, "cancel");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "q" })).type, "cancel");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "q" }), { inField: true }).type, "type");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "[", code: "BracketLeft", ctrlKey: true }), { inField: true }).type, "cancel");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "Tab" })).type, "next-field");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "Tab", shiftKey: true })).type, "prev-field");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "Enter", shiftKey: true }), { inText: true }).type, "newline");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "Enter", shiftKey: true })).type, "ignore");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "a" }), { inField: true }).type, "type");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "Escape", isComposing: true })).type, "ignore");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "Enter", keyCode: 229 })).type, "ignore");
  assert.equal(helpers.copyChipAuthorKeyAction(key({ key: "[", code: "BracketLeft", ctrlKey: true, altKey: true })).type, "ignore");
});

test("apply write uses one CM6 transaction and isolateHistory", () => {
  const source = "see hello";
  const from = offsetOf(source, "hello");
  let value = source;
  const dispatches = [];
  const editor = {
    getValue: () => value,
    cm: {
      dispatch(spec) {
        dispatches.push(spec);
        if (spec && spec.changes) {
          value = value.slice(0, spec.changes.from) + spec.changes.insert + value.slice(spec.changes.to);
        }
      },
      state: {
        doc: { toString: () => value },
        selection: { ranges: [{ from, to: from + 5 }] },
      },
    },
  };
  const ok = helpers.copyChipAuthorApplyWrite(editor, null, from, from + 5, "`copy: hello`", false);
  assert.equal(ok, true);
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].userEvent, "bob.copy-chip");
  assert.equal(dispatches[0].changes.insert, "`copy: hello`");
  assert.ok(Array.isArray(dispatches[0].annotations));
  assert.ok(dispatches[0].annotations.some((item) => item && item._isolateHistory === true && item.value === "full"));
  assert.equal(value, "see `copy: hello`");
});

test("commit refuses stale, detached, and identity-mismatched editors", () => {
  FakeNotice.messages = [];
  const source = "see hello";
  const from = offsetOf(source, "hello");
  const snap = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from, to: from + 5 }],
  }).snapshot;
  const draft = helpers.copyChipAuthorDraftState(snap, "", "hello");
  let value = source;
  const editor = {
    getValue: () => value,
    cm: {
      dispatch(spec) {
        if (spec && spec.changes) {
          value = value.slice(0, spec.changes.from) + spec.changes.insert + value.slice(spec.changes.to);
        }
      },
      state: { doc: { toString: () => value }, selection: { ranges: [] } },
    },
  };
  const view = { file: { path: "a.md" }, _loaded: true, containerEl: { isConnected: true } };
  const identity = { editor, view, path: "a.md" };
  value = "changed";
  assert.equal(helpers.copyChipAuthorCommit({}, draft, snap, identity), false);
  assert.ok(FakeNotice.messages.indexOf(helpers.COPY_CHIP_AUTHOR_STALE) >= 0);
  value = source;
  view._loaded = false;
  FakeNotice.messages = [];
  assert.equal(helpers.copyChipAuthorCommit({}, draft, snap, identity), false);
  view._loaded = true;
  view.file.path = "b.md";
  FakeNotice.messages = [];
  assert.equal(helpers.copyChipAuthorCommit({}, draft, snap, identity), false);
  assert.ok(FakeNotice.messages.indexOf(helpers.COPY_CHIP_AUTHOR_STALE) >= 0);
});
