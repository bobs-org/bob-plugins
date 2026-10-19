// Tests for bob-ledger-tools Today marks in rendered views (reading).
// Covers exact section mapping vs. TM19 neutrality, data-line and
// row-index fallback, skipped Tasks/code rows, daily-note sourcePath,
// duplicate ids, insertion points, stamping, the refresh sweep,
// daily-view classes, and delegated Mod+click. The
// `docs/today-marks.md` display contract in bob-cli is authoritative.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }

  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }

  registerMarkdownPostProcessor(handler, order) {
    this.postProcessors = this.postProcessors || [];
    this.postProcessors.push({ handler, order });
  }

  registerDomEvent(el, type, handler, options) {
    this.domEvents = this.domEvents || [];
    this.domEvents.push({ el, type, handler, options });
  }

  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }
}

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

function installStubs() {
  const originalLoad = Module._load;
  Module._load = function loadWithReadingStubs(request) {
    if (request === "obsidian") {
      return {
        MarkdownView: TestMarkdownView,
        Notice: TestNotice,
        Platform: { isMacOS: false, isMobile: false },
        Plugin: TestPlugin,
        normalizePath: (value) => value,
        parseYaml: (text) => JSON.parse(text),
      };
    }
    if (request === "@codemirror/state") {
      return { Prec: { highest: (value) => value } };
    }
    if (request === "@codemirror/view") {
      return {
        EditorView: { updateListener: { of: (listener) => ({ listener }) } },
        keymap: { of: (value) => value },
      };
    }
    return originalLoad.call(this, request, ...Array.prototype.slice.call(arguments, 1));
  };
  return originalLoad;
}

const MAIN_PATH = require.resolve("../plugins/bob-ledger-tools/main.js");

function loadPluginModule() {
  const originalLoad = installStubs();
  try {
    delete require.cache[MAIN_PATH];
    return require(MAIN_PATH);
  } finally {
    Module._load = originalLoad;
  }
}

const LedgerToolsPlugin = loadPluginModule();

function classListFor(node) {
  const read = () =>
    String(
      typeof node.getAttribute === "function" ? node.getAttribute("class") || "" : "",
    )
      .split(/\s+/)
      .filter(Boolean);
  const write = (parts) => {
    if (typeof node.setAttribute === "function") {
      node.setAttribute("class", parts.join(" "));
    }
  };
  return {
    add(...names) {
      const parts = read();
      for (const name of names) {
        if (parts.indexOf(name) === -1) {
          parts.push(name);
        }
      }
      write(parts);
    },
    remove(...names) {
      write(read().filter((part) => names.indexOf(part) === -1));
    },
    contains(name) {
      return read().indexOf(name) !== -1;
    },
    toggle(name, force) {
      const has = this.contains(name);
      if (force === true || (force !== false && !has)) {
        this.add(name);
      } else {
        this.remove(name);
      }
      return this.contains(name);
    },
  };
}

function matchesSelector(node, selector) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  const tag = String(node.tagName || "").toUpperCase();
  const hasClass = (name) =>
    node.classList && typeof node.classList.contains === "function"
      ? node.classList.contains(name)
      : String(node.getAttribute("class") || "")
          .split(/\s+/)
          .indexOf(name) !== -1;
  if (selector === "li") {
    return tag === "LI";
  }
  if (selector === "li[data-bob-today-key]") {
    return tag === "LI" && Boolean(node.getAttribute("data-bob-today-key"));
  }
  if (selector === "li.task-list-item[data-task]") {
    return (
      tag === "LI" &&
      hasClass("task-list-item") &&
      node.getAttribute("data-task") !== null
    );
  }
  if (selector === ".bob-today-mark") {
    return hasClass("bob-today-mark");
  }
  if (selector === "a.tag") {
    return tag === "A" && hasClass("tag");
  }
  if (selector === "input.task-list-item-checkbox") {
    return tag === "INPUT" && hasClass("task-list-item-checkbox");
  }
  return false;
}

function collectMatches(root, selector) {
  const found = [];
  const walk = (node) => {
    if (!node) {
      return;
    }
    if (node.nodeType === 1 && matchesSelector(node, selector)) {
      found.push(node);
    }
    for (const child of node.childNodes || []) {
      walk(child);
    }
  };
  for (const child of root.childNodes || []) {
    walk(child);
  }
  return found;
}

