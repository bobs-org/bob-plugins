// --- Task theme fields: pure PT13 mirror of bob-cli task_theme.rs -------
// Canonical `[type:: X]` with legacy `[theme:: X]` still read; every setter
// emits `[type::]` and removes both spellings. This file never reads or
// writes vault files. Offsets are JavaScript string offsets (UTF-16), so
// editor callers can use them without translating Rust byte ranges.

function pomodoroThemeCanonicalName(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const name = String(raw == null ? "" : raw)
    .split(/\s+/u)
    .filter(Boolean)
    .join(" ")
    .replace(/[a-z]/g, (letter) => letter.toUpperCase());
  if (!/^[A-Z0-9]/.test(name) || !/[A-Z]/.test(name)) {
    return null;
  }
  return /^[A-Z0-9 &'(),.\/-]*$/.test(name) ? name : null;
}

function pomodoroThemeInlineFields(line) {
  const text = String(line == null ? "" : line);
  const regex =
    /\[([A-Za-z][A-Za-z0-9_-]*)\s*::\s*([^\]\n]*)\]|\(([A-Za-z][A-Za-z0-9_-]*)\s*::\s*([^\)\n]*)\)/g;
  const fields = [];
  let match;
  while ((match = regex.exec(text))) {
    const raw = match[2] !== undefined ? match[2] : match[4];
    const leading = (raw.match(/^[ \t]*/) || [""])[0].length;
    const remaining = raw.slice(leading);
    const trailing = (remaining.match(/[ \t]*$/) || [""])[0].length;
    // Locate the value capture from the `::` delimiter. `indexOf(raw)`
    // can hit the key when the value repeats it (`[theme:: theme]`).
    const delim = match[0].indexOf("::");
    const afterDelim = delim >= 0 ? match[0].slice(delim + 2) : "";
    const spacing = (afterDelim.match(/^[ \t]*/) || [""])[0].length;
    const rawStart = delim >= 0 ? delim + 2 + spacing : 0;
    const valueStart = match.index + rawStart + leading;
    fields.push({
      start: match.index,
      end: regex.lastIndex,
      valueStart,
      valueEnd: valueStart + Math.max(0, raw.length - leading - trailing),
      key: match[1] !== undefined ? match[1] : match[3],
      value: raw.slice(leading, raw.length - trailing),
    });
  }
  return fields;
}

function pomodoroThemeTaskFieldState(line) {
  const fields = pomodoroThemeInlineFields(line).filter(
    (field) => field.key === "type" || field.key === "theme",
  );
  if (fields.length === 0) {
    return { state: "none" };
  }
  if (fields.length > 1) {
    return { state: "repair", repair: "duplicate", fields };
  }
  const value = pomodoroThemeCanonicalName(fields[0].value);
  if (!value) {
    return { state: "repair", repair: "invalid", fields };
  }
  return {
    state: "set",
    value,
    key: pomodoroThemeNormalizeKey(value),
    fields,
  };
}

function pomodoroThemeLineEnding(line) {
  if (line.endsWith("\r\n")) {
    return { body: line.slice(0, -2), ending: "\r\n" };
  }
  if (line.endsWith("\n") || line.endsWith("\r")) {
    return { body: line.slice(0, -1), ending: line.slice(-1) };
  }
  return { body: line, ending: "" };
}

function pomodoroThemeRemoveTaskFields(line) {
  const fields = pomodoroThemeInlineFields(line).filter(
    (field) => field.key === "type" || field.key === "theme",
  );
  if (fields.length === 0) {
    return String(line == null ? "" : line);
  }
  const ranges = fields.map((field) => {
    const after = line[field.end];
    if (after === " " || after === "\t") {
      return [field.start, field.end + 1];
    }
    const before = line[field.start - 1];
    return before === " " || before === "\t"
      ? [field.start - 1, field.end]
      : [field.start, field.end];
  });
  ranges.sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push(range.slice());
    }
  }
  let output = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    output += line.slice(cursor, start);
    cursor = end;
  }
  return output + line.slice(cursor);
}

