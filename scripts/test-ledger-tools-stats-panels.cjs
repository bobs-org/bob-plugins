const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");

const helpers = LedgerToolsPlugin.helpers;

class FakeNode {
  constructor(tag, doc, namespaceURI) {
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = namespaceURI || null;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this._text = "";
    this.value = "";
    this.hidden = false;
    this.isContentEditable = false;
  }

  set textContent(value) {
    this._text = String(value);
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }

  get textContent() {
    return this._text;
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "value") this.value = String(value);
    if (name === "hidden") this.hidden = true;
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  removeAttribute(name) {
    this.attrs.delete(name);
    if (name === "hidden") this.hidden = false;
  }

  appendChild(child) {
    child.parentNode = this;
    if (!child.ownerDocument) child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = "";
    for (const child of children) this.appendChild(child);
  }

  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(handler);
  }

  removeEventListener(name, handler) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== handler));
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  dispatch(name, init = {}) {
    let stopped = false;
    let prevented = false;
    const event = {
      type: name,
      target: this,
      currentTarget: null,
      ...init,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
      get defaultPrevented() { return prevented; },
    };
    let node = this;
    while (node) {
      event.currentTarget = node;
      for (const handler of node.listeners.get(name) || []) handler(event);
      if (stopped || event.bubbles === false) break;
      node = node.parentNode;
    }
    return event;
  }

  querySelector(selector) {
    const wanted = String(selector || "").startsWith(".") ? String(selector).slice(1) : "";
    if (!wanted) return null;
    if ((this.getAttribute("class") || "").split(/\s+/).includes(wanted)) return this;
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector, result = []) {
    const wanted = String(selector || "").startsWith(".") ? String(selector).slice(1) : "";
    if (wanted && (this.getAttribute("class") || "").split(/\s+/).includes(wanted)) result.push(this);
    for (const child of this.children) child.querySelectorAll(selector, result);
    return result;
  }

  get text() {
    return [this._text, ...this.children.map((child) => child.text)].filter(Boolean).join(" ");
  }
}

function fakeDoc() {
  const doc = {
    activeElement: null,
    createElement(tag) { return new FakeNode(tag, doc); },
    createElementNS(namespaceURI, tag) { return new FakeNode(tag, doc, namespaceURI); },
  };
  return doc;
}

function fakeContainer(doc = fakeDoc()) {
  const node = new FakeNode("div", doc);
  node.empty = () => node.replaceChildren();
  return node;
}

function point(date, value, extra = {}) {
  return {
    date,
    end: date,
    value,
    display: value === null ? "–" : String(value),
    quality: value === null ? "missing" : "ok",
    provisional: false,
    parts: {},
    parts_display: {},
    ...extra,
  };
}

