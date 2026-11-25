// Pure task-settle grouping emission twin (bob-cli-q4.8.1.1 pure-twin).
//
// Ports `task_status_groups::emit` grouping plans, badge rendering, body
// emission, and section-end rules plus the `transform` container rewrite.

function tsGroupingPlan(parsed) {
  const recovered = [];
  const groups = new Map([
    ["active", []],
    ["blocked", []],
    ["closed", []],
  ]);
  const movedBlocks = [];
  const documentTasks = [];
  for (const piece of parsed.intake) {
    if (piece.kind === "task") documentTasks.push(["intake", piece]);
  }
  for (const kind of ["active", "blocked", "closed"]) {
    const group = parsed.groups.get(kind);
    if (!group) continue;
    for (const piece of group.pieces) {
      if (piece.kind === "task") documentTasks.push([kind, piece]);
    }
  }
  for (const [source, task] of documentTasks) {
    const sourceDestination =
      source === "intake" ? "intake" : source === "active" ? "active" : source === "blocked" ? "blocked" : "closed";
    const dest = task.movable ? tsBucketDestination(task.bucket) : sourceDestination;
    if (dest !== sourceDestination) {
      movedBlocks.push({ originalLine: task.startLine, destination: tsDestinationLabel(dest) });
    }
    const group = tsDestinationGroup(dest);
    if (group) {
      groups.get(group).push(task);
    } else if (sourceDestination !== "intake" && task.movable) {
      recovered.push(task);
    }
  }
  const intakeStaying = [];
  for (const piece of parsed.intake) {
    if (piece.kind === "task" && piece.movable) {
      if (tsBucketDestination(piece.bucket) === "intake") intakeStaying.push(piece);
    } else if (piece.kind === "task" || piece.kind === "other") {
      intakeStaying.push(piece);
    }
  }
  const counts = [
    groups.get("active").length,
    groups.get("blocked").length,
    groups.get("closed").length,
  ];
  const openCount =
    intakeStaying.filter((piece) => piece.kind === "task").length + recovered.length;
  return { intakeStaying, recovered, groups, openCount, counts, movedBlocks };
}

