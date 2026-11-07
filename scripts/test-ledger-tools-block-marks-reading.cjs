// DOM coverage for blocked-reason marks in rendered views.
// Reading view, embeds, hover previews, and Dataview TASK rows share the
// classifier; Tasks query rows stay excluded. Source mapping is exact or
// a conservative own-text fallback. Never reads the vault.
const assert = require("node:assert/strict");
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
  register(fn) {
    this.cleanups = this.cleanups || [];
    this.cleanups.push(fn);
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
const { BLOCK_MARK_READING_PROCESSOR_ORDER } = LedgerToolsPlugin.helpers;

const TODAY = "2026-11-01";
const FUTURE = "2026-11-20";
const OPEN_TASK = {
  id: "x",
  status: { type: "TODO" },
  path: "Projects/Prerequisites.md",
  blockId: "x",
  description: "Finish the battery #task [id:: x]",
};

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
        if (parts.indexOf(name) === -1) parts.push(name);
      }
      write(parts);
    },
    remove(...names) {
      write(read().filter((part) => names.indexOf(part) === -1));
    },
    contains(name) {
      return read().indexOf(name) !== -1;
    },
  };
}

function matchesSelector(node, selector) {
  if (!node || node.nodeType !== 1) return false;
  const tag = String(node.tagName || "").toUpperCase();
  const hasClass = (name) =>
    node.classList && typeof node.classList.contains === "function"
      ? node.classList.contains(name)
      : String(node.getAttribute("class") || "").split(/\s+/).indexOf(name) !== -1;
  if (selector === "li") return tag === "LI";
  if (selector === "li.task-list-item") {
    return tag === "LI" && hasClass("task-list-item");
  }
  if (selector === "li.task-list-item[data-task]") {
    return tag === "LI" && hasClass("task-list-item") && node.getAttribute("data-task") !== null;
  }
  if (selector === "input.task-list-item-checkbox") {
    return tag === "INPUT" && hasClass("task-list-item-checkbox");
  }
  return false;
}

function collectMatches(root, selector) {
  const found = [];
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 1 && matchesSelector(node, selector)) found.push(node);
    for (const child of node.childNodes || []) walk(child);
  };
  for (const child of root.childNodes || []) walk(child);
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
    addEventListener() {},
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
    attrs: {},
    childNodes: [],
    children: [],
    parentNode: null,
    nextSibling: null,
    previousSibling: null,
    ownerDocument: doc,
    _connected: true,
    get isConnected() {
      if (this._connected === false) return false;
      let current = this;
      let guard = 0;
      while (current && guard < 50) {
        guard += 1;
        if (current.nodeType === 9) return true;
        current = current.parentNode;
      }
      return this._connected !== false;
    },
    get parentElement() {
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    },
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
      if (value) this.appendChild(readingText(doc, value));
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attrs[name];
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
      if (prev) prev.nextSibling = child;
      if (next) next.previousSibling = child;
      this.childNodes.splice(index, 0, child);
      if (child.nodeType === 1) {
        const childIndex = this.children.indexOf(next);
        if (next && childIndex !== -1) this.children.splice(childIndex, 0, child);
        else this.children.push(child);
      }
      return child;
    },
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index === -1) return child;
      const prev = this.childNodes[index - 1] || null;
      const next = this.childNodes[index + 1] || null;
      if (prev) prev.nextSibling = next;
      if (next) next.previousSibling = prev;
      child.parentNode = null;
      child.nextSibling = null;
      child.previousSibling = null;
      this.childNodes.splice(index, 1);
      if (child.nodeType === 1) {
        const childIndex = this.children.indexOf(child);
        if (childIndex !== -1) this.children.splice(childIndex, 1);
      }
      return child;
    },
  };
  node.classList = classListFor(node);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, value);
  }
  return node;
}