function panelReport() {
  const worked = {
    id: "worked", label: "Worked", kind: "pomodoro", unit: "minutes", color: "orange",
    definition: "Minutes in closed Pomodoros", source: "daily Pomodoros", since: "2026-06-01", limits: [],
    summary: {
      headline: { display: "16m" }, total: { value: 32, display: "32m" },
      p25: 8, p75: 24,
    },
    chart: { group: "day", p25: 8, p75: 24 },
    parts_summary: {
      theme: [
        { key: "GTD", value: 29, display: "29m", share: "91%" },
        { key: "SASE", value: 3, display: "3m", share: "9%" },
      ],
    },
    points: [point("2026-10-09", 29, { display: "29m" }), point("2026-10-10", 3, { display: "3m" })],
    prior_points: [],
  };
  const created = {
    id: "created", label: "Created", kind: "tasks", unit: "count", color: "blue",
    summary: { headline: { display: "3" }, total: { value: 8, display: "8" } },
    chart: { group: "day" },
    parts_summary: {
      kind: [{ key: "task", value: 8, display: "8", share: "100%" }],
      note: [{ key: "tasks.md", value: 8, display: "8", share: "100%" }],
    },
    points: [
      point("2026-10-08", null, { quality: "not_tracked", reason: "before tracking began" }),
      point("2026-10-09", 2),
      point("2026-10-10", 5),
      point("2026-10-11", 1, { provisional: true }),
    ],
    prior_points: [],
  };
  const done = {
    id: "done", label: "Done", kind: "tasks", unit: "count", color: "green",
    summary: { headline: { display: "3" }, total: { value: 9, display: "9" } },
    chart: { group: "day" },
    parts_summary: {
      kind: [
        { key: "task", value: 7, display: "7", share: "78%" },
        { key: "ref", value: 2, display: "2", share: "22%" },
      ],
      note: [{ key: "tasks.md", value: 9, display: "9", share: "100%" }],
    },
    points: [point("2026-10-09", 1), point("2026-10-10", 4), point("2026-10-11", 0, { provisional: true })],
    prior_points: [],
  };
  const dropped = {
    id: "dropped", label: "Dropped", kind: "tasks", unit: "count", color: "gray",
    summary: { headline: { display: "2" }, total: { value: 2, display: "2" } },
    chart: { group: "day" },
    parts_summary: { kind: [{ key: "task", value: 2, display: "2", share: "100%" }] },
    points: [
      point("2026-10-09", null, { quality: "missing", reason: "no dropped rows" }),
      point("2026-10-10", 2),
      point("2026-10-11", 0, { provisional: true }),
    ],
    prior_points: [],
  };
  const net = {
    id: "net", label: "Net flow", kind: "formula", unit: "signed", color: "gray",
    summary: { headline: { display: "−1" }, total: { value: -1, display: "−1" } },
    chart: { group: "day" },
    points: [
      point("2026-10-09", null, { quality: "missing", reason: "missing constituents" }),
      point("2026-10-10", -1, { display: "−1" }),
      point("2026-10-11", 1, { display: "+1", provisional: true }),
    ],
    prior_points: [],
  };
  const reviewed = {
    id: "reviewed", label: "Reviewed", kind: "journal", unit: "count", color: "violet",
    summary: { headline: { display: "1" }, total: { value: 2, display: "2" } },
    chart: { group: "day" },
    parts_summary: {
      tier: [
        { key: "next", value: 1, display: "1", share: "50%" },
        { key: "pending", value: 1, display: "1", share: "50%" },
      ],
      outcome: [
        { key: "keep", value: 1, display: "1", share: "50%" },
        { key: "done", value: 1, display: "1", share: "50%" },
      ],
    },
    points: [point("2026-10-09", 1), point("2026-10-10", 1)],
    prior_points: [],
  };
  const reviewTime = {
    id: "review_time", label: "Review time", kind: "pomodoro", unit: "minutes", color: "orange",
    summary: { headline: { display: "15m" }, total: { value: 29, display: "29m" } },
    chart: { group: "day" },
    parts_summary: { theme: [{ key: "GTD", value: 29, display: "29m", share: "100%" }] },
    points: [point("2026-10-09", 14, { display: "14m" }), point("2026-10-10", 15, { display: "15m" })],
    prior_points: [],
  };
  const keepRate = {
    id: "keep_rate", label: "Keep rate", kind: "journal", unit: "ratio", color: "violet",
    summary: { headline: { display: "50%", stat: "pooled" }, total: null },
    chart: { group: "day", p25: 5000, p75: 5000 },
    parts_summary: {},
    points: [
      point("2026-10-09", 8000, { display: "80%" }),
      point("2026-10-10", null, { display: "–", quality: "missing", reason: "no answers in tiers [pending, next] were recorded" }),
      point("2026-10-11", 5000, { display: "50%", provisional: true }),
    ],
    prior_points: [],
  };
  return {
    ok: true,
    today: "2026-10-11",
    range: { preset: "7d", label: "Oct 9 – Oct 10", includes_today: true, group: "day" },
    metrics: [worked, created, done, dropped, net, reviewed, reviewTime, keepRate],
    health: {},
    warnings: [],
  };
}

