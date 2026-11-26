// Shared daily-note Snoozed row parser. Keep this fragment byte-identical in
// bob-navigation-hotkeys, block-id-prompt, and task-status-cycler.

function snoozeLineRecords(source) {
  const text = String(source == null ? "" : source);
  const records = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = text.indexOf("\n", cursor);
    let cr = text.indexOf("\r", cursor);
    if (end < 0 || (cr >= 0 && cr < end)) end = cr;
    if (end < 0) {
      records.push({ text: text.slice(cursor), start: cursor, end: text.length, nextStart: text.length, eol: "" });
      break;
    }
    let eol = text[end];
    let nextStart = end + 1;
    if (eol === "\r" && text[nextStart] === "\n") {
      eol = "\r\n";
      nextStart += 1;
    }
    records.push({ text: text.slice(cursor, end), start: cursor, end, nextStart, eol });
    cursor = nextStart;
  }
  return records;
}

function snoozeFrontmatterEnd(lines) {
  if (!lines.length || lines[0].text.trimEnd() !== "---") return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].text.trimEnd() === "---") return index;
  }
  return null;
}

function snoozeFenceMarker(line) {
  let spaces = 0;
  while (line[spaces] === " ") spaces += 1;
  if (spaces > 3) return null;
  const code = line.charCodeAt(spaces);
  if (code !== 96 && code !== 126) return null;
  let length = 0;
  while (line.charCodeAt(spaces + length) === code) length += 1;
  return length >= 3 ? { code, length, offset: spaces } : null;
}

function snoozeClosesFence(line, open) {
  const marker = snoozeFenceMarker(line);
  if (!marker || marker.code !== open.code || marker.length < open.length) return false;
  return line.slice(marker.offset + marker.length).trim() === "";
}

function snoozeHeading(line) {
  if (!line.startsWith("##")) return false;
  const rest = line.slice(2);
  if (!/^[ \t]/.test(rest)) return false;
  const title = rest.trimStart();
  if (!title.startsWith("Snoozed")) return false;
  const tail = title.slice("Snoozed".length);
  return tail === "" || /^\s/u.test(tail);
}

function snoozeLevelTwoHeading(line) {
  return line.startsWith("##") && /^[ \t]/.test(line.slice(2));
}

function snoozeHeaderIndexes(lines) {
  const frontmatterEnd = snoozeFrontmatterEnd(lines);
  let fence = null;
  const found = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (frontmatterEnd !== null && index <= frontmatterEnd) continue;
    const line = lines[index].text;
    if (fence) {
      if (snoozeClosesFence(line, fence)) fence = null;
      continue;
    }
    const marker = snoozeFenceMarker(line);
    if (marker) {
      fence = marker;
      continue;
    }
    if (snoozeHeading(line)) found.push(index);
  }
  return found;
}

function snoozeFencedLines(lines, start, end) {
  const fenced = new Set();
  let fence = null;
  for (let index = start; index < end; index += 1) {
    const line = lines[index].text;
    if (fence) {
      fenced.add(index);
      if (snoozeClosesFence(line, fence)) fence = null;
      continue;
    }
    const marker = snoozeFenceMarker(line);
    if (marker) {
      fenced.add(index);
      fence = marker;
    }
  }
  return fenced;
}

function snoozeChildrenEnd(lines, rowIndex, sectionEnd, fenced) {
  let end = rowIndex + 1;
  while (end < sectionEnd) {
    if (fenced.has(end)) break;
    const line = lines[end].text;
    if (line.trim() === "") {
      let probe = end + 1;
      let belongs = false;
      while (probe < sectionEnd) {
        const next = lines[probe].text;
        if (next.trim() === "") {
          probe += 1;
          continue;
        }
        belongs = next.startsWith(" ") || next.startsWith("\t");
        break;
      }
      if (belongs) {
        end += 1;
        continue;
      }
      break;
    }
    if (line.startsWith(" ") || line.startsWith("\t")) {
      end += 1;
      continue;
    }
    break;
  }
  return end;
}

