// Tests for the compact persistent review footer and shared
// `freshnessReviewEntryView` presentation (freshness namespace v7).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
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
  freshnessFooterGroups,
  freshnessFooterFit,
  freshnessFooterPaint,
  freshnessFooterView,
  freshnessFooterAnswerChip,
  FRESHNESS_FOOTER_ANSWER_TIERS,
  freshnessMatchQueueCursor,
  freshnessQueue,
  freshnessReviewEntryView,
  freshnessTierFooterLabel,
} = helpers;

function deepText(node) {
  if (!node) return "";
  if (typeof node.text === "string" && (!node.children || node.children.length === 0)) {
    return node.text;
  }
  let out = "";
  if (typeof node.text === "string" && node.children && node.children.length > 0) {
    // Fake DOM stores leaf text in .text; container .text is "" after empty().
  }
  for (const child of node.children || []) {
    out += deepText(child);
  }
  if (out === "" && typeof node.textContent === "string") return node.textContent;
  return out;
}

const D = "2026-10-08";
const CFG = {
  interval: 7,
  intervalFromConfig: false,
  pendingInterval: 1,
  nextInterval: 1,
  rottenDailyBudget: null,
};

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

function queueEntry(overrides = {}) {
  return {
    key: "a.md:1",
    path: "a.md",
    line: 1,
    lineNumber: 0,
    originalMarkdown: "- [ ] #task T",
    text: "T",
    state: "new",
    bucket: "new",
    tier: "new",
    tierLabel: "NEW",
    lane: "ready",
    created: null,
    fresh: null,
    dueOn: null,
    daysOverdue: null,
    interval: 7,
    rank: 1,
    tierRank: 1,
    tierTotal: 1,
    ...overrides,
  };
}

const FOOTER_TIER_KEYS = [
  "pre", "new", "projects", "pending", "next", "recurring", "tickler", "rotten", "post",
];

function makeFooterView(byTier, { current = null, quickRoll = null } = {}) {
  const normalized = Object.fromEntries(
    FOOTER_TIER_KEYS.map((key) => [key, Number(byTier[key]) || 0]),
  );
  const walk = Object.values(normalized).reduce((sum, count) => sum + count, 0);
  return freshnessFooterView(
    {
      counts: {
        walk,
        upkeepToday: 2,
        budget: 5,
        budgetMet: false,
        byTier: normalized,
      },
      queue: [current || queueEntry()],
      tasksAvailable: true,
    },
    { current, quickRoll, todayText: D },
  );
}

function makeStatusEl() {
  const classes = new Set();
  const el = {
    text: "",
    textContent: "",
    attrs: {},
    handlers: {},
    style: {},
    children: [],
    clientWidth: 800,
    scrollWidth: 400,
    disabled: false,
    tabIndex: 0,
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
    removeEventListener(event) {
      delete this.handlers[event];
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
  return el;
}

function makeStatusItemFactory(first) {
  let isFirst = true;
  return () => {
    if (isFirst) {
      isFirst = false;
      return first;
    }
    // Obsidian returns a distinct status bar element for each item.
    return makeStatusEl();
  };
}

function findChild(el, className) {
  const walk = (node) => {
    if (node.classList && node.classList.has(className)) {
      return node;
    }
    for (const child of node.children || []) {
      const found = walk(child);
      if (found) {
        return found;
      }
    }
    return null;
  };
  return walk(el);
}

function findChildren(el, className) {
  const found = [];
  const walk = (node) => {
    if (node.classList && node.classList.has(className)) {
      found.push(node);
    }
    for (const child of node.children || []) {
      walk(child);
    }
  };
  walk(el);
  return found;
}

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
      getActiveViewOfType: () => null,
      trigger: (event) => triggers.push(event),
    },
    metadataCache: {
      on: () => ({}),
      getCache: () => null,
      getFileCache: () => ({}),
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
  process.env.XDG_CONFIG_HOME = "/definitely/missing/freshness-footer-test";
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

test("footer groups omit every zero tier and keep walk order", () => {
  const groups = freshnessFooterGroups({
    new: 0,
    projectsDue: 0,
    pendingDue: 0,
    nextDue: 0,
    resurfaced: 0,
        rotten: 0,
    walk: 7,
    byTier: {
      new: 1,
      projects: 0,
      pending: 2,
      next: 0,
      tickler: 1,
      rotten: 3,
    },
  });
  assert.deepEqual(
    groups.map((group) => group.key + ":" + group.count),
    ["new:1", "pending:2", "tickler:1", "rotten:3"],
  );
  assert.equal(
    groups.some((group) => group.key === "projects"),
    false,
  );
});

test("PRE and POST groups bracket the nine-tier queue and expose completion hints", () => {
  const groups = freshnessFooterGroups({
    walk: 3,
    byTier: {
      pre: 1,
      new: 0,
      projects: 0,
      pending: 0,
      next: 0,
      tickler: 0,
      rotten: 1,
      post: 1,
    },
  });
  assert.deepEqual(groups.map(({ key, label }) => `${key}:${label}`), [
    "pre:PRE", "rotten:ROTTEN", "post:POST",
  ]);

  const pre = freshnessReviewEntryView(
    queueEntry({ tier: "pre", tierLabel: "PRE", state: null, bucket: null, lane: "ready" }),
    { todayText: D },
  );
  assert.equal(pre.detail, "checklist");
  assert.equal(pre.actionHint, "Ctrl+Enter done · ]s skip");
  const post = freshnessReviewEntryView(
    queueEntry({ tier: "post", tierLabel: "POST", lane: "ready" }),
    { todayText: D },
  );
  assert.equal(post.detail, "closeout");
  assert.equal(post.actionHint, "Ctrl+Enter done · closes the review");

  const currentPre = queueEntry({
    tier: "pre",
    tierLabel: "PRE",
    lane: "ready",
    state: null,
    bucket: null,
    rank: 1,
    tierRank: 1,
    tierTotal: 1,
  });
  const view = freshnessFooterView(
    {
      counts: {
        walk: 2,
        byTier: {
          pre: 1,
          new: 0,
          projects: 0,
          pending: 0,
          next: 0,
          tickler: 0,
              rotten: 0,
          post: 1,
        },
      },
      queue: [currentPre, queueEntry({ key: "post", tier: "post", tierLabel: "POST" })],
      tasksAvailable: true,
    },
    { current: currentPre, todayText: D },
  );
  assert.equal(view.commitments, 1, "PRE contributes to commitments");
  assert.equal(view.groupsText, "POST 1");
  assert.equal(view.current.actionHint, pre.actionHint);
});

test("a NEW-state project appears only in its walk tier", () => {
  const groups = freshnessFooterGroups({
    new: 1,
    projectsDue: 1,
    pendingDue: 0,
    nextDue: 0,
    resurfaced: 0,
        rotten: 0,
    walk: 2,
    byTier: {
      new: 0,
      projects: 1,
      pending: 0,
      next: 0,
      tickler: 0,
        rotten: 0,
    },
  });
  assert.deepEqual(
    groups.map((group) => group.label + " " + group.count),
    ["PROJECTS 1"],
  );
});

test("empty queue hides the footer even with upkeep or a met budget", () => {
  const memo = {
    counts: {
      walk: 0,
      upkeepToday: 12,
      budget: 15,
      budgetMet: true,
      byTier: {
        new: 0,
        projects: 0,
        pending: 0,
        next: 0,
        tickler: 0,
        rotten: 0,
      },
    },
    queue: [],
    tasksAvailable: true,
  };
  for (const quickRoll of [
    null,
    { ok: false },
    { ok: true, kind: "assign", compact: "Alt+P set high" },
  ]) {
    const hidden = freshnessFooterView(memo, { navAvailable: true, quickRoll });
    assert.equal(hidden.visible, false);
    assert.equal(hidden.groupsText, "");
    assert.equal(hidden.meterText, "");
  }
});

test("unavailable or missing data never render false counts", () => {
  assert.equal(freshnessFooterView(null).visible, false);
  assert.equal(
    freshnessFooterView({ counts: { walk: 3 }, queue: [{}], tasksAvailable: false }).visible,
    false,
  );
  assert.equal(freshnessFooterView({ queue: null, counts: { walk: 4 } }).visible, false);
});

test("generic summary names due, commitments, and nonempty groups", () => {
  const view = freshnessFooterView(
    {
      counts: {
        walk: 7,
        upkeepToday: 0,
        budget: 15,
        budgetMet: false,
        byTier: {
          new: 1,
          projects: 0,
          pending: 2,
          next: 0,
          tickler: 1,
              rotten: 3,
        },
      },
      queue: [queueEntry(), queueEntry({ key: "b" })],
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(view.visible, true);
  assert.equal(view.dueText, "Review 7 due");
  assert.equal(view.contextText, "4 commitments");
  assert.equal(view.hintText, "]s next");
  assert.equal(view.groupsText, "NEW 1 · WIP 2 · TICKS 1 · ROTTEN 3");
  assert.equal(view.meterText, "✓ 0/15 today");
  assert.equal(view.mode, "new");
  const noNav = freshnessFooterView(
    {
      counts: {
        walk: 7,
        upkeepToday: 0,
        budget: 15,
        byTier: {
          new: 1,
          projects: 0,
          pending: 2,
          next: 0,
          tickler: 1,
              rotten: 3,
        },
      },
      queue: [queueEntry()],
      tasksAvailable: true,
    },
    { navAvailable: false },
  );
  assert.equal(noNav.hintText, "open review");
});

test("current-task context uses shared ranks and compact wording", () => {
  const current = queueEntry({
    key: "p.md:2",
    path: "p.md",
    line: 2,
    lineNumber: 1,
    originalMarkdown: "- [/] #task Pending",
    tier: "pending",
    tierLabel: "PENDING",
    lane: "pending",
    fresh: "2026-10-07",
    dueOn: "2026-10-08",
    daysOverdue: 0,
    interval: 1,
    rank: 2,
    tierRank: 1,
    tierTotal: 2,
  });
  const view = freshnessFooterView(
    {
      counts: {
        walk: 7,
        upkeepToday: 0,
        budget: 15,
        byTier: {
          new: 1,
          projects: 0,
          pending: 2,
          next: 0,
          tickler: 1,
              rotten: 3,
        },
      },
      queue: [queueEntry(), current],
      tasksAvailable: true,
    },
    { current, navAvailable: true, todayText: D },
  );
  assert.equal(view.dueText, "Review 2/7");
  assert.equal(view.contextText, "WIP 1/2");
  assert.equal(view.detailText, "confirmed yesterday");
  assert.equal(view.hintText, "");
  assert.equal(view.current.actionHint.includes("Ctrl+Alt+F keep"), true);
});

test("only ROTTEN remaining names commitments done or a met budget", () => {
  const rottenQueue = [queueEntry({ tier: "rotten", tierLabel: "ROTTEN", state: "rotten" })];
  const remaining = freshnessFooterView(
    {
      counts: {
        walk: 3,
        upkeepToday: 12,
        budget: 15,
        budgetMet: false,
        byTier: {
          new: 0,
          projects: 0,
          pending: 0,
          next: 0,
          tickler: 0,
              rotten: 3,
        },
      },
      queue: rottenQueue,
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(remaining.contextText, "Commitments done");
  assert.equal(remaining.groupsText, "ROTTEN 3");
  assert.equal(remaining.mode, "due");
  const met = freshnessFooterView(
    {
      counts: {
        walk: 3,
        upkeepToday: 15,
        budget: 15,
        budgetMet: true,
        byTier: {
          new: 0,
          projects: 0,
          pending: 0,
          next: 0,
          tickler: 0,
              rotten: 3,
        },
      },
      queue: rottenQueue,
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(met.contextText, "Upkeep budget met");
  assert.equal(met.visible, true);
  assert.equal(met.mode, "budget");
});

test("NEW and commitments take precedence over a met budget", () => {
  const view = freshnessFooterView(
    {
      counts: {
        walk: 2,
        upkeepToday: 15,
        budget: 15,
        budgetMet: true,
        byTier: {
          new: 1,
          projects: 0,
          pending: 1,
          next: 0,
          tickler: 0,
              rotten: 0,
        },
      },
      queue: [queueEntry(), queueEntry({ key: "p", tier: "pending" })],
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(view.mode, "new");
  assert.equal(view.contextText, "2 commitments");
  assert.equal(view.contextText.includes("budget"), false);
});

test("reviewEntryView compact and detail cover the original freshness tiers", () => {
  const today = { todayText: D };
  assert.deepEqual(freshnessReviewEntryView(null), {
    ok: false,
    tier: "",
    label: "",
    detail: "",
    compact: "",
    stage: null,
    actionHint: "",
  });
  assert.equal(freshnessReviewEntryView(queueEntry(), today).detail, "");
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "projects",
        tierLabel: "PROJECTS",
        fresh: null,
        interval: 7,
      }),
      today,
    ).detail,
    "Empty project · never confirmed · every 7d",
  );
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "projects",
        tierLabel: "PROJECTS",
        fresh: null,
      }),
      today,
    ).compact,
    "Empty project",
  );
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "pending",
        tierLabel: "PENDING",
        lane: "pending",
        fresh: "2026-10-07",
        interval: 1,
        daysOverdue: 0,
      }),
      today,
    ).detail,
    "confirmed yesterday",
  );
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "next",
        tierLabel: "NEXT",
        lane: "next",
        fresh: null,
      }),
      today,
    ).compact,
    "never confirmed",
  );
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "tickler",
        tierLabel: "TICKLER",
        fresh: "2026-10-05",
        dueOn: "2026-10-07",
      }),
      today,
    ).detail,
    "scheduled Oct 7",
  );
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "references",
        tierLabel: "REFERENCES",
        legacyReferenceTier: true,
        fresh: "2026-10-01",
        dueOn: "2026-10-08",
        daysOverdue: 0,
        interval: 7,
      }),
      today,
    ).detail,
    "Reference · due today · confirmed Oct 1 · every 7d",
  );
  assert.equal(
    freshnessReviewEntryView(
      queueEntry({
        tier: "references",
        tierLabel: "REFERENCES",
        legacyReferenceTier: true,
      }),
      today,
    ).compact,
    "Reference",
  );
  const unmarkedLegacyShape = freshnessReviewEntryView(
    queueEntry({ tier: "references", tierLabel: "REFERENCES" }),
    today,
  );
  assert.equal(unmarkedLegacyShape.ok, true);
  assert.equal(unmarkedLegacyShape.tier, "new", "unmarked rows fall back to ordinary state");
  const rotten = freshnessReviewEntryView(
    queueEntry({
      tier: "rotten",
      tierLabel: "ROTTEN",
      daysOverdue: 3,
      interval: 7,
    }),
    today,
  );
  assert.equal(rotten.detail, "rotten 3d · every 7d");
  assert.equal(rotten.compact, "rotten 3d");
});

