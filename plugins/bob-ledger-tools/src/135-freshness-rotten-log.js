// Display-only summary for one task's direct-child Rotten Log. `lines`
// is the raw source note and `taskLine` is zero-based. A malformed or
// duplicated marker is unknown, never an invented zero-count history.
function freshnessMarkRottenLogSummary(lines, taskLine) {
  try {
    if (!Array.isArray(lines) || !Number.isInteger(taskLine) || taskLine < 0) {
      return null;
    }
    const taskIndent = ((lines[taskLine] || "").match(/^[ \t]*/) || [""])[0].length;
    const children = [];
    for (let i = taskLine + 1; i < lines.length; i += 1) {
      const line = lines[i] || "";
      if (!line.trim()) continue;
      const indent = (line.match(/^[ \t]*/) || [""])[0].length;
      if (indent <= taskIndent) break;
      children.push({ line, indent });
    }
    const directIndent = children.length
      ? Math.min(...children.map((item) => item.indent))
      : null;
    const markers = children.filter(({ line, indent }) =>
      indent === directIndent && /^\s*(?:[-*+] |\d+[.)] )(?:(?:🥀️?)\s+)?\*\*(?:ROTTEN LOG|Rotten log)\*\*:?\s*$/.test(line),
    );
    if (markers.length !== 1) return null;
    const marker = markers[0];
    const markerIndex = children.indexOf(marker);
    const entryIndent = children
      .slice(markerIndex + 1)
      .find((item) => item.indent > marker.indent)?.indent;
    if (entryIndent === undefined) return null;
    const entries = [];
    for (let i = markerIndex + 1; i < children.length; i += 1) {
      const item = children[i];
      if (item.indent <= marker.indent) break;
      if (item.indent !== entryIndent) continue;
      const match = item.line.match(
        /^\s*(?:[-*+] |\d+[.)] )(?:\*|_)?(\d{4}-\d{2}-\d{2})(?:\*|_)?\s+—\s+(.+?)\s+·\s+kept\s+\d+×\s*$/,
      );
      if (match) entries.push({ date: match[1], reason: match[2].trim() });
    }
    if (!entries.length) return null;
    const latest = entries[0];
    return `🥀 ${entries.length} keeps logged · last ${latest.date} — ${latest.reason}`;
  } catch (error) {
    return null;
  }
}

function freshnessMarkRottenLogSummaryFromListItem(taskItem) {
  try {
    const children = Array.from((taskItem && taskItem.children) || []);
    const lists = children.filter((node) => /^(UL|OL)$/i.test(node.tagName || ""));
    const markers = [];
    for (const list of lists) {
      for (const item of Array.from(list.children || [])) {
        if (!/^(LI)$/i.test(item.tagName || "")) continue;
        const label = String(item.childNodes && item.childNodes.length
          ? Array.from(item.childNodes).filter((child) => child.nodeType === 3 || !/^(UL|OL)$/i.test(child.tagName || "")).map((child) => child.textContent || child.nodeValue || "").join("")
          : item.textContent || "").trim();
        if (/^(?:🥀️?\s*)?(?:\*\*)?(?:ROTTEN LOG|Rotten log)(?:\*\*)?:?$/.test(label)) {
          markers.push(item);
        }
      }
    }
    if (markers.length !== 1) return null;
    const marker = markers[0];
    const nestedLists = Array.from(marker.children || []).filter((node) => /^(UL|OL)$/i.test(node.tagName || ""));
    const entries = [];
    for (const list of nestedLists) {
      for (const item of Array.from(list.children || [])) {
        if (!/^(LI)$/i.test(item.tagName || "")) continue;
        const match = String(item.textContent || "").trim().match(
          /^\*?(\d{4}-\d{2}-\d{2})\*?\s+—\s+(.+?)\s+·\s+kept\s+\d+×$/,
        );
        if (match) entries.push({ date: match[1], reason: match[2].trim() });
      }
    }
    if (!entries.length) return null;
    const latest = entries[0];
    return `🥀 ${entries.length} keeps logged · last ${latest.date} — ${latest.reason}`;
  } catch (error) {
    return null;
  }
}

function freshnessMarkTaskListItem(node, root) {
  try {
    let current = node;
    let guard = 0;
    while (current && current !== root && guard < 100) {
      guard += 1;
      if (/^(LI)$/i.test(current.tagName || "")) return current;
      current = current.parentNode || null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function freshnessMarkInTaskQuery(node, root) {
  try {
    let current = node;
    let guard = 0;
    while (current && current !== root && guard < 100) {
      guard += 1;
      const classes = String(current.className || (current.getAttribute && current.getAttribute("class")) || "");
      if (/(?:^|\s)(?:block-language-dataview|dataview-result-list|dataview-result-table)(?:\s|$)/.test(classes)) return true;
      current = current.parentNode || null;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function freshnessMarkModelWithRottenLog(input, noteText, taskLine) {
  try {
    const model = freshnessMarkModel(input);
    const summary = freshnessMarkRottenLogSummary(
      String(noteText || "").split(/\r?\n/),
      taskLine,
    );
    if (model && summary) model.tooltip += "\n" + summary;
    return model;
  } catch (error) {
    return freshnessMarkModel(input);
  }
}
