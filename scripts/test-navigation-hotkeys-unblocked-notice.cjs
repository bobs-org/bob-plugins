// Unblocked successor notice card (plan:202610/successor_links.md §12.6,
// `nav_card`): `buildUnblockedNoticeModel` validation, the `is-unblock`
// card anatomy (header, rows, chips, breaker and failure variants), the
// click handler, the plan-chip absence, and the additive `api.notice` v1
// shape. Fragment nodes stub `document` the way
// `test-navigation-hotkeys-priority-notice.cjs:407` does.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const {
  notices,
  helpers,
  createFragmentNode,
  findFragmentNode,
  collectFragmentNodes,
  nodeHasClass,
} = require("./navigation-hotkeys-harness.cjs");

function linkedRow(overrides = {}) {
  return {
    note_path: "sase.md",
    block_id: "relaunch-failed-agents",
    line: 82,
    text: "Re-launch all failed agents on apollo!",
    previous_status_symbol: "?",
    previous_status_name: "Blocked",
    status_symbol: "*",
    status_name: "Next",
    inbox: false,
    unblocked_by: [
      { note_path: "sase.md", block_id: "fix-apollo", text: "Fix apollo machine!" },
    ],
    link: {
      day_file: "2026/20261009.md",
      entry_name: "FIX",
      entry_line: 37,
      entry_created: false,
      next_up: false,
      line: 40,
      block_link: "[[sase#^relaunch-failed-agents]]",
      block_id_created: true,
    },
    not_linked: null,
    ...overrides,
  };
}

function singleLinkedModel(overrides = {}) {
  return {
    version: 1,
    predecessors: [
      { note_path: "sase.md", block_id: "fix-apollo", text: "Fix apollo machine!" },
    ],
    unblocked: [linkedRow()],
    still_blocked: [],
    daily_path: "2026/20261009.md",
    daily_content: null,
    failure: null,
    ...overrides,
  };
}

function planBudgetApp() {
  return {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: {
            planBudget: () => ({
              status: "ok",
              themes: { count: 3, cap: 3, over: false },
              links: { count: 10, cap: 10, over: false },
            }),
          },
        },
      },
    },
    workspace: {},
  };
}

function withDocumentFragment(testBody) {
  const previousDocument = global.document;
  global.document = {
    createDocumentFragment: () => createFragmentNode(),
  };
  try {
    testBody();
  } finally {
    if (previousDocument === undefined) {
      delete global.document;
    } else {
      global.document = previousDocument;
    }
  }
}

test("unblocked model returns null when there is nothing to show", () => {
  assert.equal(helpers.buildUnblockedNoticeModel(null, {}), null);
  assert.equal(helpers.buildUnblockedNoticeModel({}, {}), null);
  assert.equal(
    helpers.buildUnblockedNoticeModel(
      singleLinkedModel({ unblocked: [] }),
      {},
    ),
    null,
  );
  assert.equal(
    helpers.showUnblockedNotice({}, singleLinkedModel({ unblocked: [] })),
    false,
  );
});

test("unblocked card renders a single linked row with receipt and chips", () => {
  const view = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({ daily_content: "## Pomodoros\n- [ ] () — FIX\n" }),
    {
      app: planBudgetApp(),
    },
  );
  assert.ok(view);
  assert.equal(view.countPill, "1 → FIX");
  assert.equal(view.receipt, "✓ Fix apollo machine!");
  assert.equal(view.text, "🔓 Next in FIX: Re-launch all failed agents on apollo!");
  assert.equal(view.durationMs, 6000);

  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, { app: planBudgetApp() });
  const card = findFragmentNode(root, nodeHasClass("bob-nh-notice"));
  assert.ok(card);
  assert.ok(card.classes.includes("is-unblock"));
  assert.equal(card.attrs["aria-label"], view.text);
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-level")).text,
    "Unblocked",
  );
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-count")).text,
    "1 → FIX",
  );
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-receipt")).text,
    "✓ Fix apollo machine!",
  );
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-unblock-text")).text,
    "Re-launch all failed agents on apollo!",
  );
  const chips = collectFragmentNodes(
    root,
    nodeHasClass("bob-nh-notice-chip"),
  ).map((node) => node.text);
  assert.ok(chips.includes("Next"));
  assert.ok(chips.includes("plan 3/3 · 10/10"));
  assert.ok(chips.includes("added ^relaunch-failed-agents"));
  assert.ok(chips.includes("Alt+N releases"));
});