function snoozeInlineCodeSpans(line) {
  const spans = [];
  let index = 0;
  while (index < line.length) {
    if (line.charCodeAt(index) !== 96) {
      index += 1;
      continue;
    }
    const start = index;
    while (line.charCodeAt(index) === 96) index += 1;
    const width = index - start;
    let search = index;
    let matched = false;
    while (search < line.length) {
      if (line.charCodeAt(search) !== 96) {
        search += 1;
        continue;
      }
      const close = search;
      while (line.charCodeAt(search) === 96) search += 1;
      if (search - close === width) {
        spans.push({ start, end: search });
        index = search;
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }
  return spans;
}

function snoozeRawWikilinks(line) {
  const codeSpans = snoozeInlineCodeSpans(line);
  const spans = [];
  let base = 0;
  while (base < line.length) {
    const openAt = line.indexOf("[[", base);
    if (openAt < 0) break;
    const closeAt = line.indexOf("]]", openAt + 2);
    if (closeAt < 0) break;
    const end = closeAt + 2;
    if (!codeSpans.some((span) => openAt < span.end && end > span.start)) {
      spans.push({ open: openAt, end });
    }
    base = end;
  }
  return spans;
}

function snoozeBlockLinkSpans(line) {
  const spans = [];
  for (const raw of snoozeRawWikilinks(line)) {
    const inside = line.slice(raw.open + 2, raw.end - 2);
    const pipe = inside.indexOf("|");
    const linkTarget = pipe < 0 ? inside : inside.slice(0, pipe);
    const fragment = linkTarget.indexOf("#^");
    if (fragment < 0) continue;
    const target = linkTarget.slice(0, fragment).trim();
    const blockId = linkTarget.slice(fragment + 2).trim();
    if (!blockId || !/^[A-Za-z0-9-]+$/.test(blockId)) continue;
    const embedded = raw.open > 0 && line[raw.open - 1] === "!";
    spans.push({
      target,
      blockId,
      open: raw.open,
      end: raw.end,
      tokenStart: raw.open - (embedded ? 1 : 0),
      embedded,
      aliased: pipe >= 0,
    });
  }
  return spans;
}

function snoozeWallMinutes(value) {
  const text = String(value || "").trim();
  if (text.includes(":")) {
    const parts = text.split(":");
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return null;
    const hour = Number(parts[0].trim());
    const minute = Number(parts[1].trim());
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59 || parts[1].trim().length !== 2) return null;
    return hour * 60 + minute;
  }
  if (!/^\d{4}$/.test(text)) return null;
  const hour = Number(text.slice(0, 2));
  const minute = Number(text.slice(2));
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function snoozeBoldTime(rest) {
  if (!rest.startsWith("**")) return null;
  const close = rest.indexOf("**", 2);
  if (close < 0) return null;
  return { text: rest.slice(2, close), consumed: close + 2 };
}

function snoozeRowBase(lines, source, index, sectionEnd, fenced, reason) {
  const childrenEnd = snoozeChildrenEnd(lines, index, sectionEnd, fenced);
  const record = lines[index];
  const last = lines[Math.max(index, childrenEnd - 1)];
  const subtreeEnd = last ? last.nextStart : record.nextStart;
  return {
    lineIndex: index,
    line: index + 1,
    kind: "malformed",
    minutes: null,
    hhmm: null,
    target: null,
    blockId: null,
    embedded: false,
    aliased: false,
    childrenEnd,
    children: Math.max(0, childrenEnd - index - 1),
    malformedReason: reason || "malformed",
    wokeMinutes: null,
    wokeHhmm: null,
    lineStart: record.start,
    lineEnd: record.end,
    subtreeStart: record.start,
    subtreeEnd,
    subtree: source.slice(record.start, subtreeEnd),
    childrenText: source.slice(record.nextStart, subtreeEnd),
  };
}

function snoozeParseHistory(rest, base) {
  if (!rest.startsWith("~~")) return null;
  const inner = rest.slice(2);
  const bold = snoozeBoldTime(inner);
  if (!bold) return null;
  const afterBold = inner.slice(bold.consumed).trimStart();
  const spans = snoozeBlockLinkSpans(afterBold);
  if (spans.length !== 1) return null;
  const span = spans[0];
  if (afterBold.slice(0, span.tokenStart).trim() !== "") return null;
  let tail = afterBold.slice(span.end).trimStart();
  if (!tail.startsWith("~~")) return null;
  tail = tail.slice(2).trimStart();
  if (!tail.startsWith("·")) return null;
  tail = tail.slice(1).trimStart();
  if (!tail.startsWith("woke")) return null;
  const woke = tail.slice(4).trim();
  const match = /^(\d{2}):(\d{2})$/.exec(woke);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const minutes = snoozeWallMinutes(bold.text);
  if (minutes === null) return null;
  return {
    ...base,
    kind: "history",
    minutes,
    hhmm: String(Math.floor(minutes / 60)).padStart(2, "0") + String(minutes % 60).padStart(2, "0"),
    target: span.target,
    blockId: span.blockId,
    embedded: span.embedded,
    aliased: span.aliased,
    malformedReason: null,
    wokeMinutes: hour * 60 + minute,
    wokeHhmm: match[1] + ":" + match[2],
  };
}

function snoozeParseActive(rest, base) {
  const bold = snoozeBoldTime(rest);
  if (!bold) return null;
  const after = rest.slice(bold.consumed).trimStart();
  const spans = snoozeBlockLinkSpans(after);
  if (spans.length !== 1) return null;
  const span = spans[0];
  if (after.slice(0, span.tokenStart).trim() !== "" || after.slice(span.end).trim() !== "") return null;
  const minutes = snoozeWallMinutes(bold.text);
  if (minutes === null) return null;
  return {
    ...base,
    kind: "active",
    minutes,
    hhmm: String(Math.floor(minutes / 60)).padStart(2, "0") + String(minutes % 60).padStart(2, "0"),
    target: span.target,
    blockId: span.blockId,
    embedded: span.embedded,
    aliased: span.aliased,
    malformedReason: null,
  };
}

function snoozeParseRow(lines, source, index, sectionEnd, fenced) {
  const line = lines[index].text;
  const trimmed = line.trimEnd();
  if (line.startsWith(" ") || line.startsWith("\t")) {
    const candidate = line.trimStart();
    if (/^-[ \t](?:\*\*|~~)/.test(candidate)) {
      return snoozeRowBase(lines, source, index, sectionEnd, fenced, "indented");
    }
    return null;
  }
  if (!/^-[ \t](?:\*\*|~~)/.test(trimmed)) return null;
  const base = snoozeRowBase(lines, source, index, sectionEnd, fenced, "malformed");
  const afterDash = line.slice(1).replace(/^[ \t]/, "");
  return snoozeParseHistory(afterDash, base) || snoozeParseActive(afterDash, base) || base;
}

function snoozeParseSection(source) {
  const text = String(source == null ? "" : source);
  const lines = snoozeLineRecords(text);
  const headers = snoozeHeaderIndexes(lines);
  if (!headers.length) return null;
  const headerLine = headers[0];
  let sectionEnd = lines.length;
  let fence = null;
  for (let index = headerLine + 1; index < lines.length; index += 1) {
    const line = lines[index].text;
    if (fence) {
      if (snoozeClosesFence(line, fence)) fence = null;
      continue;
    }
    const marker = snoozeFenceMarker(line);
    if (marker) {
      fence = marker;
      continue;
    }
    if (snoozeLevelTwoHeading(line)) {
      sectionEnd = index;
      break;
    }
  }
  const contentStart = headerLine + 1;
  const fenced = snoozeFencedLines(lines, contentStart, sectionEnd);
  const rows = [];
  let index = contentStart;
  while (index < sectionEnd) {
    if (fenced.has(index)) {
      index += 1;
      continue;
    }
    const row = snoozeParseRow(lines, text, index, sectionEnd, fenced);
    if (!row) {
      index += 1;
      continue;
    }
    rows.push(row);
    index = Math.max(row.childrenEnd, index + 1);
  }
  const duplicateHeaders = headers.filter((value) => value !== headerLine);
  return {
    headerLine,
    headerNumber: headerLine + 1,
    headerStart: lines[headerLine].start,
    contentStart,
    contentEnd: sectionEnd,
    sectionEndOffset: sectionEnd < lines.length ? lines[sectionEnd].start : text.length,
    rows,
    duplicateHeaders,
    duplicateNumbers: duplicateHeaders.map((value) => value + 1),
    lines,
    source: text,
  };
}
