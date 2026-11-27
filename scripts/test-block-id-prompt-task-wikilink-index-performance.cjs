// Task Wikilink Index CPU-performance test: CPU time avoids charging
// scheduler preemption to index work. The budgets from phase
// `index` of plan 202610/obsidian_task_wikilinks.md, in the style of
// `test-navigation-dependencies-stage-performance.cjs`.
//
// npm test runs this file only in the serial `test:perf` stage after
// the parallel `test:unit` pass. process.cpuUsage includes V8 helper
// threads, so overlapping allocation-heavy siblings inflate the
// snapshot budget even when main-thread CPU stays well under 50 ms.
// The cold-chunk gate uses the same pattern as cpu-work-perf-support.cjs:
// an untimed warmup settles JIT, then the best of several fresh-index
// builds measures chunk cost. That still catches a real overshoot because
// a broken yield exceeds 16 ms on every attempt; it only sheds helper-
// thread and cold-start noise that used to fail a quiet 2-3 ms wall chunk
// at 16.1-18.3 ms CPU (bob-cli-f8).
//
// A synthetic vault of 6,500 notes bearing 5,000 tasks proves:
// - the cold build completes in at most 1.5 s, in chunks of at most 16 ms;
// - a warm snapshot plus order takes at most 50 ms;
// - one keystroke's rank of 5,000 rows takes at most 12 ms;
// - no vault reads happen while filtering;
// - growth stays near-linear (a 6x step check).
//
// Fixture, sampler, and CPU clock live in
// `task-wikilink-index-perf-support.cjs` so the developer diagnostic
// can report per-stage samples without changing these budgets.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  COLD_BUILD_BUDGET_MS,
  CHUNK_BUDGET_MS,
  SNAPSHOT_BUDGET_MS,
  KEYSTROKE_BUDGET_MS,
  cpuClockSource,
  cpuTimeMs,
  delay,
  bestOf,
  worstChunkMs,
  coldBuildTimed,
  settleRankPath,
} = require("./task-wikilink-index-perf-support.cjs");

const COLD_CHUNK_WARMUPS = 1;
const COLD_CHUNK_SAMPLES = 7;

test("cold build of 6,500 notes / 5,000 tasks fits 1.5 s in chunks of at most 16 ms", async (t) => {
  // Untimed warmup settles JIT and inline caches for ingest/parse/yield.
  // Each timed build still constructs a fresh empty index: the store under
  // test stays cold; only the code is warm. Node v22.14 has no
  // process.threadCpuUsage, so cpuTimeMs falls back to process.cpuUsage and
  // charges V8 helper threads. A 2-3 ms wall chunk then reports 16.1-18.3 ms
  // CPU under the serial test:perf stage. Best-of-seven sheds that noise the
  // way cpu-work-perf-support.cjs does. A real chunker overshoot (yield bound
  // ignored, or one note's ingest over 16 ms) exceeds the budget on every
  // attempt, so the 16 ms ceiling still catches a regression.
  for (let warmup = 0; warmup < COLD_CHUNK_WARMUPS; warmup += 1) {
    await coldBuildTimed(6500, { yieldAfterMs: 1 });
  }
  const built = await coldBuildTimed(6500, { yieldAfterMs: 1 });
  assert.equal(built.result.total, 6500);
  assert.equal(built.result.scanned, 6500);
  assert.ok(built.chunks.length > 1, `expected chunked yields, saw ${built.chunks.length}`);
  const samples = [built];
  for (let attempt = 1; attempt < COLD_CHUNK_SAMPLES; attempt += 1) {
    await delay(10);
    samples.push(await coldBuildTimed(6500, { yieldAfterMs: 1 }));
  }
  const chunkSamples = samples.map((sample) => worstChunkMs(sample.chunkCpuMs));
  const worst = Math.min(...chunkSamples);
  t.diagnostic(
    `cold chunk ${worst.toFixed(2)} ms CPU (best of ${chunkSamples.length}: ${chunkSamples
      .map((sample) => sample.toFixed(2))
      .join(", ")} ms; budget ${CHUNK_BUDGET_MS} ms; clock ${cpuClockSource()})`,
  );
  assert.ok(
    worst <= CHUNK_BUDGET_MS,
    `worst chunk ${worst.toFixed(1)} ms exceeds ${CHUNK_BUDGET_MS} ms` +
      ` (best of ${chunkSamples.length}: ${chunkSamples
        .map((sample) => sample.toFixed(2))
        .join(", ")} ms; budget ${CHUNK_BUDGET_MS} ms; clock ${cpuClockSource()})`,
  );
  const cpuSamples = samples.map((sample) => sample.cpuMs);
  const ms = Math.min(...cpuSamples);
  t.diagnostic(
    `cold build ${ms.toFixed(1)} ms CPU (best of ${cpuSamples.length}: ${cpuSamples
      .map((sample) => sample.toFixed(1))
      .join(", ")} ms; budget ${COLD_BUILD_BUDGET_MS} ms)`,
  );
  assert.ok(ms <= COLD_BUILD_BUDGET_MS, `cold build ${ms.toFixed(1)} ms exceeds budget`);
  const taskRows = built.index.snapshot({}).rows;
  assert.ok(taskRows.length >= 5000, `expected 5,000+ rows, saw ${taskRows.length}`);
});

// The budgets below describe steady-state CPU costs after an untimed
// warmup of the rank path.
test("warm snapshot plus order takes at most 50 ms", async () => {
  const { index } = await coldBuildTimed(6500);
  settleRankPath(index.snapshot({}).rows);
  let ordered = null;
  const { best: ms } = await bestOf(async () => {
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
  const { best: ms } = await bestOf(async () => {
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