function readingDoc() {
  const doc = {
    nodeType: 9,
    childNodes: [],
    createElement(tag) {
      return readingEl(doc, tag);
    },
    createTextNode(value) {
      return readingText(doc, value);
    },
    querySelectorAll(selector) {
      return collectMatches(this.body || this, selector);
    },
    addEventListener(type, handler, options) {
      this.listeners = this.listeners || [];
      this.listeners.push({ type, handler, options });
    },
  };
  doc.body = readingEl(doc, "body");
  doc.body.parentNode = doc;
  doc.childNodes = [doc.body];
  return doc;
}

function readingText(doc, value) {
  return {
    nodeType: 3,
    nodeValue: String(value),
    parentNode: null,
    nextSibling: null,
    previousSibling: null,
    ownerDocument: doc,
    get textContent() {
      return this.nodeValue;
    },
    set textContent(next) {
      this.nodeValue = String(next);
    },
  };
}

function readingEl(doc, tag, attrs = {}) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    attrs: { ...attrs },
    childNodes: [],
    children: [],
    parentNode: null,
    nextSibling: null,
    previousSibling: null,
    ownerDocument: doc,
    get textContent() {
      return this.childNodes
        .map((child) =>
          child.nodeType === 3
            ? child.nodeValue
            : typeof child.textContent === "string"
              ? child.textContent
              : "",
        )
        .join("");
    },
    set textContent(value) {
      this.childNodes = [];
      this.children = [];
      if (value) {
        this.appendChild(readingText(doc, value));
      }
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name)
        ? this.attrs[name]
        : null;
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    querySelectorAll(selector) {
      return collectMatches(this, selector);
    },
    appendChild(child) {
      return this.insertBefore(child, null);
    },
    insertBefore(child, before) {
      if (child.parentNode && typeof child.parentNode.removeChild === "function") {
        child.parentNode.removeChild(child);
      }
      child.parentNode = this;
      const index =
        before && this.childNodes.indexOf(before) !== -1
          ? this.childNodes.indexOf(before)
          : this.childNodes.length;
      const prev = this.childNodes[index - 1] || null;
      const next = this.childNodes[index] || null;
      child.previousSibling = prev;
      child.nextSibling = next;
      if (prev) {
        prev.nextSibling = child;
      }
      if (next) {
        next.previousSibling = child;
      }
      this.childNodes.splice(index, 0, child);
      if (child.nodeType === 1) {
        const childIndex = this.children.indexOf(next);
        if (next && childIndex !== -1) {
          this.children.splice(childIndex, 0, child);
        } else {
          this.children.push(child);
        }
      }
      return child;
    },
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index === -1) {
        return child;
      }
      const prev = this.childNodes[index - 1] || null;
      const next = this.childNodes[index + 1] || null;
      if (prev) {
        prev.nextSibling = next;
      }
      if (next) {
        next.previousSibling = prev;
      }
      child.parentNode = null;
      child.nextSibling = null;
      child.previousSibling = null;
      this.childNodes.splice(index, 1);
      if (child.nodeType === 1) {
        const childIndex = this.children.indexOf(child);
        if (childIndex !== -1) {
          this.children.splice(childIndex, 1);
        }
      }
      return child;
    },
  };
  node.classList = classListFor(node);
  Object.defineProperty(node, "dataset", {
    value: {
      get bobTodayKey() {
        return node.getAttribute("data-bob-today-key");
      },
      set bobTodayKey(value) {
        node.setAttribute("data-bob-today-key", String(value));
      },
    },
  });
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, value);
  }
  return node;
}

function marksIn(root) {
  const found = [];
  const walk = (node) => {
    if (!node) {
      return;
    }
    if (
      node.nodeType === 1 &&
      String(node.getAttribute && node.getAttribute("class") || "")
        .split(/\s+/)
        .indexOf("bob-today-mark") !== -1
    ) {
      found.push(node);
    }
    for (const child of node.childNodes || []) {
      walk(child);
    }
  };
  walk(root);
  return found;
}