function taskRow(doc, options = {}) {
  const status = options.status === undefined ? "?" : options.status;
  const attrs = { class: "task-list-item", "data-task": status };
  if (options.dataLine !== undefined && options.dataLine !== null) {
    attrs["data-line"] = String(options.dataLine);
  }
  if (options.path) attrs["data-task-path"] = options.path;
  if (options.extraClass) attrs.class += " " + options.extraClass;
  const li = readingEl(doc, "li", attrs);
  const checkbox = readingEl(doc, "input", {
    class: "task-list-item-checkbox",
    type: "checkbox",
  });
  if (options.aria) checkbox.setAttribute("aria-label", options.aria);
  if (options.tooltipPosition) {
    checkbox.setAttribute("data-tooltip-position", options.tooltipPosition);
  }
  li.appendChild(checkbox);
  if (options.tag !== false) {
    const tag = readingEl(doc, "a", { class: "tag" });
    tag.appendChild(readingText(doc, "#task"));
    li.appendChild(tag);
    li.appendChild(readingText(doc, " "));
  }
  if (options.prj) {
    const prj = readingEl(doc, "a", {
      class: "tag",
      href: "#prj_is_blocked",
    });
    prj.appendChild(readingText(doc, "#prj_is_blocked"));
    li.appendChild(prj);
    li.appendChild(readingText(doc, " "));
  }
  if (options.awaiting) {
    const awaiting = readingEl(doc, "a", {
      class: "tag",
      href: options.awaiting === true ? "#awaiting_reply" : options.awaiting,
    });
    awaiting.appendChild(
      readingText(doc, options.awaiting === true ? "#awaiting_reply" : options.awaiting),
    );
    li.appendChild(awaiting);
    li.appendChild(readingText(doc, " "));
  }
  li.appendChild(readingText(doc, options.trailing === undefined ? " Ship" : options.trailing));
  if (options.pill) {
    const pill = readingEl(doc, "span", { class: options.pill });
    pill.appendChild(readingText(doc, " Oct 22"));
    li.appendChild(pill);
  }
  if (options.code) {
    const code = readingEl(doc, "code");
    code.appendChild(readingText(doc, options.code));
    li.appendChild(code);
  }
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
  for (const row of rows) list.appendChild(row);
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

function makePlugin(tasks = [OPEN_TASK]) {
  const memo = { tasks };
  let diskReads = 0;
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => memo.tasks } } },
    workspace: {
      trigger() {},
      getLeavesOfType: () => [],
      on: () => ({}),
    },
    vault: {
      cachedRead() {
        diskReads += 1;
        throw new Error("rendered block marks must not read the vault");
      },
    },
    metadataCache: {
      getFirstLinkpathDest(path) {
        return path ? { path: String(path).endsWith(".md") ? path : path + ".md" } : null;
      },
    },
  };
  plugin.freshnessEnsureMemo = () => memo;
  plugin.dateMarksToday = () => TODAY;
  plugin.blockMarksEnabled = true;
  plugin.blockMarksLadder = null;
  plugin.blockMarksLadderReady = true;
  plugin.blockMarkEditorViews = new Set();
  plugin.blockMarkTooltipBindings = new Map();
  plugin.postProcessors = [];
  plugin.cleanups = [];
  plugin.registerMarkdownPostProcessor = function register(handler, order) {
    this.postProcessors.push({ handler, order });
  };
  plugin.register = function register(fn) {
    this.cleanups.push(fn);
  };
  plugin.diskReads = () => diskReads;
  plugin.memo = memo;
  plugin.blockMarkReadingFrame = (cb) => {
    plugin.queuedFrames = plugin.queuedFrames || [];
    plugin.queuedFrames.push(cb);
  };
  plugin.flushFrames = () => {
    const frames = plugin.queuedFrames || [];
    plugin.queuedFrames = [];
    for (const cb of frames) cb();
  };
  return plugin;
}

function attrsOf(li) {
  return {
    key: li.getAttribute("data-bob-block"),
    family: li.getAttribute("data-bob-block-family"),
    more: li.getAttribute("data-bob-block-more"),
  };
}

function checkboxOf(li) {
  return li.childNodes.find(
    (child) =>
      child.nodeType === 1 &&
      String(child.tagName) === "INPUT" &&
      child.classList.contains("task-list-item-checkbox"),
  );
}

const FAMILIES = [
  {
    id: "dep",
    line: "- [?] #task Ship [dependsOn:: x]",
    trailing: " Ship [dependsOn:: x]",
    key: "dep",
    family: "held",
    more: null,
  },
  {
    id: "prj",
    line: "- [?] #task Review #prj_is_blocked",
    trailing: " Review",
    prj: true,
    key: "prj",
    family: "held",
    more: null,
  },
  {
    id: "p2",
    line: `- [?] #task Brush [priority:: medium] [scheduled:: ${FUTURE}]`,
    trailing: ` Brush [priority:: medium] [scheduled:: ${FUTURE}]`,
    key: "p2",
    family: "waiting",
    more: null,
  },
  {
    id: "p1",
    line: `- [?] #task Fast [priority:: high] [scheduled:: ${FUTURE}]`,
    trailing: ` Fast [priority:: high] [scheduled:: ${FUTURE}]`,
    key: "p1",
    family: "waiting",
    more: null,
  },
  {
    id: "p3",
    line: "- [?] #task Slow [priority:: low] [scheduled:: 2026-12-20]",
    trailing: " Slow [priority:: low] [scheduled:: 2026-12-20]",
    key: "p3",
    family: "waiting",
    more: null,
  },
  {
    id: "p4",
    line: "- [?] #task Later [priority:: lowest] [scheduled:: 2027-03-01]",
    trailing: " Later [priority:: lowest] [scheduled:: 2027-03-01]",
    key: "p4",
    family: "waiting",
    more: null,
  },
  {
    id: "repeat",
    line: "- [?] #task Water [repeat:: every day when done] [scheduled:: 2026-11-02]",
    trailing: " Water [repeat:: every day when done] [scheduled:: 2026-11-02]",
    key: "repeat",
    family: "waiting",
    more: null,
  },
  {
    id: "date",
    line: `- [?] #task Hand [scheduled:: ${FUTURE}]`,
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
    key: "date",
    family: "waiting",
    more: null,
  },
  {
    id: "stale",
    line: "- [?] #task Alone",
    trailing: " Alone",
    key: "stale",
    family: "stale",
    more: null,
  },
  {
    id: "pip",
    line: `- [?] #task Held [dependsOn:: x] [scheduled:: ${FUTURE}]`,
    trailing: ` Held [dependsOn:: x] [scheduled:: ${FUTURE}]`,
    key: "dep",
    family: "held",
    more: "date",
  },
];

