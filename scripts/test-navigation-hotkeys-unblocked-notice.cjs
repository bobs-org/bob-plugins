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

test("current offer summaries report pulled-in, unselected, mixed destinations, and new reasons", () => {
  const picked = linkedRow({
    text: "Ship the project task",
    link: { ...linkedRow().link, entry_name: "JOB" },
  });
  const unselectedA = linkedRow({
    block_id: "unpicked-a",
    text: "Unpicked A",
    link: null,
    not_linked: "not_selected",
  });
  const unselectedB = linkedRow({
    block_id: "unpicked-b",
    text: "Unpicked B",
    link: null,
    not_linked: "not_selected",
  });
  const mixed = helpers.buildUnblockedNoticeModel(singleLinkedModel({
    unblocked: [picked, unselectedA, unselectedB],
    pull_in: { supported: true, offer_count: 3, choice: "subset", picked_count: 1 },
  }), {});
  assert.equal(mixed.countPill, "1 pulled in · 2 not pulled in → JOB");
  assert.equal(mixed.text, "🔓 1 pulled in · 2 not pulled in → JOB");
  assert.equal(mixed.pullIn.offerCount, 3);
  assert.equal(mixed.pullIn.pulledIn, 1);
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(mixed, root, {});
  const chips = collectFragmentNodes(root, nodeHasClass("bob-nh-notice-chip")).map((node) => node.text);
  assert.ok(chips.includes("not pulled in"));
  assert.match(findFragmentNode(root, nodeHasClass("bob-nh-notice-count")).text, /→ JOB/);

  const none = helpers.buildUnblockedNoticeModel(singleLinkedModel({
    unblocked: [unselectedA, unselectedB],
    pull_in: { supported: true, offer_count: 2, choice: "none", picked_count: 0 },
  }), {});
  assert.equal(none.countPill, "0 pulled in · 2 not pulled in");
  assert.equal(none.text, "🔓 0 pulled in · 2 not pulled in");

  const noDestination = helpers.buildUnblockedNoticeModel(singleLinkedModel({
    unblocked: [linkedRow({ link: null, not_linked: "no_destination" })],
  }), {});
  assert.match(noDestination.text, /no open Pomodoro/);
  const noDestinationRoot = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(noDestination, noDestinationRoot, {});
  assert.ok(collectFragmentNodes(noDestinationRoot, nodeHasClass("bob-nh-notice-chip"))
    .some((node) => node.text === "no open Pomodoro"));
});

test("project pull-in rows label empty projects and preserve project blocking reasons", () => {
  const linked = linkedRow({
    text: "Ship the outcome!",
    trigger: "project_empty",
    hide_removed: true,
  });
  const linkedView = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({ unblocked: [linked] }),
    {},
  );
  assert.equal(linkedView.title, "Project empty");
  assert.equal(
    linkedView.text,
    "🔓 Next in FIX: Ship the outcome! · project has no open tasks",
  );
  const linkedRoot = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(linkedView, linkedRoot, {});
  assert.equal(
    findFragmentNode(linkedRoot, nodeHasClass("bob-nh-notice-level")).text,
    "Project empty",
  );
  const linkedChips = collectFragmentNodes(
    linkedRoot,
    nodeHasClass("bob-nh-notice-chip"),
  ).map((node) => node.text);
  assert.ok(linkedChips.includes("no open tasks"));

  const surfaced = linkedRow({
    text: "Ship the outcome!",
    previous_status_symbol: " ",
    status_symbol: " ",
    status_name: "Ready",
    link: null,
    not_linked: null,
    trigger: "project_empty",
    hide_removed: true,
  });
  const surfacedView = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({ unblocked: [surfaced] }),
    {},
  );
  assert.equal(
    surfacedView.text,
    "🔓 Surfaced: Ship the outcome! (Ready) · project has no open tasks",
  );
  const surfacedRoot = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(surfacedView, surfacedRoot, {});
  assert.ok(
    collectFragmentNodes(surfacedRoot, nodeHasClass("bob-nh-notice-chip"))
      .some((node) => node.text === "no open tasks"),
  );

  const projectReasons = [
    { reason: "project", suffix: "· blocked by project" },
    { reason: "project_dependency", suffix: "· blocked by project" },
    { reason: "project_schedule", scheduled: "2026-10-13", suffix: "· project until Oct 13" },
  ];
  for (const row of projectReasons) {
    const view = helpers.buildUnblockedNoticeModel(
      singleLinkedModel({
        unblocked: [linkedRow({ link: null, not_linked: "project_member" })],
        still_blocked: [
          {
            note_path: "proj.md",
            block_id: "resident",
            text: "Resident task",
            trigger: "project_empty",
            reason: row.reason,
            scheduled: row.scheduled,
          },
        ],
      }),
      {},
    );
    assert.ok(view);
    assert.equal(view.title, "Unblocked");
    assert.equal(view.stillBlocked[0].suffix, `· no open tasks ${row.suffix}`);
    const root = createFragmentNode();
    helpers.renderUnblockedNoticeFragment(view, root, {});
    assert.ok(
      collectFragmentNodes(root, nodeHasClass("bob-nh-notice-chip"))
        .some((node) => node.text === "project member"),
    );
  }

  const blockedOnly = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({
      unblocked: [],
      still_blocked: [
        {
          note_path: "proj.md",
          block_id: "resident",
          text: "Resident task",
          trigger: "project_empty",
          reason: "project",
        },
      ],
    }),
    {},
  );
  assert.equal(blockedOnly.title, "Project empty");
  assert.equal(blockedOnly.stillBlocked[0].suffix, "· no open tasks · blocked by project");
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

