// Tests for bob-ledger-tools task theme marks in Reading view, Tasks
// rows, and Dataview query rows (bob-cli-dm.5.1 task-theme-rendered).
// Covers text-node splitting, nested formatting, code/prose exclusions,
// native Dataview chips, no chip from inherited page fields, origin note
// versus dashboard path, invalid/duplicate repair, unknown themes,
// deferred detached/pending Tasks rows, idempotence, DOM cloning, lazy
// hover, and toggle/unload restoration. The PT13 contract in bob-cli
// `docs/pomodoro-themes.md` is authoritative.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _taskThemeField: "info" };
const editorLivePreviewField = { _taskThemeField: "live" };

class StubWidgetType {}

class StubRangeSetBuilder {
  constructor() {
    this.adds = [];
  }

  add(from, to, value) {
    this.adds.push({ from, to, value });
  }

  finish() {
    return { _decorations: true, adds: this.adds.slice() };
  }
}

const StubDecoration = {
  none: { _decorationNone: true },
  replace: (spec) => ({ _decorationReplace: true, ...spec }),
};

const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => {
      const effect = { value, _effectType: type };
      effect.is = (other) => other === type;
      return effect;
    };
    return type;
  },
};

const StubViewPlugin = {
  fromClass(cls, options) {
    return { _viewPlugin: true, cls, options };
  },
};

