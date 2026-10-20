const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NavigationHotkeysPlugin,
  helpers,
  notices,
} = require("./navigation-hotkeys-harness.cjs");

const { ImageZoomModal } = helpers;

function makeEditor(content, options = {}) {
  const editor = {
    content,
    anchor: { line: 0, ch: options.ch ?? 2 },
    head: { line: 0, ch: options.ch ?? 2 },
    scroll: { left: 12, top: 240 },
    focusCalls: 0,
    selections: [],
    scrollCalls: [],
    getCursor(which) {
      return { ...(which === "anchor" ? this.anchor : this.head) };
    },
    getLine(line) {
      return String(this.content).split(/\r?\n/)[line] ?? null;
    },
    getValue() {
      return this.content;
    },
    getScrollInfo() {
      return { ...this.scroll };
    },
    setSelection(anchor, head) {
      this.selections.push({ anchor: { ...anchor }, head: { ...head } });
      this.anchor = { ...anchor };
      this.head = { ...head };
    },
    scrollTo(left, top) {
      this.scrollCalls.push({ left, top });
      this.scroll = { left, top };
    },
    focus() {
      this.focusCalls += 1;
    },
    replaceRange() {
      throw new Error("image zoom must not edit the editor");
    },
    setValue() {
      throw new Error("image zoom must not replace the editor value");
    },
  };
  return editor;
}

function makeFile(filePath) {
  const name = filePath.split("/").pop();
  return { path: filePath, name, basename: name.replace(/\.[^.]+$/, ""), extension: "png" };
}

