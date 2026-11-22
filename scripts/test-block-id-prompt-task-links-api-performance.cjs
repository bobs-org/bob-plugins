// api.taskLinks CPU-performance gate (T9): the ranked session path, not just
// the editor index path. `session.rank` returns the complete public row set;
// also access the three visible titles on every sample, so this gates the
// real `api.taskLinks` (`open({ sourcePath, subjects })`, then `rank(q)`)
// over 5,000 tasks: session open (snapshot plus first rank) at most 50 ms,
// keystroke-to-rows p95 at most 12 ms, and no vault reads while filtering.
//
// Built on `task-wikilink-index-perf-support.cjs`, following its CPU-time
// measurement style (not single-sample wall clock). Runs only in the serial
// `test:perf` stage.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cpuTimeMs,
  delay,
  bestOf,
  coldBuildTimed,
} = require("./task-wikilink-index-perf-support.cjs");
const { helpers } = require("./block-id-prompt-harness.cjs");

const OPEN_BUDGET_MS = 50;
const KEYSTROKE_BUDGET_MS = 12;
const QUERIES = ["task", "task number 1", "task number 12", "trains", "trains topic-3", "task number 412", ""];
const TYPED_QUERIES = ["task number 412", "trains topic-3", "task number 12"];

function taskLinksAppFor(index, app, files) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const reads = app.reads;
  return {
    reads,
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getMarkdownFiles: () => files.map((file) => ({ path: file.path, extension: "md", stat: file.stat })),
      getAbstractFileByPath: (notePath) => {
        const file = byPath.get(notePath);
        return file ? { path: file.path, extension: "md", stat: file.stat } : null;
      },
      read: async (file) => {
        reads.push(`read:${file.path}`);
        const found = byPath.get(file.path);
        return found ? found.content : null;
      },
      cachedRead: async (file) => {
        reads.push(file.path);
        const found = byPath.get(file.path);
        return found ? found.content : null;
      },
      process: async () => { throw new Error("no writes in perf gate"); },
      modify: async () => { throw new Error("no writes in perf gate"); },
      on: () => ({}),
    },
    metadataCache: {
      getFileCache: () => null,
      getFirstLinkpathDest: (target) => ({ path: `${target}.md` }),
      on: () => ({}),
    },
  };
}

function taskLinksPluginFor(index, perfApp) {
  const plugin = {
    app: perfApp,
    taskWikilinkIndex: index,
    ensureTaskWikilinkIndex: () => index,
    activeTaskLinksSessions: new Set(),
    suppressEditorScans: () => {},
    now: () => new Date(2026, 10, 22, 14, 30),
  };
  return plugin;
}

async function warmedSession() {
  const built = await coldBuildTimed(6500, { yieldAfterMs: 1 });
  assert.ok(built.result.total >= 5000, `expected 5,000+ tasks, saw ${built.result.total}`);
  const perfApp = taskLinksAppFor(built.index, built.app, built.files);
  const plugin = taskLinksPluginFor(built.index, perfApp);
  const api = helpers.createTaskLinksApi(plugin);
  return { built, perfApp, plugin, api };
}

function p95(samples) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[Math.max(0, at)];
}

test("api.taskLinks session open (snapshot plus first rank) takes at most 50 ms", async (t) => {
  const { api, perfApp } = await warmedSession();
  perfApp.reads.length = 0;
  let ranked = null;
  const { best: ms } = await bestOf(async () => {
    const start = cpuTimeMs();
    const session = api.open({ sourcePath: "sase.md", subjects: [] });
    try {
      ranked = session.rank("");
      for (const row of ranked.rows.slice(0, 3)) assert.ok(Array.isArray(row.titleParts));
      return cpuTimeMs() - start;
    } finally {
      session.close();
    }
  }, 5);
  assert.ok(ranked.rows.length >= 5000, "first rank returns every task");
  assert.equal(ranked.total, ranked.rows.length);
  t.diagnostic(`session open: ${ms.toFixed(2)} ms`);
  assert.ok(ms <= OPEN_BUDGET_MS, `session open ${ms.toFixed(1)} ms exceeds ${OPEN_BUDGET_MS} ms`);
});

test("api.taskLinks keystroke-to-rows p95 takes at most 12 ms over 5,000 tasks", async (t) => {
  const { api } = await warmedSession();
  const session = api.open({ sourcePath: "sase.md", subjects: [] });
  try {
    // Warm the rank path (title parts, guards, groups) before sampling.
    for (const query of QUERIES) session.rank(query);
    const samples = [];
    for (const query of QUERIES) {
      const { best, samples: attempts } = await bestOf(async () => {
        const start = cpuTimeMs();
        const result = session.rank(query);
        for (const row of result.rows.slice(0, 3)) assert.ok(Array.isArray(row.titleParts));
        assert.ok(Array.isArray(result.rows), `rank(${JSON.stringify(query)}) returns rows`);
        assert.ok("total" in result && "indexing" in result, "API shape stays { rows, total, indexing }");
        return cpuTimeMs() - start;
      }, 5);
      void best;
      samples.push(...attempts);
      await delay(5);
    }
    const value = p95(samples);
    t.diagnostic(`keystroke p95: ${value.toFixed(2)} ms`);
    assert.ok(value <= KEYSTROKE_BUDGET_MS, `keystroke p95 ${value.toFixed(1)} ms exceeds ${KEYSTROKE_BUDGET_MS} ms`);
  } finally {
    session.close();
  }
});

test("api.taskLinks performs no vault reads while filtering", async () => {
  const { api, perfApp } = await warmedSession();
  const session = api.open({ sourcePath: "sase.md", subjects: [] });
  try {
    perfApp.reads.length = 0;
    for (const query of QUERIES) session.rank(query);
    for (const query of TYPED_QUERIES) {
      for (let end = 1; end <= query.length; end += 1) {
        const result = session.rank(query.slice(0, end));
        for (const row of result.rows.slice(0, 3)) assert.ok(Array.isArray(row.titleParts));
      }
    }
    assert.equal(perfApp.reads.length, 0, `expected zero vault reads, saw ${perfApp.reads.length}`);
  } finally {
    session.close();
  }
});

test("api.taskLinks typed keystrokes p95 takes at most 12 ms over 5,000 tasks", async (t) => {
  const { api } = await warmedSession();
  const samples = [];
  for (const query of TYPED_QUERIES) {
    const minima = new Array(query.length).fill(Infinity);
    // As in bestOf, retain the least noisy CPU sample, but every attempt
    // types into a fresh session: no warm per-term cache can hide scoring.
    for (let run = 0; run < 5; run += 1) {
      const session = api.open({ sourcePath: "sase.md", subjects: [] });
      try {
        for (let end = 1; end <= query.length; end += 1) {
          const start = cpuTimeMs();
          const result = session.rank(query.slice(0, end));
          for (const row of result.rows.slice(0, 3)) assert.ok(Array.isArray(row.titleParts));
          const elapsed = cpuTimeMs() - start;
          minima[end - 1] = Math.min(minima[end - 1], elapsed);
        }
      } finally {
        session.close();
      }
      await delay(5);
    }
    samples.push(...minima);
  }
  const value = p95(samples);
  t.diagnostic(`typed keystroke p95: ${value.toFixed(2)} ms`);
  assert.ok(value <= KEYSTROKE_BUDGET_MS, `typed keystroke p95 ${value.toFixed(1)} ms exceeds ${KEYSTROKE_BUDGET_MS} ms`);
});