test("registers the reading processor before field-transforming marks", () => {
  const plugin = makePlugin();
  plugin.setupBlockMarksReading();
  assert.equal(plugin.postProcessors.length, 1);
  assert.equal(plugin.postProcessors[0].order, 40);
  assert.equal(BLOCK_MARK_READING_PROCESSOR_ORDER, 40);
});

test("maps every family and pip from exact section source", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const lines = FAMILIES.map((row) => row.line);
  const rows = FAMILIES.map((row, index) =>
    taskRow(doc, {
      dataLine: index,
      trailing: row.trailing,
      prj: row.prj,
    }),
  );
  const root = section(doc, rows);
  const ctx = ctxFor("Projects/Example.md", {
    text: lines.join("\n"),
    lineStart: 0,
    lineEnd: lines.length - 1,
  });
  plugin.renderBlockMarksIn(root, ctx);
  FAMILIES.forEach((expected, index) => {
    const got = attrsOf(rows[index]);
    assert.equal(got.key, expected.key, expected.id);
    assert.equal(got.family, expected.family, expected.id);
    assert.equal(got.more, expected.more, expected.id);
    const box = checkboxOf(rows[index]);
    assert.ok(box.getAttribute("aria-label"));
    assert.equal(box.getAttribute("data-tooltip-position"), "top");
  });
  assert.equal(plugin.diskReads(), 0);
});

test("section-only text uses data-line offsets; full-note text adds lineStart", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const line = `- [?] #task Hand [scheduled:: ${FUTURE}]`;
  const heading = "# Heading";
  const full = `${heading}\n${line}`;
  const row = taskRow(doc, { dataLine: 0, trailing: ` Hand [scheduled:: ${FUTURE}]` });
  const root = section(doc, [row]);
  plugin.renderBlockMarksIn(
    root,
    ctxFor("Projects/Example.md", { text: line, lineStart: 1, lineEnd: 1 }),
  );
  assert.equal(attrsOf(row).key, "date");

  const pluginFull = makePlugin();
  const docFull = readingDoc();
  const rowFull = taskRow(docFull, {
    dataLine: 0,
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
  });
  const rootFull = section(docFull, [rowFull]);
  pluginFull.renderBlockMarksIn(
    rootFull,
    ctxFor("Projects/Example.md", { text: full, lineStart: 1, lineEnd: 1 }),
  );
  assert.equal(attrsOf(rowFull).key, "date");
});

test("quoted tasks and nested children classify independently", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const child = taskRow(doc, {
    dataLine: 1,
    trailing: ` Nested [scheduled:: ${FUTURE}]`,
  });
  const parent = taskRow(doc, {
    dataLine: 0,
    trailing: " Parent [dependsOn:: x]",
    nested: child,
  });
  const quote = readingEl(doc, "blockquote");
  const quoted = taskRow(doc, {
    dataLine: 2,
    trailing: ` Quoted [scheduled:: ${FUTURE}]`,
  });
  const root = section(doc, [parent]);
  quote.appendChild(section(doc, [quoted], "div"));
  root.appendChild(quote);
  const ctx = ctxFor("Projects/Example.md", {
    text: [
      "- [?] #task Parent [dependsOn:: x]",
      `- [?] #task Nested [scheduled:: ${FUTURE}]`,
      `> - [?] #task Quoted [scheduled:: ${FUTURE}]`,
    ].join("\n"),
    lineStart: 0,
    lineEnd: 2,
  });
  plugin.renderBlockMarksIn(root, ctx);
  assert.equal(attrsOf(parent).key, "dep");
  assert.equal(attrsOf(child).key, "date");
  assert.equal(attrsOf(quoted).key, "date");
  assert.equal(parent.getAttribute("data-bob-block"), "dep");
  assert.notEqual(child.getAttribute("data-bob-block"), "dep");
});

test("cold cache stays unmarked until Tasks is ready, then sweep paints", () => {
  const plugin = makePlugin([]);
  plugin.memo.tasks = [];
  const doc = readingDoc();
  const row = taskRow(doc, { dataLine: 0, trailing: " Ship [dependsOn:: x]" });
  const root = section(doc, [row]);
  const ctx = ctxFor("Projects/Example.md", {
    text: "- [?] #task Ship [dependsOn:: x]",
    lineStart: 0,
    lineEnd: 0,
  });
  plugin.renderBlockMarksIn(root, ctx);
  assert.equal(attrsOf(row).key, null);
  plugin.memo.tasks = [OPEN_TASK];
  delete plugin.memo.blockMarksIdIndex;
  plugin.sweepBlockMarksReading();
  assert.equal(attrsOf(row).key, "dep");
});