function taskRow(doc, options = {}) {
  const status = options.status === undefined ? "*" : options.status;
  const dataLine = options.dataLine;
  const title = options.title || "Fix";
  const id = options.id || "fix";
  const attrs = { class: "task-list-item", "data-task": status };
  if (dataLine !== undefined && dataLine !== null) {
    attrs["data-line"] = String(dataLine);
  }
  if (options.extraClass) {
    attrs.class += " " + options.extraClass;
  }
  const li = readingEl(doc, "li", attrs);
  if (options.checkbox !== false) {
    li.appendChild(
      readingEl(doc, "input", { class: "task-list-item-checkbox", type: "checkbox" }),
    );
  }
  if (options.tag !== false) {
    const tag = readingEl(doc, "a", { class: "tag" });
    tag.appendChild(readingText(doc, "#task"));
    li.appendChild(tag);
    if (options.ref) {
      const refAttrs = { class: options.refHidden ? "tag bob-ref-task-hidden" : "tag" };
      const ref = readingEl(doc, "a", refAttrs);
      ref.appendChild(readingText(doc, options.refText || "#ref"));
      li.appendChild(ref);
    }
  }
  li.appendChild(
    readingText(doc, options.trailing === undefined ? " " + title + " ^" + id : options.trailing),
  );
  if (options.nested) {
    const nested = readingEl(doc, "ul");
    nested.appendChild(options.nested);
    li.appendChild(nested);
  }
  return li;
}

function section(doc, rows, wrapperTag = "div") {
  const root = readingEl(doc, wrapperTag);
  const list = readingEl(doc, "ul");
  root.appendChild(list);
  for (const row of rows) {
    list.appendChild(row);
  }
  return root;
}

function ctxFor(sourcePath, info) {
  return {
    sourcePath,
    getSectionInfo() {
      return info;
    },
  };
}

function makePlugin(options = {}) {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = options.app || {
    workspace: {
      getLeavesOfType: () => options.leaves || [],
      on: (name, handler) => {
        plugin.workspaceEvents = plugin.workspaceEvents || [];
        plugin.workspaceEvents.push({ name, handler });
        return { name, handler };
      },
    },
    vault: options.vault || {},
  };
  plugin.todayMarksEnabled = options.enabled !== false;
  plugin.todayMarksTimer = null;
  plugin.todayJumpInFlight = false;
  plugin.todayCache = {
    rank: new Map(options.rank || [["area.md#fix", 0]]),
    details: new Map(
      options.details || [
        [
          "area.md#fix",
          [{ name: "GTD", range: "0725-0815", running: true }],
        ],
      ],
    ),
    dailyPath: "2026/20261019.md",
  };
  plugin.isTodayCacheReady = () => options.ready !== false;
  plugin.jumped = [];
  plugin.jumpTodayTaskLink = (key) => {
    plugin.jumped.push(key);
    return true;
  };
  plugin.commands = [];
  plugin.postProcessors = [];
  plugin.domEvents = [];
  plugin.registeredEvents = [];
  plugin.addCommand = TestPlugin.prototype.addCommand;
  plugin.registerEditorExtension = TestPlugin.prototype.registerEditorExtension;
  plugin.registerMarkdownPostProcessor = TestPlugin.prototype.registerMarkdownPostProcessor;
  plugin.registerDomEvent = TestPlugin.prototype.registerDomEvent;
  plugin.registerEvent = TestPlugin.prototype.registerEvent;
  return plugin;
}

const SOURCE = "- [*] #task Fix ^fix";
const SOURCE_TWO = "- [*] #task Fix ^fix\n- [/] #task Other ^other";
const INFO = { text: SOURCE, lineStart: 0, lineEnd: 0 };

test("section info null stays neutral (TM19)", () => {
  const doc = readingDoc();
  const plugin = makePlugin();
  const row = taskRow(doc, { dataLine: "0" });
  const root = section(doc, [row]);
  plugin.renderTodayMarksIn(root, {
    sourcePath: "area.md",
    getSectionInfo: () => null,
  });
  assert.equal(marksIn(root).length, 0);
  assert.equal(row.getAttribute("data-bob-today-key"), null);
});

