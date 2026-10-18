// Synthetic `bob ref list -s ready,next,wip -A -f json` output for the Reading
// Board preview only. Titles are invented; nothing here comes from a vault.
// The shape follows the real fixture in
// plugins/bob-ledger-tools/scripts/fixtures/reading-board/ref-list.json:
// 1 reading, 6 next, 15 ready, and 23 snoozed references.
//
// Pinned calendar (BOB_NOW-style): today is Tuesday 2026-10-20, so "This
// week" runs through Sun Oct 25, "This month" through Oct 31, and
// everything later is "Later".

const TODAY = "2026-10-20";

const KINDS = ["ai", "papers", "blogs", "docs", "chat", null];
const PARENTS = ["sase", "bob", "job_search", "home_lab", "reading", null];
const PRIORITIES = ["highest", "high", "medium", "low", "lowest", null];

const TITLES = {
  reading: ["Replacing the UPS battery pack: a field log"],
  next: [
    "How a native merge queue serializes pull requests",
    "Retry budgets for agent pipelines",
    "`bob ref list` JSON: reading the new `blocked_by` field",
    "Why small diffs review faster, and what the data says about it across teams",
    "Local-first sync, three years on",
    "Pomodoro ledgers as a source of truth",
  ],
  ready: [
    "Release engineering at scale: lessons from a decade of weekly launches",
    "Understanding backpressure",
    "An unhurried tour of `git worktree`",
    "Structured concurrency in practice",
    "Notes on tail latency",
    "supercalifragilisticexpialidocious_configuration_option_names_considered_harmful",
    "Designing CLIs people remember",
    "Embeddings for small corpora",
    "A gentle introduction to CRDTs",
    "Evaluating agent harnesses",
    "The cost of context switching",
    "Reading `Cargo.lock` like a changelog",
    "Kernel scheduling for the curious",
    "Writing runbooks that get used",
    "Observability without dashboards",
  ],
};

const SNOOZED_SCHEDULE = [
  ["Job search: portfolio teardown", "2026-10-21"],
  ["Minions: Strike Teams, Part 3", "2026-10-22"],
  ["Understanding hybrid search", "2026-10-23"],
  ["Evals through goldens", "2026-10-27"],
  ["A taxonomy of flaky tests", "2026-10-29"],
  ["Postmortem culture", "2026-10-30"],
  ["Bob-grade task schemas", "2026-11-01"],
  ["The state of WebGPU", "2026-11-09"],
  ["Rust async, revisited", "2026-12-14"],
  ["Year-end reading list", "2027-01-04"],
];

const SNOOZED_DEPENDENCY = [
  ["Minions: Strike Teams, Part 2", ["Minions: Strike Teams, Part 1"]],
  ["The city-scale agent report", ["Gas pipelines for agents", "Pipeline back-pressure notes"]],
  ["Merge queues, compared", ["How a native merge queue serializes pull requests"]],
  ["Release trains and feature flags", ["Release engineering at scale: lessons from a decade of weekly launches"]],
  ["Designing dashboards that decay", ["Observability without dashboards"]],
  ["Second-order effects of retries", ["Retry budgets for agent pipelines"]],
];

const SNOOZED_PROJECT = [
  "Drafting the post: an outline pass",
  "Post series: voice and tone references",
  "Evals through goldens, part two",
  "Figures for the blog post",
];