function homesPanelReport() {
  const report = panelReport();
  report.homes = {
    "dev.md": { label: "dev", kind: "area", area: "dev.md", path: "dev.md", hue: "blue", project_label: "dev · area tasks" },
    "job.md": { label: "job", kind: "area", area: "job.md", path: "job.md", hue: "aqua", project_label: "job · area tasks" },
    "sase.md": { label: "sase", kind: "project", area: "dev.md", path: "sase.md", hue: "blue", rolled_up: 75 },
    "bob.md": { label: "bob", kind: "project", area: "dev.md", path: "bob.md", hue: "blue" },
    "job_2026_apply_29.md": { label: "job_2026_apply_29", kind: "project", area: "job.md", path: "job_2026_apply_29.md", hue: "aqua" },
    "job_resume.md": { label: "job_resume", kind: "project", area: "job.md", path: "job_resume.md", hue: "aqua" },
    "job_more.md": { label: "job_more", kind: "project", area: "job.md", path: "job_more.md", hue: "aqua" },
    "@unfiled": { label: "unfiled", kind: "bucket", area: "@unfiled", path: null, hue: null },
    "@review:GTD": { label: "GTD review", kind: "bucket", area: "gtd.md", path: null, hue: "orange" },
    "gtd.md": { label: "gtd", kind: "area", area: "gtd.md", path: "gtd.md", hue: "orange", project_label: "gtd · area tasks" },
  };
  const worked = report.metrics.find((metric) => metric.id === "worked");
  worked.summary.total = { value: 75, display: "1h 15m" };
  worked.parts_summary.area = [
    { key: "dev.md", value: 45, display: "45m", share: "60%", label: "dev", apportioned: 5, apportioned_display: "5m" },
    { key: "job.md", value: 25, display: "25m", share: "33%", label: "job" },
    { key: "@unfiled", value: 5, display: "5m", share: "7%", label: "unfiled" },
  ];
  worked.parts_summary.project = [
    { key: "sase.md", value: 20, display: "20m", share: "27%", label: "sase", apportioned: 5, apportioned_display: "5m" },
    { key: "bob.md", value: 15, display: "15m", share: "20%", label: "bob" },
    { key: "dev.md", value: 10, display: "10m", share: "13%", label: "dev · area tasks" },
    { key: "job_2026_apply_29.md", value: 12, display: "12m", share: "16%", label: "job_2026_apply_29", apportioned: 4, apportioned_display: "4m" },
    { key: "job_resume.md", value: 4, display: "4m", share: "5%", label: "job_resume" },
    { key: "job_more.md", value: 3, display: "3m", share: "4%", label: "job_more" },
    { key: "job.md", value: 6, display: "6m", share: "8%", label: "job · area tasks" },
    { key: "@unfiled", value: 5, display: "5m", share: "7%", label: "unfiled" },
  ];
  worked.points = [
    point("2026-10-09", 20, {
      display: "20m",
      parts: { area: { "dev.md": 20 }, project: { "sase.md": 20 }, theme: { SASE: 20 } },
      parts_display: { area: { "dev.md": "20m" }, project: { "sase.md": "20m" }, theme: { SASE: "20m" } },
    }),
    point("2026-10-10", 55, {
      display: "55m",
      parts: { area: { "dev.md": 25, "job.md": 25, "@unfiled": 5 }, project: { "sase.md": 20, "bob.md": 15, "dev.md": 10, "job_2026_apply_29.md": 12, "job_resume.md": 4, "job_more.md": 3, "job.md": 6, "@unfiled": 5 } },
      parts_display: { area: { "dev.md": "25m", "job.md": "25m", "@unfiled": "5m" }, project: { "sase.md": "20m", "bob.md": "15m", "dev.md": "10m", "job_2026_apply_29.md": "12m", "job_resume.md": "4m", "job_more.md": "3m", "job.md": "6m", "@unfiled": "5m" } },
      apportioned: { project: { "sase.md": 5, "job_2026_apply_29.md": 4 } },
    }),
  ];
  const done = report.metrics.find((metric) => metric.id === "done");
  done.summary.total = { value: 5, display: "5" };
  done.parts_summary.area = [
    { key: "dev.md", value: 3, display: "3", share: "60%", label: "dev" },
    { key: "job.md", value: 1, display: "1", share: "20%", label: "job" },
    { key: "@unfiled", value: 1, display: "1", share: "20%", label: "unfiled" },
  ];
  done.parts_summary.project = [
    { key: "sase.md", value: 2, display: "2", share: "40%", label: "sase" },
    { key: "dev.md", value: 1, display: "1", share: "20%", label: "dev · area tasks" },
    { key: "job_2026_apply_29.md", value: 1, display: "1", share: "20%", label: "job_2026_apply_29" },
    { key: "@unfiled", value: 1, display: "1", share: "20%", label: "unfiled" },
  ];
  done.points = [point("2026-10-09", 2, {
    parts: { area: { "dev.md": 2 }, project: { "sase.md": 2 } },
    parts_display: { area: { "dev.md": "2" }, project: { "sase.md": "2" } },
  })];
  report.sessions = [
    { date: "2026-10-09", path: "2026/20261009.md", line: 9, time_range: "0830-0855", minutes: 25, minutes_display: "25m", name: "BLOG", homes: { parts: [
      { key: "sase.md", label: "sase", kind: "project", area: "dev.md", share: 67, minutes: 17 },
      { key: "bob.md", label: "bob", kind: "project", area: "dev.md", share: 33, minutes: 8 },
    ] } },
    { date: "2026-10-10", path: "2026/20261010.md", line: 12, time_range: "1000-1015", minutes: 15, minutes_display: "15m", name: null, homes: { label: "job_2026_apply_29", parts: [
      { key: "job_2026_apply_29.md", label: "job_2026_apply_29", kind: "project", area: "job.md", share: 100, minutes: 15 },
    ] } },
  ];
  return report;
}

function checklistDay(date, state, extra = {}) {
  return point(date, state === "met" ? 1 : state === "missed" ? 0 : null, {
    display: state === "met" ? "met" : state === "missed" ? "missed" : "–",
    quality: state === "missing" ? "missing" : state === "not_tracked" ? "not_tracked" : "ok",
    reason: state === "missing" ? "no checklist file" : state === "not_due" ? "nothing due" : state === "not_tracked" ? "before tracking began" : "",
    checklist_state: state,
    ...extra,
  });
}