test("data-line mapping stamps and marks an exact Today row", () => {
  const doc = readingDoc();
  const plugin = makePlugin();
  const row = taskRow(doc, { dataLine: "0" });
  const root = section(doc, [row]);
  plugin.renderTodayMarksIn(root, ctxFor("area.md", INFO));
  assert.equal(row.getAttribute("data-bob-today-key"), "area.md#fix");
  const found = marksIn(root);
  assert.equal(found.length, 1);
  assert.equal(found[0].getAttribute("data-bob-today-key"), "area.md#fix");
  assert.match(found[0].getAttribute("aria-label"), /Today · running in GTD 0725–0815/);
});

test("data-line mapping rejects a status mismatch", () => {
  const doc = readingDoc();
  const plugin = makePlugin();
  const row = taskRow(doc, { status: "/", dataLine: "0" });
  const root = section(doc, [row]);
  plugin.renderTodayMarksIn(root, ctxFor("area.md", INFO));
  assert.equal(row.getAttribute("data-bob-today-key"), null);
  assert.equal(marksIn(root).length, 0);
});

test("row-index fallback maps when counts agree and refuses when they disagree", () => {
  const doc = readingDoc();
  const plugin = makePlugin({
    rank: [
      ["area.md#fix", 0],
      ["area.md#other", 1],
    ],
    details: [
      ["area.md#fix", [{ name: "GTD", range: "0725-0815", running: true }]],
      ["area.md#other", [{ name: "BLOG", running: false }]],
    ],
  });
  const first = taskRow(doc, { title: "Fix", id: "fix" });
  const second = taskRow(doc, { status: "/", title: "Other", id: "other" });
  const root = section(doc, [first, second]);
  const info = { text: SOURCE_TWO, lineStart: 0, lineEnd: 1 };
  plugin.renderTodayMarksIn(root, ctxFor("area.md", info));
  assert.equal(first.getAttribute("data-bob-today-key"), "area.md#fix");
  assert.equal(second.getAttribute("data-bob-today-key"), "area.md#other");
  assert.equal(marksIn(root).length, 2);

  const extra = taskRow(doc, { title: "Ghost", id: "ghost" });
  const disagree = section(doc, [
    taskRow(doc, { title: "Fix", id: "fix" }),
    taskRow(doc, { status: "/", title: "Other", id: "other" }),
    extra,
  ]);
  plugin.renderTodayMarksIn(disagree, ctxFor("area.md", info));
  assert.equal(
    disagree.querySelectorAll("li")[0].getAttribute("data-bob-today-key"),
    null,
  );
  assert.equal(marksIn(disagree).length, 0);
});

test("Tasks result rows and code are skipped", () => {
  const doc = readingDoc();
  const plugin = makePlugin();
  const tasks = taskRow(doc, { dataLine: "0", extraClass: "plugin-tasks-list-item" });
  const tasksRoot = section(doc, [tasks]);
  plugin.renderTodayMarksIn(tasksRoot, ctxFor("area.md", INFO));
  assert.equal(marksIn(tasksRoot).length, 0);

  const pre = readingEl(doc, "pre");
  const codeRow = taskRow(doc, { dataLine: "0" });
  pre.appendChild(codeRow);
  const codeRoot = readingEl(doc, "div");
  codeRoot.appendChild(pre);
  plugin.renderTodayMarksIn(codeRoot, ctxFor("area.md", INFO));
  assert.equal(marksIn(codeRoot).length, 0);
});

test("a daily-note sourcePath is skipped", () => {
  const doc = readingDoc();
  const plugin = makePlugin();
  const row = taskRow(doc, { dataLine: "0" });
  const root = section(doc, [row]);
  plugin.renderTodayMarksIn(root, ctxFor("2026/20261019.md", INFO));
  assert.equal(marksIn(root).length, 0);
  assert.equal(row.getAttribute("data-bob-today-key"), null);
});

