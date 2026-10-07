// Tests for bob-ledger-tools task date marks in Tasks query results
// (bob-cli-53 tasks-results). Builds a fake Tasks 8.4.0 DOM with an
// injectable frame scheduler and covers the T vectors verbatim (today
// is 2026-10-07, a Wednesday): full-mode decoration, short-mode
// untouched-by-JS, pending-row retries and exhaustion, idempotency,
// out-of-scope classes, invalid dates, scheduling gates, rollover
// relabel of Tasks-host marks, and the styles.css contract. The
// `docs/date-marks.md` display contract in bob-cli is authoritative.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _tasksDateMarkField: "info" };
const editorLivePreviewField = { _tasksDateMarkField: "live" };

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

function installStubs(isDesktopApp = true) {
  const originalLoad = Module._load;
  Module._load = function loadWithTasksDateMarkStubs(request) {
    if (request === "obsidian") {
      return {
        MarkdownView: TestMarkdownView,
        Notice: TestNotice,
        Platform: { isDesktopApp },
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

function loadPluginModule(isDesktopApp = true) {
  const originalLoad = installStubs(isDesktopApp);
  try {
    delete require.cache[MAIN_PATH];
    return require(MAIN_PATH);
  } finally {
    Module._load = originalLoad;
  }
}

const LedgerToolsPlugin = loadPluginModule(true);

// Conformance today: 2026-10-07 (Wednesday).
const TODAY = "2026-10-07";

function makeSurfaceApp({ triggers = [], leaves = [] } = {}) {
  return {
    vault: {
      getAbstractFileByPath: () => null,
      cachedRead: () => Promise.resolve(null),
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      getLeavesOfType: () => leaves,
      trigger: (event) => triggers.push(event),
    },
    metadataCache: {
      on: () => ({}),
      getCache: () => ({}),
      getFirstLinkpathDest: () => null,
    },
    commands: {},
    plugins: { plugins: {} },
  };
}

function pluginWithToday(today = TODAY) {
  const plugin = new LedgerToolsPlugin(makeSurfaceApp(), {});
  plugin.dateMarksEnabled = true;
  plugin.dateMarksToday = () => today;
  return plugin;
}

function manualScheduler(plugin) {
  const frames = [];
  plugin.dateMarksRequestFrame = (cb) => {
    frames.push(cb);
  };
  return frames;
}

function runFrames(frames) {
  let guard = 0;
  while (frames.length > 0 && guard < 1000) {
    guard += 1;
    frames.shift()();
  }
  return guard;
}

// Minimal fake DOM: elements carry classes, attributes, children, and
// an ownerDocument with createElement/createTextNode, plus an explicit
// isConnected flag so tests can model attached vs detached rows.
// childNodes is a faithful NodeList-like: indexed with length,
// iterable, and item(), but with no array methods (no slice/map).
function fakeTasksDom() {
  function makeChildNodes() {
    const list = {
      length: 0,
      item(index) {
        const at = Number(index);
        if (!Number.isInteger(at) || at < 0 || at >= list.length) {
          return null;
        }
        return list[at] !== undefined ? list[at] : null;
      },
      [Symbol.iterator]: function* childNodesIterator() {
        for (let at = 0; at < list.length; at += 1) {
          yield list[at];
        }
      },
    };
    return list;
  }
  function childNodesAppend(list, child) {
    list[list.length] = child;
    list.length += 1;
  }
  function childNodesIndexOf(list, child) {
    for (let at = 0; at < list.length; at += 1) {
      if (list[at] === child) {
        return at;
      }
    }
    return -1;
  }
  function childNodesInsertAt(list, at, child) {
    for (let index = list.length; index > at; index -= 1) {
      list[index] = list[index - 1];
    }
    list[at] = child;
    list.length += 1;
  }
  function childNodesRemoveAt(list, at) {
    for (let index = at; index < list.length - 1; index += 1) {
      list[index] = list[index + 1];
    }
    delete list[list.length - 1];
    list.length -= 1;
  }
  function el(tag, className = "") {
    const node = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      nodeName: String(tag).toUpperCase(),
      className,
      childNodes: makeChildNodes(),
      get firstChild() {
        return this.childNodes.length > 0 ? this.childNodes[0] : null;
      },
      parentNode: null,
      ownerDocument: null,
      isConnected: false,
      _attrs: {},
      classList: {
        contains: (name) =>
          String(node.className || "")
            .split(/\s+/)
            .includes(name),
      },
      getAttribute: (name) =>
        name === "class"
          ? node.className
          : node._attrs[name] !== undefined
            ? node._attrs[name]
            : null,
      hasAttribute: (name) =>
        name === "class" ||
        (node._attrs[name] !== undefined && node._attrs[name] !== null),
      setAttribute(name, value) {
        node._attrs[name] = String(value);
        if (name === "class") {
          node.className = String(value);
        }
      },
      querySelector: (selector) => {
        const wanted =
          selector === ".bob-date-mark-label"
            ? "bob-date-mark-label"
            : selector === ".bob-date-mark-glyph"
              ? "bob-date-mark-glyph"
              : null;
        if (!wanted) {
          return null;
        }
        const stack = Array.from(node.childNodes || []);
        while (stack.length > 0) {
          const candidate = stack.pop();
          if (
            candidate &&
            candidate.nodeType === 1 &&
            String(candidate.className || "")
              .split(/\s+/)
              .includes(wanted)
          ) {
            return candidate;
          }
          for (const child of (candidate && candidate.childNodes) || []) {
            stack.push(child);
          }
        }
        return null;
      },
      appendChild(child) {
        child.parentNode = node;
        childNodesAppend(node.childNodes, child);
        return child;
      },
      insertBefore(child, ref) {
        child.parentNode = node;
        const at = ref ? childNodesIndexOf(node.childNodes, ref) : -1;
        if (at === -1) {
          childNodesAppend(node.childNodes, child);
        } else {
          childNodesInsertAt(node.childNodes, at, child);
        }
        return child;
      },
      removeChild(child) {
        const at = childNodesIndexOf(node.childNodes, child);
        if (at !== -1) {
          childNodesRemoveAt(node.childNodes, at);
        }
        child.parentNode = null;
        return child;
      },
    };
    return node;
  }
  function text(value, doc) {
    return {
      nodeType: 3,
      nodeValue: String(value),
      textContent: String(value),
      parentNode: null,
      ownerDocument: doc,
    };
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
  };
  return { doc, el, text };
}

function markRootsIn(root) {
  const marks = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (
      node &&
      node.nodeType === 1 &&
      String(node.className || "")
        .split(/\s+/)
        .includes("bob-date-mark")
    ) {
      marks.push(node);
    }
    for (const child of (node && node.childNodes) || []) {
      stack.push(child);
    }
  }
  return marks;
}

function markLabel(mark) {
  const labelEl = mark.querySelector(".bob-date-mark-label");
  assert.ok(labelEl, "mark has a label span");
  const bits = Array.from(labelEl.childNodes || [])
    .map((child) =>
      typeof child.nodeValue === "string" ? child.nodeValue : "",
    )
    .join("");
  return bits;
}

function innerTextOf(host) {
  const stack = Array.from(host.childNodes || []);
  const bits = [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.nodeType === 3) {
      bits.push(
        typeof node.nodeValue === "string" ? node.nodeValue : "",
      );
      continue;
    }
    for (const child of (node && node.childNodes) || []) {
      stack.push(child);
    }
  }
  return bits.reverse().join("");
}

// One complete Tasks result row:
// li.plugin-tasks-list-item[data-task] > .tasks-list-text >
// span.<tasksClass> > span(innerText). `dataTask` null omits the
// completion attribute (a row Tasks has not finished rendering).
function tasksRow(fx, tasksClass, innerText, dataTask = "") {
  const li = fx.doc.createElement("li");
  li.setAttribute("class", "plugin-tasks-list-item");
  if (dataTask !== null) {
    li.setAttribute("data-task", dataTask);
  }
  const body = fx.doc.createElement("div");
  body.setAttribute("class", "tasks-list-text");
  const host = fx.doc.createElement("span");
  host.setAttribute("class", tasksClass);
  const inner = fx.doc.createElement("span");
  inner.appendChild(fx.doc.createTextNode(innerText));
  host.appendChild(inner);
  body.appendChild(host);
  li.appendChild(body);
  li.isConnected = true;
  body.isConnected = true;
  host.isConnected = true;
  inner.isConnected = true;
  return { li, body, host, inner };
}

test("T1 scheduled full-mode row gets a Fri mark inside the span", () => {
  const plugin = pluginWithToday();
  const frames = manualScheduler(plugin);
  const fx = fakeTasksDom();
  const row = tasksRow(fx, "task-scheduled", " ⏳ 2026-10-09", "");
  plugin.scheduleTasksResultDateMarks(row.body);
  assert.equal(frames.length, 1, "one frame stays pending");
  runFrames(frames);
  assert.equal(row.host.getAttribute("data-bob-date-mark"), "true");
  const marks = markRootsIn(row.host);
  assert.equal(marks.length, 1);
  const mark = marks[0];
  assert.equal(markLabel(mark), "Fri");
  assert.equal(mark.getAttribute("data-field"), "scheduled");
  assert.equal(mark.getAttribute("data-date"), "2026-10-09");
  assert.equal(mark.getAttribute("data-when"), "future");
  assert.equal(mark.getAttribute("data-host"), "tasks");
  assert.equal(mark.getAttribute("data-rendered"), "true");
  assert.equal(mark.getAttribute("data-fold-space"), "true");
  // The mark lives inside the Tasks span, so Tasks' own click and
  // contextmenu listeners on that span keep working through bubbling.
  assert.equal(mark.parentNode, row.host);
});

test("T2 done row maps to a completion Oct 5 mark", () => {
  const plugin = pluginWithToday();
  const frames = manualScheduler(plugin);
  const fx = fakeTasksDom();
  const row = tasksRow(fx, "task-done", " ✅ 2026-10-05", "x");
  plugin.scheduleTasksResultDateMarks(row.inner);
  runFrames(frames);
  assert.equal(row.host.getAttribute("data-bob-date-mark"), "true");
  const marks = markRootsIn(row.host);
  assert.equal(marks.length, 1);
  assert.equal(markLabel(marks[0]), "Oct 5");
  assert.equal(marks[0].getAttribute("data-field"), "completion");
});

test("T3 short-mode created span is left untouched by JS", () => {
  const plugin = pluginWithToday();
  const frames = manualScheduler(plugin);
  const fx = fakeTasksDom();
  const row = tasksRow(fx, "task-created", " ➕", "");
  plugin.scheduleTasksResultDateMarks(row.body);
  runFrames(frames);
  assert.equal(row.host.getAttribute("data-bob-date-mark"), null);
  assert.equal(markRootsIn(row.host).length, 0);
});

test("T4 pending row decorates once data-task appears; exhausted rows stay native", () => {
  const plugin = pluginWithToday();
  const frames = manualScheduler(plugin);
  const fx = fakeTasksDom();
  const row = tasksRow(fx, "task-scheduled", " ⏳ 2026-10-09", null);
  plugin.scheduleTasksResultDateMarks(row.body);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(
    markRootsIn(row.host).length,
    0,
    "no mark while data-task is missing",
  );
  assert.ok(frames.length > 0, "the row is retried each frame");
  row.li.setAttribute("data-task", "");
  runFrames(frames);
  assert.equal(markRootsIn(row.host).length, 1, "decorated once complete");
  assert.equal(row.host.getAttribute("data-bob-date-mark"), "true");

  const late = pluginWithToday();
  const lateFrames = manualScheduler(late);
  const lateFx = fakeTasksDom();
  const stuck = tasksRow(lateFx, "task-scheduled", " ⏳ 2026-10-09", null);
  late.scheduleTasksResultDateMarks(stuck.body);
  runFrames(lateFrames);
  assert.equal(markRootsIn(stuck.host).length, 0);
  assert.equal(lateFrames.length, 0, "no frame stays pending past 60");
  assert.deepEqual(late.tasksDateMarksQueue, []);
});

test("T5 a second pass adds nothing", () => {
  const plugin = pluginWithToday();
  const fx = fakeTasksDom();
  const row = tasksRow(fx, "task-scheduled", " ⏳ 2026-10-09", "");
  assert.equal(plugin.decorateTasksResultDates(row.li, TODAY), 1);
  assert.equal(plugin.decorateTasksResultDates(row.li, TODAY), 0);
  assert.equal(markRootsIn(row.host).length, 1);
});

test("T6 task-due and task-start spans are untouched", () => {
  const plugin = pluginWithToday();
  const frames = manualScheduler(plugin);
  const fx = fakeTasksDom();
  const due = tasksRow(fx, "task-due", " 📅 2026-10-09", "");
  const start = tasksRow(fx, "task-start", " 🛫 2026-10-09", "");
  plugin.scheduleTasksResultDateMarks(due.body);
  plugin.scheduleTasksResultDateMarks(start.body);
  runFrames(frames);
  assert.equal(markRootsIn(due.host).length, 0);
  assert.equal(markRootsIn(start.host).length, 0);
  assert.equal(due.host.getAttribute("data-bob-date-mark"), null);
  assert.equal(start.host.getAttribute("data-bob-date-mark"), null);
});

test("T7 an invalid date is untouched", () => {
  const plugin = pluginWithToday();
  const frames = manualScheduler(plugin);
  const fx = fakeTasksDom();
  const row = tasksRow(fx, "task-scheduled", " ⏳ 2026-13-01", "");
  plugin.scheduleTasksResultDateMarks(row.body);
  runFrames(frames);
  assert.equal(markRootsIn(row.host).length, 0);
  assert.equal(row.host.getAttribute("data-bob-date-mark"), null);
});

test("T8 nothing is scheduled with marks off or for connected non-Tasks elements", () => {
  const plugin = pluginWithToday();
  plugin.dateMarksEnabled = false;
  const frames = manualScheduler(plugin);
  const fx = fakeTasksDom();
  const row = tasksRow(fx, "task-scheduled", " ⏳ 2026-10-09", "");
  plugin.scheduleTasksResultDateMarks(row.body);
  assert.equal(frames.length, 0);
  assert.deepEqual(plugin.tasksDateMarksQueue || [], []);

  const on = pluginWithToday();
  const onFrames = manualScheduler(on);
  const plain = fx.doc.createElement("div");
  plain.isConnected = true;
  plain.appendChild(fx.doc.createTextNode("Paris review"));
  on.scheduleTasksResultDateMarks(plain);
  assert.equal(onFrames.length, 0);
  assert.deepEqual(on.tasksDateMarksQueue || [], []);
});

test("T9 a Tasks-host Fri mark relabels to tomorrow on rollover", () => {
  const plugin = pluginWithToday();
  const fx = fakeTasksDom();
  const row = tasksRow(fx, "task-scheduled", " ⏳ 2026-10-09", "");
  assert.equal(plugin.decorateTasksResultDates(row.li, TODAY), 1);
  const marks = markRootsIn(row.host);
  assert.equal(marks.length, 1);
  assert.equal(markLabel(marks[0]), "Fri");
  const savedDocument = global.document;
  global.document = {
    querySelectorAll: (selector) => {
      assert.equal(selector, '.bob-date-mark[data-rendered="true"]');
      return marks;
    },
  };
  try {
    assert.equal(plugin.relabelRenderedDateMarks("2026-10-08"), 1);
  } finally {
    if (savedDocument === undefined) {
      delete global.document;
    } else {
      global.document = savedDocument;
    }
  }
  assert.equal(markLabel(marks[0]), "tomorrow");
  assert.equal(marks[0].getAttribute("data-when"), "future");
});

test("renderDateMarksIn schedules one shared frame for every row", () => {
  const plugin = pluginWithToday();
  const frames = manualScheduler(plugin);
  const fx = fakeTasksDom();
  const created = tasksRow(fx, "task-created", " ➕ 2026-09-29", "");
  const scheduled = tasksRow(fx, "task-scheduled", " ⏳ 2026-10-09", "");
  plugin.renderDateMarksIn(created.body, { sourcePath: "dash.md" });
  plugin.renderDateMarksIn(scheduled.body, { sourcePath: "dash.md" });
  assert.equal(frames.length, 1, "at most one frame stays pending");
  runFrames(frames);
  assert.equal(markRootsIn(created.host).length, 1);
  assert.equal(markRootsIn(scheduled.host).length, 1);
  assert.equal(markLabel(markRootsIn(created.host)[0]), "Sep 29");
});

test("the Tasks pass never throws on hostile input", () => {
  const plugin = pluginWithToday();
  assert.equal(plugin.decorateTasksResultDates(null, TODAY), 0);
  assert.equal(plugin.decorateTasksResultDates({}, TODAY), 0);
  assert.equal(plugin.decorateTasksResultDates({}, "not-a-date"), 0);
  plugin.scheduleTasksResultDateMarks(null);
  plugin.scheduleTasksResultDateMarks(undefined);
  plugin.scheduleTasksResultDateMarks(42);
  plugin.dateMarksRequestFrame(null);
  plugin.runTasksResultDateMarkFrame();
});

test("T10 real-DOM NodeList children decorate via direct and queued passes", () => {
  const plugin = pluginWithToday();
  const fx = fakeTasksDom();
  const row = tasksRow(fx, "task-scheduled", " ⏳ 2026-10-09", "");
  for (const node of [row.li, row.body, row.host, row.inner]) {
    assert.equal(
      typeof node.childNodes.slice,
      "undefined",
      "childNodes has no array slice",
    );
    assert.equal(Array.isArray(node.childNodes), false);
    assert.equal(
      typeof node.childNodes[Symbol.iterator],
      "function",
      "childNodes stays iterable",
    );
  }
  assert.equal(plugin.decorateTasksResultDates(row.li, TODAY), 1);
  assert.equal(row.host.getAttribute("data-bob-date-mark"), "true");
  const direct = markRootsIn(row.host);
  assert.equal(direct.length, 1);
  assert.equal(markLabel(direct[0]), "Fri");
  assert.equal(direct[0].getAttribute("data-field"), "scheduled");
  assert.ok(
    innerTextOf(row.host).includes("2026-10-09"),
    "native inner span text stays",
  );
  assert.equal(
    plugin.decorateTasksResultDates(row.li, TODAY),
    0,
    "direct pass stays idempotent",
  );
  assert.equal(markRootsIn(row.host).length, 1);

  const queued = pluginWithToday();
  const queuedFrames = manualScheduler(queued);
  const queuedFx = fakeTasksDom();
  const queuedRow = tasksRow(
    queuedFx,
    "task-scheduled",
    " ⏳ 2026-10-09",
    "",
  );
  assert.equal(typeof queuedRow.li.childNodes.slice, "undefined");
  queued.scheduleTasksResultDateMarks(queuedRow.body);
  assert.equal(queuedFrames.length, 1);
  runFrames(queuedFrames);
  const marks = markRootsIn(queuedRow.host);
  assert.equal(marks.length, 1);
  assert.equal(markLabel(marks[0]), "Fri");
  assert.ok(innerTextOf(queuedRow.host).includes("2026-10-09"));
  assert.equal(
    queued.decorateTasksResultDates(queuedRow.li, TODAY),
    0,
    "queued pass stays idempotent",
  );
});

test("T11 toggling off before a queued frame runs writes nothing", () => {
  const plugin = pluginWithToday();
  const frames = manualScheduler(plugin);
  const fx = fakeTasksDom();
  const row = tasksRow(fx, "task-scheduled", " ⏳ 2026-10-09", "");
  plugin.scheduleTasksResultDateMarks(row.body);
  assert.equal(frames.length, 1);
  assert.equal(plugin.toggleDateMarks(), false);
  runFrames(frames);
  assert.equal(markRootsIn(row.host).length, 0);
  assert.equal(row.host.getAttribute("data-bob-date-mark"), null);
  assert.deepEqual(plugin.tasksDateMarksQueue, []);
  assert.equal(plugin.tasksDateMarksPending, false);
  assert.equal(plugin.toggleDateMarks(), true);
  const retryFx = fakeTasksDom();
  const retry = tasksRow(
    retryFx,
    "task-scheduled",
    " ⏳ 2026-10-09",
    "",
  );
  plugin.scheduleTasksResultDateMarks(retry.body);
  assert.equal(frames.length, 1, "scheduler accepts new rows after re-enable");
  runFrames(frames);
  assert.equal(markRootsIn(retry.host).length, 1);
  assert.equal(markLabel(markRootsIn(retry.host)[0]), "Fri");
});

test("T12 a pending-row retry followed by disabling writes nothing", () => {
  const plugin = pluginWithToday();
  const frames = manualScheduler(plugin);
  const fx = fakeTasksDom();
  const row = tasksRow(fx, "task-scheduled", " ⏳ 2026-10-09", null);
  plugin.scheduleTasksResultDateMarks(row.body);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(
    markRootsIn(row.host).length,
    0,
    "no mark while data-task is missing",
  );
  assert.ok(frames.length > 0, "the pending row is retried");
  assert.equal(plugin.toggleDateMarks(), false);
  row.li.setAttribute("data-task", "");
  runFrames(frames);
  assert.equal(
    markRootsIn(row.host).length,
    0,
    "no mark after disable even once complete",
  );
  assert.deepEqual(plugin.tasksDateMarksQueue, []);
  assert.equal(plugin.toggleDateMarks(), true);
  plugin.scheduleTasksResultDateMarks(row.body);
  runFrames(frames);
  assert.equal(markRootsIn(row.host).length, 1);
  assert.equal(markLabel(markRootsIn(row.host)[0]), "Fri");
});

test("T13 unloading before a callback runs writes nothing", () => {
  const plugin = pluginWithToday();
  const frames = manualScheduler(plugin);
  const fx = fakeTasksDom();
  const row = tasksRow(fx, "task-scheduled", " ⏳ 2026-10-09", "");
  plugin.scheduleTasksResultDateMarks(row.body);
  assert.equal(frames.length, 1);
  plugin.onunload();
  assert.equal(plugin.dateMarksEnabled, false);
  runFrames(frames);
  assert.equal(
    markRootsIn(row.host).length,
    0,
    "no DOM write after shutdown",
  );
  assert.equal(row.host.getAttribute("data-bob-date-mark"), null);
  assert.deepEqual(plugin.tasksDateMarksQueue, []);
  plugin.dateMarksEnabled = true;
  const revivedFx = fakeTasksDom();
  const revived = tasksRow(
    revivedFx,
    "task-scheduled",
    " ⏳ 2026-10-09",
    "",
  );
  plugin.scheduleTasksResultDateMarks(revived.body);
  assert.equal(frames.length, 1, "scheduler works after re-enable");
  runFrames(frames);
  assert.equal(markRootsIn(revived.host).length, 1);
  assert.equal(markLabel(markRootsIn(revived.host)[0]), "Fri");
});

test("styles.css covers the Tasks hosts: hide, toggle-off, and short-mode glyphs", () => {
  const cssPath = path.join(
    __dirname,
    "..",
    "plugins",
    "bob-ledger-tools",
    "styles.css",
  );
  const css = fs.readFileSync(cssPath, "utf8");
  assert.ok(
    css.includes('[data-bob-date-mark="true"]'),
    "full-mode hide rule flags decorated spans",
  );
  assert.ok(css.includes("clip-path: inset(50%)"), "clip pattern hides text");
  assert.ok(
    css.includes(
      "body:not(.bob-date-marks) .bob-date-mark[data-host=\"tasks\"]",
    ),
    "toggle-off rule hides stale Tasks-host marks",
  );
  const pairs = [
    ["task-created", "--bob-date-glyph-created"],
    ["task-scheduled", "--bob-date-glyph-scheduled"],
    ["task-done", "--bob-date-glyph-completion"],
    ["task-cancelled", "--bob-date-glyph-cancelled"],
  ];
  for (const [cls, glyph] of pairs) {
    const selector = `.tasks-layout-short-mode .plugin-tasks-list-item .${cls}::before`;
    assert.ok(
      css.includes(selector),
      `short-mode glyph rule for ${cls}`,
    );
    const at = css.indexOf(selector);
    const body = css.slice(at, at + 400);
    assert.ok(
      body.includes(`mask-image: var(${glyph})`),
      `${cls} draws the shared ${glyph} mask`,
    );
  }
  for (const status of ["x", "X", "-"]) {
    assert.ok(
      css.includes(
        `li.plugin-tasks-list-item[data-task="${status}"]`,
      ),
      `short-mode resting derives from data-task="${status}"`,
    );
  }
});
