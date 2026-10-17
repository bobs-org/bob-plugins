// Reverse Blocks… stage view (`docs/task-dependencies.md` §15.3–§15.5).
// Pool, edges, and index come from the forward vault stage; this file
// inverts CURRENT, swaps the guards, ranks today-first, and builds the
// consequence strip. Nothing here reads a BLOCKS line.

function blocksStageSourceAliases(source) {
  const aliases = [];
  const idField = normalizeBulletPropertyValue(source && source.idField);
  const blockId = normalizeBulletPropertyValue(source && source.blockId);
  const path = normalizeVaultRelativePath((source && source.path) || "");
  if (idField) {
    aliases.push(idField);
  }
  if (blockId) {
    aliases.push(blockId);
    const encoded = tryDependencyId(path, blockId);
    if (encoded) {
      aliases.push(normalizeBulletPropertyValue(encoded));
    }
  }
  return [...new Set(aliases.filter(Boolean))];
}

function blocksStageSourceFromLine(content, path, line) {
  const text = String(content || "");
  const lines = text.split(/\r?\n/);
  const at = Math.floor(numericOrDefault(line, Number.NaN));
  if (!Number.isFinite(at) || at < 0 || at >= lines.length) {
    return null;
  }
  const rawLine = String(lines[at] || "");
  const blockId = getTrailingBlockId(rawLine);
  const idFieldRaw = findBulletPropertyField(rawLine, "id");
  const idField = idFieldRaw
    ? normalizeBulletPropertyValue(idFieldRaw.value)
    : null;
  const displayText = cleanTaskDisplayText(rawLine);
  const key =
    (blockId && dependencyStageRowKey(path, blockId)) ||
    (idField ? `id:${idField}` : `${normalizeVaultRelativePath(path)}#line:${at}`);
  const source = {
    path: normalizeVaultRelativePath(path),
    line: at,
    rawLine,
    text: rawLine,
    blockId: blockId ? normalizeBulletPropertyValue(blockId) : null,
    idField,
    displayText,
    textDisplay: displayText,
    key,
    status: getObsidianTaskCheckboxStatus(rawLine),
    needsBlockId: !blockId,
    isProjectPrj: Boolean(isProjectPrjDependencyParent(text, path, at)),
    projectResidentKeys: projectDependentResidentKeys(text, path, at),
    projectDescendantPaths: Object.freeze([]),
  };
  source.aliases = Object.freeze(blocksStageSourceAliases(source));
  return Object.freeze(source);
}

function collectBlocksStageSources(stage) {
  const path = normalizeVaultRelativePath(
    (stage && stage.dependent && stage.dependent.path) || "",
  );
  const content =
    (stage && stage.files instanceof Map && stage.files.get(path)) || "";
  const lines = Array.isArray(stage && stage.parentLines)
    ? stage.parentLines
    : [];
  const sources = [];
  for (const line of lines) {
    const source = blocksStageSourceFromLine(content, path, line);
    if (source) {
      sources.push(source);
    }
  }
  return Object.freeze(sources);
}

function taskDependsOnLineIsMalformed(content, parentLine) {
  const text = String(content || "");
  const lines = text.split(/\r?\n/);
  const at = Math.floor(numericOrDefault(parentLine, Number.NaN));
  if (!Number.isFinite(at) || at < 0 || at >= lines.length) {
    return false;
  }
  const verdicts = dependencyHandEditChildVerdicts(lines, at);
  if (verdicts.some((entry) => entry.verdict === "malformed")) {
    return true;
  }
  return verdicts.filter((entry) => entry.verdict === "accept").length > 1;
}

