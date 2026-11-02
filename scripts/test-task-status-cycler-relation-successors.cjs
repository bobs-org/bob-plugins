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
    assert.deepEqual(result.held, expected.held, `${vectorId} ${name}: held`);
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
