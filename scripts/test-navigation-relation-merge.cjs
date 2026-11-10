// Merge through the Obsidian Links stage (plan:202611/task_move_merge_split.md
// nav-merge): merge-label effect and four-list overlap, `⤵ merges` rows,
// the preview strip copy, and the Return commit path with offers and Undo.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

function scalar(raw) {
  const value = String(raw ?? "").trim();
  if (value === "" || value === "null" || value === "~") return value === "" ? "" : null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if (/^-?\d+$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root, kind: "map", pending: null }];
  for (const raw of String(text || "").split(/\n/)) {
    const line = raw.replace(/\s+#.*$/u, "").replace(/\s+$/u, "");
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    const body = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    let parent = stack[stack.length - 1];
    if (body.startsWith("- ")) {
      if (parent.kind === "map" && parent.pending) {
        const list = [];
        parent.value[parent.pending] = list;
        parent.pending = null;
        stack.push({ indent: parent.pendingIndent, value: list, kind: "list", pending: null });
        parent = stack[stack.length - 1];
      }
      if (parent.kind !== "list") throw new Error("invalid yaml list");
      parent.value.push(scalar(body.slice(2)));
      continue;
    }
    const colon = body.indexOf(":");
    if (colon < 0) continue;
    const key = body.slice(0, colon).trim();
    const rest = body.slice(colon + 1).trim();
    const value = rest === "" ? undefined : scalar(rest);
    if (parent.kind === "map" && parent.pending && indent > parent.indent) {
      const nested = {};
      parent.value[parent.pending] = nested;
      stack.push({ indent: parent.pendingIndent, value: nested, kind: "map", pending: null });
      parent = stack[stack.length - 1];
    }
    if (parent.kind !== "map") continue;
    if (value === undefined) {
      parent.pending = key;
      parent.pendingIndent = indent;
    } else {
      parent.value[key] = value;
      parent.pending = null;
    }
  }
  return root;
}

const notices = [];
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestModal {
      constructor(app) {
        this.app = app;
        this.contentEl = { empty: () => {} };
        this.modalEl = { removeClass: () => {} };
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: TestModal,
      Notice: class {
        constructor(message) {
          notices.push(String(message));
        }
      },
      Platform: { isDesktopApp: true },
      Plugin: EmptyClass,
      normalizePath: (value) => String(value || ""),
      parseYaml,
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class EditorView {} };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

function loadClose(yaml, warnings) {
  helpers.resetRelationsCloseLabelsConfigCache();
  try {
    return helpers.loadRelationsCloseLabels({
      configPath: "/test/config.yml",
      fsModule: {
        statSync: () => ({ mtimeMs: 1, size: yaml.length }),
        readFileSync: () => yaml,
      },
      parseYaml,
      warn: (message) => warnings.push(String(message)),
    });
  } finally {
    helpers.resetRelationsCloseLabelsConfigCache();
  }
}

const MERGE_YAML = `relations:
  cancel_labels:
    - duplicate of
  complete_labels:
    - implemented by
  successor_labels:
    - starts after
  merge_labels:
    - merged into
`;

test("merge labels classify as the merge effect", () => {
  const warnings = [];
  const close = loadClose(MERGE_YAML, warnings);
  assert.deepEqual(close.merge.keys, ["merged into"]);
  assert.deepEqual(warnings, []);
  assert.equal(helpers.relationLabelEffectForKey("merged into", close), "merge");
  assert.equal(helpers.relationLabelEffectForKey(" Merged  Into: ", close), "merge");
  assert.equal(helpers.relationLabelEffectForKey("duplicate of", close), "cancel");
  assert.equal(helpers.relationLabelEffectForKey("starts after", close), "successor");
  assert.equal(helpers.relationLabelEffectForKey("see also", close), null);
});

test("a merge-involved overlap drops every list and names merge_labels", () => {
  const warnings = [];
  const close = loadClose(`relations:
  cancel_labels:
    - merged into
  merge_labels:
    - merged into
`, warnings);
  assert.deepEqual(close.cancel.keys, []);
  assert.deepEqual(close.merge.keys, []);
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    /“merged into” is in merge_labels and another effect list/,
  );
  assert.equal(helpers.relationLabelEffectForKey("merged into", close), null);
});

