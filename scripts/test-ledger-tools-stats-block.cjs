// Daily Stats page block: fence parsing, tile models for each unit and
// quality, spark bars, table rows, CSV, session state, error cards, block
// rendering through a fake DOM, and the stylesheet contract. Pure helpers
// come from the built plugin's exports.
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
  statsCsv,
  statsOverviewIds,
  statsParseFenceOptions,
  statsSparkBars,
  statsTableRows,
  statsTileModel,
  statsTrackingSince,
  statsWindowLabel,
} = LedgerToolsPlugin.helpers;

class FakeNode {
  constructor(tag, doc) {
    this.tag = tag;
    this.doc = doc;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
    this.classList = {
      add: (name) => this.addClass(name),
      remove: (name) => this.removeClass(name),
    };
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  addClass(name) {
    const current = (this.attrs.get("class") || "").split(/\s+/).filter(Boolean);
    if (!current.includes(name)) {
      current.push(name);
    }
    this.attrs.set("class", current.join(" "));
  }

  removeClass(name) {
    const current = (this.attrs.get("class") || "").split(/\s+/).filter((part) => part && part !== name);
    this.attrs.set("class", current.join(" "));
  }

  appendChild(child) {
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
    for (const handler of this.listeners.get(event) || []) {
      handler({ preventDefault: () => {}, ...payload });
    }
  }

  querySelector(selector) {
    const wanted = String(selector || "").startsWith(".")
      ? String(selector).slice(1)
      : null;
    if (!wanted) {
      return null;
    }
    const classes = (this.attrs.get("class") || "").split(/\s+/);
    if (classes.includes(wanted)) {
      return this;
    }
    for (const child of this.children) {
      if (child instanceof FakeNode) {
        const found = child.querySelector(selector);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  querySelectorAll(selector, found = []) {
    const one = this.querySelector(selector);
    if (one && !found.includes(one)) {
      found.push(one);
      for (const child of this.children) {
        if (child instanceof FakeNode) {
          child.querySelectorAll(selector, found);
        }
      }
    } else {
      for (const child of this.children) {
        if (child instanceof FakeNode) {
          child.querySelectorAll(selector, found);
        }
      }
    }
    return found;
  }

  get text() {
    return [this.textContent, ...this.children.map((child) => (child instanceof FakeNode ? child.text : String(child || "")))].join(" ");
  }
}

function fakeDoc() {
  return {
    createElement: (tag) => new FakeNode(tag),
  };
}

function fakeContainer() {
  const doc = fakeDoc();
  const el = new FakeNode("div", doc);
  el.ownerDocument = doc;
  el.empty = () => {
    el.children = [];
  };
  return el;
}

function sampleMetric(overrides = {}) {
  return {
    id: "worked",
    label: "Worked",
    kind: "pomodoro",
    unit: "minutes",
    color: "orange",
    since: "2026-06-01",
    summary: {
      headline: { value: 290, display: "4h 50m", suffix: "/day", stat: "median" },
      days_with_data: 28,
      delta: { display: "▲ 6%", words: "up 6% vs the prior 4 weeks", sign: 1 },
    },
    points: [
      { date: "2026-10-09", end: "2026-10-09", value: 245, display: "4h 05m", quality: "ok", provisional: false, parts: { theme: { GTD: 60, SASE: 185 } } },
      { date: "2026-10-10", end: "2026-10-10", value: null, display: "–", quality: "missing", reason: "no daily note", provisional: false },
      { date: "2026-10-11", end: "2026-10-11", value: 25, display: "25m", quality: "ok", provisional: true, parts: { theme: { GTD: 25 } } },
    ],
    ...overrides,
  };
}

function sampleReport(metrics) {
  return {
    ok: true,
    schema_version: 1,
    today: "2026-10-11",
    range: { preset: "4w", offset: 0, label: "Sep 13 – Oct 10", includes_today: true },
    metrics: metrics || [sampleMetric()],
    health: { journal: { hosts: [{ host: "apollo", last_ts: "2026-10-11T05:41:07-04:00" }] } },
    warnings: [{ code: "journal_gap", message: "Review closed but no answers were recorded" }],
  };
}

test("stats fence body sets defaults only and ignores the rest", () => {
  assert.deepEqual(statsParseFenceOptions(""), {});
  assert.deepEqual(statsParseFenceOptions("null\n"), {});
  assert.deepEqual(
    statsParseFenceOptions('{"range": "7d", "metrics": ["worked"], "focus": "worked", "chart": true}'),
    { range: "7d", metrics: ["worked"], focus: "worked" },
  );
  assert.deepEqual(statsParseFenceOptions('{"range": "bogus"}'), {});
  assert.deepEqual(statsParseFenceOptions('{"metrics": "worked"}'), {});
  assert.deepEqual(statsParseFenceOptions('{"focus": ""}'), {});
  assert.deepEqual(statsParseFenceOptions("not: [balanced"), {});
});

test("stats tile models cover every unit and every quality", () => {
  const minutes = statsTileModel(sampleMetric());
  assert.equal(minutes.headline, "4h 50m");
  assert.equal(minutes.suffix, "/day");
  assert.equal(minutes.delta, "▲ 6%");
  assert.equal(minutes.spark.length, 3);
  const ratio = statsTileModel(
    sampleMetric({ id: "keep_rate", label: "Keep rate", unit: "ratio", color: "violet" }),
  );
  assert.equal(ratio.color, "violet");
  const metas = statsTileModel(
    sampleMetric({
      id: "review_closed",
      unit: "bool",
      summary: { headline: { value: 5, display: "5 of 7" }, days_with_data: 7 },
    }),
  );
  assert.equal(metas.headline, "5 of 7");
  assert.equal(metas.suffix, "days");
  const missing = statsTileModel(
    sampleMetric({ points: [{ date: "2026-10-10", value: null, display: "–", quality: "missing" }] }),
  );
  assert.equal(missing.quality, "missing");
  const untracked = statsTileModel(
    sampleMetric({ points: [{ date: "2026-10-10", value: null, display: "–", quality: "not_tracked" }] }),
  );
  assert.equal(untracked.quality, "not_tracked");
});

test("stats spark bars mark null gaps, zero ticks, and hollow today", () => {
  const bars = statsSparkBars([
    { value: 100, provisional: false },
    { value: null, provisional: false },
    { value: 0, provisional: false },
    { value: 50, provisional: true },
  ]);
  assert.equal(bars[0].height, 1);
  assert.equal(bars[1].empty, true);
  assert.equal(bars[2].zero, true);
  assert.equal(bars[2].height, 0);
  assert.equal(bars[3].provisional, true);
  assert.ok(bars[3].height > 0 && bars[3].height < 1);
  const empty = statsSparkBars([]);
  assert.deepEqual(empty, []);
});

test("stats table rows and CSV share the same points", () => {
  const rows = statsTableRows(sampleMetric());
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, "2026-10-09");
  assert.equal(rows[0].topParts.length, 2);
  assert.equal(rows[1].quality, "missing");
  assert.equal(rows[1].reason, "no daily note");
  assert.equal(rows[2].provisional, true);
  const csv = statsCsv(sampleReport());
  const lines = csv.split("\n");
  assert.equal(lines[0], "date,end,metric,value,display,quality,provisional,num,den");
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^2026-10-09,2026-10-09,worked,245,4h 05m,ok,false,,/);
  assert.match(lines[2], /^2026-10-10,2026-10-10,worked,,–,missing,false,,/);
});

test("stats overview ids prefer the fence, then config, then report order", async () => {
  await withMissingConfig(async () => {
    const report = sampleReport([sampleMetric(), sampleMetric({ id: "done" })]);
    assert.deepEqual(statsOverviewIds(report, ["done"]), ["done"]);
    assert.deepEqual(statsOverviewIds(report, ["nope"]), ["worked", "done"]);
    assert.deepEqual(statsOverviewIds(report, null), ["worked", "done"]);
  });
});

test("stats window label always states today and tracking start", () => {
  assert.equal(statsWindowLabel(sampleReport()), "Sep 13 – Oct 10 · today in progress");
  assert.equal(
    statsWindowLabel({ range: { label: "Sep 13 – Oct 10", includes_today: false } }),
    "Sep 13 – Oct 10",
  );
  assert.equal(statsTrackingSince(sampleReport()), "2026-06-01");
});

test("stats view state is session-only and per source path", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      const first = plugin.statsViewStateFor("dash_stats.md");
      const second = plugin.statsViewStateFor("other.md");
      assert.deepEqual(first, {
        range: null,
        offset: 0,
        focus: null,
        compare: false,
        table: false,
        pinnedDay: null,
        homesView: null,
        homeRowsExpanded: {},
        homeSessionsExpanded: {},
        homeSessionsAll: {},
      });
      first.range = "7d";
      assert.equal(second.range, null);
      assert.equal(plugin.statsViewStateFor("dash_stats.md").range, "7d");
    } finally {
      plugin.onunload();
    }
  });
});

