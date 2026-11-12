// Task Wikilink Index CPU-performance test: CPU time avoids charging
// scheduler preemption to index work. The budgets from phase
// `index` of plan 202610/obsidian_task_wikilinks.md, in the style of
// `test-navigation-dependencies-stage-performance.cjs`.
//
// npm test runs this file only in the serial `test:perf` stage after
// the parallel `test:unit` pass. process.cpuUsage includes V8 helper
// threads, so overlapping allocation-heavy siblings inflate the
// snapshot budget even when main-thread CPU stays well under 50 ms.
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
  cpuTimeMs,
  delay,
  bestOf,
  worstChunkMs,
  coldBuildTimed,
  settleRankPath,
} = require("./task-wikilink-index-perf-support.cjs");

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
