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
  freshnessMatchQueueCursor,
  freshnessQueue,
  freshnessReviewEntryView,
  freshnessTierFooterLabel,
} = helpers;

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
  const hidden = freshnessFooterView(
    {
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
    },
    { navAvailable: true },
  );
  assert.equal(hidden.visible, false);
  assert.equal(hidden.groupsText, "");
  assert.equal(hidden.meterText, "");
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
    plugin.addStatusBarItem = () => el;
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
    plugin.addStatusBarItem = () => el;
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
    plugin.addStatusBarItem = () => el;
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

test("missing, failed, or off-row quickRoll leaves the footer byte-identical", () => {
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
  const offRow = freshnessFooterView(memo, {
    todayText: D,
    navAvailable: true,
    quickRoll: QUICK_ROLL_OK,
  });
  assert.equal(offRow.hintText, "]s next");
  assert.equal(offRow.tooltip.includes(QUICK_ROLL_OK.detail), false);
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

function quickRollPluginApp({ navApi, cursor } = {}) {
  const app = makeFreshnessApp({ tasks: [makeFreshnessTask()] });
  app.plugins.plugins["bob-navigation-hotkeys"] = { api: navApi === undefined ? null : navApi };
  if (cursor !== undefined) {
    app.workspace.getActiveViewOfType = () => cursor;
  }
  return app;
}

function quickRollCursor() {
  const view = new TestMarkdownView();
  view.editor = {
    getCursor: () => ({ line: 0 }),
    getLine: () => "- [ ] #task Do it",
    getValue: () => "- [ ] #task Do it",
  };
  view.file = { path: "notes/a.md" };
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
    plugin.addStatusBarItem = () => el;
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
      plugin.addStatusBarItem = () => el;
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
