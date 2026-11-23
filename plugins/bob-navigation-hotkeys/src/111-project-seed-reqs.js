// Promotion seed rule: requirements become tasks, notes become Notes.
// Twin-aware rewrite of `buildProjectSeedFromChildBullets` per
// plan 202611/task_requirements.md §8 (bob-cli-on.12).
//
// - Pending top-level reqs become open `## Tasks` rows. Descendant reqs stay
//   reqs, and direct notes of a row that owns child reqs are filed into a
//   `NOTES` drawer (born only when a note lands, per `with_first_note`).
// - Dropped reqs become `[-]` rows keeping their Cancel Log; legacy `[x]`
//   reqs become `[x]` rows; carried `[>]` stubs become `## Notes` lines.
// - Loose notes and `NOTES` (plus legacy `REQUIREMENTS`) merge into one
//   `## Notes` section, even on requirement-less tasks. Other drawers stay
//   `## Title Case` sections. Managed logs stay under `^prj`.
// - Unmarked children never become `#task` rows. Images and Gmail links are
//   notes.
// - The lossless refusal is kept for content no rule covers.
//
// Rust stays the authority for RQ/RL/RW; this fragment only reads the nav RQ
// twin (`taskReqForest`) and the existing seed helpers. It is deliberately a
// new fragment so `110-project-seed.js` stays under its line cap.

function projectSeedReqNotesKey(title) {
  try {
    const key = drawer_key(String(title || "").trim());
    return key === TASK_BLOCK_NOTES_KEY || key === "REQUIREMENTS" ? TASK_BLOCK_NOTES_KEY : key;
  } catch (_error) {
    const normalized = String(title || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    return normalized === TASK_BLOCK_NOTES_KEY || normalized === "REQUIREMENTS"
      ? TASK_BLOCK_NOTES_KEY
      : normalized;
  }
}

function projectSeedReqIsNotesDrawerTitle(title) {
  return projectSeedReqNotesKey(title) === TASK_BLOCK_NOTES_KEY;
}

// Build a promoted task line from a direct-child req or subtask. Pending and
// unknown marks normalize to open; dropped and legacy keep their mark;
// subtasks keep their own status. Adds `#task` unless present and
// `[created::DATE]` unless present, preserving trailing block IDs.
function buildProjectSeedReqTaskLine(parsedChild, createdDateString, targetMark) {
  if (!parsedChild) {
    return null;
  }
  const mark = targetMark === null || targetMark === undefined
    ? String(parsedChild.status === null || parsedChild.status === undefined ? " " : parsedChild.status)
    : String(targetMark);
  const trimmedBody = String(parsedChild.body || "").trim();
  let taskBody;
  if (parsedChild.hasTask) {
    taskBody = trimmedBody;
  } else if (trimmedBody) {
    taskBody = `#task ${trimmedBody}`;
  } else {
    taskBody = "#task";
  }
  if (!parsedChild.hasCreated && createdDateString) {
    const createdField = `[created::${createdDateString}]`;
    const appendIndex = getBulletPropertyAppendIndex(taskBody);
    const before = taskBody.slice(0, appendIndex).replace(/[ \t]+$/, "");
    const after = taskBody.slice(appendIndex).replace(/^[ \t]+/, " ");
    taskBody = `${before} ${createdField}${after}`;
  }
  return `- [${mark}] ${taskBody}`;
}

function projectSeedReqDirectChildIndexes(lines, directChildIndentLength) {
  const indexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const listMatch = PROJECT_LIST_ITEM_RE.exec(lines[index]);
    if (listMatch && listMatch[1].length === directChildIndentLength) {
      indexes.push(index);
    }
  }
  return indexes;
}

function projectSeedReqSpanEnd(directChildIndexes, position, lineCount) {
  return position + 1 < directChildIndexes.length
    ? directChildIndexes[position + 1]
    : lineCount;
}

