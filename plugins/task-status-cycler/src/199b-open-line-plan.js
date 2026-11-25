// Pure o / O open-line planner (bob-cli-q4.2). Built on the RQ/RL twins;
// no Obsidian, no clock, no `this`. Non-task lines keep getOpenLineBelowPrefix
// bytes. A new Ready task is `{indent}- [ ] #task  [created::YYYY-MM-DD]`
// with the caret after `#task `.

const OPEN_LINE_GROUP_TITLES = Object.freeze([
  "Next & In Progress",
  "Blocked",
  "Done & Canceled",
]);
const OPEN_LINE_MANAGED_NOTICE = "Managed line · not a task";
const OPEN_LINE_PRJ_NO_TASKS_NOTICE = "No ## Tasks section — cannot open a task on ^prj";
const OPEN_LINE_TASKS_TITLE = "Tasks";

function openLineToday(today) {
  return typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)
    ? today
    : formatLocalDate();
}

function formatOpenLineTaskLine(indent, today) {
  return `${indent}- [ ] #task  [created::${openLineToday(today)}]`;
}

function openLineTaskCursorCh(indent) {
  return `${indent}- [ ] #task `.length;
}

function openLineReqLine(indent) {
  return `${indent}- [ ] `;
}

function openLineBulletLine(indent) {
  return `${indent}- `;
}

function openLineIsStatusGroupHeading(line) {
  const heading = taskBlockAtxHeading(line);
  return Boolean(
    heading &&
      heading.level >= 3 &&
      OPEN_LINE_GROUP_TITLES.includes(taskReqTrim(heading.title)),
  );
}

function openLineIsTasksHeading(line) {
  const heading = taskBlockAtxHeading(line);
  return Boolean(
    heading && heading.level === 2 && taskReqTrim(heading.title) === OPEN_LINE_TASKS_TITLE,
  );
}

function openLineFencedSet(doc) {
  return taskReqFencedLines(doc.texts, 0, doc.texts.length);
}

function openLineFrontmatterEnd(doc) {
  return taskReqFrontmatterEnd(doc.texts);
}

function openLineIsPlainContext(doc, lineIndex) {
  const frontmatterEnd = openLineFrontmatterEnd(doc);
  if (frontmatterEnd !== null && lineIndex <= frontmatterEnd) return true;
  if (openLineFencedSet(doc).has(lineIndex)) return true;
  const line = doc.texts[lineIndex] || "";
  if (taskBlockAtxHeading(line)) return true;
  if (doc.blank[lineIndex]) return true;
  return doc.bodies[lineIndex] === null;
}

function openLineSubtreeEnd(doc, lineIndex) {
  const indent = doc.indents[lineIndex];
  let end = lineIndex;
  for (let index = lineIndex + 1; index < doc.texts.length; index += 1) {
    if (doc.blank[index]) continue;
    if (doc.indents[index] > indent) {
      end = index;
      continue;
    }
    break;
  }
  return end;
}

function openLineTaskLastLine(doc, task) {
  return taskBlockLastLineIn(doc, task);
}

function openLineOwningTask(doc, tasks, lineIndex) {
  let owner = null;
  for (const task of tasks) {
    if (task.lineIndex > lineIndex) break;
    const last = openLineTaskLastLine(doc, task);
    if (lineIndex >= task.lineIndex && lineIndex <= last) owner = task;
  }
  return owner;
}

function openLineTaskAt(tasks, lineIndex) {
  return tasks.find((task) => task.lineIndex === lineIndex) || null;
}

function openLineParentTask(doc, tasks, task) {
  let parent = null;
  for (const candidate of tasks) {
    if (candidate.lineIndex >= task.lineIndex) break;
    const last = openLineTaskLastLine(doc, candidate);
    if (task.lineIndex <= last) parent = candidate;
  }
  return parent;
}

function openLineTasksSection(doc) {
  const fenced = openLineFencedSet(doc);
  let headingLine = null;
  for (let index = 0; index < doc.texts.length; index += 1) {
    if (fenced.has(index)) continue;
    if (openLineIsTasksHeading(doc.texts[index])) {
      headingLine = index;
      break;
    }
  }
  if (headingLine === null) return null;
  let endLine = doc.texts.length;
  const heading = taskBlockAtxHeading(doc.texts[headingLine]);
  const level = heading ? heading.level : 2;
  for (let index = headingLine + 1; index < doc.texts.length; index += 1) {
    if (fenced.has(index)) continue;
    const next = taskBlockAtxHeading(doc.texts[index]);
    if (next && next.level <= level) {
      endLine = index;
      break;
    }
  }
  let firstGroupLine = null;
  for (let index = headingLine + 1; index < endLine; index += 1) {
    if (fenced.has(index)) continue;
    if (openLineIsStatusGroupHeading(doc.texts[index])) {
      firstGroupLine = index;
      break;
    }
  }
  return {
    headingLine,
    endLine,
    firstGroupLine,
    intakeEnd: firstGroupLine === null ? endLine : firstGroupLine,
  };
}

