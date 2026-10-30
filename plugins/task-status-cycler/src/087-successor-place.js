// Successor placement edits and notice text (docs/task-dependencies.md §12.3,
// §12.5–§12.6) plus the config and today-path loaders. Pure code only: no
// vault reads, no editor writes. Consumed with 085-successor-plan.js by the
// wiring phase.
function successorIndentOf(lineText) {
  const match = String(lineText || "").match(/^[ \t]*/);
  return match ? match[0] : "";
}

function successorEntryNameAt(lines, entryLine) {
  const parts = parsePomodoroEntryLineParts(String(lines[entryLine] || ""));
  return parts && parts.name ? parts.name : "";
}

// Apply ordered successor placements to the day text. Slot anchors insert
// immediately after the anchor bullet's subtree (the bullet plus its
// deeper-indented children), in successor order; the indent is the anchor
// bullet's own. Closing anchors append after the target entry's existing
// children (one tab in): the created continuation
// (`options.createdEntry = { line }`), else the first open same-name entry
// after the closed one, else a new `- [ ] () — NAME` placeholder right
// after the closed entry's sub-bullet range (successors count as carried).
// A lone stub child is replaced. `dailyLines` is text or an array;
// `options.closingEntry` is the 0-based closed-entry line. Returns
// `{ text, splices, links, skipped }`: `splices` apply in array order
// (`{ at, deleteCount, lines }`, 0-based); `links` aligns with `placements`
// (`entry_line`/`line` 1-based, `entry_name` `""` when unnamed); `skipped`
// lists placements with no valid target (the wiring reports them as
// `failed` rows).
function planSuccessorInsertions(dailyLines, placements, options = {}) {
  const sourceText = Array.isArray(dailyLines)
    ? dailyLines.map((line) => String(line ?? "")).join("\n")
    : String(dailyLines ?? "");
  const ending = sourceText.includes("\r\n") ? "\r\n" : "\n";
  const lines = sourceText.split(/\r?\n/);
  const list = Array.isArray(placements) ? placements : [];
  const closingEntry = Number.isInteger(options.closingEntry)
    ? options.closingEntry
    : null;
  const createdEntry =
    options.createdEntry && typeof options.createdEntry === "object"
      ? options.createdEntry
      : null;
  const section = findPomodorosSectionInLines(lines);
  const entries = parseSuccessorLedgerEntries(lines);
  const entryOfLine = (line) => {
    let owner = null;
    for (const entry of entries) {
      if (entry.entryLine <= line) {
        owner = entry;
      } else {
        break;
      }
    }
    return owner;
  };

  const ops = [];
  const skipped = [];
  let seq = 0;

  const slotGroups = new Map();
  const implicitGroups = new Map();
  const closingItems = [];
  // Per-row destination overrides (§12.13 obsidian_destination): an
  // `existing` pick names its entry outright (verified by line + text
  // preimage below); a `new` pick names a placeholder to create.
  const overrideExistingGroups = new Map();
  const overrideNewGroups = new Map();
  list.forEach((placement, order) => {
    const override = placement && placement.override;
    if (override && override.kind === "existing" && Number.isInteger(override.entryLine)) {
      const target = override.entryLine;
      if (!overrideExistingGroups.has(target)) {
        overrideExistingGroups.set(target, []);
      }
      overrideExistingGroups.get(target).push({ placement, order });
      return;
    }
    if (override && override.kind === "new" && typeof override.name === "string" && override.name.trim()) {
      const name = override.name.trim();
      if (!overrideNewGroups.has(name)) {
        overrideNewGroups.set(name, []);
      }
      overrideNewGroups.get(name).push({ placement, order });
      return;
    }
    const anchor = placement && placement.anchor;
    if (anchor && anchor.bulletLine != null) {
      if (!slotGroups.has(anchor.bulletLine)) {
        slotGroups.set(anchor.bulletLine, []);
      }
      slotGroups.get(anchor.bulletLine).push({ placement, order });
    } else if (anchor && anchor.kind === "implicit") {
      const target = Number.isInteger(anchor.entryLine) ? anchor.entryLine : (placement.implicit && placement.implicit.entryLine);
      if (!Number.isInteger(target)) {
        closingItems.push({ placement, order });
      } else {
        if (!implicitGroups.has(target)) {
          implicitGroups.set(target, []);
        }
        implicitGroups.get(target).push({ placement, order });
      }
    } else {
      closingItems.push({ placement, order });
    }
  });

  for (const [bulletLine, items] of slotGroups) {
    if (
      !Number.isInteger(bulletLine) ||
      bulletLine < 0 ||
      bulletLine >= lines.length
    ) {
      for (const item of items) {
        skipped.push({
          key: (item.placement && item.placement.key) || null,
          order: item.order,
          reason: "no-anchor-bullet",
        });
      }
      continue;
    }
    const owner = entryOfLine(bulletLine);
    const indent = successorIndentOf(lines[bulletLine]);
    let end = bulletLine + 1;
    while (end < lines.length) {
      const text = lines[end];
      if (!text.trim()) {
        break;
      }
      if (!INDENTED_LIST_LINE_RE.test(text)) {
        break;
      }
      if (successorIndentOf(text).length <= indent.length) {
        break;
      }
      end += 1;
    }
    ops.push({
      at: end,
      deleteCount: 0,
      lines: items.map(
        (item) => `${indent}- ${item.placement.blockLink}`,
      ),
      seq: seq++,
      marks: items.map((item, index) => ({
        order: item.order,
        index,
        entryOriginal: owner ? owner.entryLine : null,
        entryCreated: false,
      })),
    });
  }

  // Implicit destinations (§12.3): entry children, one tab, after existing
  // children, replacing a lone stub. Never a closing placeholder.
  for (const [targetLine, items] of implicitGroups) {
    if (!Number.isInteger(targetLine) || targetLine < 0 || targetLine >= lines.length) {
      for (const item of items) {
        skipped.push({ key: (item.placement && item.placement.key) || null, order: item.order, reason: "no-implicit-entry" });
      }
      continue;
    }
    const target = entries.find((entry) => entry.entryLine === targetLine);
    if (!target || !target.open) {
      for (const item of items) {
        skipped.push({ key: (item.placement && item.placement.key) || null, order: item.order, reason: "no-implicit-entry" });
      }
      continue;
    }
    const range = section ? getSubBulletBlockRange(lines, targetLine, section) : { startLine: targetLine + 1, endLine: targetLine + 1 };
    const children = lines.slice(range.startLine, range.endLine);
    if (children.length === 1 && children[0].trim() === "-") {
      ops.push({
        at: range.startLine,
        deleteCount: 1,
        lines: items.map((item) => `\t- ${item.placement.blockLink}`),
        seq: seq++,
        marks: items.map((item, index) => ({ order: item.order, index, entryOriginal: targetLine, entryCreated: false })),
      });
    } else {
      ops.push({
        at: range.endLine,
        deleteCount: 0,
        lines: items.map((item) => `\t- ${item.placement.blockLink}`),
        seq: seq++,
        marks: items.map((item, index) => ({ order: item.order, index, entryOriginal: targetLine, entryCreated: false })),
      });
    }
  }

  // Overridden existing entries (§12.13): the pick's entry line + text
  // preimage must still hold and the entry must still be open; a moved or
  // closed entry fails its rows loudly instead of writing elsewhere.
  // Verified against these same staged lines, so a re-plan on fresh text
  // already re-checked them and the editor/vault snapshot guards the write.
  const insertOverrideChildren = (targetLine, items) => {
    const range = section
      ? getSubBulletBlockRange(lines, targetLine, section)
      : { startLine: targetLine + 1, endLine: targetLine + 1 };
    const children = lines.slice(range.startLine, range.endLine);
    if (children.length === 1 && children[0].trim() === "-") {
      ops.push({
        at: range.startLine,
        deleteCount: 1,
        lines: items.map((item) => `\t- ${item.placement.blockLink}`),
        seq: seq++,
        marks: items.map((item, index) => ({ order: item.order, index, entryOriginal: targetLine, entryCreated: false })),
      });
    } else {
      ops.push({
        at: range.endLine,
        deleteCount: 0,
        lines: items.map((item) => `\t- ${item.placement.blockLink}`),
        seq: seq++,
        marks: items.map((item, index) => ({ order: item.order, index, entryOriginal: targetLine, entryCreated: false })),
      });
    }
  };
  for (const [targetLine, items] of overrideExistingGroups) {
    const fail = (reason) => {
      for (const item of items) {
        skipped.push({
          key: (item.placement && item.placement.key) || null,
          order: item.order,
          reason,
        });
      }
    };
    if (!Number.isInteger(targetLine) || targetLine < 0 || targetLine >= lines.length) {
      fail("destination-moved");
      continue;
    }
    const pick = items[0].placement.override;
    if (String(lines[targetLine]).replace(/\r$/, "") !== pick.entryText) {
      fail("destination-moved");
      continue;
    }
    const target = entries.find((entry) => entry.entryLine === targetLine);
    if (!target || !target.open) {
      fail("destination-closed");
      continue;
    }
    insertOverrideChildren(targetLine, items);
  }

  // Overridden new names (§12.13): an open entry of the same name wins the
  // race (insert as its child); otherwise create one `- [ ] () — NAME`
  // placeholder per name at the same position block-id-prompt uses for new
  // entries (after the running entry's block, else after the last completed
  // entry's block, else before the first open entry, else top of section),
  // then insert beneath it. Several open timed entries fail the rows, as in
  // block-id-prompt. Created entries are marked so the reopen receipt owns
  // them exactly like closing placeholders.
  const canonicalOverrideName = (name) => String(name || "").trim().toUpperCase();
  const overrideOpenEntries = entries.filter((entry) => entry.open);
  const overrideTimedOpen = overrideOpenEntries.filter((entry) => {
    try {
      const parts = parsePomodoroEntryLineParts(String(lines[entry.entryLine] || ""));
      return !!parts && parts.placeholder !== true;
    } catch (_error) {
      return false;
    }
  });
  const overrideBlockEnd = (entryLine) => {
    const range = section
      ? getSubBulletBlockRange(lines, entryLine, section)
      : { startLine: entryLine + 1, endLine: entryLine + 1 };
    let end = range.endLine;
    while (end - 1 > entryLine && !String(lines[end - 1] || "").trim()) {
      end -= 1;
    }
    return end;
  };
  for (const [name, items] of overrideNewGroups) {
    const fail = (reason) => {
      for (const item of items) {
        skipped.push({
          key: (item.placement && item.placement.key) || null,
          order: item.order,
          reason,
        });
      }
    };
    const raced = overrideOpenEntries.find(
      (entry) => canonicalOverrideName(entry.name) === canonicalOverrideName(name),
    );
    if (raced) {
      insertOverrideChildren(raced.entryLine, items);
      continue;
    }
    if (overrideTimedOpen.length > 1) {
      fail("destination-ambiguous");
      continue;
    }
    let insertLine = null;
    if (overrideTimedOpen.length === 1) {
      insertLine = overrideBlockEnd(overrideTimedOpen[0].entryLine);
    } else {
      let lastCompleted = -1;
      if (section) {
        for (let line = section.startLine; line <= section.endLine; line += 1) {
          const text = String(lines[line] || "");
          if (!isTopLevelTaskLine(text)) {
            continue;
          }
          let status = null;
          try {
            status = getTaskStatusForLine(text, line);
          } catch (_error) {
            status = null;
          }
          if (!status || (status.symbol !== "x" && status.symbol !== "X")) {
            continue;
          }
          let parts = null;
          try {
            parts = parsePomodoroEntryLineParts(text);
          } catch (_error) {
            parts = null;
          }
          if (parts) {
            lastCompleted = line;
          }
        }
      }
      if (lastCompleted >= 0) {
        insertLine = overrideBlockEnd(lastCompleted);
      } else if (overrideOpenEntries.length > 0) {
        insertLine = overrideOpenEntries[0].entryLine;
      } else if (section) {
        insertLine = section.startLine;
      }
    }
    if (!Number.isInteger(insertLine) || insertLine < 0 || insertLine > lines.length) {
      fail("destination-unavailable");
      continue;
    }
    ops.push({
      at: insertLine,
      deleteCount: 0,
      lines: [
        formatPomodoroPlaceholderLine(name),
        ...items.map((item) => `\t- ${item.placement.blockLink}`),
      ],
      seq: seq++,
      marks: items.map((item, index) => ({
        order: item.order,
        index: 1 + index,
        entryOriginal: null,
        entryCreated: true,
      })),
    });
  }

  if (closingItems.length > 0) {
    let targetLine = null;
    let entryCreated = false;
    let placeholderOp = false;
    if (
      createdEntry &&
      Number.isInteger(createdEntry.line) &&
      createdEntry.line >= 0 &&
      createdEntry.line < lines.length
    ) {
      targetLine = createdEntry.line;
      entryCreated = true;
    } else if (
      closingEntry != null &&
      closingEntry >= 0 &&
      closingEntry < lines.length
    ) {
      const closedName = successorEntryNameAt(lines, closingEntry);
      if (closedName) {
        const next = entries.find(
          (entry) =>
            entry.open &&
            entry.entryLine > closingEntry &&
            entry.name === closedName,
        );
        if (next) {
          targetLine = next.entryLine;
        }
      }
      if (targetLine == null) {
        const range = section
          ? getSubBulletBlockRange(lines, closingEntry, section)
          : { startLine: closingEntry + 1, endLine: closingEntry + 1 };
        const placeholder = formatPomodoroPlaceholderLine(
          successorEntryNameAt(lines, closingEntry) || "",
        );
        ops.push({
          at: range.endLine,
          deleteCount: 0,
          lines: [
            placeholder,
            ...closingItems.map((item) => `\t- ${item.placement.blockLink}`),
          ],
          seq: seq++,
          marks: closingItems.map((item, index) => ({
            order: item.order,
            index: 1 + index,
            entryOriginal: null,
            entryCreated: true,
          })),
        });
        placeholderOp = true;
      }
    } else {
      for (const item of closingItems) {
        skipped.push({
          key: (item.placement && item.placement.key) || null,
          order: item.order,
          reason: "no-closing-entry",
        });
      }
    }
    if (targetLine != null && !placeholderOp) {
      const range = section
        ? getSubBulletBlockRange(lines, targetLine, section)
        : { startLine: targetLine + 1, endLine: targetLine + 1 };
      const children = lines.slice(range.startLine, range.endLine);
      if (children.length === 1 && children[0].trim() === "-") {
        ops.push({
          at: range.startLine,
          deleteCount: 1,
          lines: closingItems.map((item) => `\t- ${item.placement.blockLink}`),
          seq: seq++,
          marks: closingItems.map((item, index) => ({
            order: item.order,
            index,
            entryOriginal: targetLine,
            entryCreated,
          })),
        });
      } else {
        ops.push({
          at: range.endLine,
          deleteCount: 0,
          lines: closingItems.map((item) => `\t- ${item.placement.blockLink}`),
          seq: seq++,
          marks: closingItems.map((item, index) => ({
            order: item.order,
            index,
            entryOriginal: targetLine,
            entryCreated,
          })),
        });
      }
    }
  }

  ops.sort((left, right) => left.at - right.at || left.seq - right.seq);
  const out = lines.slice();
  let shift = 0;
  const linkLineByOrder = new Map();
  const entryLineByOrder = new Map();
  const createdByOrder = new Map();
  for (const op of ops) {
    const actual = op.at + shift;
    out.splice(actual, op.deleteCount, ...op.lines);
    for (const mark of op.marks) {
      linkLineByOrder.set(mark.order, actual + mark.index);
      if (mark.entryOriginal == null) {
        entryLineByOrder.set(mark.order, actual);
      } else {
        let entryLine = mark.entryOriginal;
        for (const earlier of ops) {
          if (earlier === op) {
            break;
          }
          if (earlier.at <= mark.entryOriginal) {
            entryLine += earlier.lines.length - earlier.deleteCount;
          }
        }
        entryLineByOrder.set(mark.order, entryLine);
      }
      createdByOrder.set(mark.order, mark.entryCreated === true);
    }
    shift += op.lines.length - op.deleteCount;
  }

  const finalEntries = parseSuccessorLedgerEntries(out);
  const firstPlaceholder = finalEntries.find(
    (entry) => entry.open && entry.placeholder,
  );
  const firstPlaceholderLine = firstPlaceholder
    ? firstPlaceholder.entryLine
    : null;
  const links = [];
  list.forEach((placement, order) => {
    if (!linkLineByOrder.has(order)) {
      return;
    }
    const entryLine = entryLineByOrder.get(order);
    const entry = finalEntries.find((item) => item.entryLine === entryLine);
    links.push({
      key: (placement && placement.key) || null,
      rowIndex: placement && placement.rowIndex != null ? placement.rowIndex : null,
      entry_name: entry && entry.name ? entry.name : "",
      entry_line: entryLine + 1,
      entry_created: createdByOrder.get(order) === true,
      next_up: firstPlaceholderLine != null && entryLine === firstPlaceholderLine,
      line: linkLineByOrder.get(order) + 1,
      block_link: placement ? placement.blockLink : null,
    });
  });

  return {
    text: out.join(ending),
    splices: ops.map((op) => ({
      at: op.at,
      deleteCount: op.deleteCount,
      lines: op.lines.slice(),
    })),
    links,
    skipped,
  };
}