test("stats block renders header, tiles, table, and footer from JSON", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      plugin.apiStatsFetch = async () => ({ report: sampleReport(), stale: false, error: null });
      const el = fakeContainer();
      plugin.renderStatsBlock(el, { sourcePath: "dash_stats.md", addChild: () => {} }, "");
      await new Promise((resolve) => setTimeout(resolve, 20));
      const root = el.querySelector(".bob-stats");
      assert.ok(root, "block root renders");
      assert.ok(el.querySelector(".bob-stats-header"), "header renders");
      assert.ok(el.querySelector(".bob-stats-chip-active"), "active range chip renders");
      assert.ok(el.querySelector(".bob-stats-window"), "window label renders");
      assert.match(el.text, /Sep 13/);
      const tiles = el.querySelectorAll(".bob-stats-tile");
      assert.equal(tiles.length, 1);
      assert.match(el.text, /4h 50m/);
      assert.match(el.text, /▲ 6%/);
      assert.ok(el.querySelector(".bob-stats-bar-today"), "hollow today bar renders");
      assert.ok(el.querySelector(".bob-stats-bar-null"), "null gap renders");
      // Table toggle repaints with the focus metric's rows and Copy CSV.
      const state = plugin.statsViewStateFor("dash_stats.md");
      state.table = true;
      plugin.paintStatsBlock({ el, sourcePath: "dash_stats.md", fence: {} });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(el.querySelector(".bob-stats-table"), "table renders");
      assert.match(el.text, /no daily note/);
      assert.match(el.text, /Copy CSV/);
      // Footer carries provenance and warnings as text.
      assert.match(el.text, /Derived by bob stats/);
      assert.match(el.text, /apollo/);
      assert.match(el.text, /journal_gap/);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats block shows an actionable card with Retry when bob fails", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      plugin.apiStatsFetch = async () => ({
        report: null,
        stale: false,
        error: { code: "bob-not-found", tried: ["bob (PATH)"] },
      });
      const el = fakeContainer();
      plugin.renderStatsBlock(el, { sourcePath: "dash_stats.md", addChild: () => {} }, "");
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(el.querySelector(".bob-stats-error"), "error card renders, never empty charts");
      assert.match(el.text, /bob was not found/);
      assert.match(el.text, /stats\.bob_path/);
      assert.match(el.text, /Retry/);
      // Never an empty block: a throwing fetch still renders text.
      plugin.apiStatsFetch = async () => {
        throw new Error("boom");
      };
      const el2 = fakeContainer();
      plugin.renderStatsBlock(el2, { sourcePath: "x.md", addChild: () => {} }, "");
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(el2.text.length > 0);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats block registers the processor and the Open Stats command", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    const plugin = new LedgerToolsPlugin(app, {});
    const commands = [];
    plugin.addCommand = (command) => commands.push(command);
    const processors = {};
    plugin.registerMarkdownCodeBlockProcessor = (language, handler) => {
      processors[language] = handler;
    };
    plugin.onload();
    try {
      assert.equal(typeof processors["bob-stats"], "function");
      const open = commands.find((command) => command.id === "open-stats");
      assert.ok(open, "Open Stats command registers");
      assert.equal(open.name, "Open Stats");
      let opened = null;
      app.workspace.openLinkText = async (target) => {
        opened = target;
      };
      await open.callback();
      assert.equal(opened, "dash_stats");
    } finally {
      plugin.onunload();
    }
  });
});

