// Read-only tie data shared by the four Task Card relationship stages.
// The stage builders already hold the dependency graph and note snapshots;
// the relation index supplies incoming authored LINKS without a second scan.

function tieVisibilityRowKey(path, blockId) {
  return dependencyStageRowKey(path, blockId);
}

function tieVisibilityState(map, key) {
  if (!key) return null;
  if (!map.has(key)) {
    map.set(key, {
      waitsOn: false,
      waitedOnBy: false,
      plainOut: false,
      plainIn: false,
      labelledOut: [],
      labelledIn: [],
    });
  }
  return map.get(key);
}

function tieVisibilityOwnerSources(stage) {
  if (Array.isArray(stage && stage.sources) && stage.sources.length > 0) {
    return stage.sources;
  }
  const dependent = (stage && stage.dependent) || {};
  const path = normalizeVaultRelativePath(dependent.path || "");
  const files = stage && stage.files instanceof Map ? stage.files : new Map();
  const content = String(files.get(path) || "");
  const lines = Array.isArray(stage && stage.parentLines)
    ? stage.parentLines
    : [dependent.line];
  return lines
    .map((line) => relationStageSourceFromLine(content, path, line))
    .filter(Boolean);
}

function tieVisibilityOwnerKey(owner, stage) {
  const path = normalizeVaultRelativePath(owner && owner.path);
  const blockId = normalizeBulletPropertyValue(owner && owner.blockId);
  return (path && blockId && tieVisibilityRowKey(path, blockId)) ||
    String((owner && owner.key) || (stage && stage.dependent && stage.dependent.key) || "");
}

function tieVisibilityDependencyEdges(stage) {
  if (stage && stage.edges instanceof Map) return stage.edges;
  const files = stage && stage.files instanceof Map ? stage.files : null;
  const index = stage && stage.index;
  if (!files || !index) return new Map();
  try {
    const notes = [...files].map(([path, content]) => ({ path, content }));
    const snapshots = createDependencySnapshotMap(notes);
    return collectDependencyStageEdgesFromSnapshots(snapshots, index);
  } catch (_error) {
    return new Map();
  }
}

function tieVisibilityRelationIndex(plugin) {
  try {
    if (plugin && typeof plugin.relationStageLiveIndex === "function") {
      return plugin.relationStageLiveIndex();
    }
  } catch (_error) {
    // Incoming relation pills are optional when the live index is unavailable.
  }
  return null;
}

function tieHandEditRelationFacts(content, line, path, resolveLinkpath) {
  const deps = tieDependsOnTargets(content, line, path, resolveLinkpath);
  const plain = tiePlainPresence(String(content || "").split(/\r?\n/), line, path, resolveLinkpath);
  return {
    dependencies: new Set(
      (deps && deps.ok && deps.targets || [])
        .map((entry) => blocksIdentity(entry.path, entry.blockId))
        .filter(Boolean),
    ),
    plainLinks: new Set(
      (plain && plain.ok && plain.out || [])
        .map((entry) => blocksIdentity(entry.path, entry.blockId))
        .filter(Boolean),
    ),
  };
}

// Called once after a hand-edit burst leaves a LINKS or Depends-On line.
// It only reports an overlap involving a newly added tie; reconcile remains
// the writer that folds the plain link.
async function tieHandEditOverlapNotice(plugin, ownerPath, ownerContent, ownerLine, targets, resolveLinkpath) {
  const path = normalizeVaultRelativePath(ownerPath || "");
  const lines = String(ownerContent || "").split(/\r?\n/);
  const line = Math.floor(numericOrDefault(ownerLine, Number.NaN));
  if (!path || !Number.isFinite(line) || line < 0 || line >= lines.length) return "";
  const ownerBlockId = normalizeBulletPropertyValue(getTrailingBlockId(lines[line]) || "");
  const ownerKey = ownerBlockId ? blocksIdentity(path, ownerBlockId) : null;
  const ownerFacts = tieHandEditRelationFacts(ownerContent, line, path, resolveLinkpath);
  const seen = new Set();
  for (const candidate of Array.isArray(targets) ? targets : []) {
    const targetPath = normalizeVaultRelativePath(candidate && candidate.path || "");
    const targetBlockId = normalizeBulletPropertyValue(candidate && candidate.blockId || "");
    const targetKey = targetPath && targetBlockId ? blocksIdentity(targetPath, targetBlockId) : null;
    if (!targetKey || targetKey === ownerKey || seen.has(targetKey)) continue;
    seen.add(targetKey);

    let targetContent = targetPath === path
      ? String(ownerContent || "")
      : null;
    if (targetContent === null && plugin && typeof plugin.readDependencyNoteContent === "function") {
      targetContent = await plugin.readDependencyNoteContent(targetPath, null, "");
    }
    if (targetContent === null || targetContent === undefined) continue;
    const noteMap = new Map([[targetPath, String(targetContent || "")]]);
    const found = tieFindTaskLine(noteMap, targetPath, targetBlockId);
    if (found.reason) continue;
    const targetFacts = tieHandEditRelationFacts(
      targetContent,
      found.line,
      targetPath,
      resolveLinkpath,
    );
    const hasDependency = ownerFacts.dependencies.has(targetKey) ||
      Boolean(ownerKey && targetFacts.dependencies.has(ownerKey));
    const hasPlainLink = ownerFacts.plainLinks.has(targetKey) ||
      Boolean(ownerKey && targetFacts.plainLinks.has(ownerKey));
    if (!hasDependency || !hasPlainLink) continue;

    const display = String(cleanTaskDisplayText(found.lines[found.line]) || "").trim() || `^${targetBlockId}`;
    return `"${display}" is already a dependency · reconcile will drop this plain link`;
  }
  return "";
}

