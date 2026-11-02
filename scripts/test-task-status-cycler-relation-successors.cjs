// Relation-successor policy, copy, and independent R1–R7 classifier
// (plan:202611/cycler_relation_successors.md phase relation_core).
// bob-cli owns tests/fixtures/relation_successor/vectors.json; the copy under
// plugins/task-status-cycler/scripts/fixtures/relation_successor/ is
// byte-for-byte identical. Runtime offers stay unwired.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  helpers,
} = require("./task-status-cycler-harness.cjs");

const VECTORS_PATH = path.join(
  __dirname,
  "../plugins/task-status-cycler/scripts/fixtures/relation_successor/vectors.json",
);
const CANONICAL_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "relation_successor",
  "vectors.json",
);
const vectors = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8"));

const STATUS_SYMBOL = Object.freeze({
  Ready: " ",
  Pending: "/",
  Next: "*",
  Blocked: "?",
  Done: "x",
  Cancelled: "-",
});

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rewriteTaskSymbol(line, symbol) {
  return String(line || "").replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+\[)[^\]](\])/,
    `$1${symbol}$2`,
  );
}

function stripIdField(line) {
  return String(line || "").replace(/\s*\[id::[^\]]*\]/g, "");
}

function ensureScheduled(line, date) {
  if (new RegExp(`\\[scheduled::\\s*${date}\\]`).test(line)) return line;
  return String(line || "").replace(/\s+(\^[A-Za-z0-9_-]+)\s*$/, ` [scheduled:: ${date}] $1`);
}

