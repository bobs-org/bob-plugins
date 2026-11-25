// Source-backed task drawer rows shared by Live Preview and Reading view.
// Header recognition stays in the copied drawer twin; this model adds only
// the owner and direct-note count needed by the display layer.

const TASK_DRAWER_DOC_MODELS = new WeakMap();

function taskDrawerVisualColumns(text) {
  let columns = 0;
  for (const character of String(text || "")) columns += character === "\t" ? 2 : 1;
  return columns;
}

function taskDrawerStripColumns(line, columns) {
  const text = String(line || "");
  let index = 0;
  let removed = 0;
  while (index < text.length && removed < columns && (text[index] === " " || text[index] === "\t")) {
    removed += text[index] === "\t" ? 2 : 1;
    index += 1;
  }
  return text.slice(index);
}

function taskDrawerFenceContext(spans, index) {
  const line = spans[index] && spans[index].text || "";
  const item = drawer_list_item(line);
  if (item) {
    return {
      logical: item.body,
      baseIndent: taskDrawerVisualColumns(line.slice(0, item.bodyFrom)),
    };
  }
  const indent = drawer_indent_columns(line);
  for (let parentIndex = index - 1; parentIndex >= 0; parentIndex -= 1) {
    const parentLine = spans[parentIndex] && spans[parentIndex].text || "";
    const parent = drawer_list_item(parentLine);
    if (!parent || parent.indentColumns >= indent) continue;
    const baseIndent = taskDrawerVisualColumns(parentLine.slice(0, parent.bodyFrom));
    if (indent >= baseIndent) {
      return { logical: taskDrawerStripColumns(line, baseIndent), baseIndent };
    }
  }
  return { logical: line, baseIndent: 0 };
}

function taskDrawerFencedLines(contents) {
  try {
    const spans = drawer_line_spans(String(contents == null ? "" : contents));
    const fenced = new Set();
    let open = null;
    for (let index = 0; index < spans.length; index += 1) {
      if (open) {
        fenced.add(index);
        const logical = taskDrawerStripColumns(spans[index].text, open.baseIndent);
        const marker = drawer_fence_marker(logical);
        if (marker && marker.character === open.character && marker.length >= open.length
          && !logical.trim().slice(marker.length)) open = null;
        continue;
      }
      const context = taskDrawerFenceContext(spans, index);
      const marker = drawer_fence_marker(context.logical);
      if (!marker) continue;
      fenced.add(index);
      open = { ...marker, baseIndent: context.baseIndent };
    }
    return fenced;
  } catch (error) {
    return new Set();
  }
}

function taskDrawerOwnerState(line) {
  try {
    const item = taskReqListItem(line);
    const checkbox = item && taskReqParseCheckbox(item.body);
    if (!checkbox) return null;
    if (checkbox.mark === "x" || checkbox.mark === "X") return "done";
    if (checkbox.mark === "-") return "cancelled";
    return "open";
  } catch (error) {
    return null;
  }
}

function taskDrawerDirectNoteCount(contents, headerIndex, fenced) {
  try {
    const text = String(contents == null ? "" : contents);
    const spans = drawer_line_spans(text);
    const children = drawer_direct_child_indexes(text, { lineIndex: headerIndex });
    let count = 0;
    for (const index of children) {
      if (fenced && fenced.has(index)) continue;
      const line = spans[index] && spans[index].text;
      const item = taskReqListItem(line);
      if (!item) continue;
      if (taskReqParseCheckbox(item.body) || drawer_is_task_line(line)) continue;
      if (drawer_is_managed_line(line, item.body)) continue;
      count += 1;
    }
    return count;
  } catch (error) {
    return 0;
  }
}

function taskDrawerForest(contents) {
  try {
    const text = String(contents == null ? "" : contents).replace(/\r\n?/g, "\n");
    const spans = drawer_line_spans(text);
    const lines = spans.map((span) => span.text);
    const frontmatterEnd = taskReqFrontmatterEnd(lines);
    const fenced = taskDrawerFencedLines(text);
    const rows = [];
    for (let ownerIndex = 0; ownerIndex < lines.length; ownerIndex += 1) {
      if ((frontmatterEnd !== null && ownerIndex <= frontmatterEnd) || fenced.has(ownerIndex)) continue;
      const ownerText = lines[ownerIndex];
      if (!drawer_is_task_line(ownerText)) continue;
      const ownerName = typeof taskReqOwnerName === "function" ? taskReqOwnerName(ownerText) : "Task";
      const owner = {
        lineIndex: ownerIndex,
        line: ownerIndex + 1,
        ownerText,
        ownerName: ownerName || "Task",
        ownerState: taskDrawerOwnerState(ownerText) || "open",
      };
      for (const headerIndex of drawer_direct_child_indexes(text, owner)) {
        if (fenced.has(headerIndex)) continue;
        const header = recognize_drawer_header(text, owner, headerIndex);
        if (!header) continue;
        const count = taskDrawerDirectNoteCount(text, headerIndex, fenced);
        rows.push({
          ...header,
          lineIndex: headerIndex,
          lineText: lines[headerIndex],
          ownerLineIndex: ownerIndex,
          ownerText,
          ownerName: owner.ownerName,
          ownerState: owner.ownerState,
          count,
          empty: count === 0,
        });
      }
    }
    return rows;
  } catch (error) {
    return [];
  }
}

function taskDrawerForestForDoc(doc) {
  try {
    if (!doc || (typeof doc !== "object" && typeof doc !== "function")) return [];
    const cached = TASK_DRAWER_DOC_MODELS.get(doc);
    if (cached) return cached;
    const source = typeof doc.toString === "function" ? doc.toString() : "";
    const rows = taskDrawerForest(source);
    TASK_DRAWER_DOC_MODELS.set(doc, rows);
    return rows;
  } catch (error) {
    return [];
  }
}

try {
  if (module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      taskDrawerOwnerState,
      taskDrawerDirectNoteCount,
      taskDrawerFencedLines,
      taskDrawerForest,
      taskDrawerForestForDoc,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
