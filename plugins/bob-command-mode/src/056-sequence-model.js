// Bob Command Mode: pure sequence steps, signatures, stamps, guards, and history.

const CM_SEQUENCE_TYPED_TITLE = "Run typed bob command";
const CM_SEQUENCE_HALT = new Set(["failed", "unknown", "stopped"]);

function cmSequenceStep(input) {
  const src = input && typeof input === "object" ? input : {};
  const argv = Array.isArray(src.argv) ? src.argv.map((word) => String(word)) : [];
  let entry_id = null;
  if (src.entry_id != null && src.entry_id !== "") entry_id = String(src.entry_id);
  else if (src.entryId != null && src.entryId !== "") entry_id = String(src.entryId);
  const title = src.title != null ? String(src.title) : null;
  return { argv, entry_id, title };
}

function cmSequenceStepSignature(step) {
  const stored = cmSequenceStep(step);
  return JSON.stringify([stored.argv, stored.entry_id]);
}

function cmSequenceSignature(steps) {
  const list = Array.isArray(steps) ? steps : [];
  return JSON.stringify(list.map(cmSequenceStepSignature));
}

function cmSequenceLookupEntry(step, catalog) {
  const stored = cmSequenceStep(step);
  if (stored.entry_id) {
    const named = cmEntryById(catalog, stored.entry_id);
    if (named) return named;
  }
  return cmFindEntryForArgv(catalog, stored.argv);
}

function cmSequenceStepDisplay(step, catalog) {
  const stored = cmSequenceStep(step);
  const entry = stored.entry_id ? cmEntryById(catalog, stored.entry_id) : null;
  if (!entry || !Array.isArray(entry.path) || !entry.path.length) {
    return [...stored.argv];
  }
  const userArgs = stored.argv.slice(entry.path.length);
  const fixed = Array.isArray(entry.fixed) ? entry.fixed : [];
  return [...entry.path, ...fixed, ...userArgs];
}

function cmSequenceUsableTitle(value) {
  const title = value == null ? "" : String(value);
  if (!title || title === CM_SEQUENCE_TYPED_TITLE) return null;
  return title;
}

function cmSequenceStepTitle(step, catalog) {
  const stored = cmSequenceStep(step);
  const entry = stored.entry_id ? cmEntryById(catalog, stored.entry_id) : null;
  const fromEntry = cmSequenceUsableTitle(entry && entry.title);
  if (fromEntry) return fromEntry;
  const fromStored = cmSequenceUsableTitle(stored.title);
  if (fromStored) return fromStored;
  const display = cmFormatArgv(cmSequenceStepDisplay(stored, catalog));
  return display || "bob";
}

function cmSequenceStamp(id, index0, steps, startedAtMs) {
  const list = Array.isArray(steps) ? steps.map(cmSequenceStep) : [];
  const index = Number(index0) + 1;
  return {
    id: String(id || ""),
    index: Number.isFinite(index) && index > 0 ? index : 1,
    total: list.length,
    started_at: cmIsoNow(startedAtMs),
    steps: list,
  };
}

function cmSequenceContinues(outcome) {
  return outcome === "completed" || outcome === "attention";
}

function cmSequenceGuards(steps, catalog) {
  const list = Array.isArray(steps) ? steps : [];
  const guards = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = cmSequenceLookupEntry(list[i], catalog);
    if (!entry) continue;
    if (entry.policy === "confirm") {
      guards.push({
        index: i + 1,
        kind: "confirm",
        text: entry.confirm || "This command needs confirmation.",
      });
    } else if (entry.policy === "preview-first") {
      guards.push({
        index: i + 1,
        kind: "preview-first",
        text: "applies without its preview",
      });
    }
  }
  return guards;
}

function cmSequenceStepsFromRecord(record) {
  const stamp = record && record.sequence;
  if (!stamp || typeof stamp !== "object" || !Array.isArray(stamp.steps)) return [];
  return stamp.steps.map(cmSequenceStep);
}

function cmSequenceCopyText(steps, catalog) {
  const list = Array.isArray(steps) ? steps : [];
  return list
    .map((step) => cmFormatArgv(["bob", ...cmSequenceStepDisplay(step, catalog)]))
    .join(" && ");
}

function cmSequenceActiveSet(options) {
  const raw = options && options.activeIds;
  if (!raw) return new Set();
  if (raw instanceof Set) return raw;
  if (Array.isArray(raw)) return new Set(raw.map(String));
  return new Set();
}