test("duplicate ids stay neutral", () => {
  const doc = readingDoc();
  const plugin = makePlugin();
  const source = "- [*] #task Fix ^fix\n- [ ] #task Again ^fix";
  const first = taskRow(doc, { dataLine: "0" });
  const second = taskRow(doc, { status: " ", dataLine: "1", title: "Again" });
  const root = section(doc, [first, second]);
  plugin.renderTodayMarksIn(
    root,
    ctxFor("area.md", { text: source, lineStart: 0, lineEnd: 1 }),
  );
  assert.equal(marksIn(root).length, 0);
  assert.equal(first.getAttribute("data-bob-today-key"), null);
  assert.equal(second.getAttribute("data-bob-today-key"), null);
});

test("insertion points: #task anchor, #ref pair, checkbox, whitespace split", () => {
  const doc = readingDoc();
  const plugin = makePlugin();
  const tagged = taskRow(doc, { dataLine: "0" });
  const taggedRoot = section(doc, [tagged]);
  plugin.renderTodayMarksIn(taggedRoot, ctxFor("area.md", INFO));
  const taggedMark = marksIn(tagged)[0];
  assert.ok(taggedMark);
  const taggedTag = tagged.querySelectorAll("a.tag")[0];
  assert.equal(taggedTag.nextSibling.nodeType, 3);
  assert.equal(taggedTag.nextSibling.nodeValue, " ");
  assert.equal(taggedTag.nextSibling.nextSibling, taggedMark);
  assert.equal(taggedMark.nextSibling.nodeValue, "Fix ^fix");

  const refPlugin = makePlugin({
    rank: [["area.md#read", 0]],
    details: [["area.md#read", [{ name: "BLOG", running: false }]]],
  });
  const refSource = "- [*] #task #ref Read ^read";
  const refRow = taskRow(doc, {
    dataLine: "0",
    id: "read",
    title: "Read",
    ref: true,
  });
  const refRoot = section(doc, [refRow]);
  refPlugin.renderTodayMarksIn(
    refRoot,
    ctxFor("area.md", { text: refSource, lineStart: 0, lineEnd: 0 }),
  );
  const refMark = marksIn(refRow)[0];
  assert.ok(refMark);
  const refAnchor = refRow.querySelectorAll("a.tag")[1];
  assert.equal(refAnchor.nextSibling.nodeType, 3);
  assert.equal(refAnchor.nextSibling.nodeValue, " ");
  assert.equal(refAnchor.nextSibling.nextSibling, refMark);

  const hiddenRow = taskRow(doc, {
    dataLine: "0",
    id: "read",
    title: "Read",
    ref: true,
    refHidden: true,
    refText: "#REF",
  });
  const hiddenRoot = section(doc, [hiddenRow]);
  refPlugin.renderTodayMarksIn(
    hiddenRoot,
    ctxFor("area.md", { text: refSource, lineStart: 0, lineEnd: 0 }),
  );
  const hiddenMark = marksIn(hiddenRow)[0];
  const hiddenAnchor = hiddenRow.querySelectorAll("a.tag")[1];
  assert.equal(hiddenAnchor.nextSibling.nextSibling, hiddenMark);

  const bare = taskRow(doc, { dataLine: "0", tag: false });
  const bareRoot = section(doc, [bare]);
  plugin.renderTodayMarksIn(bareRoot, ctxFor("area.md", INFO));
  const bareMark = marksIn(bare)[0];
  assert.ok(bareMark);
  const checkbox = bare.querySelectorAll("input.task-list-item-checkbox")[0];
  assert.equal(checkbox.nextSibling.nodeType, 3);
  assert.equal(checkbox.nextSibling.nodeValue, " ");
  assert.equal(checkbox.nextSibling.nextSibling, bareMark);
});

test("identity-proven non-Today rows are stamped without a mark", () => {
  const doc = readingDoc();
  const plugin = makePlugin({ rank: [], details: [] });
  const row = taskRow(doc, { dataLine: "0" });
  const root = section(doc, [row]);
  plugin.renderTodayMarksIn(root, ctxFor("area.md", INFO));
  assert.equal(row.getAttribute("data-bob-today-key"), "area.md#fix");
  assert.equal(marksIn(root).length, 0);
});