function tsEncodeAnchorSegment(segment) {
  let encoded = "";
  for (const character of String(segment)) {
    const code = character.codePointAt(0);
    const ascii = code < 128;
    const special =
      ascii &&
      (code < 32 ||
        character === " " ||
        character === "(" ||
        character === ")" ||
        character === "<" ||
        character === ">" ||
        character === '"' ||
        character === "%" ||
        character === "\\");
    if (special) {
      encoded += `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      encoded += character;
    }
  }
  return encoded;
}

function tsRenderAnchor(segments) {
  let anchor = "";
  for (const segment of segments) {
    anchor += `#${tsEncodeAnchorSegment(segment)}`;
  }
  return anchor;
}

function tsRenderBadges(node, plan, newline) {
  const counts = [
    [plan.openCount, null],
    [plan.counts[0], "active"],
    [plan.counts[1], "blocked"],
    [plan.counts[2], "closed"],
  ];
  const linked = !node.ancestry.some((segment) => segment.includes("#"));
  const row = TS_BADGE_CHIPS.map(([emoji, label], index) => {
    const [count, group] = counts[index];
    const text = `\`${emoji} ${count} ${label}\``;
    if (!linked || (group != null && count === 0)) return text;
    let anchor;
    if (group) {
      anchor = tsRenderAnchor([...node.ancestry, tsGroupKindTitle(group)]);
    } else {
      anchor = tsRenderAnchor(node.ancestry);
    }
    return `[${text}](${anchor})`;
  }).join(" \u00B7 ");
  return `${row}${newline}${newline}`;
}

function tsTrimLeadingBlankEdges(raw, newline) {
  let out = raw;
  while (out.startsWith(newline)) out = out.slice(newline.length);
  return out;
}

function tsPushTask(buf, raw, newline) {
  buf.value += raw;
  if (!raw.endsWith("\n")) buf.value += newline;
}

function tsPushBlock(buf, part, newline) {
  if (!part) return;
  if (buf.value !== "") tsEnsureTrailingBlank(buf, newline);
  buf.value += part;
}

function tsEnsureTrailingBlank(buf, newline) {
  const double = `${newline}${newline}`;
  if (buf.value.endsWith(double)) return;
  if (buf.value.endsWith(newline)) buf.value += newline;
  else if (buf.value !== "") buf.value += `${newline}${newline}`;
}

function tsEnsureSingleTrailingNewline(buf, newline) {
  if (buf.value === "") return;
  if (!buf.value.endsWith("\n")) buf.value += newline;
}

function tsCollapseInternalBlankRuns(buf, newline) {
  const triple = `${newline}${newline}${newline}`;
  const double = `${newline}${newline}`;
  while (buf.value.includes(triple)) buf.value = buf.value.split(triple).join(double);
}

function tsEmitIntake(plan, newline) {
  const buf = { value: "" };
  let lastWasTask = false;
  let insertedRecovered = false;
  for (const piece of plan.intakeStaying) {
    if (piece.kind === "other") {
      if (lastWasTask && !insertedRecovered && plan.recovered.length > 0) {
        for (const task of plan.recovered) tsPushTask(buf, task.raw, newline);
        insertedRecovered = true;
      }
      buf.value += piece.raw;
      lastWasTask = false;
    } else if (piece.kind === "task") {
      tsPushTask(buf, piece.raw, newline);
      lastWasTask = true;
    }
  }
  if (!insertedRecovered) {
    if (!lastWasTask && plan.recovered.length > 0 && buf.value !== "") {
      tsEnsureSingleTrailingNewline(buf, newline);
    }
    for (const task of plan.recovered) tsPushTask(buf, task.raw, newline);
  }
  tsCollapseInternalBlankRuns(buf, newline);
  return buf.value;
}

function tsEmitGroup(level, kind, plan, newline) {
  const hashes = "#".repeat(level);
  let buf = `${hashes} ${tsGroupKindTitle(kind)}${newline}${newline}`;
  const tasks = plan.groups.get(kind) || [];
  const holder = { value: buf };
  for (const task of tasks) tsPushTask(holder, task.raw, newline);
  return holder.value;
}

function tsSplitPreservedLines(value) {
  const out = [];
  let start = 0;
  for (let offset = 0; offset < value.length; offset += 1) {
    if (value[offset] !== "\n") continue;
    const end = offset + 1;
    const raw = value.slice(start, end);
    out.push(tsSplitLineEnding(raw));
    start = end;
  }
  if (start < value.length) out.push(tsSplitLineEnding(value.slice(start)));
  return out;
}

function tsTrailingWhitespaceRun(section) {
  const lines = tsSplitPreservedLines(section);
  const raws = [];
  let cursor = 0;
  for (const [content, ending] of lines) {
    const length = content.length + ending.length;
    raws.push(section.slice(cursor, cursor + length));
    cursor += length;
  }
  let start = section.length;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index][0].trim() !== "") break;
    start -= raws[index].length;
  }
  return section.slice(start);
}

function tsStripTrailingWhitespaceLines(emitted) {
  const lines = tsSplitPreservedLines(emitted);
  if (lines.length === 0) return emitted;
  const raws = [];
  let cursor = 0;
  for (const [content, ending] of lines) {
    const length = content.length + ending.length;
    raws.push(emitted.slice(cursor, cursor + length));
    cursor += length;
  }
  let end = emitted.length;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index][0].trim() !== "") break;
    end -= raws[index].length;
  }
  return emitted.slice(0, end);
}

function tsApplySectionEndRule(emitted, original) {
  const run = tsTrailingWhitespaceRun(original);
  const newlineIndex = run.indexOf("\n");
  const trailing = newlineIndex === -1 ? run : run.slice(0, newlineIndex + 1);
  return tsStripTrailingWhitespaceLines(emitted) + trailing;
}

function tsSectionNewline(node, lines) {
  const headingRange = tsLineRangeForBytes(lines, node.headingStart, node.headingEnd);
  for (let index = headingRange.end - 1; index >= headingRange.start; index -= 1) {
    const ending = lines[index].ending;
    if (ending === "\r\n" || ending === "\n") return ending;
  }
  const bodyRange = tsLineRangeForBytes(lines, node.bodyStart, node.bodyEnd);
  for (let index = bodyRange.start; index < bodyRange.end; index += 1) {
    const ending = lines[index].ending;
    if (ending === "\r\n" || ending === "\n") return ending;
  }
  return "\n";
}

