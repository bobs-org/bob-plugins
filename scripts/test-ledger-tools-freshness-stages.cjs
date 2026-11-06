const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
  makeFreshnessTask,
  withMissingConfig,
  coerceFreshnessConfig,
  freshnessQueue,
  helpers,
} = require("./ledger-tools-harness.cjs");

const fixturePath = path.join(
  __dirname,
  "../plugins/bob-ledger-tools/scripts/fixtures/freshness_stages/vectors.json",
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function yamlScalar(raw) {
  const value = raw.trim();
  if (value === "") return undefined;
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value);
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const body = value.slice(1, -1).trim();
    if (!body) return [];
    const entries = body.match(/(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,])+/g) || [];
    return entries.map((entry) => yamlScalar(entry));
  }
  return value;
}

// These vectors use only a small YAML subset: a freshness mapping with
// scalar or inline-list values. Keeping this decoder local avoids adding
// a test-only parser dependency.
function parseFreshnessBlock(source) {
  const lines = String(source || "").split(/\r?\n/);
  if (!lines.some((line) => /^freshness:\s*$/.test(line))) {
    return undefined;
  }
  const block = {};
  for (const line of lines) {
    const match = /^  ([a-z_]+):(?:\s*(.*))?$/.exec(line);
    if (match) block[match[1]] = yamlScalar(match[2] || "");
  }
  return block;
}

function queueRow(row, today) {
  const status = row.status === undefined ? "?" : row.status;
  return {
    path: row.path,
    line: row.line,
    lineNumber: row.line - 1,
    text: "",
    originalMarkdown: `- [${status}] #task`,
    statusSymbol: status,
    isTodo: status === " ",
    recurring: Boolean(row.recurring),
    laneVisible: !row.scheduled || row.scheduled <= today,
    isDailyNote: false,
    isToday: false,
    scheduled: row.scheduled || null,
    due: null,
    start: null,
    created: null,
    rawLine: `- [${status}] #task`,
    noteRefreshRaw: undefined,
    checklist: helpers.freshnessChecklistForTags(row.tags),
    tags: row.tags,
  };
}

function stageApiConfig(overrides = {}) {
  return coerceFreshnessConfig({
    pre_stages: fixture.defaults.pre_stages,
    post_stages: fixture.defaults.post_stages,
    ...overrides,
  }).config;
}

test("SC stage config vectors normalize valid lists and isolate rejected lists", () => {
  for (const vector of fixture.config.filter((item) => item.runners.includes("js"))) {
    const result = coerceFreshnessConfig(parseFreshnessBlock(vector.yaml));
    assert.equal(result.invalid, false, `${vector.id}: stage errors are not block errors`);
    assert.deepEqual(result.config.preStages, vector.pre, `${vector.id} PRE`);
    assert.deepEqual(result.config.postStages, vector.post, `${vector.id} POST`);
    assert.deepEqual(
      result.config.stagesInvalid.map(({ key }) => ({ key })),
      vector.diagnostics,
      `${vector.id} diagnostics`,
    );
    if (vector.interval !== undefined) {
      assert.equal(result.config.interval, vector.interval, `${vector.id} interval`);
    }
  }
});

test("CS stage queue vectors resolve tags and sort staged checklist rows", () => {
  for (const vector of fixture.queue.filter((item) => item.runners.includes("js"))) {
    const config = stageApiConfig({
      pre_stages: vector.pre_stages ?? fixture.defaults.pre_stages,
      post_stages: vector.post_stages ?? fixture.defaults.post_stages,
    });
    const rows = vector.rows.map((row) => queueRow(row, fixture.defaults.today));
    const queue = freshnessQueue(rows, fixture.defaults.today, config);
    assert.deepEqual(
      queue.map(({ path: rowPath, line }) => `${rowPath}:${line}`),
      vector.order,
      `${vector.id} order`,
    );
    for (const [key, expectedTier] of Object.entries(vector.tiers || {})) {
      const entry = queue.find((candidate) => candidate.key === key);
      assert.ok(entry, `${vector.id} contains ${key}`);
      assert.equal(entry.tier, expectedTier, `${vector.id} ${key} tier`);
    }
    for (const [key, expected] of Object.entries(vector.stages)) {
      const entry = queue.find((candidate) => candidate.key === key);
      if (!expected) {
        assert.ok(!entry || entry.stage === null, `${vector.id} ${key} unstaged`);
        if (entry) {
          assert.equal(entry.stageIndex, null);
          assert.equal(entry.stageRank, null);
          assert.equal(entry.stageTotal, null);
        }
        continue;
      }
      assert.ok(entry, `${vector.id} contains staged row ${key}`);
      assert.equal(entry.stage, expected.stage, `${vector.id} ${key} stage`);
      const stages = entry.tier === "pre" ? config.preStages : config.postStages;
      assert.equal(entry.stageIndex, stages.indexOf(expected.stage), `${vector.id} ${key} index`);
      assert.equal(entry.stageRank, expected.rank, `${vector.id} ${key} rank`);
      assert.equal(entry.stageTotal, expected.total, `${vector.id} ${key} total`);
    }
  }
});

test("stage names are rendered in footer details and counts compact before labels", () => {
  const staged = {
    tier: "pre",
    tierLabel: "PRE",
    stage: "terminal",
    stageRank: 1,
    stageTotal: 2,
    state: null,
    lane: "ready",
  };
  const view = helpers.freshnessReviewEntryView(staged);
  assert.equal(view.detail, "TERMINAL 1/2");
  assert.equal(view.compact, "TERMINAL");
  assert.equal(view.stage, "TERMINAL");
  assert.equal(
    helpers.freshnessReviewEntryView({ ...staged, tier: "post", stageTotal: 1 }).detail,
    "TERMINAL",
  );
});