test("cancel+complete overlaps keep their legacy copy without merge", () => {
  const warnings = [];
  const close = loadClose(`relations:
  cancel_labels:
    - done
  complete_labels:
    - done
`, warnings);
  assert.deepEqual(close.cancel.keys, []);
  assert.deepEqual(close.complete.keys, []);
  assert.deepEqual(close.merge.keys, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /is in both cancel_labels and complete_labels.*it closes nothing/);
});

test("successor overlaps keep the three-list copy without merge", () => {
  const warnings = [];
  const close = loadClose(`relations:
  complete_labels:
    - done
  successor_labels:
    - done
`, warnings);
  assert.deepEqual(close.complete.keys, []);
  assert.deepEqual(close.merge.keys, []);
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    /is in more than one of cancel_labels, complete_labels, successor_labels.*it has no effect/,
  );
});

test("an invalid merge_labels list warns and merges nothing", () => {
  const warnings = [];
  const close = loadClose(`relations:
  merge_labels: merged into
`, warnings);
  assert.deepEqual(close.merge.keys, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /invalid relations\.merge_labels.*merging nothing/);
});

test("configured merge labels overlay suggestions with the merges meta", () => {
  const policy = { keys: ["merged into"], labels: { "merged into": "merged into" } };
  const rows = helpers.mergeRelationMergeLabelSuggestions(
    [{ key: "see also", label: "see also", count: 2, hidden: false, inverse: null }],
    policy,
    "",
  );
  const overlay = rows.find((row) => row.key === "merged into");
  assert.ok(overlay, "zero-use merge label is suggested");
  assert.equal(overlay.configuredMerge, true);
  const flagged = helpers.mergeRelationMergeLabelSuggestions(
    [{ key: "merged into", label: "merged into", count: 1, hidden: false, inverse: null }],
    policy,
    "",
  );
  assert.equal(
    flagged.find((row) => row.key === "merged into").configuredMerge,
    true,
  );
  assert.equal(helpers.relationMergeSuggestionMeta(), "⤵ merges");
  assert.equal(helpers.relationMergeRowMeta(), "⤵ merges source");
  assert.equal(
    helpers.relationMergeRenameWarningCopy("merged into"),
    "“merged into” is a merge label in config.yml — update relations.merge_labels",
  );
});

function previewReport(overrides = {}) {
  return {
    schema_version: 1,
    ok: true,
    dry_run: true,
    merges: [{
      source: { path: "inbox.md", block_id: "bench", line: 1, title: "Benchmark logical replication" },
      target: { path: "db.md", block_id: "upgrade", title: "Upgrade Postgres to 17", kind: "task" },
      label: "merged into",
      outcome: "merged",
      previous_status: "*",
      moved_lines: 3,
      moved_notes: 2,
      dependents_repointed: ["db#^cutover"],
      prerequisites_left: ["staging box"],
      successors_orphaned: [],
      links_pruned: 1,
      offers: [{
        key: "db.md#^upgrade::BUILD",
        n: 1,
        group: "hand_off",
        selected: false,
        entry_name: "BUILD",
        entry_role: "entry",
        merged_from: "inbox#^bench",
      }],
      message: "merged",
    }],
    pull_in: { choice: "none", offer_count: 1, picked_count: 0 },
    warnings: [],
    repaired_files: [],
    applied_paths: [],
    deferred_paths: [],
    error: null,
    ...overrides,
  };
}