test("sweep adds on link, removes on unlink or completion, updates tooltip, respects toggle, skips daily ancestors", () => {
  const doc = readingDoc();
  const plugin = makePlugin({ rank: [], details: [] });
  plugin.app.workspace.getLeavesOfType = () => [
    { containerEl: doc.body, view: { containerEl: doc.body, file: { path: "area.md" } } },
  ];
  const row = taskRow(doc, { dataLine: "0" });
  const root = section(doc, [row]);
  doc.body.appendChild(root);
  plugin.renderTodayMarksIn(root, ctxFor("area.md", INFO));
  assert.equal(marksIn(row).length, 0);

  plugin.todayCache.rank.set("area.md#fix", 0);
  plugin.todayCache.details.set("area.md#fix", [
    { name: "GTD", range: "0725-0815", running: true },
  ]);
  plugin.sweepTodayMarksReading();
  assert.equal(marksIn(row).length, 1);
  assert.match(marksIn(row)[0].getAttribute("aria-label"), /running in GTD/);

  plugin.todayCache.details.set("area.md#fix", [
    { name: "BLOG", running: false },
  ]);
  plugin.sweepTodayMarksReading();
  assert.equal(marksIn(row).length, 1);
  assert.match(marksIn(row)[0].getAttribute("aria-label"), /queued in BLOG/);

  plugin.todayCache.rank.delete("area.md#fix");
  plugin.todayCache.details.delete("area.md#fix");
  plugin.sweepTodayMarksReading();
  assert.equal(marksIn(row).length, 0);

  plugin.todayCache.rank.set("area.md#fix", 0);
  plugin.todayCache.details.set("area.md#fix", [
    { name: "GTD", range: "0725-0815", running: true },
  ]);
  plugin.sweepTodayMarksReading();
  assert.equal(marksIn(row).length, 1);
  row.setAttribute("data-task", "x");
  plugin.sweepTodayMarksReading();
  assert.equal(marksIn(row).length, 0);

  row.setAttribute("data-task", "*");
  plugin.sweepTodayMarksReading();
  assert.equal(marksIn(row).length, 1);
  plugin.todayMarksEnabled = false;
  plugin.sweepTodayMarksReading();
  assert.equal(marksIn(row).length, 0);

  plugin.todayMarksEnabled = true;
  doc.body.classList.add("bob-daily-note-view");
  plugin.sweepTodayMarksReading();
  assert.equal(marksIn(row).length, 0);
});

test("daily-view class is set on open daily leaves and cleared on switch", () => {
  const doc = readingDoc();
  const daily = readingEl(doc, "div");
  const area = readingEl(doc, "div");
  const plugin = makePlugin();
  const leaves = [
    { containerEl: daily, view: { containerEl: daily, file: { path: "2026/20261019.md" } } },
    { containerEl: area, view: { containerEl: area, file: { path: "area.md" } } },
  ];
  plugin.app.workspace.getLeavesOfType = () => leaves;
  plugin.refreshDailyNoteViewClasses();
  assert.equal(daily.classList.contains("bob-daily-note-view"), true);
  assert.equal(area.classList.contains("bob-daily-note-view"), false);
  leaves[0].view.file.path = "area.md";
  plugin.refreshDailyNoteViewClasses();
  assert.equal(daily.classList.contains("bob-daily-note-view"), false);
});

test("delegated Mod+click jumps; plain click does not", () => {
  const doc = readingDoc();
  const plugin = makePlugin();
  plugin.app.workspace.getLeavesOfType = () => [
    {
      containerEl: doc.body,
      view: { containerEl: doc.body, file: { path: "area.md" } },
    },
  ];
  const row = taskRow(doc, { dataLine: "0" });
  const root = section(doc, [row]);
  plugin.renderTodayMarksIn(root, ctxFor("area.md", INFO));
  const mark = marksIn(row)[0];
  assert.ok(mark);
  plugin.setupTodayMarksReadingClicks();
  const bound = (plugin.domEvents || []).find((entry) => entry.type === "click");
  assert.ok(bound);
  assert.equal(bound.options && bound.options.capture, true);

  let prevented = false;
  bound.handler({
    target: mark,
    button: 0,
    ctrlKey: true,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
  });
  assert.equal(prevented, true);
  assert.deepEqual(plugin.jumped, ["area.md#fix"]);

  plugin.jumped = [];
  bound.handler({
    target: mark,
    button: 0,
    ctrlKey: false,
    preventDefault() {
      throw new Error("plain click must not preventDefault");
    },
  });
  assert.deepEqual(plugin.jumped, []);
});