function stubSyntaxTree() {
  return { resolveInner: () => null };
}

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

  registerMarkdownPostProcessor(handler, sortOrder) {
    this.postProcessors = this.postProcessors || [];
    this.postProcessors.push({ handler, sortOrder });
  }

  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }

  registerMarkdownCodeBlockProcessor(language, handler) {
    this.codeBlocks = this.codeBlocks || {};
    this.codeBlocks[language] = handler;
  }

  registerInterval(handle) {
    this.intervals = this.intervals || [];
    this.intervals.push(handle);
    return handle;
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
  Module._load = function loadWithTaskThemeRenderedStubs(request) {
    if (request === "obsidian") {
      return {
        MarkdownView: TestMarkdownView,
        Notice: TestNotice,
        Platform: { isDesktopApp: true },
        Plugin: TestPlugin,
        normalizePath: (value) => value,
        parseYaml: (text) => JSON.parse(text),
        editorInfoField,
        editorLivePreviewField,
      };
    }
    if (request === "@codemirror/state") {
      return {
        Prec: { highest: (value) => value },
        StateEffect: StubStateEffect,
        RangeSetBuilder: StubRangeSetBuilder,
      };
    }
    if (request === "@codemirror/view") {
      return {
        EditorView: { updateListener: { of: (listener) => ({ listener }) } },
        keymap: { of: (value) => value },
        ViewPlugin: StubViewPlugin,
        Decoration: StubDecoration,
        WidgetType: StubWidgetType,
      };
    }
    if (request === "@codemirror/language") {
      return { syntaxTree: stubSyntaxTree };
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
const { helpers } = LedgerToolsPlugin;
const {
  taskThemeMarkSourcesInText,
  taskThemeClosestRow,
  taskThemeLiIsTask,
  taskThemeIsThemeInlineField,
  taskThemeQueryAncestor,
  taskThemeParseLineAttr,
  taskThemeOriginFromContext,
} = helpers;

function makeSurfaceApp({ triggers = [] } = {}) {
  const workspaceHandlers = {};
  const metadataHandlers = {};
  return {
    vault: {
      getAbstractFileByPath: () => null,
      cachedRead: () => Promise.resolve(null),
    },
    workspace: {
      on: (event, handler) => {
        workspaceHandlers[event] = workspaceHandlers[event] || [];
        workspaceHandlers[event].push(handler);
        return { event, handler };
      },
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      getLeavesOfType: () => [],
      trigger: (event, ...args) => {
        triggers.push(event);
        for (const handler of workspaceHandlers[event] || []) {
          handler(...args);
        }
      },
    },
    metadataCache: {
      on: (event, handler) => {
        metadataHandlers[event] = metadataHandlers[event] || [];
        metadataHandlers[event].push(handler);
        return { event, handler };
      },
      trigger: (event, ...args) => {
        for (const handler of metadataHandlers[event] || []) {
          handler(...args);
        }
      },
      getCache: () => ({}),
      getFirstLinkpathDest: () => null,
    },
    commands: {},
    plugins: { plugins: {} },
  };
}

function pluginWithThemeStubs({
  known = () => true,
  hue = { hue: "aqua", hue_source: "area" },
  suggest = null,
} = {}) {
  const plugin = new LedgerToolsPlugin(makeSurfaceApp(), {});
  plugin.taskThemeMarksEnabled = true;
  plugin.pomodoroThemeColorsEnabled = true;
  plugin.pomodoroThemeIsKnown = (key) => known(key);
  plugin.pomodoroThemeHueFor = () => hue;
  plugin.pomodoroThemeSuggestFor = () => suggest;
  plugin.applyMarkGateClass = () => {};
  plugin.registerMarkGatePopoutSync = () => {};
  return plugin;
}

function fakeRenderEl() {
  function el(tag, className = "") {
    const node = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      nodeName: String(tag).toUpperCase(),
      className,
      childNodes: [],
      parentNode: null,
      ownerDocument: null,
      isConnected: true,
      _attrs: {},
      classList: {
        contains: (name) =>
          String(node.className || "")
            .split(/\s+/)
            .includes(name),
      },
      getAttribute(name) {
        if (name === "class") {
          return node.className;
        }
        return node._attrs[name] !== undefined ? node._attrs[name] : null;
      },
      hasAttribute(name) {
        return (
          name === "class" ||
          (node._attrs[name] !== undefined && node._attrs[name] !== null)
        );
      },
      setAttribute(name, value) {
        node._attrs[name] = String(value);
        if (name === "class") {
          node.className = String(value);
        }
      },
      removeAttribute(name) {
        delete node._attrs[name];
      },
      closest(selector) {
        let current = node;
        while (current) {
          if (matches(current, selector)) {
            return current;
          }
          current = current.parentNode;
        }
        return null;
      },
      appendChild(child) {
        child.parentNode = node;
        node.childNodes.push(child);
        return child;
      },
      insertBefore(child, ref) {
        child.parentNode = node;
        const at = ref ? node.childNodes.indexOf(ref) : -1;
        if (at === -1) {
          node.childNodes.push(child);
        } else {
          node.childNodes.splice(at, 0, child);
        }
        return child;
      },
      removeChild(child) {
        const at = node.childNodes.indexOf(child);
        if (at !== -1) {
          node.childNodes.splice(at, 1);
        }
        child.parentNode = null;
        return child;
      },
      _listeners: {},
      addEventListener(name, handler) {
        this._listeners[name] = this._listeners[name] || [];
        this._listeners[name].push(handler);
      },
      removeEventListener(name, handler) {
        const list = this._listeners[name] || [];
        this._listeners[name] = list.filter((item) => item !== handler);
      },
    };
    Object.defineProperty(node, "firstChild", {
      get() {
        return node.childNodes[0] || null;
      },
    });
    Object.defineProperty(node, "nextSibling", {
      get() {
        const parent = node.parentNode;
        if (!parent || !parent.childNodes) {
          return null;
        }
        const at = parent.childNodes.indexOf(node);
        return at >= 0 ? parent.childNodes[at + 1] || null : null;
      },
    });
    Object.defineProperty(node, "textContent", {
      get() {
        return collectText(node);
      },
    });
    return node;
  }
  function text(value, doc) {
    const node = {
      nodeType: 3,
      nodeValue: String(value),
      parentNode: null,
      ownerDocument: doc,
    };
    Object.defineProperty(node, "textContent", {
      get() {
        return node.nodeValue;
      },
      set(next) {
        node.nodeValue = String(next);
      },
    });
    Object.defineProperty(node, "nextSibling", {
      get() {
        const parent = node.parentNode;
        if (!parent || !parent.childNodes) {
          return null;
        }
        const at = parent.childNodes.indexOf(node);
        return at >= 0 ? parent.childNodes[at + 1] || null : null;
      },
    });
    return node;
  }
  const doc = {
    createElement: (tag) => {
      const node = el(tag);
      node.ownerDocument = doc;
      return node;
    },
    createElementNS: (ns, tag) => {
      const node = el(tag);
      node.ownerDocument = doc;
      return node;
    },
    createTextNode: (value) => text(value, doc),
    createTreeWalker: (root) => {
      const all = [];
      const stack = [root];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) {
          continue;
        }
        if (node.nodeType === 3) {
          all.push(node);
          continue;
        }
        const kids = node.childNodes || [];
        for (let index = kids.length - 1; index >= 0; index -= 1) {
          stack.push(kids[index]);
        }
      }
      let at = 0;
      return { nextNode: () => (at < all.length ? all[at++] : null) };
    },
    body: null,
  };
  const root = el("div");
  root.ownerDocument = doc;
  doc.body = root;
  return { root, doc, el, text };
}