test("removed fields and recycled rows invalidate the retained mapping", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, {
    dataLine: 0,
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
  });
  const root = section(doc, [row]);
  const ctx = ctxFor("Projects/Example.md", {
    text: `- [?] #task Hand [scheduled:: ${FUTURE}]`,
    lineStart: 0,
    lineEnd: 0,
  });
  plugin.renderBlockMarksIn(root, ctx);
  assert.equal(attrsOf(row).key, "date");
  const cleared = ctxFor("Projects/Example.md", {
    text: "- [?] #task Hand",
    lineStart: 0,
    lineEnd: 0,
  });
  plugin.renderBlockMarksIn(root, cleared);
  assert.equal(attrsOf(row).key, "stale");

  row.setAttribute("data-line", "1");
  row.setAttribute("data-task", "*");
  plugin.renderBlockMarksIn(
    root,
    ctxFor("Projects/Example.md", {
      text: "- [?] #task Hand\n- [*] #task Next",
      lineStart: 0,
      lineEnd: 1,
    }),
  );
  assert.equal(attrsOf(row).key, null);
});

test("mismatched status or origin stays unmarked", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, {
    dataLine: 0,
    status: "?",
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
  });
  const root = section(doc, [row]);
  plugin.renderBlockMarksIn(
    root,
    ctxFor("Projects/Example.md", {
      text: `- [*] #task Hand [scheduled:: ${FUTURE}]`,
      lineStart: 0,
      lineEnd: 0,
    }),
  );
  assert.equal(attrsOf(row).key, null);
});

test("own-text fallback accepts raw fields and rejects transformed pills", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const raw = taskRow(doc, {
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
  });
  const transformed = taskRow(doc, {
    trailing: " Hand",
    pill: "bob-date-mark",
  });
  const coded = taskRow(doc, {
    trailing: " example",
    code: "#task",
  });
  const root = section(doc, [raw, transformed, coded]);
  const ctx = { sourcePath: "Projects/Example.md" };
  plugin.renderBlockMarksIn(root, ctx);
  assert.equal(attrsOf(raw).key, "date");
  assert.equal(attrsOf(transformed).key, null);
  assert.equal(attrsOf(coded).key, null);
});

test("fallback never manufactures stale from lost field information", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, { trailing: " Alone" });
  const root = section(doc, [row]);
  plugin.renderBlockMarksIn(root, { sourcePath: "Projects/Example.md" });
  assert.equal(attrsOf(row).key, null);
});

test("Dataview delayed rows use proven origin and never the query note stem", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const host = readingEl(doc, "div", { class: "block-language-dataview" });
  const ctx = ctxFor("Queries/Inbox.md", {
    text: "```dataview\nTASK WHERE true\n```",
    lineStart: 0,
    lineEnd: 2,
  });
  plugin.renderBlockMarksIn(host, ctx);
  assert.equal(plugin.blockMarkReadingHosts.size, 1);

  const row = taskRow(doc, {
    trailing: " Review",
    prj: true,
    path: "Projects/Example.md",
  });
  host.appendChild(row);
  plugin.sweepBlockMarksReading();
  assert.equal(attrsOf(row).key, "prj");
  const box = checkboxOf(row);
  assert.match(box.getAttribute("aria-label"), /via project Example/);
  assert.doesNotMatch(box.getAttribute("aria-label"), /Inbox/);
});

test("query result indexes are not read as source lines", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const host = readingEl(doc, "div", { class: "block-language-dataview" });
  const row = taskRow(doc, {
    dataLine: 0,
    trailing: " Query row",
  });
  host.appendChild(row);
  plugin.renderBlockMarksIn(
    host,
    ctxFor("Queries/Inbox.md", {
      text: `- [?] #task Query decoy [scheduled:: ${FUTURE}]`,
      lineStart: 0,
      lineEnd: 0,
    }),
  );
  assert.equal(attrsOf(row).key, null);
});

test("Tasks query rows stay excluded", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, {
    extraClass: "plugin-tasks-list-item",
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
    dataLine: 0,
  });
  const query = readingEl(doc, "ul", { class: "plugin-tasks-query-result" });
  query.appendChild(row);
  const root = readingEl(doc, "div");
  root.appendChild(query);
  plugin.renderBlockMarksIn(
    root,
    ctxFor("Projects/Example.md", {
      text: `- [?] #task Hand [scheduled:: ${FUTURE}]`,
      lineStart: 0,
      lineEnd: 0,
    }),
  );
  assert.equal(attrsOf(row).key, null);
});

