// Task-split planner, part 2: owner resolution, candidate collection,
// selection, placement, and `planSplitBullets` / `listTaskSplitCandidates`.
// Companions `256-task-split-plan.js` (mint pipeline, line helpers,
// classifier); all fragments share one bundle scope.

function taskSplitError(code, message) {
  return { ok: false, code, message: String(message || "") };
}

function taskSplitSectionOwnerForBullet(lines, bulletLine) {
  const bullet = lines[bulletLine];
  if (!bullet) {
    return null;
  }
  if (
    taskSplitIndentOf(taskSplitStripEnding(bullet)) !== "" ||
    taskSplitListBody(bullet) === null
  ) {
    return null;
  }
  let headingLine = -1;
  for (let index = bulletLine - 1; index >= 0; index -= 1) {
    if (taskSplitHeading(lines[index]) !== null) {
      headingLine = index;
      break;
    }
  }
  if (headingLine === -1) {
    return null;
  }
  const title = taskSplitHeading(lines[headingLine]);
  let end = lines.length - 1;
  for (let index = headingLine + 1; index < lines.length; index += 1) {
    if (taskSplitHeading(lines[index]) !== null) {
      end = index - 1;
      break;
    }
  }
  return { kind: "section", line: headingLine, end, title, blockId: null };
}

function taskSplitResolveOwner(lines, stripped, fenced, ownerPath, request) {
  const selection = request.selection || {};
  if (selection.kind === "section") {
    const wanted = String(selection.title || "");
    let found = -1;
    for (let index = 0; index < lines.length; index += 1) {
      const heading = taskSplitHeading(lines[index]);
      if (heading !== null && heading.toLowerCase() === wanted.toLowerCase()) {
        found = index;
        break;
      }
    }
    if (found === -1) {
      return {
        owner: null,
        error: taskSplitError(
          "split_section_missing",
          `no ## ${wanted} section in ${ownerPath}`,
        ),
      };
    }
    let end = lines.length - 1;
    for (let index = found + 1; index < lines.length; index += 1) {
      if (taskSplitHeading(lines[index]) !== null) {
        end = index - 1;
        break;
      }
    }
    return {
      owner: { kind: "section", line: found, end, title: wanted, blockId: null },
      error: null,
    };
  }
  const requested = Math.max(0, (request.ownerLine || 1) - 1);
  // A requirement line names its root owner: the real task its req chain
  // hangs off (mirrors `plan::resolve_owner`).
  const reqOwner = taskSplitReqOwnerForLine(lines.join(""), requested);
  const line = reqOwner === null ? requested : reqOwner;
  const parsed = !fenced.has(line) ? taskSplitParseTaskLine(lines[line]) : null;
  if (parsed) {
    const blockId =
      taskSplitTrailingBlockId(taskSplitStripEnding(lines[line] || "")) ||
      taskSplitBlockIdBeforeInlineFields(lines[line] || "");
    return {
      owner: {
        kind: "task",
        line,
        end: taskSplitBlockEnd(stripped, line, parsed.indentation.length),
        title: taskSplitCleanDescription(parsed.body, blockId),
        blockId,
      },
      error: null,
    };
  }
  const text = lines[line] == null ? "" : taskSplitStripEnding(lines[line]).trim();
  if (text.startsWith("- [") && text.includes("#task")) {
    return {
      owner: null,
      error: taskSplitError(
        "split_already_task",
        "Already a task — split one of its notes or drawer entries instead",
      ),
    };
  }
  const sectionOwner = taskSplitSectionOwnerForBullet(lines, line);
  if (sectionOwner) {
    return { owner: sectionOwner, error: null };
  }
  return {
    owner: null,
    error: taskSplitError(
      "split_owner_missing",
      `no task owner at ${ownerPath}:${request.ownerLine || 1}`,
    ),
  };
}