function matches(node, selector) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (selector === ".bob-pomo-theme[data-task-theme-kind]") {
    return (
      String(node.className || "")
        .split(/\s+/)
        .includes("bob-pomo-theme") && Boolean(node.getAttribute("data-task-theme-kind"))
    );
  }
  if (selector === ".bob-task-theme-host") {
    return String(node.className || "")
      .split(/\s+/)
      .includes("bob-task-theme-host");
  }
  return false;
}

function collectText(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.nodeType === 3) {
      out.push(node.nodeValue);
      continue;
    }
    const kids = node.childNodes || [];
    for (let index = kids.length - 1; index >= 0; index -= 1) {
      stack.push(kids[index]);
    }
  }
  return out.join("");
}

function findClass(root, name) {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (
      node.nodeType === 1 &&
      String(node.className || "")
        .split(/\s+/)
        .includes(name)
    ) {
      return node;
    }
    for (const child of node.childNodes || []) {
      stack.push(child);
    }
  }
  return null;
}

function countClass(root, name) {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (
      node.nodeType === 1 &&
      String(node.className || "")
        .split(/\s+/)
        .includes(name)
    ) {
      count += 1;
    }
    for (const child of node.childNodes || []) {
      stack.push(child);
    }
  }
  return count;
}

function taskLi(fx, className = "task-list-item") {
  const li = fx.doc.createElement("li");
  li.className = className;
  li.setAttribute("data-task", " ");
  fx.root.appendChild(li);
  return li;
}

function ctxFor(sourcePath, extras = {}) {
  return {
    sourcePath,
    getSectionInfo: extras.getSectionInfo || (() => null),
  };
}

test("taskThemeMarkSourcesInText finds bracket, paren, duplicate, and invalid", () => {
  const one = taskThemeMarkSourcesInText("- [ ] Do [theme:: WRITE]");
  assert.equal(one.length, 1);
  assert.equal(one[0].state, "set");
  assert.equal(one[0].value, "WRITE");
  const paren = taskThemeMarkSourcesInText("- [ ] Do (theme:: FIX)");
  assert.equal(paren.length, 1);
  assert.equal(paren[0].value, "FIX");
  const dupe = taskThemeMarkSourcesInText(
    "- [ ] Do [theme:: WRITE] (theme:: FIX)",
  );
  assert.equal(dupe.length, 2);
  assert.equal(dupe[0].state, "repair");
  assert.equal(dupe[0].repair, "duplicate");
  const invalid = taskThemeMarkSourcesInText("- [ ] Do [theme:: ???]");
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].state, "repair");
  assert.equal(taskThemeMarkSourcesInText("plain prose").length, 0);
  assert.deepEqual(taskThemeMarkSourcesInText(null), []);
});

test("rendered views wrap a single-node explicit field and keep surrounding text", () => {
  const plugin = pluginWithThemeStubs();
  const fx = fakeRenderEl();
  const li = taskLi(fx);
  const em = fx.doc.createElement("em");
  em.appendChild(fx.text("Do thing", fx.doc));
  li.appendChild(em);
  li.appendChild(fx.text(" [theme:: WRITE] leftover", fx.doc));
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("notes/a.md"));
  assert.equal(countClass(fx.root, "bob-pomo-theme"), 1);
  assert.equal(countClass(fx.root, "bob-task-theme-host"), 1);
  assert.equal(countClass(fx.root, "bob-task-theme-native"), 1);
  const pill = findClass(fx.root, "bob-pomo-theme");
  assert.equal(pill.getAttribute("data-task-theme-kind"), "pill");
  assert.equal(pill.getAttribute("data-theme-key"), "write");
  assert.equal(collectText(pill), "WRITE");
  assert.ok(collectText(fx.root).indexOf("Do thing") !== -1);
  assert.ok(collectText(fx.root).indexOf("leftover") !== -1);
  const emphasis = (function findEm(node) {
    if (!node) {
      return null;
    }
    if (node.nodeType === 1 && String(node.tagName || "") === "EM") {
      return node;
    }
    for (const child of node.childNodes || []) {
      const found = findEm(child);
      if (found) {
        return found;
      }
    }
    return null;
  })(fx.root);
  assert.ok(emphasis);
  assert.equal(collectText(emphasis), "Do thing");
  const native = findClass(fx.root, "bob-task-theme-native");
  assert.ok(collectText(native).indexOf("[theme:: WRITE]") !== -1);
  const host = findClass(fx.root, "bob-task-theme-host");
  assert.equal(host.getAttribute("data-task-theme-path"), "notes/a.md");
});

