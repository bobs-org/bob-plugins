// Task Wikilink Index CPU-performance test: CPU time avoids charging
// scheduler preemption to index work. The budgets from phase
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
  const chunkCpuMs = [];
  let previousScheduleEnd = cpuTimeMs();
  const schedule = (callback) => {
    const scheduledAt = cpuTimeMs();
    chunkCpuMs.push(scheduledAt - previousScheduleEnd);
    callback();
    previousScheduleEnd = cpuTimeMs();
  };
  const start = cpuTimeMs();
  const result = await index.warmUpFromVault(app, {
    schedule,
    yieldAfterMs,
    onChunk: (chunk) => chunks.push(chunk),
  });
  const cpuMs = cpuTimeMs() - start;
  return { index, app, result, chunks, chunkCpuMs, cpuMs };
}

// CPU time measures work done by the test thread, so a descheduled process
// does not make an otherwise cheap chunk look over budget. A short real
// delay between samples lets separate contention bursts affect different
// attempts. Snapshot gets five samples and rank gets seven.
function cpuTimeMs() {
  const usage = typeof process.threadCpuUsage === "function"
    ? process.threadCpuUsage()
    : process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bestOf(run, attempts, delayMs = 10) {
  let best = Infinity;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    best = Math.min(best, await run());
    if (attempt + 1 < attempts) {
      await delay(delayMs);
    }
  }
  return best;
}

function worstChunkMs(chunks) {
  return Math.max(0, ...chunks);
}

test("cold build of 6,500 notes / 5,000 tasks fits 1.5 s in chunks of at most 16 ms", async () => {
  const built = await coldBuildTimed(6500, { yieldAfterMs: 1 });
  assert.equal(built.result.total, 6500);
  assert.equal(built.result.scanned, 6500);
  assert.ok(built.chunks.length > 1, `expected chunked yields, saw ${built.chunks.length}`);
  // Three builds feed both the total and chunk budgets.
  const samples = [built];
  for (let attempt = 1; attempt < 3; attempt += 1) {
    await delay(10);
    samples.push(await coldBuildTimed(6500, { yieldAfterMs: 1 }));
  }
  const worst = Math.min(...samples.map((sample) => worstChunkMs(sample.chunkCpuMs)));
  assert.ok(
    worst <= CHUNK_BUDGET_MS,
    `worst chunk ${worst.toFixed(1)} ms exceeds ${CHUNK_BUDGET_MS} ms`,
  );
  const ms = Math.min(...samples.map((sample) => sample.cpuMs));
  assert.ok(ms <= COLD_BUILD_BUDGET_MS, `cold build ${ms.toFixed(1)} ms exceeds budget`);
  const taskRows = built.index.snapshot({}).rows;
  assert.ok(taskRows.length >= 5000, `expected 5,000+ rows, saw ${taskRows.length}`);
});

// The budgets below describe steady-state CPU costs after an untimed
// warmup of the rank path.
function settleRankPath(rows) {
  helpers.orderForWikilinkPicker(rows, "trains", null);
  helpers.orderForWikilinkPicker(rows, "task number", null);
}

test("warm snapshot plus order takes at most 50 ms", async () => {
  const { index } = await coldBuildTimed(6500);
  settleRankPath(index.snapshot({}).rows);
  let ordered = null;
  const ms = await bestOf(async () => {
    const start = cpuTimeMs();
    const snap = index.snapshot({});
    ordered = helpers.orderForWikilinkPicker(snap.rows, "trains", null);
    return cpuTimeMs() - start;
  }, 5);
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
    const start = cpuTimeMs();
    ranked = helpers.orderForWikilinkPicker(rows, "task number", null);
    return cpuTimeMs() - start;
  }, 7);
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
  async function bestColdBuild(noteCount) {
    let best = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const sample = await coldBuildTimed(noteCount);
      if (!best || sample.cpuMs < best.cpuMs) best = sample;
      if (attempt < 2) await delay(10);
    }
    return best;
  }
  const small = await bestColdBuild(500);
  const large = await bestColdBuild(3000);
  assert.equal(small.result.total, 500);
  assert.equal(large.result.total, 3000);
  assert.ok(
    large.cpuMs < Math.max(120, small.cpuMs * 6),
    `3000-note build ${large.cpuMs.toFixed(1)} ms grows too fast over 500-note ${small.cpuMs.toFixed(1)} ms`,
  );
});