test("cursor matching requires a unique verified identity", () => {
  const queue = [
    queueEntry({
      key: "a.md:1",
      path: "a.md",
      line: 1,
      lineNumber: 0,
      originalMarkdown: "- [ ] #task First",
      rank: 1,
    }),
    queueEntry({
      key: "a.md:3",
      path: "a.md",
      line: 3,
      lineNumber: 2,
      originalMarkdown: "- [ ] #task Second",
      rank: 2,
    }),
    queueEntry({
      key: "b.md:1",
      path: "b.md",
      line: 1,
      lineNumber: 0,
      originalMarkdown: "- [ ] #task Other",
      rank: 3,
    }),
  ];
  assert.equal(
    freshnessMatchQueueCursor(queue, {
      path: "a.md",
      line0: 0,
      sourceLine: "- [ ] #task First",
    }).rank,
    1,
  );
  assert.equal(
    freshnessMatchQueueCursor(queue, {
      path: "a.md",
      line0: 4,
      sourceLine: "- [ ] #task Second",
      sourceLines: [
        "- [ ] #task First",
        "",
        "",
        "",
        "- [ ] #task Second",
      ],
    }).rank,
    2,
  );
  assert.equal(
    freshnessMatchQueueCursor(queue, {
      path: "a.md",
      line0: 0,
      sourceLine: "- [ ] #task Stamped today",
    }),
    null,
  );
  const duplicates = [
    queueEntry({
      key: "a.md:1",
      path: "a.md",
      line: 1,
      lineNumber: 0,
      originalMarkdown: "- [ ] #task Twin",
      blockId: "id",
      rank: 1,
    }),
    queueEntry({
      key: "a.md:5",
      path: "a.md",
      line: 5,
      lineNumber: 4,
      originalMarkdown: "- [ ] #task Twin",
      blockId: "id",
      rank: 2,
    }),
  ];
  assert.equal(
    freshnessMatchQueueCursor(duplicates, {
      path: "a.md",
      line0: 2,
      sourceLine: "- [ ] #task Twin",
      sourceLines: [
        "- [ ] #task Twin",
        "",
        "- [ ] #task Twin",
        "",
        "- [ ] #task Twin",
      ],
    }),
    null,
  );
});

