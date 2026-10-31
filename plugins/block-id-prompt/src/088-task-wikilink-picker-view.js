// Pure render plans and DOM builders for the Task Wikilink Picker card.
//
// Groups, locators, action lines, counts, windowing, and title tokens are
// planned here so tests can assert the card without opening a Modal. The
// modal (087) owns keys, selection, and Obsidian I/O.

const TASK_WIKILINK_PICKER_WINDOW = 100;
const TASK_WIKILINK_PICKER_TITLE = "Link to a task";
const TASK_WIKILINK_PICKER_PLACEHOLDER =
  "Search every task by text, note, or ^id";
const TASK_WIKILINK_PICKER_LIST_ID = "bid-twl-list";
const TASK_WIKILINK_UNLINKABLE_PATH_RE = /[\[\]|#^]/;
const TASK_WIKILINK_TITLE_URL_RE =
  /(?:https?:\/\/|ftp:\/\/|mailto:|www\.)[^\s<>"`\]]+/;
const TASK_WIKILINK_WIKI_RE = /\[\[([^\]\n]+?)\]\]/;
const TASK_WIKILINK_MD_LINK_RE = /\[([^\]\n]*)\]\(([^)\n]+)\)/;
const TASK_WIKILINK_CODE_RE = /`([^`\n]+)`/;
const TASK_WIKILINK_DAILY_PATH_RE = /^(\d{4})\/(\d{4})(\d{2})(\d{2})\.md$/;
const TASK_WIKILINK_NOTE_KIND_ICONS = {
  daily: "calendar-days",
  ref: "book-open",
  done: "archive",
  project: "folder-kanban",
  inbox: "inbox",
  file: "file-text",
};
const TASK_WIKILINK_GROUP_LABELS = {
  in_this_note: "This note",
  in_progress: "In progress",
  next: "Next",
  open: "Other open tasks",
  hidden: "Hidden",
  completed: "Completed history",
};

function taskWikilinkRowKey(row) {
  return `${row && row.notePath ? row.notePath : ""}|${row && Number.isInteger(row.line) ? row.line : ""}`;
}

function taskWikilinkSourceBasename(path) {
  const file = String(path || "").split("/").pop() || "";
  return file || String(path || "");
}

function taskWikilinkPathStem(path) {
  return String(path || "").replace(/\.[mM][dD]$/, "");
}

function taskWikilinkIsDailyNotePath(path) {
  const match = TASK_WIKILINK_DAILY_PATH_RE.exec(String(path || ""));
  if (!match || match[1] !== match[2]) {
    return false;
  }
  const year = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const check = new Date(year, month - 1, day);
  return (
    check.getFullYear() === year &&
    check.getMonth() === month - 1 &&
    check.getDate() === day
  );
}

function taskWikilinkNoteKind(path, options) {
  const notePath = String(path || "");
  const root = notePath.split("/")[0];
  if (root === "done") {
    return "done";
  }
  if (root === "ref") {
    return "ref";
  }
  const hints = options || {};
  if (hints.inboxPaths && hints.inboxPaths.has(notePath)) {
    return "inbox";
  }
  if (typeof hints.isInboxNote === "function") {
    try {
      if (hints.isInboxNote(notePath)) {
        return "inbox";
      }
    } catch (error) {
      // Note-kind icons are decorative; a throwing inbox API stays a file.
    }
  }
  if (notePath === "inbox.md" || notePath.endsWith("/inbox.md")) {
    return "inbox";
  }
  if (hints.prjPaths && hints.prjPaths.has(notePath)) {
    return "project";
  }
  if (taskWikilinkIsDailyNotePath(notePath)) {
    return "daily";
  }
  return "file";
}

function taskWikilinkNoteKindIcon(kind) {
  return TASK_WIKILINK_NOTE_KIND_ICONS[kind] || TASK_WIKILINK_NOTE_KIND_ICONS.file;
}

function formatTaskWikilinkCount(value) {
  const number = Number(value) || 0;
  return number.toLocaleString("en-US");
}

function taskWikilinkCountText(shown, total, query) {
  if (!total) {
    return "0 tasks";
  }
  if (query) {
    if (!shown) {
      return "No matches";
    }
    return `${formatTaskWikilinkCount(shown)} of ${formatTaskWikilinkCount(total)}`;
  }
  return `${formatTaskWikilinkCount(total)} tasks`;
}

function taskWikilinkIndexingText(scanned, total) {
  return `Indexing · ${formatTaskWikilinkCount(scanned)} of ${formatTaskWikilinkCount(total)} notes`;
}

function taskWikilinkStatusGlyph(status) {
  if (status === "/") {
    return "[/]";
  }
  if (status === "*") {
    return "[*]";
  }
  if (status === BLOCKED_OBSIDIAN_TASK_STATUS) {
    return "[?]";
  }
  if (status === "x" || status === "X") {
    return "✓";
  }
  if (status === "-") {
    return "✕";
  }
  return "[ ]";
}

function taskWikilinkStatusClass(status) {
  if (status === "/") {
    return "active";
  }
  if (status === "*") {
    return "next";
  }
  if (status === BLOCKED_OBSIDIAN_TASK_STATUS) {
    return "blocked";
  }
  if (status === "x" || status === "X") {
    return "done";
  }
  if (status === "-") {
    return "cancelled";
  }
  return "todo";
}

function taskWikilinkStatusName(status) {
  if (status === "/") {
    return "In Progress";
  }
  if (status === "*") {
    return "Next";
  }
  if (status === BLOCKED_OBSIDIAN_TASK_STATUS) {
    return "Blocked";
  }
  if (status === "x" || status === "X") {
    return "Done";
  }
  if (status === "-") {
    return "Cancelled";
  }
  return "Open";
}

function taskWikilinkPathIsUnlinkable(path) {
  return TASK_WIKILINK_UNLINKABLE_PATH_RE.test(String(path || ""));
}

function pickerDisabledReasonFor(row, options) {
  if (!row) {
    return null;
  }
  if (taskWikilinkPathIsUnlinkable(row.notePath)) {
    return "This note's name can't be linked";
  }
  const source = options && options.source;
  if (
    source &&
    source.sourcePath === row.notePath &&
    Number.isInteger(source.line) &&
    source.line === row.line
  ) {
    return "The task you're typing in";
  }
  const pomodoroGuards = options && options.pomodoroGuards;
  const rowGuard = pomodoroGuards && typeof pomodoroGuards.get === "function"
    ? pomodoroGuards.get(taskWikilinkRowKey(row))
    : null;
  if (rowGuard) {
    return rowGuard;
  }
  return disabledReasonFor(row, options);
}

function taskWikilinkGuardPresentation(reason, row) {
  if (!reason) {
    return null;
  }
  const lower = String(reason).toLowerCase();
  if (lower.startsWith("archived")) {
    const stem = taskWikilinkPathStem(row && row.notePath);
    return {
      badge: "archived",
      full: `Archived tasks can't get an ID · it lives in ${stem}`,
    };
  }
  if (lower.includes("previous daily")) {
    return {
      badge: "read-only",
      full: "The previous daily note is read-only",
    };
  }
  const duplicate = /duplicate block id (\^[^\s]+) in (.+)$/i.exec(reason);
  if (duplicate) {
    return {
      badge: `duplicate ${duplicate[1]}`,
      full: `Duplicate block ID ${duplicate[1]} in ${duplicate[2]}`,
    };
  }
  if (lower.includes("can't be linked")) {
    return {
      badge: "unlinkable",
      full: "This note's name can't be linked",
    };
  }
  if (lower.includes("typing in")) {
    return {
      badge: "the task you're in",
      full: "The task you're typing in",
    };
  }
  return { badge: reason, full: reason };
}

