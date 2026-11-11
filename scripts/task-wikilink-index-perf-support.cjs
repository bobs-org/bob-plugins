// Shared fixture and CPU sampler for the Task Wikilink Index
// performance tests and the developer diagnostic runner. Keep this
// module limited: the npm-test budgets still live in
// test-block-id-prompt-task-wikilink-index-performance.cjs.

const { helpers } = require("./block-id-prompt-harness.cjs");

const { TaskWikilinkIndex } = helpers;

const COLD_BUILD_BUDGET_MS = 1500;
const CHUNK_BUDGET_MS = 16;
const SNAPSHOT_BUDGET_MS = 50;
const KEYSTROKE_BUDGET_MS = 12;

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

function createPerfApp(files, { mapLookup = false } = {}) {
  const reads = [];
  const byPath = mapLookup ? new Map(files.map((file) => [file.path, file])) : null;
  return {
    reads,
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path) =>
        byPath ? byPath.get(path) || null : files.find((file) => file.path === path) || null,
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
  const { files, tasks } = syntheticVault(noteCount);
  const app = createPerfApp(files, options);
  const index = new TaskWikilinkIndex();
  index.emitThrottleMs = 0;
  return { index, app, files, tasks };
}

function cpuClockSource() {
  return typeof process.threadCpuUsage === "function" ? "threadCpuUsage" : "process.cpuUsage";
}

function cpuTimeMs() {
  const usage =
    typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bestOf(run, attempts, delayMs = 10) {
  let best = Infinity;
  const samples = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await run();
    samples.push(value);
    best = Math.min(best, value);
    if (attempt + 1 < attempts) {
      await delay(delayMs);
    }
  }
  return { best, samples };
}

function worstChunkMs(chunks) {
  return Math.max(0, ...chunks);
}

function summarize(samples) {
  if (!samples.length) {
    return { count: 0, min: null, median: null, max: null, samples: [] };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    count: samples.length,
    min: sorted[0],
    median,
    max: sorted[sorted.length - 1],
    samples,
  };
}

async function coldBuildTimed(noteCount, { yieldAfterMs = 12, mapLookup = false } = {}) {
  const { index, app, files, tasks } = buildIndex(noteCount, { mapLookup });
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
  // Work after the last yield (remaining files plus endBatch basename
  // rebuild) is in cpuMs but not in chunkCpuMs unless we add this tail.
  const tailCpuMs = cpuTimeMs() - previousScheduleEnd;
  return {
    index,
    app,
    files,
    tasks,
    result,
    chunks,
    chunkCpuMs,
    tailCpuMs,
    chunkCpuMsIncludingTail: [...chunkCpuMs, tailCpuMs],
    cpuMs,
  };
}

function settleRankPath(rows) {
  helpers.orderForWikilinkPicker(rows, "trains", null);
  helpers.orderForWikilinkPicker(rows, "task number", null);
}

function collectHostMeta() {
  let loadavg = null;
  try {
    loadavg = require("node:os").loadavg();
  } catch (error) {
    loadavg = null;
  }
  let cpuCount = null;
  try {
    cpuCount = require("node:os").cpus().length;
  } catch (error) {
    cpuCount = null;
  }
  let cpuModel = null;
  try {
    const cpus = require("node:os").cpus();
    cpuModel = cpus && cpus[0] ? cpus[0].model : null;
  } catch (error) {
    cpuModel = null;
  }
  return {
    hostname: require("node:os").hostname(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    v8: process.versions.v8,
    cpuClockSource: cpuClockSource(),
    cpuCount,
    cpuModel,
    loadavg,
    pid: process.pid,
    now: new Date().toISOString(),
  };
}

function memoryDelta(before, after) {
  return {
    rss: after.rss - before.rss,
    heapUsed: after.heapUsed - before.heapUsed,
    heapTotal: after.heapTotal - before.heapTotal,
    external: after.external - before.external,
  };
}

module.exports = {
  TaskWikilinkIndex,
  helpers,
  COLD_BUILD_BUDGET_MS,
  CHUNK_BUDGET_MS,
  SNAPSHOT_BUDGET_MS,
  KEYSTROKE_BUDGET_MS,
  syntheticVault,
  createPerfApp,
  buildIndex,
  cpuClockSource,
  cpuTimeMs,
  delay,
  bestOf,
  worstChunkMs,
  summarize,
  coldBuildTimed,
  settleRankPath,
  collectHostMeta,
  memoryDelta,
};
