#!/usr/bin/env node
// Developer diagnostic for Task Wikilink Index CPU stages. Not part of
// npm test. Shares the performance-test fixture and sampler, reports
// raw samples plus min/median/max, and includes the cold-build tail
// after the last yield. Optional --load N owns and reaps N short-lived
// CPU workers for a bounded contention comparison.

const { writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const support = require("./task-wikilink-index-perf-support.cjs");

const {
  helpers,
  SNAPSHOT_BUDGET_MS,
  KEYSTROKE_BUDGET_MS,
  CHUNK_BUDGET_MS,
  COLD_BUILD_BUDGET_MS,
  cpuTimeMs,
  delay,
  summarize,
  coldBuildTimed,
  settleRankPath,
  collectHostMeta,
  memoryDelta,
} = support;

function argValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

const NOTE_COUNT = Number(argValue("--notes", "6500"));
const WARMUP = Number(argValue("--warmup", "2"));
const SAMPLES = Number(argValue("--samples", "7"));
const LOAD_WORKERS = Number(argValue("--load", "0"));
const OUT_PATH = argValue("--out", null);

function startLoadWorkers(count) {
  const workers = [];
  for (let i = 0; i < count; i += 1) {
    workers.push(
      spawn(
        process.execPath,
        [
          "-e",
          "let n=0; const stop=Date.now()+120000; while(Date.now()<stop){ n+=Math.sqrt(n+1); } process.exit(0);",
        ],
        { stdio: "ignore" },
      ),
    );
  }
  return workers;
}

function stopLoadWorkers(workers) {
  for (const worker of workers) {
    if (!worker.killed) {
      worker.kill("SIGTERM");
    }
  }
}

async function sampleOperation(label, warmup, samples, run) {
  for (let i = 0; i < warmup; i += 1) {
    await run();
  }
  const values = [];
  const heaps = [];
  for (let i = 0; i < samples; i += 1) {
    if (global.gc) {
      global.gc();
    }
    const beforeMem = process.memoryUsage();
    const start = cpuTimeMs();
    await run();
    const elapsed = cpuTimeMs() - start;
    values.push(elapsed);
    heaps.push(memoryDelta(beforeMem, process.memoryUsage()));
    await delay(10);
  }
  return { label, ...summarize(values), heapDeltas: heaps };
}

async function main() {
  const workers = LOAD_WORKERS > 0 ? startLoadWorkers(LOAD_WORKERS) : [];
  const report = {
    host: collectHostMeta(),
    source: {
      support: module.filename,
      notes: NOTE_COUNT,
      warmup: WARMUP,
      samples: SAMPLES,
      loadWorkers: LOAD_WORKERS,
      exposeGc: typeof global.gc === "function",
    },
    budgets: {
      coldBuildMs: COLD_BUILD_BUDGET_MS,
      chunkMs: CHUNK_BUDGET_MS,
      snapshotMs: SNAPSHOT_BUDGET_MS,
      keystrokeMs: KEYSTROKE_BUDGET_MS,
    },
    stages: {},
  };
  try {
    const built = await coldBuildTimed(NOTE_COUNT, { yieldAfterMs: 1 });
    report.stages.coldBuild = {
      cpuMs: built.cpuMs,
      chunks: built.chunks.length,
      worstScheduledChunkMs: Math.max(0, ...built.chunkCpuMs),
      tailCpuMs: built.tailCpuMs,
      worstIncludingTailMs: Math.max(0, ...built.chunkCpuMsIncludingTail),
      scheduledChunkSamples: built.chunkCpuMs,
      note: "scheduledChunkSamples omit the last tail after the final yield; worstIncludingTailMs adds it.",
    };

    const stored = [];
    for (const entry of built.index.entries.values()) {
      stored.push(...entry.rows);
    }
    report.source.storedRows = stored.length;

    report.stages.decorateRows = await sampleOperation(
      "decorateRows",
      WARMUP,
      SAMPLES,
      () => stored.map((row) => built.index.decorateRow(row)),
    );

    let decorated = stored.map((row) => built.index.decorateRow(row));
    report.stages.canonicalOrder = await sampleOperation(
      "canonicalOrder",
      WARMUP,
      SAMPLES,
      () => helpers.orderForWikilinkPicker(decorated, "", null),
    );

    settleRankPath(decorated);
    report.stages.queryRank = await sampleOperation(
      "queryRank",
      WARMUP,
      SAMPLES,
      () => helpers.orderForWikilinkPicker(decorated, "task number", null),
    );

    const stats = new Map(built.files.map((file) => [file.path, file.stat]));
    const overlayFile = built.files.find((file) => file.content.includes("#task")) || built.files[0];
    const overlayText = overlayFile.content.replace("#task Task number", "#task Live overlay");
    settleRankPath(built.index.snapshot({}).rows);
    report.stages.snapshotPlusOrder = await sampleOperation(
      "snapshotPlusOrderLinearStat",
      WARMUP,
      5,
      () => {
        const snap = built.index.snapshot({});
        return helpers.orderForWikilinkPicker(snap.rows, "trains", null);
      },
    );
    report.stages.snapshotMapStatOverlay = await sampleOperation(
      "snapshotMapStatOverlay",
      WARMUP,
      5,
      () => {
        const snap = built.index.snapshot({
          ownerPath: overlayFile.path,
          overlays: { [overlayFile.path]: overlayText },
          statOf: (path) => stats.get(path) || null,
        });
        return helpers.orderForWikilinkPicker(snap.rows, "trains", overlayFile.path);
      },
    );
    report.stages.warmRankFromSnapshot = await sampleOperation(
      "warmRankFromSnapshot",
      WARMUP,
      SAMPLES,
      () => helpers.orderForWikilinkPicker(built.index.snapshot({}).rows, "task number", null),
    );

    const first = decorated[0];
    if (first) {
      const cached = first.loweredSearchFields;
      const uncached = helpers.loweredTaskWikilinkSearchFields(
        Object.assign({}, first, { loweredSearchFields: undefined }),
      );
      const backend = helpers
        .taskWikilinkSearchFields(first)
        .map((field) => String(field).toLowerCase())
        .sort();
      report.cache = {
        searchTextFirst: cached && cached[0] === String(first.searchText).toLowerCase(),
        setEqualsBackend: JSON.stringify([...cached].sort()) === JSON.stringify(backend),
        orderEqualsUncached: JSON.stringify(cached) === JSON.stringify(uncached),
        cachedFields: cached,
        uncachedFields: uncached,
      };
    }
  } finally {
    stopLoadWorkers(workers);
  }

  const text = JSON.stringify(report, null, 2);
  if (OUT_PATH) {
    writeFileSync(OUT_PATH, `${text}\n`);
  }
  process.stdout.write(`${text}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