test("footer paint hides the host and keeps a stable button", () => {
  const el = makeStatusEl();
  const hidden = freshnessFooterView({ queue: [], counts: { walk: 0 } });
  freshnessFooterPaint(el, hidden);
  assert.equal(el.classList.has("bob-freshness-hidden"), true);
  const button = el.children.find((child) => child.tag === "button");
  assert.ok(button);
  assert.equal(button.disabled, true);
  const shown = freshnessFooterView(
    {
      counts: {
        walk: 1,
        upkeepToday: 0,
        byTier: {
          new: 1,
          projects: 0,
          pending: 0,
          next: 0,
          tickler: 0,
              rotten: 0,
        },
      },
      queue: [queueEntry()],
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  freshnessFooterPaint(el, shown);
  assert.equal(el.classList.has("bob-freshness-hidden"), false);
  assert.equal(findChild(el, "bob-freshness-due").textContent, "Review 1 due");
  const group = findChild(el, "bob-freshness-group");
  assert.equal(group.attrs["data-review-tier"], "new");
  assert.equal(findChild(group, "bob-freshness-group-label").textContent, "NEW");
  assert.equal(findChild(group, "bob-freshness-group-count").textContent, "1");
  assert.equal(el.children.find((child) => child.tag === "button"), button);
  assert.equal(button.disabled, false);
});

test("groups paint as tier-keyed tokens and repaint without stale nodes", () => {
  const allTiers = {
    pre: 1,
    new: 1,
    projects: 1,
    pending: 1,
    next: 1,
    recurring: 1,
    tickler: 1,
    rotten: 1,
    post: 1,
  };
  const view = makeFooterView(allTiers);
  assert.equal(
    view.groupsText,
    "PRE 1 · NEW 1 · PROJECTS 1 · WIP 1 · NEXT 1 · RECUR 1 · TICKS 1 · ROTTEN 1 · POST 1",
  );
  assert.equal(view.tooltip.split("\n")[1], view.groupsText);
  assert.equal(view.ariaLabel.includes(view.groupsText), true);

  const el = makeStatusEl();
  freshnessFooterPaint(el, view);
  let tokens = findChildren(el, "bob-freshness-group");
  assert.deepEqual(
    tokens.map((node) => node.attrs["data-review-tier"]),
    FOOTER_TIER_KEYS,
  );
  assert.deepEqual(
    findChildren(el, "bob-freshness-group-label").map((node) => node.textContent),
    ["PRE", "NEW", "PROJECTS", "WIP", "NEXT", "RECUR", "TICKS", "ROTTEN", "POST"],
  );

  freshnessFooterPaint(el, makeFooterView({ new: 2, rotten: 3 }));
  tokens = findChildren(el, "bob-freshness-group");
  assert.deepEqual(
    tokens.map((node) => node.attrs["data-review-tier"]),
    ["new", "rotten"],
  );
  assert.equal(findChildren(el, "bob-freshness-groups-more").length, 1);
});

test("group boundary marks only the commitments-to-upkeep cut", () => {
  const allTiers = {
    pre: 1, new: 1, projects: 1, pending: 1, next: 1,
    recurring: 1, tickler: 1, rotten: 1, post: 1,
  };
  const full = makeFooterView(allTiers);
  assert.deepEqual(
    full.groups.filter((group) => group.boundary).map((group) => group.key),
    ["rotten"],
  );

  const upkeepOnly = makeFooterView({ rotten: 1, post: 1 });
  assert.equal(upkeepOnly.groups.some((group) => group.boundary), false);

  const rottenRow = queueEntry({
    tier: "rotten", tierLabel: "ROTTEN", state: "rotten",
    rank: 1, tierRank: 1, tierTotal: 1,
  });
  const rottenCurrent = makeFooterView(
    { new: 1, rotten: 1, post: 1 },
    { current: rottenRow },
  );
  assert.deepEqual(
    rottenCurrent.groups.filter((group) => group.boundary).map((group) => group.key),
    ["post"],
  );

  const nextRow = queueEntry({
    tier: "next", tierLabel: "NEXT", lane: "next",
    rank: 1, tierRank: 1, tierTotal: 1,
  });
  const rottenOnlyAfterNext = makeFooterView(
    { next: 1, rotten: 1 },
    { current: nextRow },
  );
  assert.equal(rottenOnlyAfterNext.groups.some((group) => group.boundary), false);
});

test("context ink follows supported current tiers and clears on other views", () => {
  const el = makeStatusEl();
  const current = queueEntry({
    tier: "next", tierLabel: "NEXT", lane: "next",
    rank: 1, tierRank: 1, tierTotal: 1,
  });
  freshnessFooterPaint(el, makeFooterView({ next: 1 }, { current }));
  const context = findChild(el, "bob-freshness-context");
  assert.equal(context.attrs["data-review-tier"], "next");

  freshnessFooterPaint(el, makeFooterView({ new: 1 }));
  assert.equal(Object.hasOwn(context.attrs, "data-review-tier"), false);
  freshnessFooterPaint(el, freshnessFooterView({ counts: { walk: 0 }, queue: [] }));
  assert.equal(Object.hasOwn(context.attrs, "data-review-tier"), false);

  const legacyReference = queueEntry({
    tier: "references", tierLabel: "REFERENCES", legacyReferenceTier: true,
    rank: 1, tierRank: 1, tierTotal: 1,
  });
  freshnessFooterPaint(
    el,
    makeFooterView({ new: 1 }, { current: legacyReference }),
  );
  assert.equal(context.textContent, "REFERENCES 1/1");
  assert.equal(Object.hasOwn(context.attrs, "data-review-tier"), false);
});

test("progressive fit sheds tail groups, then detail, hint, and meter", () => {
  const current = queueEntry({
    tier: "next", tierLabel: "NEXT", lane: "next",
    rank: 1, tierRank: 1, tierTotal: 1,
  });
  const view = makeFooterView(
    {
      pre: 1, new: 1, projects: 1, pending: 1, next: 1,
      recurring: 1, tickler: 1, rotten: 1, post: 1,
    },
    { current, quickRoll: { ok: true, compact: "Alt+P roll P2 1/1" } },
  );
  const el = makeStatusEl();
  el.clientWidth = 1000;
  const widthOf = (node) => {
    if (node.classList.has("bob-freshness-main")) return 40;
    if (node.classList.has("bob-freshness-context")) return 30;
    if (node.classList.has("bob-freshness-detail")) return 30;
    if (node.classList.has("bob-freshness-hint")) return 30;
    if (node.classList.has("bob-freshness-meter")) return 30;
    if (node.classList.has("bob-freshness-groups")) {
      return node.children.reduce((sum, child) => {
        if (child.classList.has("bob-freshness-omit")) return sum;
        return sum + (child.classList.has("bob-freshness-group") ? 10 : 5);
      }, 0);
    }
    return 0;
  };
  Object.defineProperty(el, "scrollWidth", {
    configurable: true,
    get() {
      return this.children.reduce((sum, child) => {
        if (child.classList.has("bob-freshness-omit")) return sum;
        return sum + widthOf(child);
      }, 0);
    },
  });
  const parts = freshnessFooterPaint(el, view);
  const groups = parts.groups._bobFreshnessGroupNodes;
  const more = parts.groups._bobFreshnessGroupsMore;
  assert.equal(groups.length, 8);

  el.clientWidth = 245;
  assert.deepEqual(freshnessFooterFit(el, parts, view), {
    groups: true, groupsShown: 8, detail: true, hint: true, meter: true,
  });
  assert.equal(more.classList.has("bob-freshness-omit"), true);

  el.clientWidth = 230;
  assert.deepEqual(freshnessFooterFit(el, parts, view), {
    groups: true, groupsShown: 6, detail: true, hint: true, meter: true,
  });
  assert.deepEqual(
    groups.map((node) => !node.classList.has("bob-freshness-omit")),
    [true, true, true, true, true, true, false, false],
  );
  assert.equal(more.classList.has("bob-freshness-omit"), false);

  el.clientWidth = 160;
  assert.deepEqual(freshnessFooterFit(el, parts, view), {
    groups: false, groupsShown: 0, detail: true, hint: true, meter: true,
  });
  assert.equal(more.classList.has("bob-freshness-omit"), true);

  el.clientWidth = 155;
  assert.deepEqual(freshnessFooterFit(el, parts, view), {
    groups: false, groupsShown: 0, detail: false, hint: true, meter: true,
  });
  el.clientWidth = 120;
  assert.deepEqual(freshnessFooterFit(el, parts, view), {
    groups: false, groupsShown: 0, detail: false, hint: false, meter: true,
  });
  el.clientWidth = 90;
  assert.deepEqual(freshnessFooterFit(el, parts, view), {
    groups: false, groupsShown: 0, detail: false, hint: false, meter: false,
  });
});

test("the footer stylesheet defines every tier ink and removes NEW accent overrides", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"),
    "utf8",
  );
  for (const tier of FOOTER_TIER_KEYS) {
    assert.equal(
      css.includes(`[data-review-tier="${tier}"]`),
      true,
      `missing ${tier} tier color rule`,
    );
  }
  assert.equal(css.includes(".bob-freshness-new .bob-freshness-main .bob-freshness-due"), false);
  assert.equal(css.includes(".bob-freshness-new .bob-freshness-tier"), false);
});

test("status bar 0-1-0 transitions hide without a reload", () => {
  withMissingConfig(() => {
    let tasks = [];
    const app = makeFreshnessApp({ tasks: undefined });
    app.plugins.plugins["obsidian-tasks-plugin"].getTasks = () => tasks;
    const el = makeStatusEl();
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = makeStatusItemFactory(el);
    plugin.onload();
    try {
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), true);
      tasks = [makeFreshnessTask()];
      plugin.freshnessMemo = null;
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
      assert.equal(findChild(el, "bob-freshness-due").textContent, "Review 1 due");
      tasks = [];
      plugin.freshnessMemo = null;
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), true);
    } finally {
      plugin.onunload();
    }
  });
});

test("cursor-only updates reuse a warm memo", () => {
  withMissingConfig(() => {
    const tasks = [makeFreshnessTask()];
    const app = makeFreshnessApp({ tasks });
    const el = makeStatusEl();
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = makeStatusItemFactory(el);
    plugin.onload();
    try {
      plugin.updateFreshnessStatusBar();
      const memo = plugin.freshnessMemo;
      let ensures = 0;
      const original = plugin.freshnessEnsureMemo.bind(plugin);
      plugin.freshnessEnsureMemo = (...args) => {
        ensures += 1;
        return original(...args);
      };
      plugin.updateFreshnessStatusBar({ contextOnly: true });
      assert.equal(ensures, 0);
      assert.equal(plugin.freshnessMemo, memo);
    } finally {
      plugin.onunload();
    }
  });
});

test("unload disconnects the observer and click handler", () => {
  withMissingConfig(() => {
    const tasks = [makeFreshnessTask()];
    const app = makeFreshnessApp({ tasks });
    const el = makeStatusEl();
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = makeStatusItemFactory(el);
    plugin.onload();
    try {
      plugin.updateFreshnessStatusBar();
      const button = el.children.find((child) => child.tag === "button");
      assert.equal(typeof button.handlers.click, "function");
    } finally {
      plugin.onunload();
    }
    assert.equal(plugin.freshnessFooterObserver, null);
    assert.equal(plugin.freshnessFooterClickBound, null);
    assert.equal(plugin.freshnessStatusEl, null);
  });
});