test("source-note lis Tasks also classifies still take JS marks", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, {
    extraClass: "plugin-tasks-list-item",
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
    dataLine: 0,
  });
  const root = section(doc, [row]);
  plugin.renderBlockMarksIn(
    root,
    ctxFor("Projects/Example.md", {
      text: `- [?] #task Hand [scheduled:: ${FUTURE}]`,
      lineStart: 0,
      lineEnd: 0,
    }),
  );
  assert.equal(attrsOf(row).key, "date");
});

test("tooltip attributes restore when the mark leaves or the toggle turns off", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, {
    dataLine: 0,
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
    aria: "Existing name",
    tooltipPosition: "left",
  });
  const root = section(doc, [row]);
  const ctx = ctxFor("Projects/Example.md", {
    text: `- [?] #task Hand [scheduled:: ${FUTURE}]`,
    lineStart: 0,
    lineEnd: 0,
  });
  plugin.renderBlockMarksIn(root, ctx);
  const box = checkboxOf(row);
  assert.match(box.getAttribute("aria-label"), /^Blocked · until /);
  assert.equal(box.getAttribute("data-tooltip-position"), "top");

  plugin.blockMarksEnabled = false;
  plugin.sweepBlockMarksReading();
  assert.equal(attrsOf(row).key, null);
  assert.equal(box.getAttribute("aria-label"), "Existing name");
  assert.equal(box.getAttribute("data-tooltip-position"), "left");

  plugin.blockMarksEnabled = true;
  plugin.sweepBlockMarksReading();
  assert.equal(attrsOf(row).key, "date");
  assert.match(box.getAttribute("aria-label"), /^Blocked · until /);
});

test("toggle off and on reclassifies tracked hosts in place", () => {
  TestNotice.messages.length = 0;
  const plugin = makePlugin();
  plugin.applyMarkGateClass = () => {};
  plugin.refreshBlockMarkEditors = () => {};
  const doc = readingDoc();
  const row = taskRow(doc, {
    dataLine: 0,
    trailing: " Ship [dependsOn:: x]",
  });
  const root = section(doc, [row]);
  plugin.renderBlockMarksIn(
    root,
    ctxFor("Projects/Example.md", {
      text: "- [?] #task Ship [dependsOn:: x]",
      lineStart: 0,
      lineEnd: 0,
    }),
  );
  assert.equal(attrsOf(row).key, "dep");
  plugin.toggleBlockMarks();
  assert.equal(attrsOf(row).key, null);
  plugin.toggleBlockMarks();
  assert.equal(attrsOf(row).key, "dep");
});

test("detached hosts dispose observers and drop owned attributes", () => {
  const plugin = makePlugin();
  const observed = [];
  plugin.blockMarksMutationObserver = class StubObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
    }
    observe(el) {
      observed.push(el);
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  const doc = readingDoc();
  const row = taskRow(doc, {
    dataLine: 0,
    trailing: " Ship [dependsOn:: x]",
  });
  const root = section(doc, [row]);
  plugin.renderBlockMarksIn(
    root,
    ctxFor("Projects/Example.md", {
      text: "- [?] #task Ship [dependsOn:: x]",
      lineStart: 0,
      lineEnd: 0,
    }),
  );
  assert.equal(observed.length, 1);
  assert.equal(attrsOf(row).key, "dep");
  const rec = Array.from(plugin.blockMarkReadingHosts)[0];
  const observer = rec.observer;
  root._connected = false;
  row._connected = false;
  plugin.sweepBlockMarksReading();
  assert.equal(plugin.blockMarkReadingHosts.size, 0);
  assert.equal(observer.disconnected, true);
  assert.equal(attrsOf(row).key, null);
});

test("retained canonical text survives later field-transforming processors", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, {
    dataLine: 0,
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
  });
  const root = section(doc, [row]);
  plugin.renderBlockMarksIn(
    root,
    ctxFor("Projects/Example.md", {
      text: `- [?] #task Hand [scheduled:: ${FUTURE}]`,
      lineStart: 0,
      lineEnd: 0,
    }),
  );
  assert.equal(attrsOf(row).key, "date");
  const pill = readingEl(doc, "span", { class: "bob-date-mark" });
  pill.appendChild(readingText(doc, " Nov 20"));
  row.appendChild(pill);
  plugin.sweepBlockMarksReading();
  assert.equal(attrsOf(row).key, "date");
  assert.equal(plugin.diskReads(), 0);
});

test("landing: recycled fallback row must drop the old scheduled reason", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, { trailing: ` Hand [scheduled:: ${FUTURE}]` });
  const root = section(doc, [row]);
  const ctx = { sourcePath: "Projects/Example.md" };
  plugin.renderBlockMarksIn(root, ctx);
  assert.equal(attrsOf(row).key, "date");
  row.childNodes[row.childNodes.length - 1].nodeValue = " Replacement without a date";
  plugin.sweepBlockMarksReading();
  assert.equal(attrsOf(row).key, null);
});