test("rendered views join a field split across adjacent text nodes", () => {
  const plugin = pluginWithThemeStubs();
  const fx = fakeRenderEl();
  const li = taskLi(fx);
  li.appendChild(fx.text("Ship it [theme::", fx.doc));
  li.appendChild(fx.text(" WRITE]", fx.doc));
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("notes/a.md"));
  assert.equal(countClass(fx.root, "bob-pomo-theme"), 1);
  assert.ok(collectText(fx.root).indexOf("Ship it") !== -1);
  const native = findClass(fx.root, "bob-task-theme-native");
  assert.ok(collectText(native).indexOf("theme::") !== -1);
});

test("paren delimiter, unknown, duplicate repair, and invalid repair", () => {
  const plugin = pluginWithThemeStubs({
    known: (key) => key !== "mystery",
  });
  const fx = fakeRenderEl();
  const known = taskLi(fx);
  known.appendChild(fx.text("- [ ] A (theme:: WRITE)", fx.doc));
  const unknown = taskLi(fx);
  unknown.appendChild(fx.text("- [ ] B [theme:: MYSTERY]", fx.doc));
  const dupe = taskLi(fx);
  dupe.appendChild(
    fx.text("- [ ] C [theme:: WRITE] [theme:: FIX]", fx.doc),
  );
  const invalid = taskLi(fx);
  invalid.appendChild(fx.text("- [ ] D [theme:: ???]", fx.doc));
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("notes/a.md"));
  const pills = [];
  const stack = [fx.root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (
      node &&
      node.nodeType === 1 &&
      String(node.className || "")
        .split(/\s+/)
        .includes("bob-pomo-theme")
    ) {
      pills.push(node);
    }
    for (const child of (node && node.childNodes) || []) {
      stack.push(child);
    }
  }
  const kinds = pills.map((node) => node.getAttribute("data-task-theme-kind")).sort();
  assert.ok(kinds.includes("pill"));
  assert.ok(kinds.includes("unknown"));
  assert.ok(kinds.includes("repair"));
  const repairs = pills.filter(
    (node) => node.getAttribute("data-task-theme-kind") === "repair",
  );
  assert.ok(repairs.length >= 1);
});

test("code, prose, nested rows, existing pills, and table cells stay raw", () => {
  const plugin = pluginWithThemeStubs();
  const fx = fakeRenderEl();
  const code = fx.doc.createElement("code");
  fx.root.appendChild(code);
  code.appendChild(fx.text("- [ ] X [theme:: WRITE]", fx.doc));
  const para = fx.doc.createElement("p");
  fx.root.appendChild(para);
  para.appendChild(fx.text("Prose [theme:: WRITE] stays", fx.doc));
  const td = fx.doc.createElement("td");
  fx.root.appendChild(td);
  td.appendChild(fx.text("WRITE", fx.doc));
  const parent = taskLi(fx);
  parent.appendChild(fx.text("Parent [theme:: WRITE]", fx.doc));
  const nestedList = fx.doc.createElement("ul");
  parent.appendChild(nestedList);
  const child = fx.doc.createElement("li");
  child.className = "task-list-item";
  child.setAttribute("data-task", " ");
  nestedList.appendChild(child);
  child.appendChild(fx.text("Child [theme:: FIX]", fx.doc));
  const existing = taskLi(fx);
  const host = fx.doc.createElement("span");
  host.className = "bob-task-theme-host";
  host.setAttribute("data-task-theme-host", "true");
  existing.appendChild(host);
  host.appendChild(fx.text("[theme:: WRITE]", fx.doc));
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("notes/a.md"));
  assert.equal(collectText(code).indexOf("[theme:: WRITE]") !== -1, true);
  assert.equal(collectText(para).indexOf("[theme:: WRITE]") !== -1, true);
  assert.equal(countClass(td, "bob-pomo-theme"), 0);
  assert.equal(countClass(child, "bob-pomo-theme"), 1);
  assert.equal(countClass(existing, "bob-pomo-theme"), 0);
});