class PreviewNode {
  constructor(className = "") {
    this.className = className;
    this.classList = new Set(className.split(/\s+/).filter(Boolean));
    this.children = [];
    this.textContent = "";
    this.attributes = new Map();
  }

  createEl(tag, { cls } = {}) {
    const child = new PreviewNode(cls || "");
    child.tagName = tag;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  empty() {
    this.children = [];
    this.textContent = "";
  }

  setText(value) {
    this.textContent = String(value);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    this.children.push(child);
  }

  get scrollWidth() {
    return this.children.reduce((sum, child) => {
      if (child.classList.has("bob-freshness-omit")) return sum;
      if (child.classList.has("bob-freshness-main")) return sum + 18;
      return sum + String(child.textContent || "").length;
    }, 0);
  }
}

test("FT1-FT6 footer details preserve tier semantics, stage color, and compact counts", () => {
  const pre = {
    key: "gtd_daily.md:1",
    path: "gtd_daily.md",
    line: 1,
    text: "Cleanup",
    state: null,
    bucket: null,
    tier: "pre",
    tierLabel: "PRE",
    lane: "ready",
    rank: 1,
    tierRank: 1,
    tierTotal: 9,
    stage: "terminal",
    stageIndex: 0,
    stageRank: 1,
    stageTotal: 2,
  };
  const secondPre = { ...pre, key: "gtd_daily.md:2", line: 2, rank: 2, stageRank: 2 };
  const counts = {
    walk: 2,
    byTier: {
      pre: 2, new: 0, projects: 0, pending: 0, next: 0,
      recurring: 0, tickler: 0, rotten: 0, post: 0,
    },
  };
  const preView = helpers.freshnessFooterView(
    { counts, queue: [pre, secondPre], tasksAvailable: true },
    { current: pre, navAvailable: true },
  );
  assert.equal(preView.dueText, "Review 1/2");
  assert.equal(preView.contextText, "PRE 1/9");
  assert.equal(preView.detailText, "TERMINAL 1/2");
  assert.match(preView.tooltip, /Ctrl\+Enter done · \]s skip/);

  const singleStage = helpers.freshnessReviewEntryView({ ...pre, stageTotal: 1 });
  assert.equal(singleStage.detail, "TERMINAL");
  assert.equal(singleStage.compact, "TERMINAL");

  const post = {
    ...pre,
    key: "gtd_daily.md:3",
    tier: "post",
    tierLabel: "POST",
    tierRank: 1,
    tierTotal: 2,
    stage: "periods",
    stageRank: 1,
    stageTotal: 1,
  };
  const postView = helpers.freshnessFooterView(
    {
      counts: {
        walk: 2,
        byTier: {
          pre: 0, new: 0, projects: 0, pending: 0, next: 0,
          recurring: 0, tickler: 0, rotten: 0, post: 2,
        },
      },
      queue: [post, { ...post, key: "gtd_daily.md:4", stage: null, stageRank: null, stageTotal: null }],
      tasksAvailable: true,
    },
    { current: post, navAvailable: true },
  );
  assert.equal(postView.contextText, "POST 1/2");
  assert.equal(postView.detailText, "PERIODS");
  assert.match(postView.tooltip, /Ctrl\+Enter done · closes the review/);

  const el = new PreviewNode();
  Object.defineProperty(el, "clientWidth", { value: 44 });
  const parts = helpers.freshnessFooterPaint(el, preView);
  assert.equal(parts.detail.textContent, "TERMINAL");
  assert.equal(parts.detail.getAttribute("data-review-tier"), "pre");
});

test("invalid stage lists emit one config lint without invalidating freshness", () => {
  withMissingConfig(() => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    const coerced = coerceFreshnessConfig({ pre_stages: "browser" });
    assert.equal(coerced.invalid, false);
    plugin.freshnessConfigSnapshot = () => coerced;
    plugin.onload();
    try {
      const config = plugin.api.freshness.config();
      assert.equal(config.invalid, false);
      assert.deepEqual(config.preStages, []);
      const diagnostics = plugin.api.freshness.lints().filter(
        (lint) => lint.code === "freshness_stages_invalid",
      );
      assert.equal(diagnostics.length, 1);
      assert.equal(
        diagnostics[0].message,
        "freshness.pre_stages pre_stages must be a list of stage names, got \"browser\"; list ignored, PRE keeps file order",
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("namespace v14 exposes normalized stage config and queue fields from Tasks rows", () => {
  withMissingConfig(() => {
    const task = makeFreshnessTask({
      tags: ["#task", "#gtd", "#pre", "#terminal"],
    });
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [task] }), {});
    plugin.freshnessConfigSnapshot = () =>
      coerceFreshnessConfig({ pre_stages: ["Terminal"] });
    plugin.onload();
    try {
      const freshness = plugin.api.freshness;
      assert.equal(freshness.version, 14);
      assert.equal(freshness.checklistStages, true);
      assert.deepEqual(freshness.config().preStages, ["terminal"]);
      const [entry] = freshness.queue();
      assert.equal(entry.stage, "terminal");
      assert.equal(entry.stageIndex, 0);
      assert.equal(entry.stageRank, 1);
      assert.equal(entry.stageTotal, 1);
    } finally {
      plugin.onunload();
    }
  });
});
