function parseRetirementListLine(lineText) {
  const text = String(lineText || "");
  const match = text.match(/^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+(.*)$/);
  if (!match) {
    return null;
  }
  return {
    indentation: match[1].length,
    taskStatus: getTaskStatusForLine(text),
  };
}

function hasEligibleRetirementAncestor(
  lines,
  lineNumber,
  fenced,
  pomodoros,
) {
  const candidate = parseRetirementListLine(lines[lineNumber]);
  if (!candidate || candidate.indentation === 0) {
    return { eligible: false, pomodoro: false };
  }
  let indentation = candidate.indentation;
  for (let line = lineNumber - 1; line >= 0; line -= 1) {
    if (fenced.has(line)) {
      continue;
    }
    const text = String(lines[line] || "");
    if (parseMarkdownHeadingLine(text)) {
      break;
    }
    const ancestor = parseRetirementListLine(text);
    if (!ancestor) {
      if (text.trim()) {
        break;
      }
      continue;
    }
    if (ancestor.indentation >= indentation) {
      continue;
    }
    indentation = ancestor.indentation;
    if (ancestor.taskStatus && lineMatchesTasksGlobalFilterText(text)) {
      return { eligible: true, pomodoro: false };
    }
    if (
      ancestor.taskStatus &&
      ancestor.indentation === 0 &&
      lineIsInPomodorosSection(pomodoros, line)
    ) {
      return {
        eligible: true,
        pomodoro: true,
      };
    }
    if (indentation === 0) {
      break;
    }
  }
  return { eligible: false, pomodoro: false };
}

function retirementIdentityKey(path, blockId) {
  return `${String(path || "")}#^${String(blockId || "")}`;
}

function validTaskDependencyIdentity(value) {
  return TASKS_DEPENDENCY_ID_RE.test(String(value || ""));
}

function parseTaskDependencyIds(value) {
  const text = String(value || "");
  if (!text || text.includes("\t")) {
    return null;
  }
  const ids = text.split(",").map((part) => part.replace(/^ +| +$/g, ""));
  return ids.every(validTaskDependencyIdentity) ? ids : null;
}

function parseTaskDependencyMetadata(lineText) {
  const line = String(lineText || "");
  const metadata = { taskId: null, dependsOn: [] };
  let foundDependsOn = false;
  let match;
  TASK_DEPENDENCY_FIELD_RE.lastIndex = 0;
  while ((match = TASK_DEPENDENCY_FIELD_RE.exec(line)) !== null) {
    const key = match[1] || match[3];
    const value = String(match[2] ?? match[4] ?? "").trim();
    if (key === "id" && metadata.taskId === null) {
      if (validTaskDependencyIdentity(value)) {
        metadata.taskId = value;
      }
      continue;
    }
    if (key === "dependsOn" && !foundDependsOn) {
      const ids = parseTaskDependencyIds(value);
      if (ids) {
        metadata.dependsOn = ids;
      }
      foundDependsOn = true;
    }
  }
  return metadata;
}

function parseTaskDependencyLine(lineText, path = "", line = 0) {
  const taskStatus = getTaskStatusForLine(lineText, line);
  if (!taskStatus || !lineMatchesTasksGlobalFilterText(lineText)) {
    return null;
  }
  const metadata = parseTaskDependencyMetadata(lineText);
  return {
    path: String(path || ""),
    line,
    lineText: String(lineText || ""),
    status: taskStatus.symbol,
    statusStart: taskStatus.statusStart,
    blockId: getTrailingBlockId(lineText),
    taskId: metadata.taskId,
    dependsOn: metadata.dependsOn,
  };
}

function parseTaskDependencyDocument(sourceText, path = "") {
  const sourceLines = splitTextByLineEndings(sourceText);
  const lines = sourceLines.map((line) => line.text);
  const fenced = getFencedLineNumbers(lines);
  const tasks = [];
  for (let line = 0; line < lines.length; line += 1) {
    if (fenced.has(line)) {
      continue;
    }
    const task = parseTaskDependencyLine(lines[line], path, line);
    if (task) {
      tasks.push(task);
    }
  }
  return tasks;
}

