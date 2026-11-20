const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  BobCopyChipsPlugin,
  FakeDocument,
  FakeNotice,
  editorInfoField,
} = require("./copy-chips-test-helpers.cjs");

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function allAttrs(node, out) {
  out = out || [];
  if (node && node.attrs) {
    for (const [name, value] of node.attrs) out.push([node.tagName + "." + name, String(value)]);
  }
  for (const child of (node && node.children) || []) allAttrs(child, out);
  return out;
}

function makeEditor(source, ranges) {
  let value = String(source || "");
  const dispatches = [];
  const selection = {
    ranges: (ranges && ranges.length ? ranges : [{ from: 0, to: 0 }]).map((range) => ({
      from: range.from,
      to: range.to,
    })),
  };
  const editor = {
    getValue: () => value,
    listSelections: () => selection.ranges.map((range) => ({
      anchor: { line: 0, ch: range.from },
      head: { line: 0, ch: range.to },
    })),
    posToOffset: (pos) => (pos && Number.isInteger(pos.ch) ? pos.ch : 0),
    offsetToPos: (offset) => ({ line: 0, ch: offset }),
    setCursor() {},
    replaceRange(text, fromPos, toPos) {
      const from = editor.posToOffset(fromPos);
      const to = editor.posToOffset(toPos);
      value = value.slice(0, from) + text + value.slice(to);
    },
    cm: {
      dispatch(spec) {
        dispatches.push(spec);
        if (spec && spec.changes) {
          value = value.slice(0, spec.changes.from) + spec.changes.insert + value.slice(spec.changes.to);
        }
        if (spec && spec.selection) {
          selection.ranges = [{ from: spec.selection.anchor, to: spec.selection.head }];
        }
      },
      state: {
        get doc() {
          return { toString: () => value };
        },
        selection,
      },
    },
  };
  editor._dispatches = dispatches;
  Object.defineProperty(editor, "_value", {
    get: () => value,
    set: (next) => { value = next; },
  });
  return editor;
}

function openAuthor(snapshot, extra) {
  const plugin = extra && extra.plugin ? extra.plugin : { copyChipAuthorModal: null };
  const saves = [];
  const modal = new helpers.CopyChipAuthorModal({}, {
    plugin,
    snapshot,
    identity: extra && extra.identity,
    clipboardPromise: extra && extra.clipboardPromise,
    onSave: extra && extra.onSave
      ? extra.onSave
      : (draft, snap, identity) => {
        saves.push({ draft, snap, identity });
        return extra && extra.saveResult === false ? false : true;
      },
  });
  plugin.copyChipAuthorModal = modal;
  modal.open();
  return { plugin, modal, saves };
}

test("make-or-edit command registers with Mod+Shift+Y", async () => {
  const plugin = new BobCopyChipsPlugin({});
  await plugin.onload();
  const command = plugin.commands.find((item) => item.id === "make-or-edit");
  assert.ok(command);
  assert.equal(command.name, "Make or edit chip");
  assert.deepEqual(command.hotkeys, [{ modifiers: ["Mod", "Shift"], key: "y" }]);
  assert.equal(typeof command.editorCallback, "function");
});

test("author modal renders fields, live preview, and exact markdown", () => {
  const source = "see hello";
  const from = source.indexOf("hello");
  const snapshot = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from, to: from + 5 }],
  }).snapshot;
  const { modal } = openAuthor(snapshot);
  assert.equal(modal.opened, true);
  assert.ok(modal.modalEl.classList.contains("bob-copy-author-modal"));
  assert.equal(modal.modalEl.getAttribute("role"), "dialog");
  assert.equal(modal.labelEl.value, "");
  assert.equal(modal.textEl.value, "hello");
  assert.equal(modal.markdownEl.textContent, "`copy: hello`");
  assert.equal(modal.captionEl.textContent, "inline chip");
  assert.equal(modal.statusEl.textContent, "");
  assert.ok(modal.previewHost.querySelector(".bob-copy-chip"));
  modal.labelEl.value = "Zoom";
  modal.labelEl.dispatch("input", {});
  assert.equal(modal.markdownEl.textContent, "`copy[Zoom]: hello`");
  modal.textEl.value = "";
  modal.textEl.dispatch("input", {});
  assert.equal(modal.statusEl.textContent, helpers.COPY_CHIP_NOTHING_TO_COPY);
  assert.ok(modal.statusEl.classList.contains("is-invalid"));
  const payload = "secret-payload-xyz :: <b>";
  modal.textEl.value = payload;
  modal.textEl.dispatch("input", {});
  for (const [where, value] of allAttrs(modal.contentEl)) {
    assert.equal(value.indexOf("secret-payload-xyz"), -1, "payload leaked into " + where);
  }
});