function buildTieVisibilityIndex(stage, pluginOrIndex = null) {
  const ties = new Map();
  if (!stage) return ties;
  const owners = tieVisibilityOwnerSources(stage);
  const ownerKeys = new Set();
  const files = stage.files instanceof Map ? stage.files : new Map();
  const index = stage.index || null;

  for (const owner of owners) {
    const ownerPath = normalizeVaultRelativePath(owner && owner.path);
    const ownerBlockId = normalizeBulletPropertyValue(owner && owner.blockId);
    const ownerKey = tieVisibilityOwnerKey(owner, stage);
    if (!ownerPath) continue;
    if (ownerKey) ownerKeys.add(ownerKey);

    const content = String(files.get(ownerPath) || "");
    const lines = content.split(/\r?\n/);
    for (const child of findLinksChildren(lines, owner.line)) {
      const parsed = parseLinksLine(String(lines[child] || ""), {
        isDirectChildOfTask: true,
      });
      if (parsed.verdict !== "accept") continue;
      for (const relation of parsed.entries || []) {
        const targetPath = resolveDependencyStageLinkTarget(
          relation.note,
          relation.blockId,
          ownerPath,
          index,
        );
        const targetKey = tieVisibilityRowKey(targetPath, relation.blockId);
        const tie = tieVisibilityState(ties, targetKey);
        if (!tie) continue;
        const label = String(relation.label || "").trim();
        if (label) {
          if (!tie.labelledOut.includes(label)) tie.labelledOut.push(label);
        } else {
          tie.plainOut = true;
        }
      }
    }

    // A dependency owner can lack a trailing ^id. Its directly-authored
    // Depends-On targets still have stable path/id keys, so derive those ties
    // from the owner line instead of depending on a graph source key.
    const dependsOn = collectDependencyNavigationBullets(content, owner.line);
    if (!dependsOn.reason) {
      for (const target of dependsOn.targets || []) {
        const targetPath = resolveDependencyStageLinkTarget(
          target.note,
          target.blockId,
          ownerPath,
          index,
        );
        const targetKey = tieVisibilityRowKey(targetPath, target.blockId);
        const tie = tieVisibilityState(ties, targetKey);
        if (tie) tie.waitsOn = true;
      }
    }
  }

  const edges = tieVisibilityDependencyEdges(stage);
  for (const [from, targetsValue] of edges) {
    const targets = targetsValue instanceof Set
      ? [...targetsValue]
      : Array.isArray(targetsValue)
        ? targetsValue
        : [];
    if (ownerKeys.has(from)) {
      for (const target of targets) {
        const tie = tieVisibilityState(ties, target);
        if (tie) tie.waitsOn = true;
      }
    }
    for (const ownerKey of ownerKeys) {
      if (targets.includes(ownerKey)) {
        const tie = tieVisibilityState(ties, from);
        if (tie) tie.waitedOnBy = true;
      }
    }
  }
  if (stage) stage.tieEdges = edges;

  // `incoming` is relation-only. Do not consume `linkedFrom`, which also
  // includes inert prose mentions. If the index is warming or absent, keep
  // the outgoing and dependency pills and simply omit incoming link pills.
  const relationIndex = pluginOrIndex && typeof pluginOrIndex.incoming === "function"
    ? pluginOrIndex
    : tieVisibilityRelationIndex(pluginOrIndex);
  if (relationIndex && typeof relationIndex.incoming === "function") {
    for (const owner of owners) {
      const ownerPath = normalizeVaultRelativePath(owner && owner.path);
      const ownerBlockId = normalizeBulletPropertyValue(owner && owner.blockId);
      if (!ownerPath || !ownerBlockId) continue;
      let incoming = [];
      try {
        incoming = relationIndex.incoming(ownerPath, ownerBlockId) || [];
      } catch (_error) {
        incoming = [];
      }
      for (const edge of Array.isArray(incoming) ? incoming : []) {
        if (!edge || edge.kind === "mention") continue;
        const source = edge.source || {};
        const sourcePath = normalizeVaultRelativePath(source.path || "");
        const sourceBlockId = normalizeBulletPropertyValue(source.blockId || "");
        const sourceKey = tieVisibilityRowKey(sourcePath, sourceBlockId);
        const tie = tieVisibilityState(ties, sourceKey);
        if (!tie) continue;
        const label = String(edge.label || "").trim();
        if (label) {
          if (!tie.labelledIn.includes(label)) tie.labelledIn.push(label);
        } else {
          tie.plainIn = true;
        }
      }
    }
  }

  if (stage) {
    stage.tieByKey = ties;
    const values = [...ties.values()];
    stage.tiedByDependencyCount = values.filter(
      (tie) => tie.waitsOn || tie.waitedOnBy,
    ).length;
    stage.plainLinkTieCount = values.filter(
      (tie) => tie.plainOut || tie.plainIn,
    ).length;
  }
  return ties;
}

