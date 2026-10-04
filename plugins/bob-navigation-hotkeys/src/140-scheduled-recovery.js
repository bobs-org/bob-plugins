function getScheduledRecoveryMetadata(index, filePath, line) {
  if (!index || !index.registry || !index.registry.safe) {
    return deferredScheduledRecovery(
      index && index.error
        ? index.error
        : "Tasks status registry is unavailable",
    );
  }
  const path = normalizeVaultRelativePath(filePath);
  const task = index.tasksByTarget.get(
    recoveryIdentity(path, String(line)),
  );
  if (!task || task.status !== "?" || !task.statusRecognized) {
    return deferredScheduledRecovery(
      "selected Blocked task could not be identified safely",
    );
  }

  let dependencyAmbiguous = false;
  for (const dependency of task.dependsOn) {
    const matches = index.dependencyIds.get(dependency);
    if (!matches) {
      continue;
    }
    let open = false;
    let unknown = false;
    for (const target of matches) {
      const type = target.statusType;
      if (
        target.statusRecognized &&
        TASK_STATUS_OPEN_TYPES.has(type)
      ) {
        open = true;
      } else if (
        !target.statusRecognized ||
        !TASK_STATUS_CLOSED_TYPES.has(type)
      ) {
        unknown = true;
      }
    }
    if (open) {
      return Object.freeze({
        state: "blocked",
        rank: null,
        reason: `open dependency: ${dependency}`,
      });
    }
    dependencyAmbiguous ||= unknown;
  }
  if (dependencyAmbiguous) {
    return deferredScheduledRecovery(
      "dependency status could not be resolved safely",
    );
  }
  if (!task.blockId) {
    return Object.freeze({ state: "ready", rank: " ", reason: null });
  }
  const identity = recoveryIdentity(path, task.blockId);
  if ((index.blocks.get(identity) || []).length !== 1) {
    return deferredScheduledRecovery("task block identity is ambiguous");
  }
  if (!index.rankSafe) {
    return deferredScheduledRecovery(
      "recent activity could not be resolved safely",
    );
  }
  const rank = index.ranks.get(identity);
  if (rank === 2) {
    return Object.freeze({
      state: "in-progress",
      rank: "/",
      reason: null,
    });
  }
  if (rank === 1) {
    return Object.freeze({ state: "next", rank: "*", reason: null });
  }
  return Object.freeze({ state: "ready", rank: " ", reason: null });
}

async function readTasksStatusRegistry(app) {
  const vault = app && app.vault;
  if (!vault) {
    return unavailableTasksStatusRegistry("Vault is unavailable");
  }
  try {
    const settingsFile =
      typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(TASKS_SETTINGS_PATH)
        : null;
    let contents = null;
    if (settingsFile && typeof vault.read === "function") {
      contents = await vault.read(settingsFile);
    } else if (
      vault.adapter &&
      typeof vault.adapter.read === "function"
    ) {
      contents = await vault.adapter.read(TASKS_SETTINGS_PATH);
    } else if (settingsFile && typeof vault.cachedRead === "function") {
      contents = await vault.cachedRead(settingsFile);
    }
    if (contents === null) {
      return unavailableTasksStatusRegistry("Tasks settings are unavailable");
    }
    return parseTasksStatusRegistry(contents);
  } catch (_error) {
    return unavailableTasksStatusRegistry("Tasks settings could not be read");
  }
}

function getOpenMarkdownBufferContents(app) {
  const buffers = new Map();
  buffers.ambiguous = false;
  const workspace = app && app.workspace;
  if (!workspace || typeof workspace.getLeavesOfType !== "function") {
    return buffers;
  }
  for (const leaf of workspace.getLeavesOfType("markdown") || []) {
    const view = leaf && leaf.view;
    if (
      view &&
      view.file &&
      view.file.path &&
      view.editor &&
      typeof view.editor.getValue === "function"
    ) {
      const path = normalizeVaultRelativePath(view.file.path);
      const content = String(view.editor.getValue() || "");
      if (buffers.has(path) && buffers.get(path) !== content) {
        buffers.ambiguous = true;
      }
      buffers.set(path, content);
    }
  }
  return buffers;
}