function taskWikilinkHostOfUrl(url) {
  const raw = String(url || "");
  try {
    const withProtocol = /^(https?:\/\/|ftp:\/\/|mailto:)/i.test(raw)
      ? raw
      : `https://${raw.replace(/^\/\//, "")}`;
    const parsed = new URL(withProtocol);
    return parsed.hostname || raw;
  } catch (error) {
    return raw;
  }
}

function taskWikilinkWikiShownText(body) {
  const pipe = body.indexOf("|");
  return pipe === -1 ? body : body.slice(pipe + 1);
}

function findNextTaskWikilinkTitleToken(source, from) {
  let best = null;
  function consider(start, end, part) {
    if (!Number.isInteger(start) || start < from) {
      return;
    }
    if (!best || start < best.start) {
      best = { start, end, part };
    }
  }
  const slice = source.slice(from);
  const code = TASK_WIKILINK_CODE_RE.exec(slice);
  if (code) {
    const start = from + code.index;
    consider(start, start + code[0].length, { type: "code", text: code[1] });
  }
  const wiki = TASK_WIKILINK_WIKI_RE.exec(slice);
  if (wiki) {
    const start = from + wiki.index;
    consider(start, start + wiki[0].length, {
      type: "link",
      text: taskWikilinkWikiShownText(wiki[1]),
    });
  }
  const md = TASK_WIKILINK_MD_LINK_RE.exec(slice);
  if (md) {
    const start = from + md.index;
    consider(start, start + md[0].length, { type: "link", text: md[1] });
  }
  const url = TASK_WIKILINK_TITLE_URL_RE.exec(slice);
  if (url) {
    const start = from + url.index;
    consider(start, start + url[0].length, {
      type: "url",
      text: taskWikilinkHostOfUrl(url[0]),
    });
  }
  return best;
}