function habitsMetric(group = "day") {
  const days = [
    checklistDay("2026-10-04", "missed"),
    checklistDay("2026-10-05", "met"),
    checklistDay("2026-10-06", "not_due"),
    checklistDay("2026-10-07", "missing"),
    checklistDay("2026-10-08", "not_tracked"),
    checklistDay("2026-10-09", "met"),
    checklistDay("2026-10-10", "missed"),
    checklistDay("2026-10-11", "met", { provisional: true }),
  ];
  const metric = {
    id: "habits", label: "Habits", kind: "checklist", unit: "ratio", color: "green",
    summary: { headline: { display: "50%", stat: "pooled" }, total: null },
    chart: { group, p25: 2500, p75: 7500 },
    chores: [
      { key: "journal", met: 0, due: 2, display: "0 of 2 days" },
      { key: "meditate", met: 1, due: 2, display: "1 of 2 days" },
    ],
    points: group === "day" ? days : [
      point("2026-10-04", 5000, { display: "50%", end: "2026-10-11" }),
    ],
    daily_points: group === "day" ? [] : days,
    prior_points: [],
  };
  for (const day of days) {
    if (day.date === "2026-10-09") {
      day.parts = { met: { meditate: 1 }, missed: { journal: 1 } };
      day.parts_display = { met: { meditate: "1" }, missed: { journal: "1" } };
    } else if (day.date === "2026-10-10") {
      day.parts = { met: {}, missed: { journal: 1, meditate: 1 } };
      day.parts_display = { met: {}, missed: { journal: "1", meditate: "1" } };
    }
  }
  if (group !== "day") {
    metric.points[0].end = "2026-10-11";
  }
  return metric;
}

function checklistReport(group = "day") {
  return {
    ok: true,
    today: "2026-10-11",
    range: { preset: "7d", label: "Oct 4 – Oct 10", includes_today: true, group },
    metrics: [habitsMetric(group)],
    health: {},
    warnings: [],
  };
}

function findByFocus(root, key) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (node.getAttribute("data-stats-focus-key") === key) return node;
    pending.push(...node.children);
  }
  return null;
}

function findTag(root, tagName) {
  const wanted = String(tagName).toUpperCase();
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (node.tagName === wanted) return node;
    pending.push(...node.children);
  }
  return null;
}

function renderWithFocus(focus) {
  const doc = fakeDoc();
  const el = fakeContainer(doc);
  const view = { el, sourcePath: "dash_stats.md", fence: { focus } };
  return { doc, el, view };
}

test("panel dispatch covers every family, custom kinds, and the net exception", () => {
  assert.equal(helpers.statsPanelFamily({ id: "worked", kind: "pomodoro" }), "pomodoro");
  assert.equal(helpers.statsPanelFamily({ id: "my_mins", kind: "pomodoro" }), "pomodoro");
  assert.equal(helpers.statsPanelFamily({ id: "done", kind: "tasks" }), "tasks");
  assert.equal(helpers.statsPanelFamily({ id: "my_tasks", kind: "tasks" }), "tasks");
  assert.equal(helpers.statsPanelFamily({ id: "net", kind: "formula" }), "flow");
  assert.equal(helpers.statsPanelFamily({ id: "reviewed", kind: "journal" }), "answers");
  assert.equal(helpers.statsPanelFamily({ id: "my_journal", kind: "journal" }), "answers");
  assert.equal(helpers.statsPanelFamily({ id: "keep_rate", kind: "journal" }), "keep");
  assert.equal(helpers.statsPanelFamily({ id: "habits", kind: "checklist" }), "checklist");
  assert.equal(helpers.statsPanelFamily({ id: "my_signal", kind: "field" }), null);
  assert.equal(helpers.statsPanelFamily({ id: "my_formula", kind: "formula" }), null);
  assert.equal(helpers.statsPanelFamily(null), null);
});

test("pomodoro panel shows the supplied total, shares, hue, and safe text", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const report = panelReport();
      report.metrics.push({
        id: "evil_mins", label: "Evil <img src=x>", kind: "pomodoro", unit: "minutes", color: "orange",
        summary: { headline: { display: "1m" }, total: { value: 1, display: "1m" } },
        chart: { group: "day" },
        parts_summary: { theme: [{ key: "GTD", value: 1, display: "1m", share: "100%" }] },
        points: [point("2026-10-09", 1, { display: "1m" })],
        prior_points: [],
      });
      const { el, view } = renderWithFocus("evil_mins");
      plugin.renderStatsResult(view, { report });
      const panel = el.querySelector(".bob-stats-panel");
      assert.ok(panel, "custom pomodoro metrics get a panel");
      assert.match(el.text, /Where the time went.*1m/);
      assert.match(el.text, /Update bob for areas & projects/);
      assert.match(el.text, /GTD — 1m \(100%\)/);
      assert.ok(el.querySelector(".bob-stats-hue-orange"), "the selected metric hue is used");
      assert.match(el.text, /Evil <img src=x>/);
      assert.equal(findTag(el.querySelector(".bob-stats"), "img"), null, "metric text is never HTML");
    } finally {
      plugin.onunload();
    }
  });
});