async function buildInteractiveScheduledRecoverySnapshot(
  app,
  options = {},
) {
  const vault = app && app.vault;
  if (!vault || typeof vault.getMarkdownFiles !== "function") {
    return buildScheduledRecoveryIndex(
      [],
      unavailableTasksStatusRegistry("Vault Markdown files are unavailable"),
      options.today || new Date(),
    );
  }
  const registryPromise = readTasksStatusRegistry(app);
  const buffers = getOpenMarkdownBufferContents(app);
  if (buffers.ambiguous) {
    return buildScheduledRecoveryIndex(
      [],
      unavailableTasksStatusRegistry(
        "Open Markdown buffers are ambiguous",
      ),
      options.today || new Date(),
    );
  }
  const sourcePath = normalizeVaultRelativePath(options.sourcePath);
  if (sourcePath) {
    buffers.set(sourcePath, String(options.sourceContent || ""));
  }
  const vaultFiles = vault.getMarkdownFiles() || [];
  const files = [];
  try {
    for (const file of vaultFiles) {
      const path = normalizeVaultRelativePath(file.path);
      const content = buffers.has(path)
        ? buffers.get(path)
        : typeof vault.cachedRead === "function"
          ? await vault.cachedRead(file)
          : null;
      if (content === null) {
        throw new Error("Markdown file could not be read");
      }
      files.push({ path, content: String(content || "") });
    }
    if (sourcePath && !files.some((file) => file.path === sourcePath)) {
      files.push({
        path: sourcePath,
        content: String(options.sourceContent || ""),
      });
    }
  } catch (_error) {
    return buildScheduledRecoveryIndex(
      [],
      unavailableTasksStatusRegistry("Vault Markdown files could not be read"),
      options.today || new Date(),
    );
  }
  return buildScheduledRecoveryIndex(
    files,
    await registryPromise,
    options.today || new Date(),
  );
}

async function buildTargetScheduledRecoveryByLine(
  app,
  sourcePath,
  sourceContent,
  targetLines,
  today = new Date(),
) {
  const snapshot = await buildInteractiveScheduledRecoverySnapshot(app, {
    sourcePath,
    sourceContent,
    today,
  });
  return new Map(
    (Array.isArray(targetLines) ? targetLines : [targetLines]).map((line) => [
      line,
      getScheduledRecoveryMetadata(snapshot, sourcePath, line),
    ]),
  );
}

// The dependency picker intentionally offers only open tasks. Keep that
// lifecycle filter separate from the general valid-task predicate above.
function isOpenObsidianTaskLine(lineText) {
  const match = OBSIDIAN_TASK_LINE_RE.exec(String(lineText || ""));
  return Boolean(
    match &&
      isObsidianTaskLine(lineText) &&
      OPEN_OBSIDIAN_TASK_STATUSES.has(match[1]),
  );
}

// True for a proper `#task` line whose checkbox is an active navigation
// target (Ready, In Progress, or Next). Blocked tasks remain open via
// `isOpenObsidianTaskLine` but are omitted from Ctrl+Shift+J/K jumps.
function isActiveObsidianTaskNavigationLine(lineText) {
  const match = OBSIDIAN_TASK_LINE_RE.exec(String(lineText || ""));
  return Boolean(
    match &&
      isObsidianTaskLine(lineText) &&
      ACTIVE_OBSIDIAN_TASK_NAVIGATION_STATUSES.has(match[1]),
  );
}

// True for an unfenced `## Pomodoros` heading line (allowing a trailing dataview
// summary suffix such as the daily template's duration expression).
function isPomodorosHeading(lineText) {
  return POMODOROS_HEADING_RE.test(String(lineText || ""));
}

// True for any level-two (`## `) Markdown heading. Used to detect when a
// `## Pomodoros` section has ended.
function isLevelTwoHeading(lineText) {
  return LEVEL_TWO_HEADING_RE.test(String(lineText || ""));
}

// True when the text carries a compact (`2050-2125`) or colon (`20:50-21:25`)
// Pomodoro time range in parentheses, optionally bolded with `**` and followed
// by trailing metadata such as `[t:: 35m]`.
function hasPomodoroTimeRange(text) {
  const value = String(text || "");
  return (
    POMODORO_COLON_TIME_RANGE_RE.test(value) ||
    POMODORO_COMPACT_TIME_RANGE_RE.test(value)
  );
}