function tsApplyFinalNewline(output, original) {
  const originalNl = original.endsWith("\n");
  const outputNl = output.value.endsWith("\n");
  if (originalNl && !outputNl) {
    output.value += original.endsWith("\r\n") ? "\r\n" : "\n";
  } else if (!originalNl && outputNl) {
    if (output.value.endsWith("\r\n")) output.value = output.value.slice(0, -2);
    else output.value = output.value.slice(0, -1);
  }
}

function tsWarning(node, code) {
  return {
    originalHeadingLine: node.headingLine,
    headingAncestry: [...node.ancestry],
    code,
    message: tsSkipMessage(code, node.title, node.headingLine),
  };
}

function tsWarningAt(node, code, line) {
  return {
    originalHeadingLine: node.headingLine,
    headingAncestry: [...node.ancestry],
    code,
    message: tsSkipMessage(code, node.title, line),
  };
}

function tsApplyChildRewrites(section, node, childRewrites) {
  const base = node.sectionStart;
  const edits = [];
  for (const child of node.children) {
    const rewrite = childRewrites.get(child.headingStart);
    if (rewrite) edits.push([child.sectionStart - base, child.sectionEnd - base, rewrite.section]);
  }
  edits.sort((a, b) => a[0] - b[0]);
  let out = section;
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const [start, end, replacement] = edits[index];
    out = out.slice(0, start) + replacement + out.slice(end);
  }
  return out;
}

function tsEmitGroupedBody(node, contents, classified, plan, childRewrites, newline, emitDecorations, headingHasLineEnding) {
  let body = "";
  const intake = tsEmitIntake(plan, newline);
  if (emitDecorations) body += tsRenderBadges(node, plan, newline);
  const holder = { value: body };
  if (intake.trim() !== "") {
    const part = emitDecorations ? tsTrimLeadingBlankEdges(intake, newline) : intake;
    const current = { value: holder.value };
    tsPushBlock(current, part, newline);
    holder.value = current.value;
  }
  body = holder.value;
  const authored = classified.items.filter((item) => item.kind === "authored" || item.kind === "nested");
  for (const child of authored) {
    const rewrite = childRewrites.get(child.node.headingStart);
    const part = rewrite ? rewrite.section : contents.slice(child.node.sectionStart, child.node.sectionEnd);
    const current = { value: body };
    tsPushBlock(current, part, newline);
    body = current.value;
  }
  if (emitDecorations) {
    for (const kind of ["active", "blocked", "closed"]) {
      const tasks = plan.groups.get(kind) || [];
      if (tasks.length === 0) continue;
      const part = tsEmitGroup(node.level + 1, kind, plan, newline);
      const current = { value: body };
      tsPushBlock(current, part, newline);
      body = current.value;
    }
  }
  if (body === "") return "";
  if (emitDecorations && headingHasLineEnding) return body;
  if (!body.startsWith("\n") && !body.startsWith("\r\n")) body = newline + body;
  return body;
}