function collectBlocksStageTodayLinks(dailyContent, dailyPath, index) {
  const text = String(dailyContent || "");
  if (!text) {
    return Object.freeze([]);
  }
  const { entries } = collectPomodoroEntries(text);
  const { lines } = splitMarkdownContent(text);
  const open = (Array.isArray(entries) ? entries : []).filter(
    (entry) => entry && entry.open,
  );
  const timedOpen = open.filter(
    (entry) =>
      entry.placeholder !== true &&
      typeof entry.rangeText === "string" &&
      entry.rangeText &&
      entry.rangeText !== "()",
  );
  const runningEntry = timedOpen.length === 1 ? timedOpen[0] : null;
  const ordered = open.slice().sort((left, right) => {
    const leftRun = left === runningEntry ? 0 : 1;
    const rightRun = right === runningEntry ? 0 : 1;
    if (leftRun !== rightRun) {
      return leftRun - rightRun;
    }
    return left.entryLine - right.entryLine;
  });
  const out = [];
  let order = 0;
  for (const entry of ordered) {
    const running = entry === runningEntry;
    const label = String(entry.name || "").trim() || "POMODORO";
    const range = String(entry.rangeText || "").replace(/^\(|\)$/g, "");
    for (
      let line = entry.childStartLine;
      line < entry.childEndLineExclusive;
      line += 1
    ) {
      const lineText = String(lines[line] || "");
      const occurrences = collectPomodoroBlockLinkOccurrences(lineText);
      if (!isDedicatedPomodoroLinkLine(lineText, occurrences)) {
        continue;
      }
      const childBlock = findCurrentBulletChildBlock(lines, line);
      let childNotes = 0;
      if (childBlock && childBlock.endLineExclusive > childBlock.startLine) {
        for (
          let child = childBlock.startLine;
          child < childBlock.endLineExclusive;
          child += 1
        ) {
          if (PROJECT_LIST_ITEM_RE.test(String(lines[child] || ""))) {
            childNotes += 1;
          }
        }
      }
      for (const occurrence of occurrences) {
        if (!occurrence || occurrence.struck) {
          continue;
        }
        const targetPath = resolveDependencyStageLinkTarget(
          occurrence.target,
          occurrence.blockId,
          dailyPath,
          index,
        );
        const key =
          targetPath && occurrence.blockId
            ? dependencyStageRowKey(targetPath, occurrence.blockId)
            : null;
        if (!key) {
          continue;
        }
        out.push(
          Object.freeze({
            key,
            path: targetPath,
            blockId: occurrence.blockId,
            label,
            range,
            running,
            childNotes,
            order: order,
          }),
        );
        order += 1;
      }
    }
  }
  return Object.freeze(out);
}

function blocksStageTodayMap(todayLinks) {
  const map = new Map();
  for (const link of Array.isArray(todayLinks) ? todayLinks : []) {
    if (!link || !link.key || map.has(link.key)) {
      continue;
    }
    map.set(link.key, link);
  }
  return map;
}

function collectBlocksStageCurrent(stage, sources) {
  const sourceList = Array.isArray(sources) ? sources : [];
  const sourceKeys = new Set(sourceList.map((source) => source.key).filter(Boolean));
  const sourceIds = new Set(
    sourceList.flatMap((source) =>
      Array.isArray(source.aliases) ? source.aliases : [],
    ),
  );
  const edges = (stage && stage.edges instanceof Map) ? stage.edges : new Map();
  const index = stage && stage.index;
  const byKey = index && index.byKey instanceof Map ? index.byKey : new Map();
  const candidates = Array.isArray(stage && stage.candidates)
    ? stage.candidates
    : [];
  const rows = [];
  const seen = new Set();
  const pushRecord = (record, extra = {}) => {
    if (!record) {
      return;
    }
    const key =
      record.path && record.blockId
        ? dependencyStageRowKey(record.path, record.blockId)
        : extra.key || null;
    const dedupe = key || `${record.path || ""}#${record.line}`;
    if (seen.has(dedupe)) {
      return;
    }
    seen.add(dedupe);
    rows.push(
      Object.freeze({
        kind: "current",
        path: record.path,
        blockId: record.blockId || null,
        route: record.route || dependencyStageRouteOf(record.path || ""),
        note: record.note || dependencyStageBasenameOf(record.path || ""),
        line: record.line,
        rawLine: record.rawLine,
        status: record.status,
        displayText: record.displayText || record.text,
        text: record.text || record.displayText,
        idField: record.idField || record.existingIdField || null,
        existingBlockId: record.blockId || record.existingBlockId || null,
        existingIdField: record.idField || record.existingIdField || null,
        section: record.section || null,
        open: record.open !== false,
        blocked: record.status === "?" || record.blocked === true,
        hidden: Boolean(record.hidden),
        dependsOn: Array.isArray(record.dependsOn) ? record.dependsOn : [],
        openCount: record.openCount,
        scheduledDate: record.scheduledDate || null,
        ...extra,
      }),
    );
  };
  for (const [from, targets] of edges) {
    if (!Array.isArray(targets) || !targets.some((target) => sourceKeys.has(target))) {
      continue;
    }
    const record = byKey.get(from) || candidates.find((row) => {
      const key =
        row.path && row.blockId
          ? dependencyStageRowKey(row.path, row.blockId)
          : null;
      return key === from;
    });
    if (record && record.open === false) {
      continue;
    }
    pushRecord(record || { path: null, blockId: null, displayText: from }, {
      key: from,
    });
  }
  const cacheTasks = [];
  if (index && index.byIdField instanceof Map) {
    for (const candidate of candidates) {
      if (Array.isArray(candidate.dependsOn) && candidate.dependsOn.length > 0) {
        cacheTasks.push(candidate);
      }
    }
  }
  for (const record of cacheTasks) {
    const hits = (record.dependsOn || []).some((id) =>
      sourceIds.has(normalizeBulletPropertyValue(id)),
    );
    if (!hits || record.open === false) {
      continue;
    }
    pushRecord(record);
  }
  return Object.freeze(rows);
}