test("home parts use the report catalog for labels, hue slots, and pinned values", () => {
  const report = homesPanelReport();
  const worked = report.metrics.find((metric) => metric.id === "worked");
  const point = worked.points[1];
  assert.equal(helpers.statsPanelHasHomes(worked), true);
  assert.equal(helpers.statsPanelHomeLabel(report, "area", "dev.md"), "dev");
  assert.equal(helpers.statsPanelHomeLabel(report, "project", "dev.md"), "dev · area tasks");
  assert.deepEqual(
    helpers.statsPanelHomeAreaRows(helpers.statsPanelHomeRows(worked, report, "area"), report).map((row) => row.key),
    ["dev.md", "job.md", "@unfiled"],
  );
  assert.equal(helpers.statsPanelHomeRows(worked, report, "project").find((row) => row.key === "sase.md").apportioned, 5);
  assert.equal(helpers.statsPanelHomeRows(worked, report, "project").find((row) => row.key === "job_2026_apply_29.md").label, "job_2026_apply_29");
  assert.equal(helpers.statsPanelHomeRows(worked, report, "area", point).length, 3);
  assert.equal(helpers.statsPanelHomeRows(worked, report, "project", point).find((row) => row.key === "job_2026_apply_29.md").value, 12);
  assert.equal(helpers.statsPanelHomeSessions(report, "project", "sase.md", worked.points[0]).length, 1);
  assert.match(helpers.statsChartTooltip(worked, point, report), /area: dev — 25m/);
  assert.ok(helpers.statsChartParts(point, report).includes("project: job_2026_apply_29 · 12m"));
  const done = report.metrics.find((metric) => metric.id === "done");
  assert.equal(helpers.statsTableRows(done, undefined, report)[0].topParts[0].label, "dev");
});

test("areas panel toggles Themes, pins spans, expands projects, and opens home links", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    const opened = [];
    let cursor = null;
    app.workspace.openLinkText = (path, sourcePath, newLeaf) => opened.push({ path, sourcePath, newLeaf });
    app.workspace.activeLeaf = { view: { editor: { setCursor(position) { cursor = position; } } } };
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      const report = homesPanelReport();
      const { doc, el, view } = renderWithFocus("worked");
      plugin.renderStatsResult(view, { report });
      const panel = el.querySelector(".bob-stats-panel");
      assert.match(panel.textContent + " " + panel.children.map((node) => node.text).join(" "), /Where the time went · Oct 9 – Oct 10 · 1h 15m/);
      assert.match(el.text, /dev · area tasks/);
      assert.match(el.text, /includes 75 sub-projects/);
      assert.match(el.text, /1 more/);
      assert.match(panel.querySelector(".bob-stats-home-area-bar").getAttribute("aria-label"), /dev 45m/);
      assert.match(panel.textContent + " " + panel.children.map((node) => node.text).join(" "), /from Task Links/);
      assert.match(el.text, /file the task in an area or project/);
      assert.ok(panel.querySelectorAll(".bob-stats-home-area-segment").some((node) =>
        (node.getAttribute("class") || "").split(/\s+/).includes("bob-stats-home-blue")));
      assert.ok(panel.querySelectorAll(".bob-stats-home-area-row").some((node) =>
        (node.getAttribute("class") || "").split(/\s+/).includes("bob-stats-home-blue")));
      assert.ok(panel.querySelectorAll(".bob-stats-home-mini-track").some((node) =>
        (node.getAttribute("class") || "").split(/\s+/).includes("bob-stats-home-blue")));

      const more = findByFocus(panel, "panel-home-more-job.md");
      more.dispatch("click");
      assert.match(el.text, /job_more/);

      const themeToggle = findByFocus(el.querySelector(".bob-stats-panel"), "panel-home-view-themes");
      themeToggle.dispatch("click");
      assert.equal(plugin.statsViewStateFor("dash_stats.md").homesView, "themes");
      assert.equal(findByFocus(el.querySelector(".bob-stats-panel"), "panel-home-view-themes").getAttribute("aria-pressed"), "true");
      assert.match(el.text, /GTD — 29m/);

      const areaToggle = findByFocus(el.querySelector(".bob-stats-panel"), "panel-home-view-areas");
      areaToggle.dispatch("click");
      const saseLink = el.querySelectorAll(".bob-stats-home-link").find((node) => node.textContent === "sase");
      saseLink.dispatch("click", { ctrlKey: true });
      assert.deepEqual(opened.at(-1), { path: "sase.md", sourcePath: "dash_stats.md", newLeaf: true });

      const jobSessions = findByFocus(el.querySelector(".bob-stats-panel"), "panel-home-sessions-project:job_2026_apply_29.md");
      jobSessions.dispatch("click");
      const unnamed = el.querySelectorAll(".bob-stats-home-session-link").find((node) =>
        String(node.textContent || "").includes("2026-10-10"));
      assert.match(unnamed.textContent, /job_2026_apply_29/);
      assert.equal(unnamed.textContent.includes("(unnamed)"), false);

      plugin.statsPanelPinDay(doc, view, report, "2026-10-09");
      assert.equal(plugin.statsViewStateFor("dash_stats.md").pinnedDay, "2026-10-09");
      assert.match(el.text, /2026-10-09 · 20m/);
      assert.equal(el.text.includes("job_2026_apply_29"), false, "the pinned day's supplied parts replace the period split");

      const sessions = findByFocus(el.querySelector(".bob-stats-panel"), "panel-home-sessions-project:sase.md");
      sessions.dispatch("click");
      const session = el.querySelector(".bob-stats-home-session-link");
      assert.match(session.textContent, /2026-10-09 · 0830-0855 · 25m · BLOG/);
      session.dispatch("click");
      assert.equal(opened.at(-1).path, "2026/20261009.md");
      assert.deepEqual(cursor, { line: 8, ch: 0 });
    } finally {
      plugin.onunload();
    }
  });
});

