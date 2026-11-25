// Pure task-settle grouping parser twin (bob-cli-q4.8.1.1 pure-twin).
//
// Ports `task_status_groups::{mod,parse}` heading-tree discovery, child
// classification, and direct-piece parsing. Emission lives in
// `139c-task-settle-groups-emit.js`; the transform entry in
// `139d-task-settle-transform.js`.

function tsSourceLines(contents) {
  const text = String(contents);
  const lines = [];
  let start = 0;
  let index = 0;
  for (let offset = 0; offset < text.length; offset += 1) {
    if (text[offset] !== "\n") continue;
    const end = offset + 1;
    const raw = text.slice(start, end);
    const [content, ending] = tsSplitLineEnding(raw);
    lines.push({ index: index++, byteStart: start, byteEnd: end, content, ending });
    start = end;
  }
  if (start < text.length) {
    lines.push({
      index: index++,
      byteStart: start,
      byteEnd: text.length,
      content: text.slice(start),
      ending: "",
    });
  }
  return lines;
}

function tsHeadingMask(lines) {
  const logical = lines.map((line) => line.content);
  const masked = new Set();
  const frontmatterEnd = tsStrictlyClosedFrontmatterEnd(logical);
  let scanStart = 0;
  if (frontmatterEnd != null) {
    for (let index = 0; index <= frontmatterEnd; index += 1) masked.add(index);
    scanStart = frontmatterEnd + 1;
  }
  for (const index of tsFencedLines(logical, scanStart, lines.length)) masked.add(index);
  let index = scanStart;
  while (index < lines.length) {
    if (masked.has(index)) {
      index += 1;
      continue;
    }
    const content = lines[index].content;
    if (tsHtmlCommentOpens(content)) {
      masked.add(index);
      if (!tsHtmlCommentCloses(content)) {
        index += 1;
        while (index < lines.length) {
          masked.add(index);
          const closes = tsHtmlCommentCloses(lines[index].content);
          index += 1;
          if (closes) break;
        }
        continue;
      }
    }
    index += 1;
  }
  return masked;
}

function tsDiscoverHeadings(lines, mask) {
  const headings = [];
  let previousPlain = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (mask.has(index)) {
      previousPlain = null;
      continue;
    }
    if (line.content.trim() === "") {
      previousPlain = null;
      continue;
    }
    if (tsIsBlockquoteLine(line.content) || tsIsIndentedCodeLine(line.content)) {
      previousPlain = null;
      continue;
    }
    const atx = tsAtxHeading(line.content);
    if (atx) {
      headings.push({
        level: atx.level,
        title: atx.title,
        headingLine: index + 1,
        headingStart: line.byteStart,
        headingEnd: line.byteEnd,
      });
      previousPlain = null;
      continue;
    }
    const underline = tsSetextUnderline(line.content);
    if (underline != null && previousPlain != null) {
      headings.push({
        level: underline,
        title: lines[previousPlain].content.trim(),
        headingLine: previousPlain + 1,
        headingStart: lines[previousPlain].byteStart,
        headingEnd: line.byteEnd,
      });
      previousPlain = null;
      continue;
    }
    if (tsParseListItem(line.content)) {
      previousPlain = null;
      continue;
    }
    previousPlain = index;
  }
  return headings;
}

function tsBuildTree(contentsLength, flats) {
  const ends = new Array(flats.length).fill(contentsLength);
  for (let index = 0; index < flats.length; index += 1) {
    const heading = flats[index];
    const next = flats.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    if (next) ends[index] = next.headingStart;
  }
  return tsNestHeadings(flats, ends, 0, flats.length, []);
}

function tsNestHeadings(flats, ends, start, end, parentAncestry) {
  const nodes = [];
  let index = start;
  while (index < end) {
    const heading = flats[index];
    let childEnd = index + 1;
    while (childEnd < end && flats[childEnd].level > heading.level) childEnd += 1;
    const ancestry = [...parentAncestry, heading.title];
    const children = tsNestHeadings(flats, ends, index + 1, childEnd, ancestry);
    nodes.push({
      level: heading.level,
      title: heading.title,
      headingLine: heading.headingLine,
      headingStart: heading.headingStart,
      headingEnd: heading.headingEnd,
      bodyStart: heading.headingEnd,
      bodyEnd: ends[index],
      sectionStart: heading.headingStart,
      sectionEnd: ends[index],
      ancestry,
      children,
    });
    index = childEnd;
  }
  return nodes;
}