test("queue-built ranks agree with the footer current entry", () => {
  const rows = [
    sRow({ path: "a.md", line: 1, rawLine: "- [ ] #task New" }),
    sRow({
      path: "b.md",
      line: 2,
      statusSymbol: "/",
      isTodo: false,
      rawLine: "- [/] #task Pending [fresh:: 2026-10-07]",
    }),
    sRow({
      path: "c.md",
      line: 3,
      rawLine: "- [ ] #task Rotten [fresh:: 2026-09-20]",
    }),
  ];
  const queue = freshnessQueue(rows, D, CFG);
  assert.deepEqual(
    queue.map((entry) => entry.tier),
    ["new", "pending", "rotten"],
  );
  const current = queue[1];
  const view = freshnessFooterView(
    {
      counts: {
        walk: 3,
        upkeepToday: 0,
        byTier: {
          new: 1,
          projects: 0,
          pending: 1,
          next: 0,
          tickler: 0,
              rotten: 1,
        },
      },
      queue,
      tasksAvailable: true,
    },
    { current, todayText: D, navAvailable: true },
  );
  assert.equal(view.dueText, "Review 2/3");
  assert.equal(view.contextText, "WIP 1/1");
  const presentation = freshnessReviewEntryView(current, { todayText: D });
  assert.equal(view.detailText, presentation.compact);
});

test("footer short labels map every tier", () => {
  assert.deepEqual(
    [
      "pre", "new", "projects", "pending", "next",
      "tickler", "rotten", "post",
    ].map((tier) => `${tier}:${freshnessTierFooterLabel(tier)}`),
    [
      "pre:PRE", "new:NEW", "projects:PROJECTS", "pending:WIP",
      "next:NEXT", "tickler:TICKS",
      "rotten:ROTTEN", "post:POST",
    ],
  );
});

test("current-row footer context uses short labels while entry views keep full labels", () => {
  const today = { todayText: D };
  const ticklerEntry = queueEntry({
    key: "t.md:1",
    tier: "tickler",
    tierLabel: "TICKLER",
    lane: "ready",
    state: "resurfaced",
    fresh: "2026-10-05",
    dueOn: "2026-10-07",
    rank: 5,
    tierRank: 2,
    tierTotal: 14,
  });
  const presentation = freshnessReviewEntryView(ticklerEntry, today);
  assert.equal(presentation.ok, true);
  assert.equal(presentation.tier, "tickler");
  assert.equal(presentation.label, "TICKLER");
  const view = freshnessFooterView(
    {
      counts: {
        walk: 76,
        upkeepToday: 0,
        byTier: {
          pre: 0, new: 0, projects: 0, pending: 10, next: 0,
          tickler: 14, rotten: 0, post: 0,
        },
      },
      queue: [ticklerEntry],
      tasksAvailable: true,
    },
    { current: ticklerEntry, todayText: D, navAvailable: true },
  );
  assert.equal(view.dueText, "Review 5/76");
  assert.equal(view.contextText, "TICKS 2/14");
  const pendingEntry = queueEntry({
    key: "p.md:1",
    tier: "pending",
    tierLabel: "PENDING",
    lane: "pending",
    fresh: "2026-10-07",
    interval: 1,
    daysOverdue: 0,
    rank: 5,
    tierRank: 3,
    tierTotal: 10,
  });
  assert.equal(
    freshnessReviewEntryView(pendingEntry, today).label,
    "PENDING",
  );
  const pendingView = freshnessFooterView(
    {
      counts: {
        walk: 76,
        upkeepToday: 0,
        byTier: {
          pre: 0, new: 0, projects: 0, pending: 10, next: 0,
          tickler: 0, rotten: 0, post: 0,
        },
      },
      queue: [pendingEntry],
      tasksAvailable: true,
    },
    { current: pendingEntry, todayText: D, navAvailable: true },
  );
  assert.equal(pendingView.contextText, "WIP 3/10");
});