function ensureTieVisibilityIndex(stage, pluginOrIndex = null) {
  if (stage && stage.tieByKey instanceof Map) return stage.tieByKey;
  return buildTieVisibilityIndex(stage, pluginOrIndex);
}

function tieVisibilityPills(tie, stageKind) {
  if (!tie) return [];
  const pills = [];
  const add = (kind, text, title) => pills.push({ kind, text, title });
  if (tie.waitsOn && stageKind !== "depends") {
    add(
      "dependency-prerequisite",
      "⛓ prerequisite",
      stageKind === "links" || stageKind === "linked-from"
        ? "This task waits on it · ↵ converts the dependency to a plain link"
        : stageKind === "blocks"
          ? "This task waits on it · ⌃L makes it a plain link"
          : "This task waits on it · ⌃B keeps the dependency",
    );
  }
  if (tie.waitedOnBy && stageKind !== "blocks") {
    add(
      "dependency-dependent",
      "🧱 dependent",
      stageKind === "links" || stageKind === "linked-from"
        ? "It waits on this task · ↵ converts the dependency to a plain link"
        : stageKind === "depends"
          ? "It waits on this task · ⌃⇧L makes it a plain link"
          : "It waits on this task · ⌃⇧B keeps the dependency",
    );
  }
  if (tie.plainOut && stageKind !== "links") {
    add(
      "relation-plain",
      "🪢 linked",
      stageKind === "depends" || stageKind === "blocks"
        ? "This task has a plain link to it · ↵ replaces the link with a dependency"
        : "This task has a plain link to it",
    );
  }
  if (tie.plainIn && stageKind !== "linked-from") {
    add(
      "relation-plain",
      "🪢 links here",
      stageKind === "depends" || stageKind === "blocks"
        ? "It has a plain link to this task · ↵ replaces the link with a dependency"
        : "It has a plain link to this task",
    );
  }
  for (const label of tie.labelledOut || []) {
    if (stageKind === "links") continue;
    add("relation-label", label, `Labelled relation from this task: ${label}`);
  }
  for (const label of tie.labelledIn || []) {
    if (stageKind === "linked-from") continue;
    add("relation-label", `← ${label}`, `Labelled relation to this task: ${label}`);
  }
  return pills;
}

function tieVisibilityOpenWaitCount(stage, fromKey, exceptKey = null) {
  const edges = stage && stage.tieEdges instanceof Map
    ? stage.tieEdges
    : stage && stage.edges instanceof Map
      ? stage.edges
      : new Map();
  const index = stage && stage.index;
  const targets = edges.get(fromKey);
  let count = 0;
  for (const target of Array.isArray(targets) ? targets : []) {
    if (target === exceptKey) continue;
    const record = index && index.byKey instanceof Map ? index.byKey.get(target) : null;
    if (record && record.open === true) count += 1;
  }
  return count;
}