test("stats stylesheet contract: selectors, tabular-nums, motion, colors", () => {
  const cssPath = path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css");
  const css = fs.readFileSync(cssPath, "utf8");
  const marker = "Daily Stats page block (bob-cli-6l page)";
  assert.ok(css.includes(marker), "stats section exists");
  const section = css.slice(css.indexOf(marker));
  for (const selector of [
    ".bob-stats",
    ".bob-stats-header",
    ".bob-stats-tiles",
    ".bob-stats-tile-selected",
    ".bob-stats-skeleton",
    ".bob-stats-table",
    ".bob-stats-error",
  ]) {
    assert.ok(section.includes(selector), `selector ${selector} exists`);
  }
  assert.ok(section.includes("repeat(auto-fit, minmax(9.5rem, 1fr))"), "tile grid wraps");
  assert.ok(section.includes("tabular-nums"), "axes, tables, and tooltips use tabular-nums");
  assert.ok(section.includes("prefers-reduced-motion"), "reduced motion respected");
  assert.ok(section.includes("forced-colors"), "forced colors handled");
  for (const hue of ["#eb6834", "#6250d6", "#16a070", "#2a78d6", "#d95926", "#9085e9", "#199e70", "#3987e5"]) {
    assert.ok(section.includes(hue), `validated hue ${hue} present`);
  }
  // Hexes live only on validated Stats and Pomodoro area palette tokens.
  for (const line of section.split("\n")) {
    if (!/#[0-9a-fA-F]{3,8}\b/.test(line)) {
      continue;
    }
    assert.match(
      line.trim(),
      /^--bob-(?:stats-(?:orange|violet|green|blue)|area-(?:blue|orange|aqua|yellow|magenta|green|violet|red)):\s*#[0-9a-fA-F]{6};?$/,
      `hex outside the palette block: ${line.trim()}`,
    );
  }
});