function truncateSuccessorNoticeText(text, limit = SUCCESSOR_NOTICE_TEXT_LIMIT) {
  const value = String(text || "");
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

// Plain notice fallback and walk-toast form for the shared §12.5 notice
// model (`{ predecessors, unblocked, still_blocked, failure }`). One notice
// per gesture; silence (`""`) when nothing was unblocked. Never leads with
// a block ID; task text truncates at 48 characters with `…`.
function successorNoticeText(model = {}) {
  const source = model && typeof model === "object" ? model : {};
  const predecessors = Array.isArray(source.predecessors) ? source.predecessors : [];
  const unblocked = Array.isArray(source.unblocked) ? source.unblocked : [];
  const linked = unblocked.filter((row) => row && row.link);
  const notLinked = unblocked.filter((row) => row && !row.link);
  const failure = source.failure && typeof source.failure === "object" ? source.failure : null;
  const projectEmptySuffix = " · project has no open tasks";
  const isProjectEmptyRow = (row) => row && row.trigger === "project_empty";

  if (failure && Number(failure.count) > 0) {
    const pred = predecessors[0] && predecessors[0].text
      ? truncateSuccessorNoticeText(predecessors[0].text)
      : "tasks";
    const count = Number(failure.count);
    const themed = unblocked.filter((row) => row && row.theme_changed === true);
    const themeClause = themed.length > 0
      ? ` · task type ${themed.length === 1 && themed[0].theme_action === "clear" ? "cleared" : "saved"}`
      : "";
    return `⚠ Closed ${pred} — couldn't link ${count} successor${count === 1 ? "" : "s"} (${failure.reason || "daily note changed"})${themeClause}`;
  }
  // Mixed picked/unpicked batches (§12.6 pulled-in summary) before single.
  if (linked.length > 0 && notLinked.length > 0) {
    const total = linked.length + notLinked.length;
    return `🔓 Pulled in ${linked.length} of ${total}`;
  }
  if (linked.length === 1) {
    const row = linked[0];
    const text = truncateSuccessorNoticeText(row.text);
    const name = (row.link && row.link.entry_name) || "";
    const suffix = isProjectEmptyRow(row) ? projectEmptySuffix : "";
    const themeChip = typeof formatSuccessorThemeRowChip === "function" ? formatSuccessorThemeRowChip(row) : "";
    if (row.link && row.link.entry_created) {
      return name
        ? `🔓 Next in new ${name} session (next up): ${text}${suffix}${themeChip}`
        : `🔓 Next in new session (next up): ${text}${suffix}${themeChip}`;
    }
    return name
      ? `🔓 Next in ${name}: ${text}${suffix}${themeChip}`
      : `🔓 Next at line ${(row.link && row.link.line) || "?"}: ${text}${suffix}${themeChip}`;
  }
  if (linked.length > 1) {
    const names = [];
    for (const row of linked) {
      const label = (row.link && row.link.entry_name) ||
        `line ${(row.link && row.link.line) || "?"}`;
      if (!names.includes(label)) {
        names.push(label);
      }
    }
    const allProjectEmpty = linked.every(isProjectEmptyRow);
    const suffix = allProjectEmpty ? projectEmptySuffix : "";
    const themedCount = linked.filter((row) => row && row.theme_changed === true).length;
    const themeSuffix = themedCount > 0 ? ` · ${themedCount} task type${themedCount === 1 ? "" : "s"} saved` : "";
    if (names.length === 1) {
      const shown = linked
        .slice(0, 2)
        .map((row) => truncateSuccessorNoticeText(row.text));
      const more = linked.length > 2 ? `, +${linked.length - 2}` : "";
      return `🔓 ${linked.length} linked → ${names[0]}: ${shown.join(", ")}${more}${suffix}${themeSuffix}`;
    }
    return `🔓 ${linked.length} linked · ${names.join(", ")}${suffix}${themeSuffix}`;
  }
  // Legacy breaker copy: kept for older payloads only. New output never
  // emits breaker rows (§12.2 BREAKER deleted).
  const breaker = notLinked.filter((row) => row.not_linked === "breaker");
  if (breaker.length > 0 && breaker.length === notLinked.length) {
    return `🔓 ${breaker.length} unblocked · not linked (more than 5)`;
  }
  if (linked.length === 0 && notLinked.length > 0) {
    const notSelected = notLinked.filter((row) => row.not_linked === "not_selected");
    const noDestination = notLinked.filter((row) => row.not_linked === "no_destination");
    if (notSelected.length > 0 && notSelected.length === notLinked.length) {
      if (notLinked.length === 1) {
        const row = notLinked[0];
        const lane = row.status_name || successorStatusName(row.status_symbol);
        const suffix = isProjectEmptyRow(row) ? projectEmptySuffix : "";
        return `🔓 Unblocked: ${truncateSuccessorNoticeText(row.text)} (${lane}) · not pulled in${suffix}`;
      }
      const suffix = notLinked.every(isProjectEmptyRow) ? projectEmptySuffix : "";
      return `🔓 ${notLinked.length} unblocked · not pulled in${suffix}`;
    }
    if (noDestination.length > 0 && noDestination.length === notLinked.length) {
      if (notLinked.length === 1) {
        const row = notLinked[0];
        const lane = row.status_name || successorStatusName(row.status_symbol);
        return `🔓 Unblocked: ${truncateSuccessorNoticeText(row.text)} (${lane}) · no open Pomodoro`;
      }
      return `🔓 ${notLinked.length} unblocked · no open Pomodoro`;
    }
  }
  if (notLinked.length === 1) {
    const row = notLinked[0];
    const lane = row.status_name || successorStatusName(row.status_symbol);
    if (isProjectEmptyRow(row) && row.hide_removed && row.previous_status_symbol === row.status_symbol) {
      return `🔓 Surfaced: ${truncateSuccessorNoticeText(row.text)} (${lane})${projectEmptySuffix}`;
    }
    if (isProjectEmptyRow(row)) {
      return `🔓 Unblocked: ${truncateSuccessorNoticeText(row.text)} (${lane})${projectEmptySuffix}`;
    }
    if (row.not_linked === "project_member") {
      return `🔓 Unblocked: ${truncateSuccessorNoticeText(row.text)} (${lane}) · project member`;
    }
    if (row.not_linked === "no_destination") {
      return `🔓 Unblocked: ${truncateSuccessorNoticeText(row.text)} (${lane}) · no open Pomodoro`;
    }
    if (row.not_linked === "not_selected") {
      return `🔓 Unblocked: ${truncateSuccessorNoticeText(row.text)} (${lane}) · not pulled in`;
    }
    return `🔓 Unblocked: ${truncateSuccessorNoticeText(row.text)} (${lane})`;
  }
  if (notLinked.length > 1) {
    const shown = notLinked.slice(0, 3).map(
      (row) => `${truncateSuccessorNoticeText(row.text)} (${row.status_name || successorStatusName(row.status_symbol)})`,
    );
    const more = notLinked.length > 3 ? `, +${notLinked.length - 3} more` : "";
    const suffix = notLinked.every(isProjectEmptyRow) ? projectEmptySuffix : "";
    return `🔓 Unblocked: ${shown.join(", ")}${more}${suffix}`;
  }
  return "";
}

// --- Loaders ---
// Duplicated from bob-ledger-tools intentionally: deployed plugins must not
// import one another (see `010-core.js:70`).
const SUCCESSOR_DAILY_NOTES_COMMAND_ID = "daily-notes";
const SUCCESSOR_DEFAULT_DAILY_FORMAT = "YYYY/YYYYMMDD";
const SUCCESSOR_DAILY_FORMAT_TOKENS = ["YYYY", "YY", "MM", "DD", "M", "D"];

function successorDailyDateTokens(value) {
  const date = value instanceof Date ? value : new Date(value);
  const yearText = String(date.getFullYear());
  const monthNumber = date.getMonth() + 1;
  const monthText = String(monthNumber).padStart(2, "0");
  const dayNumber = date.getDate();
  const dayText = String(dayNumber).padStart(2, "0");
  return {
    YYYY: yearText,
    YY: yearText.slice(-2),
    MM: monthText,
    DD: dayText,
    M: String(monthNumber),
    D: String(dayNumber),
  };
}

function successorFormatDailyDate(value, format = SUCCESSOR_DEFAULT_DAILY_FORMAT) {
  const source = String(format || SUCCESSOR_DEFAULT_DAILY_FORMAT);
  const tokens = successorDailyDateTokens(value);
  let result = "";
  for (let index = 0; index < source.length;) {
    if (source[index] === "[") {
      const endIndex = source.indexOf("]", index + 1);
      if (endIndex !== -1) {
        result += source.slice(index + 1, endIndex);
        index = endIndex + 1;
        continue;
      }
    }
    const token = SUCCESSOR_DAILY_FORMAT_TOKENS.find((candidate) =>
      source.startsWith(candidate, index),
    );
    if (token) {
      result += tokens[token];
      index += token.length;
      continue;
    }
    result += source[index];
    index += 1;
  }
  return result;
}

function successorNormalizeVaultPath(value) {
  const text = String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!text) {
    return "";
  }
  const compactPath = text.replace(/\/+/g, "/").replace(/\/$/, "");
  if (typeof normalizePath === "function") {
    return normalizePath(compactPath).replace(/^\/+/, "");
  }
  return compactPath;
}