test("Dataview inline-field chips on task rows become pills; page fields do not", () => {
  const plugin = pluginWithThemeStubs();
  const fx = fakeRenderEl();
  const li = taskLi(fx);
  li.appendChild(fx.text("Ship ", fx.doc));
  const field = fx.doc.createElement("span");
  field.className = "dataview inline-field";
  const key = fx.doc.createElement("span");
  key.className = "inline-field-key";
  key.setAttribute("data-dv-key", "theme");
  key.setAttribute("data-dv-norm-key", "theme");
  key.appendChild(fx.text("theme", fx.doc));
  const value = fx.doc.createElement("span");
  value.className = "inline-field-value";
  value.setAttribute("data-dv-norm-key", "theme");
  value.appendChild(fx.text("FIX", fx.doc));
  field.appendChild(key);
  field.appendChild(value);
  li.appendChild(field);
  const table = fx.doc.createElement("table");
  fx.root.appendChild(table);
  const cell = fx.doc.createElement("td");
  table.appendChild(cell);
  const pageField = fx.doc.createElement("span");
  pageField.className = "dataview inline-field";
  const pageKey = fx.doc.createElement("span");
  pageKey.setAttribute("data-dv-norm-key", "theme");
  pageKey.appendChild(fx.text("theme", fx.doc));
  const pageValue = fx.doc.createElement("span");
  pageValue.className = "inline-field-value";
  pageValue.appendChild(fx.text("CHORE", fx.doc));
  pageField.appendChild(pageKey);
  pageField.appendChild(pageValue);
  cell.appendChild(pageField);
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("dash.md"));
  assert.equal(countClass(li, "bob-pomo-theme"), 1);
  assert.equal(collectText(findClass(li, "bob-pomo-theme")), "FIX");
  assert.equal(countClass(cell, "bob-pomo-theme"), 0);
  assert.ok(taskThemeIsThemeInlineField(pageField));
});

test("query rows keep the originating note, never the dashboard path", () => {
  const plugin = pluginWithThemeStubs();
  const fx = fakeRenderEl();
  const host = fx.doc.createElement("div");
  host.className = "plugin-tasks-query-result";
  fx.root.appendChild(host);
  const li = fx.doc.createElement("li");
  li.className = "plugin-tasks-list-item task-list-item";
  li.setAttribute("data-task", " ");
  li.setAttribute("data-task-path", "areas/sase_blog.md");
  li.setAttribute("data-line", "4");
  host.appendChild(li);
  li.appendChild(fx.text("Write [theme:: WRITE]", fx.doc));
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("dashboard/dash.md"));
  const pillHost = findClass(li, "bob-task-theme-host");
  assert.ok(pillHost);
  assert.equal(
    pillHost.getAttribute("data-task-theme-path"),
    "areas/sase_blog.md",
  );
  assert.equal(pillHost.getAttribute("data-task-theme-line"), "5");
  assert.notEqual(
    pillHost.getAttribute("data-task-theme-path"),
    "dashboard/dash.md",
  );
});

test("without provenance a dashboard query does not invent an origin", () => {
  const plugin = pluginWithThemeStubs();
  const fx = fakeRenderEl();
  const host = fx.doc.createElement("div");
  host.className = "dataview-result-list";
  fx.root.appendChild(host);
  const li = fx.doc.createElement("li");
  li.className = "plugin-tasks-list-item task-list-item";
  li.setAttribute("data-task", " ");
  host.appendChild(li);
  li.appendChild(fx.text("Write [theme:: WRITE]", fx.doc));
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("dashboard/dash.md"));
  const pillHost = findClass(li, "bob-task-theme-host");
  assert.equal(pillHost, null);
  assert.equal(countClass(li, "bob-pomo-theme"), 0);
});