function tsRewriteContainer(node, ctx) {
  const original = ctx.contents.slice(node.sectionStart, node.sectionEnd);
  const headingRaw = ctx.contents.slice(node.headingStart, node.headingEnd);
  if (node.level >= 6) {
    return { section: original, groupedSections: [], warnings: [tsWarning(node, "h6_container")] };
  }
  const classified = tsClassifyChildren(node, ctx);
  let warnings = [...classified.warnings];
  let groupedSections = [];
  const childRewrites = new Map();
  for (const child of node.children) {
    const isGroupingChild = classified.items.some(
      (item) =>
        (item.kind === "authored" || item.kind === "nested") &&
        item.node.headingStart === child.headingStart,
    );
    if (!isGroupingChild) continue;
    const rewritten = tsRewriteContainer(child, ctx);
    groupedSections = groupedSections.concat(rewritten.groupedSections);
    warnings = warnings.concat(rewritten.warnings);
    childRewrites.set(child.headingStart, rewritten);
  }
  if (classified.fail) {
    const section = tsApplyChildRewrites(original, node, childRewrites);
    warnings = [tsWarning(node, classified.fail), ...warnings];
    return { section, groupedSections, warnings };
  }
  const parsed = tsParseContainerRegions(node, ctx, classified);
  if (!parsed.ok) {
    const section = tsApplyChildRewrites(original, node, childRewrites);
    warnings = [tsWarning(node, parsed.code), ...warnings];
    return { section, groupedSections, warnings };
  }
  warnings = warnings.concat(parsed.itemWarnings);
  const newline = tsSectionNewline(node, ctx.lines);
  const shouldDecorate = [...parsed.intake, ...[...parsed.groups.values()].flatMap((group) => group.pieces)]
    .filter((piece) => piece.kind === "task")
    .some((task) => tsBucketIsGroupable(task.bucket) && task.movable);
  const hasBadges = parsed.hasBadges;
  const hasGroups = classified.items.some((item) => item.kind === "group");
  if (!shouldDecorate && !hasBadges && !hasGroups) {
    const section = tsApplyChildRewrites(original, node, childRewrites);
    return { section, groupedSections, warnings };
  }
  const plan = tsGroupingPlan(parsed);
  const body = tsEmitGroupedBody(
    node,
    ctx.contents,
    classified,
    plan,
    childRewrites,
    newline,
    shouldDecorate,
    headingRaw.endsWith("\n"),
  );
  const rawSection = `${headingRaw}${body}`;
  const section = tsApplySectionEndRule(rawSection, original);
  if (section !== original) {
    groupedSections = [
      {
        originalHeadingLine: node.headingLine,
        headingAncestry: [...node.ancestry],
        open: plan.openCount,
        nextAndInProgress: plan.counts[0],
        blocked: plan.counts[1],
        doneAndCanceled: plan.counts[2],
        movedBlockCount: plan.movedBlocks.length,
        movedBlocks: plan.movedBlocks.map((block) => ({ ...block })),
      },
      ...groupedSections,
    ];
  }
  return { section, groupedSections, warnings };
}

function tsVisitTasksRoots(nodes, ctx, groupedSections, warnings, replacements) {
  for (const node of nodes) {
    if (tsIsTasksTitle(node.title)) {
      const rewritten = tsRewriteContainer(node, ctx);
      for (const section of rewritten.groupedSections) groupedSections.push(section);
      for (const warning of rewritten.warnings) warnings.push(warning);
      if (ctx.contents.slice(node.sectionStart, node.sectionEnd) !== rewritten.section) {
        replacements.push([node.sectionStart, node.sectionEnd, rewritten.section]);
      }
    } else {
      tsVisitTasksRoots(node.children, ctx, groupedSections, warnings, replacements);
    }
  }
}

function taskSettleTransform(contents, classification) {
  const text = String(contents);
  const lines = tsSourceLines(text);
  if (lines.length === 0) {
    return { contents: text, changed: false, groupedSections: [], warnings: [] };
  }
  const mask = tsHeadingMask(lines);
  const flats = tsDiscoverHeadings(lines, mask);
  const tree = tsBuildTree(text.length, flats);
  const groupedSections = [];
  const warnings = [];
  const replacements = [];
  const ctx = { contents: text, lines, mask, classification };
  tsVisitTasksRoots(tree, ctx, groupedSections, warnings, replacements);
  replacements.sort((a, b) => a[0] - b[0]);
  let output = text;
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const [start, end, replacement] = replacements[index];
    output = output.slice(0, start) + replacement + output.slice(end);
  }
  const holder = { value: output };
  tsApplyFinalNewline(holder, text);
  output = holder.value;
  return { contents: output, changed: output !== text, groupedSections, warnings };
}

function taskSettleReservedGroupHeadingLines(contents) {
  const text = String(contents);
  const lines = tsSourceLines(text);
  if (lines.length === 0) return new Set();
  const mask = tsHeadingMask(lines);
  const flats = tsDiscoverHeadings(lines, mask);
  const tree = tsBuildTree(text.length, flats);
  const reserved = new Set();
  const visit = (nodes, underTasks) => {
    for (const node of nodes) {
      if (underTasks && tsGroupKindFromTitle(node.title)) reserved.add(node.headingLine - 1);
      visit(node.children, underTasks || tsIsTasksTitle(node.title));
    }
  };
  visit(tree, false);
  return reserved;
}