test("inert fence preview has no focusable copy or fold controls", () => {
  const source = "x";
  const snapshot = helpers.copyChipAuthorResolve({
    source,
    selections: [{ from: 1, to: 1 }],
    clipboardText: "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9",
  }).snapshot;
  const { modal } = openAuthor(snapshot);
  const card = modal.previewHost.querySelector(".bob-copy-fence");
  assert.ok(card);
  const copy = card.querySelector(".bob-copy-fence-copy");
  assert.ok(copy);
  assert.equal(copy.tagName, "SPAN");
  assert.equal(copy.getAttribute("type"), null);
  assert.equal(copy.getAttribute("aria-hidden"), "true");
  assert.equal(card.querySelector(".bob-copy-fence-toggle"), null);
  assert.equal(card.querySelector("button"), null);
  const live = helpers.copyChipBuildFence(new FakeDocument(), { label: "L", text: snapshot.text });
  assert.equal(live.querySelector(".bob-copy-fence-copy").tagName, "BUTTON");
  assert.ok(live.querySelector(".bob-copy-fence-toggle"));
});

test("Esc, Ctrl+[, and q outside fields cancel; q types in a field", () => {
  const snapshot = helpers.copyChipAuthorResolve({
    source: "x",
    selections: [{ from: 1, to: 1 }],
    clipboardText: "hello",
  }).snapshot;
  const { modal, plugin } = openAuthor(snapshot);
  const handler = modal.scopeRefs[0] && modal.scopeRefs[0].fn;
  assert.equal(typeof handler, "function");
  handler({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.equal(modal.closed, true);
  assert.equal(plugin.copyChipAuthorModal, null);

  const second = openAuthor(snapshot);
  second.modal.copyChipOnKey({
    key: "[",
    code: "BracketLeft",
    ctrlKey: true,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(second.modal.closed, true);

  const third = openAuthor(snapshot);
  third.modal.copyChipOnKey({
    key: "q",
    target: third.modal.contentEl,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(third.modal.closed, true);

  const fourth = openAuthor(snapshot);
  fourth.modal.copyChipOnKey({
    key: "q",
    target: fourth.modal.textEl,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(fourth.modal.closed, false);
  assert.equal(fourth.modal.opened, true);
});

test("Tab cycles fields and Enter saves once", () => {
  const snapshot = helpers.copyChipAuthorResolve({
    source: "see hello",
    selections: [{ from: 4, to: 9 }],
  }).snapshot;
  let saves = 0;
  const { modal } = openAuthor(snapshot, {
    onSave: () => {
      saves += 1;
      return true;
    },
  });
  modal.labelEl.focus();
  modal.copyChipOnKey({ key: "Tab", preventDefault() {}, stopPropagation() {} });
  assert.equal(modal.textEl.focused, true);
  modal.copyChipOnKey({ key: "Tab", shiftKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(modal.labelEl.focused, true);
  modal.copyChipOnKey({ key: "Enter", preventDefault() {}, stopPropagation() {} });
  assert.equal(saves, 1);
  assert.equal(modal.closed, true);
  modal.copyChipOnKey({ key: "Enter", preventDefault() {}, stopPropagation() {} });
  assert.equal(saves, 1);
});

test("Shift+Enter inserts a newline in Text", () => {
  const snapshot = helpers.copyChipAuthorResolve({
    source: "x",
    selections: [{ from: 1, to: 1 }],
    clipboardText: "ab",
  }).snapshot;
  const { modal } = openAuthor(snapshot);
  modal.textEl.focus();
  modal.textEl.setSelectionRange(1, 1);
  modal.copyChipOnKey({
    key: "Enter",
    shiftKey: true,
    target: modal.textEl,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(modal.textEl.value, "a\nb");
  assert.equal(modal.captionEl.textContent, "block card · 2 lines");
});

test("late clipboard fill never overwrites typing or a closed card", async () => {
  let resolveClip;
  const promise = new Promise((resolve) => { resolveClip = resolve; });
  const snapshot = helpers.copyChipAuthorResolve({
    source: "x",
    selections: [{ from: 1, to: 1 }],
  }).snapshot;
  const { modal } = openAuthor(snapshot, { clipboardPromise: promise });
  assert.equal(modal.textEl.value, "");
  modal.textEl.value = "typed";
  modal.textEl.dispatch("input", {});
  resolveClip("from-clipboard");
  await promise;
  await tick();
  assert.equal(modal.textEl.value, "typed");

  let resolveClosed;
  const closedPromise = new Promise((resolve) => { resolveClosed = resolve; });
  const second = openAuthor(snapshot, { clipboardPromise: closedPromise });
  second.modal.copyChipCancel();
  resolveClosed("late");
  await closedPromise;
  await tick();
  assert.equal(second.modal.closed, true);
  assert.equal(second.modal.textEl, null);

  let resolveEmpty;
  const emptyPromise = new Promise((resolve) => { resolveEmpty = resolve; });
  const third = openAuthor(snapshot, { clipboardPromise: emptyPromise });
  resolveEmpty("paste me");
  await emptyPromise;
  await tick();
  assert.equal(third.modal.textEl.value, "paste me");
});

test("save writes one transaction and a repeat hotkey saves the open card", () => {
  const source = "see hello";
  const from = source.indexOf("hello");
  const editor = makeEditor(source, [{ from, to: from + 5 }]);
  const view = { file: { path: "note.md" }, editor, _loaded: true, containerEl: { isConnected: true } };
  const plugin = { copyChipAuthorModal: null };
  FakeNotice.messages = [];
  const opened = helpers.copyChipAuthorRun(plugin, editor, view);
  assert.equal(opened, true);
  assert.ok(plugin.copyChipAuthorModal);
  plugin.copyChipAuthorModal.labelEl.value = "L";
  plugin.copyChipAuthorModal.labelEl.dispatch("input", {});
  const again = helpers.copyChipAuthorRun(plugin, editor, view);
  assert.equal(again, true);
  assert.equal(editor._value, "see `copy[L]: hello`");
  assert.equal(editor._dispatches.length, 1);
  assert.equal(plugin.copyChipAuthorModal, null);
});

test("invalid drafts and stale notes write nothing", () => {
  const source = "see hello";
  const from = source.indexOf("hello");
  const editor = makeEditor(source, [{ from, to: from + 5 }]);
  const view = { file: { path: "note.md" }, editor, _loaded: true, containerEl: { isConnected: true } };
  const plugin = { copyChipAuthorModal: null };
  helpers.copyChipAuthorRun(plugin, editor, view);
  plugin.copyChipAuthorModal.textEl.value = "";
  plugin.copyChipAuthorModal.textEl.dispatch("input", {});
  assert.equal(plugin.copyChipAuthorModal.copyChipSave(), false);
  assert.equal(editor._value, source);
  plugin.copyChipAuthorModal.textEl.value = "hello";
  plugin.copyChipAuthorModal.textEl.dispatch("input", {});
  editor._value = "changed";
  FakeNotice.messages = [];
  assert.equal(plugin.copyChipAuthorModal.copyChipSave(), false);
  assert.equal(FakeNotice.messages[0], helpers.COPY_CHIP_AUTHOR_STALE);
  assert.equal(editor._dispatches.length, 0);
});

test("Alt+Click opens the clicked occurrence and never copies", () => {
  const source = "`copy: twin` and `copy: twin`";
  const chips = helpers.copyChipScanLine(source);
  const second = chips[1];
  const editor = makeEditor(source, [{ from: 0, to: 0 }]);
  const view = { file: { path: "note.md" }, editor, _loaded: true, containerEl: { isConnected: true } };
  const plugin = { copyChipAuthorModal: null };
  const cmView = {
    state: {
      doc: { toString: () => source, length: source.length },
      field(name) {
        if (name === editorInfoField) return view;
        return null;
      },
    },
  };
  const start = { x: 0, y: 0 };
  const end = { x: 1, y: 0 };
  assert.equal(
    helpers.copyChipLiveGestureShouldCopy(start, end, { releasedInside: true, button: 0, alt: true }),
    false,
  );
  assert.equal(
    helpers.copyChipLiveGestureShouldEdit(start, end, { releasedInside: true, button: 0, alt: true }),
    true,
  );
  assert.equal(
    helpers.copyChipLiveGestureShouldEdit(start, end, { releasedInside: true, button: 0, alt: false }),
    false,
  );
  const opened = helpers.copyChipAuthorOpenFromWidget(
    plugin,
    cmView,
    second.from,
    second.to,
    { label: null, text: "twin" },
  );
  assert.equal(opened, true);
  assert.ok(plugin.copyChipAuthorModal);
  assert.equal(plugin.copyChipAuthorModal.copyChipSnapshot.from, second.from);
  assert.equal(plugin.copyChipAuthorModal.copyChipSnapshot.to, second.to);
  assert.equal(plugin.copyChipAuthorModal.copyChipSnapshot.text, "twin");
});

test("Live Preview tooltip appends the Alt+Click hint", () => {
  const doc = new FakeDocument();
  const live = helpers.copyChipBuildInline(doc, { label: null, text: "ssh" }, { interactive: false, editHint: true });
  const tip = live.querySelector(".bob-copy-chip-tip");
  assert.equal(tip.textContent, "Click to copy" + helpers.COPY_CHIP_AUTHOR_EDIT_HINT);
  const reading = helpers.copyChipBuildInline(doc, { label: null, text: "ssh" }, { interactive: true });
  const readingTip = reading.querySelector(".bob-copy-chip-tip");
  assert.equal(readingTip.textContent, "Click to copy");
  assert.equal(readingTip.textContent.indexOf("Alt+Click"), -1);
});