test("landing: off-state sweep must preserve a later external tooltip", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, { dataLine: 0, aria: "Original" });
  const root = section(doc, [row]);
  plugin.renderBlockMarksIn(
    root,
    ctxFor("Projects/Example.md", {
      text: `- [?] #task Hand [scheduled:: ${FUTURE}]`,
      lineStart: 0,
      lineEnd: 0,
    }),
  );
  plugin.blockMarksEnabled = false;
  plugin.sweepBlockMarksReading();
  const box = checkboxOf(row);
  box.setAttribute("aria-label", "New external label");
  plugin.sweepBlockMarksReading();
  assert.equal(box.getAttribute("aria-label"), "New external label");
});

test("landing: a Tasks row used as processor root must stay excluded", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, {
    extraClass: "plugin-tasks-list-item",
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
  });
  plugin.renderBlockMarksIn(row, { sourcePath: "Projects/Example.md" });
  assert.equal(attrsOf(row).key, null);
});

test("landing: Dataview without proven origin must remain neutral", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const host = readingEl(doc, "div", { class: "block-language-dataview" });
  const row = taskRow(doc, { trailing: ` Hand [scheduled:: ${FUTURE}]` });
  host.appendChild(row);
  plugin.renderBlockMarksIn(host, { sourcePath: "Queries/Inbox.md" });
  assert.equal(attrsOf(row).key, null);
});

test("Dataview transformed rows recover canonical text from the Tasks cache", () => {
  const plugin = makePlugin([
    OPEN_TASK,
    {
      id: "bm4",
      status: { type: "TODO" },
      path: "block-marks.md",
      description: "BM4 dep vector #task [dependsOn:: x]",
    },
  ]);
  const doc = readingDoc();
  const host = readingEl(doc, "div", { class: "block-language-dataview" });
  const row = taskRow(doc, { trailing: " BM4 dep vector", path: "block-marks.md" });
  const field = readingEl(doc, "span", { class: "dataview inline-field" });
  field.appendChild(readingText(doc, "x"));
  row.appendChild(field);
  host.appendChild(row);
  plugin.renderBlockMarksIn(host, { sourcePath: "Queries/Inbox.md" });
  assert.equal(attrsOf(row).key, "dep");

  const unproven = taskRow(doc, { trailing: " BM4 dep vector" });
  const unprovenField = readingEl(doc, "span", { class: "dataview inline-field" });
  unprovenField.appendChild(readingText(doc, "x"));
  unproven.appendChild(unprovenField);
  host.appendChild(unproven);
  plugin.renderBlockMarksIn(host, { sourcePath: "Queries/Inbox.md" });
  assert.equal(attrsOf(unproven).key, null);
});

test("Dataview file links prove origin without data-task-path", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const host = readingEl(doc, "div", { class: "block-language-dataview" });
  const row = taskRow(doc, { trailing: " Review", prj: true });
  const link = readingEl(doc, "a", { class: "internal-link", "data-href": "Projects/Example.md" });
  link.appendChild(readingText(doc, "Example"));
  row.appendChild(link);
  host.appendChild(row);
  plugin.renderBlockMarksIn(host, { sourcePath: "Queries/Inbox.md" });
  assert.equal(attrsOf(row).key, "prj");
  assert.match(checkboxOf(row).getAttribute("aria-label"), /via project Example/);
});

test("code and pre processor roots stay excluded like Tasks roots", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, { trailing: ` Hand [scheduled:: ${FUTURE}]` });
  const pre = readingEl(doc, "pre");
  pre.appendChild(row);
  plugin.renderBlockMarksIn(pre, { sourcePath: "Projects/Example.md" });
  assert.equal(attrsOf(row).key, null);

  const coded = taskRow(doc, { trailing: ` Hand [scheduled:: ${FUTURE}]` });
  const code = readingEl(doc, "code");
  code.appendChild(coded);
  plugin.renderBlockMarksIn(code, { sourcePath: "Projects/Example.md" });
  assert.equal(attrsOf(coded).key, null);
});

test("source-note fallback still paints when section mapping is absent", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, { trailing: ` Hand [scheduled:: ${FUTURE}]` });
  const root = section(doc, [row]);
  plugin.renderBlockMarksIn(root, { sourcePath: "Projects/Example.md" });
  assert.equal(attrsOf(row).key, "date");
});

test("query origin-loss and same-status origin-change invalidate retained marks", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const host = readingEl(doc, "div", { class: "block-language-dataview" });
  const row = taskRow(doc, {
    trailing: " Review",
    prj: true,
    path: "Projects/Example.md",
  });
  host.appendChild(row);
  plugin.renderBlockMarksIn(host, { sourcePath: "Queries/Inbox.md" });
  assert.equal(attrsOf(row).key, "prj");
  const box = checkboxOf(row);
  assert.match(box.getAttribute("aria-label"), /via project Example/);
  assert.doesNotMatch(box.getAttribute("aria-label"), /Inbox/);

  row.removeAttribute("data-task-path");
  plugin.sweepBlockMarksReading();
  assert.equal(attrsOf(row).key, null);

  row.setAttribute("data-task-path", "Projects/Other.md");
  plugin.sweepBlockMarksReading();
  assert.equal(attrsOf(row).key, "prj");
  assert.match(checkboxOf(row).getAttribute("aria-label"), /via project Other/);
  assert.doesNotMatch(checkboxOf(row).getAttribute("aria-label"), /Example/);
});