function slug(title) {
  return title
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function makeRow(index, title, status, options = {}) {
  const type = options.type !== undefined ? options.type : KINDS[index % KINDS.length];
  const parent = options.parent !== undefined ? options.parent : PARENTS[index % PARENTS.length];
  const dir = type || "misc";
  const path = `ref/${dir}/${slug(title)}.md`;
  const blockId = "ref";
  const priority = options.priority !== undefined ? options.priority : PRIORITIES[index % PRIORITIES.length];
  const day = String(1 + ((index * 3) % 19)).padStart(2, "0");
  return {
    path,
    link: `[[${path.replace(/\.md$/, "")}]]`,
    title,
    marker_id: null,
    origin: "external",
    ref_type: type,
    era: "modern",
    status,
    status_sync: index % 11 === 4 ? "pending" : "ok",
    reading_state: status === "wip" ? "started" : "queued",
    blocked: Boolean(options.blocked),
    blocked_by: options.blocked_by || [],
    parent,
    task: {
      path,
      block_id: blockId,
      link: `[[${path.replace(/\.md$/, "")}#^${blockId}]]`,
      mark: options.blocked ? "?" : status === "wip" ? "/" : status === "next" ? "*" : " ",
      archived: false,
      priority,
      scheduled: options.scheduled || null,
    },
    added: index % 7 === 3 ? null : `2026-10-${day}`,
    audio: index % 9 === 2,
    annotation_count: index % 5 === 1 ? 2 + (index % 7) : 0,
    source_pdf: index % 4 === 3 ? null : `lib/${dir}/${slug(title)}.pdf`,
    source: null,
  };
}

function syntheticReport() {
  const rows = [];
  let index = 0;
  for (const title of TITLES.reading) {
    rows.push(makeRow(index++, title, "wip", { type: "chat", parent: "home_lab", priority: "high" }));
  }
  for (const title of TITLES.next) {
    rows.push(makeRow(index++, title, "next"));
  }
  for (const title of TITLES.ready) {
    rows.push(makeRow(index++, title, "ready"));
  }
  const byTitle = new Map(rows.map((row) => [row.title, row]));
  const prerequisite = (title, onBoardRow) => {
    const found = onBoardRow || byTitle.get(title);
    return {
      id: `sase__${slug(title)}`,
      title,
      path: found ? found.task.path : "sase.md",
      block_id: found ? found.task.block_id : slug(title),
      link: found ? found.task.link : `[[sase#^${slug(title)}]]`,
      mark: "*",
      ref_path: found ? found.path : null,
    };
  };
  // Two waking rows: blocked, but no reason is left on the line.
  rows.push(makeRow(index++, "A reading list that woke up", "ready", { blocked: true }));
  rows.push(makeRow(index++, "Returning to Next after the weekend", "next", { blocked: true }));
  for (const [title, date] of SNOOZED_SCHEDULE) {
    rows.push(
      makeRow(index++, title, index % 7 === 0 ? "next" : "ready", {
        blocked: true,
        scheduled: date,
        blocked_by: [{ kind: "local_schedule", date }],
      }),
    );
  }
  SNOOZED_DEPENDENCY.forEach(([title, prerequisites], position) => {
    const reasons = [
      {
        kind: "local_dependency",
        prerequisites: prerequisites.map((name) => prerequisite(name)),
      },
    ];
    if (position === 1) {
      reasons.push({ kind: "local_schedule", date: "2026-11-01" });
    }
    rows.push(
      makeRow(index++, title, position === 3 ? "wip" : "ready", {
        blocked: true,
        scheduled: position === 1 ? "2026-11-01" : null,
        blocked_by: reasons,
      }),
    );
  });
  for (const title of SNOOZED_PROJECT) {
    rows.push(
      makeRow(index++, title, "ready", {
        blocked: true,
        parent: "sase_post_blog",
        blocked_by: [{ kind: "project", project: "sase_post_blog.md", link: "[[sase_post_blog]]" }],
      }),
    );
  }
  // Dependency, schedule, and project together.
  rows.push(
    makeRow(index++, "Everything at once: a stacked-reasons example", "ready", {
      blocked: true,
      scheduled: "2026-11-01",
      blocked_by: [
        { kind: "local_dependency", prerequisites: [prerequisite("Understanding backpressure")] },
        { kind: "local_schedule", date: "2026-11-01" },
        { kind: "project", project: "sase_post_blog.md", link: "[[sase_post_blog]]" },
      ],
    }),
  );
  return {
    ok: true,
    schema_version: 1,
    command: "ref list",
    generated_at: "2026-10-20T09:00:00",
    refs: rows,
  };
}

// Paths that are linked under today's Pomodoros in the preview.
function syntheticTodayPaths(report) {
  const pick = (status, position) =>
    report.refs.filter((row) => row.status === status && !row.blocked)[position];
  return [pick("wip", 0), pick("next", 1), pick("ready", 0), pick("ready", 5)]
    .filter(Boolean)
    .map((row) => `${row.task.path}#${row.task.block_id}`);
}

module.exports = { TODAY, syntheticReport, syntheticTodayPaths };