function parseTaskWikilinkTitleParts(displayText) {
  const source = String(displayText === null || displayText === undefined ? "" : displayText);
  const parts = [];
  let index = 0;
  while (index < source.length) {
    const next = findNextTaskWikilinkTitleToken(source, index);
    if (!next) {
      parts.push({ type: "text", text: source.slice(index) });
      break;
    }
    if (next.start > index) {
      parts.push({ type: "text", text: source.slice(index, next.start) });
    }
    parts.push(next.part);
    index = next.end;
  }
  return parts;
}

function highlightTaskWikilinkText(text, terms) {
  const source = String(text === null || text === undefined ? "" : text);
  const wanted = (terms || []).filter((term) => term);
  if (!source || wanted.length === 0) {
    return [{ text: source, hl: false }];
  }
  const lower = source.toLowerCase();
  const ranges = [];
  for (const term of wanted) {
    const needle = term.toLowerCase();
    let at = lower.indexOf(needle);
    while (at !== -1) {
      ranges.push([at, at + needle.length]);
      at = lower.indexOf(needle, at + needle.length);
    }
  }
  if (ranges.length === 0) {
    return [{ text: source, hl: false }];
  }
  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  const parts = [];
  let index = 0;
  for (const [start, end] of merged) {
    if (start > index) {
      parts.push({ text: source.slice(index, start), hl: false });
    }
    parts.push({ text: source.slice(start, end), hl: true });
    index = end;
  }
  if (index < source.length) {
    parts.push({ text: source.slice(index), hl: false });
  }
  return parts;
}

function taskWikilinkHighlightedTitleParts(displayText, query) {
  const terms = splitWikilinkQueryTerms(query);
  return parseTaskWikilinkTitleParts(displayText).map((part) => ({
    type: part.type,
    spans: highlightTaskWikilinkText(part.text, terms),
  }));
}

function taskWikilinkLocatorParts(row, options) {
  const narrow = Boolean(options && options.narrow);
  const locator = String((row && row.locator) || taskWikilinkPathStem(row && row.notePath));
  const slash = locator.lastIndexOf("/");
  const folder = !narrow && slash !== -1 ? locator.slice(0, slash + 1) : "";
  const filename = slash === -1 || narrow ? locator.split("/").pop() : locator.slice(slash + 1);
  const disabled = Boolean(options && options.disabled);
  const identified = Boolean(row && row.blockId);
  return {
    folder,
    filename,
    hash: identified ? "#^" : "",
    id: identified ? String(row.blockId) : "",
    addId: !identified && !disabled,
    disabled,
  };
}

function taskWikilinkSuggestedBlockId(row, blockIds) {
  if (!row || row.blockId) {
    return null;
  }
  const reserved = blockIds instanceof Set ? [...blockIds] : blockIds || [];
  try {
    return suggestPromptBlockId(row.rawLine, "", { reservedIds: reserved });
  } catch (error) {
    return null;
  }
}

