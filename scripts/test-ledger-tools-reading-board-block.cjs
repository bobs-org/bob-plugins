// Reading Board block: fake-DOM rendering of every lane and state, ARIA,
// roving focus and keys, click routing, the PDF hand-off, TODAY pills,
// prerequisite highlighting, the read-only guarantee, repaint behavior,
// teardown, and the stylesheet contract. Data comes from the checked-in real
// `bob ref list` output, never hand-shaped rows (variants derive from it).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");

const {
  READING_BOARD_HINT_TEXT,
  readingBoardBuildArgs,
  readingBoardCacheKey,
  readingBoardDecodeReport,
  readingBoardHeaderTime,
  readingBoardLinkTarget,
  readingBoardMoveTarget,
  readingBoardTaskKey,
} = LedgerToolsPlugin.helpers;

const pluginRoot = path.join(__dirname, "..", "plugins", "bob-ledger-tools");
const fixtureDocument = JSON.parse(
  fs.readFileSync(path.join(pluginRoot, "scripts/fixtures/reading-board/ref-list.json"), "utf8"),
);
const decoded = readingBoardDecodeReport(JSON.stringify(fixtureDocument), "");
assert.equal(decoded.ok, true, "the shared fixture must be valid bob output");
const REPORT = decoded.report;
const SOURCE = "dash_references.md";
const NOW = new Date(2026, 9, 20, 9, 0, 0);

class FakeNode {
  constructor(tag, doc) {
    this.tag = tag;
    this.tagName = String(tag).toUpperCase();
    this.doc = doc;
    this.children = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.listeners = new Map();
    this.textContent = "";
    this.scrollTop = 0;
  }

  // Short descriptor so a failing assert comparing two live nodes reports
  // instead of diffing the whole cyclic graph (bob-cli-c7).
  [require("node:util").inspect.custom]() {
    const cls = this.getAttribute("class");
    const kids = Array.isArray(this.children) ? this.children.length : 0;
    const raw = typeof this.textContent === "string" ? this.textContent : "";
    const flat = raw.replace(/\s+/g, " ");
    const text = flat.length > 40 ? flat.slice(0, 40) + "…" : flat;
    const dot = cls ? "." + String(cls).split(/\s+/).filter(Boolean).join(".") : "";
    return `FakeNode(${this.tagName}${dot} children=${kids} text=${JSON.stringify(text)})`;
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  removeAttribute(name) {
    this.attrs.delete(name);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }

  fire(event, payload = {}) {
    const fired = {
      target: this,
      defaultPrevented: false,
      stopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      ...payload,
    };
    for (const handler of this.listeners.get(event) || []) {
      handler(fired);
    }
    return fired;
  }

  focus() {
    this.doc.activeElement = this;
    this.fire("focus");
  }

  contains(node) {
    for (let current = node; current; current = current.parentNode) {
      if (current === this) {
        return true;
      }
    }
    return false;
  }

  matches(selector) {
    const classes = (this.getAttribute("class") || "").split(/\s+/);
    const tag = /^[a-z][a-z0-9]*/i.exec(selector);
    if (tag && tag[0].toLowerCase() !== this.tag) {
      return false;
    }
    for (const match of selector.matchAll(/\.([\w-]+)/g)) {
      if (!classes.includes(match[1])) {
        return false;
      }
    }
    for (const match of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const value = this.getAttribute(match[1]);
      if (value === null || (match[2] !== undefined && value !== match[2])) {
        return false;
      }
    }
    return true;
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches && child.matches(selector)) {
          found.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  get text() {
    return [this.textContent, ...this.children.map((child) => child.text)].join(" ");
  }
}

function fakeContainer() {
  const doc = {
    activeElement: null,
    createElement: (tag) => new FakeNode(tag, doc),
    createTextNode: (text) => {
      const node = new FakeNode("#text", doc);
      node.textContent = String(text);
      return node;
    },
  };
  const el = new FakeNode("div", doc);
  el.ownerDocument = doc;
  el.empty = () => {
    el.children = [];
  };
  return el;
}

function all(node, predicate) {
  const found = [];
  const visit = (current) => {
    for (const child of current.children) {
      if (predicate(child)) {
        found.push(child);
      }
      visit(child);
    }
  };
  visit(node);
  return found;
}

function variant(path_, change) {
  const row = REPORT.refs.find((entry) => entry.path === path_);
  assert.ok(row, `fixture row ${path_}`);
  return { ...row, ...change(row) };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeHarness({
  report = REPORT,
  nav = false,
  mac = false,
  todayKeys = [],
  todayReady = true,
  cache = true,
  realData = false,
} = {}) {
  const app = makeFreshnessApp({ tasks: [] });
  const opened = [];
  const hovers = [];
  const pdfs = [];
  const writes = [];
  app.workspace.openLinkText = async (...args) => {
    opened.push(args);
  };
  app.workspace.trigger = (name, payload) => {
    if (name === "hover-link") {
      hovers.push(payload);
    }
  };
  for (const name of ["modify", "process", "create", "append", "delete", "rename", "trash"]) {
    app.vault[name] = (...args) => writes.push(`vault.${name}:${args[0] && args[0].path}`);
  }
  app.vault.adapter = {};
  for (const name of ["write", "append", "remove", "rename", "mkdir"]) {
    app.vault.adapter[name] = (...args) => writes.push(`adapter.${name}:${args[0]}`);
  }
  if (nav) {
    app.plugins.plugins["bob-navigation-hotkeys"] = {
      api: {
        version: 3,
        openReferencePdf: (file) => {
          pdfs.push(file);
          return Promise.resolve({ ok: true });
        },
      },
    };
  }
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  plugin.readingBoardNowDate = () => NOW;
  plugin.readingBoardIsMacOS = () => mac;
  plugin.isTodayCacheReady = () => todayReady;
  plugin.todayCache = { rank: new Map(todayKeys.map((key, index) => [key, index])) };
  plugin.fetchCalls = [];
  if (!realData) {
    plugin.apiReadingBoardFetch = async (fence) => {
      plugin.fetchCalls.push(fence);
      return { report: null, stale: false, error: { code: "failed", message: "unexpected fetch" } };
    };
  }
  const cacheKey = (fence = {}) => readingBoardCacheKey(readingBoardBuildArgs(fence));
  if (cache) {
    plugin.readingBoardCacheSet(cacheKey(), report);
  }
  const children = [];
  const mount = (source = "", sourcePath = SOURCE) => {
    const el = fakeContainer();
    plugin.renderReadingBoardBlock(el, { sourcePath, addChild: (child) => children.push(child) }, source);
    const view = Array.from(plugin.readingBoardViewsStore()).pop();
    return { el, view };
  };
  return { app, plugin, opened, hovers, pdfs, writes, children, mount, cacheKey };
}

async function withBoard(options, run) {
  await withMissingConfig(async () => {
    const harness = makeHarness(options);
    try {
      await run(harness);
    } finally {
      harness.plugin.onunload();
    }
  });
}

function press(el, key, modifiers = {}) {
  const root = el.querySelector(".bob-reading-board");
  const target = el.ownerDocument.activeElement || root;
  return root.fire("keydown", { key, target, ...modifiers });
}

function cardFor(el, pathname) {
  return all(el, (node) => node.getAttribute("data-path") === pathname)[0];
}

function lanePaths(el, lane) {
  return all(
    el,
    (node) => node.getAttribute("data-lane") === lane && node.getAttribute("role") === "listitem",
  ).map((node) => node.getAttribute("data-path"));
}

test("the board registers its code block processor and the Open Reading Board command", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      assert.equal(typeof plugin.codeBlocks["bob-reading-board"], "function");
      const command = plugin.commands.find((entry) => entry.id === "open-reading-board");
      assert.ok(command, "Open Reading Board command registers");
      assert.equal(command.name, "Open Reading Board");
      let opened = null;
      app.workspace.openLinkText = async (...args) => {
        opened = args;
      };
      command.callback();
      assert.deepEqual(opened, ["dash_references", "", false]);
    } finally {
      plugin.onunload();
    }
  });
});

