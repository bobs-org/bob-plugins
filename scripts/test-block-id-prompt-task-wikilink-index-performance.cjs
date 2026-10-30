// Task Wikilink Index performance test: the budgets from phase
// `index` of plan 202610/obsidian_task_wikilinks.md, in the style of
// `test-navigation-dependencies-stage-performance.cjs`.
//
// A synthetic vault of 6,500 notes bearing 5,000 tasks proves:
// - the cold build completes in at most 1.5 s, in chunks of at most 16 ms;
// - a warm snapshot plus order takes at most 50 ms;
// - one keystroke's rank of 5,000 rows takes at most 12 ms;
// - no vault reads happen while filtering;
// - growth stays near-linear (a 6x step check).

const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./block-id-prompt-harness.cjs");

const { TaskWikilinkIndex } = helpers;

const COLD_BUILD_BUDGET_MS = 1500;
const CHUNK_BUDGET_MS = 16;
const SNAPSHOT_BUDGET_MS = 50;
const KEYSTROKE_BUDGET_MS = 12;

const syncSchedule = (callback) => callback();

// A realistic vault mix: most notes carry one task amid prose, some are
// prose-only, and a few are daily notes. Sizes stay small so the test
// measures index overhead, not string allocation.
function syntheticVault(noteCount) {
  const files = [];
  let tasks = 0;
  for (let i = 0; i < noteCount; i += 1) {
    const folder = i % 10 === 0 ? `areas/area-${i % 5}` : `notes/topic-${i % 50}`;
    const path = `${folder}/note-${i}.md`;
    const lines = [
      `# Note ${i}`,
      "",
      `Prose paragraph ${i} with enough words to resemble a real note body.`,
    ];
    if (i % 13 < 10) {
      const status = i % 7 === 0 ? "x" : i % 11 === 0 ? "/" : " ";
      lines.push(`- [${status}] #task Task number ${i} about Trains ^task-${i}`);
      tasks += 1;
    } else {
      lines.push("- a plain bullet with no task");
    }
    const content = `${lines.join("\n")}\n`;
    files.push({
      path,
      content,
      cache: null,
      stat: { mtime: 1000 + i, size: Buffer.byteLength(content, "utf8"), ctime: 1000 + i },
    });
  }
  return { files, tasks };
}

function createPerfApp(files) {
  const reads = [];
  return {
    reads,
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path) => files.find((file) => file.path === path) || null,
      cachedRead: async (file) => {
        reads.push(file.path);
        return file.content;
      },
      on: () => ({}),
    },
    metadataCache: {
      getFileCache: () => null,
      on: () => ({}),
    },
    workspace: {
      getLeavesOfType: () => [],
    },
  };
}

function buildIndex(noteCount, options = {}) {
  const { files } = syntheticVault(noteCount);
  const app = createPerfApp(files);
  const index = new TaskWikilinkIndex();
  index.emitThrottleMs = 0;
  return { index, app, files };
}

async function coldBuildTimed(noteCount, { yieldAfterMs = 12 } = {}) {
  const { index, app } = buildIndex(noteCount);
  const chunks = [];
  const start = process.hrtime.bigint();
  const result = await index.warmUpFromVault(app, {
    schedule: syncSchedule,
    yieldAfterMs,
    onChunk: (chunk) => chunks.push(chunk),
  });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { index, app, result, chunks, ms };
}

// Absolute timing budgets (cold total, chunk ceiling, snapshot,
// keystroke) are asserted on the BEST of several attempts: on a
// shared machine a scheduling stall can inflate any single
// wall-clock measurement several-fold, which is measurement error
// rather than a performance signal. A genuine algorithmic regression
// exceeds the budget on every attempt, so the signal survives; only
// the stall noise is filtered. The tightest budget (the 12 ms
// keystroke) gets five attempts, the roomier ones three. Relative
// assertions (near-linear growth) and the no-reads assertion need no
// such tolerance.
async function bestOf(run, attempts) {
  let best = Infinity;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    best = Math.min(best, await run());
  }
  return best;
}

function worstChunkMs(chunks) {
  let worst = 0;
  for (const chunk of chunks) {
    worst = Math.max(worst, chunk.chunkMs);
  }
  return worst;
}