// True for a top-level (unindented) Pomodoro ledger navigation target: an open
// or completed checkbox status (`[ ]`, `[/]`, `[x]`, or `[X]`) whose body carries
// a time range or an empty `()` placeholder. Indented carried-forward child
// bullets, cancelled Pomodoros (`[-]`), and top-level checkboxes lacking a ledger
// shape return false. The caller is responsible for confirming `## Pomodoros`
// section context before treating a match as a navigation target.
function isPomodoroNavigationTaskLine(lineText) {
  const match = POMODORO_TOP_LEVEL_TASK_LINE_RE.exec(String(lineText || ""));
  if (!match) {
    return false;
  }

  const status = match[1];
  const body = match[2] || "";
  if (!POMODORO_NAVIGATION_STATUSES.has(status)) {
    return false;
  }

  return POMODORO_PLACEHOLDER_RE.test(body) || hasPomodoroTimeRange(body);
}

// Checkbox statuses that make a top-level Pomodoro ledger entry closed.
// Mirrors `pomodoro::open_ledger_task` in bob-cli (src/native/pomodoro.rs):
// any single-character checkbox other than `x`/`X`/`-` counts as open.
const POMODORO_LEDGER_CLOSED_STATUSES = new Set(["x", "X", "-"]);
// Column-0 (`- [c] ...`) ledger line only — the same shape
// `pomodoro::open_ledger_task` requires before it inspects the checkbox.
const POMODORO_LEDGER_TOP_LEVEL_LINE_RE = /^-[ \t]+\[([^\]])\](?:[ \t]+(.*))?$/;

// True for a top-level open Pomodoro ledger entry: a column-0 `- [c] ...` line
// whose checkbox is not closed (`x`, `X`, or `-`). This is deliberately
// broader than `isPomodoroNavigationTaskLine` above — it has no placeholder/
// time-range requirement and it recognizes `[*]`/`[?]` as open — because it
// mirrors `pomodoro::open_ledger_task`, the exact rule `bob task reconcile`
// uses to decide which Pomodoro entries seed its promotion graph.
function isOpenPomodoroLedgerEntryLine(lineText) {
  const match = POMODORO_LEDGER_TOP_LEVEL_LINE_RE.exec(String(lineText || ""));
  return Boolean(match && !POMODORO_LEDGER_CLOSED_STATUSES.has(match[1]));
}

// The line range of the first unfenced `## Pomodoros` heading and its section
// body (up to but excluding the next unfenced level-two heading, or EOF).
// Returns null when the note has no such section. Frontmatter and fenced code
// are excluded via `getMarkdownLineContexts` so a heading-shaped line inside
// either is never mistaken for the section boundary.
function findPomodorosSectionRange(content) {
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const startLine = lines.findIndex(
    (line, index) =>
      !contexts[index].inFrontmatter &&
      !contexts[index].inFence &&
      isPomodorosHeading(line),
  );
  if (startLine === -1) {
    return null;
  }

  let endLine = lines.length - 1;
  for (let index = startLine + 1; index < lines.length; index += 1) {
    if (!contexts[index].inFence && isLevelTwoHeading(lines[index])) {
      endLine = index - 1;
      break;
    }
  }

  return Object.freeze({ startLine, endLine });
}

// Every open Pomodoro entry inside `section`, each with the line range of its
// sub-bullets (`startLine`..`endLine`, inclusive, possibly empty). A closed
// entry's block is skipped entirely: its child lines never satisfy the
// column-0 entry regex, so they cannot be mistaken for entries themselves.
function collectOpenPomodoroRanges(lines, contexts, section) {
  if (!section) {
    return [];
  }

  const ranges = [];
  for (let line = section.startLine + 1; line <= section.endLine; line += 1) {
    if (contexts[line] && contexts[line].inFence) {
      continue;
    }
    if (!isOpenPomodoroLedgerEntryLine(lines[line])) {
      continue;
    }
    const block = findCurrentBulletChildBlock(lines, line);
    const endLine = Math.min(block.endLineExclusive - 1, section.endLine);
    ranges.push(Object.freeze({ entryLine: line, startLine: line + 1, endLine }));
  }
  return ranges;
}