function unblockedNavigationApp(calls) {
  const sourceFile = { path: "2026/20261009.md", extension: "md" };
  const targetFile = { path: "sase.md", extension: "md" };
  const disk = new Map([
    [sourceFile.path, "daily note"],
    [targetFile.path, "target note"],
  ]);
  const leaf = {
    view: {
      file: sourceFile,
      editor: { getValue: () => "daily note" },
      save: async () => {},
      requestSave: { cancel: () => {} },
    },
  };
  const app = {
    vault: {
      getAbstractFileByPath: (path) => path === targetFile.path ? targetFile : null,
      read: async (file) => disk.get(file.path),
    },
    workspace: {
      activeLeaf: leaf,
      getLeaf: () => leaf,
      openLinkText: (linkText, sourcePath) => {
        calls.push([linkText, sourcePath]);
        leaf.view = { file: targetFile, editor: { getValue: () => "target note" } };
      },
    },
  };
  return app;
}

test("unblocked rows open their task without dismissing the notice", async () => {
  const calls = [];
  const app = unblockedNavigationApp(calls);
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
  await row.fireClick({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.deepEqual(calls, [["sase.md#^relaunch-failed-agents", "2026/20261009.md"]]);
});

test("unblocked row without a block id opens the note path", async () => {
  const calls = [];
  const app = unblockedNavigationApp(calls);
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
  await rendered.unblockedClick({ stopPropagation: () => {} });
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

test("nav api exposes additive notice v2 and keeps version 3", () => {
  const api = helpers.createDependencyNavApi({ app: {} });
  assert.equal(api.version, 3);
  assert.ok(api.notice);
  assert.equal(api.notice.version, 2);
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

// ---------------------------------------------------------------------------
// Notice API v2 (docs/task-dependencies.md §12.13, §12.15): keep_moving rows.

function keepMovingLink(overrides = {}) {
  return {
    day_file: "2026/20261101.md",
    entry_name: "FIX",
    entry_line: 37,
    entry_created: false,
    next_up: false,
    line: 40,
    block_link: "[[sase_badges#^ship-renderer]]",
    block_id_created: false,
    ...overrides,
  };
}

function keepMovingRow(overrides = {}) {
  return {
    note_path: "projects/sase_badges.md",
    block_id: "ship-renderer",
    line: 12,
    text: "Ship the badge renderer",
    previous_status_symbol: "/",
    previous_status_name: "In Progress",
    status_symbol: "/",
    status_name: "In Progress",
    inbox: false,
    trigger: "last_planned",
    offer: { group: "keep_moving", project: "projects/sase_badges.md" },
    unblocked_by: [
      { note_path: "projects/sase_badges.md", block_id: "draft-spec", text: "Draft the badge spec" },
    ],
    link: keepMovingLink(),
    not_linked: null,
    ...overrides,
  };
}

function keepMovingOnlyModel(rows = [keepMovingRow()], overrides = {}) {
  return {
    version: 1,
    predecessors: [
      { note_path: "projects/sase_badges.md", block_id: "draft-spec", text: "Draft the badge spec" },
    ],
    unblocked: [],
    keep_moving: rows,
    still_blocked: [],
    daily_path: "2026/20261101.md",
    daily_content: null,
    failure: null,
    ...overrides,
  };
}

test("keep-moving card: one pick reads as a Keep ‹N› moving card with ⏭, the lane, and no 🔓 or 'unblocked'", () => {
  const view = helpers.buildUnblockedNoticeModel(
    keepMovingOnlyModel([keepMovingRow()], { daily_content: "## Pomodoros\n- [ ] () — FIX\n" }),
    { app: planBudgetApp() },
  );
  assert.ok(view);
  assert.equal(view.keepMovingOnly, true);
  assert.equal(view.title, "Keep ‹sase_badges› moving");
  assert.equal(view.glyph, "⏭");
  assert.equal(view.countPill, "1 → FIX");
  assert.equal(view.receipt, "✓ Draft the badge spec");
  assert.equal(
    view.text,
    "⏭ Next in FIX: Ship the badge renderer · keeps ‹sase_badges› moving",
  );
  assert.doesNotMatch(view.text, /🔓|unblocked/i);

  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, { app: planBudgetApp() });
  const card = findFragmentNode(root, nodeHasClass("bob-nh-notice"));
  assert.ok(card.classes.includes("is-unblock"));
  assert.ok(card.classes.includes("is-keep-moving"));
  assert.equal(card.attrs["aria-label"], view.text);
  assert.equal(findFragmentNode(root, nodeHasClass("bob-nh-notice-glyph")).text, "⏭");
  assert.equal(findFragmentNode(root, nodeHasClass("bob-nh-notice-level")).text, "Keep ‹sase_badges› moving");
  assert.equal(findFragmentNode(root, nodeHasClass("bob-nh-notice-count")).text, "1 → FIX");
  assert.equal(findFragmentNode(root, nodeHasClass("bob-nh-notice-receipt")).text, "✓ Draft the badge spec");
  assert.equal(findFragmentNode(root, nodeHasClass("bob-nh-unblock-text")).text, "Ship the badge renderer");
  const chips = collectFragmentNodes(root, nodeHasClass("bob-nh-notice-chip")).map((node) => node.text);
  assert.ok(chips.includes("Pending"), "a Pending pick shows its lane (never In Progress or a symbol)");
  assert.ok(chips.includes("plan 3/3 · 10/10"));
  assert.ok(chips.includes("Alt+N releases"));
  assert.equal(
    chips.some((chip) => chip.startsWith("keeps")),
    false,
    "the title already says it; the chip is only for mixed cards",
  );
  const rowGlyph = findFragmentNode(root, nodeHasClass("bob-nh-unblock-glyph"));
  assert.equal(rowGlyph.text, "＋");
});

test("keep-moving card: several picks, created sessions, several destinations, and several projects", () => {
  const second = keepMovingRow({
    block_id: "wire-readme",
    text: "Wire badges into the README",
    status_symbol: "*",
    status_name: "Next",
    link: keepMovingLink({ line: 41 }),
  });
  const two = helpers.buildUnblockedNoticeModel(keepMovingOnlyModel([keepMovingRow(), second]), {});
  assert.equal(two.countPill, "2 → FIX");
  assert.equal(two.text, "⏭ 2 linked → FIX · keeps ‹sase_badges› moving");

  const elsewhere = keepMovingRow({
    block_id: "wire-readme",
    text: "Wire badges into the README",
    link: keepMovingLink({ entry_name: "BOB" }),
  });
  const split = helpers.buildUnblockedNoticeModel(keepMovingOnlyModel([keepMovingRow(), elsewhere]), {});
  assert.equal(split.countPill, "2 linked");
  assert.equal(split.text, "⏭ 2 linked · FIX, BOB · keeps ‹sase_badges› moving");

  const created = helpers.buildUnblockedNoticeModel(
    keepMovingOnlyModel([keepMovingRow({ link: keepMovingLink({ entry_created: true, next_up: true }) })]),
    {},
  );
  assert.equal(created.countPill, "1 → new FIX session · next up");
  assert.equal(
    created.text,
    "⏭ Next in new FIX session (next up): Ship the badge renderer · keeps ‹sase_badges› moving",
  );

  const other = keepMovingRow({
    note_path: "projects/sase_docs.md",
    block_id: "fix-docs",
    text: "Fix the docs",
    offer: { group: "keep_moving", project: "projects/sase_docs.md" },
    link: keepMovingLink({ line: 42 }),
  });
  const projects = helpers.buildUnblockedNoticeModel(keepMovingOnlyModel([keepMovingRow(), other]), {});
  assert.equal(projects.title, "Keep 2 projects moving");
  assert.equal(projects.text, "⏭ 2 linked → FIX · keeps 2 projects moving");
});

test("keep-moving lane names come from the status symbol: Pending, Next, Ready, Blocked", () => {
  assert.equal(helpers.keepMovingRowLane({ status_symbol: "/" }), "Pending");
  assert.equal(helpers.keepMovingRowLane({ status_symbol: "*", status_name: "Next" }), "Next");
  assert.equal(helpers.keepMovingRowLane({ status_symbol: " " }), "Ready");
  assert.equal(helpers.keepMovingRowLane({ status_symbol: "?" }), "Blocked");
  assert.equal(helpers.keepMovingRowLane({ status_name: "In Progress" }), "Pending");
  assert.equal(helpers.keepMovingRowLane({ status_name: "Next" }), "Next");
  assert.equal(helpers.keepMovingRowLane({}), "");
});

test("keep-moving notices are silent when nothing was picked, and unpicked rows never render", () => {
  const unpicked = keepMovingRow({ link: null, not_linked: "not_selected" });
  assert.equal(helpers.buildUnblockedNoticeModel(keepMovingOnlyModel([unpicked]), {}), null);
  assert.equal(helpers.showUnblockedNotice({}, keepMovingOnlyModel([unpicked])), false);
  assert.equal(helpers.buildUnblockedNoticeModel(keepMovingOnlyModel([]), {}), null);
  const mixedUnpicked = helpers.buildUnblockedNoticeModel(
    keepMovingOnlyModel([unpicked, keepMovingRow({ block_id: "other", text: "Other pick" })]),
    {},
  );
  assert.equal(mixedUnpicked.linked.length, 0, "keep-moving rows are not dependency 'linked' rows");
  assert.equal(mixedUnpicked.keepMoving.length, 1, "only the picked row is reported");
});

test("a mixed card keeps the 🔓 forms, counts keep-moving picks as linked, and renders them last with the chip", () => {
  const view = helpers.buildUnblockedNoticeModel(
    singleLinkedModel({
      keep_moving: [keepMovingRow()],
      still_blocked: [
        { note_path: "sase.md", block_id: "waiting", text: "Waiting task", waits_on: 2, trigger: "dependency", reason: "dependency", scheduled: null, inbox: false },
      ],
    }),
    {},
  );
  assert.equal(view.keepMovingOnly, false);
  assert.equal(view.title, "Unblocked");
  assert.equal(view.glyph, "🔓");
  assert.match(view.text, /^🔓 2 linked → FIX: /);
  assert.equal(view.countPill, "2 → FIX");
  assert.deepEqual(
    view.rows.map((entry) => `${entry.kind}:${entry.row.block_id}`),
    ["linked:relaunch-failed-agents", "stillBlocked:waiting", "linked:ship-renderer"],
    "keep-moving rows come after every dependency row",
  );
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, {});
  const card = findFragmentNode(root, nodeHasClass("bob-nh-notice"));
  assert.equal(card.classes.includes("is-keep-moving"), false);
  assert.equal(findFragmentNode(root, nodeHasClass("bob-nh-notice-glyph")).text, "🔓");
  assert.equal(findFragmentNode(root, nodeHasClass("bob-nh-notice-level")).text, "Unblocked");
  const keepChips = collectFragmentNodes(root, nodeHasClass("is-keep-moving"))
    .filter((node) => node.classes.includes("bob-nh-notice-chip"))
    .map((node) => node.text);
  assert.deepEqual(keepChips, ["keeps ‹sase_badges› moving"]);
  const rowEls = collectFragmentNodes(root, nodeHasClass("bob-nh-unblock-row"));
  assert.equal(rowEls.length, 3);
  assert.equal(rowEls[2].classes.includes("is-keep-moving"), true);
  assert.equal(rowEls[0].classes.includes("is-keep-moving"), false);
});

test("a keep-moving failure keeps the failure text and an older model without keep_moving is unchanged", () => {
  const failed = helpers.buildUnblockedNoticeModel(
    keepMovingOnlyModel([keepMovingRow()], { failure: { count: 1, reason: "disk full" } }),
    {},
  );
  assert.equal(failed.text, "⚠ Closed Draft the badge spec — couldn't link 1 successor (disk full)");
  const v1 = helpers.buildUnblockedNoticeModel(singleLinkedModel(), {});
  assert.equal(v1.keepMovingOnly, false);
  assert.equal(v1.glyph, "🔓");
  assert.equal(v1.keepMoving.length, 0);
  assert.equal(v1.text, "🔓 Next in FIX: Re-launch all failed agents on apollo!");
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(v1, root, {});
  assert.equal(findFragmentNode(root, nodeHasClass("is-keep-moving")), null);
});

test("keep-moving notice falls back to its plain ⏭ line without a DOM", () => {
  const previous = global.document;
  delete global.document;
  notices.length = 0;
  try {
    assert.equal(helpers.showUnblockedNotice({}, keepMovingOnlyModel()), true);
    assert.match(notices[0], /^⏭ Next in FIX: Ship the badge renderer · keeps ‹sase_badges› moving$/);
  } finally {
    if (previous !== undefined) global.document = previous;
  }
});

test("pull_in counts that include keep-moving offers never bring back the 🔓 forms on a keep-moving card", () => {
  const view = helpers.buildUnblockedNoticeModel(
    keepMovingOnlyModel([keepMovingRow()], { pull_in: { supported: true, offer_count: 4, picked_count: 1 } }),
    {},
  );
  assert.equal(view.keepMovingOnly, true);
  assert.equal(view.countPill, "1 → FIX");
  assert.equal(view.text, "⏭ Next in FIX: Ship the badge renderer · keeps ‹sase_badges› moving");
});

test("keep-moving title and suffix helpers follow the copy table", () => {
  const row = (project) => ({ keepMovingProject: project });
  assert.equal(helpers.keepMovingTitle([row("a")]), "Keep ‹a› moving");
  assert.equal(helpers.keepMovingTitle([row("a"), row("a")]), "Keep ‹a› moving");
  assert.equal(helpers.keepMovingTitle([row("a"), row("b")]), "Keep 2 projects moving");
  assert.equal(helpers.keepMovingSuffix([row("a")]), "keeps ‹a› moving");
  assert.equal(helpers.keepMovingSuffix([row("a"), row("b"), row("c")]), "keeps 3 projects moving");
});

test("keep-moving stylesheet uses only existing tokens inside the scoped notice and picker blocks", () => {
  const stylesPath = path.join(__dirname, "../plugins/bob-navigation-hotkeys/styles.css");
  const styles = fs.readFileSync(stylesPath, "utf8");
  const noticeStart = styles.indexOf(".bob-nh-notice.is-unblock.is-keep-moving");
  assert.notEqual(noticeStart, -1);
  const noticeBlock = styles.slice(noticeStart, styles.indexOf("/* Vault-wide Depends", noticeStart));
  assert.match(noticeBlock, /--task-status-next/);
  assert.match(noticeBlock, /\.bob-nh-notice-chip\.is-keep-moving/);
  const pickerStart = styles.indexOf(".bob-successor-group-titlebar");
  assert.notEqual(pickerStart, -1);
  const pickerBlock = styles.slice(pickerStart, styles.indexOf("@media", pickerStart));
  assert.match(pickerBlock, /\.bob-successor-group\.is-keep_moving/);
  assert.match(pickerBlock, /--task-status-next/);
  assert.match(pickerBlock, /\.bob-successor-group-caption/);
  assert.match(pickerBlock, /\.bob-successor-group-tag/);
  for (const block of [noticeBlock, pickerBlock]) {
    assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i);
    assert.doesNotMatch(block, /\brgba?\(/i);
    assert.doesNotMatch(block, /\bhsla?\(/i);
  }
});
