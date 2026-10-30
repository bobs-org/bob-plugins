// Bob Command Mode: run records, receipts, retention, and reload adoption.

function cmRunsDir(env, options = {}) {
  const root = cmStateRoot(env, options.osModule);
  const pathModule = options.pathModule || null;
  const join = pathModule && typeof pathModule.join === "function"
    ? (parts) => pathModule.join(...parts)
    : (parts) => parts.join("/");
  return join([root, "bob-cli", "command-mode", "runs"]);
}

function cmEnsureRunsDir(fsModule, runsDir) {
  fsModule.mkdirSync(runsDir, { recursive: true, mode: 0o700 });
  try {
    fsModule.chmodSync(runsDir, 0o700);
  } catch (error) {
    // Best effort: the directory already exists with usable permissions.
  }
}

function cmRunFilePaths(runsDir, runId, pathModule) {
  const join = pathModule && typeof pathModule.join === "function"
    ? (name) => pathModule.join(runsDir, name)
    : (name) => runsDir + "/" + name;
  return {
    out: join(runId + ".out"),
    err: join(runId + ".err"),
    json: join(runId + ".json"),
    receipt: join(runId + ".rc"),
  };
}

function cmNewRecord(options = {}) {
  return {
    schema: CM_RECORD_SCHEMA,
    id: String(options.id || ""),
    argv: Array.isArray(options.argv) ? [...options.argv] : [],
    entry_id: options.entryId || null,
    title: options.title || null,
    effect: cmNormalizeEffect(options.effect),
    presentation: cmNormalizePresentation(options.presentation),
    preview: Boolean(options.preview),
    trigger: options.trigger || "sheet",
    bob_path: options.bobPath || "",
    bob_version: options.bobVersion || null,
    host: options.host || null,
    started_at: options.startedAt || cmIsoNow(options.nowMs),
    finished_at: null,
    duration_ms: null,
    pid: typeof options.pid === "number" ? options.pid : null,
    exit_code: null,
    signal: null,
    outcome: "running",
    overdue: false,
    summary: null,
    interleave: [],
    truncated: false,
  };
}

// Atomically persist the record: tmp file in the same directory, then rename.
// Files are owner-only (0600); the plugin is the only writer.
function cmWriteRecord(fsModule, runsDir, record) {
  cmEnsureRunsDir(fsModule, runsDir);
  const paths = cmRunFilePaths(runsDir, record.id);
  const tmp = paths.json + ".tmp-" + process.pid;
  fsModule.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  try {
    fsModule.chmodSync(tmp, 0o600);
  } catch (error) {
    // Best effort.
  }
  fsModule.renameSync(tmp, paths.json);
  return paths.json;
}

function cmReadJsonFile(fsModule, filePath) {
  try {
    return JSON.parse(fsModule.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

function cmReadReceipt(fsModule, receiptPath) {
  const doc = cmReadJsonFile(fsModule, receiptPath);
  if (!doc || typeof doc !== "object") return null;
  if (doc.schema_version !== 1) return null;
  if (typeof doc.exit_code !== "number") return null;
  return doc;
}

function cmListRecords(fsModule, runsDir) {
  let names;
  try {
    names = fsModule.readdirSync(runsDir);
  } catch (error) {
    return [];
  }
  const records = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const record = cmReadJsonFile(fsModule, runsDir + "/" + name);
    if (record && typeof record.id === "string") records.push(record);
  }
  records.sort((left, right) => String(left.started_at || "").localeCompare(String(right.started_at || "")));
  return records;
}

function cmIsUnfinishedOutcome(outcome) {
  return outcome === "queued" || outcome === "running";
}

// Without a receipt, a run becomes `unknown — log preserved` at
// started_at + 2 × budget. Budgets are seconds in the catalog.
function cmAdoptionDeadlineMs(record, budgetSecs) {
  const started = Date.parse(record && record.started_at);
  const budget = Number(budgetSecs);
  if (!Number.isFinite(started)) return null;
  if (!Number.isFinite(budget) || budget <= 0) return started + 2 * 60 * 1000;
  return started + 2 * budget * 1000;
}

// Retention keeps the newest keepN runs and anything younger than keepDays,
// never deleting an unfinished run. Returns the removed record ids.
function cmRetentionSweep(fsModule, runsDir, options = {}) {
  const keepN = Number.isFinite(Number(options.keepRuns)) ? Math.max(0, Number(options.keepRuns)) : CM_DEFAULT_KEEP_RUNS;
  const keepDays = Number.isFinite(Number(options.keepDays)) ? Math.max(0, Number(options.keepDays)) : CM_DEFAULT_KEEP_DAYS;
  const nowMs = typeof options.nowMs === "number" ? options.nowMs : Date.now();
  const cutoffMs = nowMs - keepDays * 24 * 60 * 60 * 1000;
  const records = cmListRecords(fsModule, runsDir);
  const keepIds = new Set();
  for (const record of records.slice(-keepN)) keepIds.add(record.id);
  const removed = [];
  for (const record of records) {
    if (keepIds.has(record.id)) continue;
    if (cmIsUnfinishedOutcome(record.outcome)) continue;
    const started = Date.parse(record.started_at);
    if (Number.isFinite(started) && started >= cutoffMs) continue;
    for (const suffix of [".json", ".out", ".err", ".rc"]) {
      try {
        fsModule.unlinkSync(runsDir + "/" + record.id + suffix);
      } catch (error) {
        // A missing sidecar is fine; the sweep continues.
      }
    }
    removed.push(record.id);
  }
  return removed;
}

// User-facing argv for a stored run: drop a leading bob binary when the
// record actually stored one. Queued and spawn-failed records keep bare args.
function cmRecordArgs(record) {
  const argv = Array.isArray(record && record.argv) ? [...record.argv] : [];
  if (!argv.length) return argv;
  const first = String(argv[0] || "");
  if (!first) return argv;
  const bobPath = record && record.bob_path ? String(record.bob_path) : "";
  if (first === "bob" || (bobPath && first === bobPath) || /(?:^|\/)bob$/.test(first)) {
    return argv.slice(1);
  }
  return argv;
}

function cmDropLeadingWords(words, prefix) {
  const list = Array.isArray(words) ? [...words] : [];
  const head = Array.isArray(prefix) ? prefix.map(String) : [];
  if (!head.length) return list;
  for (let index = 0; index < head.length; index += 1) {
    if (String(list[index] || "") !== head[index]) return list;
  }
  return list.slice(head.length);
}

// Inverse of cmAssembleArgv: path + preview + fixed + user args. Preview
// flags drop only when this record was itself a preview, so a real run whose
// user args include `--dry-run` replays unchanged.
function cmReplayRun(record, catalog) {
  const words = cmRecordArgs(record);
  const entry = record && record.entry_id ? cmEntryById(catalog, record.entry_id) : null;
  const path = entry && Array.isArray(entry.path) ? entry.path : [];
  if (!entry || !path.length || path.some((word, index) => words[index] !== word)) {
    return { argv: words, preview: false, entryId: null };
  }
  let rest = words.slice(path.length);
  if (record && record.preview) rest = cmDropLeadingWords(rest, entry.preview);
  rest = cmDropLeadingWords(rest, entry.fixed);
  return {
    argv: [...path, ...rest],
    preview: Boolean(record && record.preview),
    entryId: entry.id,
  };
}