function blocksStageRowKey(row) {
  if (!row) {
    return null;
  }
  if (row.path && row.blockId) {
    return dependencyStageRowKey(row.path, row.blockId);
  }
  return null;
}

function blocksStageLinkedCount(candidate, sources, edges) {
  const sourceList = Array.isArray(sources) ? sources : [];
  if (sourceList.length === 0) {
    return 0;
  }
  const dependsOn = new Set(
    (Array.isArray(candidate.dependsOn) ? candidate.dependsOn : []).map(
      (id) => normalizeBulletPropertyValue(id),
    ),
  );
  const key = blocksStageRowKey(candidate);
  const edgeTargets =
    key && edges instanceof Map ? edges.get(key) || [] : [];
  let count = 0;
  for (const source of sourceList) {
    const aliases = Array.isArray(source.aliases) ? source.aliases : [];
    const hit =
      (source.key && edgeTargets.includes(source.key)) ||
      aliases.some((alias) => dependsOn.has(alias));
    if (hit) {
      count += 1;
    }
  }
  return count;
}

function blocksStageIsLastReason(candidate, sources, edges, files) {
  const linked = blocksStageLinkedCount(candidate, sources, edges);
  if (linked <= 0) {
    return false;
  }
  const key = blocksStageRowKey(candidate);
  const edgeCount =
    key && edges instanceof Map && edges.get(key)
      ? edges.get(key).length
      : 0;
  const open =
    Number.isInteger(candidate.openCount) && candidate.openCount >= 0
      ? candidate.openCount
      : edgeCount;
  if (open > linked) {
    return false;
  }
  const content =
    files instanceof Map
      ? files.get(normalizeVaultRelativePath(candidate.path || ""))
      : null;
  const rawLine =
    candidate.rawLine ||
    (typeof content === "string" && Number.isInteger(candidate.line)
      ? String(content.split(/\r?\n/)[candidate.line] || "")
      : "");
  if (taskHasProjectBlockedTag(rawLine)) {
    return false;
  }
  if (
    rawLine &&
    dependencyParentHasFutureSchedule(rawLine)
  ) {
    return false;
  }
  return true;
}