test("idempotent re-render, clone, lazy hover, toggle, and unload restore", () => {
  const plugin = pluginWithThemeStubs({
    suggest: {
      source: "note",
      theme: { key: "write", name: "WRITE" },
      from: { stem: "sase_blog" },
    },
  });
  const fx = fakeRenderEl();
  const li = taskLi(fx);
  li.appendChild(fx.text("Do [theme:: WRITE]", fx.doc));
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("notes/a.md"));
  assert.equal(countClass(fx.root, "bob-task-theme-host"), 1);
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("notes/a.md"));
  assert.equal(countClass(fx.root, "bob-task-theme-host"), 1);
  const cloned = findClass(fx.root, "bob-task-theme-host");
  const cloneRoot = fx.doc.createElement("div");
  fx.root.appendChild(cloneRoot);
  cloneRoot.appendChild(cloned);
  const cloneLi = taskLi(fx);
  cloneLi.appendChild(fx.text("Again [theme:: WRITE]", fx.doc));
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("notes/a.md"));
  assert.ok(countClass(fx.root, "bob-task-theme-host") >= 2);

  const pill = findClass(cloneLi, "bob-pomo-theme");
  assert.ok(pill);
  assert.equal(plugin.taskThemeEnrichMarkElement(null, pill), true);
  const label = pill.getAttribute("aria-label");
  assert.ok(label.indexOf("sase_blog suggests WRITE") !== -1);
  assert.equal(label.indexOf("::"), -1);
  assert.equal(plugin.taskThemeEnrichMarkElement(null, pill), true);
  assert.equal(pill.getAttribute("aria-label"), label);

  const before = collectText(findClass(cloneLi, "bob-task-theme-native"));
  assert.ok(before.indexOf("[theme:: WRITE]") !== -1);
  plugin.taskThemeMarksEnabled = false;
  plugin.taskThemeCancelScheduledWork();
  const restored = plugin.taskThemeRestoreRenderedHosts(fx.root);
  assert.ok(restored >= 1);
  assert.equal(countClass(cloneLi, "bob-pomo-theme"), 0);
  assert.ok(collectText(cloneLi).indexOf("[theme:: WRITE]") !== -1);
});

test("detached and pending Tasks rows retry then drop on disable", () => {
  const plugin = pluginWithThemeStubs();
  const frames = [];
  plugin.taskThemeRequestFrame = (cb) => {
    frames.push(cb);
  };
  const fx = fakeRenderEl();
  const detached = fx.doc.createElement("span");
  detached.isConnected = false;
  detached.appendChild(fx.text("Do [theme:: WRITE]", fx.doc));
  plugin.scheduleTasksResultTaskThemeMarks(detached, ctxFor("dash.md"));
  assert.equal(plugin.tasksTaskThemeMarksQueue.length, 1);
  frames.shift()();
  assert.equal(plugin.tasksTaskThemeMarksQueue.length, 1);
  const row = fx.doc.createElement("li");
  row.className = "plugin-tasks-list-item task-list-item";
  row.isConnected = true;
  row.setAttribute("data-task-path", "areas/sase_blog.md");
  fx.root.appendChild(row);
  row.appendChild(detached);
  detached.isConnected = true;
  detached.parentNode = row;
  frames.shift()();
  assert.equal(plugin.tasksTaskThemeMarksQueue.length, 1);
  row.setAttribute("data-task", " ");
  frames.shift()();
  assert.equal(countClass(row, "bob-pomo-theme"), 1);

  const pending = fx.doc.createElement("li");
  pending.className = "plugin-tasks-list-item";
  pending.isConnected = true;
  fx.root.appendChild(pending);
  const body = fx.doc.createElement("span");
  body.appendChild(fx.text("Next [theme:: FIX]", fx.doc));
  pending.appendChild(body);
  plugin.scheduleTasksResultTaskThemeMarks(body, ctxFor("dash.md"));
  const pendingFrames = frames.slice();
  plugin.taskThemeMarksEnabled = false;
  pendingFrames[0]();
  assert.deepEqual(plugin.tasksTaskThemeMarksQueue, []);
});