test("chart pin refreshes Where the time went and Themes honor the pinned span", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const report = homesPanelReport();
      const { doc, el, view } = renderWithFocus("worked");
      plugin.renderStatsResult(view, { report });
      const hit = findByFocus(el, "chart:2026-10-09:2026-10-09");
      assert.ok(hit, "the Worked chart exposes a pin target");
      hit.dispatch("click");
      assert.equal(plugin.statsViewStateFor("dash_stats.md").pinnedDay, "2026-10-09");
      assert.match(el.text, /Where the time went · 2026-10-09/);
      assert.match(el.text, /2026-10-09 · 20m/);
      assert.equal(el.text.includes("job_2026_apply_29"), false);

      const themeToggle = findByFocus(el.querySelector(".bob-stats-panel"), "panel-home-view-themes");
      themeToggle.dispatch("click");
      assert.match(el.text, /SASE — 20m/);
      assert.equal(el.text.includes("GTD — 29m"), false, "the pinned day's theme rows replace the period split");
    } finally {
      plugin.onunload();
    }
  });
});

test("review rows keep their area hue and a missing homes report keeps the saved view", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const report = homesPanelReport();
      assert.equal(helpers.statsPanelHomeHue(report, "@review:GTD"), "orange");
      assert.equal(helpers.statsPanelHomeHue(report, "@unfiled"), "gray");
      assert.equal(helpers.statsPanelHomeHue(report, "@unlinked"), "gray");

      const { el, view } = renderWithFocus("worked");
      plugin.renderStatsResult(view, { report });
      plugin.statsViewStateFor("dash_stats.md").homesView = "areas";
      const bare = panelReport();
      plugin.renderStatsResult(view, { report: bare });
      assert.equal(plugin.statsViewStateFor("dash_stats.md").homesView, "areas");
      assert.match(el.text, /Update bob for areas & projects/);
      assert.match(el.text, /GTD — 29m/);
    } finally {
      plugin.onunload();
    }
  });
});

test("task home table uses catalog labels and keeps hue dots and mini-bars", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const { el, view } = renderWithFocus("done");
      plugin.renderStatsResult(view, { report: homesPanelReport() });
      assert.match(el.text, /Done by area & project/);
      assert.match(el.text, /job_2026_apply_29/);
      assert.ok(el.querySelector(".bob-stats-home-mini-track"), "count metrics keep mini-bars");
      assert.equal(el.querySelector(".bob-stats-home-mini-apportioned"), null, "count metrics drop only the apportioned tint");
      assert.ok(el.querySelectorAll(".bob-stats-home-area-row").some((row) =>
        (row.getAttribute("class") || "").split(/\s+/).includes("bob-stats-home-blue")));
      assert.equal(el.querySelector(".bob-stats-home-sessions-toggle"), null);
    } finally {
      plugin.onunload();
    }
  });
});

test("task flow stacks signed values, keeps missing constituents missing, and labels series", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const { el, view } = renderWithFocus("done");
      plugin.renderStatsResult(view, { report: panelReport() });
      const panel = el.querySelector(".bob-stats-panel");
      assert.ok(panel);
      assert.match(el.text, /Task flow/);
      assert.match(el.text, /Created up \(blue\)/);
      assert.match(el.text, /Done down \(green\)/);
      assert.match(el.text, /Dropped down \(gray\)/);
      assert.match(el.text, /Net line \(ink\)/);
      assert.ok(el.querySelector(".bob-stats-flow-net"), "the consumed Net series is drawn as a 2px ink line");
      assert.ok(el.querySelector(".bob-stats-chart-missing"), "a bucket with missing constituents stays missing");
      assert.match(el.text, /By kind/);
      assert.match(el.text, /task — 7 \(78%\)/);
      assert.match(el.text, /Top notes/);
      assert.match(el.text, /Total: 9/);
      const reviewedHits = panel.querySelectorAll(".bob-stats-chart-hit")
        .filter((hit) => String(hit.getAttribute("aria-label") || "").includes("Reviewed"));
      assert.equal(reviewedHits.length, 0, "Reviewed is never plotted in task flow");
    } finally {
      plugin.onunload();
    }
  });
});

