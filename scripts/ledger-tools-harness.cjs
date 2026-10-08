// Tests for the bob-ledger-tools freshness namespace and status bar
// (api v3). `docs/freshness.md` in bob-cli is the authoritative
// definition; the P-vectors below encode the "Placement conformance
// examples" (§9) and the S-vectors the "State conformance examples"
// (§10) verbatim, with D = `2026-10-08` and today `2026-10-08`.
const assert = require("node:assert/strict");
const Module = require("node:module");

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

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
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
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  TODAY_RELOAD_EVENT,
  coerceFreshnessConfig,
  defaultFreshnessConfig,
  freshnessBlock,
  freshnessCounts,
  freshnessIntervalFor,
  freshnessIntervalForLine,
  freshnessLaneForRow,
  freshnessLaneIntervalDays,
  freshnessTierLabel,
  freshnessQueue,
  freshnessState,
  freshnessStatusView,
  freshnessSetRefreshLine,
  freshnessStampLine,
  freshnessRowFromTask,
  freshnessTaskStatus,
  formatLocalDate,
  loadFreshnessConfig,
  readFreshness,
} = helpers;

const D = "2026-10-08";
const CFG = {
  interval: 7,
  intervalFromConfig: false,
  pendingInterval: 1,
  nextInterval: 1,
  rottenDailyBudget: null,
};

// docs/freshness.md §10: a Ready, visible, non-recurring task in `a.md`
// unless noted.
function sRow(overrides = {}) {
  return {
    path: "a.md",
    line: 1,
    statusSymbol: undefined,
    isTodo: true,
    recurring: false,
    laneVisible: true,
    isDailyNote: false,
    isToday: false,
    scheduled: null,
    due: null,
    start: null,
    created: null,
    rawLine: "- [ ] #task T",
    noteRefreshRaw: undefined,
    ...overrides,
  };
}

function laneRow(path, line, symbol, fresh, created) {
  const isTodo = symbol === " ";
  const rawLine =
    fresh === null || fresh === undefined
      ? `- [${symbol}] #task Walk`
      : `- [${symbol}] #task Walk [fresh:: ${fresh}]`;
  return sRow({
    path,
    line,
    statusSymbol: symbol,
    isTodo,
    rawLine,
    created: created === undefined ? null : created,
  });
}

function readyRow(path, line, fresh, created) {
  return laneRow(path, line, " ", fresh, created);
}

// --- Plugin behaviour -------------------------------------------------------

function makeFreshnessTask(overrides = {}) {
  return {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: [],
    path: "notes/a.md",
    lineNumber: 0,
    description: "Do it",
    originalMarkdown: "- [ ] #task Do it",
    ...overrides,
  };
}

function makeFreshnessApp({ tasks, frontmatter = {}, triggers = [] } = {}) {
  return {
    vault: {
      getAbstractFileByPath: (filePath) =>
        frontmatter[filePath] !== undefined ? { path: filePath } : null,
      cachedRead: () => Promise.resolve(null),
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      trigger: (event) => triggers.push(event),
    },
    metadataCache: {
      on: () => ({}),
      // Mirrors the real Obsidian API (bob-cli-3e): `getCache` accepts
      // only path strings, `getFileCache` only file objects.
      getCache: (key) => {
        assert.equal(
          typeof key,
          "string",
          "getCache expects a path string (bob-cli-3e)",
        );
        if (frontmatter[key] === undefined) {
          return null;
        }
        return { frontmatter: { task_refresh: frontmatter[key] } };
      },
      getFileCache: (file) => {
        assert.ok(
          file && typeof file === "object" && typeof file.path === "string",
          "getFileCache expects a file object (bob-cli-3e)",
        );
        if (frontmatter[file.path] === undefined) {
          return {};
        }
        return { frontmatter: { task_refresh: frontmatter[file.path] } };
      },
      getFirstLinkpathDest: () => null,
    },
    commands: {},
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": { getTasks: () => tasks },
      },
    },
  };
}

function withMissingConfig(run) {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/freshness-test";
  try {
    return run();
  } finally {
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
  }
}

function makeStatusEl() {
  const classes = new Set();
  const el = {
    text: "",
    attrs: {},
    handlers: {},
    style: {},
    children: [],
    clientWidth: 800,
    scrollWidth: 400,
    setText(value) {
      this.text = String(value);
      this.textContent = String(value);
    },
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    },
    removeAttribute(key) {
      delete this.attrs[key];
    },
    empty() {
      this.children = [];
      this.text = "";
      this.textContent = "";
    },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      has: (name) => classes.has(name),
    },
    addEventListener(event, handler) {
      this.handlers[event] = handler;
    },
    createEl(tag, options = {}) {
      const child = makeStatusEl();
      child.tag = tag;
      child.cls = options.cls || "";
      if (options.cls) {
        for (const name of String(options.cls).split(/\s+/)) {
          if (name) child.classList.add(name);
        }
      }
      this.children.push(child);
      return child;
    },
  };
  el.textContent = "";
  return el;
}

function checklistTaskRow(line, tags, overrides = {}) {
  const symbol = freshnessTaskStatus(line);
  const statusType =
    symbol === " " || symbol === "?"
      ? "TODO"
      : symbol === "/"
        ? "IN_PROGRESS"
        : symbol === "*"
          ? "ON_HOLD"
          : symbol === "x" || symbol === "X" || symbol === "-"
            ? "DONE"
            : "NON_TASK";
  const task = {
    status: { type: statusType, symbol: symbol || "" },
    tags,
    path: overrides.path || "gtd_daily.md",
    lineNumber: Number.isInteger(overrides.lineNumber) ? overrides.lineNumber : 0,
    description: line,
    originalMarkdown: line,
    isBlocked: () => Boolean(overrides.blocked),
    ...(overrides.recurrence ? { recurrence: overrides.recurrence } : {}),
    ...(overrides.scheduledDate ? { scheduledDate: overrides.scheduledDate } : {}),
  };
  return freshnessRowFromTask(task, task.lineNumber, {
    list: [task],
    todayDay: 20261008,
    isToday: () => Boolean(overrides.isToday),
  });
}


module.exports = {
  TestMarkdownView,
  TestPlugin,
  TestNotice,
  LedgerToolsPlugin,
  helpers,
  TODAY_RELOAD_EVENT,
  coerceFreshnessConfig,
  defaultFreshnessConfig,
  freshnessBlock,
  freshnessCounts,
  freshnessIntervalFor,
  freshnessIntervalForLine,
  freshnessLaneForRow,
  freshnessLaneIntervalDays,
  freshnessTierLabel,
  freshnessQueue,
  freshnessState,
  freshnessStatusView,
  freshnessSetRefreshLine,
  freshnessStampLine,
  freshnessRowFromTask,
  freshnessTaskStatus,
  formatLocalDate,
  loadFreshnessConfig,
  readFreshness,
  D,
  CFG,
  sRow,
  laneRow,
  readyRow,
  makeFreshnessTask,
  makeFreshnessApp,
  withMissingConfig,
  makeStatusEl,
  checklistTaskRow,
};