function offerlessReport() {
  return previewReport({
    merges: [{
      source: { path: "inbox.md", block_id: "bench", line: 1, title: "Benchmark logical replication" },
      target: { path: "db.md", block_id: "upgrade", title: "Upgrade Postgres to 17", kind: "task" },
      label: "merged into",
      outcome: "merged",
      previous_status: " ",
      moved_lines: 1,
      moved_notes: 1,
      dependents_repointed: [],
      prerequisites_left: [],
      successors_orphaned: [],
      links_pruned: 0,
      offers: [],
      message: "merged",
    }],
  });
}

test("the merge strip reads the preview record verbatim", () => {
  const summary = helpers.taskMergePreviewSummary(previewReport());
  assert.equal(summary.count, 1);
  assert.equal(summary.mergedCount, 1);
  assert.equal(summary.targetTitle, "Upgrade Postgres to 17");
  assert.equal(summary.copiedNotes, 2);
  assert.deepEqual(summary.dependents, ["db#^cutover"]);
  assert.equal(summary.offers.length, 1);
  assert.equal(
    helpers.formatTaskMergeConsequenceStrip(summary),
    "⤵ Merges “Benchmark logical replication” into “Upgrade Postgres to 17” · copies 2 notes · cancels “Benchmark logical replication” · 1 dependent now waits on “Upgrade Postgres to 17” · offers “Upgrade Postgres to 17” under BUILD",
  );
});

test("the merge strip counts several sources and omits empty parts", () => {
  const report = previewReport({
    merges: [
      {
        source: { path: "inbox.md", block_id: "a", line: 1, title: "Alpha" },
        target: { path: "db.md", block_id: "t", title: "Target", kind: "task" },
        label: "merged into",
        outcome: "merged",
        moved_lines: 0,
        moved_notes: 0,
        dependents_repointed: [],
        prerequisites_left: [],
        successors_orphaned: [],
        links_pruned: 0,
        offers: [],
        message: "merged",
      },
      {
        source: { path: "work.md", block_id: "b", line: 4, title: "Beta" },
        target: { path: "db.md", block_id: "t", title: "Target", kind: "task" },
        label: "merged into",
        outcome: "merged",
        moved_lines: 1,
        moved_notes: 1,
        dependents_repointed: ["x", "y"],
        prerequisites_left: [],
        successors_orphaned: [],
        links_pruned: 0,
        offers: [],
        message: "merged",
      },
    ],
  });
  const summary = helpers.taskMergePreviewSummary(report);
  assert.equal(
    helpers.formatTaskMergeConsequenceStrip(summary),
    "⤵ Merges 2 tasks into “Target” · copies 1 note · cancels 2 tasks · 2 dependents now wait on “Target”",
  );
  assert.equal(helpers.formatTaskMergeConsequenceStrip(null), "⤵ previewing…");
  const again = helpers.taskMergePreviewSummary(previewReport());
  assert.equal(again.nonce, helpers.taskMergePreviewSummary(previewReport()).nonce);
  assert.notEqual(
    again.nonce,
    helpers.taskMergePreviewSummary(previewReport({ merges: [] })).nonce,
  );
});