function taskSplitCollectCandidates(lines, ownerLine, ownerEnd, kind) {
  const stripped = lines.map((line) => taskSplitStripEnding(line));
  const source = lines.join("");
  const knownTask = taskBlockFindTask(source, ownerLine);
  const drawerOwner = knownTask || {
    lineIndex: ownerLine,
    blockEnd: ownerEnd + 1 < lines.length
      ? lines.slice(0, ownerEnd + 1).join("").length
      : source.length,
  };
  const result = [];
  if (kind === "task") {
    const ownerIndent = taskSplitIndentOf(stripped[ownerLine] || "");
    // Requirement lines are never plain notes; each req is collected with
    // its whole branch below.
    const reqLines = new Set(
      taskSplitReqNodesFor(source, ownerLine, ownerEnd).map(
        (node) => node.lineIndex,
      ),
    );
    const last = Math.min(ownerEnd, stripped.length - 1);
    const drawerLines = new Set();
    for (let index = ownerLine + 1; index <= last; index += 1) {
      if (
        taskSplitListBody(lines[index]) === null ||
        taskSplitIndentOf(stripped[index]).length <= ownerIndent.length
      ) {
        continue;
      }
      const header = recognize_drawer_header(source, drawerOwner, index);
      if (!header) {
        continue;
      }
      const drawerIndent = taskSplitIndentOf(stripped[index]).length;
      for (let entry = index + 1; entry <= last; entry += 1) {
        if (
          stripped[entry].trim() !== "" &&
          taskSplitIndentOf(stripped[entry]).length <= drawerIndent
        ) {
          break;
        }
        if (
          taskSplitListBody(lines[entry]) !== null &&
          taskSplitIndentOf(stripped[entry]).length > drawerIndent &&
          taskSplitParentListLine(stripped, entry, ownerLine) === index
        ) {
          drawerLines.add(entry);
        }
      }
    }
    for (let index = ownerLine + 1; index <= last; index += 1) {
      const body = taskSplitListBody(lines[index]);
      if (body === null) {
        continue;
      }
      if (
        taskSplitIndentOf(stripped[index]).length <= ownerIndent.length ||
        reqLines.has(index)
      ) {
        continue;
      }
      const direct = taskSplitParentListLine(stripped, index, ownerLine);
      const isDirect = direct === ownerLine;
      if (!isDirect && !drawerLines.has(index)) {
        continue;
      }
      const drawerHeader = isDirect ? recognize_drawer_header(source, drawerOwner, index) : null;
      const classified = taskSplitClassifyChild(stripped[index], drawerHeader);
      const drawerTitle =
        classified.kind === "drawer" ? classified.title : null;
      if (
        drawerTitle !== null ||
        classified.kind === "managed" ||
        classified.kind === "nested"
      ) {
        continue;
      }
      const parsed = taskSplitParseBullet(body);
      const title = taskSplitWithoutTrailingId(parsed.title);
      const end = taskSplitListSubtreeEnd(stripped, index, ownerEnd);
      const childLines =
        end > index ? lines.slice(index + 1, Math.min(end, lines.length - 1) + 1) : [];
      if (
        body.trimStart().startsWith("(**)") ||
        body.trimStart().startsWith("(**")
      ) {
        continue;
      }
      const parentDrawer = isDirect
        ? null
        : taskSplitParentListLine(stripped, index, ownerLine) === null
          ? null
          : (() => {
              const parentLine = taskSplitParentListLine(stripped, index, ownerLine);
              const header = recognize_drawer_header(source, drawerOwner, parentLine);
              return header ? header.title : null;
            })();
      result.push({
        line: index,
        end,
        indent: taskSplitIndentOf(stripped[index]),
        rawBody: body,
        title,
        childLines,
        drawerTitle: parentDrawer,
        parent:
          direct === null || direct === undefined ? ownerLine : direct,
      });
    }
  } else {
    const last = Math.min(ownerEnd, stripped.length - 1);
    for (let index = ownerLine + 1; index <= last; index += 1) {
      const body = taskSplitListBody(lines[index]);
      if (body === null) {
        continue;
      }
      if (taskSplitIndentOf(stripped[index]) !== "") {
        continue;
      }
      const parsed = taskSplitParseBullet(body);
      const title = taskSplitWithoutTrailingId(parsed.title);
      const end = taskSplitListSubtreeEnd(stripped, index, ownerEnd);
      const childLines =
        end > index ? lines.slice(index + 1, Math.min(end, lines.length - 1) + 1) : [];
      result.push({
        line: index,
        end,
        indent: "",
        rawBody: body,
        title,
        childLines,
        drawerTitle: null,
        parent: ownerLine,
      });
    }
  }
  if (kind === "task") {
    // Requirements at any depth, each with its whole branch, in document
    // order (mirrors `plan::collect_candidates`).
    for (const candidate of taskSplitCollectReqCandidates(
      source,
      ownerLine,
      ownerEnd,
    )) {
      result.push(candidate);
    }
    result.sort((left, right) => left.line - right.line);
  }
  return result;
}