test("unblocked card renders several linked rows with one entry", () => {
  const second = linkedRow({
    block_id: "fix-muse-reply",
    text: "Fix the Muse reply path",
    link: {
      day_file: "2026/20261009.md",
      entry_name: "FIX",
      entry_line: 37,
      entry_created: false,
      next_up: false,
      line: 41,
      block_link: "[[sase#^fix-muse-reply]]",
      block_id_created: false,
    },
  });
  const view = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({ unblocked: [linkedRow(), second] }),
    {},
  );
  assert.equal(view.countPill, "2 → FIX");
  assert.match(view.text, /^🔓 2 linked → FIX: /);
});

test("unblocked card renders a created continuation with next up", () => {
  const created = linkedRow({
    link: {
      day_file: "2026/20261009.md",
      entry_name: "BOB",
      entry_line: 12,
      entry_created: true,
      next_up: true,
      line: 13,
      block_link: "[[sase#^relaunch-failed-agents]]",
      block_id_created: true,
    },
  });
  const view = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({ unblocked: [created] }),
    {},
  );
  assert.equal(view.countPill, "1 → new BOB session · next up");
  assert.equal(
    view.text,
    "🔓 Next in new BOB session (next up): Re-launch all failed agents on apollo!",
  );
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, {});
  const chips = collectFragmentNodes(
    root,
    nodeHasClass("bob-nh-notice-chip"),
  ).map((node) => node.text);
  assert.ok(chips.some((chip) => chip.includes("→ new BOB")));
});

test("unblocked card renders recovered-only and still-blocked rows", () => {
  const recovered = linkedRow({
    block_id: "book-flights",
    note_path: "travel.md",
    text: "Book flights",
    status_symbol: " ",
    status_name: "Ready",
    link: null,
    not_linked: "not_planned_today",
  });
  const view = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({
      unblocked: [recovered],
      predecessors: [
        { note_path: "travel.md", block_id: "plan-trip", text: "Plan trip" },
      ],
    }),
    {},
  );
  assert.equal(view.text, "🔓 Unblocked: Book flights (Ready)");
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, {});
  const chips = collectFragmentNodes(
    root,
    nodeHasClass("bob-nh-notice-chip"),
  ).map((node) => node.text);
  assert.ok(chips.includes("Ready"));
  assert.ok(chips.includes("not planned today"));

  const blockedView = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({
      unblocked: [
        linkedRow({ link: null, not_linked: "already_planned" }),
      ],
      still_blocked: [
        {
          note_path: "sase_agents_repo.md",
          block_id: "badges",
          line: 21,
          text: "Start adding sase badges",
          status_symbol: "?",
          reason: "scheduled",
          waits_on: 0,
          scheduled: "2026-10-13",
        },
        {
          note_path: "sase.md",
          block_id: "other",
          line: 9,
          text: "Another dependent",
          status_symbol: "?",
          reason: "waits_on",
          waits_on: 2,
          scheduled: null,
        },
      ],
    }),
    {},
  );
  const blockedRoot = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(blockedView, blockedRoot, {});
  const suffixes = collectFragmentNodes(
    blockedRoot,
    nodeHasClass("bob-nh-unblock-suffix"),
  ).map((node) => node.text);
  assert.ok(suffixes.includes("· waits until Oct 13"));
  assert.ok(suffixes.includes("· waits on 2 more"));
});