function successorEnsureMarkdownExtension(path) {
  const normalized = successorNormalizeVaultPath(path);
  return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
}

function successorJoinVaultPath(folder, path) {
  const normalizedPath = successorNormalizeVaultPath(path);
  const normalizedFolder = successorNormalizeVaultPath(folder);
  return normalizedFolder
    ? successorNormalizeVaultPath(`${normalizedFolder}/${normalizedPath}`)
    : normalizedPath;
}

function successorDailyNotesOptions(app) {
  const internalPlugins = app && app.internalPlugins;
  const plugin =
    (internalPlugins &&
      internalPlugins.plugins &&
      internalPlugins.plugins[SUCCESSOR_DAILY_NOTES_COMMAND_ID]) ||
    (internalPlugins && typeof internalPlugins.getPluginById === "function"
      ? internalPlugins.getPluginById(SUCCESSOR_DAILY_NOTES_COMMAND_ID)
      : null);
  const instance = plugin && plugin.instance;
  return (instance && instance.options) || {};
}

// Vault-relative path of today's daily note, mirroring ledger's
// `todayDailyPath` (`020-time-and-pomodoro.js:278`).
function todayDailyPath(app, now = new Date()) {
  const options = successorDailyNotesOptions(app) || {};
  const path = successorEnsureMarkdownExtension(
    successorFormatDailyDate(now, options.format || SUCCESSOR_DEFAULT_DAILY_FORMAT),
  );
  return successorJoinVaultPath(options.folder || "", path);
}