test("legend line lists only current abbreviated tiers", () => {
  const legendFor = (view) =>
    view.tooltip.split("\n").find((line) => line.includes(" = "));
  const abbreviated = freshnessFooterView(
    {
      counts: {
        walk: 7,
        upkeepToday: 0,
        byTier: {
          new: 1, projects: 0, pending: 2, next: 0,
          tickler: 1, rotten: 3,
        },
      },
      queue: [queueEntry(), queueEntry({ key: "b" })],
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(
    legendFor(abbreviated),
    "WIP = PENDING · TICKS = TICKLER",
  );
  const plain = freshnessFooterView(
    {
      counts: {
        walk: 2,
        upkeepToday: 0,
        byTier: {
          new: 1, projects: 0, pending: 0, next: 1,
          tickler: 0, rotten: 0,
        },
      },
      queue: [queueEntry(), queueEntry({ key: "b" })],
      tasksAvailable: true,
    },
    { navAvailable: true },
  );
  assert.equal(legendFor(plain), undefined);
  assert.match(
    abbreviated.tooltip,
    /Footer splits TICKS from ROTTEN; dashboard ROTTEN chips still fold both\./,
  );
});

const QUICK_ROLL_OK = Object.freeze({
  ok: true,
  kind: "roll",
  line: "Alt+P roll P2 1/1 · 8–30d",
  compact: "Alt+P roll P2 1/1",
  detail: "Alt+P: roll P2 again (1 of 1), 8–30 days out",
});

function rottenQuickRollEntry(overrides = {}) {
  return queueEntry({
    key: "r.md:1",
    path: "r.md",
    line: 1,
    lineNumber: 0,
    originalMarkdown: "- [ ] #task Rotten",
    tier: "rotten",
    tierLabel: "ROTTEN",
    lane: "ready",
    state: "rotten",
    fresh: "2026-09-20",
    dueOn: null,
    daysOverdue: 18,
    interval: 7,
    rank: 14,
    tierRank: 2,
    tierTotal: 9,
    ...overrides,
  });
}

function quickRollMemo(entry) {
  return {
    counts: {
      walk: 31,
      upkeepToday: 4,
      budget: 15,
      budgetMet: false,
      byTier: {
        pre: 0,
        new: 0,
        projects: 0,
        pending: 0,
        next: 0,
        tickler: 2,
        rotten: 29,
        post: 0,
      },
    },
    queue: [entry],
    tasksAvailable: true,
  };
}

test("queue-row quickRoll preview takes the hint slot, tooltip, and aria", () => {
  const rotten = rottenQuickRollEntry();
  const memo = quickRollMemo(rotten);
  const options = { current: rotten, todayText: D, navAvailable: true };
  const plain = freshnessFooterView(memo, options);
  assert.equal(plain.hintText, "");
  const view = freshnessFooterView(memo, { ...options, quickRoll: QUICK_ROLL_OK });
  assert.equal(view.hintText, "Alt+P roll P2 1/1");
  assert.ok(
    view.tooltip.includes("Alt+P: roll P2 again (1 of 1), 8–30 days out"),
    "tooltip carries the full preview sentence",
  );
  assert.ok(
    view.tooltip.split("\n")[0].includes("Alt+P roll P2 1/1"),
    "first tooltip line carries the compact preview",
  );
  assert.ok(view.ariaLabel.includes("Alt+P roll P2 1/1"));
});

test("quickRoll detail sits next to the action hint on lane rows", () => {
  const next = queueEntry({
    key: "n.md:1",
    path: "n.md",
    line: 1,
    lineNumber: 0,
    originalMarkdown: "- [ ] #task Next",
    tier: "next",
    tierLabel: "NEXT",
    lane: "next",
    fresh: "2026-10-07",
    interval: 1,
    daysOverdue: 0,
    rank: 5,
    tierRank: 1,
    tierTotal: 3,
  });
  const view = freshnessFooterView(quickRollMemo(next), {
    current: next,
    todayText: D,
    navAvailable: true,
    quickRoll: QUICK_ROLL_OK,
  });
  assert.equal(view.hintText, "Alt+P roll P2 1/1");
  const lines = view.tooltip.split("\n");
  const detailAt = lines.indexOf(QUICK_ROLL_OK.detail);
  assert.notEqual(detailAt, -1);
  assert.equal(lines[detailAt + 1], view.current.actionHint);
  assert.ok(view.current.actionHint.includes("Alt+N release"));
});

test("missing or failed quickRoll leaves a queue-row footer byte-identical", () => {
  const rotten = rottenQuickRollEntry();
  const memo = quickRollMemo(rotten);
  const options = { current: rotten, todayText: D, navAvailable: true };
  const plain = freshnessFooterView(memo, options);
  assert.deepEqual(freshnessFooterView(memo, { ...options, quickRoll: null }), plain);
  assert.deepEqual(
    freshnessFooterView(memo, { ...options, quickRoll: { ok: false } }),
    plain,
  );
  assert.deepEqual(
    freshnessFooterView(memo, { ...options, quickRoll: { ok: false, reason: "no-config" } }),
    plain,
  );
});

test("off-walk prioritized preview replaces ]s next", () => {
  const memo = quickRollMemo(rottenQuickRollEntry());
  const offRow = freshnessFooterView(memo, {
    todayText: D,
    navAvailable: true,
    quickRoll: null,
  });
  assert.equal(offRow.hintText, "]s next");
  for (const preview of [
    QUICK_ROLL_OK,
    {
      ...QUICK_ROLL_OK,
      kind: "decay",
      compact: "Alt+P decay P2→P3",
      detail: "Alt+P: decay P2 → P3, 31–90 days out",
    },
    {
      ...QUICK_ROLL_OK,
      kind: "cancel",
      compact: "Alt+P cancel P4",
      detail: "Alt+P: cancel the task after decay past P4",
    },
  ]) {
    const view = freshnessFooterView(memo, {
      todayText: D,
      navAvailable: true,
      quickRoll: preview,
    });
    assert.equal(view.hintText, preview.compact);
    assert.equal(view.dueText, offRow.dueText);
    assert.equal(view.contextText, offRow.contextText);
    assert.equal(view.groupsText, offRow.groupsText);
    assert.ok(view.ariaLabel.includes(preview.compact));
    const lines = view.tooltip.split("\n");
    assert.equal(lines.at(-2), preview.detail);
    assert.equal(lines.at(-1), "click for the next due task");
  }
});

test("off-walk assign or kind-less preview keeps ]s next", () => {
  const memo = quickRollMemo(rottenQuickRollEntry());
  for (const quickRoll of [
    { ...QUICK_ROLL_OK, kind: "assign", compact: "Alt+P set high" },
    { ok: true, compact: "Alt+P roll P2 1/1", detail: "untyped preview" },
  ]) {
    const view = freshnessFooterView(memo, {
      todayText: D,
      navAvailable: true,
      quickRoll,
    });
    assert.equal(view.hintText, "]s next");
    assert.equal(view.tooltip.includes(quickRoll.detail), false);
  }
});

test("empty queue with a prioritized preview paints a hint-only footer", () => {
  const emptyMemo = {
    counts: {
      walk: 0,
      upkeepToday: 4,
      budget: 15,
      budgetMet: false,
      byTier: {},
    },
    queue: [],
    tasksAvailable: true,
  };
  const view = freshnessFooterView(emptyMemo, {
    navAvailable: true,
    quickRoll: QUICK_ROLL_OK,
  });
  assert.equal(view.visible, true);
  assert.equal(view.mode, "clear");
  assert.equal(view.dueText, "Nothing due");
  assert.equal(view.hintText, QUICK_ROLL_OK.compact);
  assert.deepEqual(view.groups, []);
  assert.equal(view.groupsText, "");
  assert.equal(view.meterText, "");
  assert.equal(view.current, null);
  assert.ok(view.tooltip.includes(QUICK_ROLL_OK.detail));
  assert.equal(view.tooltip.split("\n")[0], "Nothing due · " + QUICK_ROLL_OK.compact);

  const zeroWalkWithRows = freshnessFooterView(
    { ...emptyMemo, queue: [queueEntry()] },
    { navAvailable: true, quickRoll: QUICK_ROLL_OK },
  );
  assert.equal(zeroWalkWithRows.visible, true);
  assert.equal(zeroWalkWithRows.mode, "clear");
  assert.equal(zeroWalkWithRows.dueText, "Nothing due");
});

test("PRE rows stay unchanged under the nav checklist-tier contract", () => {
  const pre = queueEntry({
    tier: "pre",
    tierLabel: "PRE",
    lane: "ready",
    state: null,
    bucket: null,
    rank: 1,
    tierRank: 1,
    tierTotal: 1,
  });
  const memo = {
    counts: { walk: 2, byTier: { pre: 1, post: 1 } },
    queue: [pre, queueEntry({ key: "post", tier: "post", tierLabel: "POST" })],
    tasksAvailable: true,
  };
  const options = { current: pre, todayText: D, navAvailable: true };
  const plain = freshnessFooterView(memo, options);
  assert.deepEqual(
    freshnessFooterView(memo, {
      ...options,
      quickRoll: { ok: false, reason: "checklist-tier" },
    }),
    plain,
    "nav reports checklist tiers as unavailable, so the footer never changes",
  );
  assert.equal(plain.hintText, "");
});

function quickRollPluginApp({ navApi, cursor, tasks } = {}) {
  const app = makeFreshnessApp({
    tasks: tasks === undefined ? [makeFreshnessTask()] : tasks,
  });
  app.plugins.plugins["bob-navigation-hotkeys"] = { api: navApi === undefined ? null : navApi };
  if (cursor !== undefined) {
    app.workspace.getActiveViewOfType = () => cursor;
  }
  return app;
}

function quickRollCursor({
  lines = ["- [ ] #task Do it"],
  line = 0,
} = {}) {
  const view = new TestMarkdownView();
  let sourceLines = lines.slice();
  let currentLine = line;
  let valueReads = 0;
  view.editor = {
    getCursor: () => ({ line: currentLine }),
    getLine: (line0) => sourceLines[line0] || "",
    getValue: () => {
      valueReads += 1;
      return sourceLines.join("\n");
    },
  };
  view.file = { path: "notes/a.md" };
  view.setContent = (nextLines, nextLine = 0) => {
    sourceLines = nextLines.slice();
    currentLine = nextLine;
  };
  Object.defineProperty(view, "valueReads", { get: () => valueReads });
  return view;
}

test("status bar wires nav api.quickRoll into the hint slot", () => {
  withMissingConfig(() => {
    const seen = [];
    const navApi = {
      version: 3,
      quickRoll: {
        version: 1,
        preview: (args) => {
          seen.push(args);
          return { ...QUICK_ROLL_OK };
        },
      },
    };
    const app = quickRollPluginApp({ navApi, cursor: quickRollCursor() });
    const el = makeStatusEl();
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = makeStatusItemFactory(el);
    plugin.onload();
    try {
      plugin.updateFreshnessStatusBar();
      assert.equal(seen.length, 1);
      assert.equal(seen[0].line, 0);
      assert.deepEqual(seen[0].lines, ["- [ ] #task Do it"]);
      assert.equal(typeof seen[0].tier, "string");
      assert.ok(seen[0].tier.length > 0);
      assert.equal(findChild(el, "bob-freshness-hint").textContent, "Alt+P roll P2 1/1");
      const firstKey = plugin.freshnessFooterPaintKey;
      assert.ok(firstKey.includes("Alt+P roll P2 1/1"));
      navApi.quickRoll.preview = () => ({
        ok: true,
        kind: "decay",
        line: "Alt+P decay P2→P3 · 31–90d",
        compact: "Alt+P decay P2→P3",
        detail: "Alt+P: decay P2 → P3, 31–90 days out",
      });
      plugin.updateFreshnessStatusBar();
      assert.notEqual(plugin.freshnessFooterPaintKey, firstKey);
      assert.equal(findChild(el, "bob-freshness-hint").textContent, "Alt+P decay P2→P3");
    } finally {
      plugin.onunload();
    }
  });
});

test("empty-queue status bar previews only a checkbox task line", () => {
  withMissingConfig(() => {
    const seen = [];
    const navApi = {
      version: 3,
      quickRoll: {
        version: 1,
        preview: (args) => {
          seen.push(args);
          return { ...QUICK_ROLL_OK };
        },
      },
    };
    const cursor = quickRollCursor({
      lines: ["- [ ] #task Prioritized [priority:: medium]"],
    });
    const app = quickRollPluginApp({ navApi, cursor, tasks: [] });
    const el = makeStatusEl();
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = makeStatusItemFactory(el);
    plugin.onload();
    try {
      plugin.updateFreshnessStatusBar();
      assert.equal(seen.length, 1);
      assert.equal(seen[0].line, 0);
      assert.deepEqual(seen[0].lines, ["- [ ] #task Prioritized [priority:: medium]"]);
      assert.equal(Object.hasOwn(seen[0], "tier"), false);
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
      assert.equal(el.classList.has("bob-freshness-clear"), true);
      assert.equal(findChild(el, "bob-freshness-hint").textContent, QUICK_ROLL_OK.compact);

      const plainCursor = quickRollCursor({ lines: ["plain text"] });
      const plainApp = quickRollPluginApp({ navApi, cursor: plainCursor, tasks: [] });
      const plainEl = makeStatusEl();
      const plainPlugin = new LedgerToolsPlugin(plainApp, {});
      plainPlugin.addStatusBarItem = makeStatusItemFactory(plainEl);
      plainPlugin.onload();
      try {
        plainPlugin.updateFreshnessStatusBar();
        assert.equal(seen.length, 1, "non-task lines never call nav preview");
        assert.equal(plainCursor.valueReads, 0, "non-task lines avoid a full editor read");
        assert.equal(plainEl.classList.has("bob-freshness-hidden"), true);
      } finally {
        plainPlugin.onunload();
      }
    } finally {
      plugin.onunload();
    }
  });
});

test("off-walk task preview works with a queue and survives its 1-to-0 transition", () => {
  withMissingConfig(() => {
    const details = ["First preview detail", "Updated preview detail"];
    let detailIndex = 0;
    const seen = [];
    const navApi = {
      version: 3,
      quickRoll: {
        version: 1,
        preview: (args) => {
          seen.push(args);
          return {
            ok: true,
            kind: "roll",
            compact: "Alt+P roll P2 1/1",
            detail: details[detailIndex],
          };
        },
      },
    };
    const cursor = quickRollCursor({
      lines: [
        "- [ ] #task Do it",
        "- [ ] #task Prioritized [priority:: medium]",
      ],
      line: 1,
    });
    const tasks = [makeFreshnessTask()];
    const app = makeFreshnessApp({ tasks });
    app.plugins.plugins["bob-navigation-hotkeys"] = { api: navApi };
    app.workspace.getActiveViewOfType = () => cursor;
    const el = makeStatusEl();
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = makeStatusItemFactory(el);
    plugin.onload();
    try {
      plugin.updateFreshnessStatusBar();
      assert.equal(seen.length, 1);
      assert.equal(seen[0].line, 1);
      assert.equal(Object.hasOwn(seen[0], "tier"), false);
      assert.equal(findChild(el, "bob-freshness-hint").textContent, "Alt+P roll P2 1/1");
      const firstKey = plugin.freshnessFooterPaintKey;
      detailIndex = 1;
      plugin.updateFreshnessStatusBar();
      assert.notEqual(plugin.freshnessFooterPaintKey, firstKey);
      assert.match(el.attrs.title, /Updated preview detail/);

      tasks.length = 0;
      plugin.freshnessMemo = null;
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-clear"), true);
      assert.equal(findChild(el, "bob-freshness-due").textContent, "Nothing due");
      assert.equal(findChild(el, "bob-freshness-hint").textContent, "Alt+P roll P2 1/1");

      cursor.setContent(["plain text"]);
      plugin.updateFreshnessStatusBar({ contextOnly: true });
      assert.equal(el.classList.has("bob-freshness-hidden"), true);
    } finally {
      plugin.onunload();
    }
  });
});

test("status bar ignores missing, v0, or throwing quickRoll namespaces", () => {
  withMissingConfig(() => {
    for (const [name, quickRoll] of [
      ["missing namespace", undefined],
      ["v0 namespace", { version: 0, preview: () => ({ ...QUICK_ROLL_OK }) }],
      [
        "throwing preview",
        {
          version: 1,
          preview: () => {
            throw new Error("preview boom");
          },
        },
      ],
      ["unavailable preview", { version: 1, preview: () => ({ ok: false }) }],
    ]) {
      const navApi = quickRoll === undefined ? { version: 3 } : { version: 3, quickRoll };
      const app = quickRollPluginApp({ navApi, cursor: quickRollCursor() });
      const el = makeStatusEl();
      const plugin = new LedgerToolsPlugin(app, {});
      plugin.addStatusBarItem = makeStatusItemFactory(el);
      plugin.onload();
      try {
        plugin.updateFreshnessStatusBar();
        assert.equal(
          findChild(el, "bob-freshness-hint").textContent,
          "",
          `${name} leaves the hint slot empty`,
        );
        assert.equal(
          findChild(el, "bob-freshness-due").textContent.includes("Review"),
          true,
          `${name} still paints the footer`,
        );
      } finally {
        plugin.onunload();
      }
    }
  });
});

test("answer tiers list only tickler", () => {
  assert.deepEqual(FRESHNESS_FOOTER_ANSWER_TIERS, ["tickler"]);
});

function ticklerCurrent(overrides = {}) {
  return queueEntry({
    key: "t.md:1",
    path: "t.md",
    line: 1,
    lineNumber: 0,
    originalMarkdown: "- [ ] #task Tick",
    tier: "tickler",
    tierLabel: "TICKLER",
    lane: "ready",
    state: "resurfaced",
    fresh: "2026-10-05",
    dueOn: "2026-10-07",
    rank: 5,
    tierRank: 2,
    tierTotal: 14,
    ...overrides,
  });
}

function tickPreview(overrides = {}) {
  return Object.freeze({
    ok: true,
    kind: "decay",
    line: "Alt+P decay P2 → P3 · 31–90d",
    compact: "Alt+P decay P2→P3",
    detail: "Alt+P: decay P2 → P3, 31–90 days out",
    parts: Object.freeze({
      keyLabel: "Alt+P",
      verb: "decay",
      fromLabel: "P2",
      toLabel: "P3",
      step: null,
      limit: null,
    }),
    ...overrides,
  });
}

test("freshnessFooterAnswerChip builds structured segments for every kind", () => {
  const current = ticklerCurrent();
  const cases = [
    {
      name: "decay",
      preview: tickPreview(),
      roles: ["key", "space", "verb", "space", "from", "arrow", "to"],
    },
    {
      name: "roll with limit",
      preview: Object.freeze({
        ok: true, kind: "roll", compact: "Alt+P roll P2 1/1",
        detail: "Alt+P: roll P2 again (1 of 1), 8–30 days out",
        parts: Object.freeze({ keyLabel: "Alt+P", verb: "roll", fromLabel: null, toLabel: "P2", step: 1, limit: 1 }),
      }),
      roles: ["key", "space", "verb", "space", "to", "space", "count"],
    },
    {
      name: "roll without limit",
      preview: Object.freeze({
        ok: true, kind: "roll", compact: "Alt+P roll P2",
        detail: "Alt+P: roll P2 again",
        parts: Object.freeze({ keyLabel: "Alt+P", verb: "roll", fromLabel: null, toLabel: "P2", step: null, limit: null }),
      }),
      roles: ["key", "space", "verb", "space", "to"],
    },
    {
      name: "assign",
      preview: Object.freeze({
        ok: true, kind: "assign", compact: "Alt+P set P1",
        detail: "Alt+P: no priority — set P1",
        parts: Object.freeze({ keyLabel: "Alt+P", verb: "set", fromLabel: null, toLabel: "P1", step: null, limit: null }),
      }),
      roles: ["key", "space", "verb", "space", "to"],
    },
    {
      name: "cancel?",
      preview: Object.freeze({
        ok: true, kind: "cancel", compact: "Alt+P cancel?",
        detail: "Alt+P: cancel — decayed past P4 (confirm on the Task Card)",
        parts: Object.freeze({ keyLabel: "Alt+P", verb: "cancel?", fromLabel: null, toLabel: null, step: null, limit: null }),
      }),
      roles: ["key", "space", "verb"],
    },
    {
      name: "immediate cancel",
      preview: Object.freeze({
        ok: true, kind: "cancel", compact: "Alt+P cancel",
        detail: "Alt+P: cancel — decayed past P4",
        parts: Object.freeze({ keyLabel: "Alt+P", verb: "cancel", fromLabel: null, toLabel: null, step: null, limit: null }),
      }),
      roles: ["key", "space", "verb"],
    },
  ];
  for (const { name, preview, roles } of cases) {
    const chip = freshnessFooterAnswerChip(preview, { tier: "tickler", key: "t.md:1", rank: 5 });
    assert.ok(chip, name);
    assert.equal(chip.kind, preview.kind, name);
    assert.equal(chip.tier, "tickler", name);
    assert.equal(chip.text, preview.compact, name);
    assert.deepEqual(chip.segments.map((s) => s.role), roles, name);
    assert.equal(chip.segments.map((s) => s.text).join(""), chip.text, `${name} joins`);
    assert.ok(Object.isFrozen(chip), `${name} frozen`);
  }
  // Fallbacks: missing parts, parts that do not rebuild compact, compact with no space.
  const noParts = freshnessFooterAnswerChip(
    { ok: true, kind: "decay", compact: "Alt+P decay P2→P3", detail: "" },
    { tier: "tickler", key: "t.md:1", rank: 5 },
  );
  assert.deepEqual(noParts.segments.map((s) => s.role), ["key", "space", "action"]);
  const badParts = freshnessFooterAnswerChip(
    {
      ok: true, kind: "decay", compact: "Alt+P decay P2→P3", detail: "",
      parts: { keyLabel: "Alt+P", verb: "roll", fromLabel: null, toLabel: "P9", step: null, limit: null },
    },
    { tier: "tickler", key: "t.md:1", rank: 5 },
  );
  assert.deepEqual(badParts.segments.map((s) => s.role), ["key", "space", "action"]);
  const noSpace = freshnessFooterAnswerChip(
    { ok: true, kind: "roll", compact: "Alt+P", detail: "" },
    { tier: "tickler", key: "t.md:1", rank: 5 },
  );
  assert.deepEqual(noSpace.segments.map((s) => s.role), ["action"]);
  assert.equal(noSpace.segments.map((s) => s.text).join(""), "Alt+P");
  // Nulls: non-TICK tiers, ok:false, blank compact, unknown kind, garbage (never throws).
  const tickler = { tier: "tickler", key: "t.md:1", rank: 5 };
  assert.equal(freshnessFooterAnswerChip(tickPreview(), { tier: "next", key: "n", rank: 1 }), null);
  assert.equal(freshnessFooterAnswerChip(tickPreview(), { tier: "rotten", key: "r", rank: 1 }), null);
  assert.equal(freshnessFooterAnswerChip({ ok: false }, tickler), null);
  assert.equal(freshnessFooterAnswerChip({ ok: true, kind: "decay", compact: "   " }, tickler), null);
  assert.equal(freshnessFooterAnswerChip({ ok: true, kind: "nope", compact: "Alt+P nope" }, tickler), null);
  for (const bad of [null, undefined, 42, "x", {}, { ok: true }]) {
    assert.equal(freshnessFooterAnswerChip(bad, tickler), null);
    assert.equal(freshnessFooterAnswerChip(tickPreview(), bad), null);
  }
  // Same compact text on different rows keys differently.
  const a = freshnessFooterAnswerChip(tickPreview(), { tier: "tickler", key: "a.md:1", rank: 5 });
  const b = freshnessFooterAnswerChip(tickPreview(), { tier: "tickler", key: "b.md:9", rank: 9 });
  assert.notEqual(a.key, b.key);
});

test("a TICK row with a preview has answer set and unchanged hint, tooltip, and aria", () => {
  const current = ticklerCurrent();
  const preview = tickPreview();
  const memo = {
    counts: { walk: 14, upkeepToday: 1, budget: 5, budgetMet: false, byTier: { tickler: 14 } },
    queue: [current],
    tasksAvailable: true,
  };
  const plain = freshnessFooterView(memo, { current, todayText: D, navAvailable: true });
  assert.equal(plain.answer, null);
  const view = freshnessFooterView(memo, { current, todayText: D, navAvailable: true, quickRoll: preview });
  assert.ok(view.answer);
  assert.equal(view.answer.text, preview.compact);
  assert.equal(view.answer.title, preview.detail);
  assert.equal(view.hintText, preview.compact);
  // Tooltip and aria carry the same preview sentences as before the chip.
  assert.ok(view.tooltip.includes(preview.compact));
  assert.ok(view.tooltip.includes(preview.detail));
  assert.ok(view.ariaLabel.includes(preview.compact));
  for (const tier of ["next", "rotten", "new", "recurring"]) {
    const row = queueEntry({ key: `${tier}.md:1`, tier, tierLabel: tier.toUpperCase(), rank: 1, tierRank: 1, tierTotal: 1 });
    const tierView = freshnessFooterView(
      { counts: { walk: 1, byTier: { [tier]: 1 } }, queue: [row], tasksAvailable: true },
      { current: row, todayText: D, navAvailable: true, quickRoll: preview },
    );
    assert.equal(tierView.answer, null, tier);
  }
  // Off-walk, hint-only, and hidden views carry no answer.
  const offWalk = freshnessFooterView(memo, { todayText: D, navAvailable: true, quickRoll: { ok: true, kind: "roll", compact: "Alt+P roll P2 1/1" } });
  assert.equal(offWalk.answer, null);
  const hintOnly = freshnessFooterView({ counts: { walk: 0 }, queue: [] }, { navAvailable: true, quickRoll: QUICK_ROLL_OK });
  assert.equal(hintOnly.answer, null);
  assert.equal(freshnessFooterView({ queue: [], counts: { walk: 0 } }).answer, null);
});

test("a TICK view paints the answer chip and reuses or clears it by key", () => {
  const current = ticklerCurrent();
  const preview = tickPreview();
  const memo = {
    counts: { walk: 14, upkeepToday: 1, budget: 5, budgetMet: false, byTier: { tickler: 14 } },
    queue: [current],
    tasksAvailable: true,
  };
  const view = freshnessFooterView(memo, { current, todayText: D, navAvailable: true, quickRoll: preview });
  const el = makeStatusEl();
  const parts = freshnessFooterPaint(el, view);
  const hint = parts.hint;
  const chip = findChild(el, "bob-freshness-answer");
  assert.ok(chip, "chip painted");
  assert.equal(chip.attrs["data-review-tier"], "tickler");
  assert.equal(chip.attrs["data-answer-kind"], "decay");
  assert.equal(chip.attrs.title, preview.detail);
  const keycap = findChild(el, "bob-freshness-answer-key");
  assert.ok(keycap);
  assert.equal(keycap.tag, "kbd");
  assert.equal(keycap.text, "Alt+P");
  assert.equal(deepText(hint), view.hintText);
  // Same key keeps the same chip node (no rebuild).
  const before = chip;
  freshnessFooterPaint(el, view);
  assert.equal(findChild(el, "bob-freshness-answer"), before);
  // A new row with the same text gets a new key and rebuilds.
  const other = ticklerCurrent({ key: "other.md:9", path: "other.md", rank: 9, tierRank: 9 });
  const otherView = freshnessFooterView(
    { counts: memo.counts, queue: [other], tasksAvailable: true },
    { current: other, todayText: D, navAvailable: true, quickRoll: preview },
  );
  assert.notEqual(otherView.answer.key, view.answer.key);
  freshnessFooterPaint(el, otherView);
  const rebuilt = findChild(el, "bob-freshness-answer");
  assert.ok(rebuilt);
  assert.notEqual(rebuilt, before);
  assert.equal(deepText(parts.hint), otherView.hintText);
  // A non-TICK row clears the chip and paints plain text.
  const nextRow = queueEntry({ key: "n.md:1", tier: "next", tierLabel: "NEXT", lane: "next", rank: 1, tierRank: 1, tierTotal: 1 });
  const nextView = freshnessFooterView(
    { counts: { walk: 1, byTier: { next: 1 } }, queue: [nextRow], tasksAvailable: true },
    { current: nextRow, todayText: D, navAvailable: true, quickRoll: preview },
  );
  assert.equal(nextView.answer, null);
  freshnessFooterPaint(el, nextView);
  assert.equal(findChild(el, "bob-freshness-answer"), null);
  assert.equal(deepText(parts.hint), nextView.hintText);
  // A hidden view clears the chip too.
  freshnessFooterPaint(el, view);
  assert.ok(findChild(el, "bob-freshness-answer"));
  freshnessFooterPaint(el, freshnessFooterView({ counts: { walk: 0 }, queue: [] }));
  assert.equal(findChild(el, "bob-freshness-answer"), null);
});

test("a TICK fit sheds the meter before the hint chip", () => {
  const current = ticklerCurrent();
  const view = freshnessFooterView(
    {
      counts: {
        walk: 9, upkeepToday: 0, budget: 15,
        byTier: { pre: 1, new: 1, projects: 1, pending: 1, next: 1, recurring: 1, tickler: 1, rotten: 1, post: 1 },
      },
      queue: [current],
      tasksAvailable: true,
    },
    { current, todayText: D, navAvailable: true, quickRoll: tickPreview() },
  );
  assert.ok(view.answer);
  const el = makeStatusEl();
  el.clientWidth = 1000;
  const widthOf = (node) => {
    if (node.classList.has("bob-freshness-main")) return 40;
    if (node.classList.has("bob-freshness-context")) return 30;
    if (node.classList.has("bob-freshness-detail")) return 30;
    if (node.classList.has("bob-freshness-hint")) return 30;
    if (node.classList.has("bob-freshness-meter")) return 30;
    if (node.classList.has("bob-freshness-groups")) {
      return node.children.reduce((sum, child) => {
        if (child.classList.has("bob-freshness-omit")) return sum;
        return sum + (child.classList.has("bob-freshness-group") ? 10 : 5);
      }, 0);
    }
    return 0;
  };
  Object.defineProperty(el, "scrollWidth", {
    configurable: true,
    get() {
      return this.children.reduce((sum, child) => {
        if (child.classList.has("bob-freshness-omit")) return sum;
        return sum + widthOf(child);
      }, 0);
    },
  });
  const parts = freshnessFooterPaint(el, view);
  el.clientWidth = 155;
  const shedDetail = freshnessFooterFit(el, parts, view);
  assert.equal(shedDetail.detail, false);
  assert.equal(shedDetail.hint, true);
  assert.equal(shedDetail.meter, true);
  el.clientWidth = 120;
  const shedMeter = freshnessFooterFit(el, parts, view);
  assert.deepEqual([shedMeter.meter, shedMeter.hint], [false, true]);
  el.clientWidth = 90;
  const shedHint = freshnessFooterFit(el, parts, view);
  assert.deepEqual([shedHint.meter, shedHint.hint], [false, false]);
});

test("the footer stylesheet defines the TICK answer chip", () => {
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.equal(css.includes(".bob-freshness-answer"), true);
  assert.equal(css.includes('.bob-freshness-answer[data-answer-kind="cancel"]'), true);
  assert.equal(css.includes(".bob-freshness-answer-key"), true);
  assert.equal(css.includes("@keyframes bob-freshness-answer-land"), true);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.bob-freshness \.bob-freshness-answer[\s\S]*?animation: none/);
});

// Walker-footer host (plan 202611/walker_footers.md, phase host): one
// ledger status item follows the persisted bracket family. These tests
// drive the plugin through `updateFreshnessStatusBar` with a fake nav
// api, the same way the status-bar tests above drive the legacy path.

const WALK_MODE_COMMAND = "bob-navigation-hotkeys:jump-to-next-due-task";

function makeWalkerWorkspace() {
  const listeners = new Map();
  const layoutCbs = [];
  return {
    listeners,
    layoutCbs,
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
      return { event, handler };
    },
    offref() {},
    onLayoutReady(cb) {
      layoutCbs.push(cb);
      return {};
    },
    getActiveFile: () => null,
    getActiveViewOfType: () => null,
    trigger: () => {},
    fire(event) {
      for (const handler of listeners.get(event) || []) handler();
    },
    count(event) {
      return (listeners.get(event) || []).length;
    },
  };
}