test("setup registers the Reading-view postprocessor; helpers never throw", () => {
  const plugin = pluginWithThemeStubs();
  plugin.setupTaskThemeMarks();
  assert.ok(Array.isArray(plugin.postProcessors));
  assert.equal(plugin.postProcessors.length >= 1, true);
  assert.equal(plugin.postProcessors[0].sortOrder, 50);
  assert.equal(taskThemeClosestRow(null), null);
  assert.equal(taskThemeLiIsTask(null), false);
  assert.equal(taskThemeIsThemeInlineField(null), false);
  assert.equal(taskThemeQueryAncestor(null, null), null);
  assert.doesNotThrow(() => plugin.renderTaskThemeMarksIn(null, null));
  assert.doesNotThrow(() => plugin.decorateTaskThemeRenderedRoot(null, null));
  assert.doesNotThrow(() => plugin.taskThemeRestoreRenderedHosts(null));
  assert.doesNotThrow(() => plugin.taskThemeCancelScheduledWork());
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  assert.ok(css.indexOf("body.bob-task-theme-marks .bob-task-theme-native") !== -1);
  assert.ok(css.indexOf(".bob-task-theme-host") !== -1);
});

function dataviewThemeField(fx, value) {
  const field = fx.doc.createElement("span");
  field.className = "dataview inline-field";
  const key = fx.doc.createElement("span");
  key.className = "inline-field-key";
  key.setAttribute("data-dv-key", "theme");
  key.setAttribute("data-dv-norm-key", "theme");
  key.appendChild(fx.text("theme", fx.doc));
  const val = fx.doc.createElement("span");
  val.className = "inline-field-value";
  val.setAttribute("data-dv-norm-key", "theme");
  val.appendChild(fx.text(value, fx.doc));
  field.appendChild(key);
  field.appendChild(val);
  return field;
}

function findKind(root, kind) {
  const stack = [root];
  const found = [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (
      node.nodeType === 1 &&
      node.getAttribute &&
      node.getAttribute("data-task-theme-kind") === kind
    ) {
      found.push(node);
    }
    for (const child of node.childNodes || []) {
      stack.push(child);
    }
  }
  return found;
}

test("missing data-line stays absent; zero-based line zero becomes line 1", () => {
  assert.equal(taskThemeParseLineAttr(null), null);
  assert.equal(taskThemeParseLineAttr(""), null);
  assert.equal(taskThemeParseLineAttr("0"), 1);
  assert.equal(taskThemeParseLineAttr("4"), 5);
  const fx = fakeRenderEl();
  const li = taskLi(fx);
  li.setAttribute("data-task-path", "areas/sase_blog.md");
  const origin = taskThemeOriginFromContext(li, li, ctxFor("dash.md"), null);
  assert.equal(origin.path, "areas/sase_blog.md");
  assert.equal(origin.line, null);
});

test("duplicate native chips and mixed native/raw fields share one repair", () => {
  const plugin = pluginWithThemeStubs();
  const fx = fakeRenderEl();
  const li = taskLi(fx);
  li.appendChild(fx.text("Ship ", fx.doc));
  li.appendChild(dataviewThemeField(fx, "WRITE"));
  li.appendChild(dataviewThemeField(fx, "BUILD"));
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("notes/a.md"));
  const repairs = findKind(li, "repair");
  assert.equal(repairs.length, 2);
  assert.equal(findKind(li, "pill").length, 0);

  const mixed = fakeRenderEl();
  const mixedLi = taskLi(mixed);
  mixedLi.appendChild(mixed.text("Do [theme:: WRITE] ", mixed.doc));
  mixedLi.appendChild(dataviewThemeField(mixed, "BUILD"));
  plugin.renderTaskThemeMarksIn(mixed.root, ctxFor("notes/a.md"));
  assert.ok(findKind(mixedLi, "repair").length >= 1);
  assert.equal(findKind(mixedLi, "pill").length, 0);
});