test("merge targets resolve with one destination and refuse several", () => {
  const sources = [{ path: "inbox.md", blockId: "bench" }];
  const into = { path: "db.md", blockId: "upgrade" };
  const refused = helpers.relationMergeTargetsFromRefs({
    sources,
    targets: [into, { path: "db.md", blockId: "other" }],
    linkedFrom: false,
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /one target/);
  const single = helpers.relationMergeTargetsFromRefs({
    sources,
    targets: [into],
    linkedFrom: false,
  });
  assert.equal(single.ok, true);
  assert.equal(single.into, into);
  const reversed = helpers.relationMergeTargetsFromRefs({
    sources: [{ path: "db.md", blockId: "upgrade" }],
    targets: [{ path: "inbox.md", blockId: "bench" }],
    linkedFrom: true,
  });
  assert.equal(reversed.ok, true);
  assert.equal(reversed.sources[0].blockId, "upgrade");
  assert.equal(reversed.into.blockId, "bench");
  assert.equal(helpers.relationMergeTargetsFromRefs({ sources: [], targets: [into] }).ok, false);
  assert.equal(helpers.relationMergeTargetsFromRefs({ sources, targets: [] }).ok, false);
  const keyed = helpers.relationMergeRefsKey(sources, into, "merged into");
  assert.equal(keyed, helpers.relationMergeRefsKey(sources, into, "merged into"));
  assert.notEqual(
    keyed,
    helpers.relationMergeRefsKey([{ path: "work.md", blockId: "bench" }], into, "merged into"),
  );
});

test("already-closed detection needs every source closed", () => {
  assert.equal(
    helpers.relationMergeAllClosed([
      { rawLine: "- [-] #task Done ^a" },
      { rawLine: "- [x] #task Finished ^b" },
    ]),
    true,
  );
  assert.equal(helpers.relationMergeAllClosed([{ rawLine: "- [ ] #task Open ^a" }]), false);
  assert.equal(helpers.relationMergeAllClosed([{ path: "a.md", blockId: "a" }]), false);
  assert.equal(helpers.relationMergeAllClosed([]), false);
});

test("merge offer rows reuse the hand_off group with merged-from reasons", () => {
  const summary = helpers.taskMergePreviewSummary(previewReport());
  const model = helpers.taskMergeOfferPickerModel(summary, "merged into");
  const normalized = helpers.normalizeSuccessorPickerModel(model);
  assert.ok(normalized, "the merge model normalizes");
  assert.equal(normalized.groups.length, 1);
  assert.equal(normalized.groups[0].group, "hand_off");
  assert.equal(normalized.groups[0].rows.length, 1);
  const row = normalized.groups[0].rows[0];
  assert.equal(row.key, "db.md#^upgrade::BUILD");
  assert.equal(row.selectable, true);
  assert.equal(
    helpers.formatTaskMergeSuccessNotice(summary, "merged into"),
    "⤵ Merged 1 task into “Upgrade Postgres to 17” · merged into",
  );
});

function makePicker(overrides = {}) {
  const calls = { apply: [], picker: [], undo: [], commits: [], api: [] };
  const vaultTexts = { ...(overrides.vaultText || {}) };
  const rawApi = overrides.api === undefined
    ? {
      preview: async (sources, into) => {
        calls.api.push({ op: "preview", sources, into });
        return overrides.previewResult !== undefined
          ? overrides.previewResult
          : { ok: true, report: offerlessReport() };
      },
      apply: async (sources, into, picks) => {
        calls.apply.push({ sources, into, picks });
        return overrides.applyResult !== undefined
          ? overrides.applyResult
          : { ok: true, report: offerlessReport() };
      },
    }
    : overrides.api;
  const api = rawApi === null ? null : { version: 1, ...rawApi };
  const app = {
    plugins: { plugins: { "bob-ledger-tools": { api: { taskMerge: api } } } },
    vault: {
      getAbstractFileByPath: (path) => ({ path }),
      cachedRead: async (file) => {
        const queued = vaultTexts[file.path];
        if (Array.isArray(queued)) return String(queued.shift() ?? "");
        return String(queued ?? "");
      },
    },
  };
  const base = {
    app,
    plugin: {
      pickSuccessorOffers: async (model, options) => {
        calls.picker.push({ model, options });
        return overrides.pickerResult !== undefined ? overrides.pickerResult : null;
      },
      showGuardedUndoNotice: (...args) => {
        calls.undo.push(args);
      },
    },
    filePath: "inbox.md",
    editor: null,
    relationLabelMode: overrides.mode || "add",
    relationLabelTargets: overrides.targets || [],
    stageSources: overrides.sources || [],
    linkedFrom: overrides.linkedFrom === true,
    reviewOrigin: null,
    isLinkedFromSession() {
      return this.linkedFrom;
    },
    relationStageSourceRefs() {
      return this.stageSources;
    },
    async commitRelationEdit(groups) {
      calls.commits.push(groups);
      return overrides.commitResult !== undefined ? overrides.commitResult : true;
    },
    refreshRelationConsequenceStrip() {},
    renderResults() {},
    clearPendingBatch() {},
  };
  const picker = Object.create(
    helpers.BulletPropertyPickerRelationMergeMixin.prototype,
  );
  return { picker: Object.assign(picker, base), calls };
}

const OPEN_SOURCE = {
  path: "inbox.md",
  line: 1,
  blockId: "bench",
  rawLine: "- [*] #task Benchmark logical replication ^bench",
};
const INTO_TARGET = { path: "db.md", line: 3, blockId: "upgrade", rawLine: "- [ ] #task Upgrade ^upgrade" };
const WITH_LABEL = [{ ...INTO_TARGET, label: "merged into" }];

test("an already-closed source takes the plain relation with link only", async () => {
  notices.length = 0;
  const { picker, calls } = makePicker({
    sources: [{ ...OPEN_SOURCE, rawLine: "- [-] #task Benchmark ^bench" }],
    targets: [INTO_TARGET],
  });
  const committed = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL);
  assert.equal(committed, true);
  assert.equal(calls.commits.length, 1);
  assert.deepEqual(calls.commits[0], { add: WITH_LABEL, remove: [], relabel: [] });
  assert.equal(calls.api.length, 0);
  assert.ok(notices.includes(helpers.RELATION_MERGE_ALREADY_CLOSED_MESSAGE));
});