test("unblocked card caps visible rows with +N more", () => {
  const rows = [
    linkedRow(),
    linkedRow({ block_id: "second", text: "Second task" }),
    linkedRow({ link: null, not_linked: "hidden", text: "Hidden task" }),
    linkedRow({ link: null, not_linked: "disabled", text: "Disabled task" }),
  ];
  const view = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({
      unblocked: rows,
      still_blocked: [
        {
          note_path: "sase.md",
          block_id: "late",
          line: 3,
          text: "Late task",
          status_symbol: "?",
          reason: "waits_on",
          waits_on: 1,
          scheduled: null,
        },
      ],
    }),
    {},
  );
  assert.equal(view.visibleRows.length, 3);
  assert.equal(view.moreCount, 2);
  assert.equal(view.durationMs, 8000);
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, {});
  assert.equal(
    findFragmentNode(root, nodeHasClass("bob-nh-unblock-more")).text,
    "+2 more",
  );
});

test("unblocked card renders the breaker variant", () => {
  const rows = Array.from({ length: 7 }, (_, index) =>
    linkedRow({
      block_id: `task-${index + 1}`,
      text: `Dependent ${index + 1}`,
      link: null,
      not_linked: "breaker",
    }),
  );
  const view = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({ unblocked: rows }),
    {},
  );
  assert.equal(view.isBreaker, true);
  assert.equal(view.countPill, "7 · not linked");
  assert.equal(view.text, "🔓 7 unblocked · not linked (more than 5)");
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, {});
  assert.match(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-reason-text")).text,
    /More than 5 at once/,
  );
});

test("unblocked card renders the failure variant", () => {
  const view = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({ failure: { count: 1, reason: "daily note changed" } }),
    {},
  );
  assert.ok(view);
  assert.equal(
    view.text,
    "⚠ Closed Fix apollo machine! — couldn't link 1 successor (daily note changed)",
  );
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, {});
  assert.match(
    findFragmentNode(root, nodeHasClass("bob-nh-notice-reason-text")).text,
    /Couldn't link 1 successor/,
  );
});

function clickableStubNode() {
  const listeners = {};
  const node = {
    children: [],
    classes: [],
    attrs: {},
    text: "",
    classList: {
      add: (...classes) => {
        for (const cls of String(classes.join(" ") || "").split(/\s+/)) {
          if (cls && !node.classes.includes(cls)) {
            node.classes.push(cls);
          }
        }
      },
    },
    createDiv(spec = {}) {
      return clickableStubChild(node, spec);
    },
    createSpan(spec = {}) {
      return clickableStubChild(node, spec);
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    fireClick(event) {
      return listeners.click(event);
    },
  };
  return node;
}

function clickableStubChild(parent, spec = {}) {
  const child = clickableStubNode();
  if (spec.cls) {
    child.classList.add(spec.cls);
  }
  if (spec.attr) {
    for (const [name, value] of Object.entries(spec.attr)) {
      child.attrs[name] = String(value);
    }
  }
  if (spec.text !== undefined) {
    child.text = String(spec.text);
  }
  parent.children.push(child);
  return child;
}

function findStubNode(node, predicate) {
  if (predicate(node)) {
    return node;
  }
  for (const child of node.children || []) {
    const match = findStubNode(child, predicate);
    if (match) {
      return match;
    }
  }
  return null;
}

test("unblocked rows open their task without dismissing the notice", () => {
  const calls = [];
  const app = {
    workspace: {
      openLinkText: (linkText, sourcePath) => {
        calls.push([linkText, sourcePath]);
      },
    },
  };
  const view = helpers.buildUnblockedNoticeModel(singleLinkedModel(), { app });
  const root = clickableStubNode();
  helpers.renderUnblockedNoticeFragment(view, root, { app });
  const row = findStubNode(
    root,
    (node) => (node.classes || []).includes("bob-nh-unblock-row"),
  );
  assert.ok(row);
  assert.equal(typeof row.unblockedClick, "function");
  let stopped = false;
  row.fireClick({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.deepEqual(calls, [["sase.md#^relaunch-failed-agents", "2026/20261009.md"]]);
});

test("unblocked row without a block id opens the note path", () => {
  const calls = [];
  const app = {
    workspace: {
      openLinkText: (linkText, sourcePath) => {
        calls.push([linkText, sourcePath]);
      },
    },
  };
  const row = linkedRow({ block_id: "", link: null, not_linked: "hidden" });
  const view = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({ unblocked: [row] }),
    { app },
  );
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, { app });
  const rendered = findFragmentNode(root, (node) =>
    (node.classes || []).includes("bob-nh-unblock-row"),
  );
  rendered.unblockedClick({ stopPropagation: () => {} });
  assert.deepEqual(calls, [["sase.md", "2026/20261009.md"]]);
});

test("unblocked card omits the plan chip when daily content is null", () => {
  const view = helpers.buildUnblockedNoticeModel(singleLinkedModel(), {
    app: planBudgetApp(),
  });
  assert.ok(view);
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, { app: planBudgetApp() });
  const chips = collectFragmentNodes(
    root,
    nodeHasClass("bob-nh-notice-chip"),
  ).map((node) => node.text);
  assert.ok(!chips.some((chip) => chip.startsWith("plan ")));
  assert.ok(chips.includes("added ^relaunch-failed-agents"));
});