function closedTaskIdentity(path, lineText) {
  const blockId = getTrailingBlockId(lineText);
  const taskId = lineMatchesTasksGlobalFilterText(lineText)
    ? parseTaskDependencyMetadata(lineText).taskId
    : null;
  if (!path || (!blockId && !taskId)) {
    return null;
  }
  return {
    path: String(path),
    ...(blockId ? { blockId } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

function normalizeClosedTaskIdentities(identities) {
  const normalized = [];
  const seen = new Set();
  for (const identity of Array.from(identities || [])) {
    if (!identity || !identity.path) {
      continue;
    }
    const blockId = BLOCK_ID_RE.test(String(identity.blockId || ""))
      ? String(identity.blockId)
      : null;
    const taskId = validTaskDependencyIdentity(identity.taskId)
      ? String(identity.taskId)
      : null;
    if (!blockId && !taskId) {
      continue;
    }
    // The recursive close's anchor root survives normalization: matching
    // still uses only nonempty `taskId` values, while the successor pass
    // inherits the planned slot from `rootKey`. A root never names itself.
    let root = identity && identity.rootKey && identity.rootKey.path
      ? {
        path: String(identity.rootKey.path),
        ...(BLOCK_ID_RE.test(String(identity.rootKey.blockId || ""))
          ? { blockId: String(identity.rootKey.blockId) }
          : {}),
      }
      : null;
    // A root never names itself: drop a self-referencing rootKey so the
    // anchor pass cannot inherit a task from itself.
    if (
      root && root.path === String(identity.path) &&
      (root.blockId || "") === (blockId || "")
    ) {
      root = null;
    }
    const next = {
      path: String(identity.path),
      ...(blockId ? { blockId } : {}),
      ...(taskId ? { taskId } : {}),
      ...(root ? { rootKey: root } : {}),
    };
    const key = `${next.path}\0${blockId || ""}\0${taskId || ""}\0${
      root ? `${root.path}\0${root.blockId || ""}` : ""
    }`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(next);
  }
  return normalized;
}

function buildBlockedDependentRecoveryPlan(
  documents,
  closedIdentities,
  options = {},
) {
  // A Blocked dependent that still carries a strictly future `scheduled` date
  // stays Blocked: reopening it would fight `bob task reconcile`, which
  // re-blocks future-scheduled tasks. Callers that close tasks through the
  // vault pass their own date via `options.today`; it defaults to today.
  const today =
    options && typeof options.today === "string" && options.today
      ? options.today
      : formatLocalDate();
  const parsedDocuments = Array.from(documents || []).map((document) => ({
    ...document,
    path: String((document && document.path) || ""),
    text: String((document && document.text) || ""),
    tasks: parseTaskDependencyDocument(
      document && document.text,
      document && document.path,
    ),
  }));
  // A Warm caller may supply the complete open/closed sets (built over the
  // full Tasks index) so only candidate bodies need reading; otherwise
  // both sets derive from the parsed documents exactly as before.
  const openIds = new Set(
    options && options.openIds ? Array.from(options.openIds, String) : [],
  );
  if (!options || !options.openIds) {
    for (const document of parsedDocuments) {
      for (const task of document.tasks) {
        if (
          task.taskId &&
          DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status)
        ) {
          openIds.add(task.taskId);
        }
      }
    }
  }

  const closedIds = new Set(
    options && options.closedIds ? Array.from(options.closedIds, String) : [],
  );
  const closed = normalizeClosedTaskIdentities(closedIdentities);
  for (const identity of closed) {
    if (identity.taskId) {
      closedIds.add(identity.taskId);
    }
    if (!identity.blockId) {
      continue;
    }
    const document = parsedDocuments.find(
      (candidate) => candidate.path === identity.path,
    );
    const task = document && document.tasks.find(
      (candidate) => candidate.blockId === identity.blockId,
    );
    if (task && task.taskId) {
      closedIds.add(task.taskId);
    }
  }

  const edits = [];
  const seenEdits = new Set();
  for (const document of parsedDocuments) {
    for (const task of document.tasks) {
      if (
        task.status !== "?" ||
        !task.dependsOn.some((id) => closedIds.has(id)) ||
        task.dependsOn.some((id) => openIds.has(id)) ||
        findSingleFutureScheduledField(task.lineText, today)
      ) {
        continue;
      }
      const key = `${task.path}\0${task.line}`;
      if (seenEdits.has(key)) {
        continue;
      }
      seenEdits.add(key);
      edits.push({
        path: task.path,
        line: task.line,
        sourceLineText: task.lineText,
        statusStart: task.statusStart,
        taskId: task.taskId,
        dependsOn: task.dependsOn.slice(),
      });
    }
  }

  return {
    documents: parsedDocuments,
    openIds: [...openIds].sort(),
    closedIds: [...closedIds].sort(),
    edits,
  };
}

function applyBlockedDependentRecoveryEdits(sourceText, edits) {
  const sourceLines = splitTextByLineEndings(sourceText);
  let reopened = 0;
  const stale = [];
  const seen = new Set();
  for (const edit of Array.from(edits || [])) {
    const key = `${edit.line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const sourceLine = sourceLines[edit.line];
    if (!sourceLine || sourceLine.text !== edit.sourceLineText) {
      stale.push(edit);
      continue;
    }
    const task = parseTaskDependencyLine(
      sourceLine.text,
      edit.path,
      edit.line,
    );
    if (!task || task.status !== "?" || task.statusStart !== edit.statusStart) {
      stale.push(edit);
      continue;
    }
    sourceLine.text = `${sourceLine.text.slice(0, task.statusStart)} ${sourceLine.text.slice(task.statusStart + 1)}`;
    reopened += 1;
  }
  return {
    text: sourceLines.map((line) => `${line.text}${line.ending}`).join(""),
    reopened,
    stale,
  };
}

function normalizeTaskReferenceIdentities(identities) {
  const normalized = [];
  const seen = new Set();
  for (const identity of Array.from(identities || [])) {
    if (
      !identity ||
      !identity.path ||
      !BLOCK_ID_RE.test(String(identity.blockId || ""))
    ) {
      continue;
    }
    const next = {
      path: String(identity.path),
      blockId: String(identity.blockId),
    };
    const key = retirementIdentityKey(next.path, next.blockId);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(next);
  }
  return normalized;
}

// Retire matching embedded block links only inside managed task/Pomodoro list
// trees. Resolution is injected so the parser remains deterministic and easy
// to test while runtime callers can use Obsidian's link resolver.
function retireClosedTaskReferencesInText(
  sourceText,
  originPath,
  closedIdentities,
  resolveLinkPath,
) {
  const sourceLines = splitTextByLineEndings(sourceText);
  const lines = sourceLines.map((line) => line.text);
  const fenced = getFencedLineNumbers(lines);
  const pomodoros = findPomodorosSectionInLines(lines);
  const closed = new Set(
    Array.from(closedIdentities || []).map((identity) =>
      retirementIdentityKey(identity.path, identity.blockId),
    ),
  );
  let retired = 0;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    if (
      fenced.has(lineNumber) ||
      !lines[lineNumber].includes("![[") ||
      isTaskDependencyLine(lines[lineNumber])
    ) {
      continue;
    }
    const ancestry = hasEligibleRetirementAncestor(
      lines,
      lineNumber,
      fenced,
      pomodoros,
    );
    if (!ancestry.eligible) {
      continue;
    }
    const line = lines[lineNumber];
    const strikeSpans = getStrikethroughSpans(line);
    const edits = [];
    for (const candidate of parseEmbeddedBlockTransclusions(line)) {
      const resolved = candidate.pathPart
        ? resolveLinkPath(candidate.pathPart, originPath)
        : originPath;
      const resolvedPath =
        resolved && typeof resolved === "object" ? resolved.path : resolved;
      if (
        !closed.has(retirementIdentityKey(resolvedPath, candidate.blockId))
      ) {
        continue;
      }
      const edit = buildRetiredBlockLinkEdit(
        line,
        { ...candidate, embedded: true },
        strikeSpans,
        ancestry.pomodoro,
      );
      if (edit) {
        edits.push(edit);
      }
    }
    if (edits.length === 0) {
      continue;
    }
    let nextLine = line;
    for (const edit of edits.sort((left, right) => right.start - left.start)) {
      nextLine = `${nextLine.slice(0, edit.start)}${edit.text}${nextLine.slice(edit.end)}`;
      retired += 1;
    }
    lines[lineNumber] = nextLine;
    sourceLines[lineNumber].text = nextLine;
  }

  const text = sourceLines.map((line) => `${line.text}${line.ending}`).join("");
  return { text, changed: text !== String(sourceText || ""), retired };
}

// Restore matching retired block links inside the same managed ancestry used
// by close-time retirement. Exact per-link strike wrappers are attributable to
// retirement and can be removed safely. Task descendants regain transclusion;
// Pomodoro descendants remain plain historical links. When a task link sits in
// a broader authored strike span, restore only its embed marker and preserve
// the surrounding formatting.
function restoreReopenedTaskReferencesInText(
  sourceText,
  originPath,
  reopenedIdentities,
  resolveLinkPath,
) {
  const sourceLines = splitTextByLineEndings(sourceText);
  const lines = sourceLines.map((line) => line.text);
  const fenced = getFencedLineNumbers(lines);
  const pomodoros = findPomodorosSectionInLines(lines);
  const reopened = new Set(
    normalizeTaskReferenceIdentities(reopenedIdentities).map((identity) =>
      retirementIdentityKey(identity.path, identity.blockId),
    ),
  );
  let restored = 0;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    if (
      fenced.has(lineNumber) ||
      !lines[lineNumber].includes("[[") ||
      isTaskDependencyLine(lines[lineNumber])
    ) {
      continue;
    }
    const ancestry = hasEligibleRetirementAncestor(
      lines,
      lineNumber,
      fenced,
      pomodoros,
    );
    if (!ancestry.eligible) {
      continue;
    }
    const line = lines[lineNumber];
    const strikeSpans = getStrikethroughSpans(line);
    const edits = [];
    for (const candidate of parseNonEmbeddedBlockLinks(line)) {
      const resolved = candidate.pathPart
        ? resolveLinkPath(candidate.pathPart, originPath)
        : originPath;
      const resolvedPath =
        resolved && typeof resolved === "object" ? resolved.path : resolved;
      if (
        !reopened.has(retirementIdentityKey(resolvedPath, candidate.blockId))
      ) {
        continue;
      }
      const exactStrike = strikeSpans.find(
        (span) =>
          candidate.startIndex === span.start && candidate.endIndex === span.end,
      );
      const struck = rangeIsStruck(
        candidate.startIndex,
        candidate.endIndex,
        strikeSpans,
      );
      if (!struck || (!exactStrike && ancestry.pomodoro)) {
        continue;
      }
      const wikilink = line.slice(candidate.startIndex, candidate.endIndex);
      edits.push(
        exactStrike
          ? {
              start: exactStrike.start - 2,
              end: exactStrike.end + 2,
              text: ancestry.pomodoro ? wikilink : `!${wikilink}`,
            }
          : {
              start: candidate.startIndex,
              end: candidate.startIndex,
              text: "!",
            },
      );
    }
    if (edits.length === 0) {
      continue;
    }
    let nextLine = line;
    for (const edit of edits.sort((left, right) => right.start - left.start)) {
      nextLine = `${nextLine.slice(0, edit.start)}${edit.text}${nextLine.slice(edit.end)}`;
      restored += 1;
    }
    lines[lineNumber] = nextLine;
    sourceLines[lineNumber].text = nextLine;
  }

  const text = sourceLines.map((line) => `${line.text}${line.ending}`).join("");
  return { text, changed: text !== String(sourceText || ""), restored };
}
