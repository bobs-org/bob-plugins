const os = require("node:os");
const { performance } = require("node:perf_hooks");

function cpuClockSource() {
  return typeof process.threadCpuUsage === "function" ? "threadCpuUsage" : "process.cpuUsage";
}

function cpuTimeMs() {
  const usage =
    typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}

function sampleCpuWork(makeRun, { warmups = 3, samples = 7 } = {}) {
  for (let index = 0; index < warmups; index += 1) {
    makeRun()();
  }

  const cpuSamples = [];
  const wallSamples = [];
  for (let index = 0; index < samples; index += 1) {
    const run = makeRun();
    const cpuStart = cpuTimeMs();
    const wallStart = performance.now();
    run();
    wallSamples.push(performance.now() - wallStart);
    cpuSamples.push(cpuTimeMs() - cpuStart);
  }
  return { cpuSamples, wallSamples };
}

function isWithinCpuBudget(samples, budgetMs) {
  return samples.length > 0 && Math.min(...samples) < budgetMs;
}

function hostLoad() {
  try {
    return `${os.loadavg().map((value) => value.toFixed(1)).join("/")} on ${os.cpus().length} cpus`;
  } catch (error) {
    return "n/a";
  }
}

function cpuBudgetDiagnostic(name, cpuSamples, wallSamples, budgetMs) {
  const cpuMs = Math.min(...cpuSamples);
  const wallMs = Math.min(...wallSamples);
  return (
    `${name} took ${cpuMs.toFixed(2)} ms CPU` +
    ` (best of ${cpuSamples.length}: ${cpuSamples.map((sample) => sample.toFixed(2)).join(", ")} ms CPU;` +
    ` wall best ${wallMs.toFixed(2)} ms of ${wallSamples.map((sample) => sample.toFixed(2)).join(", ")} ms;` +
    ` budget ${budgetMs} ms; clock ${cpuClockSource()}; load ${hostLoad()})`
  );
}

module.exports = {
  cpuBudgetDiagnostic,
  cpuClockSource,
  cpuTimeMs,
  isWithinCpuBudget,
  sampleCpuWork,
};