function tieVisibilityTieChangePlan(stage, plugin, owner, other, to) {
  const files = stage && stage.files;
  if (!(files instanceof Map) || !owner || !other) return null;
  let resolveLinkpath = null;
  let vaultFiles = [...files.keys()];
  try {
    if (plugin && typeof plugin.dependencyLinkpathResolver === "function") {
      resolveLinkpath = plugin.dependencyLinkpathResolver();
    }
    if (plugin && typeof plugin.readDependencyVaultFileList === "function") {
      const listed = plugin.readDependencyVaultFileList();
      if (Array.isArray(listed) && listed.length > 0) vaultFiles = listed;
    }
  } catch (_error) {
    return null;
  }
  if (typeof resolveLinkpath !== "function") return null;
  try {
    return planTieChange({
      owner,
      other,
      to,
      notes: files,
      resolve: { linkpath: resolveLinkpath, vaultFiles },
    });
  } catch (_error) {
    return null;
  }
}

function tieVisibilityProjectInfo(stage, owner) {
  const path = normalizeVaultRelativePath(owner && owner.path);
  const files = stage && stage.files instanceof Map ? stage.files : null;
  const content = path && files ? files.get(path) : null;
  if (typeof content !== "string" || !Number.isInteger(owner && owner.line)) {
    return null;
  }
  try {
    return isProjectPrjDependencyParent(content, path, owner.line);
  } catch (_error) {
    return null;
  }
}

function tieVisibilityTodayLink(stage, owner) {
  const ownerKey = tieVisibilityOwnerKey(owner, stage);
  const todayLinks = Array.isArray(stage && stage.todayLinks)
    ? stage.todayLinks
    : [];
  return todayLinks.find((link) => link && link.key === ownerKey) || null;
}

function tieVisibilityProjectPomodoroCount(stage, projectInfo, owner) {
  const keys = new Set([tieVisibilityOwnerKey(owner, stage)]);
  const path = normalizeVaultRelativePath(owner && owner.path);
  for (const resident of projectInfo && Array.isArray(projectInfo.residents)
    ? projectInfo.residents
    : []) {
    const key = resident && resident.blockId
      ? tieVisibilityRowKey(path, resident.blockId)
      : null;
    if (key) keys.add(key);
  }
  const todayLinks = Array.isArray(stage && stage.todayLinks)
    ? stage.todayLinks
    : [];
  return todayLinks.filter((link) => link && keys.has(link.key)).length;
}