function tsLineRangeForBytes(lines, start, end) {
  if (start >= end) return { start: 0, end: 0 };
  let rangeStart = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].byteEnd > start) {
      rangeStart = index;
      break;
    }
  }
  let rangeEnd = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].byteStart >= end) {
      rangeEnd = index;
      break;
    }
  }
  return { start: rangeStart, end: rangeEnd };
}

function tsIsTasksTitle(title) {
  return String(title).toLowerCase() === "tasks";
}

// --- List items -------------------------------------------------------------

function tsLeadingWs(line) {
  let count = 0;
  while (line[count] === " " || line[count] === "\t") count += 1;
  return count;
}

function tsParseListMarker(rest) {
  const first = rest[0];
  if (first === "-" || first === "*" || first === "+") {
    return { after: rest.slice(1), ordered: false };
  }
  let digits = 0;
  while (rest[digits] >= "0" && rest[digits] <= "9") digits += 1;
  if (digits === 0) return null;
  const punct = rest[digits];
  if (punct !== "." && punct !== ")") return null;
  return { after: rest.slice(digits + 1), ordered: true };
}

function tsParseCheckbox(rest) {
  if (!rest.startsWith("[")) return null;
  const chars = Array.from(rest.slice(1));
  if (chars.length === 0) return null;
  const symbol = chars[0];
  const afterSymbol = rest.slice(1 + symbol.length);
  if (!afterSymbol.startsWith("]")) return null;
  const afterClose = afterSymbol.slice(1);
  if (afterClose !== "" && !/^\s/.test(afterClose)) return null;
  return { symbol, body: afterClose.replace(/^\s+/, "") };
}

function tsParseListItem(content) {
  const line = String(content);
  const indent = tsLeadingWs(line);
  const rest = line.slice(indent);
  const marker = tsParseListMarker(rest);
  if (!marker) return null;
  if (marker.after === "" || !/\s/.test(marker.after[0])) return null;
  const checkbox = tsParseCheckbox(marker.after.replace(/^\s+/, ""));
  return {
    indent,
    ordered: marker.ordered,
    checkbox: checkbox ? checkbox.symbol : null,
    body: checkbox ? checkbox.body : marker.after.replace(/^\s+/, ""),
  };
}

// --- Subtrees ---------------------------------------------------------------

function tsCollectSubtree(lines, start, limit, indent) {
  let index = start + 1;
  let last = start;
  let inFence = null;
  while (index < limit) {
    const content = lines[index].content;
    if (inFence) {
      last = index;
      if (tsClosesFence(content, inFence)) inFence = null;
      index += 1;
      continue;
    }
    if (content.trim() === "") {
      let nextNonblank = -1;
      for (let candidate = index + 1; candidate < limit; candidate += 1) {
        if (lines[candidate].content.trim() !== "") {
          nextNonblank = candidate;
          break;
        }
      }
      if (nextNonblank !== -1 && tsLeadingWs(lines[nextNonblank].content) > indent) {
        last = index;
        index += 1;
        continue;
      }
      break;
    }
    const lineIndent = tsLeadingWs(content);
    if (lineIndent > indent) {
      last = index;
      const marker = tsFenceMarker(content);
      if (marker) inFence = marker;
      index += 1;
      continue;
    }
    if (
      tsAtxHeading(content) ||
      tsSetextUnderline(content) != null ||
      tsParseListItem(content) ||
      tsIsBlockquoteLine(content) ||
      tsFenceMarker(content)
    ) {
      break;
    }
    return { error: "ambiguous_boundary" };
  }
  if (inFence) return { error: "ambiguous_boundary" };
  return { end: last + 1 };
}

// --- Markers, badges, spans -------------------------------------------------

function tsParseGroupMarker(content) {
  const inner = tsStandaloneHtmlComment(String(content));
  if (inner == null) return null;
  if (!inner.startsWith(TS_LEGACY_GROUP_MARKER_PREFIX)) return null;
  const id = inner.slice(TS_LEGACY_GROUP_MARKER_PREFIX.length);
  const kind = tsGroupKindFromMarkerId(id);
  if (kind) return { ok: true, kind };
  return { ok: false };
}

function tsGroupMarkerState(node, lines) {
  const body = tsLineRangeForBytes(lines, node.bodyStart, node.bodyEnd);
  let first = -1;
  for (let index = body.start; index < body.end; index += 1) {
    if (lines[index].content.trim() !== "") {
      first = index;
      break;
    }
  }
  if (first === -1) return { state: "missing" };
  const parsed = tsParseGroupMarker(lines[first].content);
  if (!parsed) return { state: "missing" };
  if (!parsed.ok) return { state: "malformed" };
  if (tsGroupKindFromTitle(node.title) === parsed.kind) return { state: "valid", kind: parsed.kind };
  return { state: "mismatch" };
}