test("four lanes render with counts, list and listitem roles, and one hint", async () => {
  await withBoard({}, ({ mount, plugin }) => {
    const { el } = mount();
    const root = el.querySelector(".bob-reading-board");
    assert.equal(root.getAttribute("role"), "region");
    assert.equal(root.getAttribute("aria-label"), "Reading Board");
    const hint = all(el, (node) => node.getAttribute("id") === root.getAttribute("aria-describedby"))[0];
    assert.ok(hint, "aria-describedby points at one hidden hint");
    assert.equal(hint.textContent, READING_BOARD_HINT_TEXT);
    assert.match(hint.textContent, /Enter/);
    assert.match(hint.textContent, /Alt/);
    assert.match(hint.textContent, /r refreshes/);
    assert.deepEqual(
      el.querySelectorAll(".bob-reading-board-lane-label").map((node) => node.textContent),
      ["📖 Reading", "⭐ Next", "📥 Ready", "💤 Snoozed"],
    );
    assert.deepEqual(
      el.querySelectorAll(".bob-reading-board-lane-count").map((node) => node.textContent),
      ["1", "2", "11", "12"],
    );
    assert.deepEqual(
      all(el, (node) => node.getAttribute("role") === "list").map((node) => node.getAttribute("aria-label")),
      ["Reading, 1 reference", "Next, 2 references", "Ready, 11 references", "Snoozed, 12 references"],
    );
    assert.match(el.querySelector(".bob-reading-board-summary").textContent, /^14 awake · 12 snoozed$/);
    assert.equal(el.querySelector(".bob-reading-board-time").textContent, "12:00");
    const live = all(el, (node) => node.getAttribute("aria-live") === "polite");
    assert.equal(live.length, 1);
    assert.equal(live[0].getAttribute("role"), "status");
    const items = all(el, (node) => node.getAttribute("role") === "listitem");
    assert.equal(items.length, 26);
    for (const item of items) {
      assert.equal(item.getAttribute("draggable"), "false", "cards are never draggable");
    }
    assert.equal(
      all(el, (node) => node.attrs.has("contenteditable")).length,
      0,
      "nothing is contenteditable",
    );
    assert.equal(
      el.querySelector(".bob-reading-board-refresh").getAttribute("aria-label"),
      "Refresh reading board",
    );
    assert.equal(plugin.fetchCalls.length, 0, "painting from the cache never spawns bob");
  });
});

test("awake cards show kind, topic, added mark, counts, priority, and the pending-sync star", async () => {
  const synced = variant("ref/papers/synced_paper.md", () => ({
    status_sync: "pending",
    audio: true,
    added: "2026-10-17",
  }));
  const report = { ...REPORT, refs: REPORT.refs.map((row) => (row.path === synced.path ? synced : row)) };
  await withBoard({ report }, ({ mount }) => {
    const { el } = mount();
    const card = cardFor(el, "ref/papers/synced_paper.md");
    assert.match(card.querySelector(".bob-reading-board-kind").text, /📄 Paper/);
    assert.equal(card.querySelector(".bob-reading-board-topic").textContent, "reading_list");
    assert.ok(card.querySelector(".bob-date-mark"), "added date wears the shared date mark");
    assert.equal(card.querySelector(".bob-reading-board-audio").textContent, "♫");
    assert.equal(card.querySelector(".bob-reading-board-annotations").textContent, "✎ 1");
    assert.equal(card.querySelector(".bob-reading-board-sync").textContent, "*");
    assert.match(
      card.querySelector(".bob-reading-board-sync").getAttribute("aria-label"),
      /Frontmatter status catches up/,
    );
    const priority = cardFor(el, "ref/chat/chat_ready.md");
    assert.ok(priority.querySelector(".bob-priority-mark"), "priority wears the shared priority mark");
    assert.equal(
      all(priority, (node) => /Ctrl\+Shift\+P/.test(node.getAttribute("aria-label") || "")).length,
      0,
      "reused marks drop their editor-only hint",
    );
  });
});

test("a path-valued Bob audio field produces exactly one visible music marker", async () => {
  const row = REPORT.refs.find((entry) => entry.path === "ref/papers/synced_paper.md");
  assert.equal(row.audio, true, "the shared raw JSON fixture passed through the decoder");
  await withBoard({}, ({ mount }) => {
    const { el } = mount();
    const card = cardFor(el, row.path);
    assert.equal(card.querySelectorAll(".bob-reading-board-audio").length, 1);
    assert.equal(card.querySelector(".bob-reading-board-audio").textContent, "♫");
    assert.equal(cardFor(el, "ref/papers/created_note.md").querySelector(".bob-reading-board-audio"), null);
  });
});