function successorRequireOptionalNodeModule(name) {
  try {
    if (typeof require !== "function") {
      return null;
    }
    return require(name);
  } catch (_error) {
    return null;
  }
}

function successorJoinPathSegments(firstSegment, ...restSegments) {
  const trim = (text, side) => {
    const value = String(text || "");
    if (side === "left") {
      return value.replace(/^\/+/, "");
    }
    if (side === "right") {
      return value.replace(/\/+$/, "");
    }
    return value.replace(/^\/+|\/+$/g, "");
  };
  const first = trim(firstSegment, "right");
  const rest = restSegments
    .map((segment) => trim(segment, "both"))
    .filter((segment) => segment.length > 0);
  return [first, ...rest].filter((segment) => segment.length > 0).join("/");
}

function successorConfigHomeDir(osModule, env) {
  if (osModule && typeof osModule.homedir === "function") {
    try {
      const home = osModule.homedir();
      if (typeof home === "string" && home.trim()) {
        return home;
      }
    } catch (_error) {
      // Fall through to $HOME below.
    }
  }
  if (env && typeof env.HOME === "string" && env.HOME.trim()) {
    return env.HOME;
  }
  return "~";
}

// Config path for `plan.link_unblocked`, honoring `$XDG_CONFIG_HOME` like
// ledger's `planConfigPath`.
function successorPlanConfigPath(options = {}) {
  const env = options.env ||
    (typeof process !== "undefined" && process.env ? process.env : {});
  const osModule = options.osModule === undefined
    ? successorRequireOptionalNodeModule("os")
    : options.osModule;
  const xdgConfigHome =
    typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()
      ? env.XDG_CONFIG_HOME
      : null;
  const configHome = xdgConfigHome ||
    successorJoinPathSegments(successorConfigHomeDir(osModule, env), ".config");
  return successorJoinPathSegments(configHome, "bob/config.yml");
}

