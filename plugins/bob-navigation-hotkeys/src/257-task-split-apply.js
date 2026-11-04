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
  const line = Math.max(0, (request.ownerLine || 1) - 1);
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
  const result = [];
  if (kind === "task") {
    const ownerIndent = taskSplitIndentOf(stripped[ownerLine] || "");
    const last = Math.min(ownerEnd, stripped.length - 1);
    const drawerLines = new Set();
    for (let index = ownerLine + 1; index <= last; index += 1) {
      if (
        taskSplitListBody(lines[index]) === null ||
        taskSplitIndentOf(stripped[index]).length <= ownerIndent.length
      ) {
        continue;
      }
      if (taskSplitClassifyChild(stripped[index]).kind !== "drawer") {
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
      if (taskSplitIndentOf(stripped[index]).length <= ownerIndent.length) {
        continue;
      }
      const direct = taskSplitParentListLine(stripped, index, ownerLine);
      const isDirect = direct === ownerLine;
      if (!isDirect && !drawerLines.has(index)) {
        continue;
      }
      const classified = taskSplitClassifyChild(stripped[index]);
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
              const parentBody = taskSplitListBody(
                lines[taskSplitParentListLine(stripped, index, ownerLine)],
              );
              return parentBody === null ? null : parentBody.trim();
            })();
      result.push({
        line: index,
        end,
        indent: taskSplitIndentOf(stripped[index]),
        rawBody: body,
        title,
        childLines,
        drawerTitle: parentDrawer,
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
      });
    }
  }
  return result;
}

function taskSplitValidateCandidates(candidates, selected) {
  for (const index of selected) {
    const item = candidates[index];
    const parsed = taskSplitParseBullet(item.rawBody);
    if (item.rawBody.includes("#task")) {
      return taskSplitError(
        "split_already_task",
        "Already a task — split one of its notes or drawer entries instead",
      );
    }
    if (parsed.checked) {
      return taskSplitError(
        "split_not_splittable",
        "Checked box — split an unchecked note instead",
      );
    }
    if (parsed.title.trim() === "") {
      return taskSplitError(
        "split_not_splittable",
        "Bullet has no text to split",
      );
    }
    if (taskSplitIsStub(parsed.title)) {
      return taskSplitError(
        "split_stub",
        "Stub only links a task — split a note with its own text instead",
      );
    }
  }
  return null;
}