function openLineEnclosingGroup(doc, lineIndex) {
  const fenced = openLineFencedSet(doc);
  let groupLine = null;
  for (let index = lineIndex; index >= 0; index -= 1) {
    if (fenced.has(index)) continue;
    const heading = taskBlockAtxHeading(doc.texts[index]);
    if (!heading) continue;
    if (openLineIsStatusGroupHeading(doc.texts[index])) {
      groupLine = index;
      break;
    }
    if (heading.level <= 2) break;
  }
  return groupLine;
}

function openLineChildCovering(block, lineIndex) {
  for (const child of block.children) {
    if (lineIndex >= child.lineIndex && lineIndex <= child.endIndex) return child;
  }
  return null;
}

function openLineIsReqLine(line, globalFilter) {
  return taskReqCheckboxMarkWithoutFilter(line, globalFilter) !== null;
}

function openLineManagedRefuse(contents, lineIndex) {
  const classified = openLineClassify(contents, lineIndex);
  if (!classified || classified.kind !== "managed") return null;
  return { mode: "refuse", message: OPEN_LINE_MANAGED_NOTICE };
}

function openLineClassify(contents, lineIndex) {
  const text = String(contents == null ? "" : contents);
  const doc = taskReqDocument(text);
  if (lineIndex < 0 || lineIndex >= doc.texts.length) return { kind: "plain", doc };
  if (openLineIsPlainContext(doc, lineIndex)) return { kind: "plain", doc };
  const tasks = taskReqNoteTasks(text);
  const headline = openLineTaskAt(tasks, lineIndex);
  if (headline) {
    if (taskBlockIsPrjParent(text, headline)) {
      return { kind: "prj", doc, task: headline, tasks };
    }
    if (openLineParentTask(doc, tasks, headline)) {
      return { kind: "nested-task", doc, task: headline, tasks };
    }
    if (openLineEnclosingGroup(doc, lineIndex) !== null) {
      return { kind: "grouped-task", doc, task: headline, tasks };
    }
    return { kind: "root-task", doc, task: headline, tasks };
  }
  const owner = openLineOwningTask(doc, tasks, lineIndex);
  if (owner) {
    const block = taskBlockRead(text, owner);
    const covering = openLineChildCovering(block, lineIndex);
    if (
      covering &&
      (covering.zone === "cancel-log" ||
        covering.zone === "managed-links" ||
        covering.zone === "logs")
    ) {
      return { kind: "managed", doc, task: owner, tasks, child: covering };
    }
    const line = doc.texts[lineIndex];
    if (openLineIsReqLine(line, TASK_BLOCK_DEFAULT_FILTER)) {
      return { kind: "req", doc, task: owner, tasks };
    }
    if (covering && covering.zone === "drawers" && covering.lineIndex === lineIndex) {
      return { kind: "drawer", doc, task: owner, tasks, child: covering };
    }
    return { kind: "note", doc, task: owner, tasks, child: covering };
  }
  return { kind: "item", doc, tasks };
}

function openLineShiftOrigin(originLine, insertBeforeLine, insertedCount) {
  return insertBeforeLine <= originLine ? originLine + insertedCount : originLine;
}

function openLineInsertPlan(options) {
  const {
    originLine,
    insertBeforeLine,
    lines,
    cursorCh,
    recordJump,
    scaffoldKind,
    createdDrawer,
    notice,
  } = options;
  const inserted = Array.isArray(lines) ? lines.filter((line) => line !== null) : [lines];
  const cursorLine = insertBeforeLine + (inserted.length - 1);
  return {
    kind: "insert",
    insertBeforeLine,
    lines: inserted,
    cursorLine,
    cursorCh,
    originLine: openLineShiftOrigin(originLine, insertBeforeLine, inserted.length),
    originCh: 0,
    recordJump: Boolean(recordJump),
    notice: notice || null,
    createdDrawer: Boolean(createdDrawer),
    scaffold: {
      kind: scaffoldKind,
      lineIndex: cursorLine,
      emptyText: inserted[inserted.length - 1],
      drawerLineIndex: createdDrawer ? insertBeforeLine : null,
      drawerEmptyText: createdDrawer ? inserted[0] : null,
    },
  };
}