let successorLinkUnblockedCache = { key: null, result: true };

function resetSuccessorLinkUnblockedCache() {
  successorLinkUnblockedCache = { key: null, result: true };
}

function successorConfigStatKey(fsModule, configPath) {
  try {
    if (!fsModule || typeof fsModule.statSync !== "function") {
      return null;
    }
    const stat = fsModule.statSync(configPath);
    const mtime =
      stat && stat.mtimeMs !== undefined && stat.mtimeMs !== null
        ? stat.mtimeMs
        : stat && stat.mtime
          ? Number(stat.mtime)
          : "?";
    const size =
      stat && stat.size !== undefined && stat.size !== null ? stat.size : "?";
    return `${mtime}:${size}`;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "missing";
    }
    return null;
  }
}

function parseSuccessorLinkUnblockedScalar(raw) {
  const value = String(raw || "")
    .replace(/["']/g, "")
    .split("#")[0]
    .trim()
    .toLowerCase();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return true;
}

// Minimal `plan:` → `link_unblocked:` reader (block style plus single-line
// flow style). Anything missing or invalid reads `true` (§12.8).
function parseSuccessorLinkUnblocked(text) {
  let inPlan = false;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) {
      continue;
    }
    const top = line.match(/^([A-Za-z0-9_-]+)\s*:(.*)$/);
    if (top) {
      inPlan = top[1] === "plan";
      if (inPlan) {
        const rest = top[2].trim();
        if (rest) {
          const flow = rest.match(/link_unblocked\s*:\s*([^,\s}]+)/i);
          if (flow) {
            return parseSuccessorLinkUnblockedScalar(flow[1]);
          }
          if (/^\{.*\}$/.test(rest)) {
            return true;
          }
        }
      }
      continue;
    }
    if (inPlan) {
      const nested = line.match(/^\s+link_unblocked\s*:\s*(\S+)/i);
      if (nested) {
        return parseSuccessorLinkUnblockedScalar(nested[1]);
      }
    }
  }
  return true;
}