test("Snoozed shows Waking, date groups, and Waiting-on rows with their reasons", async () => {
  await withBoard({}, ({ mount }) => {
    const { el } = mount();
    assert.deepEqual(
      el.querySelectorAll(".bob-reading-board-group").map((node) => node.textContent),
      ["Waking", "This week", "Waiting on"],
    );
    const rows = el.querySelectorAll(".bob-reading-board-row");
    assert.equal(rows.length, 12);
    const waking = rows.filter((row) => row.getAttribute("data-group") === "waking");
    assert.equal(waking.length, 6);
    assert.equal(waking[0].querySelector(".bob-reading-board-when").textContent, "⏰ now");
    assert.match(
      waking[0].querySelector(".bob-reading-board-when").getAttribute("aria-label"),
      /No reason left — the next reconcile returns it to ⭐ Next/,
    );
    const week = rows.filter((row) => row.getAttribute("data-group") === "this_week");
    assert.deepEqual(
      week.map((row) => row.querySelector(".bob-reading-board-when").textContent),
      ["Fri", "Fri"],
    );
    assert.match(
      week[0].querySelector(".bob-reading-board-when").getAttribute("aria-label"),
      /Snoozed until/,
    );
    const dependency = cardFor(el, "ref/papers/dep_open_ref.md");
    assert.match(dependency.querySelector(".bob-reading-board-reason").textContent, /^⛓ after Open Prerequisite Paper/);
    const project = cardFor(el, "ref/papers/prj_blocked.md");
    assert.match(project.querySelector(".bob-reading-board-reason").textContent, /🧱 in blocked project sase_post_blog/);
    const combo = cardFor(el, "ref/papers/combo_blocked.md");
    assert.ok(combo.querySelector(".bob-reading-board-wake"), "a schedule shows as a trailing chip");
    const hint = rows
      .find((row) => row.getAttribute("data-path") === "ref/papers/blocked_mark.md")
      .querySelector(".bob-reading-board-return");
    assert.equal(hint.textContent, "→ ⭐");
    assert.equal(
      rows.find((row) => row.getAttribute("data-path") === "ref/papers/sched_future.md").querySelector(".bob-priority-mark")
        .getAttribute("data-priority"),
      "highest",
    );
  });
});

test("TODAY pills float linked cards first, and never appear without a ready Today cache", async () => {
  const chatNext = REPORT.refs.find((row) => row.path === "ref/chat/chat_next.md");
  const prereq = REPORT.refs.find((row) => row.path === "ref/papers/prereq_open.md");
  const keys = [readingBoardTaskKey(prereq.task), readingBoardTaskKey(chatNext.task)];
  await withBoard({ todayKeys: keys }, ({ mount }) => {
    const { el } = mount();
    assert.equal(el.querySelectorAll(".bob-reading-board-today").length, 2);
    assert.deepEqual(lanePaths(el, "next"), ["ref/papers/prereq_open.md", "ref/chat/chat_next.md"]);
    assert.equal(
      cardFor(el, "ref/chat/chat_next.md").querySelector(".bob-reading-board-today").textContent,
      "TODAY",
    );
  });
  await withBoard({ todayKeys: keys, todayReady: false }, ({ mount }) => {
    const { el } = mount();
    assert.equal(el.querySelectorAll(".bob-reading-board-today").length, 0, "no ready cache, no pill");
    assert.deepEqual(lanePaths(el, "next"), ["ref/chat/chat_next.md", "ref/papers/prereq_open.md"]);
  });
});

test("the PDF button needs the nav member, macOS, and a source_pdf", async () => {
  const pdfPath = "ref/papers/arxiv_doi.md";
  const buttons = (el) =>
    el.querySelectorAll(".bob-reading-board-action-pdf").map((node) => node.parentNode.parentNode.getAttribute("data-path"));
  await withBoard({ nav: false, mac: true }, ({ mount }) => {
    assert.deepEqual(buttons(mount().el), [], "no nav api member, no PDF button");
  });
  await withBoard({ nav: true, mac: false }, ({ mount }) => {
    assert.deepEqual(buttons(mount().el), [], "off macOS, no PDF button");
  });
  await withBoard({ nav: true, mac: true }, async ({ mount, opened, pdfs }) => {
    const { el } = mount();
    assert.deepEqual(buttons(el).sort(), [pdfPath, "ref/papers/synced_paper.md"]);
    const card = cardFor(el, pdfPath);
    const event = card.querySelector(".bob-reading-board-action-pdf").fire("click");
    assert.equal(event.stopped && event.defaultPrevented, true, "a button click never reaches the card");
    assert.deepEqual(pdfs, ["lib/papers/attention-v2.pdf"]);
    assert.deepEqual(opened, []);
    // Ctrl/Cmd+Enter: the PDF when there is one, else the note in a new tab.
    const second = cardFor(el, "ref/papers/synced_paper.md");
    second.focus();
    press(el, "Enter", { metaKey: true });
    assert.deepEqual(pdfs.at(-1), "lib/papers/synced_paper.pdf");
    const plain = cardFor(el, "ref/chat/chat_ready.md");
    plain.focus();
    press(el, "Enter", { ctrlKey: true });
    assert.deepEqual(opened.at(-1), ["ref/chat/chat_ready.md", SOURCE, true]);
    assert.equal(pdfs.length, 2);
  });
  await withBoard({ nav: false, mac: false }, ({ mount, opened }) => {
    const { el } = mount();
    cardFor(el, pdfPath).focus();
    press(el, "Enter", { ctrlKey: true });
    assert.deepEqual(opened.at(-1), [pdfPath, SOURCE, true], "no hand-off: new tab fallback");
  });
});

test("click, modifier-click, middle-click, and the Task button route to openLinkText", async () => {
  await withBoard({ nav: true, mac: true }, ({ mount, opened, hovers }) => {
    const { el } = mount();
    const card = cardFor(el, "ref/chat/chat_next.md");
    card.fire("click");
    card.fire("click", { ctrlKey: true });
    card.fire("click", { metaKey: true });
    const middle = card.fire("auxclick", { button: 1 });
    card.fire("auxclick", { button: 2 });
    assert.deepEqual(opened, [
      ["ref/chat/chat_next.md", SOURCE, false],
      ["ref/chat/chat_next.md", SOURCE, true],
      ["ref/chat/chat_next.md", SOURCE, true],
      ["ref/chat/chat_next.md", SOURCE, true],
    ]);
    assert.equal(middle.defaultPrevented, true);
    assert.equal(card.fire("mousedown", { button: 1 }).defaultPrevented, true, "no autoscroll");
    opened.length = 0;
    const task = card.querySelector(".bob-reading-board-action-task");
    task.fire("click");
    assert.deepEqual(opened, [["ref/chat/chat_next#^ref", SOURCE, false]]);
    // A reference without a task link has no Task button, and Alt+Enter opens the note.
    const noTask = cardFor(el, "ref/papers/two_trackers.md");
    assert.equal(noTask.querySelector(".bob-reading-board-action-task"), null);
    noTask.focus();
    opened.length = 0;
    press(el, "Enter", { altKey: true });
    assert.deepEqual(opened, [["ref/papers/two_trackers.md", SOURCE, false]]);
    const title = card.querySelector(".bob-reading-board-title");
    title.fire("mouseover");
    assert.equal(hovers.length, 1);
    assert.equal(hovers[0].linktext, "ref/chat/chat_next.md");
    assert.equal(hovers[0].sourcePath, SOURCE);
    assert.equal(hovers[0].source, "bob-reading-board");
    const menu = card.fire("contextmenu");
    assert.equal(menu.defaultPrevented, false, "without a file or Menu the native menu stays");
  });
});