function makeWalkerNav({ mode = "s", walkVersion = 1, navVersion = 3, quickRoll = null } = {}) {
  const api = { version: navVersion };
  if (walkVersion !== null) {
    api.walkMode = {
      version: walkVersion,
      current: () => mode,
    };
  }
  if (quickRoll) {
    api.quickRoll = { version: 1, preview: () => quickRoll };
  }
  return { api };
}

function makeWalkerApp({ tasks, nav = null, workspace = null, navCommand = true } = {}) {
  const ws = workspace || makeWalkerWorkspace();
  const plugins = {
    "obsidian-tasks-plugin": { getTasks: () => tasks },
  };
  if (nav) {
    plugins["bob-navigation-hotkeys"] = nav;
  }
  return {
    app: {
      vault: {
        getAbstractFileByPath: () => null,
        cachedRead: () => Promise.resolve(null),
      },
      workspace: ws,
      metadataCache: {
        on: () => ({}),
        getCache: () => null,
        getFileCache: () => ({}),
        getFirstLinkpathDest: () => null,
      },
      commands: navCommand ? { commands: { [WALK_MODE_COMMAND]: {} } } : {},
      plugins: { plugins },
    },
    workspace: ws,
  };
}

function setupWalkerPlugin({ tasks, nav = null, navCommand = true } = {}) {
  const workspace = makeWalkerWorkspace();
  const { app } = makeWalkerApp({ tasks, nav, workspace, navCommand });
  const el = makeStatusEl();
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.addStatusBarItem = makeStatusItemFactory(el);
  plugin.onload();
  return { app, workspace, el, plugin };
}