function makeRuntime(content = "![[img/x.png]]", options = {}) {
  const editor = makeEditor(content, options);
  const file = { path: "notes/source.md", extension: "md" };
  const view = {
    file,
    editor,
    getMode: () => options.mode || "source",
  };
  let activeView = view;
  const fileMap = new Map([["img/x.png", makeFile("img/x.png")] ]);
  const writes = [];
  const app = {
    metadataCache: {
      getFirstLinkpathDest: (lookup, sourcePath) => {
        assert.equal(sourcePath, file.path);
        return fileMap.get(String(lookup)) || null;
      },
    },
    vault: {
      getResourcePath: (resolved) => `resource://${resolved.path}`,
      read: () => { writes.push("read"); throw new Error("unexpected vault read"); },
      cachedRead: () => { writes.push("cachedRead"); throw new Error("unexpected vault read"); },
      modify: () => { writes.push("modify"); throw new Error("unexpected vault write"); },
      process: () => { writes.push("process"); throw new Error("unexpected vault write"); },
      create: () => { writes.push("create"); throw new Error("unexpected vault write"); },
      delete: () => { writes.push("delete"); throw new Error("unexpected vault write"); },
    },
    workspace: {
      getActiveViewOfType: () => activeView,
    },
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.taskCardPluginUnloading = false;
  plugin.activeImageZoomModal = null;
  return {
    plugin,
    editor,
    file,
    view,
    app,
    writes,
    setActiveView: (next) => { activeView = next; },
    addFile: (lookup, next = makeFile(lookup)) => fileMap.set(lookup, next),
  };
}

function openModal(plugin, editor, view) {
  const originalOpen = ImageZoomModal.prototype.open;
  let modal = null;
  ImageZoomModal.prototype.open = function recordOpen() {
    modal = this;
    return originalOpen.call(this);
  };
  try {
    plugin.zoomImageOnLine(editor, view);
  } finally {
    ImageZoomModal.prototype.open = originalOpen;
  }
  return modal;
}

function stubOnload(plugin, commands) {
  plugin.app = {
    workspace: {
      getActiveFile: () => null,
      on: () => ({}),
      onLayoutReady: () => {},
    },
  };
  plugin.addCommand = (spec) => commands.push(spec);
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.registerVimJumpHistoryVaultEvents = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerReviewRefreshInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerCountedLaneToggleInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
  plugin.captureActiveFilePosition = () => {};
  plugin.refreshDashScrollCaptureTarget = () => {};
  plugin.ensureTemplaterNewNoteTrigger = () => {};
}

test("onload registers the palette command without a default hotkey", () => {
  const plugin = new NavigationHotkeysPlugin();
  const commands = [];
  stubOnload(plugin, commands);
  plugin.onload();

  const command = commands.find((spec) => spec.id === "zoom-image-on-line");
  assert.ok(command);
  assert.equal(command.name, "Zoom image on cursor line");
  assert.equal(typeof command.editorCallback, "function");
  assert.equal(Object.hasOwn(command, "hotkeys"), false);
  assert.equal(plugin.activeImageZoomModal, null);
});

test("an embed and a plain image link open the resolved vault resource", () => {
  for (const line of ["![[img/x.png|400]]", "See [[img/x.png]]"]) {
    const runtime = makeRuntime(line, { ch: 2 });
    const modal = openModal(runtime.plugin, runtime.editor, runtime.view);
    assert.ok(modal, line);
    assert.equal(modal.imageSrc, "resource://img/x.png");
    assert.equal(modal.imageTitle, "x.png");
    assert.equal(runtime.plugin.activeImageZoomModal, modal);
    modal.close();
    assert.deepEqual(runtime.writes, []);
  }
});

test("no image, a missing image, and Reading view show notices without opening", () => {
  notices.length = 0;
  const empty = makeRuntime("A line with no image", { ch: 4 });
  empty.plugin.zoomImageOnLine(empty.editor, empty.view);

  const missing = makeRuntime("See [[img/missing.png]]", { ch: 6 });
  missing.plugin.zoomImageOnLine(missing.editor, missing.view);

  const reading = makeRuntime("![[img/x.png]]", { mode: "preview", ch: 2 });
  reading.plugin.zoomImageOnLine(reading.editor, reading.view);

  assert.deepEqual(notices, [
    "No image on this line",
    "Image not found: img/missing.png",
    "Zoom image needs the editor; in Reading view, click the image",
  ]);
  assert.equal(empty.plugin.activeImageZoomModal, null);
  assert.equal(missing.plugin.activeImageZoomModal, null);
  assert.equal(reading.plugin.activeImageZoomModal, null);
});

test("a second command invocation is ignored while the viewer is open", () => {
  const runtime = makeRuntime();
  const first = openModal(runtime.plugin, runtime.editor, runtime.view);
  assert.ok(first);
  runtime.plugin.zoomImageOnLine(runtime.editor, runtime.view);
  assert.equal(runtime.plugin.activeImageZoomModal, first);
  first.close();
});

test("closing restores focus and leaves an unchanged selection and scroll alone", () => {
  const runtime = makeRuntime();
  const modal = openModal(runtime.plugin, runtime.editor, runtime.view);
  modal.close();
  assert.equal(runtime.editor.focusCalls, 1);
  assert.deepEqual(runtime.editor.selections, []);
  assert.deepEqual(runtime.editor.scrollCalls, []);
});

test("closing restores moved selection and scroll only while the source view is active", () => {
  const runtime = makeRuntime();
  const modal = openModal(runtime.plugin, runtime.editor, runtime.view);
  runtime.editor.anchor = { line: 0, ch: 9 };
  runtime.editor.head = { line: 0, ch: 10 };
  runtime.editor.scroll = { left: 20, top: 500 };
  modal.close();
  assert.deepEqual(runtime.editor.selections, [
    { anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 2 } },
  ]);
  assert.deepEqual(runtime.editor.scrollCalls, [{ left: 12, top: 240 }]);
  assert.equal(runtime.editor.focusCalls, 1);

  const other = makeRuntime();
  const otherModal = openModal(other.plugin, other.editor, other.view);
  other.setActiveView({ file: { path: "notes/other.md" } });
  otherModal.close();
  assert.equal(other.editor.focusCalls, 0);
  assert.deepEqual(other.editor.selections, []);
  assert.deepEqual(other.editor.scrollCalls, []);
});

test("unload closes the active viewer without restoring editor focus", () => {
  const runtime = makeRuntime();
  const modal = openModal(runtime.plugin, runtime.editor, runtime.view);
  runtime.plugin.closeSuccessorPickerForUnload = () => {};
  runtime.plugin.cleanupVimJumpHistoryMappings = () => {};
  runtime.plugin.cancelPendingTaskMoveJump = () => {};
  runtime.plugin.cancelPendingVimJumpDestination = () => {};
  runtime.plugin.onunload();
  assert.equal(modal.imageZoomClosed, true);
  assert.equal(runtime.plugin.activeImageZoomModal, null);
  assert.equal(runtime.editor.focusCalls, 0);
});