function projectSeedReqShallowestNestedIndent(lines, start, end, directChildIndentLength) {
  let nestedIndentLength = null;
  let nestedIndent = "";
  for (let index = start + 1; index < end; index += 1) {
    const listMatch = PROJECT_LIST_ITEM_RE.exec(lines[index]);
    if (listMatch && listMatch[1].length > directChildIndentLength) {
      if (nestedIndentLength === null || listMatch[1].length < nestedIndentLength) {
        nestedIndentLength = listMatch[1].length;
        nestedIndent = listMatch[1];
      }
    }
  }
  return nestedIndentLength === null ? null : nestedIndent;
}

function projectSeedReqTrimLines(noteLines) {
  const kept = noteLines.slice();
  while (kept.length && String(kept[0] || "").trim() === "") {
    kept.shift();
  }
  while (kept.length && String(kept[kept.length - 1] || "").trim() === "") {
    kept.pop();
  }
  return kept;
}

// Strip exactly `directChildIndent` from a direct-child line so a Notes entry
// lands at column 0. Falls back to trimming leading whitespace.
function projectSeedReqStripDirectIndent(line, directChildIndent) {
  const text = String(line || "");
  const base = String(directChildIndent || "");
  if (base && text.startsWith(base)) {
    return text.slice(base.length);
  }
  return text.replace(/^(\s*)/, "");
}