test("setupTodayMarks registers the reading post-processor at order 60", () => {
  const plugin = makePlugin();
  plugin.createTodayMarkExtension = () => null;
  plugin.scheduleTodayMarksRefresh = () => {};
  plugin.setupTodayMarks();
  assert.equal(plugin.postProcessors.length, 1);
  assert.equal(plugin.postProcessors[0].order, 60);
});

test("styles.css daily-view suppression is present", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"),
    "utf8",
  );
  assert.match(css, /\.bob-daily-note-view \.bob-today-mark\s*\{/);
  assert.match(css, /display:\s*none;/);
});

test("Live Preview marks do not double-jump in Reading view", () => {
  const doc = readingDoc();
  const plugin = makePlugin();
  plugin.app.workspace.getLeavesOfType = () => [
    { containerEl: doc.body, view: { containerEl: doc.body } },
  ];
  const row = taskRow(doc, { dataLine: "0" });
  const root = section(doc, [row]);
  doc.body.appendChild(root);
  plugin.renderTodayMarksIn(root, ctxFor("area.md", INFO));
  const mark = marksIn(row)[0];
  assert.ok(mark);
  const editor = readingEl(doc, "div", { class: "cm-editor" });
  const inner = readingEl(doc, "div");
  editor.appendChild(inner);
  inner.appendChild(mark);
  plugin.setupTodayMarksReadingClicks();
  const bound = (plugin.domEvents || []).find((entry) => entry.type === "click");
  assert.ok(bound);
  let prevented = false;
  bound.handler({
    target: mark,
    button: 0,
    ctrlKey: true,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
  });
  assert.equal(prevented, false);
  assert.deepEqual(plugin.jumped, []);
});

test("mid-body #task goes at the body start", () => {
  const doc = readingDoc();
  const plugin = makePlugin({
    rank: [["area.md#mid", 0]],
    details: [["area.md#mid", [{ name: "GTD", running: false }]]],
  });
  const source = "- [*] Fix the build #task ^mid";
  const row = taskRow(doc, { dataLine: "0", tag: false, title: "Fix the build #task", id: "mid" });
  const root = section(doc, [row]);
  plugin.renderTodayMarksIn(
    root,
    ctxFor("area.md", { text: source, lineStart: 0, lineEnd: 0 }),
  );
  assert.equal(row.getAttribute("data-bob-today-place"), "body");
  const mark = marksIn(row)[0];
  assert.ok(mark);
  const checkbox = row.querySelectorAll("input.task-list-item-checkbox")[0];
  assert.equal(checkbox.nextSibling.nodeType, 3);
  assert.equal(checkbox.nextSibling.nextSibling, mark);
  const doc2 = readingDoc();
  const plugin2 = makePlugin({
    rank: [["area.md#mid", 0]],
    details: [["area.md#mid", [{ name: "GTD", running: false }]]],
  });
  plugin2.app.workspace.getLeavesOfType = () => [
    { containerEl: doc2.body, view: { containerEl: doc2.body } },
  ];
  const row2 = taskRow(doc2, { dataLine: "0", tag: false, title: "Fix the build #task", id: "mid" });
  const root2 = section(doc2, [row2]);
  doc2.body.appendChild(root2);
  plugin2.renderTodayMarksIn(
    root2,
    ctxFor("area.md", { text: source, lineStart: 0, lineEnd: 0 }),
  );
  const mark2 = marksIn(row2)[0];
  assert.ok(mark2);
  plugin2.sweepTodayMarksReading();
  const swept = marksIn(row2)[0];
  assert.ok(swept);
  const checkbox2 = row2.querySelectorAll("input.task-list-item-checkbox")[0];
  assert.equal(checkbox2.nextSibling.nextSibling, swept);
});

