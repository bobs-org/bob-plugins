const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers, notices } = require("./navigation-hotkeys-harness.cjs");
const { ImageZoomModal, imageZoomOriginSuffix, imageZoomMiddleTruncate } = helpers;

function fakeTimers() {
  let nextId = 0;
  const callbacks = new Map();
  const delays = [];
  return {
    callbacks,
    delays,
    setTimeout(callback, delay) {
      const id = ++nextId;
      callbacks.set(id, callback);
      delays.push(delay);
      return id;
    },
    clearTimeout(id) {
      callbacks.delete(id);
    },
  };
}

function makeEditor(line) {
  return {
    content: line,
    transactions: [],
    cursor: { line: 0, ch: 0 },
    getLine(index) {
      return this.content.split(/\r?\n/)[index] ?? null;
    },
    transaction(transaction) {
      this.transactions.push(transaction);
      const change = transaction.changes[0];
      const start = change.from.ch;
      const end = change.to.ch;
      this.content = this.content.slice(0, start) + change.text + this.content.slice(end);
      this.cursor = { ...(transaction.selection.to || transaction.selection.from) };
    },
    replaceRange(text, from, to) {
      this.content = this.content.slice(0, from.ch) + text + this.content.slice(to.ch);
    },
    setCursor(position) {
      this.cursor = { ...position };
    },
  };
}

function makeSession(options = {}) {
  const timers = fakeTimers();
  const lineText = options.lineText || "![[img/x.png|400]]";
  const editor = options.editor || makeEditor(lineText);
  const view = { file: { path: "notes/source.md" }, editor };
  let activeView = view;
  const app = {
    workspace: {
      getActiveViewOfType: () => activeView,
    },
  };
  const restore = options.restore === false
    ? null
    : {
        view,
        editor,
        filePath: "notes/source.md",
        line: 0,
        lineText,
        start: lineText.indexOf("!["),
        end: lineText.length,
      };
  const modal = new ImageZoomModal(app, {
    src: "resource://img/x.png",
    title: "x.png",
    defer: (callback) => callback(),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    context: {
      kind: options.kind || "vault",
      vaultPath: "img/x.png",
      absolutePath: "/vault/img/x.png",
      url: options.url || "https://example.test/x.png",
      restore,
      origin: options.origin === undefined ? null : options.origin,
      justImported: options.justImported || false,
      imported: options.imported || null,
    },
  });
  modal.open();
  return {
    modal,
    editor,
    view,
    timers,
    setActiveView(next) {
      activeView = next;
    },
  };
}

function childText(element) {
  return (element && element.children || []).map((child) => child.textContent || "").join("");
}

function allByClass(root, className, found = []) {
  if (root && root.classList && root.classList.contains(className)) found.push(root);
  for (const child of (root && root.children) || []) allByClass(child, className, found);
  return found;
}

function installClipboard(writeText) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText } },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete globalThis.navigator;
  };
}

test("origin copy uses the tilde display path in every recorded state", async () => {
  for (const state of ["present", "missing", "changed", "elsewhere"]) {
    const copied = [];
    const restoreNavigator = installClipboard(async (text) => copied.push(text));
    const session = makeSession({
      origin: { source: "/Users/bryan/tmp/x.png", display: "~/tmp/x.png", state },
    });
    try {
      await session.modal.handleImageZoomKey({ key: "y" });
      assert.deepEqual(copied, ["~/tmp/x.png"], state);
      const toastText = childText(session.modal.imageZoomToastEl);
      assert.equal(toastText, "✓Copied ~/tmp/x.png");
    } finally {
      session.modal.close();
      restoreNavigator();
    }
  }
});

test("copy falls back to the absolute vault path or URL", async () => {
  const copied = [];
  const restoreNavigator = installClipboard(async (text) => copied.push(text));
  try {
    const vault = makeSession({ origin: null });
    await vault.modal.handleImageZoomKey({ key: "y" });
    vault.modal.close();
    const web = makeSession({ kind: "url", origin: null, url: "https://example.test/a.png" });
    await web.modal.handleImageZoomKey({ key: "y" });
    web.modal.close();
    assert.deepEqual(copied, ["/vault/img/x.png", "https://example.test/a.png"]);
  } finally {
    restoreNavigator();
  }
});

test("y waits for origin lookup before writing the clipboard, even before image load", async () => {
  let resolveOrigin;
  const copied = [];
  const restoreNavigator = installClipboard(async (text) => copied.push(text));
  const pending = new Promise((resolve) => { resolveOrigin = resolve; });
  const session = makeSession({ origin: pending });
  try {
    assert.equal(session.modal.natural, null);
    const copy = session.modal.handleImageZoomKey({ key: "y" });
    assert.deepEqual(copied, []);
    resolveOrigin({ ok: true, origin: { display: "~/tmp/slow.png", state: "missing" } });
    await copy;
    assert.deepEqual(copied, ["~/tmp/slow.png"]);
  } finally {
    session.modal.close();
    restoreNavigator();
  }
});

test("copy failure shows an orange refusal pill without raising a Notice", async () => {
  notices.length = 0;
  const restoreNavigator = installClipboard(async () => { throw new Error("denied"); });
  const session = makeSession({ origin: null });
  try {
    await session.modal.handleImageZoomKey({ key: "y" });
    assert.equal(session.modal.imageZoomToastEl.classList.contains("is-error"), true);
    assert.equal(childText(session.modal.imageZoomToastEl), "!Couldn't copy");
    assert.deepEqual(notices, []);
  } finally {
    session.modal.close();
    restoreNavigator();
  }
});