function compareBlocksStageResults(left, right, sourcePath, todayMap) {
  const leftHidden = Boolean(left.hidden);
  const rightHidden = Boolean(right.hidden);
  if (leftHidden !== rightHidden) {
    return leftHidden ? 1 : -1;
  }
  const leftKey = blocksStageRowKey(left);
  const rightKey = blocksStageRowKey(right);
  const leftToday = leftKey && todayMap.has(leftKey) ? todayMap.get(leftKey) : null;
  const rightToday = rightKey && todayMap.has(rightKey) ? todayMap.get(rightKey) : null;
  if (leftToday || rightToday) {
    if (!leftToday) {
      return 1;
    }
    if (!rightToday) {
      return -1;
    }
    if (leftToday.order !== rightToday.order) {
      return leftToday.order - rightToday.order;
    }
  }
  const lane = (status) =>
    status === "/" ? 0 : status === "*" ? 1 : status === " " ? 2 : 3;
  const leftLane = lane(left.status);
  const rightLane = lane(right.status);
  if (leftLane !== rightLane && (leftLane <= 1 || rightLane <= 1)) {
    if (leftLane <= 1 && rightLane <= 1) {
      return leftLane - rightLane;
    }
    if (leftLane <= 1) {
      return -1;
    }
    if (rightLane <= 1) {
      return 1;
    }
  }
  const leftSame = left.path === sourcePath;
  const rightSame = right.path === sourcePath;
  if (leftSame !== rightSame) {
    return leftSame ? -1 : 1;
  }
  if (leftSame && rightSame) {
    return (left.line || 0) - (right.line || 0);
  }
  if (leftLane !== rightLane) {
    return leftLane - rightLane;
  }
  if (left.path !== right.path) {
    return String(left.path || "") < String(right.path || "") ? -1 : 1;
  }
  return (left.line || 0) - (right.line || 0);
}

function blocksStageGuard(candidate, sources, edges, files, labelByKey) {
  const sourceList = Array.isArray(sources) ? sources : [];
  const candidateKey = blocksStageRowKey(candidate);
  const labelCycle = (cycle) =>
    Object.freeze(
      (Array.isArray(cycle) ? cycle : []).map((key) =>
        labelByKey.has(key) ? labelByKey.get(key) : key,
      ),
    );
  const content =
    files instanceof Map
      ? files.get(normalizeVaultRelativePath(candidate.path || ""))
      : null;
  if (
    typeof content === "string" &&
    Number.isInteger(candidate.line) &&
    taskDependsOnLineIsMalformed(content, candidate.line)
  ) {
    return {
      disabled: true,
      reason: "its Depends-On line is malformed",
      cycle: null,
      cycleLabels: null,
    };
  }
  const candidateIsPrj =
    typeof content === "string" && Number.isInteger(candidate.line)
      ? Boolean(
          isProjectPrjDependencyParent(
            content,
            candidate.path,
            candidate.line,
          ),
        )
      : Boolean(candidate.isProjectPrj);
  const descendantPaths = new Set(
    (
      candidateIsPrj && Array.isArray(candidate.projectDescendantPaths)
        ? candidate.projectDescendantPaths
        : []
    ).map((path) => normalizeVaultRelativePath(path)),
  );
  if (candidateIsPrj && descendantPaths.size === 0 && files instanceof Map) {
    for (const path of collectProjectDescendantPathsFromNotes(
      candidate.path,
      files,
    )) {
      descendantPaths.add(path);
    }
  }
  for (const source of sourceList) {
    if (
      source.path === candidate.path &&
      source.line === candidate.line
    ) {
      const selfCycle = Object.freeze([source.key || candidateKey].filter(Boolean));
      return {
        disabled: true,
        reason: "this task",
        cycle: selfCycle,
        cycleLabels: labelCycle(selfCycle),
      };
    }
    if (candidateIsPrj && source.path === candidate.path) {
      return {
        disabled: true,
        reason: "inside this project",
        cycle: null,
        cycleLabels: null,
      };
    }
    if (
      candidateIsPrj &&
      source.path &&
      descendantPaths.has(normalizeVaultRelativePath(source.path))
    ) {
      return {
        disabled: true,
        reason: "inside a sub-project of this project",
        cycle: null,
        cycleLabels: null,
      };
    }
    if (candidateKey && source.key) {
      let cycle = findDependencyStageCycle(edges, candidateKey, source.key);
      if (!cycle && candidateIsPrj) {
        const residentKeys = Array.isArray(candidate.projectResidentKeys)
          ? candidate.projectResidentKeys
          : typeof content === "string"
            ? projectDependentResidentKeys(
                content,
                candidate.path,
                candidate.line,
              )
            : [];
        for (const residentKey of residentKeys) {
          if (!residentKey || residentKey === candidateKey) {
            continue;
          }
          cycle = findDependencyStageCycle(edges, residentKey, source.key);
          if (cycle) {
            break;
          }
        }
      }
      if (cycle) {
        return {
          disabled: true,
          reason: "would create a cycle",
          cycle: Object.freeze(cycle),
          cycleLabels: labelCycle(cycle),
        };
      }
    }
  }
  return { disabled: false, reason: null, cycle: null, cycleLabels: null };
}