function dueTextOf(el) {
  const node = findChild(el, "bob-freshness-due");
  return node ? node.textContent : null;
}

test("walker host keeps the same status item and marks it", () => {
  withMissingConfig(() => {
    const { el, plugin } = setupWalkerPlugin({ tasks: [makeFreshnessTask()] });
    try {
      plugin.updateFreshnessStatusBar();
      assert.equal(plugin.freshnessStatusEl, el);
      assert.equal(el.classList.has("bob-freshness"), true);
      assert.equal(el.classList.has("bob-walker-footer"), true);
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
    } finally {
      plugin.onunload();
    }
  });
});

test("gated s panel keeps the review footer with ]] next hints", () => {
  withMissingConfig(() => {
    const nav = makeWalkerNav({ mode: "s" });
    const { el, plugin } = setupWalkerPlugin({ tasks: [makeFreshnessTask()], nav });
    try {
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
      assert.equal(dueTextOf(el), "Review 1 due");
      assert.equal(plugin.freshnessFooterLastView.hintText, "]] next");
      assert.ok(plugin.freshnessFooterLastView.tooltip.includes("]] next"));
      assert.ok(plugin.freshnessFooterLastView.ariaLabel.includes("]] next"));
    } finally {
      plugin.onunload();
    }
  });
});