function openLineLegacyPlan(doc, originLine, direction) {
  const lineText = doc.texts[originLine] || "";
  const prefix = getOpenLineBelowPrefix(lineText);
  if (direction === "above") {
    return openLineInsertPlan({
      originLine,
      insertBeforeLine: originLine,
      lines: [prefix],
      cursorCh: prefix.length,
      scaffoldKind: "legacy",
    });
  }
  return openLineInsertPlan({
    originLine,
    insertBeforeLine: originLine + 1,
    lines: [prefix],
    cursorCh: prefix.length,
    scaffoldKind: "legacy",
  });
}

function openLineAfterSubtreePlan(doc, originLine, direction, lineText, cursorCh, scaffoldKind) {
  if (direction === "above") {
    return openLineInsertPlan({
      originLine,
      insertBeforeLine: originLine,
      lines: [lineText],
      cursorCh,
      scaffoldKind,
    });
  }
  return openLineInsertPlan({
    originLine,
    insertBeforeLine: openLineSubtreeEnd(doc, originLine) + 1,
    lines: [lineText],
    cursorCh,
    scaffoldKind,
  });
}

function openLineNewTaskPlan(originLine, insertBeforeLine, indent, today, recordJump) {
  const line = formatOpenLineTaskLine(indent, today);
  return openLineInsertPlan({
    originLine,
    insertBeforeLine,
    lines: [line],
    cursorCh: openLineTaskCursorCh(indent),
    recordJump,
    scaffoldKind: "task",
  });
}

function openLineNoteSlotPlan(contents, originLine, task) {
  const text = String(contents == null ? "" : contents);
  let working = text;
  let workingTask = task;
  let createdDrawer = false;
  let home = taskBlockNoteHome(working, workingTask);
  if (home.home === "new-notes") {
    const ensured = taskBlockEnsureNotesDrawer(working, workingTask);
    if (!ensured) {
      return { kind: "refuse", notice: OPEN_LINE_MANAGED_NOTICE };
    }
    working = ensured.updated;
    createdDrawer = Boolean(ensured.created);
    const shifted = task.lineIndex;
    workingTask = taskBlockFindTask(working, shifted) || Object.assign({}, task, {
      blockEnd: task.blockEnd + (working.length - text.length),
    });
    home = taskBlockNoteHome(working, workingTask);
  }
  const doc = taskReqDocument(working);
  let insertBeforeLine;
  let indent;
  if (home.home === "notes" && home.drawer) {
    const insertion = taskBlockDrawerInsertion(working, home.drawer);
    indent = insertion.indentation;
    insertBeforeLine = doc.texts.length;
    for (let index = 0; index <= doc.texts.length; index += 1) {
      if (taskBlockLineOffset(doc, index) >= insertion.offset) {
        insertBeforeLine = index;
        break;
      }
    }
  } else if (home.home === "loose" && home.slot) {
    insertBeforeLine = home.slot.lineIndex;
    indent = home.slot.indent;
  } else {
    const slot = taskBlockInsertionSlot(working, workingTask, "authored");
    insertBeforeLine = slot.lineIndex;
    indent = slot.indent;
  }
  const noteLine = openLineBulletLine(indent);
  if (createdDrawer) {
    const drawerDoc = taskReqDocument(working);
    const drawers = taskBlockDrawers(working, workingTask);
    const notes = drawers.find((entry) => entry.key === TASK_BLOCK_NOTES_KEY);
    if (notes) {
      // The header is already in `working`; inserting it again would duplicate
      // it. Rebuild from the original text instead, emitting header + note.
      const originalDoc = taskReqDocument(text);
      const headerOffset = taskBlockDrawerHeaderOffset(text, task, true);
      let headerLine = originalDoc.texts.length;
      for (let index = 0; index <= originalDoc.texts.length; index += 1) {
        if (taskBlockLineOffset(originalDoc, index) >= headerOffset) {
          headerLine = index;
          break;
        }
      }
      return openLineInsertPlan({
        originLine,
        insertBeforeLine: headerLine,
        lines: [drawerDoc.texts[notes.lineIndex], noteLine],
        cursorCh: noteLine.length,
        scaffoldKind: "note",
        createdDrawer: true,
      });
    }
  }
  return openLineInsertPlan({
    originLine,
    insertBeforeLine,
    lines: [noteLine],
    cursorCh: noteLine.length,
    scaffoldKind: "note",
    createdDrawer,
  });
}