function taskSplitSelectCandidates(candidates, lines, selection, owner, options) {
  const lineToCandidate = (line) => {
    for (let index = 0; index < candidates.length; index += 1) {
      if (line >= candidates[index].line && line <= candidates[index].end) {
        return index;
      }
    }
    return -1;
  };
  const kind = selection.kind || "cursor";
  if (kind === "cursor") {
    const index = Math.max(0, (selection.line || 1) - 1);
    if (owner.kind === "task" && index === owner.line) {
      return {
        selected: null,
        error: taskSplitError(
          "split_already_task",
          "Already a task — split one of its notes or drawer entries instead",
        ),
      };
    }
    const found = lineToCandidate(index);
    if (found !== -1) {
      const error = taskSplitValidateCandidates(candidates, [found]);
      return { selected: error ? null : [found], error };
    }
    const raw = lines[index] == null ? "" : String(lines[index]);
    if (
      raw.includes("DEPENDS ON") ||
      raw.includes("BLOCKS:") ||
      raw.includes("LINKS:") ||
      raw.includes("LINKED FROM") ||
      raw.includes("SCHEDULE LOG") ||
      raw.includes("WORK LOG") ||
      raw.includes("ROTTEN LOG") ||
      raw.includes("CANCEL LOG") ||
      raw.trimStart().startsWith("- (**")
    ) {
      return {
        selected: null,
        error: taskSplitError(
          "split_managed_line",
          "Managed line — Bob writes it; split a note or drawer entry instead",
        ),
      };
    }
    if (raw.trimStart().startsWith("- [x]") || raw.trimStart().startsWith("- [X]")) {
      return {
        selected: null,
        error: taskSplitError(
          "split_not_splittable",
          "Checked box — split an unchecked note instead",
        ),
      };
    }
    if (lineToCandidate(index) === -1 && raw.includes("[[") && !raw.includes(" ")) {
      return {
        selected: null,
        error: taskSplitError(
          "split_stub",
          "Stub only links a task — split a note with its own text instead",
        ),
      };
    }
    return {
      selected: null,
      error: taskSplitError(
        "split_not_splittable",
        "That line is not a splittable note",
      ),
    };
  }
  if (kind === "count") {
    const start = lineToCandidate(Math.max(0, (selection.line || 1) - 1));
    if (start === -1) {
      return {
        selected: null,
        error: taskSplitError(
          "split_not_splittable",
          "That line is not a splittable note",
        ),
      };
    }
    const anchor = candidates[start];
    const siblings = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const item = candidates[index];
      if (
        item.indent === anchor.indent &&
        item.drawerTitle === anchor.drawerTitle &&
        item.line >= anchor.line
      ) {
        siblings.push(index);
      }
    }
    const picked = siblings.slice(0, Math.max(0, selection.count || 0));
    const error = taskSplitValidateCandidates(candidates, picked);
    return { selected: error ? null : picked, error };
  }
  if (kind === "lines") {
    const from = selection.from || 1;
    const to = selection.to || 1;
    const picked = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const item = candidates[index];
      if (item.line + 1 <= to && item.end + 1 >= from) {
        picked.push(index);
      }
    }
    picked.sort((left, right) => candidates[left].line - candidates[right].line);
    const error = taskSplitValidateCandidates(candidates, picked);
    return { selected: error ? null : picked, error };
  }
  if (kind === "nth") {
    const picked = [];
    for (const ordinal of selection.picks || []) {
      if (!ordinal || ordinal > candidates.length) {
        return {
          selected: null,
          error: taskSplitError(
            "split_nth_missing",
            `no splittable bullet ${ordinal}`,
          ),
        };
      }
      picked.push(ordinal - 1);
    }
    const error = taskSplitValidateCandidates(candidates, picked);
    return { selected: error ? null : picked, error };
  }
  if (kind === "match") {
    const picked = [];
    for (const text of selection.texts || []) {
      const matches = [];
      for (let index = 0; index < candidates.length; index += 1) {
        if (candidates[index].title.includes(text)) {
          matches.push(index);
        }
      }
      if (matches.length === 1) {
        picked.push(matches[0]);
      } else if (matches.length === 0) {
        return {
          selected: null,
          error: taskSplitError(
            "split_match_missing",
            `no splittable bullet contains ${JSON.stringify(text)}`,
          ),
        };
      } else {
        return {
          selected: null,
          error: taskSplitError(
            "split_match_ambiguous",
            `more than one splittable bullet contains ${JSON.stringify(text)}`,
          ),
        };
      }
    }
    const error = taskSplitValidateCandidates(candidates, picked);
    return { selected: error ? null : picked, error };
  }
  if (kind === "section") {
    const picked = candidates.map((item, index) => index);
    const error = taskSplitValidateCandidates(candidates, picked);
    return { selected: error ? null : picked, error };
  }
  if (kind === "bulletref") {
    const value = String(selection.ref || "");
    const separator = value.indexOf(":");
    const line = Number(separator === -1 ? "" : value.slice(0, separator));
    const digest = separator === -1 ? "" : value.slice(separator + 1);
    const lineDigest =
      options && typeof options.lineDigest === "function"
        ? options.lineDigest
        : null;
    let found = -1;
    if (Number.isInteger(line) && line >= 1 && lineDigest) {
      for (let index = 0; index < candidates.length; index += 1) {
        const item = candidates[index];
        if (
          item.line + 1 === line &&
          lineDigest(taskSplitStripEnding(lines[item.line] || "")) === digest
        ) {
          found = index;
          break;
        }
      }
    }
    if (found === -1) {
      return {
        selected: null,
        error: taskSplitError(
          "split_stale_ref",
          "stale bullet reference; list candidates and try again",
        ),
      };
    }
    const error = taskSplitValidateCandidates(candidates, [found]);
    return { selected: error ? null : [found], error };
  }
  return {
    selected: null,
    error: taskSplitError(
      "split_not_splittable",
      "That line is not a splittable note",
    ),
  };
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
    const stub = `${candidate.indent}- ${link}${ending}`;
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
    const childIndent = `${baseIndent}  `;
    const children = taskSplitRebaseChildren(
      candidate.childLines,
      candidate.indent,
      baseIndent,
    );
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
      const mention = formatLinkedFromLine(childIndent, [
        { link: `[[${parentTarget}]]`, label: TASK_MENTION_LABEL },
      ]);
      children.push(`${mention}\n`);
    }
    const childCount = candidate.childLines.length;
    plannedTasks.push({
      path: destinationPath,
      line: 0,
      block_id: id,
      title,
      anchor_reused: anchor !== null,
      child_lines: childCount,
    });
    generated.push(taskLine);
    for (const child of children) {
      generated.push(child);
    }
  }

  let sourceAfter = transformedSource.join("");
  const nextFiles = {};
  for (const key of Object.keys(sourceFiles)) {
    nextFiles[key] = String(sourceFiles[key]);
  }
  if (destinationIsSource) {
    if (owner.kind === "task") {
      sourceAfter = taskSplitInsertAfterBlock(sourceAfter, owner.end, generated);
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
  for (const task of plannedTasks) {
    const located = taskSplitLocateLine(nextFiles[destinationPath], task.block_id);
    task.line = (located === -1 ? 0 : located) + 1;
  }
  const first = plannedTasks[0];
  const displayTitles = plannedTasks
    .map((task) => `\u25EF ${taskSplitShortNoticeTitle(task.title)}`)
    .join(" \u00B7 ");
  const notice =
    `\u2702 Split ${plannedTasks.length} ` +
    `${plannedTasks.length === 1 ? "note" : "notes"} into tasks \u00B7 ${displayTitles}`;
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
    })),
  };
}