function decorateBlocksVaultStage(stage, options = {}) {
  if (!stage) {
    return null;
  }
  const sources =
    Array.isArray(options.sources) && options.sources.length > 0
      ? options.sources
      : collectBlocksStageSources(stage);
  const files = stage.files instanceof Map ? stage.files : new Map();
  let todayLinks = Array.isArray(options.todayLinks)
    ? options.todayLinks
    : Array.isArray(stage.todayLinks)
      ? stage.todayLinks
      : [];
  if (todayLinks.length === 0 && options.dailyPath && files.has(options.dailyPath)) {
    todayLinks = collectBlocksStageTodayLinks(
      files.get(options.dailyPath),
      options.dailyPath,
      stage.index,
    );
  }
  const current = collectBlocksStageCurrent(stage, sources);
  const edges = stage.edges instanceof Map ? stage.edges : new Map();
  let freesCount = 0;
  for (const row of current) {
    if (blocksStageIsLastReason(row, sources, edges, files)) {
      freesCount += 1;
    }
  }
  const primary = sources[0];
  const title =
    sources.length > 1
      ? `\ud83e\uddf1 Blocks \u00b7 ${formatCountLabel(sources.length, "task")}`
      : `\ud83e\uddf1 Blocks \u00b7 ${String(
          (primary && primary.displayText) || "",
        ).slice(0, 48)}`;
  const linkedKeys = new Set();
  for (const row of current) {
    const key = blocksStageRowKey(row);
    if (key) {
      linkedKeys.add(key);
    }
  }
  return {
    ...stage,
    blocks: true,
    sources: Object.freeze(sources),
    current: Object.freeze(current),
    todayLinks: Object.freeze(todayLinks),
    linkedKeys,
    title,
    openCount: current.length,
    freesCount,
    poolSize: Array.isArray(stage.candidates) ? stage.candidates.length : 0,
  };
}