test("an id-less source starts the block-ID prompt with no notice", async () => {
  notices.length = 0;
  const source = {
    path: "inbox.md",
    line: 1,
    blockId: "",
    rawLine: "- [ ] #task Bench",
    displayText: "Bench",
  };
  const { picker, calls } = makePicker({
    sources: [source],
    targets: [INTO_TARGET],
  });
  picker.relationCancelContentForRef = (ref) => ref.rawLine || "";
  picker.getRawQuery = () => "merged into";
  picker.relationLabelMode = "add";
  picker.relationLabelTargets = [INTO_TARGET];
  picker.vaultStage = {
    files: new Map([
      ["inbox.md", "- [ ] #task Bench"],
      ["db.md", "- [ ] #task Upgrade ^upgrade"],
    ]),
  };
  const prompts = [];
  picker.showBlockIdStage = (snapshot, options) => {
    prompts.push({ snapshot, options });
    return false;
  };
  picker.promptNextRelationTargetId = function () {
    const pending = this.pendingRelation;
    if (!pending || !Array.isArray(pending.queue) || pending.queue.length === 0) return false;
    const target = pending.queue[0];
    return this.showBlockIdStage(
      { path: target.path, line: target.line, rawLine: target.rawLine, displayText: target.displayText },
      { mode: "relation-target" },
    );
  };
  const committed = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL);
  assert.equal(committed, false);
  assert.equal(calls.api.length, 0);
  assert.equal(notices.length, 0);
  assert.ok(picker.pendingRelation);
  assert.equal(picker.pendingRelation.merge.label, "merged into");
  assert.deepEqual(
    picker.pendingRelation.queue.map((entry) => entry.path),
    ["inbox.md"],
  );
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].options.mode, "relation-target");
});

test("links-to refuses several picked targets", async () => {
  notices.length = 0;
  const { picker, calls } = makePicker({
    sources: [OPEN_SOURCE],
    targets: [INTO_TARGET, { path: "db.md", line: 5, blockId: "other" }],
  });
  const committed = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL);
  assert.equal(committed, false);
  assert.equal(calls.api.length, 0);
  assert.ok(notices.some((notice) => /one target/.test(notice)));
});

test("mobile resolves the desktop refusal and writes nothing", async () => {
  notices.length = 0;
  const { picker, calls } = makePicker({
    sources: [OPEN_SOURCE],
    targets: [INTO_TARGET],
    api: {
      preview: async () => ({ ok: false, code: "desktop_only", message: "⤵ merging needs the desktop app" }),
      apply: async () => { throw new Error("must not apply"); },
    },
  });
  const committed = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL);
  assert.equal(committed, false);
  assert.equal(calls.apply.length, 0);
  assert.ok(notices.includes("⤵ merging needs the desktop app"));
});