function planOpenLine(contents, lineIndex, direction, today) {
  const text = String(contents == null ? "" : contents);
  const dir = direction === "above" ? "above" : "below";
  const date = openLineToday(today);
  const classified = openLineClassify(text, lineIndex);
  const originLine = lineIndex;
  switch (classified.kind) {
    case "plain":
      return openLineLegacyPlan(classified.doc, originLine, dir);
    case "prj": {
      const section = openLineTasksSection(classified.doc);
      if (!section) {
        return { kind: "refuse", notice: OPEN_LINE_PRJ_NO_TASKS_NOTICE };
      }
      return openLineNewTaskPlan(originLine, section.intakeEnd, "", date, true);
    }
    case "grouped-task": {
      const section = openLineTasksSection(classified.doc);
      const groupLine = openLineEnclosingGroup(classified.doc, originLine);
      const insertBefore = section
        ? section.intakeEnd
        : groupLine !== null
          ? groupLine
          : classified.task.lineIndex;
      return openLineNewTaskPlan(
        originLine,
        insertBefore,
        classified.task.indentation,
        date,
        true,
      );
    }
    case "root-task": {
      if (dir === "above") {
        return openLineNewTaskPlan(
          originLine,
          originLine,
          classified.task.indentation,
          date,
          false,
        );
      }
      const last = taskBlockLastLineIn(classified.doc, classified.task);
      return openLineNewTaskPlan(
        originLine,
        last + 1,
        classified.task.indentation,
        date,
        false,
      );
    }
    case "nested-task": {
      const indent = classified.task.indentation;
      const line = formatOpenLineTaskLine(indent, date);
      if (dir === "above") {
        return openLineInsertPlan({
          originLine,
          insertBeforeLine: originLine,
          lines: [line],
          cursorCh: openLineTaskCursorCh(indent),
          scaffoldKind: "task",
        });
      }
      const last = taskBlockLastLineIn(classified.doc, classified.task);
      return openLineInsertPlan({
        originLine,
        insertBeforeLine: last + 1,
        lines: [line],
        cursorCh: openLineTaskCursorCh(indent),
        scaffoldKind: "task",
      });
    }
    case "req": {
      const indent = taskReqLeadingWhitespace(classified.doc.texts[originLine] || "");
      const line = openLineReqLine(indent);
      return openLineAfterSubtreePlan(
        classified.doc,
        originLine,
        dir,
        line,
        line.length,
        "req",
      );
    }
    case "drawer":
    case "note": {
      const indent = taskReqLeadingWhitespace(classified.doc.texts[originLine] || "");
      const line = openLineBulletLine(indent);
      return openLineAfterSubtreePlan(
        classified.doc,
        originLine,
        dir,
        line,
        line.length,
        "note",
      );
    }
    case "managed":
      return openLineNoteSlotPlan(text, originLine, classified.task);
    case "item": {
      const lineText = classified.doc.texts[originLine] || "";
      const prefix = getOpenLineBelowPrefix(lineText);
      if (dir === "above") {
        return openLineInsertPlan({
          originLine,
          insertBeforeLine: originLine,
          lines: [prefix],
          cursorCh: prefix.length,
          scaffoldKind: "legacy",
        });
      }
      return openLineInsertPlan({
        originLine,
        insertBeforeLine: openLineSubtreeEnd(classified.doc, originLine) + 1,
        lines: [prefix],
        cursorCh: prefix.length,
        scaffoldKind: "legacy",
      });
    }
    default:
      return openLineLegacyPlan(classified.doc, originLine, dir);
  }
}

function openLineJoin(contents, lines) {
  const ending = taskBlockDocumentLineEnding(contents);
  return lines.join(ending);
}

function applyOpenLinePlanToLines(lines, plan) {
  if (!plan || plan.kind !== "insert") return lines.slice();
  const next = lines.slice();
  const insertAt = Math.max(0, Math.min(plan.insertBeforeLine, next.length));
  next.splice(insertAt, 0, ...plan.lines);
  return next;
}

function openLineScaffoldIsEmpty(lineText, emptyText) {
  return String(lineText || "") === String(emptyText || "");
}

function pruneOpenLineScaffold(contents, scaffold) {
  if (!scaffold || typeof scaffold.lineIndex !== "number") return null;
  const doc = taskReqDocument(contents);
  const lineIndex = scaffold.lineIndex;
  if (lineIndex < 0 || lineIndex >= doc.texts.length) return null;
  if (!openLineScaffoldIsEmpty(doc.texts[lineIndex], scaffold.emptyText)) return null;
  const next = doc.texts.slice();
  next.splice(lineIndex, 1);
  let drawerIndex = scaffold.drawerLineIndex;
  if (typeof drawerIndex === "number" && drawerIndex >= 0) {
    if (lineIndex < drawerIndex) drawerIndex -= 1;
    if (
      drawerIndex < next.length &&
      openLineScaffoldIsEmpty(next[drawerIndex], scaffold.drawerEmptyText)
    ) {
      const indent = taskReqIndentLength(next[drawerIndex]);
      const nextLine = next[drawerIndex + 1];
      const hasChild =
        nextLine !== undefined &&
        !taskReqIsBlank(nextLine) &&
        taskReqIndentLength(nextLine) > indent;
      if (!hasChild) next.splice(drawerIndex, 1);
    }
  }
  return openLineJoin(contents, next);
}