function planBlocksStageView(args = {}) {
  const sources = Array.isArray(args.sources) ? args.sources : [];
  const current = Array.isArray(args.current) ? args.current : [];
  const pool = Array.isArray(args.candidates) ? args.candidates : [];
  const query = String(args.query || "");
  const edges = args.edges || new Map();
  const files = args.files instanceof Map ? args.files : new Map();
  const todayMap = blocksStageTodayMap(args.todayLinks);
  const sourcePath = sources[0] ? sources[0].path : "";
  const sourceKeys = new Set(sources.map((source) => source.key).filter(Boolean));
  const sourceLines = new Set(
    sources.map((source) => `${source.path}\x00${source.line}`),
  );
  const maxRows = Math.max(
    1,
    Math.floor(numericOrDefault(args.maxRows, DEPENDENCY_STAGE_MAX_ROWS)),
  );
  const sourceCount = Math.max(1, sources.length || 1);
  const labelByKey = new Map();
  for (const row of [...current, ...pool, ...sources]) {
    if (!row) {
      continue;
    }
    const key = blocksStageRowKey(row) || row.key || null;
    const label = row.displayText || row.text || null;
    if (key && label && !labelByKey.has(key)) {
      labelByKey.set(key, label);
    }
  }
  const fullyLinked = [];
  const partialLinked = [];
  for (const row of current) {
    const linked = blocksStageLinkedCount(row, sources, edges);
    if (linked > 0 && linked < sourceCount) {
      partialLinked.push(row);
      continue;
    }
    fullyLinked.push(row);
  }
  const markedCurrent = fullyLinked.map((row, index) => {
    const lastReason = blocksStageIsLastReason(row, sources, edges, files);
    const key = blocksStageRowKey(row);
    const todayLink = key && todayMap.has(key) ? todayMap.get(key) : null;
    return Object.freeze({
      kind: "local-task",
      ...row,
      stageSection: "current",
      alreadyLinked: true,
      firstInSection: index === 0,
      lastReason,
      todayLink,
      linkedSourceCount: sourceCount,
      sourceCount,
      linkState: "all",
      needsPromptForAdd: false,
      needsBlockIdPrompt: false,
      markKey:
        row.markKey ||
        (row.path
          ? `${normalizeVaultRelativePath(row.path)}#${row.blockId || `line:${row.line}`}`
          : row.line),
      noteLabel:
        row.path && row.path !== sourcePath
          ? dependencyStageBasenameOf(row.path)
          : null,
      disabled: false,
      disabledReason: null,
      cycle: null,
      cycleLabels: null,
    });
  });
  const seen = new Set(
    fullyLinked
      .map((row) => blocksStageRowKey(row))
      .filter(Boolean),
  );
  const fresh = [];
  for (const row of partialLinked) {
    const key = blocksStageRowKey(row);
    if (key) {
      seen.add(key);
    }
    fresh.push({
      candidate: row,
      key,
      linkedCount: blocksStageLinkedCount(row, sources, edges),
    });
  }
  for (const candidate of pool) {
    const lineKey = `${normalizeVaultRelativePath(candidate.path || "")}\x00${candidate.line}`;
    if (sourceLines.has(lineKey)) {
      continue;
    }
    const key = blocksStageRowKey(candidate);
    if (key && sourceKeys.has(key)) {
      continue;
    }
    const linkedCount = blocksStageLinkedCount(candidate, sources, edges);
    if (linkedCount > 0 && linkedCount === sourceCount) {
      continue;
    }
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    fresh.push({ candidate, key, linkedCount });
  }
  let ordered;
  if (!query.trim()) {
    ordered = fresh
      .slice()
      .sort((left, right) =>
        compareBlocksStageResults(
          left.candidate,
          right.candidate,
          sourcePath,
          todayMap,
        ),
      )
      .map((entry) => entry);
  } else {
    const ranked = dependencyStageRank(
      fresh.map((entry) => entry.candidate),
      query,
    );
    const rankIndex = new Map(ranked.map((candidate, index) => [candidate, index]));
    ordered = fresh
      .slice()
      .sort((left, right) => {
        const leftRank = rankIndex.has(left.candidate)
          ? rankIndex.get(left.candidate)
          : Number.POSITIVE_INFINITY;
        const rightRank = rankIndex.has(right.candidate)
          ? rankIndex.get(right.candidate)
          : Number.POSITIVE_INFINITY;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        return compareBlocksStageResults(
          left.candidate,
          right.candidate,
          sourcePath,
          todayMap,
        );
      })
      .filter((entry) => rankIndex.has(entry.candidate));
  }
  const results = [];
  const blocked = [];
  for (const entry of ordered) {
    if (entry.candidate.blocked || entry.candidate.status === "?") {
      blocked.push(entry);
    } else {
      results.push(entry);
    }
  }
  const room = Math.max(0, maxRows - markedCurrent.length);
  const picked = [...results, ...blocked].slice(0, room);
  const shape = (entry, section, first) => {
    const candidate = entry.candidate;
    const verdict = blocksStageGuard(
      candidate,
      sources,
      edges,
      files,
      labelByKey,
    );
    const key = blocksStageRowKey(candidate);
    const todayLink = key && todayMap.has(key) ? todayMap.get(key) : null;
    const content =
      files instanceof Map
        ? files.get(normalizeVaultRelativePath(candidate.path || ""))
        : null;
    const isProjectPrj =
      typeof content === "string" && Number.isInteger(candidate.line)
        ? Boolean(
            isProjectPrjDependencyParent(
              content,
              candidate.path,
              candidate.line,
            ),
          )
        : false;
    let projectWaitCount = 0;
    let projectPomodoroCount = 0;
    let projectResidentKeys = Object.freeze([]);
    if (isProjectPrj && typeof content === "string") {
      const info = getProjectPrjDependencyResidents(content, candidate.path);
      projectResidentKeys = projectDependentResidentKeys(
        content,
        candidate.path,
        candidate.line,
      );
      if (info && Array.isArray(info.residents)) {
        projectWaitCount = info.residents.length + 1;
        for (const resident of info.residents) {
          const residentKey =
            resident.blockId &&
            dependencyStageRowKey(candidate.path, resident.blockId);
          if (residentKey && todayMap.has(residentKey)) {
            projectPomodoroCount += 1;
          }
        }
        if (todayLink) {
          projectPomodoroCount += 1;
        }
      }
    }
    let waitsOn = null;
    let blockedBadge = null;
    if (section === "blocked") {
      const open =
        Number.isInteger(candidate.openCount) && candidate.openCount >= 0
          ? candidate.openCount
          : 0;
      if (open >= 1) {
        waitsOn = open;
        blockedBadge = `\ud83d\udd12 waits on ${open}`;
      } else {
        const scheduled =
          typeof candidate.scheduledDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(candidate.scheduledDate)
            ? candidate.scheduledDate
            : null;
        blockedBadge = scheduled
          ? `\ud83d\udd12 scheduled ${scheduled}`
          : "\ud83d\udd12 blocked";
      }
    }
    const linkedCount = entry.linkedCount || 0;
    return Object.freeze({
      kind: "local-task",
      stageSection: section,
      firstInSection: first,
      path: candidate.path,
      blockId: candidate.blockId,
      route: candidate.route,
      note: candidate.note,
      noteLabel:
        candidate.path && candidate.path !== sourcePath
          ? dependencyStageBasenameOf(candidate.path)
          : null,
      line: candidate.line,
      rawLine: candidate.rawLine,
      status: candidate.status,
      displayText: candidate.displayText,
      text: candidate.text,
      searchText: [
        candidate.displayText,
        candidate.route,
        candidate.blockId ? `${candidate.route}:${candidate.blockId}` : "",
        candidate.blockId || "",
        candidate.section || "",
        candidate.note || "",
      ]
        .filter(Boolean)
        .join(" "),
      value:
        candidate.idField ||
        (candidate.blockId
          ? tryDependencyId(candidate.path, candidate.blockId)
          : null) ||
        "",
      alreadyLinked: false,
      linkedSourceCount: linkedCount,
      sourceCount,
      linkState:
        linkedCount === 0
          ? "none"
          : linkedCount >= sourceCount
            ? "all"
            : "mixed",
      needsBlockIdPrompt: false,
      needsPromptForAdd: false,
      hidden: candidate.hidden,
      section: candidate.section,
      markKey: `${candidate.path}#${
        candidate.line >= 0
          ? candidate.line
          : candidate.blockId || candidate.displayText
      }`,
      disabled: verdict.disabled,
      disabledReason: verdict.reason,
      cycle: verdict.cycle,
      cycleLabels: verdict.cycleLabels || null,
      waitsOn,
      blockedBadge,
      openCount: candidate.openCount,
      lastReason: false,
      todayLink,
      isProjectPrj,
      projectWaitCount,
      projectPomodoroCount,
      projectResidentKeys,
      dependsOn: Array.isArray(candidate.dependsOn) ? candidate.dependsOn : [],
    });
  };
  const out = [...markedCurrent];
  const pickedResults = picked.filter(
    (entry) => !(entry.candidate.blocked || entry.candidate.status === "?"),
  );
  const pickedBlocked = picked.filter(
    (entry) => entry.candidate.blocked || entry.candidate.status === "?",
  );
  pickedResults.forEach((entry, index) =>
    out.push(shape(entry, "results", index === 0)),
  );
  pickedBlocked.forEach((entry, index) =>
    out.push(shape(entry, "blocked", index === 0)),
  );
  const totalOrdered = results.length + blocked.length;
  const hiddenCount = Math.max(0, totalOrdered - picked.length);
  if (hiddenCount > 0) {
    out.push(
      Object.freeze({
        kind: "stage-more",
        stageSection: pickedBlocked.length > 0 ? "blocked" : "results",
        firstInSection: false,
        path: null,
        blockId: null,
        displayText: `type to search ${hiddenCount} more`,
        text: `type to search ${hiddenCount} more`,
        searchText: "",
        hiddenCount,
        disabled: true,
        disabledReason: `type to search ${hiddenCount} more`,
        cycle: null,
        cycleLabels: null,
        waitsOn: null,
      }),
    );
  }
  return Object.freeze(out);
}

function planBlocksStageItemsFromVault(stage, query) {
  if (!stage) {
    return Object.freeze([]);
  }
  return planBlocksStageView({
    sources: stage.sources,
    current: stage.current,
    candidates: stage.candidates,
    query: query || "",
    edges: stage.edges,
    files: stage.files,
    todayLinks: stage.todayLinks,
  });
}