test("repeated off sweeps, unload, and toggle after an external aria edit", () => {
  TestNotice.messages.length = 0;
  const plugin = makePlugin();
  plugin.applyMarkGateClass = () => {};
  plugin.refreshBlockMarkEditors = () => {};
  const doc = readingDoc();
  const row = taskRow(doc, {
    dataLine: 0,
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
    aria: "Original",
  });
  const root = section(doc, [row]);
  const ctx = ctxFor("Projects/Example.md", {
    text: `- [?] #task Hand [scheduled:: ${FUTURE}]`,
    lineStart: 0,
    lineEnd: 0,
  });
  plugin.renderBlockMarksIn(root, ctx);
  const box = checkboxOf(row);
  assert.match(box.getAttribute("aria-label"), /^Blocked · until /);

  plugin.blockMarksEnabled = false;
  plugin.sweepBlockMarksReading();
  plugin.sweepBlockMarksReading();
  assert.equal(box.getAttribute("aria-label"), "Original");

  box.setAttribute("aria-label", "External after off");
  plugin.blockMarksEnabled = true;
  plugin.sweepBlockMarksReading();
  assert.equal(attrsOf(row).key, "date");
  assert.match(box.getAttribute("aria-label"), /^Blocked · until /);
  plugin.blockMarksEnabled = false;
  plugin.sweepBlockMarksReading();
  assert.equal(box.getAttribute("aria-label"), "External after off");

  plugin.blockMarksEnabled = true;
  plugin.sweepBlockMarksReading();
  plugin.teardownBlockMarksReading();
  assert.equal(attrsOf(row).key, null);
  assert.equal(box.getAttribute("aria-label"), "External after off");
});

test("replacement checkbox nodes do not inherit the previous node's attributes", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, {
    dataLine: 0,
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
    aria: "Original",
  });
  const root = section(doc, [row]);
  plugin.renderBlockMarksIn(
    root,
    ctxFor("Projects/Example.md", {
      text: `- [?] #task Hand [scheduled:: ${FUTURE}]`,
      lineStart: 0,
      lineEnd: 0,
    }),
  );
  const oldBox = checkboxOf(row);
  assert.match(oldBox.getAttribute("aria-label"), /^Blocked · until /);
  row.removeChild(oldBox);
  const fresh = readingEl(doc, "input", {
    class: "task-list-item-checkbox",
    type: "checkbox",
  });
  fresh.setAttribute("aria-label", "Replacement");
  row.insertBefore(fresh, row.childNodes[0] || null);
  plugin.blockMarksEnabled = false;
  plugin.sweepBlockMarksReading();
  assert.equal(fresh.getAttribute("aria-label"), "Replacement");
  assert.match(oldBox.getAttribute("aria-label"), /^Blocked · until /);
});

test("neutral status transition releases owned tooltip attributes", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const row = taskRow(doc, {
    dataLine: 0,
    trailing: ` Hand [scheduled:: ${FUTURE}]`,
    aria: "Keep me",
  });
  const root = section(doc, [row]);
  plugin.renderBlockMarksIn(
    root,
    ctxFor("Projects/Example.md", {
      text: `- [?] #task Hand [scheduled:: ${FUTURE}]`,
      lineStart: 0,
      lineEnd: 0,
    }),
  );
  row.setAttribute("data-task", "*");
  plugin.sweepBlockMarksReading();
  assert.equal(attrsOf(row).key, null);
  assert.equal(checkboxOf(row).getAttribute("aria-label"), "Keep me");
});

function projectTagOf(li) {
  return (li.children || []).find(
    (child) =>
      child &&
      typeof child.getAttribute === "function" &&
      child.getAttribute("href") === "#prj_is_blocked",
  );
}

test("BM7 folds the project tag; BM19 keeps it", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const folded = taskRow(doc, {
    dataLine: 0,
    prj: true,
    trailing: " Hold",
  });
  const kept = taskRow(doc, {
    dataLine: 1,
    prj: true,
    trailing: " After [dependsOn:: x]",
  });
  const root = section(doc, [folded, kept]);
  const ctx = ctxFor("Projects/Example.md", {
    text: [
      "- [?] #task Hold #prj_is_blocked",
      "- [?] #task After #prj_is_blocked [dependsOn:: x]",
    ].join("\n"),
    lineStart: 0,
    lineEnd: 1,
  });
  plugin.renderBlockMarksIn(root, ctx);
  plugin.renderBlockMarkFoldsIn(root);
  assert.equal(attrsOf(folded).key, "prj");
  assert.equal(projectTagOf(folded).getAttribute("data-bob-block-folded"), "true");
  assert.equal(attrsOf(kept).key, "dep");
  assert.equal(projectTagOf(kept).getAttribute("data-bob-block-folded"), null);

  plugin.blockMarksEnabled = false;
  plugin.sweepBlockMarksReading();
  plugin.sweepBlockMarkFoldsReading();
  assert.equal(projectTagOf(folded).getAttribute("data-bob-block-folded"), null);
});