test("a preview refusal notifies and never applies", async () => {
  notices.length = 0;
  const { picker, calls } = makePicker({
    sources: [OPEN_SOURCE],
    targets: [INTO_TARGET],
    previewResult: {
      ok: false,
      code: "merge_source_open_subtasks",
      message: "“S” has 2 open subtasks; move or close ^sub first",
    },
  });
  const committed = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL);
  assert.equal(committed, false);
  assert.equal(calls.apply.length, 0);
  assert.ok(notices.includes("“S” has 2 open subtasks; move or close ^sub first"));
});

test("one source without offers applies and offers Undo merge", async () => {
  notices.length = 0;
  const applied = offerlessReport();
  applied.applied_paths = ["inbox.md", "db.md"];
  const { picker, calls } = makePicker({
    sources: [OPEN_SOURCE],
    targets: [INTO_TARGET],
    previewResult: { ok: true, report: offerlessReport() },
    applyResult: { ok: true, report: applied },
    vaultText: { "inbox.md": ["- [*] #task pre", "- [-] #task post"], "db.md": ["# pre", "# post"] },
  });
  const committed = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL);
  assert.equal(committed, true);
  assert.equal(calls.api.length, 1);
  assert.deepEqual(calls.api[0].sources, [OPEN_SOURCE]);
  assert.equal(calls.apply.length, 1);
  assert.deepEqual(calls.apply[0].sources, [OPEN_SOURCE]);
  assert.deepEqual(calls.apply[0].into, INTO_TARGET);
  assert.equal(calls.apply[0].picks, null);
  assert.equal(calls.picker.length, 0);
  assert.equal(calls.undo.length, 1);
  const [message, restores, options] = calls.undo[0];
  assert.match(message, /⤵ Merged 1 task into/);
  assert.equal(options.actionLabel, "Undo merge");
  assert.deepEqual(
    restores.map((restore) => [restore.path, restore.before, restore.after]),
    [["inbox.md", "- [*] #task pre", "- [-] #task post"], ["db.md", "# pre", "# post"]],
  );
});

test("offers open the successor picker and ride -p into apply", async () => {
  notices.length = 0;
  const applied = previewReport();
  applied.applied_paths = ["inbox.md"];
  const { picker, calls } = makePicker({
    sources: [OPEN_SOURCE],
    targets: [INTO_TARGET],
    previewResult: { ok: true, report: previewReport() },
    applyResult: { ok: true, report: applied },
    pickerResult: { picks: [{ key: "db.md#^upgrade::BUILD" }] },
    vaultText: { "inbox.md": ["pre", "post"] },
  });
  const committed = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL);
  assert.equal(committed, true);
  assert.equal(calls.picker.length, 1);
  const model = calls.picker[0].model;
  assert.equal(model.groups[0].group, "hand_off");
  assert.equal(calls.picker[0].options.retarget, false);
  assert.equal(calls.apply.length, 1);
  assert.deepEqual(calls.apply[0].picks, [{ key: "db.md#^upgrade::BUILD" }]);
});

test("dismissing the offer picker applies unpicked", async () => {
  const applied = previewReport();
  applied.applied_paths = [];
  const { picker, calls } = makePicker({
    sources: [OPEN_SOURCE],
    targets: [INTO_TARGET],
    previewResult: { ok: true, report: previewReport() },
    applyResult: { ok: true, report: applied },
    pickerResult: null,
    vaultText: {},
  });
  const committed = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL);
  assert.equal(committed, true);
  assert.equal(calls.apply.length, 1);
  assert.equal(calls.apply[0].picks, null);
});