function taskWikilinkEmptyMessage(query, total) {
  if (!total) {
    return "No tasks in this vault yet";
  }
  const shown = String(query || "").trim();
  if (shown) {
    return `No tasks match "${shown}" · try fewer words`;
  }
  return "No tasks in this vault yet";
}

function taskWikilinkFooterHints(queryEmpty, narrow) {
  const hints = [
    { keys: ["↑", "↓"], label: "move" },
    { keys: ["↵"], label: "insert link" },
    { keys: ["esc"], label: "clear · close" },
  ];
  if (queryEmpty && !narrow) {
    hints.push({ keys: ["⌫"], label: 'back to "("' });
  }
  return hints;
}

function collectTaskWikilinkPrjPaths(rows) {
  const paths = new Set();
  for (const row of rows || []) {
    if (row && row.blockId === "prj") {
      paths.add(row.notePath);
    }
  }
  return paths;
}

function taskWikilinkSelectableRows(rows, query, ownerPath) {
  const terms = String(query || "").trim();
  if (!terms) {
    return Array.isArray(rows) ? rows : [];
  }
  return orderForWikilinkPicker(rows, query, ownerPath);
}

function buildTaskWikilinkGroupedItems(rows, context) {
  const items = [];
  let currentGroup = null;
  let currentNote = null;
  let hiddenOpen = false;
  const noteCounts = new Map();
  for (const row of rows) {
    if (row.open && groupForWikilinkTask(row, context.ownerPath) === "open" && !row.hidden) {
      noteCounts.set(row.notePath, (noteCounts.get(row.notePath) || 0) + 1);
    }
  }

  function pushSection(id) {
    items.push({
      kind: "section",
      id,
      label: TASK_WIKILINK_GROUP_LABELS[id],
      sticky: true,
      variant: id,
    });
  }

  function pushNoteHeader(row) {
    const noteKind = taskWikilinkNoteKind(row.notePath, context.noteKind);
    items.push({
      kind: "note",
      path: row.notePath,
      locator: row.locator || taskWikilinkPathStem(row.notePath),
      noteKind,
      icon: taskWikilinkNoteKindIcon(noteKind),
      count: noteCounts.get(row.notePath) || 0,
      sticky: true,
    });
  }

  for (const row of rows) {
    const group = groupForWikilinkTask(row, context.ownerPath);
    if (group !== currentGroup) {
      currentGroup = group;
      currentNote = null;
      hiddenOpen = false;
      pushSection(group);
    }
    if (group === "open") {
      if (row.hidden) {
        if (!hiddenOpen) {
          hiddenOpen = true;
          currentNote = null;
          pushSection("hidden");
        }
      } else if (row.notePath !== currentNote) {
        currentNote = row.notePath;
        pushNoteHeader(row);
      }
    }
    items.push(buildTaskWikilinkRowItem(row, context));
  }
  return items;
}

function buildTaskWikilinkFilteredItems(rowItems) {
  const items = [];
  let sawCompleted = false;
  for (const item of rowItems) {
    if (item.group === "completed" && !sawCompleted) {
      sawCompleted = true;
      items.push({
        kind: "section",
        id: "completed",
        label: TASK_WIKILINK_GROUP_LABELS.completed,
        sticky: true,
        variant: "completed",
      });
    }
    items.push(item);
  }
  return items;
}