function taskSplitChoosePlacement(ownerPath, lines, owner, inboxRoute) {
  if (owner.kind === "section") {
    return { kind: "tasks_section", path: ownerPath };
  }
  const taskLine = taskSplitStripEnding(lines[owner.line] || "");
  const parent = ownerPath.includes("/")
    ? ownerPath.slice(0, ownerPath.lastIndexOf("/"))
    : "";
  const dailyOwner =
    (ownerPath.includes("/") && parent.startsWith("20")) ||
    taskLine.includes("#gtd");
  if (dailyOwner) {
    const root = taskSplitInlineField(taskLine, "root");
    if (root) {
      return { kind: "root_note", path: taskSplitPathWithMd(root) };
    }
    return { kind: "inbox", path: taskSplitPathWithMd(inboxRoute) };
  }
  return { kind: "below_owner", path: ownerPath };
}

function taskSplitInsertAfterBlock(contents, end, generated) {
  if (!generated.length) {
    return String(contents || "");
  }
  const lines = taskSplitLines(contents);
  const position = Math.min(end + 1, lines.length);
  const insertion = generated.slice();
  if (position > 0 && !lines[position - 1].endsWith("\n")) {
    lines[position - 1] += "\n";
  }
  lines.splice(position, 0, ...insertion);
  return lines.join("");
}

function taskSplitInsertTasksSectionString(contents, generated) {
  const lines = taskSplitLines(contents);
  const headingLine = lines.findIndex(
    (line) =>
      taskSplitHeading(line) !== null &&
      taskSplitHeading(line).toLowerCase() === "tasks",
  );
  if (headingLine !== -1) {
    let end = lines.length;
    for (let index = headingLine + 1; index < lines.length; index += 1) {
      if (taskSplitHeading(lines[index]) !== null) {
        end = index;
        break;
      }
    }
    let at = end;
    while (at > headingLine + 1 && lines[at - 1].trim() === "") {
      at -= 1;
    }
    if (at > 0 && !lines[at - 1].endsWith("\n")) {
      lines[at - 1] += "\n";
    }
    lines.splice(at, 0, ...generated.map(String));
    return lines.join("");
  }
  if (
    lines.length > 0 &&
    lines[lines.length - 1].trim() !== "" &&
    !lines[lines.length - 1].endsWith("\n")
  ) {
    lines[lines.length - 1] += "\n";
  }
  if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
    lines.push("\n");
  }
  lines.push("## Tasks\n");
  for (const line of generated) {
    lines.push(String(line));
  }
  return lines.join("");
}

function taskSplitRebaseChildren(childLines, sourceIndent, destIndent) {
  return (childLines || []).map((raw) => {
    const line = String(raw || "");
    if (line.trim() === "") {
      return line;
    }
    const content = taskSplitStripEnding(line);
    const indent = taskSplitIndentOf(content);
    const rel = indent.startsWith(sourceIndent)
      ? indent.slice(sourceIndent.length)
      : "";
    const suffix = line.startsWith(indent) ? line.slice(indent.length) : line;
    return `${destIndent}${rel}${suffix}`;
  });
}

function taskSplitLocateLine(contents, id) {
  const lines = taskSplitLines(contents);
  for (let index = 0; index < lines.length; index += 1) {
    if (taskSplitTrailingBlockId(taskSplitStripEnding(lines[index])) === id) {
      return index;
    }
  }
  return -1;
}