test("n routes to links while w and unset hide the panel", () => {
  withMissingConfig(() => {
    const nav = makeWalkerNav({ mode: "n" });
    const links = setupWalkerPlugin({ tasks: [makeFreshnessTask()], nav });
    try {
      links.plugin.updateFreshnessStatusBar();
      assert.equal(links.el.classList.has("bob-freshness-hidden"), false, "mode n shows links");
      assert.equal(links.plugin.freshnessFooterLastView.mode, "links");
      assert.equal(links.plugin.freshnessFooterLastView.linkState, "open-note");
    } finally {
      links.plugin.onunload();
    }

    for (const mode of ["w", null]) {
      const nav = makeWalkerNav({ mode });
      const { el, plugin } = setupWalkerPlugin({ tasks: [makeFreshnessTask()], nav });
      try {
        plugin.updateFreshnessStatusBar();
        assert.equal(el.classList.has("bob-freshness-hidden"), true, `mode ${mode} hides`);
        assert.equal(plugin.freshnessFooterLastView.visible, false);
      } finally {
        plugin.onunload();
      }
    }
  });
});

test("an invalid stored family never paints as s", () => {
  withMissingConfig(() => {
    const nav = makeWalkerNav({ mode: "bogus" });
    const { el, plugin } = setupWalkerPlugin({ tasks: [makeFreshnessTask()], nav });
    try {
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), true);
    } finally {
      plugin.onunload();
    }
  });
});

test("doorbell repaints synchronously on family change", () => {
  withMissingConfig(() => {
    let mode = "s";
    const nav = makeWalkerNav({ mode: "s" });
    nav.api.walkMode.current = () => mode;
    const { el, workspace, plugin } = setupWalkerPlugin({ tasks: [makeFreshnessTask()], nav });
    try {
      assert.equal(workspace.count("bob-navigation-hotkeys:walk-mode"), 1);
      plugin.updateFreshnessStatusBar();
      assert.equal(dueTextOf(el), "Review 1 due");
      mode = "w";
      workspace.fire("bob-navigation-hotkeys:walk-mode");
      assert.equal(el.classList.has("bob-freshness-hidden"), true);
      assert.equal(dueTextOf(el), "");
      mode = "s";
      workspace.fire("bob-navigation-hotkeys:walk-mode");
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
      assert.equal(dueTextOf(el), "Review 1 due");
    } finally {
      plugin.onunload();
    }
  });
});

test("empty queue paints Review clear while s is selected", () => {
  withMissingConfig(() => {
    const nav = makeWalkerNav({ mode: "s" });
    const { el, plugin } = setupWalkerPlugin({ tasks: [], nav });
    try {
      plugin.updateFreshnessStatusBar();
      const view = plugin.freshnessFooterLastView;
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
      assert.equal(view.visible, true);
      assert.equal(view.mode, "clear");
      assert.equal(view.dueText, "Review clear");
      assert.match(view.meterText, /^✓ (\d+)(\/\d+)? today$/);
      assert.equal(el.classList.has("bob-freshness-clear"), true);
      assert.equal(dueTextOf(el), "Review clear");
      assert.ok(!view.tooltip.includes("Nothing due"));
    } finally {
      plugin.onunload();
    }
  });
});

test("clear state keeps the prioritized Alt+P preview", () => {
  withMissingConfig(() => {
    const preview = {
      ok: true,
      kind: "roll",
      compact: "Alt+P roll P2 1/1",
      detail: "Alt+P: roll P2 again (1 of 1)",
    };
    const nav = makeWalkerNav({ mode: "s", quickRoll: preview });
    const workspace = makeWalkerWorkspace();
    const fakeView = new TestMarkdownView();
    fakeView.editor = {
      getCursor: () => ({ line: 0 }),
      getLine: () => "- [ ] #task Do it",
      getValue: () => "- [ ] #task Do it\n",
    };
    fakeView.file = { path: "notes/a.md" };
    workspace.getActiveViewOfType = () => fakeView;
    const { app } = makeWalkerApp({ tasks: [], nav, workspace });
    const el = makeStatusEl();
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = makeStatusItemFactory(el);
    plugin.onload();
    try {
      plugin.updateFreshnessStatusBar();
      const view = plugin.freshnessFooterLastView;
      assert.equal(view.visible, true);
      assert.equal(view.dueText, "Review clear");
      assert.equal(view.hintText, "Alt+P roll P2 1/1");
      assert.ok(view.tooltip.includes("Alt+P: roll P2 again (1 of 1)"));
    } finally {
      plugin.onunload();
    }
  });
});

test("legacy fallback without nav paints today's footer byte-identical", () => {
  withMissingConfig(() => {
    const { plugin } = setupWalkerPlugin({ tasks: [makeFreshnessTask()], nav: null, navCommand: false });
    try {
      plugin.updateFreshnessStatusBar();
      const memo = plugin.freshnessMemo;
      const expected = freshnessFooterView(memo, {
        current: null,
        navAvailable: false,
        todayText: memo.dateText,
        mostOverdue: null,
        queue: memo.queue,
        quickRoll: null,
      });
      assert.deepEqual(plugin.freshnessFooterLastView, expected);
      assert.equal(plugin.freshnessFooterLastView.hintText, "open review");
    } finally {
      plugin.onunload();
    }
  });
});

test("old nav without walkMode keeps the ]s next legacy footer", () => {
  withMissingConfig(() => {
    const nav = makeWalkerNav({ mode: "s", walkVersion: 0 });
    const { el, plugin } = setupWalkerPlugin({ tasks: [makeFreshnessTask()], nav });
    try {
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
      assert.equal(dueTextOf(el), "Review 1 due");
      assert.equal(plugin.freshnessFooterLastView.hintText, "]s next");
    } finally {
      plugin.onunload();
    }
  });
});

test("late nav arrival gates the footer; nav removal restores legacy", () => {
  withMissingConfig(() => {
    const { app, el, plugin } = setupWalkerPlugin({ tasks: [makeFreshnessTask()] });
    try {
      plugin.updateFreshnessStatusBar();
      assert.equal(dueTextOf(el), "Review 1 due");
      assert.equal(plugin.freshnessFooterLastView.hintText, "]s next");
      app.plugins.plugins["bob-navigation-hotkeys"] = makeWalkerNav({ mode: "w" });
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), true);
      app.plugins.plugins["bob-navigation-hotkeys"].api.walkMode.current = () => "s";
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
      assert.equal(plugin.freshnessFooterLastView.hintText, "]] next");
      delete app.plugins.plugins["bob-navigation-hotkeys"];
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
      assert.equal(plugin.freshnessFooterLastView.hintText, "]s next");
    } finally {
      plugin.onunload();
    }
  });
});

test("unload and reload mount one item and one doorbell subscription", () => {
  withMissingConfig(() => {
    const nav = makeWalkerNav({ mode: "s" });
    const workspace = makeWalkerWorkspace();
    const { app } = makeWalkerApp({ tasks: [makeFreshnessTask()], nav, workspace });
    let items = 0;
    const els = [];
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = () => {
      items += 1;
      const el = makeStatusEl();
      els.push(el);
      return el;
    };
    plugin.onload();
    // First cycle mounts two items: the walker footer plus the pre-existing
    // Keep inbox item. The Keep item survives unload (its element is never
    // nulled), so the second cycle mounts only the footer again.
    assert.equal(items, 2);
    assert.equal(workspace.count("bob-navigation-hotkeys:walk-mode"), 1);
    const firstFooterEl = plugin.freshnessStatusEl;
    plugin.onunload();
    plugin.onload();
    try {
      assert.equal(items, 3);
      assert.equal(workspace.count("bob-navigation-hotkeys:walk-mode"), 2);
      assert.notEqual(plugin.freshnessStatusEl, firstFooterEl);
      assert.equal(plugin.freshnessStatusEl, els[els.length - 1]);
      assert.equal(plugin.freshnessStatusEl.classList.has("bob-walker-footer"), true);
    } finally {
      plugin.onunload();
    }
  });
});

test("a throwing doorbell path never breaks setup or painting", () => {
  withMissingConfig(() => {
    const nav = makeWalkerNav({ mode: "s" });
    const { app, el, plugin } = setupWalkerPlugin({ tasks: [makeFreshnessTask()], nav });
    try {
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
      // A workspace without events still gets a mounted footer: the
      // doorbell subscribe path never throws.
      const realWorkspace = plugin.app.workspace;
      const throwingWorkspace = makeWalkerWorkspace();
      throwingWorkspace.on = () => {
        throw new Error("no events");
      };
      plugin.app.workspace = throwingWorkspace;
      try {
        plugin.subscribeWalkerFooterDoorbell();
      } finally {
        plugin.app.workspace = realWorkspace;
      }
      assert.equal(plugin.freshnessStatusEl, el);
      const throwingNav = {
        api: {
          version: 3,
          walkMode: {
            version: 1,
            current: () => {
              throw new Error("no storage");
            },
          },
        },
      };
      app.plugins.plugins["bob-navigation-hotkeys"] = throwingNav;
      plugin.updateFreshnessStatusBar();
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
      assert.equal(plugin.freshnessFooterLastView.hintText, "]s next");
    } finally {
      plugin.onunload();
    }
  });
});