function buildTaskWikilinkRowItem(row, context) {
  const rowKey = taskWikilinkRowKey(row);
  const pomodoroDetail = context.pomodoroMode && rowKey === context.selectedRowKey
    ? context.pomodoroDetail
    : null;
  const reason = pickerDisabledReasonFor(row, context.guardOptions) ||
    (pomodoroDetail && pomodoroDetail.guardText) ||
    (pomodoroDetail && pomodoroDetail.checking ? "Checking dependency status" : null);
  const guard = taskWikilinkGuardPresentation(reason, row);
  const disabled = Boolean(reason);
  const identified = Boolean(row.blockId) && !disabled;
  const blockIds =
    context.blockIdsByPath &&
    (context.blockIdsByPath.get
      ? context.blockIdsByPath.get(row.notePath)
      : context.blockIdsByPath[row.notePath]);
  const suggestion = identified
    ? null
    : taskWikilinkSuggestedBlockId(row, blockIds);
  const locator = taskWikilinkLocatorParts(row, {
    narrow: context.narrow,
    disabled,
  });
  const action = taskWikilinkActionLine(row, {
    guard,
    suggestion,
    blockIds,
    linkTarget: row.linkTarget,
    pomodoroMode: context.pomodoroMode,
    pomodoroDetail,
  });
  const replacement = identified
    ? replacementForWikilinkTask(row, reason)
    : "";
  const kind = taskWikilinkNoteKind(row.notePath, context.noteKind);
  return {
    kind: "row",
    key: rowKey,
    row,
    group: groupForWikilinkTask(row, context.ownerPath),
    disabled,
    reason,
    guard,
    identified,
    hidden: Boolean(row.hidden),
    blocked: row.status === BLOCKED_OBSIDIAN_TASK_STATUS,
    status: {
      glyph: taskWikilinkStatusGlyph(row.status),
      className: taskWikilinkStatusClass(row.status),
      name: taskWikilinkStatusName(row.status),
    },
    titleParts: taskWikilinkHighlightedTitleParts(row.displayText, context.query),
    badges: {
      blocked: row.status === BLOCKED_OBSIDIAN_TASK_STATUS,
      waits: pomodoroDetail && pomodoroDetail.waitingOn > 0
        ? `🔒 waits on ${pomodoroDetail.waitingOn}`
        : null,
      hidden: Boolean(row.hidden),
      history:
        row.status === "x" || row.status === "X"
          ? "Done"
          : row.status === "-"
            ? "Cancelled"
            : null,
    },
    locator,
    action,
    pomodoroTarget: pomodoroDetail && pomodoroDetail.target || null,
    replacement,
    suggestion,
    noteKind: kind,
    noteIcon: taskWikilinkNoteKindIcon(kind),
    section: row.section || null,
    line: Number.isInteger(row.line) ? row.line + 1 : null,
    displayText: row.displayText,
  };
}

function windowTaskWikilinkItems(items, rowLimit) {
  const limit =
    Number.isInteger(rowLimit) && rowLimit > 0
      ? rowLimit
      : TASK_WIKILINK_PICKER_WINDOW;
  const totalRows = items.filter((item) => item.kind === "row").length;
  const out = [];
  let renderedRows = 0;
  for (const item of items) {
    if (item.kind === "row") {
      if (renderedRows >= limit) {
        break;
      }
      renderedRows += 1;
    }
    out.push(item);
  }
  while (out.length && out[out.length - 1].kind !== "row") {
    out.pop();
  }
  return {
    items: out,
    renderedRows,
    totalRows,
    exhausted: renderedRows >= totalRows,
    canExtend: renderedRows < totalRows,
  };
}

function taskWikilinkDetailPlan(selected, context) {
  if (!selected) {
    return null;
  }
  const locator = selected.locator;
  const locatorText = `${locator.folder || ""}${locator.filename || ""}${locator.hash || ""}${locator.id || ""}`;
  const meta = [
    selected.status.name,
    locatorText,
    selected.section ? `› ${selected.section}` : null,
    Number.isInteger(selected.line) ? `line ${selected.line}` : null,
  ].filter(Boolean);
  return {
    titleParts: selected.titleParts,
    displayText: selected.displayText,
    meta: meta.join(" · "),
    metaParts: {
      status: selected.status.name,
      icon: selected.noteIcon,
      locator: locatorText,
      section: selected.section,
      line: selected.line,
    },
    action: selected.action,
  };
}