function planSplitBullets(files, request, options) {
  const sourceFiles = files && typeof files === "object" ? files : {};
  const ownerPath = String((request || {}).ownerPath || "");
  const source = Object.prototype.hasOwnProperty.call(sourceFiles, ownerPath)
    ? String(sourceFiles[ownerPath])
    : null;
  if (source === null) {
    return taskSplitError(
      "split_owner_missing",
      `${ownerPath} does not exist in the vault`,
    );
  }
  const settings = (request || {}).settings || {};
  const linkedFromLines = settings.linked_from_lines !== false;
  const linkedFromMentions = settings.linked_from_mentions !== false;
  const inboxRoute = settings.inbox_route || "inbox.md";
  const today = String((request || {}).today || "");
  const selection = (request || {}).selection || {};

  const lines = taskSplitLines(source);
  const stripped = lines.map((line) => taskSplitStripEnding(line));
  const frontmatterEnd = taskSplitFrontmatterEnd(stripped);
  const fenced = taskSplitFencedLines(
    stripped,
    frontmatterEnd === -1 ? 0 : frontmatterEnd + 1,
  );
  const resolved = taskSplitResolveOwner(
    lines,
    stripped,
    fenced,
    ownerPath,
    request || {},
  );
  if (resolved.error) {
    return resolved.error;
  }
  const owner = resolved.owner;
  const candidates = taskSplitCollectCandidates(
    lines,
    owner.line,
    owner.end,
    owner.kind,
  );
  const picked = taskSplitSelectCandidates(
    candidates,
    lines,
    selection,
    owner,
    options,
  );
  if (picked.error) {
    return picked.error;
  }
  let selected = picked.selected.slice().sort((left, right) => left - right);
  selected = selected.filter(
    (value, index) => index === 0 || value !== selected[index - 1],
  );
  if (selected.length === 0) {
    return taskSplitError("split_no_selection", "no splittable bullets selected");
  }

  const placement = taskSplitChoosePlacement(ownerPath, lines, owner, inboxRoute);
  let destinationPath = placement.path;
  if (placement.kind !== "below_owner" && placement.kind !== "tasks_section") {
    if (!Object.prototype.hasOwnProperty.call(sourceFiles, destinationPath)) {
      const withExt = taskSplitPathWithMd(destinationPath);
      destinationPath = withExt;
    }
  }
  const destinationBefore = Object.prototype.hasOwnProperty.call(
    sourceFiles,
    destinationPath,
  )
    ? String(sourceFiles[destinationPath])
    : "";
  const destinationIsSource = destinationPath === ownerPath;
  const usedSource = new Set(taskSplitBlockIdsInMarkdown(source));
  const usedDest = new Set(taskSplitBlockIdsInMarkdown(destinationBefore));
  const used = new Set(destinationIsSource ? usedSource : usedDest);
  if (owner.blockId) {
    used.add(owner.blockId);
  }
  let ownerMintedId = null;
  if (
    owner.kind === "task" &&
    !owner.blockId &&
    linkedFromLines &&
    linkedFromMentions
  ) {
    ownerMintedId = taskSplitMintBlockId(owner.title, used);
    used.add(ownerMintedId);
  }
  const mentionId = owner.blockId || ownerMintedId;

  const sourceLines = taskSplitLines(source);
  const transformedSource = sourceLines.slice();
  if (ownerMintedId) {
    transformedSource[owner.line] = taskSplitSetTrailingBlockId(
      transformedSource[owner.line],
      ownerMintedId,
    );
  }
  const generated = [];
  const plannedTasks = [];
  // Per planned task: the carried req's head line and its in-block moves.
  const plannedMoves = [];
  const stubs = [];
  for (const candidateIndex of selected) {
    const candidate = candidates[candidateIndex];
    const title = candidate.title.trim();
    const anchor = taskSplitTrailingBlockId(
      taskSplitStripEnding(candidate.rawBody).trimEnd(),
    );
    let id;
    if (anchor !== null) {
      used.add(anchor);
      id = anchor;
    } else {
      const flat = taskSplitFlattenLinks(title);
      id = taskSplitMintBlockId(flat, used);
      used.add(id);
    }
    const alias = taskSplitAliasFor(title);
    const link =
      destinationPath === ownerPath
        ? `[[#^${id}|${alias}]]`
        : `[[${taskSplitNoteTarget(destinationPath)}#^${id}|${alias}]]`;
    const originalLine = String(transformedSource[candidate.line] || "");
    const [, ending] = taskSplitSplitEnding(originalLine);
    // A carried requirement keeps its place as a `[>]` stub; any other
    // bullet keeps today's plain stub.
    const marker = candidate.req ? "[>] " : "";
    const stub = `${candidate.indent}- ${marker}${link}${ending}`;
    transformedSource[candidate.line] = stub;
    for (let row = candidate.line + 1; row <= candidate.end; row += 1) {
      transformedSource[row] = "";
    }
    stubs.push({
      path: ownerPath,
      line: candidate.line + 1,
      text: stub.trim(),
    });
    const baseIndent = taskSplitOwnerIndent(sourceLines[owner.line] || "");
    const taskLine = `${baseIndent}- [ ] #task ${title} [created:: ${today}] ^${id}\n`;
    const children = taskSplitRebaseChildren(
      candidate.childLines,
      candidate.indent,
      baseIndent,
    );
    let backLink = null;
    if (
      linkedFromLines &&
      linkedFromMentions &&
      mentionId &&
      owner.kind === "task"
    ) {
      const parentTarget =
        destinationPath === ownerPath
          ? `#^${mentionId}`
          : `${taskSplitNoteTarget(ownerPath)}#^${mentionId}`;
      backLink = `[[${parentTarget}]]`;
    }
    const childCount = candidate.childLines.length;
    const planned = {
      path: destinationPath,
      line: 0,
      block_id: id,
      title,
      anchor_reused: anchor !== null,
      child_lines: childCount,
    };
    if (candidate.req) {
      // The branch becomes a canonical task block: the back-link in the
      // managed zone and the req's notes filed by the NOTES rule.
      planned.req_depth = candidate.req.depth;
      planned.moves = [];
      const unit = taskSplitNestingUnit(sourceLines, candidate);
      const carried = taskSplitCarriedBlock(
        taskLine,
        children,
        backLink,
        `${baseIndent}${unit}`,
      );
      plannedMoves.push({ head: candidate.line, moves: carried.moves });
      plannedTasks.push(planned);
      for (const carriedLine of carried.lines) {
        generated.push(carriedLine);
      }
      continue;
    }
    if (backLink) {
      // A plain split's back-link lands in the managed-link zone, as the
      // req-carry path does, so the fresh block is already tidy-clean.
      const unit = taskSplitNestingUnit(sourceLines, candidate);
      const scratch = taskSplitInsertManagedBackLink(
        `${taskLine}${children.join("")}`,
        backLink,
        `${baseIndent}${unit}`,
      );
      plannedMoves.push(null);
      plannedTasks.push(planned);
      for (const placed of taskSplitLines(scratch)) {
        generated.push(placed);
      }
    } else {
      plannedMoves.push(null);
      plannedTasks.push(planned);
      generated.push(taskLine);
      for (const child of children) {
        generated.push(child);
      }
    }
  }

  let sourceAfter = transformedSource.join("");
  const nextFiles = {};
  for (const key of Object.keys(sourceFiles)) {
    nextFiles[key] = String(sourceFiles[key]);
  }
  if (destinationIsSource) {
    if (owner.kind === "task") {
      // The moved branches' rows were cleared out of the owner's block, so
      // its last line moved up by that many rows.
      const removed = selected.reduce(
        (sum, candidateIndex) =>
          sum + (candidates[candidateIndex].end - candidates[candidateIndex].line),
        0,
      );
      sourceAfter = taskSplitInsertAfterBlock(
        sourceAfter,
        owner.end - removed,
        generated,
      );
    } else {
      sourceAfter = taskSplitInsertTasksSectionString(sourceAfter, generated);
    }
    nextFiles[ownerPath] = sourceAfter;
  } else {
    nextFiles[ownerPath] = sourceAfter;
    nextFiles[destinationPath] = taskSplitInsertTasksSectionString(
      destinationBefore,
      generated,
    );
  }
  if (ownerMintedId && nextFiles[ownerPath] !== undefined) {
    const minted = taskSplitLines(nextFiles[ownerPath]);
    if (owner.line < minted.length) {
      minted[owner.line] = taskSplitSetTrailingBlockId(
        minted[owner.line],
        ownerMintedId,
      );
      nextFiles[ownerPath] = minted.join("");
    }
  }

  const postimages = {};
  for (const key of Object.keys(nextFiles)) {
    if (
      !Object.prototype.hasOwnProperty.call(sourceFiles, key) ||
      sourceFiles[key] !== nextFiles[key]
    ) {
      postimages[key] = nextFiles[key];
    }
  }
  for (let taskIndex = 0; taskIndex < plannedTasks.length; taskIndex += 1) {
    const task = plannedTasks[taskIndex];
    const located = taskSplitLocateLine(nextFiles[destinationPath], task.block_id);
    task.line = (located === -1 ? 0 : located) + 1;
    // Link repair rewrites text inside lines and never adds or removes one,
    // so block offsets still land on the final bytes.
    const carried = plannedMoves[taskIndex];
    if (carried) {
      task.moves = carried.moves
        .filter((pair) => pair[0] > 0)
        .map((pair) => ({
          from: carried.head + pair[0] + 1,
          to: task.line + pair[1],
        }));
    }
  }
  const first = plannedTasks[0];
  const notice = taskSplitNoticeFor(plannedTasks);
  let cursorLine = taskSplitLocateLine(nextFiles[destinationPath], first.block_id);
  cursorLine = (cursorLine === -1 ? 0 : cursorLine) + 1;
  let clamped = null;
  if (selection.kind === "count" && (selection.count || 0) > plannedTasks.length) {
    clamped = { requested: selection.count, split: plannedTasks.length };
  }
  const result = {
    ok: true,
    files: postimages,
    tasks: plannedTasks,
    stubs,
    placement: { kind: placement.kind, path: placement.path },
    notice,
    cursor: { path: destinationPath, line: cursorLine },
  };
  if (clamped) {
    result.clamped = clamped;
  }
  if (ownerMintedId) {
    result.owner_minted_id = ownerMintedId;
  }
  result.owner_path = ownerPath;
  result.owner_line = owner.line + 1;
  return result;
}