function buildProjectSeedFromChildBulletsReqs(childLines, createdDateString) {
  const lines = Array.isArray(childLines)
    ? childLines.map((line) => String(line === null || line === undefined ? "" : line))
    : [];

  let directChildIndentLength = null;
  let directChildIndent = "";
  for (const line of lines) {
    const match = PROJECT_LIST_ITEM_RE.exec(line);
    if (match) {
      const length = match[1].length;
      if (directChildIndentLength === null || length < directChildIndentLength) {
        directChildIndentLength = length;
        directChildIndent = match[1];
      }
    }
  }

  if (directChildIndentLength === null) {
    const hasContent = lines.some((line) => line.trim() !== "");
    return Object.freeze({
      taskLines: Object.freeze([]),
      sections: Object.freeze([]),
      managedLogLines: Object.freeze([]),
      lossless: !hasContent,
    });
  }

  const directChildIndexes = projectSeedReqDirectChildIndexes(lines, directChildIndentLength);

  // Synthetic owner lets the RQ twin classify direct children: checkbox lines
  // without `#task` whose structural parent is the owner (or another req) are
  // reqs. Nested `#task` lines own their own reqs and never count here.
  let forestBySyntheticLine = new Map();
  try {
    const synthetic = ["- [ ] #task __PROMOTION_SOURCE__", ...lines].join("\n");
    const forest = taskReqForest(synthetic, {});
    forestBySyntheticLine = new Map(
      forest
        .filter((node) => node && Number.isInteger(node.lineIndex) && node.ownerIndex === 0)
        .map((node) => [node.lineIndex, node]),
    );
  } catch (_error) {
    forestBySyntheticLine = new Map();
  }
  const reqNodeForChildLine = (childLineIndex) => forestBySyntheticLine.get(childLineIndex + 1) || null;

  const taskLines = [];
  const sectionEntries = [];
  const sectionEntryByTitle = new Map();
  const managedLogLines = [];
  let lossless = true;

  const pushSectionNoteLines = (title, nextLines) => {
    const trimmedTitle = String(title || "").trim();
    if (!trimmedTitle || !Array.isArray(nextLines) || nextLines.length === 0) {
      return;
    }
    const cleaned = projectSeedReqTrimLines(nextLines.map(String));
    if (cleaned.length === 0) {
      return;
    }
    const normalizedTitle = normalizeProjectSectionTitle(trimmedTitle);
    let entry = sectionEntryByTitle.get(normalizedTitle);
    if (!entry) {
      entry = { title: trimmedTitle, noteLines: [] };
      sectionEntryByTitle.set(normalizedTitle, entry);
      sectionEntries.push(entry);
    }
    entry.noteLines.push(...cleaned);
  };

  // Loose notes, NOTES contents, and carried stubs merge into one ## Notes
  // section in source order (with_first_note: the section is born with the
  // first note that lands).
  const pushNotesLines = (nextLines) => {
    pushSectionNoteLines("Notes", nextLines);
  };

  // Classify nested direct children of one promoted outer row so NOTES filing
  // can tell reqs from direct notes. Returns { hasChildReqs, directNotes,
  // notesDrawerEntries, otherNested } where each is a list of { lineIndex }
  // or rendered lines. Only list-item lines at the shallowest nested indent
  // count as direct children; deeper lines travel with their direct parent.
  const classifyPromotedSubtree = (start, end) => {
    let childIndentLength = null;
    for (let index = start + 1; index < end; index += 1) {
      const listMatch = PROJECT_LIST_ITEM_RE.exec(lines[index]);
      if (listMatch && listMatch[1].length > directChildIndentLength) {
        if (childIndentLength === null || listMatch[1].length < childIndentLength) {
          childIndentLength = listMatch[1].length;
        }
      }
    }
    if (childIndentLength === null) {
      return { hasChildReqs: false, directUnits: [], notesDrawerBase: null, notesDrawerEntries: [] };
    }
    // One unit per direct child: its line plus every later line until the
    // next direct child of the same outer.
    const directUnits = [];
    let currentUnit = null;
    for (let index = start + 1; index < end; index += 1) {
      const text = lines[index];
      if (text.trim() === "") {
        if (currentUnit) {
          currentUnit.lines.push({ lineIndex: index, text });
        }
        continue;
      }
      const listMatch = PROJECT_LIST_ITEM_RE.exec(text);
      const isDirect = Boolean(listMatch && listMatch[1].length === childIndentLength);
      if (isDirect) {
        if (currentUnit) {
          directUnits.push(currentUnit);
        }
        currentUnit = { lineIndex: index, lines: [{ lineIndex: index, text }] };
      } else if (currentUnit) {
        currentUnit.lines.push({ lineIndex: index, text });
      } else {
        // Deeper than direct but before any direct child (should not happen
        // in well-formed lists): keep it with the row verbatim.
        directUnits.push({ lineIndex: index, lines: [{ lineIndex: index, text }], stray: true });
      }
    }
    if (currentUnit) {
      directUnits.push(currentUnit);
    }

    let hasChildReqs = false;
    for (const unit of directUnits) {
      if (unit.stray) {
        continue;
      }
      if (reqNodeForChildLine(unit.lineIndex)) {
        hasChildReqs = true;
        break;
      }
      // A nested #task subtask can own reqs deeper down.
      try {
        const parsed = parseProjectChildListItem(lines[unit.lineIndex], directChildIndentLength);
        if (parsed && parsed.hasTask) {
          for (const entry of unit.lines.slice(1)) {
            if (reqNodeForChildLine(entry.lineIndex)) {
              hasChildReqs = true;
              break;
            }
          }
          if (hasChildReqs) {
            break;
          }
        }
      } catch (_error) {
        // Fall through to verbatim handling.
      }
    }
    // Also catch deeper reqs whose direct parent is a req (depth >= 2):
    // any forest node in this span other than the outer line itself means the
    // outer owns child reqs, even when indentation is mixed.
    if (!hasChildReqs) {
      for (let index = start + 1; index < end; index += 1) {
        if (reqNodeForChildLine(index)) {
          hasChildReqs = true;
          break;
        }
      }
    }
    return { hasChildReqs, directUnits, childIndentLength };
  };

  const renderNotesDrawer = (entryLines) => {
    const out = ["  - NOTES"];
    const nonblank = entryLines.filter((line) => String(line || "").trim() !== "");
    if (nonblank.length === 0) {
      return [];
    }
    // Rebase entries to the standard 4-space NOTES base, preserving relative
    // depth among entries.
    let baseLength = null;
    for (const line of entryLines) {
      const text = String(line || "");
      if (text.trim() === "") {
        continue;
      }
      const leadingMatch = /^(\s*)/.exec(text);
      const leading = leadingMatch ? leadingMatch[1] : "";
      if (baseLength === null || leading.length < baseLength) {
        baseLength = leading.length;
      }
    }
    if (baseLength === null) {
      baseLength = 0;
    }
    for (const line of entryLines) {
      const text = String(line || "");
      if (text.trim() === "") {
        out.push("");
        continue;
      }
      const leadingMatch = /^(\s*)/.exec(text);
      const leading = leadingMatch ? leadingMatch[1] : "";
      const content = text.slice(leading.length);
      const relative = leading.length >= baseLength ? leading.slice(baseLength) : "";
      out.push(`    ${relative}${content}`);
    }
    return projectSeedReqTrimLines(out);
  };

  if (directChildIndexes.length > 0) {
    for (let index = 0; index < directChildIndexes[0]; index += 1) {
      if (String(lines[index] || "").trim() !== "") {
        lossless = false;
      }
    }
  }
  for (let position = 0; position < directChildIndexes.length; position += 1) {
    const start = directChildIndexes[position];
    const end = projectSeedReqSpanEnd(directChildIndexes, position, lines.length);
    const line = lines[start];

    const parsedManagedLog = parseManagedTaskLogParentBullet(line);
    if (parsedManagedLog) {
      const logLines = [normalizeProjectManagedLogLine(line, parsedManagedLog.indent)];
      for (let index = start + 1; index < end; index += 1) {
        const nested = lines[index];
        if (String(nested || "").trim() === "") {
          logLines.push("");
          continue;
        }
        const leadingMatch = /^(\s*)/.exec(String(nested || ""));
        const leading = leadingMatch ? leadingMatch[1] : "";
        if (leading.length <= directChildIndentLength) {
          lossless = false;
          continue;
        }
        logLines.push(normalizeProjectManagedLogLine(nested, parsedManagedLog.markerIndent || parsedManagedLog.indent));
      }
      const cleaned = projectSeedReqTrimLines(logLines);
      managedLogLines.push(...cleaned);
      continue;
    }

    const parsedChild = parseProjectChildListItem(line, directChildIndentLength - 1);
    if (!parsedChild) {
      if (line.trim() !== "") {
        lossless = false;
      }
      continue;
    }
    const bodyTrimmed = String(parsedChild.body || "").trim();
    if (!bodyTrimmed) {
      lossless = false;
      continue;
    }

    // Nested #task subtasks promote as tasks, keeping their subtree.
    if (parsedChild.status !== null && parsedChild.status !== undefined && parsedChild.hasTask) {
      const taskLine = buildProjectSeedReqTaskLine(parsedChild, createdDateString, parsedChild.status);
      if (!taskLine) {
        lossless = false;
        continue;
      }
      const subtree = classifyPromotedSubtree(start, end);
      taskLines.push(taskLine);
      if (!subtree.directUnits || subtree.directUnits.length === 0) {
        for (let index = start + 1; index < end; index += 1) {
          const nested = lines[index];
          if (String(nested || "").trim() === "") {
            taskLines.push("");
            continue;
          }
          const leadingMatch = /^(\s*)/.exec(String(nested || ""));
          const leading = leadingMatch ? leadingMatch[1] : "";
          if (leading.length <= directChildIndentLength) {
            lossless = false;
            continue;
          }
          taskLines.push(normalizeNestedChildLine(nested, directChildIndent));
        }
        continue;
      }
      if (!subtree.hasChildReqs) {
        for (let index = start + 1; index < end; index += 1) {
          const nested = lines[index];
          if (String(nested || "").trim() === "") {
            taskLines.push("");
            continue;
          }
          const leadingMatch = /^(\s*)/.exec(String(nested || ""));
          const leading = leadingMatch ? leadingMatch[1] : "";
          if (leading.length <= directChildIndentLength) {
            lossless = false;
            continue;
          }
          taskLines.push(normalizeNestedChildLine(nested, directChildIndent));
        }
        continue;
      }
      // File this subtask row's direct notes into NOTES, keep the rest.
      const filedForNotes = [];
      const keptNested = [];
      let notesDrawerSeen = null;
      for (const unit of subtree.directUnits) {
        const unitFirst = lines[unit.lineIndex];
        const unitParsed = parseProjectChildListItem(unitFirst, directChildIndentLength);
        const managed = parseManagedTaskLogParentBullet(unitFirst);
        if (managed) {
          for (const entry of unit.lines) {
            keptNested.push(entry.text);
          }
          continue;
        }
        if (reqNodeForChildLine(unit.lineIndex)) {
          for (const entry of unit.lines) {
            keptNested.push(entry.text);
          }
          continue;
        }
        if (unitParsed && unitParsed.status === null) {
          const sectionTitle = parseProjectSectionBulletTitle(unitParsed.body);
          if (sectionTitle && projectSeedReqIsNotesDrawerTitle(unitParsed.body)) {
            notesDrawerSeen = unit;
            for (const entry of unit.lines.slice(1)) {
              filedForNotes.push(entry.text);
            }
            continue;
          }
        }
        if (unitParsed && unitParsed.status === null && !unit.stray) {
          for (const entry of unit.lines) {
            filedForNotes.push(entry.text);
          }
          continue;
        }
        for (const entry of unit.lines) {
          keptNested.push(entry.text);
        }
      }
      for (const kept of keptNested) {
        if (String(kept || "").trim() === "") {
          taskLines.push("");
          continue;
        }
        taskLines.push(normalizeNestedChildLine(String(kept || ""), directChildIndent));
      }
      if (filedForNotes.length > 0) {
        const drawerLines = renderNotesDrawer(filedForNotes);
        for (const drawerLine of drawerLines) {
          taskLines.push(drawerLine);
        }
      }
      continue;
    }

    // Checkbox without #task: a requirement candidate. Confirm with the RQ
    // twin so fenced, quoted, drawer-nested, and note-nested checkboxes never
    // promote. Fall back to today's task conversion only when the twin is
    // unavailable (never on a recognized non-req).
    const reqNode = reqNodeForChildLine(start);
    if (parsedChild.status !== null && parsedChild.status !== undefined && !parsedChild.hasTask && !reqNode) {
      // Not a req (e.g. checkbox under a note or drawer): it cannot convert.
      lossless = false;
      continue;
    }

    if (parsedChild.status !== null && parsedChild.status !== undefined && !parsedChild.hasTask && reqNode) {
      const markChar = String(parsedChild.status);
      if (markChar === ">") {
        // Carried stubs become Notes lines verbatim, keeping their subtree.
        pushNotesLines([projectSeedReqStripDirectIndent(line, directChildIndent)]);
        for (let index = start + 1; index < end; index += 1) {
          const nested = lines[index];
          if (String(nested || "").trim() === "") {
            pushNotesLines([""]);
            continue;
          }
          const leadingMatch = /^(\s*)/.exec(String(nested || ""));
          const leading = leadingMatch ? leadingMatch[1] : "";
          if (leading.length <= directChildIndentLength) {
            lossless = false;
            continue;
          }
          pushNotesLines([normalizeNestedChildLine(nested, directChildIndent)]);
        }
        continue;
      }
      const targetMark = markChar === "-" ? "-" : markChar === "x" || markChar === "X" ? markChar : " ";
      const taskLine = buildProjectSeedReqTaskLine(parsedChild, createdDateString, targetMark);
      if (!taskLine) {
        lossless = false;
        continue;
      }
      const subtree = classifyPromotedSubtree(start, end);
      taskLines.push(taskLine);
      if (!subtree.directUnits || subtree.directUnits.length === 0) {
        for (let index = start + 1; index < end; index += 1) {
          const nested = lines[index];
          if (String(nested || "").trim() === "") {
            taskLines.push("");
            continue;
          }
          const leadingMatch = /^(\s*)/.exec(String(nested || ""));
          const leading = leadingMatch ? leadingMatch[1] : "";
          if (leading.length <= directChildIndentLength) {
            lossless = false;
            continue;
          }
          taskLines.push(normalizeNestedChildLine(nested, directChildIndent));
        }
        continue;
      }
      if (!subtree.hasChildReqs) {
        // Leaf req: notes stay loose under the new task.
        for (let index = start + 1; index < end; index += 1) {
          const nested = lines[index];
          if (String(nested || "").trim() === "") {
            taskLines.push("");
            continue;
          }
          const leadingMatch = /^(\s*)/.exec(String(nested || ""));
          const leading = leadingMatch ? leadingMatch[1] : "";
          if (leading.length <= directChildIndentLength) {
            lossless = false;
            continue;
          }
          taskLines.push(normalizeNestedChildLine(nested, directChildIndent));
        }
        continue;
      }
      // The new task owns child reqs: file its direct notes into NOTES.
      const filedForNotes = [];
      const keptNested = [];
      for (const unit of subtree.directUnits) {
        const unitFirst = lines[unit.lineIndex];
        const managed = parseManagedTaskLogParentBullet(unitFirst);
        if (managed) {
          for (const entry of unit.lines) {
            keptNested.push(entry.text);
          }
          continue;
        }
        if (reqNodeForChildLine(unit.lineIndex)) {
          for (const entry of unit.lines) {
            keptNested.push(entry.text);
          }
          continue;
        }
        const unitParsed = parseProjectChildListItem(unitFirst, directChildIndentLength);
        if (unitParsed && unitParsed.status === null && !unit.stray) {
          const sectionTitle = parseProjectSectionBulletTitle(unitParsed.body);
          if (sectionTitle && projectSeedReqIsNotesDrawerTitle(unitParsed.body)) {
            for (const entry of unit.lines.slice(1)) {
              filedForNotes.push(entry.text);
            }
            continue;
          }
          // A nested #task subtask of a promoted row stays a subtask.
          if (unitParsed.hasTask) {
            for (const entry of unit.lines) {
              keptNested.push(entry.text);
            }
            continue;
          }
          for (const entry of unit.lines) {
            filedForNotes.push(entry.text);
          }
          continue;
        }
        // Checkbox without #task that the twin did not recognize, or a
        // deeper stray line: keep verbatim so nothing is lost silently.
        if (unitParsed && unitParsed.status !== null && !unitParsed.hasTask && !reqNodeForChildLine(unit.lineIndex)) {
          lossless = false;
        }
        for (const entry of unit.lines) {
          keptNested.push(entry.text);
        }
      }
      for (const kept of keptNested) {
        if (String(kept || "").trim() === "") {
          taskLines.push("");
          continue;
        }
        taskLines.push(normalizeNestedChildLine(String(kept || ""), directChildIndent));
      }
      if (filedForNotes.length > 0) {
        const drawerLines = renderNotesDrawer(filedForNotes);
        for (const drawerLine of drawerLines) {
          taskLines.push(drawerLine);
        }
      }
      continue;
    }

    // Plain bullets (no checkbox): drawers, NOTES, or loose notes.
    if (parsedChild.status === null) {
      const baseIndent = projectSeedReqShallowestNestedIndent(lines, start, end, directChildIndentLength);
      const sectionTitle = parseProjectSectionBulletTitle(parsedChild.body);
      if (sectionTitle && baseIndent !== null) {
        if (projectSeedReqIsNotesDrawerTitle(parsedChild.body)) {
          const drawerNotes = [];
          for (let index = start + 1; index < end; index += 1) {
            const nested = lines[index];
            if (String(nested || "").trim() === "") {
              drawerNotes.push("");
              continue;
            }
            const leadingMatch = /^(\s*)/.exec(String(nested || ""));
            const leading = leadingMatch ? leadingMatch[1] : "";
            if (leading.length <= directChildIndentLength) {
              lossless = false;
              continue;
            }
            drawerNotes.push(normalizeProjectSectionNoteLine(nested, baseIndent));
          }
          pushNotesLines(projectSeedReqTrimLines(drawerNotes));
          continue;
        }
        const sectionNotes = [];
        for (let index = start + 1; index < end; index += 1) {
          const nested = lines[index];
          if (String(nested || "").trim() === "") {
            sectionNotes.push("");
            continue;
          }
          const leadingMatch = /^(\s*)/.exec(String(nested || ""));
          const leading = leadingMatch ? leadingMatch[1] : "";
          if (leading.length <= directChildIndentLength) {
            lossless = false;
            continue;
          }
          sectionNotes.push(normalizeProjectSectionNoteLine(nested, baseIndent));
        }
        pushSectionNoteLines(sectionTitle, sectionNotes);
        continue;
      }
      // Loose notes (images, Gmail links, and every other unmarked bullet
      // included) become ## Notes, even on requirement-less tasks.
      pushNotesLines([projectSeedReqStripDirectIndent(line, directChildIndent)]);
      for (let index = start + 1; index < end; index += 1) {
        const nested = lines[index];
        if (String(nested || "").trim() === "") {
          pushNotesLines([""]);
          continue;
        }
        const leadingMatch = /^(\s*)/.exec(String(nested || ""));
        const leading = leadingMatch ? leadingMatch[1] : "";
        if (leading.length <= directChildIndentLength) {
          lossless = false;
          continue;
        }
        pushNotesLines([normalizeNestedChildLine(nested, directChildIndent)]);
      }
      continue;
    }

    lossless = false;
  }

  return Object.freeze({
    taskLines: Object.freeze(taskLines),
    sections: Object.freeze(
      sectionEntries.map((entry) =>
        Object.freeze({
          title: entry.title,
          noteLines: Object.freeze(projectSeedReqTrimLines(entry.noteLines)),
        }),
      ),
    ),
    managedLogLines: Object.freeze(managedLogLines),
    lossless,
  });
}