function buildTaskWikilinkPickerPlan(input) {
  const options = input || {};
  const query = String(options.query || "");
  const ownerPath = options.ownerPath || (options.source && options.source.sourcePath) || null;
  const allRows = Array.isArray(options.rows) ? options.rows : [];
  const pomodoroMode = Boolean(options.pomodoroContext);
  const poolRows = pomodoroMode ? allRows.filter((row) => row && row.open) : allRows;
  const ranked = taskWikilinkSelectableRows(poolRows, query, ownerPath);
  const raisedRows = pomodoroMode && options.pomodoroRaised && Array.isArray(options.pomodoroRaised.rows)
    ? options.pomodoroRaised.rows.filter((row) => row && row.open)
    : [];
  const raisedKeys = new Set(raisedRows.map(taskWikilinkRowKey));
  const requestedSelectedKey = options.selectedKey ||
    (raisedRows.length ? taskWikilinkRowKey(raisedRows[0]) : null);
  const selectedCandidate = ranked.find((row) => taskWikilinkRowKey(row) === requestedSelectedKey) ||
    raisedRows.find((row) => taskWikilinkRowKey(row) === requestedSelectedKey) ||
    ranked[0] || null;
  const previousDailyPath =
    options.previousDailyPath ||
    previousDailyNotePath(
      allRows.map((row) => row.notePath),
      options.now || new Date(),
    );
  const noteKind = {
    inboxPaths: options.inboxPaths || null,
    isInboxNote: options.isInboxNote || null,
    prjPaths: options.prjPaths || collectTaskWikilinkPrjPaths(allRows),
  };
  const context = {
    ownerPath,
    query,
    narrow: Boolean(options.narrow),
    blockIdsByPath: options.blockIdsByPath || new Map(),
    noteKind,
    pomodoroMode,
    pomodoroDetail: options.pomodoroDetail || null,
    selectedRowKey: selectedCandidate ? taskWikilinkRowKey(selectedCandidate) : null,
    guardOptions: {
      previousDailyPath,
      source: options.source || null,
      pomodoroGuards: options.pomodoroGuards || null,
    },
  };
  const filtered = Boolean(String(query).trim());
  let ordinaryItems = filtered
    ? buildTaskWikilinkFilteredItems(
        ranked.filter((row) => !raisedKeys.has(taskWikilinkRowKey(row)))
          .map((row) => buildTaskWikilinkRowItem(row, context)),
      )
    : buildTaskWikilinkGroupedItems(
        ranked.filter((row) => !raisedKeys.has(taskWikilinkRowKey(row))),
        context,
      );
  const pinnedItems = raisedRows.length
    ? [
        {
          kind: "section",
          id: "raised",
          label: `Raised for ${options.pomodoroRaised.taskTitle || "this task"}`,
          sticky: true,
          variant: "raised",
        },
        ...raisedRows.map((row) => buildTaskWikilinkRowItem(row, context)),
      ]
    : [];
  const plannedItems = [...pinnedItems, ...ordinaryItems];

  const selectedKey = requestedSelectedKey;
  const selectable = plannedItems.filter((item) => item.kind === "row");
  let selectedIndex = 0;
  if (selectedKey) {
    const found = selectable.findIndex((item) => item.key === selectedKey);
    if (found !== -1) {
      selectedIndex = found;
    }
  }
  if (selectable.length === 0) {
    selectedIndex = 0;
  } else {
    selectedIndex = Math.min(Math.max(selectedIndex, 0), selectable.length - 1);
  }
  const selected = selectable[selectedIndex] || null;
  let rowLimit =
    Number.isInteger(options.rowLimit) && options.rowLimit > 0
      ? options.rowLimit
      : TASK_WIKILINK_PICKER_WINDOW;
  if (options.renderAll) {
    rowLimit = selectable.length || TASK_WIKILINK_PICKER_WINDOW;
  } else if (selectedIndex + 1 > rowLimit) {
    rowLimit = Math.ceil((selectedIndex + 1) / TASK_WIKILINK_PICKER_WINDOW) * TASK_WIKILINK_PICKER_WINDOW;
  }
  const windowed = windowTaskWikilinkItems(plannedItems, rowLimit);
  const progress = options.progress || { ready: true, scanned: 0, total: 0 };
  const indexing = progress.ready
    ? null
    : {
        scanned: progress.scanned || 0,
        total: progress.total || 0,
        text: taskWikilinkIndexingText(progress.scanned || 0, progress.total || 0),
      };
  const sourcePath = (options.source && options.source.sourcePath) || ownerPath || "";
  const totalVaultRows = poolRows.length;
  const pomodoroContext = options.pomodoroContext;
  return {
    header: {
      iconText: pomodoroMode ? "🍅" : "((",
      title: pomodoroMode ? "Link a task to this Pomodoro" : TASK_WIKILINK_PICKER_TITLE,
      subtitle: pomodoroMode
        ? `${pomodoroContext.title} · ${pomodoroContext.range || "planned"} · Ready tasks become Next`
        : `Inserts [[note#^id]] in ${taskWikilinkSourceBasename(sourcePath) || "this note"}`,
    },
    search: {
      placeholder: TASK_WIKILINK_PICKER_PLACEHOLDER,
      countText: indexing
        ? indexing.text
        : pomodoroMode
          ? `${formatTaskWikilinkCount(selectable.length)}${String(query).trim() ? ` of ${formatTaskWikilinkCount(totalVaultRows)}` : ""} open tasks`
          : taskWikilinkCountText(selectable.length, totalVaultRows, String(query).trim()),
      indexing,
    },
    items: windowed.items.map((item) => {
      if (item.kind !== "row") {
        return item;
      }
      return {
        ...item,
        selected: selected ? item.key === selected.key : false,
      };
    }),
    window: {
      rowLimit,
      renderedRows: windowed.renderedRows,
      totalRows: windowed.totalRows,
      canExtend: windowed.canExtend,
      exhausted: windowed.exhausted,
      windowSize: TASK_WIKILINK_PICKER_WINDOW,
    },
    empty:
      selectable.length === 0
      ? { message: pomodoroMode
          ? (String(query || "").trim() ? `No open tasks match "${String(query).trim()}" · try fewer words` : "No open tasks in this vault yet")
          : taskWikilinkEmptyMessage(query, totalVaultRows) }
        : null,
    detail: taskWikilinkDetailPlan(selected, context),
    footer: {
      hints: taskWikilinkFooterHints(!String(query).trim(), Boolean(options.narrow)),
      warningNote: options.warningNote || null,
    },
    live: {
      count: indexing
        ? indexing.text
        : `${formatTaskWikilinkCount(selectable.length)} of ${formatTaskWikilinkCount(totalVaultRows)} ${pomodoroMode ? "open " : ""}tasks`,
      selected: selected ? selected.displayText : "",
    },
    banner: options.pomodoroRaised ? options.pomodoroRaised.banner || null : null,
    selected,
    selectedIndex,
    selectableKeys: selectable.map((item) => item.key),
    query,
    narrow: Boolean(options.narrow),
    listId: TASK_WIKILINK_PICKER_LIST_ID,
  };
}