function pomodoroThemeStripBlockquotePrefix(line) {
  let rest = line;
  while (true) {
    const match = /^( {0,3})> ?/.exec(rest);
    if (!match) {
      return rest;
    }
    rest = rest.slice(match[0].length);
  }
}

function pomodoroThemeScanFloor(line) {
  const stripped = pomodoroThemeStripBlockquotePrefix(line);
  const offset = line.length - stripped.length;
  let index = (stripped.match(/^[ \t]*/) || [""])[0].length;
  const marker = /^(?:[-*+]|\d+[.)])[ \t]/.exec(stripped.slice(index));
  if (!marker) {
    return null;
  }
  index += marker[0].length - 1;
  while (/[\t\n\v\f\r ]/.test(stripped[index] || "")) {
    index += 1;
  }
  const close = stripped.indexOf("]", index);
  if (close < 0) {
    return null;
  }
  let bodyStart = close + 1;
  while (stripped[bodyStart] === " " || stripped[bodyStart] === "\t") {
    bodyStart += 1;
  }
  const body = stripped.slice(bodyStart);
  if (body === "#task" || body.startsWith("#task ") || body.startsWith("#task\t")) {
    bodyStart += "#task".length;
  }
  return offset + bodyStart;
}

function pomodoroThemeTrimEndTo(text, cursor) {
  let next = Math.min(text.length, cursor);
  while (next > 0 && (text[next - 1] === " " || text[next - 1] === "\t")) {
    next -= 1;
  }
  return next;
}

function pomodoroThemeTrailingBlockStart(text) {
  const trimmed = text.trimEnd();
  const tokenStart = Math.max(trimmed.lastIndexOf(" "), trimmed.lastIndexOf("\t")) + 1;
  const token = trimmed.slice(tokenStart);
  if (!/^\^[A-Za-z0-9-]+$/.test(token)) {
    return null;
  }
  if (tokenStart > 0 && !/[ \t]/.test(trimmed[tokenStart - 1])) {
    return null;
  }
  return trimmed.length - token.length;
}

function pomodoroThemeTrailingTagStart(trimmed, floor) {
  const tokenStart = Math.max(trimmed.lastIndexOf(" "), trimmed.lastIndexOf("\t")) + 1;
  const start = Math.max(tokenStart, floor);
  const token = trimmed.slice(start);
  if (!token.startsWith("#") || token.length === 1) {
    return null;
  }
  if (
    [...token.slice(1)].some(
      (character) =>
        /\s/u.test(character) || "!@#$%^&*(),.?\":{}|<>".includes(character),
    )
  ) {
    return null;
  }
  if (start > floor && !/[ \t]/.test(trimmed[start - 1])) {
    return null;
  }
  return start;
}

function pomodoroThemeTrailingFieldStart(trimmed) {
  let end = trimmed.length;
  if (trimmed.endsWith(",")) {
    end = trimmed.slice(0, -1).trimEnd().length;
  }
  const field = pomodoroThemeInlineFields(trimmed.slice(0, end)).pop();
  return field && field.end === end ? field.start : null;
}

function pomodoroThemeTrailingMetadataStart(line) {
  const trimmedLength = line.trimEnd().length;
  const floor = pomodoroThemeScanFloor(line);
  if (floor === null) {
    return trimmedLength;
  }
  let cursor = trimmedLength;
  let leftmost = null;
  const blockStart = pomodoroThemeTrailingBlockStart(line.slice(0, cursor));
  if (blockStart !== null && blockStart >= floor) {
    leftmost = blockStart;
    cursor = pomodoroThemeTrimEndTo(line, blockStart);
  }
  while (cursor > floor) {
    const trimmed = line.slice(0, cursor).trimEnd();
    if (trimmed.length <= floor) {
      break;
    }
    const tagStart = pomodoroThemeTrailingTagStart(trimmed, floor);
    if (tagStart !== null) {
      leftmost = tagStart;
      cursor = pomodoroThemeTrimEndTo(line, tagStart);
      continue;
    }
    const fieldStart = pomodoroThemeTrailingFieldStart(trimmed);
    if (fieldStart === null || fieldStart < floor) {
      break;
    }
    leftmost = fieldStart;
    cursor = pomodoroThemeTrimEndTo(line, fieldStart);
  }
  return leftmost === null ? trimmedLength : leftmost;
}