// Read the `plan.link_unblocked` kill switch from
// `$XDG_CONFIG_HOME/bob/config.yml` (else `~/.config/bob/config.yml`),
// stat-cached on mtime and size like ledger's `loadPlanCaps`. A missing or
// invalid value reads `true`. Pure apart from the config read.
function loadLinkUnblocked(options = {}) {
  const env = options.env ||
    (typeof process !== "undefined" && process.env ? process.env : {});
  const osModule = options.osModule === undefined
    ? successorRequireOptionalNodeModule("os")
    : options.osModule;
  const fsModule = options.fsModule === undefined
    ? successorRequireOptionalNodeModule("fs")
    : options.fsModule;
  const configPath = options.configPath || successorPlanConfigPath({ env, osModule });
  if (!fsModule || typeof fsModule.readFileSync !== "function") {
    return true;
  }
  const statKey = successorConfigStatKey(fsModule, configPath);
  const key = statKey == null ? null : `${configPath}|${statKey}`;
  if (key != null && successorLinkUnblockedCache.key === key) {
    return successorLinkUnblockedCache.result;
  }
  let result = true;
  try {
    result = parseSuccessorLinkUnblocked(fsModule.readFileSync(configPath, "utf8"));
  } catch (_error) {
    result = true;
  }
  if (key != null) {
    successorLinkUnblockedCache = { key, result };
  }
  return result;
}