function appendTaskWikilinkHighlighted(el, spans) {
  for (const span of spans || []) {
    if (span.hl) {
      el.createSpan({ cls: "bid-tlp-hl bid-twl-hl", text: span.text });
    } else {
      el.appendText(span.text);
    }
  }
}

function appendTaskWikilinkTitle(el, titleParts) {
  for (const part of titleParts || []) {
    if (part.type === "code") {
      const codeEl = el.createSpan({ cls: "bid-twl-code" });
      appendTaskWikilinkHighlighted(codeEl, part.spans);
    } else if (part.type === "link" || part.type === "url") {
      const linkEl = el.createSpan({ cls: "bid-twl-inline-link" });
      appendTaskWikilinkHighlighted(linkEl, part.spans);
    } else {
      appendTaskWikilinkHighlighted(el, part.spans);
    }
  }
}

function renderTaskWikilinkLocator(el, locator) {
  const wrap = el.createDiv({
    cls: locator.disabled ? "bid-twl-locator is-disabled" : "bid-twl-locator",
  });
  if (locator.folder) {
    wrap.createSpan({ cls: "bid-twl-locator-folder", text: locator.folder });
  }
  wrap.createSpan({ cls: "bid-twl-locator-file", text: locator.filename || "" });
  if (locator.hash) {
    wrap.createSpan({ cls: "bid-twl-locator-hash", text: locator.hash });
  }
  if (locator.id) {
    wrap.createSpan({ cls: "bid-twl-locator-id", text: locator.id });
  }
  if (locator.addId) {
    wrap.createSpan({ cls: "bid-twl-add-id", text: "⊕ Add ID" });
  }
  return wrap;
}