function cmSequenceRecordTime(record, field) {
  const raw = record && record[field];
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function cmSequenceHistory(records, options = {}) {
  const list = Array.isArray(records) ? records : [];
  const activeIds = cmSequenceActiveSet(options);
  const groups = new Map();
  const order = [];
  for (const record of list) {
    const stamp = record && record.sequence;
    if (!stamp || typeof stamp !== "object") continue;
    const id = String(stamp.id || "");
    if (!id) continue;
    let group = groups.get(id);
    if (!group) {
      const steps = Array.isArray(stamp.steps) ? stamp.steps.map(cmSequenceStep) : [];
      group = {
        id,
        signature: cmSequenceSignature(steps),
        steps,
        total: Number(stamp.total) || steps.length,
        started_at: stamp.started_at != null ? String(stamp.started_at) : "",
        members: [],
      };
      groups.set(id, group);
      order.push(group);
    } else if ((!group.steps || !group.steps.length) && Array.isArray(stamp.steps)) {
      group.steps = stamp.steps.map(cmSequenceStep);
      group.signature = cmSequenceSignature(group.steps);
      group.total = Number(stamp.total) || group.steps.length;
    }
    group.members.push(record);
  }
  const out = [];
  for (const group of order) {
    const total = Number(group.total) || (Array.isArray(group.steps) ? group.steps.length : 0);
    const byIndex = new Map();
    for (const record of group.members) {
      const index = Number(record && record.sequence && record.sequence.index);
      if (!Number.isFinite(index) || index < 1) continue;
      const previous = byIndex.get(index);
      if (!previous) {
        byIndex.set(index, record);
        continue;
      }
      const prevStarted = cmSequenceRecordTime(previous, "started_at") || 0;
      const nextStarted = cmSequenceRecordTime(record, "started_at") || 0;
      if (nextStarted >= prevStarted) byIndex.set(index, record);
    }
    const results = [];
    let stoppedAt = null;
    let haltOutcome = null;
    let sawAttention = false;
    let newestFinishedMs = null;
    let newestFinishedAt = null;
    for (let index = 1; index <= total; index += 1) {
      const record = byIndex.get(index) || null;
      if (!record) {
        results.push({ index, skipped: true });
        continue;
      }
      const outcome = record.outcome || "unknown";
      const row = {
        index,
        runId: record.id || null,
        outcome,
        reason: record.summary || null,
        durationMs: typeof record.duration_ms === "number" ? record.duration_ms : null,
      };
      results.push(row);
      const finishedMs = cmSequenceRecordTime(record, "finished_at");
      if (finishedMs != null && (newestFinishedMs == null || finishedMs >= newestFinishedMs)) {
        newestFinishedMs = finishedMs;
        newestFinishedAt = record.finished_at;
      }
      if (outcome === "attention") sawAttention = true;
      if (!haltOutcome && CM_SEQUENCE_HALT.has(outcome)) {
        haltOutcome = outcome;
        stoppedAt = index;
      }
    }
    const complete = results.every((row) => row && !row.skipped);
    let state;
    if (activeIds.has(group.id)) state = "running";
    else if (haltOutcome) state = haltOutcome;
    else if (complete) state = sawAttention ? "attention" : "completed";
    else state = "interrupted";
    const startedMs = Date.parse(group.started_at);
    const durationMs = Number.isFinite(startedMs) && newestFinishedMs != null
      ? Math.max(0, newestFinishedMs - startedMs)
      : null;
    out.push({
      id: group.id,
      signature: group.signature,
      steps: group.steps,
      total,
      state,
      outcome: state,
      stoppedAt: haltOutcome ? stoppedAt : null,
      results,
      records: Array.from({ length: total }, (_, i) => byIndex.get(i + 1) || null),
      started_at: group.started_at,
      startedAtMs: Number.isFinite(startedMs) ? startedMs : null,
      finished_at: newestFinishedAt,
      durationMs,
    });
  }
  out.sort((left, right) => {
    const a = left.startedAtMs || 0;
    const b = right.startedAtMs || 0;
    return b - a;
  });
  return out;
}

function cmSequenceFocusRunId(summaryOrGroup, catalog) {
  if (!summaryOrGroup || typeof summaryOrGroup !== "object") return null;
  const results = Array.isArray(summaryOrGroup.results) ? summaryOrGroup.results : [];
  const steps = Array.isArray(summaryOrGroup.steps) ? summaryOrGroup.steps : [];
  const records = Array.isArray(summaryOrGroup.records) ? summaryOrGroup.records : [];
  const stoppedAt = summaryOrGroup.stoppedAt;
  if (stoppedAt) {
    const hit = results.find((row) => row && Number(row.index) === Number(stoppedAt) && row.runId);
    if (hit) return hit.runId;
    const rec = records[Number(stoppedAt) - 1];
    if (rec && rec.id) return rec.id;
  }
  let lastReport = null;
  let last = null;
  const consider = (index, runId) => {
    if (!runId) return;
    last = runId;
    const step = steps[index - 1];
    const entry = cmSequenceLookupEntry(step, catalog);
    if (entry && entry.presentation === "report") lastReport = runId;
  };
  for (const row of results) {
    if (!row || row.skipped) continue;
    consider(Number(row.index) || 0, row.runId);
  }
  if (!last) {
    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      if (rec && rec.id) consider(i + 1, rec.id);
    }
  }
  return lastReport || last;
}