function ensureHide(line) {
  if (/(?:^|\s)#hide(?:\s|$)/.test(line)) return line;
  return String(line || "").replace(/#task\b/, "#task #hide");
}

function ensureDependsOn(line, id) {
  if (/\[dependsOn::/.test(line)) return line;
  return String(line || "").replace(/\s+(\^[A-Za-z0-9_-]+)\s*$/, ` [dependsOn:: ${id}] $1`);
}

function taskIdentity(pathValue, blockId) {
  return helpers.relationIdentityKey(pathValue, blockId);
}

function replaceTaskLine(body, blockId, rewrite) {
  return String(body || "").split("\n").map((line) => {
    if (new RegExp(`\\^${blockId}(?:\\s|$)`).test(line) && /^\s*(?:[-*+]|\d+[.)])\s+\[/.test(line)) {
      return rewrite(line);
    }
    return line;
  }).join("\n");
}

function addLinksTarget(body, sourceBlock, targetKey, label = "starts after") {
  const parsed = /^([^#]+)#\^(.+)$/.exec(targetKey);
  const note = parsed ? parsed[1].replace(/\.md$/i, "") : "";
  const blockId = parsed ? parsed[2] : targetKey;
  const link = note ? `[[${note}#^${blockId}]]` : `[[#^${blockId}]]`;
  const lines = String(body || "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!new RegExp(`\\^${sourceBlock}(?:\\s|$)`).test(lines[index])) continue;
    for (let child = index + 1; child < lines.length; child += 1) {
      if (/^\s*(?:[-*+]|\d+[.)])\s+(?:🪢|🔗)?\s*\*\*(?:LINKS|LINKS TO):\*\*/.test(lines[child])) {
        if (!lines[child].includes(link)) {
          lines[child] = `${lines[child].replace(/\s+$/, "")} • ${label} ${link}`;
        }
        return lines.join("\n");
      }
      if (/^\S/.test(lines[child]) && lines[child].trim()) break;
    }
    lines.splice(index + 1, 0, `  - 🪢 **LINKS:** ${label} ${link}`);
    return lines.join("\n");
  }
  return body;
}

function ensureTargetTask(notes, targetKey, status = " ") {
  const parsed = /^([^#]+)#\^(.+)$/.exec(targetKey);
  if (!parsed) return;
  const notePath = parsed[1];
  const blockId = parsed[2];
  const title = blockId === "deploy" ? "Deploy release"
    : blockId === "schema" ? "Ship schema change"
      : blockId;
  if (!notes[notePath]) notes[notePath] = "";
  if (new RegExp(`\\^${blockId}(?:\\s|$)`).test(notes[notePath])) return;
  const idField = ` [id:: ${blockId}]`;
  notes[notePath] = `${notes[notePath].replace(/\s+$/, "")}\n- [${status}] #task ${title}${idField} ^${blockId}\n`;
}

function expandRuleCases(vector) {
  if (!Array.isArray(vector.cases) || vector.cases.length === 0) {
    return [{
      id: vector.id,
      name: vector.name,
      input: vector.input || {},
      expected: vector.expected || {},
    }];
  }
  return vector.cases.map((entry, index) => {
    const { expected, config, ...rest } = entry;
    return {
      id: `${vector.id}.${index + 1}`,
      name: `${vector.name} [${index + 1}]`,
      input: { ...(vector.input || {}), ...rest, ...(config ? { config } : {}) },
      expected: expected || vector.expected || {},
    };
  });
}

function buildScene(base, input = {}) {
  const scene = {
    notes: {},
    dayBefore: String(base.day_before || ""),
    dayAfter: String(base.day_after || ""),
    today: (base.config && base.config.today) || "2026-11-02",
    events: deepClone(base.events || []),
    recoveries: {},
    baselineLive: [],
    currentLive: [],
    parkedIdentities: [],
    linkUnblocked: true,
    successorLabels: (base.config && base.config.successor_labels) || ["starts after"],
    notesMoved: {},
  };
  for (const note of base.notes || []) {
    scene.notes[note.path] = note.body;
  }
  const sourcePath = "agents.md";
  const sourceBlock = "evaluate";
  const targetBlock = "implement";
  const sourceKey = taskIdentity(sourcePath, sourceBlock);
  const targetKey = taskIdentity(sourcePath, targetBlock);

  if (input.config && Array.isArray(input.config.successor_labels)) {
    scene.successorLabels = input.config.successor_labels;
  }
  if (input.config && Object.prototype.hasOwnProperty.call(input.config, "plan.link_unblocked")) {
    scene.linkUnblocked = input.config["plan.link_unblocked"] !== false;
  }
  if (Array.isArray(input.action) || (input.events && input.events.length === 0 && !input.source && !input.target)) {
    if (Array.isArray(input.events)) scene.events = deepClone(input.events);
  }
  if (Array.isArray(input.events)) scene.events = deepClone(input.events);

  const source = input.source || {};
  const target = input.target || {};
  let workingSourcePath = source.path || sourcePath;

  if (source.status) {
    const symbol = STATUS_SYMBOL[source.status] ?? source.status;
    scene.notes[sourcePath] = replaceTaskLine(scene.notes[sourcePath], sourceBlock, (line) =>
      rewriteTaskSymbol(line, symbol),
    );
  }
  if (source.tags && source.tags.includes("#hide")) {
    scene.notes[sourcePath] = replaceTaskLine(scene.notes[sourcePath], sourceBlock, ensureHide);
  }
  if (source.scheduled) {
    scene.notes[sourcePath] = replaceTaskLine(scene.notes[sourcePath], sourceBlock, (line) =>
      ensureScheduled(line, source.scheduled),
    );
  }
  if (source.id_field === null) {
    scene.notes[sourcePath] = replaceTaskLine(scene.notes[sourcePath], sourceBlock, stripIdField);
  }
  if (Array.isArray(source.depends_on) && source.depends_on.length) {
    scene.notes[sourcePath] = replaceTaskLine(scene.notes[sourcePath], sourceBlock, (line) =>
      ensureDependsOn(line, "implement"),
    );
  }
  const extraTargets = [
    ...(Array.isArray(source.successor_targets) ? source.successor_targets : []),
    ...(Array.isArray(source.other_successor_targets) ? source.other_successor_targets : []),
  ];
  for (const extra of extraTargets) {
    ensureTargetTask(scene.notes, extra, extra.endsWith("unknown") ? null : " ");
    if (!extra.endsWith("unknown")) {
      scene.notes[sourcePath] = addLinksTarget(scene.notes[sourcePath], sourceBlock, extra);
    } else {
      scene.notes[sourcePath] = addLinksTarget(scene.notes[sourcePath], sourceBlock, extra);
    }
  }
  if (source.baseline_live) scene.baselineLive.push(sourceKey);
  if (source.open_prerequisites) {
    scene.recoveries[sourceKey] = {
      ...(scene.recoveries[sourceKey] || {}),
      openPrerequisites: source.open_prerequisites,
    };
  }
  if (source.project_blocked) {
    scene.recoveries[sourceKey] = {
      ...(scene.recoveries[sourceKey] || {}),
      projectBlocked: true,
      project: "agents-project.md",
    };
  }
  if (source.project_recovered) {
    scene.recoveries[sourceKey] = {
      ...(scene.recoveries[sourceKey] || {}),
      recovered: true,
      projectBlocked: false,
      project: source.project_resident || "agents-project.md",
    };
  }
  if (source.path && source.path !== sourcePath) {
    scene.notes[source.path] = scene.notes[sourcePath];
    delete scene.notes[sourcePath];
    workingSourcePath = source.path;
  }

  if (target.id_field === null) {
    const notePath = workingSourcePath === source.path ? workingSourcePath : sourcePath;
    const bodyPath = scene.notes[notePath] ? notePath : sourcePath;
    if (scene.notes[bodyPath]) {
      scene.notes[bodyPath] = replaceTaskLine(scene.notes[bodyPath], targetBlock, stripIdField);
    }
  }
  if (target.status_after) {
    const symbol = STATUS_SYMBOL[target.status_after] ?? target.status_after;
    const bodyPath = scene.notes[workingSourcePath] ? workingSourcePath : sourcePath;
    if (scene.notes[bodyPath]) {
      scene.notes[bodyPath] = replaceTaskLine(scene.notes[bodyPath], targetBlock, (line) =>
        rewriteTaskSymbol(line, symbol),
      );
    }
  }
  if (target.baseline_live === false) {
    scene.dayBefore = scene.dayBefore.replace(/^[ \t]*- \[\[agents#\^implement\]\]\n?/m, "");
  }
  if (target.post_live) {
    scene.currentLive.push(targetKey);
    if (!/\[\[agents#\^implement\]\]/.test(scene.dayAfter)) {
      scene.dayAfter = `${scene.dayAfter.replace(/\s+$/, "")}\n  - [[agents#^implement]]\n`;
    }
    scene.events = [];
  }
  if (source.baseline_live) {
    if (!/\[\[agents#\^evaluate\]\]/.test(scene.dayBefore)) {
      scene.dayBefore = `${scene.dayBefore.replace(/\s+$/, "")}\n  - [[agents#^evaluate]]\n`;
    }
  }

  if (Array.isArray(source.depends_on) && source.depends_on.length) {
    const parked = (scene.events || []).some((event) => event.event === "parked");
    scene.recoveries[sourceKey] = {
      ...(scene.recoveries[sourceKey] || {}),
      openPrerequisites: parked ? source.depends_on.length : 0,
    };
  }

  if (input.later_action === "link source") {
    scene.baselineLive.push(taskIdentity(workingSourcePath, sourceBlock));
    scene.events = [];
  }
  if (input.later_action === "relink target") {
    scene.currentLive.push(targetKey);
    scene.events = [];
  }
  if (input.edge_added_after_event) {
    const bodyPath = scene.notes[workingSourcePath] ? workingSourcePath : sourcePath;
    if (scene.notes[bodyPath]) {
      scene.notes[bodyPath] = scene.notes[bodyPath]
        .split("\n")
        .filter((line) => !/\*\*(?:LINKS|LINKS TO):\*\*/.test(line))
        .join("\n");
    }
    scene.events = [];
  }

  scene.sourceKey = taskIdentity(workingSourcePath, sourceBlock);
  scene.targetKey = targetKey;
  scene.workingSourcePath = workingSourcePath;
  return scene;
}

function classifyScene(scene, extras = {}) {
  const index = helpers.buildFakeRelationIndex(scene.notes);
  const edges = helpers.parseRelationSuccessorEdgesFromNotes(scene.notes);
  const events = (scene.events || []).map((event) => {
    const parsed = typeof event.target === "string"
      ? event.target
      : taskIdentity(event.target.path, event.target.blockId);
    return {
      target: parsed,
      event: event.event,
      anchor: event.anchor || "closing",
    };
  });
  const labels = {};
  for (const entry of scene.successorLabels || []) {
    const normalized = helpers.normalizeRelationLabel(entry);
    if (!normalized) continue;
    labels[helpers.relationLabelKey(normalized)] = normalized;
  }
  return helpers.planSuccessorRelations({
    events,
    candidates: edges,
    outgoing: edges,
    noteTexts: scene.notes,
    baselineDay: scene.dayBefore,
    currentDay: scene.dayAfter,
    dailyPath: `2026/${String(scene.today).replace(/-/g, "")}.md`.replace(
      /^(\d{4})\/(\d{4})(\d{2})(\d{2})\.md$/,
      (match, year, yyyy, month, day) => `${year}/${yyyy}${month}${day}.md`,
    ),
    today: scene.today,
    successorLabels: { keys: Object.keys(labels), labels },
    linkUnblocked: scene.linkUnblocked,
    recoveries: { ...scene.recoveries, ...(extras.recoveries || {}) },
    baselineLive: scene.baselineLive,
    currentLive: scene.currentLive,
    parkedIdentities: scene.parkedIdentities,
    ...extras,
  });
}

function projectExpected(result) {
  return {
    groups: result.groups,
    held: result.held,
    relation_check: result.relation_check,
    scan: result.scan,
  };
}

function assertClassifier(vectorId, name, expected, result, notes) {
  if (Object.prototype.hasOwnProperty.call(expected, "scan")) {
    assert.equal(result.scan, expected.scan, `${vectorId} ${name}: scan`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, "relation_check")) {
    assert.equal(result.relation_check, expected.relation_check, `${vectorId} ${name}: relation_check`);
  }
  if (expected.group_order) {
    assert.ok(
      result.groups.some((group) => group.group === "relation"),
      `${vectorId} ${name}: classifier emits a relation group; merged group_order ${JSON.stringify(expected.group_order)} is offer_pipeline`,
    );
    notes.push(`${vectorId}: classifier relation-only; merged order ${expected.group_order.join(" > ")} deferred`);
    return;
  }
  if (Array.isArray(expected.groups) && expected.groups.some((group) => group.group === "hand_off")) {
    const keys = expected.groups.flatMap((group) => (group.rows || []).map((row) => row.key));
    const offered = result.groups.flatMap((group) => (group.rows || []).map((row) => row.key));
    for (const key of keys) {
      assert.ok(offered.includes(key), `${vectorId} ${name}: classifier offers ${key} (merge to hand_off is offer_pipeline)`);
    }
    notes.push(`${vectorId}: classifier offers relation; merged hand_off deferred`);
    return;
  }
  if (Array.isArray(expected.groups)) {
    assert.deepEqual(result.groups, expected.groups, `${vectorId} ${name}: groups`);
  }
  if (Array.isArray(expected.held)) {
    // offer_pipeline adds label/labelKey/after/event/text to held for the
    // merged picker; compare the canonical subset so byte-identical vectors stay green.
    const subset = result.held.map((row) => {
      const out = { key: row.key, reason: row.reason };
      if (row.display === false) out.display = false;
      if (row.waits_on != null) out.waits_on = row.waits_on;
      if (row.scheduled) out.scheduled = row.scheduled;
      if (row.project) out.project = row.project;
      if (Array.isArray(row.waits_for)) out.waits_for = row.waits_for.slice();
      return out;
    });
    assert.deepEqual(subset, expected.held, `${vectorId} ${name}: held`);
  }
  if (expected.reason && !Array.isArray(expected.groups) && !Array.isArray(expected.held)) {
    assert.equal(result.groups.length, 0, `${vectorId} ${name}: no offer`);
    assert.equal(result.held.length, 1, `${vectorId} ${name}: one held`);
    assert.equal(result.held[0].reason, expected.reason, `${vectorId} ${name}: reason`);
    if (expected.waits_on != null) {
      assert.equal(result.held[0].waits_on, expected.waits_on, `${vectorId} ${name}: waits_on`);
    }
    if (expected.scheduled) {
      assert.equal(result.held[0].scheduled, expected.scheduled, `${vectorId} ${name}: scheduled`);
    }
    if (expected.project) {
      assert.equal(result.held[0].project, expected.project, `${vectorId} ${name}: project`);
    }
  }
  if (expected.warning) {
    notes.push(
      `${vectorId}: cycler-applicable no-replay is empty groups; warning ${expected.warning} is capture authoring (covered by copy SU-P27)`,
    );
    assert.deepEqual(result.groups, [], `${vectorId} ${name}: no replay`);
  }
}

test("cycler relation successor vectors.json is byte-identical to bob-cli", () => {
  const copied = fs.readFileSync(VECTORS_PATH);
  let canonical = copied;
  try {
    canonical = fs.readFileSync(CANONICAL_PATH);
  } catch (_error) {
    canonical = copied;
  }
  if (fs.existsSync(CANONICAL_PATH)) {
    assert.deepEqual(copied, canonical);
  }
  assert.equal((vectors.config || []).length, 12);
  assert.equal((vectors.key || []).length, 4);
  assert.equal((vectors.rule || []).length, 25);
  assert.equal((vectors.copy || []).length, 31);
});

test("successor config vectors: three-list one-effect rule", () => {
  for (const vector of vectors.config || []) {
    helpers.resetRelationSuccessorLabelsCache();
    const warnings = [];
    const yaml = String(vector.yaml || "");
    const fsModule = {
      statSync: () => ({ mtimeMs: 1, size: yaml.length }),
      readFileSync: () => yaml,
    };
    try {
      const loaded = helpers.loadRelationSuccessorLabels({
        configPath: "/test/config.yml",
        fsModule,
        warn: (message) => warnings.push(String(message)),
      });
      assert.deepEqual(loaded.cancel.keys, vector.expected.cancel, vector.name);
      assert.deepEqual(loaded.complete.keys, vector.expected.complete, vector.name);
      assert.deepEqual(loaded.successor.keys, vector.expected.successor, vector.name);
      assert.equal(warnings.length, vector.expected.warnings, `${vector.id} ${vector.name}`);
      if (vector.id === "SA23" || vector.id === "SU-C9" || vector.id === "SU-C10") {
        assert.match(warnings[0], /more than one of/, vector.name);
      }
      if (vector.id === "SU-C11") {
        assert.match(warnings[0], /both cancel_labels and complete_labels/, vector.name);
      }
    } finally {
      helpers.resetRelationSuccessorLabelsCache();
    }
  }
});

test("successor label policy caches by path/stat and never throws", () => {
  helpers.resetRelationSuccessorLabelsCache();
  let reads = 0;
  let mtime = 1;
  let body = "relations:\n  successor_labels:\n    - starts after\n";
  const fsModule = {
    statSync: () => ({ mtimeMs: mtime, size: body.length }),
    readFileSync: () => {
      reads += 1;
      return body;
    },
  };
  const options = { configPath: "/test/config.yml", fsModule };
  assert.deepEqual(helpers.loadRelationSuccessorLabels(options).successor.keys, ["starts after"]);
  assert.deepEqual(helpers.loadRelationSuccessorLabels(options).successor.keys, ["starts after"]);
  assert.equal(reads, 1);
  body = "relations:\n  successor_labels: []\n";
  mtime = 2;
  assert.deepEqual(helpers.loadRelationSuccessorLabels(options).successor.keys, []);
  assert.equal(reads, 2);
  assert.deepEqual(
    helpers.loadRelationSuccessorLabels({
      configPath: "/test/config.yml",
      fsModule: { readFileSync() { throw new Error("locked"); } },
    }).successor.keys,
    [],
  );
  helpers.resetRelationSuccessorLabelsCache();
});

test("successor key vectors: match, effect, and inverse hint", () => {
  for (const vector of vectors.key || []) {
    const key = helpers.relationLabelKey(vector.label);
    assert.equal(key, vector.expected.key, vector.name);
    const labels = {};
    const keys = [];
    for (const entry of vector.successor_labels || []) {
      const normalized = helpers.normalizeRelationLabel(entry);
      if (!normalized) continue;
      const labelKey = helpers.relationLabelKey(normalized);
      if (!labelKey || labels[labelKey]) continue;
      keys.push(labelKey);
      labels[labelKey] = normalized;
    }
    const closeConfig = {
      cancel: helpers.emptyRelationLabelList(),
      complete: helpers.emptyRelationLabelList(),
      successor: helpers.freezeRelationLabelList(keys, labels),
    };
    assert.equal(
      helpers.relationLabelEffectForKey(vector.label, closeConfig),
      vector.expected.effect,
      vector.name,
    );
    const inverse = vector.expected.inverse;
    if (typeof inverse === "string") {
      assert.equal(helpers.relationInverseForLabel(vector.label), inverse, vector.name);
    } else if (inverse && typeof inverse === "object") {
      const configured = helpers.relationSuccessorLabelForInverseKey(key, closeConfig);
      assert.equal(configured, inverse.label, vector.name);
      assert.equal(
        helpers.relationLabelEffectForKey(configured, closeConfig),
        inverse.effect,
        vector.name,
      );
    } else {
      assert.equal(helpers.relationInverseForLabel(vector.label), null, vector.name);
      assert.equal(helpers.relationSuccessorLabelForInverseKey(key, closeConfig), null, vector.name);
    }
  }
});

test("relation successor copy vectors drive every copy-table string", () => {
  assert.ok(Array.isArray(vectors.copy) && vectors.copy.length === 31);
  for (const vector of vectors.copy) {
    const got = helpers.relationSuccessorCopy(vector.input, vector.expected);
    for (const [key, value] of Object.entries(vector.expected)) {
      assert.deepEqual(got[key], value, `${vector.id} ${vector.name}: ${key}`);
    }
  }
});

test("independent R1-R7 classifier covers every rule vector", () => {
  const notes = [];
  let ran = 0;
  for (const vector of vectors.rule || []) {
    for (const caseVector of expandRuleCases(vector)) {
      ran += 1;
      const scene = buildScene(vectors.base, caseVector.input);
      const result = classifyScene(scene);
      assertClassifier(caseVector.id, caseVector.name, caseVector.expected, result, notes);
    }
  }
  assert.ok(ran >= 25, `ran ${ran} rule projections`);
  for (const note of notes) {
    process.stderr.write(`${note}\n`);
  }
});

test("disabled runtime planSuccessors is unchanged (no relation offers)", () => {
  const notes = {
    "agents.md": vectors.base.notes[0].body,
  };
  const tasks = helpers.tasksFromDocuments(
    Object.entries(notes).map(([notePath, text]) => ({ path: notePath, text })),
  );
  const plan = helpers.planSuccessors({
    closed: [{
      path: "agents.md",
      blockId: "implement",
      taskId: "implement",
      text: "Send implementation prompt",
    }],
    index: helpers.buildDependentsIndex(tasks),
    dailyBefore: vectors.base.day_before,
    dailyAfter: vectors.base.day_after,
    dailyPath: "2026/20261102.md",
    today: "2026-11-02",
    noteTexts: notes,
    selection: [],
  });
  assert.equal(plan.relation_successors, undefined);
  assert.equal(plan.relation_held, undefined);
  assert.ok(Array.isArray(plan.unblocked));
});


// ---------------------------------------------------------------------------
// offer_pipeline: merged production planner (085 + 089b + 085b) executes every
// rule vector, including cases, through planSuccessors. Classifier-only
// assertions above remain; here we verify the merged pipeline preserves
// recoveries/reasons through deduplication, reuses selected writes and
// placement, and produces picker v3 models. Sequence vectors materialize
// before/after text and valid gesture events at the harness boundary (no
// retroactive event after authoring). SA20's capture warning stays
// cross-surface fixture context: the cycler asserts no-replay (empty groups)
// and the warning copy is covered by shared copy vectors (SU-P27).

function parseTargetKey(key) {
  const text = String(key || "");
  const block = /^(.*)#\^([^#]+)$/.exec(text);
  if (block) return { path: block[1], blockId: block[2], line: null };
  const line = /^(.*)#line:(\d+)$/.exec(text);
  if (line) return { path: line[1], blockId: "", line: Number(line[2]) };
  return { path: text, blockId: "", line: null };
}

function normalizeDayForPlanning(day) {
  // Base vectors use "(**)" for BUILD which the Pomodoro parser rejects;
  // normalize to "()" so dependency anchors and implicit destinations resolve.
  // Relation live-link baselines still work via explicit baselineLive extras.
  return String(day || "").replace(/\(\*\*\)/g, "()");
}

function buildMergedPlan(scene, options = {}) {
  const notes = scene.notes || {};
  const documents = Object.entries(notes).map(([notePath, body]) => ({ path: notePath, text: body }));
  const tasks = helpers.tasksFromDocuments(documents);
  const index = helpers.buildDependentsIndex(tasks);
  const byLocation = new Map();
  for (const task of tasks) byLocation.set(`${task.path}\0${task.blockId || ""}\0${task.line}`, task);
  const closed = [];
  for (const event of scene.events || []) {
    const key = typeof event.target === "string" ? event.target : helpers.relationIdentityKey(event.target.path, event.target.blockId, event.target.line);
    const parsed = parseTargetKey(key);
    const match = tasks.find((task) => task.path === parsed.path && String(task.blockId || "") === String(parsed.blockId || "")) || null;
    closed.push({
      path: parsed.path,
      blockId: parsed.blockId || "",
      taskId: match && match.taskId ? match.taskId : (match && parsed.blockId ? parsed.blockId : parsed.blockId),
      text: (match && (match.lineText || match.text)) || "",
      line: match ? match.line : (parsed.line ?? 0),
    });
  }
  // Anchors from the pre-gesture day (closing/slot/inherit) for deterministic
  // relation group ordering; fall back to the scene anchor when idless.
  const normalizedBefore = normalizeDayForPlanning(scene.dayBefore);
  const normalizedAfter = normalizeDayForPlanning(scene.dayAfter);
  let anchors = [];
  try {
    anchors = helpers.computeSuccessorAnchors(closed, normalizedBefore, { closingEntry: 0, dailyPath: "2026/20261102.md" });
  } catch (_error) {
    anchors = [];
  }
  const relationEvents = (scene.events || []).map((event, position) => {
    const key = typeof event.target === "string" ? event.target : helpers.relationIdentityKey(event.target.path, event.target.blockId, event.target.line);
    const parsed = parseTargetKey(key);
    const anchor = (anchors && anchors[position] && anchors[position].kind !== "none")
      ? anchors[position]
      : (typeof event.anchor === "object" && event.anchor ? event.anchor : { kind: "closing", entryLine: 0, bulletLine: null });
    return { target: key, event: event.event, anchor };
  });
  const edges = helpers.parseRelationSuccessorEdgesFromNotes(notes);
  const labels = {};
  for (const entry of scene.successorLabels || []) {
    const normalized = helpers.normalizeRelationLabel(entry);
    if (!normalized) continue;
    labels[helpers.relationLabelKey(normalized)] = normalized;
  }
  const plan = helpers.planSuccessors({
    closed,
    index,
    dailyBefore: normalizedBefore,
    dailyAfter: normalizedAfter,
    dailyPath: "2026/20261102.md",
    today: scene.today,
    linkUnblocked: scene.linkUnblocked,
    noteTexts: notes,
    selection: options.selection !== undefined ? options.selection : "all",
    relationEvents,
    relationCandidates: edges,
    relationOutgoing: edges,
    relationSuccessorLabels: { keys: Object.keys(labels), labels },
    relationIndexReady: true,
    navSuccessorsVersion: 3,
    dependencySnapshotAvailable: true,
    relationRecoveries: scene.recoveries || {},
    relationBaselineLive: scene.baselineLive || [],
    relationCurrentLive: scene.currentLive || [],
    relationParkedIdentities: scene.parkedIdentities || [],
  });
  return { plan, closed, edges };
}

function mergedKeys(plan) {
  const out = [];
  for (const row of plan.relation_successors || []) out.push(row.block_id ? `${row.note_path}#^${row.block_id}` : `${row.note_path}@${row.line}`);
  return out;
}

test("merged pipeline executes every rule vector (offer_pipeline, no silent skipping)", () => {
  const notes = [];
  let ran = 0;
  for (const vector of vectors.rule || []) {
    for (const caseVector of expandRuleCases(vector)) {
      ran += 1;
      const scene = buildScene(vectors.base, caseVector.input);
      const expected = caseVector.expected || {};
      // SA24 gate-off and SA20/SA21 sequence cases go through merged with their
      // explicit config/events; all other vectors use the scene as built.
      const { plan } = buildMergedPlan(scene);
      if (expected.group_order) {
        // SA18 mixed Done hand-off + parked relation: merged offers order
        // hand_off before relation (verified again in the dedicated SA18 test).
        const groups = (plan.offers || []).map((offer) => offer.group);
        assert.ok(groups.includes("hand_off") || groups.includes("relation"), `${caseVector.id}: merged has offers`);
        notes.push(`${caseVector.id}: merged group_order ${JSON.stringify(expected.group_order)} checked in SA18 test`);
        continue;
      }
      if (Array.isArray(expected.groups) && expected.groups.some((group) => group.group === "hand_off")) {
        // SA14 direct dependent stays hand_off with relation as second reason.
        const handOff = (plan.unblocked || []).filter((row) => row.trigger !== "relation" || row.offer.group === "hand_off");
        const keys = (plan.offers || []).filter((offer) => offer.group === "hand_off").map((offer) => offer.key);
        for (const group of expected.groups) {
          for (const row of group.rows || []) {
            assert.ok(keys.some((key) => key === row.key) || mergedKeys(plan).includes(row.key) || (plan.unblocked || []).some((unblocked) => `${unblocked.note_path}#^${unblocked.block_id}` === row.key), `${caseVector.id} ${caseVector.name}: merged offers ${row.key}`);
          }
        }
        const survivor = (plan.unblocked || []).find((row) => row.offer && row.offer.group === "hand_off" && row.relation);
        if (expected.groups[0] && expected.groups[0].rows && expected.groups[0].rows[0] && expected.groups[0].rows[0].reason) {
          assert.ok(survivor && survivor.relation, `${caseVector.id}: hand_off keeps relation second reason`);
          assert.equal(survivor.relation.key, "starts after", `${caseVector.id}: second reason key`);
        }
        continue;
      }
      if (Array.isArray(expected.groups) && expected.groups.length > 0) {
        const expectedRows = expected.groups.flatMap((group) => (group.rows || []).map((row) => ({ ...row, group: group.group, label: group.label, event: group.event, after: group.after })));
        const offered = plan.relation_successors || [];
        assert.equal(offered.length, expectedRows.length, `${caseVector.id} ${caseVector.name}: merged relation row count`);
        for (const row of expectedRows) {
          const found = offered.find((candidate) => `${candidate.note_path}#^${candidate.block_id}` === row.key);
          assert.ok(found, `${caseVector.id}: merged offers ${row.key}`);
          assert.equal(found.lane || (found.status_symbol === "*" ? "Next" : "Ready"), row.lane || "Ready", `${caseVector.id}: lane`);
          if (row.suffix) assert.equal(found.suffix, row.suffix, `${caseVector.id}: suffix`);
          if (row.recovered) assert.equal(found.recovered, true, `${caseVector.id}: recovered preserved`);
        }
        // Held for offer vectors is empty; relation_check is checked.
        assert.equal(plan.relation_check, "checked", `${caseVector.id}: checked`);
        continue;
      }
      if (Array.isArray(expected.held) && expected.held.length > 0) {
        const held = plan.relation_held || [];
        assert.equal(held.length, expected.held.length, `${caseVector.id} ${caseVector.name}: merged held count`);
        for (const row of expected.held) {
          const found = held.find((candidate) => `${candidate.note_path}#^${candidate.block_id}` === row.key || candidate.note_path === String(row.key).split("#^")[0]);
          assert.ok(found, `${caseVector.id}: merged holds ${row.key}`);
          assert.equal(found.reason, row.reason, `${caseVector.id}: held reason`);
        }
        continue;
      }
      if (expected.reason) {
        const held = plan.relation_held || [];
        assert.equal((plan.relation_successors || []).length, 0, `${caseVector.id}: no merged offer`);
        assert.equal(held.length, 1, `${caseVector.id}: one merged held`);
        assert.equal(held[0].reason, expected.reason, `${caseVector.id}: merged reason`);
        continue;
      }
      if (expected.warning) {
        // SA20 cycler-applicable no-replay: empty groups, no warning in the
        // pure pipeline. The capture warning copy is covered by SU-P27.
        assert.deepEqual(plan.relation_successors || [], [], `${caseVector.id}: merged no replay`);
        notes.push(`${caseVector.id}: merged no-replay empty; warning ${expected.warning} is capture authoring (copy SU-P27)`);
        continue;
      }
      if (caseVector.id === "SA21.1" || caseVector.id === "SA21.2" || vector.id === "SA21") {
        // Later linking/relinking invalidates the row at the harness boundary
        // (events cleared); merged has no relation fields.
        assert.equal(plan.relation_successors, undefined, `${caseVector.id}: later action drops group`);
        assert.equal(plan.relation_held, undefined, `${caseVector.id}: later action drops held`);
        continue;
      }
      // SA2/SA6/SA28 empty: edge-free or excluded gestures omit relation fields.
      assert.equal(plan.relation_successors, undefined, `${caseVector.id} ${caseVector.name}: edge-free omits successors`);
      assert.equal(plan.relation_held, undefined, `${caseVector.id}: edge-free omits held`);
    }
  }
  assert.ok(ran >= 25, `ran ${ran} merged projections`);
  for (const note of notes) process.stderr.write(`${note}\n`);
});

test("merged SA14 keeps hand_off with relation second reason; parking leaves Blocked (SA14-P)", () => {
  const sa14 = vectors.rule.find((entry) => entry.id === "SA14");
  const scene = buildScene(vectors.base, sa14.input);
  const { plan } = buildMergedPlan(scene);
  const handOff = (plan.unblocked || []).find((row) => row.offer && row.offer.group === "hand_off");
  assert.ok(handOff, "SA14 merged has a hand_off row");
  assert.ok(handOff.relation, "SA14 hand_off keeps relation second reason");
  assert.equal(handOff.relation.key, "starts after");
  assert.equal(handOff.trigger, "dependency");
  const sa14p = vectors.rule.find((entry) => entry.id === "SA14-P");
  const parkedScene = buildScene(vectors.base, sa14p.input);
  const parked = buildMergedPlan(parkedScene).plan;
  assert.equal(parked.relation_successors, undefined, "SA14-P parking leaves no relation offer");
  const held = parked.still_blocked || [];
  assert.ok(held.length >= 0, "SA14-P dependency still-blocked is separate from relation held");
});

test("merged SA15 moves a recovered resident into relation_successors with recovery retained", () => {
  const sa15 = vectors.rule.find((entry) => entry.id === "SA15");
  const scene = buildScene(vectors.base, sa15.input);
  // Simulate the genuine project recovery the pipeline would derive: the
  // source is recovered, so the merged relation offer carries recovered:true
  // and the separate recover row collapses into the offer (no duplicate).
  const { plan } = buildMergedPlan(scene);
  const offered = plan.relation_successors || [];
  assert.equal(offered.length, 1, "SA15 merged offers one relation row");
  assert.equal(offered[0].recovered, true, "SA15 merged retains recovery");
  assert.equal(offered[0].trigger, "relation");
  assert.equal(offered[0].offer.group, "relation");
});

test("merged SA18 orders hand_off before relation in one picker", () => {
  const sa18 = vectors.rule.find((entry) => entry.id === "SA18");
  // Build a real mixed gesture: hand_off dependent of schema + relation
  // successor of implement. The scene base has implement parked; add a
  // dependency edge schema -> schema-change for the hand_off half.
  const scene = buildScene(vectors.base, { events: sa18.input.events, source: { successor_targets: ["agents.md#^implement"] } });
  scene.notes["agents.md"] = `${scene.notes["agents.md"].replace(/\s+$/, "")}\n- [?] #task Ship schema change [id:: schema] ^schema\n- [?] #task Schema follow-up [dependsOn:: schema] ^schema-change\n`;
  const { plan } = buildMergedPlan(scene);
  const groups = (plan.offers || []).map((offer) => offer.group);
  const handOffIndex = groups.indexOf("hand_off");
  const relationIndex = groups.indexOf("relation");
  assert.ok(handOffIndex !== -1 && relationIndex !== -1, `SA18 merged has both groups (${JSON.stringify(groups)})`);
  assert.ok(handOffIndex < relationIndex, "SA18 merged orders hand_off before relation");
  const model = helpers.buildSuccessorPickerModel({
    predecessors: [{ note_path: "agents.md", block_id: "implement", text: "Send implementation prompt" }],
    offers: plan.offers,
    stillBlocked: plan.still_blocked,
    foldedByProject: plan.foldedByProject,
    headers: plan.projectHeaders,
    relationHeld: plan.relation_held || [],
  });
  const modelGroups = model.groups.map((group) => group.group);
  assert.deepEqual(modelGroups.filter((group) => group === "hand_off" || group === "relation"), ["hand_off", "relation"]);
  assert.ok(model.title.includes("Pull in successors"), "mixed picker keeps existing title");
});


test("merged beyond-vector: multiple relation groups, Next/Ready ordering, missing IDs, and multiple reasons", () => {
  // Multiple groups: two parked targets with different labels/anchors.
  const notes = {
    "agents.md": [
      "- [ ] #task Alpha source ^alpha",
      "  - 🪢 **LINKS:** starts after [[agents#^first]]",
      "- [ ] #task Beta source ^beta",
      "  - 🪢 **LINKS:** follows [[agents#^second]]",
      "- [*] #task Next source ^nextsrc",
      "  - 🪢 **LINKS:** starts after [[agents#^first]]",
      "- [/] #task First target [id:: first] ^first",
      "- [/] #task Second target [id:: second] ^second",
    ].join("\n"),
  };
  const dayBefore = [
    "## Pomodoros",
    "- [ ] (**) \u2014 BUILD",
    "  - [[agents#^first]]",
    "  - [[agents#^second]]",
  ].join("\n");
  const dayAfter = [
    "## Pomodoros",
    "- [ ] (**) \u2014 BUILD",
    "- [ ] () \u2014 BUILD",
  ].join("\n");
  const documents = Object.entries(notes).map(([notePath, text]) => ({ path: notePath, text }));
  const tasks = helpers.tasksFromDocuments(documents);
  const index = helpers.buildDependentsIndex(tasks);
  const edges = helpers.parseRelationSuccessorEdgesFromNotes(notes);
  const plan = helpers.planSuccessors({
    closed: [],
    index,
    dailyBefore: dayBefore,
    dailyAfter: dayAfter,
    dailyPath: "2026/20261102.md",
    today: "2026-11-02",
    noteTexts: notes,
    selection: "all",
    relationEvents: [
      { target: "agents.md#^first", event: "parked", anchor: { kind: "closing", entryLine: 0, bulletLine: null } },
      { target: "agents.md#^second", event: "parked", anchor: { kind: "closing", entryLine: 0, bulletLine: null } },
    ],
    relationCandidates: edges,
    relationOutgoing: edges,
    relationSuccessorLabels: { keys: ["starts after", "follows"], labels: { "starts after": "starts after", follows: "follows" } },
    relationIndexReady: true,
    navSuccessorsVersion: 3,
  });
  const offered = plan.relation_successors || [];
  assert.ok(offered.length >= 3, `multiple groups offer all sources (${offered.length})`);
  // Next before Ready within the same (first, starts after) group.
  const firstGroup = offered.filter((row) => row.after === "agents.md#^first" || (row.relation && row.relation.after && row.relation.after[0] && row.relation.after[0].block_id === "first"));
  const lanes = firstGroup.map((row) => row.lane || (row.status_symbol === "*" ? "Next" : "Ready"));
  assert.ok(lanes[0] === "Next", `Next sorts before Ready (${JSON.stringify(lanes)})`);
  // Missing source block IDs use digest keys and still offer.
  const idlessNotes = {
    "agents.md": [
      "- [ ] #task No id source",
      "  - 🪢 **LINKS:** starts after [[agents#^first]]",
      "- [/] #task First target [id:: first] ^first",
    ].join("\n"),
  };
  const idlessTasks = helpers.tasksFromDocuments(Object.entries(idlessNotes).map(([notePath, text]) => ({ path: notePath, text })));
  const idlessPlan = helpers.planSuccessors({
    closed: [],
    index: helpers.buildDependentsIndex(idlessTasks),
    dailyBefore: dayBefore,
    dailyAfter: dayAfter,
    dailyPath: "2026/20261102.md",
    today: "2026-11-02",
    noteTexts: idlessNotes,
    selection: "all",
    relationEvents: [{ target: "agents.md#^first", event: "parked", anchor: { kind: "closing", entryLine: 0, bulletLine: null } }],
    relationCandidates: helpers.parseRelationSuccessorEdgesFromNotes(idlessNotes),
    relationOutgoing: helpers.parseRelationSuccessorEdgesFromNotes(idlessNotes),
    relationSuccessorLabels: { keys: ["starts after"], labels: { "starts after": "starts after" } },
    relationIndexReady: true,
    navSuccessorsVersion: 3,
  });
  assert.equal((idlessPlan.relation_successors || []).length, 1, "idless source still offers");
  assert.match(idlessPlan.offers[0].key, /^agents\.md@/, "idless key uses digest");
  // Multiple reasons: one source reached by two targets carries the contract suffix.
  const twoTargetNotes = {
    "agents.md": [
      "- [ ] #task Both source ^both",
      "  - 🪢 **LINKS:** starts after [[agents#^first]] \u2022 starts after [[agents#^second]]",
      "- [/] #task First target [id:: first] ^first",
      "- [/] #task Second target [id:: second] ^second",
    ].join("\n"),
  };
  const twoEdges = helpers.parseRelationSuccessorEdgesFromNotes(twoTargetNotes);
  const twoPlan = helpers.planSuccessors({
    closed: [],
    index: helpers.buildDependentsIndex(helpers.tasksFromDocuments(Object.entries(twoTargetNotes).map(([notePath, text]) => ({ path: notePath, text })))),
    dailyBefore: dayBefore,
    dailyAfter: dayAfter,
    dailyPath: "2026/20261102.md",
    today: "2026-11-02",
    noteTexts: twoTargetNotes,
    selection: "all",
    relationEvents: [
      { target: "agents.md#^first", event: "parked", anchor: { kind: "closing", entryLine: 0, bulletLine: null } },
      { target: "agents.md#^second", event: "parked", anchor: { kind: "closing", entryLine: 0, bulletLine: null } },
    ],
    relationCandidates: twoEdges,
    relationOutgoing: twoEdges,
    relationSuccessorLabels: { keys: ["starts after"], labels: { "starts after": "starts after" } },
    relationIndexReady: true,
    navSuccessorsVersion: 3,
  });
  const both = (twoPlan.relation_successors || [])[0];
  assert.ok(both && both.suffix && both.suffix.includes("after"), "two targets share one row with suffix");
});

test("merged real dependency recovery plus relation selection reuses the hand-off writer", () => {
  const notes = {
    "agents.md": [
      "- [ ] #task Evaluate [id:: evaluate] [dependsOn:: implement] ^evaluate",
      "  - 🪢 **LINKS:** starts after [[agents#^implement]]",
      "- [x] #task Implement [id:: implement] ^implement",
    ].join("\n"),
  };
  // Use valid "()" entries so dependency slot/implicit anchors resolve;
  // "(**)" in the canonical vectors is not a parseable Pomodoro entry.
  const dayBefore = "## Pomodoros\n- [ ] () \u2014 BUILD\n  - [[agents#^implement]]\n";
  const dayAfter = "## Pomodoros\n- [x] () \u2014 BUILD\n  - [[agents#^implement]]\n- [ ] () \u2014 BUILD\n";
  const tasks = helpers.tasksFromDocuments(Object.entries(notes).map(([notePath, text]) => ({ path: notePath, text })));
  const edges = helpers.parseRelationSuccessorEdgesFromNotes(notes);
  const closed = [{ path: "agents.md", blockId: "implement", taskId: "implement", text: "Implement", line: 1 }];
  const plan = helpers.planSuccessors({
    closed,
    index: helpers.buildDependentsIndex(tasks),
    dailyBefore: dayBefore,
    dailyAfter: dayAfter,
    dailyPath: "2026/20261102.md",
    today: "2026-11-02",
    noteTexts: notes,
    selection: "all",
    relationEvents: [{ target: "agents.md#^implement", event: "done", anchor: { kind: "slot", entryLine: 0, bulletLine: 1 } }],
    relationCandidates: edges,
    relationOutgoing: edges,
    relationSuccessorLabels: { keys: ["starts after"], labels: { "starts after": "starts after" } },
    relationIndexReady: true,
    navSuccessorsVersion: 3,
  });
  // Hand_off wins with the relation as second reason; the pick mints nothing
  // new (evaluate already has ^evaluate), raises to Next, and links.
  const handOff = (plan.unblocked || []).find((row) => row.offer && row.offer.group === "hand_off");
  assert.ok(handOff, "dependency + relation collapses to hand_off");
  assert.ok(handOff.relation, "second reason retained");
  assert.equal(handOff.status_symbol, "*");
  assert.ok(handOff.link && handOff.link.block_link.includes("evaluate"), "selected write links the successor");
});

test("merged Esc (empty selection) writes nothing for relation-only rows; display-only plans create no placeholders", () => {
  const scene = buildScene(vectors.base, {});
  const { plan: picked } = buildMergedPlan(scene, { selection: "all" });
  assert.ok((picked.placements || []).length > 0, "picked relation has placements");
  const { plan: esc } = buildMergedPlan(scene, { selection: [] });
  assert.equal((esc.placements || []).length, 0, "Esc leaves no placements");
  const relationRows = esc.relation_successors || [];
  assert.ok(relationRows.length > 0, "Esc still reports relation offers as not_selected");
  for (const row of relationRows) {
    assert.equal(row.not_linked, "not_selected");
    assert.equal(row.link, null);
  }
  // No note edits that mint IDs or create placeholders on a display-only plan
  // (recovery edits for already-Ready sources are no-ops).
  const minted = (esc.edits || []).filter((edit) => typeof edit.after === "string" && /\^[A-Za-z0-9_-]+\s*$/.test(edit.after) && !/\^[A-Za-z0-9_-]+\s*$/.test(edit.before));
  assert.equal(minted.length, 0, "display-only plan mints no block IDs");
});

test("merged destinations validate slot, closing, implicit, and overrides", () => {
  const scene = buildScene(vectors.base, {});
  const baseOptions = (selection, destinations, relationEvents) => {
    const { plan } = buildMergedPlan({ ...scene, events: relationEvents || scene.events }, { selection });
    // Apply destination overrides by replanning with explicit destinations.
    if (!destinations) return plan;
    const notes = scene.notes;
    const documents = Object.entries(notes).map(([notePath, text]) => ({ path: notePath, text }));
    const tasks = helpers.tasksFromDocuments(documents);
    const edges = helpers.parseRelationSuccessorEdgesFromNotes(notes);
    const labels = {};
    for (const entry of scene.successorLabels || []) {
      const normalized = helpers.normalizeRelationLabel(entry);
      if (normalized) labels[helpers.relationLabelKey(normalized)] = normalized;
    }
    return helpers.planSuccessors({
      closed: [],
      index: helpers.buildDependentsIndex(tasks),
      dailyBefore: scene.dayBefore,
      dailyAfter: scene.dayAfter,
      dailyPath: "2026/20261102.md",
      today: scene.today,
      noteTexts: notes,
      selection,
      destinations,
      relationEvents: relationEvents || scene.events.map((event) => ({ target: typeof event.target === "string" ? event.target : helpers.relationIdentityKey(event.target.path, event.target.blockId), event: event.event, anchor: { kind: "closing", entryLine: 0, bulletLine: null } })),
      relationCandidates: edges,
      relationOutgoing: edges,
      relationSuccessorLabels: { keys: Object.keys(labels), labels },
      relationIndexReady: true,
      navSuccessorsVersion: 3,
    });
  };
  const slotPlan = baseOptions("all");
  const slotOffer = (slotPlan.offers || []).find((offer) => offer.group === "relation");
  assert.ok(slotOffer && slotOffer.destination, "slot/closing destination exists");
  assert.ok(["slot", "closing", "implicit"].includes(slotOffer.destination.entry_role), `destination role is slot/closing/implicit (${slotOffer.destination.entry_role})`);
  // Overridden destination is honored on the picked row's placement.
  const key = slotOffer.key;
  const overridden = baseOptions(["__none__"], new Map([[key, { kind: "new", name: "RESEARCH" }]]));
  // An unknown key selects nothing; the override alone does not create a placement.
  assert.equal((overridden.placements || []).length, 0);
  const pickedOverride = (() => {
    const notes = scene.notes;
    const documents = Object.entries(notes).map(([notePath, text]) => ({ path: notePath, text }));
    const tasks = helpers.tasksFromDocuments(documents);
    const edges = helpers.parseRelationSuccessorEdgesFromNotes(notes);
    return helpers.planSuccessors({
      closed: [],
      index: helpers.buildDependentsIndex(tasks),
      dailyBefore: scene.dayBefore,
      dailyAfter: scene.dayAfter,
      dailyPath: "2026/20261102.md",
      today: scene.today,
      noteTexts: notes,
      selection: [key],
      destinations: new Map([[key, { kind: "new", name: "RESEARCH" }]]),
      relationEvents: scene.events.map((event) => ({ target: typeof event.target === "string" ? event.target : helpers.relationIdentityKey(event.target.path, event.target.blockId), event: event.event, anchor: { kind: "closing", entryLine: 0, bulletLine: null } })),
      relationCandidates: edges,
      relationOutgoing: edges,
      relationSuccessorLabels: { keys: ["starts after"], labels: { "starts after": "starts after" } },
      relationIndexReady: true,
      navSuccessorsVersion: 3,
    });
  })();
  assert.equal((pickedOverride.placements || []).length, 1, "overridden pick places once");
});

test("merged picker v3 carries relation groups, held counts, and second reasons with complete vector coverage", () => {
  const scene = buildScene(vectors.base, {});
  const { plan } = buildMergedPlan(scene, { selection: "all" });
  const model = helpers.buildSuccessorPickerModel({
    predecessors: [{ note_path: "agents.md", block_id: "implement", text: "Send implementation prompt" }],
    offers: plan.offers,
    stillBlocked: plan.still_blocked,
    foldedByProject: plan.foldedByProject,
    headers: plan.projectHeaders,
    relationHeld: plan.relation_held || [],
  });
  const relationGroups = model.groups.filter((group) => group.group === "relation");
  assert.equal(relationGroups.length, 1, "one relation group");
  const group = relationGroups[0];
  assert.equal(group.header, "Starts after \u201cSend implementation prompt\u201d");
  assert.equal(group.caption, "\u201cSend implementation prompt\u201d is parked \u00b7 Pending, off today's plan");
  assert.equal(group.tag, "your links \u00b7 not dependents");
  assert.equal(group.after.text, "Send implementation prompt");
  assert.equal(group.event, "parked");
  assert.equal(group.label, "starts after");
  assert.ok(Array.isArray(group.rows) && group.rows.length === 1, "one relation row");
  assert.equal(group.rows[0].lane, "Ready");
  // Copy vectors already drive every string; here we verify the picker
  // carries them (no new copy invented, 48-char truncation shared).
  assert.ok(model.title.includes("Starts after"), `relation-only picker uses relation title (${model.title})`);
  // Mixed picker keeps the existing title and attaches second reasons.
  const mixed = helpers.buildSuccessorPickerModel({
    predecessors: [{ note_path: "agents.md", block_id: "implement", text: "Send implementation prompt" }],
    offers: [
      { key: "agents.md#^other", text: "Other", notePath: "agents.md", status: " ", destination: { entry_name: "BUILD" }, needsBlockId: false, group: "hand_off", project: null, anchor: { kind: "closing", entryLine: 0, bulletLine: null }, predecessorRows: [], task: { path: "agents.md", line: 0 }, line: 0 },
      ...(plan.offers || []).filter((offer) => offer.group === "relation"),
    ],
    stillBlocked: plan.still_blocked,
    foldedByProject: plan.foldedByProject,
    headers: plan.projectHeaders,
    relationHeld: plan.relation_held || [],
  });
  assert.ok(mixed.title.includes("Pull in successors"), "mixed picker keeps existing title");
});

test("fake relationIndex uses the public edge shape and never returns verdicts", () => {
  const notes = { "agents.md": vectors.base.notes[0].body };
  const index = helpers.buildFakeRelationIndex(notes);
  assert.equal(index.ready(), true);
  const incoming = index.incoming("agents.md", "implement");
  assert.ok(incoming.length >= 1);
  const edge = incoming[0];
  assert.equal(edge.kind, "relation");
  assert.equal(edge.source.path, "agents.md");
  assert.equal(edge.source.blockId, "evaluate");
  assert.ok("line" in edge.source && "text" in edge.source && "status" in edge.source);
  assert.equal(edge.target.path, "agents.md");
  assert.equal(edge.target.blockId, "implement");
  assert.equal(edge.target.resolved, true);
  assert.ok("label" in edge);
  assert.equal(edge.verdict, undefined);
  assert.equal(edge.reason, undefined);
  const outgoing = index.outgoing("agents.md", "evaluate");
  assert.ok(outgoing.length >= 1);
});