test("source-note lis Tasks also classifies still fold BM7 and keep BM19", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const folded = taskRow(doc, {
    dataLine: 0,
    extraClass: "plugin-tasks-list-item",
    prj: true,
    trailing: " Hold",
  });
  const kept = taskRow(doc, {
    dataLine: 1,
    extraClass: "plugin-tasks-list-item",
    prj: true,
    trailing: " After [dependsOn:: x]",
  });
  const root = section(doc, [folded, kept]);
  const ctx = ctxFor("Projects/Example.md", {
    text: [
      "- [?] #task Hold #prj_is_blocked",
      "- [?] #task After #prj_is_blocked [dependsOn:: x]",
    ].join("\n"),
    lineStart: 0,
    lineEnd: 1,
  });
  plugin.renderBlockMarksIn(root, ctx);
  plugin.renderBlockMarkFoldsIn(root);
  assert.equal(attrsOf(folded).key, "prj");
  assert.equal(projectTagOf(folded).getAttribute("data-bob-block-folded"), "true");
  assert.equal(attrsOf(kept).key, "dep");
  assert.equal(projectTagOf(kept).getAttribute("data-bob-block-folded"), null);
});

function tagOf(li, href) {
  return (li.children || []).find(
    (child) =>
      child &&
      typeof child.getAttribute === "function" &&
      child.getAttribute("href") === href,
  );
}

test("AW1 folds the #awaiting_reply pill; AW3, AW6, and prj rows keep it", () => {
  const plugin = makePlugin();
  const doc = readingDoc();
  const folded = taskRow(doc, {
    dataLine: 0,
    awaiting: true,
    trailing: ` Lease [scheduled:: ${FUTURE}]`,
  });
  const losing = taskRow(doc, {
    dataLine: 1,
    awaiting: true,
    trailing: ` Lease [scheduled:: ${FUTURE}] [dependsOn:: x]`,
  });
  const nearMiss = taskRow(doc, {
    dataLine: 2,
    awaiting: "#awaiting_reply_old",
    trailing: ` Lease [scheduled:: ${FUTURE}]`,
  });
  const project = taskRow(doc, {
    dataLine: 3,
    prj: true,
    awaiting: true,
    trailing: ` Lease [scheduled:: ${FUTURE}]`,
  });
  const root = section(doc, [folded, losing, nearMiss, project]);
  const ctx = ctxFor("Projects/Example.md", {
    text: [
      `- [?] #task #awaiting_reply Lease [scheduled:: ${FUTURE}]`,
      `- [?] #task #awaiting_reply Lease [scheduled:: ${FUTURE}] [dependsOn:: x]`,
      `- [?] #task #awaiting_reply_old Lease [scheduled:: ${FUTURE}]`,
      `- [?] #task #prj_is_blocked #awaiting_reply Lease [scheduled:: ${FUTURE}]`,
    ].join("\n"),
    lineStart: 0,
    lineEnd: 3,
  });
  plugin.renderBlockMarksIn(root, ctx);
  plugin.renderBlockMarkFoldsIn(root);

  assert.deepEqual(attrsOf(folded), { key: "awaiting", family: "waiting", more: null });
  assert.equal(tagOf(folded, "#awaiting_reply").getAttribute("data-bob-block-folded"), "true");
  assert.equal(
    checkboxOf(folded).getAttribute("aria-label"),
    "Awaiting reply · nudge Fri, Nov 20 · in 19 days",
  );

  assert.deepEqual(attrsOf(losing), { key: "dep", family: "held", more: "awaiting" });
  assert.equal(tagOf(losing, "#awaiting_reply").getAttribute("data-bob-block-folded"), null);

  assert.equal(attrsOf(nearMiss).key, "date");
  assert.equal(
    tagOf(nearMiss, "#awaiting_reply_old").getAttribute("data-bob-block-folded"),
    null,
  );

  assert.deepEqual(attrsOf(project), { key: "prj", family: "held", more: "awaiting" });
  assert.equal(tagOf(project, "#prj_is_blocked").getAttribute("data-bob-block-folded"), "true");
  assert.equal(tagOf(project, "#awaiting_reply").getAttribute("data-bob-block-folded"), null);

  plugin.blockMarksEnabled = false;
  plugin.sweepBlockMarksReading();
  plugin.sweepBlockMarkFoldsReading();
  assert.equal(tagOf(folded, "#awaiting_reply").getAttribute("data-bob-block-folded"), null);
  assert.equal(tagOf(project, "#prj_is_blocked").getAttribute("data-bob-block-folded"), null);
});