test("cold build of 6,500 notes / 5,000 tasks fits 1.5 s in chunks of at most 16 ms", async () => {
  const built = await coldBuildTimed(6500, { yieldAfterMs: 1 });
  assert.equal(built.result.total, 6500);
  assert.equal(built.result.scanned, 6500);
  assert.ok(built.chunks.length > 1, `expected chunked yields, saw ${built.chunks.length}`);
  // One shared set of samples feeds both wall-clock assertions, so a
  // slow box costs three builds instead of six.
  const samples = [built];
  for (let attempt = 1; attempt < 3; attempt += 1) {
    samples.push(await coldBuildTimed(6500, { yieldAfterMs: 1 }));
  }
  const worst = Math.min(...samples.map((sample) => worstChunkMs(sample.chunks)));
  assert.ok(
    worst <= CHUNK_BUDGET_MS,
    `worst chunk ${worst.toFixed(1)} ms exceeds ${CHUNK_BUDGET_MS} ms`,
  );
  const ms = Math.min(...samples.map((sample) => sample.ms));
  assert.ok(ms <= COLD_BUILD_BUDGET_MS, `cold build ${ms.toFixed(1)} ms exceeds budget`);
  const taskRows = built.index.snapshot({}).rows;
  assert.ok(taskRows.length >= 5000, `expected 5,000+ rows, saw ${taskRows.length}`);
});

// The budgets below describe steady-state costs: a warm vault where
// V8 has already compiled the rank path (as it is after the first
// keystrokes in a real session). Each measurement warms up with
// untimed runs first, so one-time JIT/GC effects can't flake the
// assertion; a genuine algorithmic regression still exceeds the
// budget several times over.
function settleRankPath(rows) {
  helpers.orderForWikilinkPicker(rows, "trains", null);
  helpers.orderForWikilinkPicker(rows, "task number", null);
}

test("warm snapshot plus order takes at most 50 ms", async () => {
  const { index } = await coldBuildTimed(6500);
  settleRankPath(index.snapshot({}).rows);
  let ordered = null;
  const ms = await bestOf(async () => {
    const start = process.hrtime.bigint();
    const snap = index.snapshot({});
    ordered = helpers.orderForWikilinkPicker(snap.rows, "trains", null);
    return Number(process.hrtime.bigint() - start) / 1e6;
  }, 3);
  assert.ok(ordered.length > 0);
  assert.ok(ms <= SNAPSHOT_BUDGET_MS, `snapshot plus order ${ms.toFixed(1)} ms exceeds budget`);
});

test("one keystroke rank of 5,000 rows takes at most 12 ms", async () => {
  const { index } = await coldBuildTimed(6500);
  const rows = index.snapshot({}).rows;
  assert.ok(rows.length >= 5000, `expected 5,000+ rows, saw ${rows.length}`);
  settleRankPath(rows);
  let ranked = null;
  const ms = await bestOf(async () => {
    const start = process.hrtime.bigint();
    ranked = helpers.orderForWikilinkPicker(rows, "task number", null);
    return Number(process.hrtime.bigint() - start) / 1e6;
  }, 5);
  assert.ok(ranked.length > 0);
  assert.ok(ms <= KEYSTROKE_BUDGET_MS, `keystroke rank ${ms.toFixed(1)} ms exceeds budget`);
});

test("no vault reads happen while filtering", async () => {
  const { index, app } = await coldBuildTimed(6500);
  app.reads.length = 0;
  const snap = index.snapshot({});
  for (const query of ["task", "task number 12", "trains topic-3", ""]) {
    helpers.orderForWikilinkPicker(snap.rows, query, null);
  }
  assert.equal(app.reads.length, 0);
});

test("cold build growth stays near-linear over a 6x step", async () => {
  const small = await coldBuildTimed(500);
  const large = await coldBuildTimed(3000);
  assert.equal(small.result.total, 500);
  assert.equal(large.result.total, 3000);
  assert.ok(
    large.ms < Math.max(120, small.ms * 6),
    `3000-note build ${large.ms.toFixed(1)} ms grows too fast over 500-note ${small.ms.toFixed(1)} ms`,
  );
});