function pomodoroThemeSetTaskTheme(line, name) {
  const text = String(line == null ? "" : line);
  const { body, ending } = pomodoroThemeLineEnding(text);
  const cleared = pomodoroThemeRemoveTaskFields(body);
  const insertion = pomodoroThemeTrailingMetadataStart(cleared);
  let insert = `[type:: ${String(name == null ? "" : name)}]`;
  if (insertion > 0 && !/[ \t]$/.test(cleared.slice(0, insertion))) {
    insert = ` ${insert}`;
  }
  if (insertion < cleared.length && !/^[ \t]/.test(cleared.slice(insertion))) {
    insert += " ";
  }
  return cleared.slice(0, insertion) + insert + cleared.slice(insertion) + ending;
}

function pomodoroThemeClearTaskTheme(line) {
  const text = String(line == null ? "" : line);
  const { body, ending } = pomodoroThemeLineEnding(text);
  return pomodoroThemeRemoveTaskFields(body) + ending;
}

function pomodoroThemeKeyOf(value) {
  if (typeof value === "string") {
    return pomodoroThemeNormalizeKey(value);
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const key =
    value.theme && typeof value.theme.key === "string"
      ? value.theme.key
      : typeof value.key === "string"
        ? value.key
        : typeof value.theme_key === "string"
          ? value.theme_key
          : "";
  return key ? pomodoroThemeNormalizeKey(key) : null;
}

function pomodoroThemeSingleNonExemptComponent(name, exemptKeys) {
  const text = String(name == null ? "" : name).trim();
  if (!text || text === "(unnamed)") {
    return null;
  }
  const exempt = new Set(
    (Array.isArray(exemptKeys) ? exemptKeys : [])
      .map((value) => pomodoroThemeNormalizeKey(value))
      .filter(Boolean),
  );
  const choices = pomodoroThemeSplitComponents(text).filter(
    (component) => !exempt.has(pomodoroThemeNormalizeKey(component)),
  );
  if (choices.length !== 1) {
    return null;
  }
  const canonical = pomodoroThemeCanonicalName(choices[0]);
  return canonical ? { name: canonical, key: pomodoroThemeNormalizeKey(canonical) } : null;
}

function pomodoroThemePlanChange(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const none = { action: "none" };
  if (opts.deliberate !== true) {
    return none;
  }
  const shownKey = pomodoroThemeKeyOf(opts.suggestion);
  if (!shownKey) {
    return none;
  }
  const destination = pomodoroThemeSingleNonExemptComponent(
    opts.destinationName,
    opts.exemptKeys,
  );
  if (!destination) {
    return none;
  }
  const field = opts.field && typeof opts.field === "object" ? opts.field : {};
  const state = field.state || (typeof opts.field === "string" ? opts.field : "none");
  const fieldKey =
    typeof field.key === "string"
      ? pomodoroThemeNormalizeKey(field.key)
      : typeof opts.fieldKey === "string"
        ? pomodoroThemeNormalizeKey(opts.fieldKey)
        : null;
  const inheritedKey = pomodoroThemeKeyOf(opts.inherited);
  if (inheritedKey === destination.key) {
    return state === "none" ? none : { action: "clear" };
  }
  if (state === "set" && fieldKey === destination.key) {
    return none;
  }
  return { action: "set", name: destination.name, key: destination.key };
}

function pomodoroThemeLedgerNames(content) {
  const names = new Map();
  const lines = String(content == null ? "" : content).split("\n");
  const section = planSectionRange(lines);
  if (!section || typeof pomodoroThemeNameOffsetInLine !== "function") {
    return names;
  }
  for (let index = section.start; index <= section.end; index += 1) {
    const line = String(lines[index] || "");
    const range = pomodoroThemeNameOffsetInLine(line);
    if (!range) {
      continue;
    }
    const name = line.slice(range.nameStart, range.nameEnd).trim();
    for (const part of pomodoroThemeComponentsOf(name)) {
      const canonical = pomodoroThemeCanonicalName(part.raw);
      if (canonical) {
        names.set(part.key, canonical);
      }
    }
  }
  return names;
}