test("absent companions are named, custom filters are labeled overall, and net splits breakdowns", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const partial = panelReport();
      partial.metrics = partial.metrics.filter((metric) => metric.id !== "dropped" && metric.id !== "net");
      partial.metrics.push({
        id: "my_tasks", label: "My tasks", kind: "tasks", unit: "count", color: "blue",
        summary: { headline: { display: "2" }, total: { value: 4, display: "4" } },
        chart: { group: "day" },
        parts_summary: { kind: [{ key: "task", value: 4, display: "4", share: "100%" }] },
        points: [point("2026-10-09", 2), point("2026-10-10", 2)],
        prior_points: [],
      });
      const first = renderWithFocus("my_tasks");
      plugin.renderStatsResult(first.view, { report: partial });
      assert.match(first.el.text, /Dropped, Net are not in this report/);
      assert.match(first.el.text, /Flow is the overall task flow; My tasks is one filtered view/);

      const second = renderWithFocus("net");
      plugin.renderStatsResult(second.view, { report: panelReport() });
      assert.match(second.el.text, /Created by kind/);
      assert.match(second.el.text, /Done by kind/);
      assert.match(second.el.text, /Dropped by kind/);
      assert.match(second.el.text, /Net total: −1/);
    } finally {
      plugin.onunload();
    }
  });
});

test("journal panels pair answers with review time and a gapped keep chart under 90%", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const { el, view } = renderWithFocus("reviewed");
      plugin.renderStatsResult(view, { report: panelReport() });
      assert.match(el.text, /Answers by tier/);
      assert.match(el.text, /next — 1 \(50%\)/);
      assert.match(el.text, /Answers by outcome/);
      assert.match(el.text, /Review time: 29m in total/);
      assert.ok(el.querySelector(".bob-stats-keep-reference"), "the dashed 90% reference is drawn");
      assert.match(el.text, /reopen trigger 90%/);
      assert.ok(el.querySelector(".bob-stats-keep-today"), "today stays hollow on the keep line");
      const line = el.querySelector(".bob-stats-keep-line");
      assert.ok(line, "keep values are joined by a line");
      assert.match(line.getAttribute("d"), /M.*M/, "missing days gap the keep line instead of joining");
      const missing = panelReport();
      missing.metrics = missing.metrics.filter((metric) => metric.id !== "review_time");
      const second = renderWithFocus("reviewed");
      plugin.renderStatsResult(second.view, { report: missing });
      assert.match(second.el.text, /Review time is not in this report/);
    } finally {
      plugin.onunload();
    }
  });
});

test("checklist calendar aligns Monday weeks with states, reasons, and provisional today", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const { el, view } = renderWithFocus("habits");
      plugin.renderStatsResult(view, { report: checklistReport() });
      const panel = el.querySelector(".bob-stats-panel");
      assert.ok(panel);
      const table = el.querySelector(".bob-stats-cal");
      assert.ok(table, "the calendar renders as a table");
      assert.match(el.text, /Missed \(outlined\)/);
      assert.match(el.text, /Not due \(blank\)/);
      assert.match(el.text, /Missing \(hatched\)/);
      assert.equal(el.querySelectorAll(".bob-stats-cal-met").length >= 3, true, "met days are filled");
      assert.ok(el.querySelector(".bob-stats-cal-missed"), "missed days are outlined");
      assert.ok(el.querySelector(".bob-stats-cal-not_due"), "not-due days differ from missing days");
      assert.ok(el.querySelector(".bob-stats-cal-missing"), "missing days are hatched");
      assert.ok(el.querySelector(".bob-stats-cal-not_tracked"), "untracked days are quiet");
      assert.ok(el.querySelector(".bob-stats-cal-today"), "today stays visibly provisional");
      const sunday = findByFocus(el.querySelector(".bob-stats"), "panel:cal:2026-10-04");
      assert.ok(sunday, "the Sunday before the first Monday gets a padded week");
      assert.match(sunday.getAttribute("aria-label"), /2026-10-04 · missed/);
      const missing = findByFocus(el.querySelector(".bob-stats"), "panel:cal:2026-10-07");
      assert.match(missing.getAttribute("aria-label"), /2026-10-07 · – · no checklist file · state: missing/);
      const weeks = table.querySelectorAll(".bob-stats-cal-cell").length;
      assert.ok(weeks >= 8, "every checklist day is an interactive cell");
    } finally {
      plugin.onunload();
    }
  });
});