test("the board is one Tab stop and every key moves or acts", async () => {
  await withBoard({ nav: false }, async ({ mount, opened, plugin }) => {
    const { el } = mount();
    const stops = () => all(el, (node) => node.getAttribute("tabindex") === "0");
    assert.equal(stops().length, 1);
    assert.equal(stops()[0].getAttribute("data-path"), "ref/papers/two_trackers.md");
    assert.equal(stops()[0].getAttribute("data-lane"), "reading");
    const lane = () => el.ownerDocument.activeElement.getAttribute("data-lane");
    const at = () => el.ownerDocument.activeElement.getAttribute("data-path");
    stops()[0].focus();
    press(el, "ArrowRight");
    assert.equal(lane(), "next");
    assert.equal(stops().length, 1, "roving: still one Tab stop");
    assert.equal(stops()[0], el.ownerDocument.activeElement);
    const nextFirst = at();
    press(el, "j");
    assert.notEqual(at(), nextFirst);
    press(el, "ArrowUp");
    assert.equal(at(), nextFirst);
    press(el, "k");
    assert.equal(at(), nextFirst, "no wrap past the top");
    press(el, "End");
    const nextLast = at();
    assert.equal(nextLast, lanePaths(el, "next").at(-1));
    press(el, "Home");
    assert.equal(at(), nextFirst);
    press(el, "l");
    assert.equal(lane(), "ready");
    press(el, "h");
    assert.equal(lane(), "next");
    press(el, "ArrowLeft");
    assert.equal(lane(), "reading");
    press(el, "ArrowLeft");
    assert.equal(lane(), "reading", "no wrap past the first lane");
    const ignored = press(el, "ArrowRight", { shiftKey: true });
    assert.equal(ignored.defaultPrevented, false);
    assert.equal(lane(), "reading", "shift-modified arrows are left alone");
    press(el, "ArrowRight");
    press(el, "Enter");
    assert.deepEqual(opened.at(-1), [nextFirst, SOURCE, false]);
    press(el, "Enter", { altKey: true });
    assert.match(opened.at(-1)[0], /#\^/);
    // `r` refreshes, `c` collapses, buttons keep their native keys.
    let refreshed = 0;
    plugin.apiReadingBoardRefresh = async () => {
      refreshed += 1;
      return { report: REPORT, stale: false, error: null };
    };
    const refresh = press(el, "r");
    assert.equal(refresh.defaultPrevented, true);
    await settle();
    assert.equal(refreshed, 1);
    const root = el.querySelector(".bob-reading-board");
    const onButton = root.fire("keydown", {
      key: "r",
      target: el.querySelector(".bob-reading-board-refresh"),
    });
    assert.equal(onButton.defaultPrevented, false);
    await settle();
    assert.equal(refreshed, 1);
  });
});

test("movement targets stay inside the lanes that show cards", () => {
  const node = (name) => ({ name });
  const lanes = [
    { id: "reading", nodes: [node("r1")] },
    { id: "ready", nodes: [node("a1"), node("a2"), node("a3")] },
  ];
  assert.equal(readingBoardMoveTarget(lanes, "ready", 1, "ArrowDown").name, "a3");
  assert.equal(readingBoardMoveTarget(lanes, "ready", 2, "ArrowDown"), null);
  assert.equal(readingBoardMoveTarget(lanes, "ready", 2, "ArrowLeft").name, "r1", "clamps into a shorter lane");
  assert.equal(readingBoardMoveTarget(lanes, "reading", 0, "l").name, "a1");
  assert.equal(readingBoardMoveTarget(lanes, "ready", 1, "End").name, "a3");
  assert.equal(readingBoardMoveTarget(lanes, "ready", 1, "Home").name, "a1");
  assert.equal(readingBoardMoveTarget(lanes, "ready", 1, "x"), null);
  assert.equal(readingBoardLinkTarget("[[sase#^ref-x|Read]]"), "sase#^ref-x");
  assert.equal(readingBoardLinkTarget(null), "");
  assert.equal(readingBoardHeaderTime("2026-10-06T12:34:56"), "12:34");
  assert.equal(readingBoardHeaderTime(null), "");
});

test("hovering a Waiting-on row outlines its prerequisite card on the board", async () => {
  await withBoard({}, ({ mount }) => {
    const { el } = mount();
    const row = el.querySelectorAll(".bob-reading-board-row").find(
      (node) => node.getAttribute("data-path") === "ref/papers/dep_open_ref.md",
    );
    const prerequisite = cardFor(el, "ref/papers/prereq_open.md");
    assert.ok(prerequisite && prerequisite.getAttribute("data-lane") === "next");
    assert.ok(!(prerequisite.getAttribute("class") || "").includes("bob-reading-board-prerequisite"));
    row.fire("mouseenter");
    assert.ok(prerequisite.getAttribute("class").includes("bob-reading-board-prerequisite"));
    row.fire("mouseleave");
    assert.ok(!prerequisite.getAttribute("class").includes("bob-reading-board-prerequisite"));
    row.fire("focus");
    assert.ok(prerequisite.getAttribute("class").includes("bob-reading-board-prerequisite"));
    row.fire("blur");
    assert.ok(!prerequisite.getAttribute("class").includes("bob-reading-board-prerequisite"));
  });
});

test("the board never calls a vault write API, in the source or in any gesture", async () => {
  for (const file of [
    "243-plugin-reading-board-render.js",
    "244-plugin-reading-board-block.js",
  ]) {
    const source = fs.readFileSync(path.join(pluginRoot, "src", file), "utf8");
    assert.doesNotMatch(
      source,
      /vault\.(modify|process|create|delete|rename|append|trash)\b|adapter\.(write|append|remove|rename|mkdir)\b/,
      `${file} must not write the vault`,
    );
  }
  await withBoard({ nav: true, mac: true }, async ({ mount, writes, plugin }) => {
    const { el, view } = mount();
    plugin.apiReadingBoardRefresh = async () => ({ report: REPORT, stale: false, error: null });
    for (const card of el.querySelectorAll(".bob-reading-board-card")) {
      card.fire("click");
      card.fire("auxclick", { button: 1 });
      card.fire("contextmenu");
      card.fire("mouseover");
    }
    for (const button of all(el, (node) => node.tag === "button")) {
      button.fire("click");
    }
    el.querySelector(".bob-reading-board-card").focus();
    for (const key of ["ArrowRight", "j", "Enter", "End", "c", "c", "r"]) {
      press(el, key);
    }
    await settle();
    plugin.repaintReadingBoardBlocks();
    plugin.teardownReadingBoardBlock();
    assert.deepEqual(writes, []);
    assert.ok(view);
  });
});

test("a repaint keeps focus by note path and each lane's scroll position", async () => {
  await withBoard({}, ({ mount, plugin, cacheKey }) => {
    const { el, view } = mount();
    const old = el.querySelector(".bob-reading-board");
    const target = cardFor(el, "ref/papers/created_note.md");
    target.focus();
    assert.equal(old.querySelector(".bob-reading-board-lane-ready").tag, "section");
    view.board.bodies.ready.scrollTop = 120;
    const extra = variant("ref/papers/created_note.md", (row) => ({
      path: "ref/papers/extra_note.md",
      title: "An extra note",
      task: { ...row.task, path: "ref/papers/extra_note.md" },
    }));
    plugin.readingBoardCacheSet(cacheKey(), { ...REPORT, refs: [extra, ...REPORT.refs] });
    plugin.repaintReadingBoardBlocks();
    const fresh = el.querySelector(".bob-reading-board");
    assert.notEqual(fresh, old, "changed data repaints");
    assert.equal(el.ownerDocument.activeElement.getAttribute("data-path"), "ref/papers/created_note.md");
    assert.equal(el.ownerDocument.activeElement.getAttribute("tabindex"), "0");
    assert.equal(view.board.bodies.ready.scrollTop, 120);
    assert.equal(
      el.querySelectorAll(".bob-reading-board-lane-count")[2].textContent,
      "12",
    );
  });
});

test("a task move and topic/type update repaint handlers while preserving focus and scroll", async () => {
  await withBoard({}, ({ mount, plugin, cacheKey, opened }) => {
    const { el, view } = mount();
    const oldRoot = el.querySelector(".bob-reading-board");
    const oldCard = cardFor(el, "ref/chat/chat_ready.md");
    oldCard.focus();
    view.board.bodies.ready.scrollTop = 84;

    const moved = JSON.parse(JSON.stringify(REPORT));
    const row = moved.refs.find((entry) => entry.path === "ref/chat/chat_ready.md");
    row.parent = "new_reading_topic";
    row.type = "blogs";
    row.task.path = "ref/new-reading-task.md";
    row.task.block_id = "new-ref-task";
    row.task.link = "[[ref/new-reading-task#^new-ref-task]]";
    plugin.readingBoardCacheSet(cacheKey(), moved);
    plugin.repaintReadingBoardBlocks();

    const freshRoot = el.querySelector(".bob-reading-board");
    const freshCard = cardFor(el, "ref/chat/chat_ready.md");
    assert.notEqual(freshRoot, oldRoot, "display and navigation changes require a repaint");
    assert.equal(freshCard.querySelector(".bob-reading-board-topic").textContent, "new_reading_topic");
    assert.match(freshCard.querySelector(".bob-reading-board-kind").textContent, /📰 Blog/);
    assert.equal(el.ownerDocument.activeElement.getAttribute("data-path"), "ref/chat/chat_ready.md");
    assert.equal(view.board.bodies.ready.scrollTop, 84);

    opened.length = 0;
    freshCard.querySelector(".bob-reading-board-action-task").fire("click");
    assert.deepEqual(opened, [["ref/new-reading-task#^new-ref-task", SOURCE, false]]);
    opened.length = 0;
    freshCard.focus();
    press(el, "Enter", { altKey: true });
    assert.deepEqual(opened, [["ref/new-reading-task#^new-ref-task", SOURCE, false]]);
  });
});

test("prerequisite identity changes repaint highlighting even when reason text is unchanged", async () => {
  await withBoard({}, ({ mount, plugin, cacheKey }) => {
    const { el } = mount();
    const dependentPath = "ref/papers/dep_open_ref.md";
    const originalRoot = el.querySelector(".bob-reading-board");
    const oldReason = cardFor(el, dependentPath).querySelector(".bob-reading-board-reason").textContent;

    const changed = JSON.parse(JSON.stringify(REPORT));
    const dependent = changed.refs.find((entry) => entry.path === dependentPath);
    const prerequisite = dependent.blocked_by[0].prerequisites[0];
    prerequisite.path = "ref/chat/chat_ready.md";
    prerequisite.block_id = "ref";
    prerequisite.link = "[[ref/chat/chat_ready#^ref]]";
    prerequisite.ref_path = "ref/chat/chat_ready.md";
    plugin.readingBoardCacheSet(cacheKey(), changed);
    plugin.repaintReadingBoardBlocks();

    assert.notEqual(el.querySelector(".bob-reading-board"), originalRoot);
    const row = cardFor(el, dependentPath);
    const oldPrerequisite = cardFor(el, "ref/papers/prereq_open.md");
    const newPrerequisite = cardFor(el, "ref/chat/chat_ready.md");
    assert.equal(row.querySelector(".bob-reading-board-reason").textContent, oldReason);
    row.fire("mouseenter");
    assert.ok(newPrerequisite.getAttribute("class").includes("bob-reading-board-prerequisite"));
    assert.ok(!oldPrerequisite.getAttribute("class").includes("bob-reading-board-prerequisite"));
  });
});

test("an unchanged board is not repainted; only the data time updates in place", async () => {
  await withBoard({}, ({ mount, plugin, cacheKey }) => {
    const { el, view } = mount();
    const root = el.querySelector(".bob-reading-board");
    const card = cardFor(el, "ref/papers/created_note.md");
    card.focus();
    plugin.readingBoardCacheSet(cacheKey(), { ...REPORT, generated_at: "2026-10-06T12:41:09" });
    plugin.repaintReadingBoardBlocks();
    assert.equal(el.querySelector(".bob-reading-board"), root, "same DOM node: no repaint");
    assert.equal(cardFor(el, "ref/papers/created_note.md"), card);
    assert.equal(el.querySelector(".bob-reading-board-time").textContent, "12:41");
    assert.equal(
      el.querySelector(".bob-reading-board-time").getAttribute("aria-label"),
      "Data from 2026-10-06T12:41:09",
      "the in-place time refresh updates its tooltip too",
    );
    assert.equal(el.ownerDocument.activeElement, card);
    assert.ok(view.board);
  });
});

test("a Today cache change repaints boards from cached data without spawning bob", async () => {
  const chatNext = REPORT.refs.find((row) => row.path === "ref/chat/chat_next.md");
  await withBoard({ todayReady: false }, ({ mount, plugin }) => {
    const { el } = mount();
    assert.equal(el.querySelectorAll(".bob-reading-board-today").length, 0);
    // The Today cache becoming ready (or changing) repaints mounted boards.
    let repaints = 0;
    const repaint = plugin.repaintReadingBoardBlocks.bind(plugin);
    plugin.repaintReadingBoardBlocks = () => {
      repaints += 1;
      repaint();
    };
    let readyCalls = 0;
    plugin.isTodayCacheReady = () => readyCalls++ > 0;
    plugin.rebuildTodayCache("", "daily.md", NOW);
    assert.equal(repaints, 1);
    plugin.isTodayCacheReady = () => true;
    plugin.todayCache = { rank: new Map([[readingBoardTaskKey(chatNext.task), 0]]) };
    plugin.repaintReadingBoardBlocks();
    assert.equal(el.querySelectorAll(".bob-reading-board-today").length, 1);
    assert.equal(plugin.fetchCalls.length, 0);
  });
});

test("first paint is a skeleton in the real grid, then the board without a layout jump", async () => {
  await withBoard({ cache: false }, async ({ mount, plugin }) => {
    let release = null;
    plugin.apiReadingBoardFetch = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const { el } = mount();
    const skeleton = el.querySelector(".bob-reading-board-loading");
    assert.ok(skeleton, "skeleton renders first");
    assert.equal(skeleton.getAttribute("role"), "status");
    assert.equal(skeleton.getAttribute("aria-busy"), "true");
    assert.deepEqual(
      el.querySelectorAll(".bob-reading-board-lane").map((node) => node.getAttribute("data-lane")),
      ["reading", "next", "ready", "snoozed"],
    );
    assert.deepEqual(
      el.querySelectorAll(".bob-reading-board-lane").map((lane) => lane.querySelectorAll(".bob-reading-board-ghost").length),
      [2, 3, 3, 3],
    );
    await settle();
    release({ report: REPORT, stale: false, error: null });
    await settle();
    assert.equal(el.querySelector(".bob-reading-board-loading"), null);
    assert.equal(el.querySelectorAll(".bob-reading-board-card").length, 14);
  });
});

test("failures without a frame render an actionable card with Retry", async () => {
  const cases = [
    [
      { code: "bob-not-found", message: "bob was not found at bob.", tried: ["~/.cargo/bin/bob", "bob (PATH)"] },
      [/bob was not found/, /Tried ~\/\.cargo\/bin\/bob, bob \(PATH\)/, /stats\.bob_path/],
      true,
    ],
    [{ code: "timeout", message: "timed out" }, [/bob ref list timed out/, /Retry once/], true],
    [{ code: "schema-mismatch", message: "schema 2" }, [/different schema/, /Update bob-cli and Bob Ledger Tools together/], true],
    [{ code: "usage", message: "bad filter", detail: "" }, [/bob ref list failed/, /bad filter/], true],
    [
      { code: "bob-not-found", message: "Spawning bob needs the desktop app.", tried: [] },
      [/needs the desktop app/],
      false,
    ],
  ];
  for (const [error, patterns, retry] of cases) {
    await withBoard({ cache: false }, async ({ mount, plugin }) => {
      plugin.apiReadingBoardFetch = async () => ({ report: null, stale: false, error });
      const { el } = mount();
      await settle();
      const card = el.querySelector(".bob-reading-board-error");
      assert.ok(card, "error card renders, never an empty block");
      assert.equal(card.getAttribute("role"), "alert");
      for (const pattern of patterns) {
        assert.match(card.text, pattern);
      }
      assert.equal(Boolean(card.querySelector(".bob-reading-board-link")), retry);
      if (retry) {
        plugin.apiReadingBoardRefresh = async () => ({ report: REPORT, stale: false, error: null });
        card.querySelector(".bob-reading-board-link").fire("click");
        await settle();
        assert.equal(el.querySelector(".bob-reading-board-error"), null);
        assert.equal(el.querySelectorAll(".bob-reading-board-card").length, 14, "Retry recovers the board");
      }
    });
  }
  await withBoard({ cache: false }, async ({ mount, plugin }) => {
    plugin.apiReadingBoardFetch = async () => {
      throw new Error("boom");
    };
    const { el } = mount();
    await settle();
    assert.match(el.text, /boom/, "a throwing fetch still renders text");
  });
});

test("a failed manual refresh keeps the last frame and says why with Retry", async () => {
  await withBoard({}, async ({ mount, plugin, cacheKey }) => {
    const { el } = mount();
    plugin.apiReadingBoardRefresh = async () => ({
      report: REPORT,
      stale: true,
      error: { code: "timeout", message: "bob ref list timed out after 20 s.", detail: "slow disk" },
    });
    el.querySelector(".bob-reading-board-refresh").fire("click");
    await settle();
    const lint = el.querySelector(".bob-reading-board-lint");
    assert.ok(lint, "one muted lint line");
    assert.match(lint.text, /Showing the board from 12:00 · bob ref list failed: slow disk/);
    assert.ok(lint.querySelector(".bob-reading-board-link"), "Retry is offered");
    assert.equal(el.querySelectorAll(".bob-reading-board-card").length, 14, "the last frame stays");
    assert.match(
      el.querySelector('[aria-live="polite"]').textContent,
      /refresh failed/i,
    );
    // The next good fetch clears the line.
    plugin.readingBoardCacheSet(cacheKey(), { ...REPORT, generated_at: "2026-10-06T12:50:00" });
    plugin.repaintReadingBoardBlocks();
    assert.equal(el.querySelector(".bob-reading-board-lint"), null);
  });
});

test("metadata revalidation delivers a silent stale-frame error and recovery updates freshness", async () => {
  await withBoard({ realData: true }, async ({ mount, plugin }) => {
    const { el, view } = mount();
    view.dataGeneration = 0;
    plugin.readingBoardSpawnFetch = async () => ({
      ok: false,
      code: "failed",
      message: "test background failure",
      detail: "test background failure",
    });
    plugin.readingBoardVaultChanged();
    plugin.revalidateReadingBoardBlocks();
    await settle();
    await settle();

    assert.equal(view.dataGeneration, 0, "a cached return and failed read do not advance freshness");
    assert.equal(view.refreshError.error.message, "test background failure");
    assert.equal(el.querySelectorAll(".bob-reading-board-card").length, 14, "the last good board stays visible");
    assert.match(el.querySelector(".bob-reading-board-lint").text, /Showing the board from 12:00/);
    assert.match(el.querySelector(".bob-reading-board-lint").text, /test background failure/);
    assert.equal(el.querySelector('[aria-live="polite"]').textContent, "", "automatic refresh is silent");

    plugin.readingBoardSpawnFetch = async () => ({
      ok: true,
      report: { ...REPORT, generated_at: "2026-10-06T13:45:00" },
    });
    plugin.revalidateReadingBoardBlocks();
    await settle();
    await settle();
    assert.equal(view.refreshError, null, "a later successful read clears the stale lint");
    assert.equal(view.dataGeneration, 1, "freshness records the generation fetched");
    assert.equal(el.querySelector(".bob-reading-board-time").textContent, "13:45");
  });
});

test("stale-cache mount refresh failures reach the mounted view", async () => {
  await withBoard({ realData: true }, async ({ mount, plugin, cacheKey }) => {
    plugin.readingBoardCache.get(cacheKey()).fetchedAt = 0;
    let release;
    plugin.readingBoardSpawnFetch = () => new Promise((resolve) => { release = resolve; });
    const { el, view } = mount();
    assert.equal(el.querySelectorAll(".bob-reading-board-card").length, 14, "the cached frame paints immediately");
    await settle();
    assert.equal(typeof release, "function", "the mount starts a background fetch");
    release({
      ok: false,
      code: "failed",
      message: "first line of mount failure",
      detail: "first line of mount failure\nsecond line",
    });
    await settle();
    await settle();
    assert.ok(view.refreshError);
    const lint = el.querySelector(".bob-reading-board-lint");
    assert.match(lint.text, /first line of mount failure/);
    assert.doesNotMatch(lint.text, /second line/);
    assert.equal(el.querySelectorAll(".bob-reading-board-card").length, 14);
  });
});

test("unload during a fetch prevents late repaint and queued spawns", async () => {
  await withBoard({ realData: true, cache: false }, async ({ mount, plugin, children }) => {
    let release;
    let spawns = 0;
    plugin.readingBoardSpawnFetch = () => {
      spawns += 1;
      return new Promise((resolve) => { release = resolve; });
    };
    const { el } = mount();
    await settle();
    assert.equal(spawns, 1);
    plugin.revalidateReadingBoardBlocks();
    assert.equal(plugin.readingBoardPendingFetches.size, 1, "a forced refresh waits behind the current flight");
    children[0].unload();
    plugin.teardownReadingBoardData();
    release({ ok: true, report: REPORT });
    await settle();
    await settle();
    assert.equal(spawns, 1, "teardown does not launch the queued refresh");
    assert.equal(plugin.readingBoardViewsStore().size, 0);
    assert.ok(el.querySelector(".bob-reading-board-loading"), "the unloaded skeleton remains in place");
    assert.equal(el.querySelector(".bob-reading-board-summary"), null, "the late result did not repaint the board");
  });
});

test("in-flight edits and forced refreshes coalesce without dropping mounted fences", async () => {
  await withBoard({ realData: true }, async ({ mount, plugin }) => {
    const spawned = [];
    plugin.readingBoardSpawnFetch = (args) => new Promise((resolve) => {
      spawned.push({ args, resolve });
    });
    const first = mount();
    first.view.dataGeneration = 0;
    plugin.revalidateReadingBoardBlocks();
    await settle();
    assert.equal(spawned.length, 1, "the default fence starts one read");

    const second = mount("parent: sase");
    await settle();
    assert.equal(spawned.length, 1, "a second fence waits behind the active spawn");

    plugin.readingBoardVaultChanged();
    plugin.revalidateReadingBoardBlocks();
    plugin.readingBoardVaultChanged();
    plugin.revalidateReadingBoardBlocks();
    const manual = plugin.apiReadingBoardRefresh(first.view.fence);
    assert.equal(plugin.readingBoardVaultGeneration, 2);
    assert.equal(plugin.readingBoardPendingFetches.size, 2, "the two fence keys retain their refresh demand");

    spawned[0].resolve({ ok: true, report: { ...REPORT, generated_at: "2026-10-06T12:10:00" } });
    await settle();
    await settle();
    assert.equal(first.view.dataGeneration, 0, "the pre-edit snapshot is not treated as current");
    assert.equal(spawned.length, 2, "only one queued fence starts after the first flight");
    assert.ok(spawned[1].args.includes("-P"), "the parent fence was not discarded");

    spawned[1].resolve({ ok: true, report: { ...REPORT, generated_at: "2026-10-06T12:20:00" } });
    await settle();
    await settle();
    assert.equal(second.view.dataGeneration, 2, "the parent fence fetch starts after both edits");
    assert.equal(spawned.length, 3, "repeated default-fence edits coalesce into one follow-up");
    assert.ok(!spawned[2].args.includes("-P"), "the default fence's demand remains queued too");

    spawned[2].resolve({ ok: true, report: { ...REPORT, generated_at: "2026-10-06T12:30:00" } });
    await manual;
    await settle();
    assert.equal(first.view.dataGeneration, 2, "the follow-up report covers the latest invalidation");
    assert.equal(spawned.length, 3);
  });
});

test("manual refresh shows a busy state until the result lands, then announces it", async () => {
  await withBoard({}, async ({ mount, plugin }) => {
    const { el } = mount();
    let finish = null;
    let calls = 0;
    plugin.apiReadingBoardRefresh = () => {
      calls += 1;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const button = el.querySelector(".bob-reading-board-refresh");
    button.fire("click");
    assert.ok(el.querySelector(".bob-reading-board").getAttribute("class").includes("bob-reading-board-busy"));
    assert.equal(button.getAttribute("aria-busy"), "true");
    button.fire("click");
    await settle();
    assert.equal(calls, 1, "a second click while busy is ignored");
    finish({ report: REPORT, stale: false, error: null });
    await settle();
    const root = el.querySelector(".bob-reading-board");
    assert.ok(!root.getAttribute("class").includes("bob-reading-board-busy"));
    assert.equal(root.getAttribute("aria-busy"), null);
    assert.equal(
      el.querySelector('[aria-live="polite"]').textContent,
      "Reading Board refreshed: 14 awake, 12 snoozed.",
    );
  });
});

test("an older bob without blocked_by falls back to Waiting-on with one lint line", async () => {
  const raw = JSON.parse(JSON.stringify(fixtureDocument));
  for (const row of raw.refs) {
    delete row.blocked_by;
  }
  const decodedOlder = readingBoardDecodeReport(JSON.stringify(raw), "");
  assert.equal(decodedOlder.ok, true);
  await withBoard({ report: decodedOlder.report }, ({ mount }) => {
    const { el } = mount();
    assert.deepEqual(
      el.querySelectorAll(".bob-reading-board-group").map((node) => node.textContent),
      ["Waiting on"],
    );
    const lints = el.querySelectorAll(".bob-reading-board-lint");
    assert.equal(lints.length, 1);
    assert.match(lints[0].text, /Update bob-cli to see why references are snoozed/);
    for (const reason of el.querySelectorAll(".bob-reading-board-reason")) {
      assert.match(reason.textContent, /⏸ blocked/);
    }
  });
});

test("an empty queue shows bob's own phrase instead of lanes", async () => {
  await withBoard({ report: { ...REPORT, refs: [] } }, ({ mount }) => {
    const { el } = mount();
    assert.equal(el.querySelector(".bob-reading-board-empty-board").textContent, "Nothing queued ✓");
    assert.equal(el.querySelectorAll(".bob-reading-board-lane").length, 0);
    assert.equal(el.querySelector(".bob-reading-board").getAttribute("tabindex"), "0", "an empty board is still a Tab stop");
  });
  await withBoard(
    { report: { ...REPORT, refs: REPORT.refs.filter((row) => row.status === "wip") } },
    ({ mount }) => {
      const { el } = mount();
      assert.deepEqual(
        el.querySelectorAll(".bob-reading-board-empty").map((node) => node.textContent),
        ["Nothing next", "Nothing ready", "Nothing snoozed"],
      );
    },
  );
});

test("fence options reach the fetch and bad options show as muted lint lines", async () => {
  await withBoard({ cache: false }, async ({ mount, plugin }) => {
    plugin.apiReadingBoardFetch = async (fence) => {
      plugin.fetchCalls.push(fence);
      return { report: REPORT, stale: false, error: null };
    };
    const { el } = mount("parent: sase\ntype: [ai, papers]\nbogus: 1\n");
    await settle();
    assert.deepEqual(plugin.fetchCalls, [{ parent: "sase", type: ["ai", "papers"] }]);
    const lints = el.querySelectorAll(".bob-reading-board-lint");
    assert.equal(lints.length, 1);
    assert.match(lints[0].text, /Unknown Reading Board option: bogus/);
    assert.equal(el.querySelectorAll(".bob-reading-board-card").length, 14, "bad options are never fatal");
  });
});

test("Snoozed collapses per source path, leaves the key order, and survives repaints", async () => {
  await withBoard({}, ({ mount, plugin }) => {
    const { el } = mount();
    const toggle = el.querySelector(".bob-reading-board-collapse");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(toggle.textContent, "▾");
    toggle.fire("click");
    const lane = el.querySelector(".bob-reading-board-lane-snoozed");
    assert.ok(lane.getAttribute("class").includes("bob-reading-board-lane-collapsed"));
    assert.equal(lane.querySelectorAll(".bob-reading-board-row").length, 0);
    assert.equal(el.querySelector(".bob-reading-board-collapse").getAttribute("aria-expanded"), "false");
    assert.equal(el.querySelector(".bob-reading-board-collapse").textContent, "▸");
    assert.equal(lane.querySelector(".bob-reading-board-lane-count").textContent, "12");
    plugin.repaintReadingBoardBlocks();
    assert.ok(el.querySelector(".bob-reading-board-lane-snoozed").getAttribute("class").includes("collapsed"));
    // Keyboard order skips the hidden lane.
    cardFor(el, "ref/papers/created_note.md").focus();
    press(el, "ArrowRight");
    assert.equal(el.ownerDocument.activeElement.getAttribute("data-lane"), "ready");
    // Session state is per source path.
    const other = mount("", "other.md").el;
    assert.equal(other.querySelectorAll(".bob-reading-board-row").length, 12);
    // The key opens it again.
    press(el, "c");
    assert.equal(el.querySelectorAll(".bob-reading-board-row").length, 12);
  });
});

test("unloading a block releases its view, and teardown clears the session state", async () => {
  await withBoard({}, ({ mount, plugin, children }) => {
    const { el } = mount();
    assert.equal(plugin.readingBoardViewsStore().size, 1);
    assert.equal(children.length, 1);
    plugin.readingBoardViewStateFor(SOURCE).snoozedCollapsed = true;
    children[0].unload();
    assert.equal(plugin.readingBoardViewsStore().size, 0);
    assert.equal(plugin.readingBoardPaintGens().has(el), false);
    plugin.repaintReadingBoardBlocks();
    plugin.teardownReadingBoardBlock();
    assert.equal(plugin.readingBoardViewStateFor(SOURCE).snoozedCollapsed, false);
  });
});

test("reading board stylesheet contract: selectors, layout, tabular-nums, motion, colors", () => {
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  const marker = "Reading Board block (bob-cli-99.3)";
  assert.ok(css.includes(marker), "reading board section exists");
  const section = css.slice(css.indexOf(marker));
  for (const selector of [
    ".bob-reading-board",
    ".bob-reading-board-lanes",
    ".bob-reading-board-lane-snoozed",
    ".bob-reading-board-card",
    ".bob-reading-board-row",
    ".bob-reading-board-group",
    ".bob-reading-board-today",
    ".bob-reading-board-error",
    ".bob-reading-board-ghost",
    ".bob-reading-board-prerequisite",
    ".bob-reading-board-actions",
    ".bob-reading-board-sr",
  ]) {
    assert.ok(section.includes(selector), `selector ${selector} exists`);
  }
  assert.ok(section.includes("container-type: inline-size"), "layout follows the container, not the window");
  assert.ok(section.includes("@container bob-reading-board (min-width: 34rem)"), "2 x 2 at readable width");
  assert.ok(section.includes("@container bob-reading-board (min-width: 56rem)"), "four columns when wide");
  assert.ok(section.includes("repeat(4, minmax(0, 1fr))"));
  assert.ok(section.includes("tabular-nums"), "counts and dates use tabular-nums");
  assert.ok(section.includes("prefers-reduced-motion"), "reduced motion respected");
  assert.ok(section.includes("forced-colors: active"), "forced colors handled");
  assert.ok(section.includes("CanvasText") && section.includes("Highlight"), "forced colors use system colors");
  assert.ok(section.includes("(hover: none)"), "touch keeps the actions visible");
  assert.ok(section.includes("--task-status-in-progress") && section.includes("--task-status-next"));
  assert.ok(section.includes("1px dashed var(--background-modifier-border)"), "Snoozed is a dashed lane");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(section), "theme and vault variables only: no hex in this section");
  assert.ok(!/--task-status-blocked/.test(section), "Snoozed is muted, never the alarm color");
});