// Promotion receipt and empty-seed notice. Counts are top-level promoted
// task rows and nonblank `## Notes` lines so the receipt matches what the
// new note shows.
function projectSeedPromotionCounts(conversion) {
  const taskRows = Array.isArray(conversion && conversion.taskLines)
    ? conversion.taskLines.filter((line) => /^- \[[^\]\n]\] #task/.test(String(line || "")))
    : [];
  let noteCount = 0;
  for (const section of (conversion && conversion.sections) || []) {
    if (normalizeProjectSectionTitle(section && section.title) !== "notes") {
      continue;
    }
    for (const noteLine of section.noteLines || []) {
      if (String(noteLine || "").trim() !== "") {
        noteCount += 1;
      }
    }
  }
  return { taskCount: taskRows.length, noteCount };
}

function getProjectPromotionReceiptText(sourceDescription, taskCount, noteCount) {
  const subject = String(sourceDescription || "").trim().replace(/\s+/g, " ");
  const tasks = `${numericOrDefault(taskCount, 0)} ${numericOrDefault(taskCount, 0) === 1 ? "task" : "tasks"}`;
  const notes = `${numericOrDefault(noteCount, 0)} ${numericOrDefault(noteCount, 0) === 1 ? "note" : "notes"}`;
  return `Promoted “${subject}” · ${tasks} · ${notes}`;
}

const PROJECT_PROMOTION_NO_REQS_NOTICE = "No requirements to promote — Ctrl+] marks one";

// New seed rule shadows `110-project-seed.js`: requirements become tasks and
// loose notes become Notes. The old converter stays in place for history;
// this later fragment wins at runtime.
function buildProjectSeedFromChildBullets(childLines, createdDateString) {
  return buildProjectSeedFromChildBulletsReqs(childLines, createdDateString);
}