function tsExclusiveSpans(node) {
  const spans = [];
  let cursor = node.bodyStart;
  for (const child of node.children) {
    if (child.sectionStart > cursor) spans.push([cursor, child.sectionStart]);
    cursor = child.sectionEnd;
  }
  if (cursor < node.bodyEnd) spans.push([cursor, node.bodyEnd]);
  return spans;
}

function tsStrayMarkerInExclusive(node, lines) {
  for (const [start, end] of tsExclusiveSpans(node)) {
    const range = tsLineRangeForBytes(lines, start, end);
    for (let index = range.start; index < range.end; index += 1) {
      if (tsParseGroupMarker(lines[index].content)) return "malformed_ownership";
    }
  }
  return null;
}

function tsBadgeRowInSpan(lines, start, end) {
  const range = tsLineRangeForBytes(lines, start, end);
  for (let index = range.start; index < range.end; index += 1) {
    if (taskSettleIsBadgeRow(lines[index].content) || taskSettleIsLegacyBadgeMarker(lines[index].content)) {
      return true;
    }
  }
  return false;
}

function tsGroupBodyStart(node, lines) {
  const body = tsLineRangeForBytes(lines, node.bodyStart, node.bodyEnd);
  for (let index = body.start; index < body.end; index += 1) {
    if (lines[index].content.trim() === "") continue;
    if (tsParseGroupMarker(lines[index].content)) return lines[index].byteEnd;
    return node.bodyStart;
  }
  return node.bodyStart;
}

function tsFlushOther(contents, pieces, cursor, next) {
  if (cursor.value < next) {
    pieces.push({ kind: "other", raw: contents.slice(cursor.value, next) });
    cursor.value = next;
  }
}

function tsMatchingTask(item, classification) {
  if (item.checkbox == null) return null;
  if (!tsMatchesFilter(classification, item.body)) return null;
  return tsBucketOf(classification, item.checkbox);
}

function tsWarnNestedTasks(lines, start, end, classification, container, warnings) {
  for (let index = start; index < end; index += 1) {
    const item = tsParseListItem(lines[index].content);
    if (!item || item.checkbox == null) continue;
    if (!tsMatchesFilter(classification, item.body)) continue;
    warnings.push({
      originalHeadingLine: container.headingLine,
      headingAncestry: [...container.ancestry],
      code: "nested_under_ordinary_item",
      message: tsSkipMessage("nested_under_ordinary_item", container.title, lines[index].index + 1),
    });
  }
}

function tsParseDirectPieces(ctx, spanStart, spanEnd, container, warnings, failOnAmbiguous, allowBadges) {
  const { contents, lines, mask, classification } = ctx;
  if (spanStart >= spanEnd) return { ok: true, pieces: [] };
  const lineRange = tsLineRangeForBytes(lines, spanStart, spanEnd);
  const pieces = [];
  const cursor = { value: spanStart };
  let index = lineRange.start;
  while (index < lineRange.end) {
    const line = lines[index];
    if (line.byteStart < spanStart) {
      index += 1;
      continue;
    }
    if (line.byteStart >= spanEnd) break;
    if (
      taskSettleIsLegacyBadgeMarker(line.content) ||
      (!mask.has(index) && taskSettleIsBadgeRow(line.content))
    ) {
      if (!allowBadges) return { ok: false, code: "misplaced_badge_row" };
      tsFlushOther(contents, pieces, cursor, line.byteStart);
      const end = Math.min(line.byteEnd, spanEnd);
      pieces.push({ kind: "badges" });
      cursor.value = end;
      index += 1;
      continue;
    }
    if (mask.has(index)) {
      index += 1;
      continue;
    }
    if (
      tsIsBlockquoteLine(line.content) ||
      tsIsIndentedCodeLine(line.content) ||
      tsHtmlCommentOpens(line.content) ||
      tsFenceMarker(line.content) ||
      tsAtxHeading(line.content)
    ) {
      index += 1;
      continue;
    }
    const item = tsParseListItem(line.content);
    if (item) {
      const subtree = tsCollectSubtree(lines, index, lineRange.end, item.indent);
      if (subtree.error) {
        if (subtree.error === "ambiguous_boundary" && !failOnAmbiguous) {
          index += 1;
          continue;
        }
        return { ok: false, code: subtree.error };
      }
      const endLine = subtree.end;
      const byteStart = lines[index].byteStart;
      const byteEnd = Math.min(lines[endLine - 1].byteEnd, spanEnd);
      const bucket = tsMatchingTask(item, classification);
      if (bucket) {
        tsFlushOther(contents, pieces, cursor, byteStart);
        const movable = !item.ordered;
        if (item.ordered) {
          warnings.push({
            originalHeadingLine: container.headingLine,
            headingAncestry: [...container.ancestry],
            code: "unsupported_ordered_list",
            message: tsSkipMessage("unsupported_ordered_list", container.title, line.index + 1),
          });
        }
        pieces.push({
          kind: "task",
          startLine: line.index + 1,
          raw: contents.slice(byteStart, byteEnd),
          bucket,
          movable,
        });
        cursor.value = byteEnd;
        index = endLine;
        continue;
      }
      tsWarnNestedTasks(lines, index + 1, endLine, classification, container, warnings);
      index = endLine;
      continue;
    }
    index += 1;
  }
  tsFlushOther(contents, pieces, cursor, spanEnd);
  return { ok: true, pieces };
}