function tieVisibilityProjectReleaseCopy(stage, owner, rowKey) {
  const info = tieVisibilityProjectInfo(stage, owner);
  if (!info || !Array.isArray(info.residents) || info.residents.length === 0) {
    return "";
  }
  const ownerKey = tieVisibilityOwnerKey(owner, stage);
  const remaining = tieVisibilityOpenWaitCount(stage, ownerKey, rowKey);
  const scheduled = findBulletPropertyField(owner && owner.rawLine || "", "scheduled");
  const futureSchedule = Boolean(
    scheduled && isFutureInlineScheduledValue(scheduled.value),
  );
  if ((owner && owner.status) !== "?" || remaining > 0 || futureSchedule) {
    return "";
  }
  const name = String(owner.displayText || cleanTaskDisplayText(owner.rawLine || "") || "")
    .trim();
  if (!name) return "";
  const parts = [`unblocks ${info.residents.length} residents of ‹${name}›`];
  const pomodoros = tieVisibilityProjectPomodoroCount(stage, info, owner);
  if (pomodoros > 0) {
    parts.push(`⚠ removes ${pomodoros} Pomodoro link${pomodoros === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

function tieVisibilityReleaseAlternative(item, stage, owner, plugin, tie) {
  let to = null;
  let chord = "";
  let outcome = "";
  if (tie && tie.waitsOn) {
    to = "other-waits";
    chord = "⌃⇧B";
    outcome = "it becomes Blocked";
  } else if (tie && tie.waitedOnBy) {
    to = "owner-waits";
    chord = "⌃B";
    outcome = "this task becomes Blocked";
  }
  if (!to) return "";
  const planned = tieVisibilityTieChangePlan(
    stage,
    plugin,
    tieVisibilityOwnerSources(stage)[0],
    item,
    to,
  );
  if (!planned || planned.kind !== "change" || planned.reversing !== true) {
    return "";
  }
  return ` · ${chord} reverses · ${outcome}`;
}

function tieVisibilityReleaseCopy(item, stage, plugin = null) {
  const tie = item && item.tieInfo;
  if (!tie || !tieVisibilityHasDependency(tie)) return "";
  const rowKey = tieVisibilityRowKey(item.path, item.blockId);
  const ownerSources = tieVisibilityOwnerSources(stage);
  const owner = ownerSources[0] || {};
  const ownerKey = tieVisibilityOwnerKey(owner, stage);
  const effects = [];
  if (tie.waitsOn && ownerKey && rowKey) {
    const record = stage.index && stage.index.byKey instanceof Map
      ? stage.index.byKey.get(ownerKey)
      : null;
    if (record && record.open !== true) {
      effects.push("this task's status is unchanged");
    } else {
      const remaining = tieVisibilityOpenWaitCount(stage, ownerKey, rowKey);
      effects.push(remaining > 0
        ? `this task stays Blocked (waits on ${remaining})`
        : "this task becomes Ready again");
    }
  }
  if (tie.waitedOnBy && ownerKey && rowKey) {
    const record = stage.index && stage.index.byKey instanceof Map
      ? stage.index.byKey.get(rowKey)
      : null;
    if (record && record.open !== true) {
      effects.push("its status is unchanged");
    } else {
      const remaining = tieVisibilityOpenWaitCount(stage, rowKey, ownerKey);
      effects.push(remaining > 0
        ? `it stays Blocked (waits on ${remaining})`
        : "it becomes Ready again");
    }
  }
  const project = tieVisibilityProjectReleaseCopy(stage, owner, rowKey);
  if (project) effects.push(project);
  const alternative = tieVisibilityReleaseAlternative(
    item,
    stage,
    owner,
    plugin,
    tie,
  );
  return `⇄ Makes it a plain link${effects.length ? ` · ${effects.join(" · ")}` : ""}${alternative}`;
}

function tieVisibilityKind(stage, fallback = "depends") {
  if (stage && stage.direction === "from") return "linked-from";
  if (stage && stage.relationStage === true) return "links";
  if (fallback === "blocks") return "blocks";
  return fallback;
}

function tieVisibilityHasDependency(tie) {
  return Boolean(tie && (tie.waitsOn || tie.waitedOnBy));
}

function tieVisibilityHasPlainLink(tie) {
  return Boolean(tie && (tie.plainOut || tie.plainIn));
}

function tieVisibilityHeader(kind) {
  return kind === "links" || kind === "linked-from"
    ? "tie-dependency"
    : "tie-plain-links";
}

function planTieVisibilityItems(items, stage, kind, query = "", plugin = null) {
  const source = Array.isArray(items) ? items : [];
  const ties = ensureTieVisibilityIndex(stage);
  const stageKind = tieVisibilityKind(stage, kind);
  const decorated = source.map((item) => {
    if (!item || item.kind === "stage-more") return item;
    const key = tieVisibilityRowKey(item.path, item.blockId);
    const tie = key ? ties.get(key) || null : null;
    const eligible = item.kind === "local-task" && item.mention !== true;
    const otherKindTie = stageKind === "links" || stageKind === "linked-from"
      ? tieVisibilityHasDependency(tie)
      : tieVisibilityHasPlainLink(tie);
    const tieReleaseCopy = eligible && item.stageSection !== "current" &&
      (stageKind === "links" || stageKind === "linked-from") &&
      tieVisibilityHasDependency(tie)
      ? tieVisibilityReleaseCopy({ ...item, tieInfo: tie }, stage, plugin)
      : "";
    return {
      ...item,
      tieInfo: eligible ? tie : null,
      tiePills: eligible ? tieVisibilityPills(tie, stageKind) : [],
      tieConvert:
        eligible && item.stageSection !== "current" && otherKindTie && !item.disabled,
      tieReleaseCopy,
    };
  });
  if (String(query || "").trim()) return decorated;

  const current = [];
  const band = [];
  const results = [];
  const bandPredicate = stageKind === "links" || stageKind === "linked-from"
    ? tieVisibilityHasDependency
    : tieVisibilityHasPlainLink;
  for (const item of decorated) {
    if (!item || item.kind === "stage-more" || item.stageSection === "current") {
      current.push(item);
    } else if (
      item.kind === "local-task" &&
      item.mention !== true &&
      !item.disabled &&
      bandPredicate(item.tieInfo)
    ) {
      band.push({ ...item, inTieBand: true });
    } else {
      results.push(item);
    }
  }
  const ordered = [...current, ...band, ...results];
  let previousGroup = null;
  return Object.freeze(ordered.map((item) => {
    if (!item || item.kind === "stage-more") return item;
    const group = item.inTieBand
      ? "tie-band"
      : item.stageSection || "results";
    const first = group !== previousGroup;
    previousGroup = group;
    return {
      ...item,
      firstInSection: first,
      headerSection: first
        ? group === "tie-band"
          ? tieVisibilityHeader(stageKind)
          : group
        : null,
    };
  }));
}

function tieVisibilityCountPhrase(count, subject) {
  const value = Math.max(0, Math.floor(numericOrDefault(count, 0)));
  if (value === 0) return "";
  if (subject === "dependency") {
    return `${value} tied by a ${value === 1 ? "dependency" : "dependencies"}`;
  }
  return `${value} ${value === 1 ? "plain link" : "plain links"}`;
}

function planDependencyStageItemsFromVault(stage, query = "", plugin = null) {
  if (!stage) return Object.freeze([]);
  const items = planDependencyStageView({
    current: stage.current,
    candidates: stage.candidates,
    query: query || "",
    dependent: stage.dependent,
    edges: stage.edges,
    linkedKeys: stage.linkedKeys,
    sourceValueSets: stage.sourceValueSets,
  });
  return planTieVisibilityItems(items, stage, "depends", query, plugin);
}

function dependencyStageConsequenceStrip(item, context = {}) {
  if (!item || item.kind === "stage-more") return "";
  const stage = context.stage || {};
  const tie = item.tieInfo || null;
  if (item.disabled) {
    if (item.disabledReason === "would create a cycle" && tie && tie.waitedOnBy) {
      const owner = tieVisibilityOwnerSources(stage)[0];
      const planned = tieVisibilityTieChangePlan(
        stage,
        context.plugin,
        owner,
        item,
        "owner-waits",
      );
      if (planned && planned.kind === "change" && planned.reversing === true) {
        return "⟲ It waits on this task · ⌃B reverses";
      }
    }
    return item.disabledReason || "";
  }
  if (item.stageSection === "current") {
    let text;
    if (item.open !== true) {
      text = "Stops waiting on it · status unchanged";
    } else {
      const owner = tieVisibilityOwnerSources(stage)[0] || {};
      const ownerKey = tieVisibilityOwnerKey(owner, stage);
      const rowKey = tieVisibilityRowKey(item.path, item.blockId);
      const remaining = ownerKey && rowKey
        ? tieVisibilityOpenWaitCount(stage, ownerKey, rowKey)
        : 0;
      text = remaining > 0
        ? `Stops waiting on it · still Blocked (waits on ${remaining})`
        : "Stops waiting on it · Ready again";
    }
    return `${text} · ⌃L keeps a plain link`;
  }
  const owner = tieVisibilityOwnerSources(stage)[0] || stage.dependent || {};
  const projectInfo = tieVisibilityProjectInfo(stage, owner);
  if (projectInfo) {
    const projectItem = {
      ...item,
      isProjectPrj: true,
      projectWaitCount: projectInfo.residents.length + 1,
      projectPomodoroCount: tieVisibilityProjectPomodoroCount(stage, projectInfo, owner),
    };
    return blocksStageConsequenceStrip(projectItem, {
      sources: [owner],
      marked: [],
    });
  }
  if (item.closed === true || item.open === false) {
    return "Waits on it · already done · status unchanged";
  }
  const ownerKey = tieVisibilityOwnerKey(owner, stage);
  const currentOpen = tieVisibilityOpenWaitCount(stage, ownerKey);
  const openAfter = currentOpen + 1;
  const ownerStatus = owner.status || (stage.dependent && stage.dependent.status);
  if (ownerStatus === "?") {
    return `Also waits on it (${openAfter} open)`;
  }
  const parts = ["Waits on it · this task becomes Blocked"];
  const lane = ownerStatus === "/"
    ? "it takes In Progress"
    : ownerStatus === "*"
      ? "it takes Next"
      : "";
  if (lane) parts.push(lane);
  const todayLink = tieVisibilityTodayLink(stage, owner);
  if (todayLink) {
    const link = todayLink;
    const range = link.range ? ` ${link.range}` : "";
    parts.push(`⚠ removes this task's link from ${link.label}${range}`);
  }
  const label = [...(tie && tie.labelledOut || []), ...(tie && tie.labelledIn || [])][0];
  if (label) parts.push(`keeps "${label}"`);
  const prefix = tieVisibilityHasPlainLink(tie) ? "Replaces the 🪢 link · " : "";
  return prefix + parts.join(" · ");
}