function renderTaskWikilinkSection(el, item) {
  const headerEl = el.createDiv({
    cls: `bid-tlp-group bid-twl-group is-${item.variant || item.id}`,
    attr: { role: "presentation", "aria-hidden": "true" },
  });
  headerEl.createSpan({ cls: "bid-tlp-group-label", text: item.label });
  return headerEl;
}

function renderTaskWikilinkNoteHeader(el, item) {
  const headerEl = el.createDiv({
    cls: "bid-twl-note",
    attr: { role: "presentation", "aria-hidden": "true" },
  });
  const iconEl = headerEl.createSpan({
    cls: "bid-twl-note-icon",
    attr: { "aria-hidden": "true" },
  });
  applyIcon(iconEl, item.icon);
  const locatorEl = headerEl.createSpan({ cls: "bid-twl-note-locator" });
  const slash = String(item.locator || "").lastIndexOf("/");
  if (slash !== -1) {
    locatorEl.createSpan({
      cls: "bid-twl-locator-folder",
      text: item.locator.slice(0, slash + 1),
    });
    locatorEl.createSpan({
      cls: "bid-twl-locator-file",
      text: item.locator.slice(slash + 1),
    });
  } else {
    locatorEl.createSpan({
      cls: "bid-twl-locator-file",
      text: item.locator || "",
    });
  }
  headerEl.createSpan({
    cls: "bid-twl-note-count",
    text: String(item.count || 0),
  });
  return headerEl;
}

function renderTaskWikilinkRow(el, item, options) {
  const rowEl = el.createDiv({
    cls: [
      "bid-tlp-row",
      "bid-twl-row",
      item.selected ? "is-selected" : "",
      item.disabled ? "is-disabled" : "",
      item.hidden ? "is-hidden" : "",
      item.blocked ? "is-blocked" : "",
    ]
      .filter(Boolean)
      .join(" "),
    attr: {
      id: `bid-twl-row-${String(item.key).replace(/[^A-Za-z0-9_-]+/g, "-")}`,
      role: "option",
      "aria-selected": item.selected ? "true" : "false",
      "aria-disabled": item.disabled ? "true" : "false",
    },
  });
  rowEl.createDiv({
    cls: `bid-tlp-status-pill bid-twl-status-pill is-${item.status.className}`,
    text: item.status.glyph,
  });
  const textEl = rowEl.createDiv({ cls: "bid-tlp-row-text bid-twl-row-text" });
  const titleEl = textEl.createDiv({ cls: "bid-tlp-row-title bid-twl-row-title" });
  appendTaskWikilinkTitle(titleEl, item.titleParts);
  const badgesEl = textEl.createDiv({ cls: "bid-twl-badges" });
  if (item.badges.blocked) {
    const chip = badgesEl.createSpan({ cls: "bid-tlp-blocked-chip bid-twl-blocked" });
    chip.createSpan({ cls: "bid-twl-blocked-label", text: item.badges.waits || "🔒 Blocked" });
  } else if (item.badges.waits) {
    const chip = badgesEl.createSpan({ cls: "bid-tlp-blocked-chip bid-twl-blocked" });
    chip.createSpan({ cls: "bid-twl-blocked-label", text: item.badges.waits });
  }
  if (item.badges.hidden) {
    const hiddenEl = badgesEl.createSpan({
      cls: "bid-twl-hidden-mark",
      attr: { "aria-label": "Hidden" },
    });
    applyIcon(hiddenEl, "eye-off");
  }
  if (item.badges.history) {
    badgesEl.createSpan({
      cls: "bid-twl-history",
      text: item.badges.history,
    });
  }
  if (item.guard) {
    badgesEl.createSpan({
      cls: "bid-twl-guard",
      text: item.guard.badge,
    });
  }
  renderTaskWikilinkLocator(rowEl, item.locator);
  if (options && typeof options.onClick === "function") {
    rowEl.addEventListener("mousedown", (event) => event.preventDefault());
    rowEl.addEventListener("click", () => options.onClick(item));
  }
  return rowEl;
}