function tsAdoptableGroupBody(node, ctx) {
  if (node.children.length > 0) return false;
  const bodyStart = tsGroupBodyStart(node, ctx.lines);
  const parsed = tsParseDirectPieces(ctx, bodyStart, node.bodyEnd, node, [], false, false);
  if (!parsed.ok) return false;
  return parsed.pieces.every((piece) => {
    if (piece.kind === "task") return piece.movable;
    if (piece.kind === "other") return piece.raw.trim() === "";
    return false;
  });
}

function tsClassifyChildren(node, ctx) {
  const items = [];
  let fail = null;
  const warnings = [];
  const seenGroups = new Map();
  const stray = tsStrayMarkerInExclusive(node, ctx.lines);
  if (stray) fail = stray;
  for (const child of node.children) {
    if (tsIsTasksTitle(child.title)) {
      items.push({ kind: "nested", node: child });
      continue;
    }
    const groupKind = tsGroupKindFromTitle(child.title);
    if (groupKind) {
      if (tsBadgeRowInSpan(ctx.lines, child.bodyStart, child.bodyEnd)) {
        fail = "misplaced_badge_row";
      }
      if (child.children.length > 0) {
        fail = "authored_heading_in_group";
        continue;
      }
      const marker = tsGroupMarkerState(child, ctx.lines);
      if (marker.state === "valid" && marker.kind !== groupKind) {
        fail = "renamed_marked_heading";
        continue;
      }
      if (marker.state === "mismatch") {
        fail = "renamed_marked_heading";
        continue;
      }
      if (marker.state === "malformed") {
        fail = "malformed_ownership";
        continue;
      }
      if (marker.state === "valid" || marker.state === "missing") {
        if (tsAdoptableGroupBody(child, ctx)) {
          if (seenGroups.has(groupKind)) fail = "duplicate_group_heading";
          else seenGroups.set(groupKind, child.headingLine);
          items.push({ kind: "group", group: groupKind, node: child });
        } else if (!tsBadgeRowInSpan(ctx.lines, child.bodyStart, child.bodyEnd)) {
          fail = "ownership_collision";
        }
      }
      continue;
    }
    const marker = tsGroupMarkerState(child, ctx.lines);
    if (marker.state !== "missing") {
      fail = "renamed_marked_heading";
    } else {
      items.push({ kind: "authored", node: child });
    }
  }
  return { fail, warnings, items };
}

function tsParseContainerRegions(node, ctx, classified) {
  const itemWarnings = [];
  let intake = [];
  for (const [start, end] of tsExclusiveSpans(node)) {
    const parsed = tsParseDirectPieces(ctx, start, end, node, itemWarnings, true, true);
    if (!parsed.ok) return { ok: false, code: parsed.code };
    intake = intake.concat(parsed.pieces);
  }
  const hasBadges = intake.some((piece) => piece.kind === "badges");
  const groups = new Map();
  for (const item of classified.items) {
    if (item.kind !== "group") continue;
    const bodyStart = tsGroupBodyStart(item.node, ctx.lines);
    const parsed = tsParseDirectPieces(ctx, bodyStart, item.node.bodyEnd, node, itemWarnings, true, false);
    if (!parsed.ok) return { ok: false, code: parsed.code };
    groups.set(item.group, { pieces: parsed.pieces });
  }
  return { ok: true, intake, groups, itemWarnings, hasBadges };
}