test("unblocked notice shows one card with duration through showNotice", () => {
  const seen = [];
  withDocumentFragment(() => {
    const shown = helpers.showUnblockedNotice(
      planBudgetApp(),
      singleLinkedModel(),
      { showNotice: (message, duration) => seen.push([message, duration]) },
    );
    assert.equal(shown, true);
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][1], 6000);
  const card = findFragmentNode(seen[0][0], nodeHasClass("is-unblock"));
  assert.ok(card);
});

test("unblocked notice falls back to plain text without a DOM", () => {
  notices.length = 0;
  const previousDocument = global.document;
  if (previousDocument !== undefined) {
    delete global.document;
  }
  try {
    const shown = helpers.showUnblockedNotice({}, singleLinkedModel());
    assert.equal(shown, true);
  } finally {
    if (previousDocument !== undefined) {
      global.document = previousDocument;
    }
  }
  assert.deepEqual(notices, [
    "🔓 Next in FIX: Re-launch all failed agents on apollo!",
  ]);
});

test("unblocked text truncates to 48 characters with an ellipsis", () => {
  const long = `x${"y".repeat(60)}`;
  assert.equal(helpers.truncateUnblockedText(long).length, 48);
  assert.match(helpers.truncateUnblockedText(long), /…$/);
  assert.equal(helpers.formatUnblockedScheduledDate("2026-10-13"), "Oct 13");
  assert.equal(helpers.formatUnblockedScheduledDate("not-a-date"), "not-a-date");
});

test("nav api exposes additive notice v1 and keeps version 3", () => {
  const api = helpers.createDependencyNavApi({ app: {} });
  assert.equal(api.version, 3);
  assert.ok(api.notice);
  assert.equal(api.notice.version, 1);
  assert.equal(typeof api.notice.showUnblocked, "function");
  assert.equal(Object.isFrozen(api.notice), true);
  assert.equal(api.notice.showUnblocked({ unblocked: [], failure: null }), false);
});

test("unblocked stylesheet scopes notice overrides and uses task tokens", () => {
  const stylesPath = path.join(
    __dirname,
    "../plugins/bob-navigation-hotkeys/styles.css",
  );
  const styles = fs.readFileSync(stylesPath, "utf8");
  const marker = ".bob-nh-notice.is-unblock";
  const start = styles.indexOf(marker);
  assert.notEqual(start, -1);
  const block = styles.slice(start, styles.indexOf("/* Vault-wide Depends", start));
  assert.match(block, /--task-status-next/);
  assert.doesNotMatch(block, /#[0-9a-f]{6}\b/i);
  assert.doesNotMatch(block, /\brgb\(/i);
  assert.doesNotMatch(block, /\bhsl\(/i);
  assert.match(block, /\.bob-nh-unblock-row/);
});