// Every `[[target#^id]]` / `![[target#^id]]` occurrence on one line, including
// an optional leading run of `🍅 ` markers in its span so a stray marker is
// never left orphaned when the link is removed. `struck` is true when the
// link itself (not the marker) sits inside a `~~...~~` span, using the same
// containment rule as `recoveryBlockReferences`.
const POMODORO_BLOCK_LINK_RE =
  /((?:🍅[ \t]+)*)(!)?\[\[([^|\]\n]*?)#\^([A-Za-z0-9-]+)(?:\|[^\]\n]*)?\]\]/g;

function collectPomodoroBlockLinkOccurrences(lineText) {
  const line = String(lineText || "");
  const strikeSpans = recoveryStrikethroughSpans(line);
  const occurrences = [];
  POMODORO_BLOCK_LINK_RE.lastIndex = 0;
  let match = null;
  while ((match = POMODORO_BLOCK_LINK_RE.exec(line)) !== null) {
    const markerRun = match[1] || "";
    const start = match.index;
    const end = match.index + match[0].length;
    const linkStart = start + markerRun.length;
    const struck = strikeSpans.some(
      (span) => linkStart >= span.start + 2 && end <= span.end - 2,
    );
    occurrences.push(
      Object.freeze({
        start,
        end,
        markerStart: markerRun ? start : null,
        target: match[3].trim(),
        blockId: match[4],
        embedded: Boolean(match[2]),
        struck,
      }),
    );
  }
  return occurrences;
}

// The trimmed body span of a list-item line (indent + marker + trailing
// whitespace excluded on both ends), or null when the line is not a list item
// or its body is empty.
function pomodoroBulletBodyBounds(lineText) {
  const line = String(lineText || "");
  const match = PROJECT_LIST_ITEM_RE.exec(line);
  if (!match) {
    return null;
  }
  const start = match[0].length;
  let end = line.length;
  while (end > start && /[ \t]/.test(line[end - 1])) {
    end -= 1;
  }
  return start < end ? Object.freeze({ start, end }) : null;
}

// True when one or more matched link occurrences make up a bullet's entire
// body (only whitespace, if anything, between adjacent occurrences). Two
// matched links on one otherwise-empty bullet still count as dedicated.
function isDedicatedPomodoroLinkLine(lineText, occurrences) {
  const bounds = pomodoroBulletBodyBounds(lineText);
  const list = Array.isArray(occurrences) ? occurrences : [];
  if (!bounds || list.length === 0) {
    return false;
  }
  const sorted = list.slice().sort((left, right) => left.start - right.start);
  if (
    sorted[0].start !== bounds.start ||
    sorted[sorted.length - 1].end !== bounds.end
  ) {
    return false;
  }
  const line = String(lineText || "");
  for (let index = 1; index < sorted.length; index += 1) {
    if (line.slice(sorted[index - 1].end, sorted[index].start).trim() !== "") {
      return false;
    }
  }
  return true;
}

// Parse a column-0 Pomodoro ledger entry line into its grammar parts, or null
// when the line is not a well-formed entry (wrong shape, indented, or a body
// that is not an empty `()` placeholder / time range). The name suffix, when
// present, is parsed only from the text after the parenthetical's closing
// `)`, so metadata such as `[t:: 30m]` can never be mistaken for it.
function parsePomodoroEntryLine(lineText) {
  const line = String(lineText || "");
  const match = POMODORO_LEDGER_TOP_LEVEL_LINE_RE.exec(line);
  if (!match) {
    return null;
  }
  const status = match[1];
  const body = match[2] || "";
  const bodyStart = line.length - body.length;

  let rangeMatch = POMODORO_PLACEHOLDER_RE.exec(body);
  let placeholder = Boolean(rangeMatch && rangeMatch.index === 0);
  if (!placeholder) {
    rangeMatch = POMODORO_COLON_TIME_RANGE_RE.exec(body);
    if (!rangeMatch || rangeMatch.index !== 0) {
      rangeMatch = POMODORO_COMPACT_TIME_RANGE_RE.exec(body);
    }
  }
  if (!rangeMatch || rangeMatch.index !== 0) {
    return null;
  }

  const rangeStart = bodyStart;
  const rangeEnd = bodyStart + rangeMatch[0].length;
  const rangeText = line.slice(rangeStart, rangeEnd);

  let name = null;
  let nameStart = null;
  let nameEnd = null;
  const tail = body.slice(rangeMatch[0].length);
  const tailMatch = POMODORO_NAME_TAIL_RE.exec(tail);
  if (tailMatch) {
    const rawName = tailMatch[1];
    const trimmedName = rawName.trim();
    const leadingTrimLength = rawName.length - rawName.replace(/^\s+/, "").length;
    const groupOffsetInTail = tailMatch[0].length - rawName.length;
    name = trimmedName;
    nameStart = rangeEnd + groupOffsetInTail + leadingTrimLength;
    nameEnd = nameStart + trimmedName.length;
  }

  return Object.freeze({
    indent: "",
    status,
    open: !POMODORO_LEDGER_CLOSED_STATUSES.has(status),
    bodyStart,
    rangeText,
    rangeStart,
    rangeEnd,
    placeholder,
    name,
    nameStart,
    nameEnd,
  });
}

// Normalize a raw typed or parsed Pomodoro name: strip every em dash,
// collapse whitespace runs to one space, trim, then uppercase. Invalid when
// the result is empty or longer than POMODORO_NAME_MAX_LENGTH.
function normalizePomodoroName(raw) {
  const stripped = String(raw || "").split(POMODORO_NAME_SEPARATOR).join("");
  const name = stripped.replace(/\s+/g, " ").trim().toUpperCase();
  if (!name) {
    return Object.freeze({
      valid: false,
      name: "",
      error: "Pomodoro name cannot be empty",
    });
  }
  if (name.length > POMODORO_NAME_MAX_LENGTH) {
    return Object.freeze({
      valid: false,
      name: "",
      error: `Pomodoro name cannot exceed ${POMODORO_NAME_MAX_LENGTH} characters`,
    });
  }
  return Object.freeze({ valid: true, name, error: null });
}

function peelPomodoroMergedName(sourceRaw, requestedRaw) {
  const sourceNormalized = normalizePomodoroName(sourceRaw);
  const invalid = (error, extras = {}) =>
    Object.freeze({
      valid: false,
      error,
      sourceName: sourceNormalized.valid ? sourceNormalized.name : "",
      remainingName: "",
      splitName: extras.splitName || "",
    });

  if (!sourceNormalized.valid) {
    return invalid(`Source Pomodoro name is invalid: ${sourceNormalized.error}`);
  }

  const requestedNormalized = normalizePomodoroName(requestedRaw);
  if (!requestedNormalized.valid) {
    return invalid(
      requestedNormalized.error === "Pomodoro name cannot be empty"
        ? "Split name cannot be empty"
        : `Split name is invalid: ${requestedNormalized.error}`,
    );
  }

  const sourceName = sourceNormalized.name;
  const splitName = requestedNormalized.name;
  if (sourceName === splitName) {
    return Object.freeze({
      valid: true,
      error: null,
      sourceName,
      remainingName: "",
      splitName,
    });
  }

  const components = sourceName.split(" + ");
  const remainingComponents = components.filter((part) => part !== splitName);
  if (remainingComponents.length === components.length) {
    return invalid(`${splitName} is not part of this Pomodoro's name`, {
      splitName,
    });
  }

  return Object.freeze({
    valid: true,
    error: null,
    sourceName,
    remainingName: remainingComponents.join(" + "),
    splitName,
  });
}

function decomposePomodoroMergedName(raw) {
  const normalized = normalizePomodoroName(raw);
  if (!normalized.valid) {
    return peelPomodoroMergedName(raw, "");
  }
  const boundary = normalized.name.lastIndexOf(" + ");
  if (boundary === -1) {
    return Object.freeze({
      valid: false,
      error: "Source Pomodoro has no final merged Pomodoro to split",
      sourceName: normalized.name,
      remainingName: "",
      splitName: "",
    });
  }
  return peelPomodoroMergedName(raw, normalized.name.slice(boundary + 3));
}

// Format a brand-new Pomodoro ledger entry line. `name` is expected to
// already be normalized (see normalizePomodoroName); an empty name yields an
// unnamed placeholder entry.
function formatPomodoroEntryLine(name) {
  const trimmed = String(name || "").trim();
  return trimmed
    ? `- [ ] () ${POMODORO_NAME_SEPARATOR} ${trimmed}`
    : "- [ ] ()";
}

// Every Pomodoro ledger entry inside the note's `## Pomodoros` section (open
// and closed), each with its child sub-bullet range and picker-facing
// preview fields. Returns `{ section: null, entries: [] }` when the note has
// no such section.
function collectPomodoroEntries(content) {
  const text = String(content || "");
  const section = findPomodorosSectionRange(text);
  if (!section) {
    return Object.freeze({ section: null, entries: Object.freeze([]) });
  }

  const { lines } = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const entries = [];
  let position = 0;

  for (let line = section.startLine + 1; line <= section.endLine; line += 1) {
    if (contexts[line] && contexts[line].inFence) {
      continue;
    }
    const parsed = parsePomodoroEntryLine(lines[line]);
    if (!parsed) {
      continue;
    }
    position += 1;

    const block = findCurrentBulletChildBlock(lines, line);
    const childStartLine = block.startLine;
    const childEndLineExclusive = Math.min(
      block.endLineExclusive,
      section.endLine + 1,
    );

    const childListIndexes = [];
    for (
      let childLine = childStartLine;
      childLine < childEndLineExclusive;
      childLine += 1
    ) {
      if (PROJECT_LIST_ITEM_RE.test(String(lines[childLine] || ""))) {
        childListIndexes.push(childLine);
      }
    }
    const childIndent =
      childListIndexes.length > 0
        ? getBulletIndent(String(lines[childListIndexes[0]] || ""))
        : "\t";
    const childIndentWidth = getBulletIndentWidth(childIndent);
    const bulletLines = Object.freeze(
      childListIndexes
        .filter(
          (childLine) =>
            getBulletIndentWidth(String(lines[childLine] || "")) ===
            childIndentWidth,
        )
        .map((childLine) => String(lines[childLine] || "")),
    );
    const firstBounds =
      bulletLines.length > 0 ? pomodoroBulletBodyBounds(bulletLines[0]) : null;
    const previewText = firstBounds
      ? bulletLines[0].slice(firstBounds.start, firstBounds.end)
      : "";
    const moreCount = bulletLines.length > 0 ? bulletLines.length - 1 : 0;

    entries.push(
      Object.freeze({
        index: entries.length,
        position,
        entryLine: line,
        status: parsed.status,
        open: parsed.open,
        name: parsed.name,
        rangeText: parsed.rangeText,
        rangeStart: parsed.rangeStart,
        rangeEnd: parsed.rangeEnd,
        placeholder: parsed.placeholder,
        childStartLine,
        childEndLineExclusive,
        childIndent,
        bulletLines,
        previewText,
        moreCount,
      }),
    );
  }

  return Object.freeze({ section, entries: Object.freeze(entries) });
}

// The Pomodoro ledger entry that owns the sub-bullet at `line`, or null when
// `line` is not a list item inside any entry's child block.
function findPomodoroBulletContext(content, line) {
  const text = String(content || "");
  const { entries, section } = collectPomodoroEntries(text);
  const lineIndex = Math.floor(numericOrDefault(line, Number.NaN));
  if (!section || !Number.isFinite(lineIndex) || lineIndex < 0) {
    return null;
  }
  const { lines } = splitMarkdownContent(text);
  const lineText = String(lines[lineIndex] || "");
  if (!PROJECT_LIST_ITEM_RE.test(lineText)) {
    return null;
  }
  const entryIndex = entries.findIndex(
    (entry) =>
      lineIndex >= entry.childStartLine &&
      lineIndex < entry.childEndLineExclusive,
  );
  if (entryIndex === -1) {
    return null;
  }
  return Object.freeze({
    entries,
    section,
    entry: entries[entryIndex],
    entryIndex,
    line: lineIndex,
    depth: getBulletIndentWidth(lineText),
  });
}

// The Pomodoro ledger entry whose own entry line is exactly `line`, or null
// otherwise. Disjoint from findPomodoroBulletContext: an entry's child block
// starts at entryLine + 1, so an entry line never resolves as a sub-bullet.
function findPomodoroEntryContext(content, line) {
  const text = String(content || "");
  const { entries, section } = collectPomodoroEntries(text);
  const lineIndex = Math.floor(numericOrDefault(line, Number.NaN));
  if (!section || !Number.isFinite(lineIndex) || lineIndex < 0) {
    return null;
  }
  const entryIndex = entries.findIndex(
    (entry) => entry.entryLine === lineIndex,
  );
  if (entryIndex === -1) {
    return null;
  }
  return Object.freeze({
    entries,
    section,
    entry: entries[entryIndex],
    entryIndex,
    entryLine: lineIndex,
  });
}

// Every top-level child bullet a Pomodoro entry owns, classified as movable
// or droppable ahead of a whole-entry move-and-delete. A bullet is droppable
// when it is an empty placeholder line (no body, no descendants); everything
// else is movable. Zero movable targets is valid: it is the "delete this
// empty Pomodoro" case. Mirrors the frozen shape of
// discoverMovablePomodoroBulletTargets.
function discoverPomodoroEntryMoveTargets(content, line) {
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  const context = findPomodoroEntryContext(text, line);

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      entryLine: null,
      rawEntryLine: null,
      targets: Object.freeze([]),
      droppedLines: Object.freeze([]),
      bulletCount: 0,
      entry: null,
      entries: Object.freeze([]),
      context: null,
    });

  if (!context) {
    return invalid("Place the cursor on a Pomodoro entry");
  }

  const { entry } = context;
  const childIndentWidth = getBulletIndentWidth(entry.childIndent);
  const targets = [];
  const droppedLines = [];
  for (
    let lineIndex = entry.childStartLine;
    lineIndex < entry.childEndLineExclusive;
    lineIndex += 1
  ) {
    const lineText = String(lines[lineIndex] || "");
    if (
      !PROJECT_LIST_ITEM_RE.test(lineText) ||
      getBulletIndentWidth(lineText) !== childIndentWidth
    ) {
      continue;
    }
    const subtree = capturePomodoroBulletSubtree(
      lines,
      lineIndex,
      entry.childEndLineExclusive,
    );
    const isDroppable =
      pomodoroBulletBodyBounds(lineText) === null &&
      subtree.endLineExclusive - subtree.startLine === 1;
    const record = Object.freeze({ line: lineIndex, rawLine: lineText });
    if (isDroppable) {
      droppedLines.push(record);
    } else {
      targets.push(record);
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    entryLine: entry.entryLine,
    rawEntryLine: String(lines[entry.entryLine] || ""),
    targets: Object.freeze(targets),
    droppedLines: Object.freeze(droppedLines),
    bulletCount: targets.length,
    entry,
    entries: context.entries,
    context,
  });
}