test("r reports each unavailable origin state in the viewer pill", async () => {
  const cases = [
    [null, "!No original path recorded"],
    [{ display: "~/tmp/x.png", state: "missing" }, "!Original is no longer on disk"],
    [{ display: "~/tmp/x.png", state: "changed" }, "!Original changed since import · y still copies it"],
    [{ display: "~/tmp/x.png", host: "apollo", state: "elsewhere" }, "!Original lives on apollo"],
  ];
  for (const [origin, expected] of cases) {
    const session = makeSession({ origin });
    await session.modal.handleImageZoomKey({ key: "r" });
    assert.equal(session.modal.isOpen, true);
    assert.equal(childText(session.modal.imageZoomToastEl), expected);
    session.modal.close();
  }
  const web = makeSession({ kind: "url", origin: null });
  await web.modal.handleImageZoomKey({ key: "r" });
  assert.equal(childText(web.modal.imageZoomToastEl), "!Web images have no original path");
  web.modal.close();
});

test("successful r replaces only the picked link in one undoable transaction", async () => {
  notices.length = 0;
  const lineText = "- ![[img/x.png|400]]";
  const session = makeSession({
    lineText,
    origin: { display: "~/tmp/x.png", state: "present" },
  });
  const restore = session.modal.imageZoomContext.restore;
  restore.start = 2;
  restore.end = lineText.length;
  await session.modal.handleImageZoomKey({ key: "r" });
  assert.equal(session.editor.content, "- ~/tmp/x.png");
  assert.equal(session.editor.transactions.length, 1);
  assert.deepEqual(session.editor.transactions[0].changes, [{
    from: { line: 0, ch: 2 },
    to: { line: 0, ch: lineText.length },
    text: "~/tmp/x.png",
  }]);
  assert.deepEqual(session.editor.transactions[0].selection, {
    from: { line: 0, ch: 2 },
    to: { line: 0, ch: 2 },
  });
  assert.equal(restore.restoreCursor.ch, 2);
  assert.equal(session.modal.isOpen, false);
  assert.deepEqual(notices, ["Restored ~/tmp/x.png · vault copy kept at img/x.png"]);
});

test("r refuses a changed line and does not edit", async () => {
  const lineText = "![[img/x.png]]";
  const editor = makeEditor("![[img/other.png]]");
  const session = makeSession({
    lineText,
    editor,
    origin: { display: "~/tmp/x.png", state: "present" },
  });
  await session.modal.handleImageZoomKey({ key: "r" });
  assert.equal(editor.transactions.length, 0);
  assert.equal(editor.content, "![[img/other.png]]");
  assert.equal(childText(session.modal.imageZoomToastEl), "!Line changed · nothing restored");
  session.modal.close();
});

test("restore chip only appears for a present origin and toast pills replace one another", () => {
  const present = makeSession({ origin: { display: "~/tmp/x.png", state: "present" } });
  const chips = allByClass(present.modal.imageZoomFooterEl, "bob-image-zoom-chip");
  assert.deepEqual(chips.map((chip) => childText(chip)), [
    "Escclose", "+ / −zoom", "0fit", "11:1", "hjklpan", "ycopy original path", "rrestore path",
  ]);
  present.modal.showImageZoomToast("✓ first");
  present.modal.showImageZoomToast("! second", { error: true });
  assert.equal(present.modal.imageZoomToastEl.classList.contains("is-error"), true);
  assert.equal(childText(present.modal.imageZoomToastEl), "!second");
  assert.deepEqual(present.timers.delays, [1800, 1800]);
  assert.equal(imageZoomOriginSuffix({ state: "changed" }), "changed since import");
  assert.equal(imageZoomOriginSuffix({ state: "missing" }), "no longer on disk");
  assert.equal(imageZoomOriginSuffix({ state: "elsewhere", host: "apollo" }), "on apollo");
  assert.ok(imageZoomMiddleTruncate("x".repeat(200), 20).includes("…"));
  present.modal.close();
});

test("origin line renders each recorded state below the title", () => {
  const cases = [
    [{ display: "~/tmp/x.png", state: "present" }, "↳ ~/tmp/x.png", null],
    [{ display: "~/tmp/x.png", state: "missing" }, "↳ ~/tmp/x.png", "· no longer on disk"],
    [{ display: "~/tmp/x.png", state: "changed" }, "↳ ~/tmp/x.png", "· changed since import"],
    [{ display: "~/tmp/x.png", host: "apollo", state: "elsewhere" }, "↳ ~/tmp/x.png", "· on apollo"],
  ];
  for (const [origin, pathText, stateText] of cases) {
    const session = makeSession({ origin });
    const line = session.modal.imageZoomOriginEl;
    assert.equal(line.classList.contains("is-visible"), true);
    assert.equal(line.children[0].textContent, pathText);
    assert.equal(line.children[1] ? line.children[1].textContent : null, stateText);
    assert.equal(line.getAttribute("title"), `${origin.display}${stateText ? ` ${stateText}` : ""}`);
    session.modal.close();
  }
});

test("imported viewer shows the longer import pill", () => {
  const session = makeSession({
    justImported: true,
    imported: { saved: "img/x.png", reused: true },
    origin: { display: "~/tmp/x.png", state: "present" },
  });
  assert.equal(childText(session.modal.imageZoomToastEl), "✓Linked existing img/x.png · r to undo");
  assert.deepEqual(session.timers.delays, [2600]);
  session.modal.close();
});