test("a counted batch arms the banner and commits on the second Return", async () => {
  const second = {
    path: "work.md",
    line: 2,
    blockId: "pgdump",
    rawLine: "- [?] #task Dump ^pgdump",
  };
  const batch = previewReport({
    merges: [
      offerlessReport().merges[0],
      {
        source: { path: "work.md", block_id: "pgdump", line: 2, title: "Dump" },
        target: { path: "db.md", block_id: "upgrade", title: "Upgrade Postgres to 17", kind: "task" },
        label: "merged into",
        outcome: "merged",
        moved_lines: 0,
        moved_notes: 0,
        dependents_repointed: [],
        prerequisites_left: [],
        successors_orphaned: [],
        links_pruned: 0,
        offers: [],
        message: "merged",
      },
    ],
  });
  const applied = previewReport({ merges: batch.merges });
  const { picker, calls } = makePicker({
    sources: [OPEN_SOURCE, second],
    targets: [INTO_TARGET],
    previewResult: { ok: true, report: batch },
    applyResult: { ok: true, report: applied },
    vaultText: {},
  });
  const first = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL);
  assert.equal(first, false);
  assert.equal(calls.apply.length, 0);
  assert.ok(picker.relationMergeConfirmNonce, "the batch banner arms");
  const done = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL);
  assert.equal(done, true);
  assert.equal(calls.apply.length, 1);
});

test("linked-from merges the picked task into the cursor task", async () => {
  const { picker, calls } = makePicker({
    sources: [INTO_TARGET],
    targets: [OPEN_SOURCE],
    linkedFrom: true,
    previewResult: { ok: true, report: offerlessReport() },
    applyResult: { ok: true, report: offerlessReport() },
    vaultText: {},
  });
  const committed = await picker.commitRelationMergeLabel({}, "merged into", [{ ...OPEN_SOURCE, label: "merged into" }]);
  assert.equal(committed, true);
  assert.equal(calls.api.length, 1);
  assert.deepEqual(calls.api[0].sources, [OPEN_SOURCE]);
  assert.deepEqual(calls.api[0].into, INTO_TARGET);
});

test("an unchanged re-run writes nothing and stays quiet", async () => {
  notices.length = 0;
  const unchanged = offerlessReport();
  unchanged.merges[0].outcome = "unchanged";
  const { picker, calls } = makePicker({
    sources: [OPEN_SOURCE],
    targets: [INTO_TARGET],
    previewResult: { ok: true, report: unchanged },
    vaultText: {},
  });
  const committed = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL);
  assert.equal(committed, true);
  assert.equal(calls.apply.length, 0);
  assert.ok(notices.includes("Already merged — nothing to do"));
});

test("missing-ID queue orders sources then target and dedupes", () => {
  const source = { path: "inbox.md", line: 1, blockId: "", rawLine: "- [ ] #task A" };
  const target = { path: "db.md", line: 3, blockId: "", rawLine: "- [ ] #task B" };
  assert.deepEqual(
    helpers.relationMergeMissingIdRefs([source], target).map((entry) => entry.path),
    ["inbox.md", "db.md"],
  );
  const withId = { path: "db.md", line: 3, blockId: "upgrade", rawLine: "- [ ] #task B ^upgrade" };
  assert.deepEqual(
    helpers.relationMergeMissingIdRefs([source], withId).map((entry) => entry.path),
    ["inbox.md"],
  );
  assert.deepEqual(
    helpers.relationMergeMissingIdRefs([], withId),
    [],
  );
  const dup = { path: "inbox.md", line: 1, blockId: "", rawLine: "- [ ] #task A" };
  assert.equal(helpers.relationMergeMissingIdRefs([source, dup], target).length, 2);
  const linkedFromSources = [{ path: "Other.md", line: 0, blockId: "", rawLine: "- [ ] #task O" }];
  const cursor = { path: "Current.md", line: 0, blockId: "", rawLine: "- [ ] #task C" };
  assert.deepEqual(
    helpers.relationMergeMissingIdRefs(linkedFromSources, cursor).map((entry) => entry.path),
    ["Other.md", "Current.md"],
  );
});