test("rendered hover supplies source text and skips unresolved enrichment", () => {
  const requests = [];
  const plugin = pluginWithThemeStubs({
    suggest: (request) => {
      requests.push(request);
      return {
        source: "task",
        theme: { key: "write", name: "WRITE" },
        inherited: {
          source: "note",
          theme: { key: "write", name: "WRITE" },
          from: { stem: "sase_blog" },
        },
      };
    },
  });
  plugin.pomodoroThemeSuggestFor = (request) => {
    requests.push(request);
    return {
      source: "task",
      theme: { key: "write", name: "WRITE" },
      inherited: {
        source: "note",
        theme: { key: "write", name: "WRITE" },
        from: { stem: "sase_blog" },
      },
    };
  };
  const fx = fakeRenderEl();
  const host = fx.doc.createElement("div");
  host.className = "plugin-tasks-query-result";
  fx.root.appendChild(host);
  const li = fx.doc.createElement("li");
  li.className = "plugin-tasks-list-item task-list-item";
  li.setAttribute("data-task", " ");
  li.setAttribute("data-task-path", "areas/sase_blog.md");
  host.appendChild(li);
  li.appendChild(fx.text("Write [theme:: WRITE]", fx.doc));
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("dashboard/dash.md"));
  const pill = findClass(li, "bob-pomo-theme");
  assert.ok(pill);
  assert.equal(plugin.taskThemeEnrichMarkElement(null, pill), true);
  assert.ok(requests.length >= 1);
  assert.equal(requests[0].path, "areas/sase_blog.md");
  assert.equal(typeof requests[0].text, "string");
  assert.ok(requests[0].text.indexOf("WRITE") !== -1);
  assert.ok(pill.getAttribute("aria-label").indexOf("sase_blog suggests WRITE") !== -1);

  pill.removeAttribute("data-task-theme-enriched");
  pill.removeAttribute("data-task-theme-path");
  const hostEl = findClass(li, "bob-task-theme-host");
  hostEl.removeAttribute("data-task-theme-path");
  assert.equal(plugin.taskThemeEnrichMarkElement(null, pill), false);
  assert.equal(pill.getAttribute("data-task-theme-enriched"), null);
});

test("native wrappers stay accessible when the marks gate is off", () => {
  const plugin = pluginWithThemeStubs();
  const fx = fakeRenderEl();
  const li = taskLi(fx);
  li.appendChild(fx.text("Do [theme:: WRITE]", fx.doc));
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("notes/a.md"));
  const native = findClass(li, "bob-task-theme-native");
  const pill = findClass(li, "bob-pomo-theme");
  assert.ok(native);
  assert.equal(native.getAttribute("aria-hidden"), "true");
  assert.equal(pill.getAttribute("aria-hidden"), null);
  plugin.taskThemeMarksEnabled = false;
  plugin.taskThemeSyncNativeAccessibility(fx.root);
  assert.equal(native.getAttribute("aria-hidden"), null);
  assert.equal(pill.getAttribute("aria-hidden"), "true");
  plugin.taskThemeMarksEnabled = true;
  plugin.taskThemeSyncNativeAccessibility(fx.root);
  assert.equal(native.getAttribute("aria-hidden"), "true");
  assert.equal(pill.getAttribute("aria-hidden"), null);
});

test("setup refresh and hover teardown cover rendered roots", () => {
  const plugin = pluginWithThemeStubs({
    suggest: {
      source: "note",
      theme: { key: "write", name: "WRITE" },
      from: { stem: "sase_blog" },
    },
  });
  plugin.setupTaskThemeMarks();
  const fx = fakeRenderEl();
  const li = taskLi(fx);
  li.appendChild(fx.text("Do [theme:: WRITE]", fx.doc));
  plugin.renderTaskThemeMarksIn(fx.root, ctxFor("notes/a.md"));
  const pill = findClass(li, "bob-pomo-theme");
  assert.ok(pill);
  const gen = plugin.taskThemeMarksGeneration || 0;
  plugin.themesNotifyChanged("journal");
  assert.ok((plugin.taskThemeMarksGeneration || 0) > gen);
  assert.equal(pill.getAttribute("data-task-theme-enriched"), null);
  plugin.taskThemeEnsureHoverForRoot(fx.root);
  assert.equal(fx.root.__bobTaskThemeHover, true);
  assert.ok((fx.root._listeners.mouseover || []).length >= 1);
  plugin.teardownTaskThemeMarksAndColors();
  assert.equal(fx.root.__bobTaskThemeHover, false);
  assert.equal((fx.root._listeners.mouseover || []).length, 0);
});