test("grouped calendars reuse daily points and old schemas fall back with a label", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const grouped = renderWithFocus("habits");
      plugin.renderStatsResult(grouped.view, { report: checklistReport("week") });
      assert.ok(grouped.el.querySelector(".bob-stats-cal"), "grouped ranges still calendar from daily points");
      assert.match(grouped.el.text, /0 of 2 days/, "grouped ranges list supplied chore summaries");

      const legacy = checklistReport("week");
      delete legacy.metrics[0].daily_points;
      for (const day of legacy.metrics[0].points) {
        delete day.checklist_state;
      }
      const old = renderWithFocus("habits");
      plugin.renderStatsResult(old.view, { report: legacy });
      assert.equal(old.el.querySelector(".bob-stats-cal"), null, "no daily states means no calendar");
      assert.match(old.el.text, /only the focus chart and table are shown/);
    } finally {
      plugin.onunload();
    }
  });
});

test("ISO year boundaries stay in one Monday week and chore dots expose text", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const report = {
        ok: true,
        today: "2026-01-04",
        range: { preset: "7d", label: "Dec 29 – Jan 3", includes_today: true, group: "day" },
        metrics: [{
          id: "habits", label: "Habits", kind: "checklist", unit: "ratio", color: "green",
          summary: { headline: { display: "100%", stat: "pooled" }, total: null },
          chart: { group: "day" },
          chores: [{ key: "journal", met: 5, due: 6, display: "5 of 6 days" }],
          points: [
            checklistDay("2025-12-29", "met"),
            checklistDay("2025-12-30", "met"),
            checklistDay("2025-12-31", "met"),
            checklistDay("2026-01-01", "met"),
            checklistDay("2026-01-02", "met"),
            checklistDay("2026-01-03", "missing"),
            checklistDay("2026-01-04", "met", { provisional: true }),
          ],
          daily_points: [],
          prior_points: [],
        }],
      };
      report.metrics[0].points[5].parts = {};
      report.metrics[0].points[0].parts = { met: { journal: 1 } };
      const { el, view } = renderWithFocus("habits");
      plugin.renderStatsResult(view, { report });
      assert.match(el.text, /Dec 29 ’25/, "the boundary week label names its year");
      assert.ok(el.querySelector(".bob-stats-dot-met"), "met chores are filled");
      assert.ok(el.querySelector(".bob-stats-dot-unknown"), "missing days stay unknown, never not due");
      assert.match(el.text, /5 of 6 days/);
      const dot = findByFocus(el.querySelector(".bob-stats"), "panel:chore:journal:2026-01-03");
      assert.match(dot.getAttribute("aria-label"), /journal · 2026-01-03 · – · state: unknown/);
    } finally {
      plugin.onunload();
    }
  });
});

test("panel day selection pins the shared day and never fetches", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      let fetches = 0;
      plugin.apiStatsFetch = async () => {
        fetches += 1;
        return { report: checklistReport(), stale: false };
      };
      const { el, view } = renderWithFocus("habits");
      plugin.renderStatsResult(view, { report: checklistReport() });
      const cell = findByFocus(el.querySelector(".bob-stats"), "panel:cal:2026-10-09");
      cell.focus();
      cell.dispatch("click");
      assert.equal(plugin.statsViewStateFor("dash_stats.md").pinnedDay, "2026-10-09");
      assert.match(el.text, /2026-10-09/);
      assert.equal(fetches, 0, "pinning from a panel reuses the retained report");
      const other = findByFocus(el.querySelector(".bob-stats"), "panel:cal:2026-10-10");
      other.dispatch("keydown", { key: "Enter" });
      assert.equal(plugin.statsViewStateFor("dash_stats.md").pinnedDay, "2026-10-10");
      assert.equal(fetches, 0, "keyboard pinning is also local");
    } finally {
      plugin.onunload();
    }
  });
});

test("field and formula metrics keep only the focus chart and table", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const report = panelReport();
      report.metrics.push({
        id: "my_formula", label: "My formula", kind: "formula", unit: "count", color: "gray",
        summary: { headline: { display: "1" }, total: { value: 1, display: "1" } },
        chart: { group: "day" },
        points: [point("2026-10-09", 1)],
        prior_points: [],
      });
      const { el, view } = renderWithFocus("my_formula");
      plugin.renderStatsResult(view, { report });
      assert.equal(el.querySelector(".bob-stats-panel"), null, "other formulas get no panels");
      assert.ok(el.querySelector(".bob-stats-chart-svg"), "the focus chart still renders");
    } finally {
      plugin.onunload();
    }
  });
});