test("#task inside inline code stays neutral", () => {
  const doc = readingDoc();
  const plugin = makePlugin({
    rank: [["area.md#fix", 0]],
    details: [["area.md#fix", [{ name: "GTD", running: false }]]],
  });
  const source = "- [*] `x #task` Fix ^fix";
  const row = taskRow(doc, { dataLine: "0", title: "`x #task` Fix", id: "fix" });
  const root = section(doc, [row]);
  plugin.renderTodayMarksIn(
    root,
    ctxFor("area.md", { text: source, lineStart: 0, lineEnd: 0 }),
  );
  assert.equal(marksIn(root).length, 0);
  assert.equal(row.getAttribute("data-bob-today-key"), null);
});

test("re-render with a new path refreshes the mark key", () => {
  const doc = readingDoc();
  const plugin = makePlugin({
    rank: [
      ["area.md#fix", 0],
      ["other.md#fix", 1],
    ],
    details: [
      ["area.md#fix", [{ name: "GTD", running: false }]],
      ["other.md#fix", [{ name: "BLOG", running: false }]],
    ],
  });
  const row = taskRow(doc, { dataLine: "0" });
  const root = section(doc, [row]);
  plugin.renderTodayMarksIn(root, ctxFor("area.md", INFO));
  const first = marksIn(row)[0];
  assert.ok(first);
  assert.equal(first.getAttribute("data-bob-today-key"), "area.md#fix");
  plugin.renderTodayMarksIn(root, ctxFor("other.md", INFO));
  const second = marksIn(row)[0];
  assert.ok(second);
  assert.equal(second.getAttribute("data-bob-today-key"), "other.md#fix");
});

test("one duplicate scan per render", () => {
  const doc = readingDoc();
  const plugin = makePlugin({
    rank: [
      ["area.md#fix", 0],
      ["area.md#other", 1],
    ],
    details: [
      ["area.md#fix", [{ name: "GTD", running: false }]],
      ["area.md#other", [{ name: "BLOG", running: false }]],
    ],
  });
  const source = "- [*] #task Fix ^fix\n- [/] #task Other ^other";
  const first = taskRow(doc, { title: "Fix", id: "fix" });
  const second = taskRow(doc, { status: "/", title: "Other", id: "other" });
  const root = section(doc, [first, second]);
  const info = { text: source, lineStart: 0, lineEnd: 1 };
  let scans = 0;
  const original = plugin.todayMarkDuplicateSet.bind(plugin);
  plugin.todayMarkDuplicateSet = (lines, ids) => {
    scans += 1;
    return original(lines, ids);
  };
  plugin.renderTodayMarksIn(root, ctxFor("area.md", info));
  assert.equal(marksIn(root).length, 2);
  assert.equal(scans, 1);
});

test("row-index fallback uses every list item", () => {
  const doc = readingDoc();
  const plugin = makePlugin();
  const plain = readingEl(doc, "li");
  plain.appendChild(doc.createTextNode("Depends-On: foo"));
  const task = taskRow(doc, { title: "Fix", id: "fix" });
  task.appendChild(readingEl(doc, "ul"));
  task.childNodes[task.childNodes.length - 1].appendChild(plain);
  const list = readingEl(doc, "ul");
  list.appendChild(task);
  const root = readingEl(doc, "div");
  root.appendChild(list);
  const source = "- [*] #task Fix ^fix\n  - Depends-On: foo";
  const info = { text: source, lineStart: 0, lineEnd: 1 };
  plugin.renderTodayMarksIn(root, ctxFor("area.md", info));
  assert.equal(task.getAttribute("data-bob-today-key"), "area.md#fix");
  assert.equal(marksIn(task).length, 1);
  const doc2 = readingDoc();
  const plugin2 = makePlugin();
  const ghost = taskRow(doc2, { title: "Ghost", id: "ghost" });
  const task2 = taskRow(doc2, { title: "Fix", id: "fix" });
  const extra = taskRow(doc2, { status: "/", title: "Other", id: "other" });
  const list2 = readingEl(doc2, "ul");
  list2.appendChild(ghost);
  list2.appendChild(task2);
  list2.appendChild(extra);
  const root2 = readingEl(doc2, "div");
  root2.appendChild(list2);
  plugin2.renderTodayMarksIn(root2, ctxFor("area.md", info));
  assert.equal(marksIn(root2).length, 0);
});