test("an already-closed id-less source links only with no merge prompt", async () => {
  notices.length = 0;
  const closed = { path: "inbox.md", line: 1, blockId: "", rawLine: "- [-] #task Bench" };
  const { picker, calls } = makePicker({
    sources: [closed],
    targets: [INTO_TARGET],
  });
  let prompted = 0;
  picker.promptNextRelationTargetId = () => {
    prompted += 1;
    return false;
  };
  const committed = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL);
  assert.equal(committed, true);
  assert.equal(prompted, 0);
  assert.equal(calls.api.length, 0);
  assert.equal(calls.commits.length, 1);
  assert.ok(notices.includes(helpers.RELATION_MERGE_ALREADY_CLOSED_MESSAGE));
});

test("a resumed commit without IDs refuses without prompting again", async () => {
  notices.length = 0;
  const { picker, calls } = makePicker({
    sources: [{ path: "inbox.md", line: 1, blockId: "", rawLine: "- [ ] #task Bench" }],
    targets: [INTO_TARGET],
  });
  picker.relationCancelContentForRef = () => "";
  picker.getRawQuery = () => "merged into";
  picker.relationLabelMode = "add";
  picker.relationLabelTargets = [INTO_TARGET];
  let prompted = 0;
  picker.promptNextRelationTargetId = () => {
    prompted += 1;
    return false;
  };
  const committed = await picker.commitRelationMergeLabel({}, "merged into", WITH_LABEL, { resumed: true });
  assert.equal(committed, false);
  assert.equal(prompted, 0);
  assert.equal(calls.api.length, 0);
  assert.ok(notices.includes(helpers.RELATION_MERGE_MISSING_ID_MESSAGE));
});

test("an abandoned queue triggers no preview and no apply", async () => {
  const source = { path: "inbox.md", line: 1, blockId: "", rawLine: "- [ ] #task A" };
  const target = { path: "db.md", line: 3, blockId: "", rawLine: "- [ ] #task B" };
  const queue = helpers.relationMergeMissingIdRefs([source], target);
  assert.equal(queue.length, 2);
  const remaining = queue.slice(1);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].path, "db.md");
});

test("a non-active open editor is saved before preview", async () => {
  notices.length = 0;
  const targetView = { file: { path: "db.md" }, editor: {}, saveCalls: 0 };
  targetView.save = async () => {
    targetView.saveCalls += 1;
  };
  const activeView = { file: { path: "inbox.md" }, editor: {}, saveCalls: 0 };
  activeView.save = async () => {
    activeView.saveCalls += 1;
  };
  const app = {
    workspace: {
      getActiveViewOfType: () => activeView,
      iterateAllLeaves: (visit) => {
        visit({ view: activeView });
        visit({ view: targetView });
        visit({ view: { file: { path: "other.md" }, editor: {}, save: async () => { throw new Error("must not save"); } } });
      },
    },
  };
  const result = await helpers.saveRelationMergeEditors(app, ["inbox.md", "db.md"]);
  assert.equal(result.ok, true);
  assert.equal(activeView.saveCalls, 1);
  assert.equal(targetView.saveCalls, 1);
});

test("merge block-ID copy pins subtitle and footer labels", () => {
  assert.equal(helpers.relationMergeBlockIdSubtitle(1, 2, 7), "⤵ Merging needs an ID · 1 of 2 · line 7");
  assert.equal(helpers.relationMergeBlockIdSubtitle(2, 2, 7), "⤵ Merging needs an ID · 2 of 2 · line 7");
  assert.equal(helpers.relationMergeBlockIdSubtitle(1, 1, 7), "⤵ Merging needs an ID · line 7");
  assert.deepEqual(helpers.getBulletPropertyBlockIdHints({ merge: true, last: false }), [
    { keys: ["↵"], label: "Next" },
    { keys: ["esc"], label: "Cancel" },
  ]);
  assert.deepEqual(helpers.getBulletPropertyBlockIdHints({ merge: true, last: true }), [
    { keys: ["↵"], label: "Create & merge" },
    { keys: ["esc"], label: "Cancel" },
  ]);
});