// Sibling targets for a Pomodoro bullet move: the bullet at `startLine` plus
// the next `additionalBulletCount` siblings at its own indent depth, inside
// the same Pomodoro entry's child block. Mirrors the frozen shape of
// discoverMovableObsidianTaskTargets.
function discoverMovablePomodoroBulletTargets(
  content,
  startLine,
  additionalBulletCount,
) {
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  const line = Math.floor(numericOrDefault(startLine, Number.NaN));
  const additional = Math.max(
    0,
    Math.floor(numericOrDefault(additionalBulletCount, 0)),
  );
  const requestedCount = additional + 1;
  const context = findPomodoroBulletContext(text, line);

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      explicit: additional > 0,
      startLine: Number.isFinite(line) ? line : null,
      requestedAdditionalCount: additional,
      requestedCount,
      actualCount: 0,
      clamped: false,
      targets: Object.freeze([]),
      entryLine: null,
      context: null,
    });

  if (!context) {
    return invalid("Place the cursor on a Pomodoro sub-bullet");
  }

  const { entry, depth } = context;
  const targets = [];
  for (
    let lineIndex = line;
    lineIndex < entry.childEndLineExclusive && targets.length < requestedCount;
    lineIndex += 1
  ) {
    const lineText = String(lines[lineIndex] || "");
    if (
      PROJECT_LIST_ITEM_RE.test(lineText) &&
      getBulletIndentWidth(lineText) === depth
    ) {
      targets.push(Object.freeze({ line: lineIndex, rawLine: lineText }));
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    explicit: additional > 0,
    startLine: line,
    requestedAdditionalCount: additional,
    requestedCount,
    actualCount: targets.length,
    clamped: targets.length < requestedCount,
    targets: Object.freeze(targets),
    entryLine: entry.entryLine,
    context,
  });
}

// Capture one Pomodoro bullet's subtree: the target line plus every
// following line whose indent display width exceeds the target's, bounded by
// `boundExclusive`. Blank lines are retained only when deeper content
// follows, mirroring captureTaskMoveSubtree's pendingBlankEnd rule. `root` is
// shaped for rebaseTaskMoveBlock.