function listTaskSplitCandidates(files, request) {
  const sourceFiles = files && typeof files === "object" ? files : {};
  const ownerPath = String((request || {}).ownerPath || "");
  const source = Object.prototype.hasOwnProperty.call(sourceFiles, ownerPath)
    ? String(sourceFiles[ownerPath])
    : null;
  if (source === null) {
    return taskSplitError(
      "split_owner_missing",
      `${ownerPath} does not exist in the vault`,
    );
  }
  const lines = taskSplitLines(source);
  const stripped = lines.map((line) => taskSplitStripEnding(line));
  const frontmatterEnd = taskSplitFrontmatterEnd(stripped);
  const fenced = taskSplitFencedLines(
    stripped,
    frontmatterEnd === -1 ? 0 : frontmatterEnd + 1,
  );
  const resolved = taskSplitResolveOwner(
    lines,
    stripped,
    fenced,
    ownerPath,
    request || {},
  );
  if (resolved.error) {
    return resolved.error;
  }
  const owner = resolved.owner;
  const candidates = taskSplitCollectCandidates(
    lines,
    owner.line,
    owner.end,
    owner.kind,
  );
  return {
    ok: true,
    owner_path: ownerPath,
    owner_line: owner.line + 1,
    candidates: candidates.map((item, index) => ({
      ordinal: index + 1,
      line: item.line + 1,
      title: item.title,
      drawer: item.drawerTitle,
      child_lines: item.childLines.length,
      ...(item.req
        ? {
            req: {
              depth: item.req.depth,
              mark: item.req.mark,
              state: item.req.state,
              carriable: item.req.carriable,
            },
          }
        : {}),
    })),
  };
}
