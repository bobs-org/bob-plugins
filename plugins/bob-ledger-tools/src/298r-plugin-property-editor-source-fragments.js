// Read-only YAML source fragments for the native property editor parity
// phase (source-fragments). Pure and DOM-free: no document access, no bob
// spawns, no writes. Later clipboard and YAML stages consume these helpers;
// every mutation still goes through the existing `bob props update` writer
// (`prop.set_yaml`) with Bob's fingerprint and session guards.
//
// Result contract for the next phases:
// - `propertyEditorSourceEntries(sourceText)` is structural only. It returns
//   `{ ok: true, entries, lineEnding, flow, yamlStart, yamlEnd }` or
//   `{ ok: false, code, message, hint }`. Entries are source-ordered with
//   normalized key, 1-based occurrence, exact `[start, end)` offsets into the
//   original string, attached leading trivia, `raw` bytes, and a `valueYaml`
//   fragment suitable for `prop.set_yaml`. `support` is `"ok"` or
//   `"unsupported"`; unsupported entries carry a `refusal` and must be
//   copied through the YAML escape, never fabricated.
// - `propertyEditorSourceFragments(sourceText, parseYaml)` adds semantic
//   validation through Obsidian's `parseYaml` and cross-checks parsed mapping
//   keys against the structural entries. Same shape plus `validated: true`.
// - `propertyEditorClipboardDecode(clipboardText, parseYaml)` accepts one
//   YAML mapping, optionally wrapped in one matched frontmatter delimiter
//   pair, and returns `{ ok: true, entries }` with ordered `{ key,
//   occurrence, valueYaml, raw }`. Malformed input, multi-document input,
//   duplicate keys, non-mapping roots, fence/body injection, non-scalar
//   names, and anchor/alias/merge/tag constructs return
//   `{ ok: false, code, message, hint }` and never write.
// - `propertyEditorReadSourceSnapshot(options)` (async) reads note source
//   around a fresh report with bounded retries, refuses unsaved panes
//   without saving, honors cancellation, and returns validated spans.
// - `propertyEditorSourceAssembleEntries(entries, sourceText, lineEnding)`
//   renders exact clipboard bytes: block entries keep their original bytes;
//   root-flow selections are reassembled with only the necessary braces and
//   commas.
const PROPERTY_EDITOR_SOURCE_MAX_RETRIES = 3;
const PROPERTY_EDITOR_SOURCE_YAML_HINT = "y opens YAML.";
const PROPERTY_EDITOR_SOURCE_SAVE_HINT = "Save the note before retrying.";

function propertyEditorSourceNormalizePath(value) {
  return typeof value === "string" ? value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") : "";
}

function propertyEditorSourceFailure(code, message, hint) {
  return {
    ok: false,
    code,
    message,
    hint: typeof hint === "string" && hint ? hint : PROPERTY_EDITOR_SOURCE_YAML_HINT,
  };
}

function propertyEditorSourceSplitLines(sourceText) {
  const text = String(sourceText);
  const lines = [];
  let offset = 0;
  let lineEnding = "\n";
  let endingSeen = false;
  const push = (lineText, ending, start, end) => {
    lines.push({ text: lineText, ending, start, end });
  };
  let index = 0;
  while (index <= text.length) {
    const next = text.indexOf("\n", index);
    if (next < 0) {
      if (index <= text.length - 1 || (index === text.length && text.length === 0)) {
        push(text.slice(index), "", index, text.length);
      } else if (index < text.length) {
        push(text.slice(index), "", index, text.length);
      } else if (lines.length === 0) {
        push("", "", 0, 0);
      }
      break;
    }
    const hasCR = next > index && text[next - 1] === "\r";
    const ending = hasCR ? "\r\n" : "\n";
    if (!endingSeen) {
      lineEnding = ending;
      endingSeen = true;
    }
    const lineText = text.slice(index, hasCR ? next - 1 : next);
    push(lineText, ending, index, next + 1);
    index = next + 1;
    if (index >= text.length) break;
  }
  return { lines, lineEnding: endingSeen ? lineEnding : "\n" };
}

function propertyEditorSourceTrimmedLine(lineText) {
  return String(lineText == null ? "" : lineText).trim();
}

function propertyEditorSourceColon(line) {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === "\"") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") quote = "";
      continue;
    }
    if (quote === "'") {
      if (char === "'" && line[index + 1] === "'") { index += 1; continue; }
      if (char === "'") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") { quote = char; continue; }
    if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) return -1;
    if (char === ":" && (index + 1 === line.length || /\s/.test(line[index + 1]))) return index;
  }
  return -1;
}

function propertyEditorSourceParseKey(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (text.length >= 2 && text[0] === "\"" && text[text.length - 1] === "\"") {
    try { return JSON.parse(text); } catch (_) { return text.slice(1, -1); }
  }
  if (text.length >= 2 && text[0] === "'" && text[text.length - 1] === "'") {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text[0] === "?" || text[0] === "-" || text[0] === "[" || text[0] === "{" || text[0] === "*"
    || text[0] === "&" || text[0] === "!" || text[0] === "|"
    || text[0] === ">" || text[0] === "#") return null;
  return text;
}

function propertyEditorSourceStripComment(raw) {
  const line = String(raw == null ? "" : raw);
  let quote = "";
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === "\"") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") quote = "";
      continue;
    }
    if (quote === "'") {
      if (char === "'" && line[index + 1] === "'") { index += 1; continue; }
      if (char === "'") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") { quote = char; continue; }
    if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function propertyEditorSourceBlockHeader(valuePart) {
  const head = String(valuePart || "").trim();
  const mark = head[0];
  if (mark !== "|" && mark !== ">") return null;
  if (/^[|>][+-]?[1-9]?(?:[+-][1-9]?)?\s*$/.test(head)) return head;
  return null;
}

function propertyEditorSourceUnsupportedScan(valueText) {
  const text = String(valueText || "");
  const stripped = text
    .split("\n")
    .map((line) => propertyEditorSourceStripComment(line))
    .join("\n");
  if (/(^|[\s\[{,])&[^\s]+/.test(stripped)) {
    return { code: "opaque-anchor", message: "Anchors stay opaque — y opens YAML." };
  }
  if (/(^|[\s\[{,(])\*[^\s\],}]+/.test(stripped)) {
    return { code: "opaque-alias", message: "Aliases stay opaque — y opens YAML." };
  }
  if (/(^|[\s\[{,])![^\s\],}]+/.test(stripped) || /(^|[\s\[{,])!!?[^\s\],}]+/.test(stripped)) {
    return { code: "opaque-tag", message: "Custom tags stay opaque — y opens YAML." };
  }
  return null;
}

function propertyEditorSourceFindFrontmatter(sourceText) {
  const text = String(sourceText == null ? "" : sourceText);
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const hadBOM = clean.length !== text.length;
  const split = propertyEditorSourceSplitLines(text);
  const lines = split.lines;
  const firstText = lines.length ? lines[0].text.replace(/^\uFEFF/, "") : "";
  if (propertyEditorSourceTrimmedLine(firstText) !== "---") {
    return { state: "none", lines, lineEnding: split.lineEnding, hasBOM: hadBOM };
  }
  let close = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const marker = propertyEditorSourceTrimmedLine(lines[index].text);
    if (marker === "---" || marker === "...") { close = index; break; }
  }
  if (close < 0) {
    return {
      state: "unclosed", lines, lineEnding: split.lineEnding, hasBOM: hadBOM, openLine: 1,
    };
  }
  return {
    state: "closed",
    lines,
    lineEnding: split.lineEnding,
    hasBOM: hadBOM,
    openLine: 1,
    closeLine: close + 1,
    yamlStart: lines[0].end,
    yamlEnd: lines[close].start,
    yamlText: text.slice(lines[0].end, lines[close].start),
  };
}

function propertyEditorSourceLineNumberAt(lines, offset) {
  for (let index = 0; index < lines.length; index += 1) {
    if (offset < lines[index].end || index === lines.length - 1) return index + 1;
  }
  return lines.length;
}

function propertyEditorSourceFlowEntries(yamlText, yamlStart, lines, lineEnding, fullText) {
  const text = String(yamlText);
  const whole = typeof fullText === "string" ? fullText : text;
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) return null;
  const base = yamlStart + text.indexOf("{");
  const inner = trimmed.slice(1, -1);
  const innerBase = yamlStart + text.indexOf(trimmed) + 1;
  const parts = [];
  let depthBrace = 0;
  let depthBracket = 0;
  let quote = "";
  let escaped = false;
  let current = "";
  let currentStart = 0;
  const flush = (end) => {
    parts.push({ text: current, start: currentStart, end });
    current = "";
  };
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (quote === "\"") {
      current += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") quote = "";
      continue;
    }
    if (quote === "'") {
      if (char === "'" && inner[index + 1] === "'") { current += "''"; index += 1; continue; }
      current += char;
      if (char === "'") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") { quote = char; current += char; continue; }
    if (char === "#" && (index === 0 || /\s/.test(inner[index - 1]))) {
      let end = inner.indexOf("\n", index);
      if (end < 0) end = inner.length;
      current += inner.slice(index, end);
      index = end - 1;
      continue;
    }
    if (char === "{") { depthBrace += 1; current += char; continue; }
    if (char === "}") {
      if (depthBrace === 0) {
        return { ok: false, ...propertyEditorSourceFailure("ambiguous", "Unbalanced flow mapping — y opens YAML.") };
      }
      depthBrace -= 1; current += char; continue;
    }
    if (char === "[") { depthBracket += 1; current += char; continue; }
    if (char === "]") {
      if (depthBracket === 0) {
        return { ok: false, ...propertyEditorSourceFailure("ambiguous", "Unbalanced flow value — y opens YAML.") };
      }
      depthBracket -= 1; current += char; continue;
    }
    if (char === "," && depthBrace === 0 && depthBracket === 0) {
      flush(index);
      currentStart = index + 1;
      continue;
    }
    current += char;
  }
  flush(inner.length);
  const entries = [];
  const counts = new Map();
  for (const part of parts) {
    if (!String(part.text).trim()) continue;
    const colon = propertyEditorSourceColon(part.text);
    if (colon < 0) {
      return { ok: false, ...propertyEditorSourceFailure("ambiguous", "A flow entry has no key — y opens YAML.") };
    }
    const key = propertyEditorSourceParseKey(part.text.slice(0, colon));
    if (typeof key !== "string" || !key) {
      return { ok: false, ...propertyEditorSourceFailure("ambiguous", "A flow entry name is not a plain key — y opens YAML.") };
    }
    if (key === "<<") {
      return {
        ok: false, ...propertyEditorSourceFailure("unsupported", "Merge keys stay opaque — y opens YAML."),
      };
    }
    const rawInner = part.text.trim();
    const absoluteStart = innerBase + part.start + (part.text.length - part.text.replace(/^\s*/, "").length);
    const absoluteEnd = innerBase + part.end - (part.text.length - part.text.replace(/\s*$/, "").length);
    const occurrence = (counts.get(key) || 0) + 1;
    counts.set(key, occurrence);
    const valuePart = propertyEditorSourceStripComment(part.text.slice(colon + 1)).trim();
    const unsupported = propertyEditorSourceUnsupportedScan(valuePart);
    entries.push({
      key,
      occurrence,
      start: absoluteStart,
      end: absoluteEnd,
      keyStart: absoluteStart,
      keyEnd: absoluteStart + part.text.slice(0, colon).trim().length,
      valueStart: absoluteStart,
      valueEnd: absoluteEnd,
      triviaStart: absoluteStart,
      triviaEnd: absoluteStart,
      trivia: "",
      raw: whole.slice(absoluteStart, absoluteEnd),
      rawInner,
      valueYaml: valuePart,
      line: propertyEditorSourceLineNumberAt(lines, absoluteStart),
      flow: true,
      support: unsupported ? "unsupported" : "ok",
      refusal: unsupported
        ? { code: unsupported.code, message: unsupported.message, hint: PROPERTY_EDITOR_SOURCE_YAML_HINT }
        : null,
    });
  }
  void lineEnding;
  return { ok: true, entries, flow: true };
}

function propertyEditorSourceEntries(sourceText) {
  const text = String(sourceText == null ? "" : sourceText);
  const found = propertyEditorSourceFindFrontmatter(text);
  if (found.state === "none") {
    return { ok: false, ...propertyEditorSourceFailure("no-frontmatter", "No frontmatter block — y opens YAML.") };
  }
  if (found.state === "unclosed") {
    return { ok: false, ...propertyEditorSourceFailure("unclosed", "Frontmatter never closes — y opens YAML.") };
  }
  const { lines, lineEnding } = found;
  const yamlText = found.yamlText;
  if (!String(yamlText).trim()) return { ok: true, entries: [], lineEnding, flow: false, yamlStart: found.yamlStart, yamlEnd: found.yamlEnd };
  const flow = propertyEditorSourceFlowEntries(yamlText, found.yamlStart, lines, lineEnding, text);
  if (flow && flow.ok === false) return flow;
  if (flow && flow.ok === true) {
    return {
      ok: true, entries: flow.entries, lineEnding, flow: true, yamlStart: found.yamlStart, yamlEnd: found.yamlEnd,
    };
  }
  const yamlFirst = found.yamlStart;
  const openIndex = 0;
  const closeIndex = lines.findIndex((_, index) => index > openIndex
    && (propertyEditorSourceTrimmedLine(lines[index].text) === "---"
      || propertyEditorSourceTrimmedLine(lines[index].text) === "..."));
  const keyLines = [];
  for (let index = openIndex + 1; index < closeIndex; index += 1) {
    const line = lines[index];
    const trimmed = propertyEditorSourceTrimmedLine(line.text);
    if (!trimmed || trimmed.startsWith("#") || /^[ \t]/.test(line.text)) continue;
    if (/^[-?](\s|$)/.test(line.text)) {
      return { ok: false, ...propertyEditorSourceFailure("non-mapping", "Frontmatter is not a key mapping — y opens YAML.") };
    }
    const colon = propertyEditorSourceColon(line.text);
    if (colon < 0) {
      return {
        ok: false,
        ...propertyEditorSourceFailure(
          "ambiguous",
          `Line ${index + 1} is not a property entry — y opens YAML.`,
        ),
      };
    }
    const key = propertyEditorSourceParseKey(line.text.slice(0, colon));
    if (typeof key !== "string" || !key) {
      return {
        ok: false,
        ...propertyEditorSourceFailure(
          "ambiguous",
          `Line ${index + 1} has no plain property name — y opens YAML.`,
        ),
      };
    }
    if (key === "<<") {
      return { ok: false, ...propertyEditorSourceFailure("unsupported", "Merge keys stay opaque — y opens YAML.") };
    }
    keyLines.push({ lineIndex: index, colon, key });
  }
  const entries = [];
  const counts = new Map();
  keyLines.forEach((keyLine, position) => {
    const line = lines[keyLine.lineIndex];
    const regionStart = line.start;
    const lastBodyIndex = position + 1 < keyLines.length ? keyLines[position + 1].lineIndex : closeIndex;
    const afterColon = line.text.slice(keyLine.colon + 1);
    const header = propertyEditorSourceBlockHeader(propertyEditorSourceStripComment(afterColon));
    const isBlock = header !== null;
    const keepChomping = isBlock && header.includes("+");
    // The entry keeps every byte through its last significant content line:
    // indented non-blank lines always count; trailing blanks only count for
    // keep-chomped (`|+`/`>+`) scalars, where they are the value. Trailing
    // zero-indent comments and separator blanks stay trivia for the next
    // entry so copying never drags another entry's comments along.
    let entryEnd = line.end;
    for (let index = keyLine.lineIndex + 1; index < lastBodyIndex; index += 1) {
      const candidate = lines[index];
      const candidateTrimmed = propertyEditorSourceTrimmedLine(candidate.text);
      if (/^[ \t]/.test(candidate.text) && candidateTrimmed) {
        entryEnd = candidate.end;
        continue;
      }
      if (!candidateTrimmed && keepChomping) {
        entryEnd = candidate.end;
      }
    }
    const occurrence = (counts.get(keyLine.key) || 0) + 1;
    counts.set(keyLine.key, occurrence);
    // Bob's attached-trivia model: every byte since the previous entry's end
    // belongs to this entry, so inter-entry comments and blanks travel with
    // the following entry exactly like `prop.move` / `prop.restore` (verified
    // against real bob: adjacent and blank-separated comments move; copying
    // must retain them rather than silently dropping them). The first entry
    // owns every byte from the frontmatter body start.
    const entryStart = position === 0 ? found.yamlStart : entries[position - 1].end;
    const leading = text.slice(entryStart, regionStart);
    const rawEnd = position + 1 < keyLines.length ? entryEnd : found.yamlEnd;
    const raw = text.slice(entryStart, rawEnd);
    const trivia = "";
    if (position > 0) {
      const prev = entries[position - 1];
      prev.trivia = "";
      prev.triviaStart = prev.triviaEnd = prev.end;
    }
    const bodyText = [];
    if (!isBlock) {
      for (let index = keyLine.lineIndex + 1; index < lastBodyIndex; index += 1) {
        const candidate = lines[index];
        if (candidate.start >= rawEnd) break;
        if (/^[ \t]/.test(candidate.text) || !propertyEditorSourceTrimmedLine(candidate.text)) {
          bodyText.push(candidate.text);
        }
      }
      while (bodyText.length && !propertyEditorSourceTrimmedLine(bodyText[bodyText.length - 1])) {
        bodyText.pop();
      }
    }
    const firstValue = propertyEditorSourceStripComment(afterColon).trim();
    let valueYaml = firstValue;
    if (isBlock) {
      const rest = text.slice(line.end, rawEnd).split(/\r?\n/);
      if (rest.length && rest[rest.length - 1] === "") rest.pop();
      valueYaml = [header, ...rest].join("\n");
      if (rest.length && !valueYaml.endsWith("\n")) valueYaml += "\n";
    } else if (!firstValue && !bodyText.length) {
      valueYaml = "null";
    } else if (!firstValue) {
      valueYaml = `\n${bodyText.join("\n")}`;
    } else if (bodyText.length) {
      valueYaml = `${firstValue}\n${bodyText.join("\n")}`;
    }
    const scanTarget = isBlock
      ? propertyEditorSourceStripComment(afterColon)
      : valueYaml;
    const unsupported = propertyEditorSourceUnsupportedScan(scanTarget);
    const valueStart = line.start + keyLine.colon + 1;
    entries.push({
      key: keyLine.key,
      occurrence,
      start: entryStart,
      end: rawEnd,
      leading,
      keyStart: regionStart,
      keyEnd: line.start + keyLine.colon,
      valueStart,
      valueEnd: rawEnd,
      triviaStart: rawEnd,
      triviaEnd: rawEnd + trivia.length,
      trivia,
      raw,
      valueYaml,
      line: keyLine.lineIndex + 1,
      flow: false,
      support: unsupported ? "unsupported" : "ok",
      refusal: unsupported
        ? { code: unsupported.code, message: unsupported.message, hint: PROPERTY_EDITOR_SOURCE_YAML_HINT }
        : null,
    });
  });
  return {
    ok: true, entries, lineEnding, flow: false, yamlStart: found.yamlStart, yamlEnd: found.yamlEnd,
  };
}

function propertyEditorSourceParsedKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = Object.create(null);
  for (const key of Object.keys(value)) {
    record[key] = true;
  }
  return record;
}

function propertyEditorSourceCrossCheck(entries, parsed) {
  const parsedKeys = propertyEditorSourceParsedKeys(parsed);
  if (parsedKeys === null) {
    return propertyEditorSourceFailure("non-mapping", "Frontmatter is not a key mapping — y opens YAML.");
  }
  const sourceCounts = new Map();
  for (const entry of entries) sourceCounts.set(entry.key, (sourceCounts.get(entry.key) || 0) + 1);
  const missing = [];
  const extra = [];
  for (const key of sourceCounts.keys()) {
    if (!Object.prototype.hasOwnProperty.call(parsedKeys, key)) missing.push(key);
  }
  for (const key of Object.keys(parsedKeys)) {
    if (!sourceCounts.has(key)) extra.push(key);
  }
  if (missing.length || extra.length) {
    const detail = missing.length ? `missing ${missing.slice(0, 3).map((key) => `“${key}”`).join(", ")}` : `extra ${extra.slice(0, 3).join(", ")}`;
    return propertyEditorSourceFailure("ambiguous", `Source and parsed keys disagree (${detail}) — y opens YAML.`);
  }
  return null;
}

function propertyEditorSourceFragments(sourceText, parseYaml) {
  const structural = propertyEditorSourceEntries(sourceText);
  if (!structural.ok) return structural;
  if (typeof parseYaml !== "function") {
    return { ok: false, ...propertyEditorSourceFailure("yaml-parser-unavailable", "YAML validation is unavailable — y opens YAML.") };
  }
  const found = propertyEditorSourceFindFrontmatter(String(sourceText));
  let parsed = null;
  let threw = null;
  try {
    parsed = parseYaml(found.yamlText);
  } catch (error) {
    threw = error;
  }
  if (threw) {
    const counts = new Map();
    for (const entry of structural.entries) counts.set(entry.key, (counts.get(entry.key) || 0) + 1);
    const duplicated = [...counts.values()].some((count) => count > 1);
    if (!duplicated) {
      const message = threw && threw.message ? String(threw.message).split("\n")[0] : "Invalid YAML";
      return {
        ok: false,
        ...propertyEditorSourceFailure("invalid-yaml", `${message} — y opens YAML.`),
      };
    }
    // A parse failure alongside duplicates is still a repair case: Bob
    // reports `prop_duplicate_key` and the editor keeps its YAML escape.
    return {
      ok: false,
      ...propertyEditorSourceFailure("duplicate", "Duplicate keys need YAML repair — y opens YAML."),
    };
  }
  if (parsed === null || parsed === undefined) parsed = Object.create(null);
  const mismatch = propertyEditorSourceCrossCheck(structural.entries, parsed);
  if (mismatch) return { ok: false, ...mismatch };
  return { ...structural, validated: true };
}

function propertyEditorClipboardStripWrapper(clipboardText) {
  const text = String(clipboardText == null ? "" : clipboardText).replace(/^\uFEFF/, "");
  if (text.includes("```")) {
    return { ok: false, ...propertyEditorSourceFailure("fence", "Clipboard holds a code fence, not YAML — copy the mapping itself.") };
  }
  const split = propertyEditorSourceSplitLines(text);
  const lines = split.lines;
  const first = lines.length ? propertyEditorSourceTrimmedLine(lines[0].text) : "";
  if (first !== "---") return { ok: true, yaml: text, wrapped: false, lineEnding: split.lineEnding };
  let close = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const marker = propertyEditorSourceTrimmedLine(lines[index].text);
    if (marker === "---" || marker === "...") { close = index; break; }
  }
  if (close < 0) {
    return { ok: false, ...propertyEditorSourceFailure("unclosed", "Clipboard frontmatter never closes — copy one mapping.") };
  }
  const after = text.slice(lines[close].end);
  if (propertyEditorSourceTrimmedLine(after)) {
    return { ok: false, ...propertyEditorSourceFailure("body", "Clipboard holds note body after frontmatter — copy one mapping.") };
  }
  return {
    ok: true, yaml: text.slice(lines[0].end, lines[close].start), wrapped: true, lineEnding: split.lineEnding,
  };
}

function propertyEditorClipboardDecode(clipboardText, parseYaml) {
  const wrapper = propertyEditorClipboardStripWrapper(clipboardText);
  if (!wrapper.ok) return wrapper;
  const yaml = String(wrapper.yaml);
  if (!yaml.trim()) return { ok: true, entries: [], lineEnding: wrapper.lineEnding, wrapped: wrapper.wrapped };
  for (const line of yaml.split("\n")) {
    const trimmed = propertyEditorSourceTrimmedLine(line);
    if (trimmed === "---" || trimmed === "...") {
      return { ok: false, ...propertyEditorSourceFailure("multi-document", "Clipboard holds multiple documents — copy one mapping.") };
    }
  }
  if (typeof parseYaml !== "function") {
    return { ok: false, ...propertyEditorSourceFailure("yaml-parser-unavailable", "YAML validation is unavailable — y opens YAML.") };
  }
  let parsed = null;
  try {
    parsed = parseYaml(yaml);
  } catch (error) {
    const message = error && error.message ? String(error.message).split("\n")[0] : "Invalid YAML";
    return { ok: false, ...propertyEditorSourceFailure("invalid-yaml", `${message} — fix the clipboard YAML.`) };
  }
  if (parsed === null || parsed === undefined) return { ok: true, entries: [], lineEnding: wrapper.lineEnding, wrapped: wrapper.wrapped };
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, ...propertyEditorSourceFailure("non-mapping", "Clipboard is not a YAML mapping — copy key: value lines.") };
  }
  const probe = propertyEditorSourceEntries(`---\n${yaml.replace(/\n?$/, "\n")}---\n`);
  if (!probe.ok) {
    if (probe.code === "non-mapping" || probe.code === "ambiguous") return probe;
    return probe;
  }
  const counts = new Map();
  for (const entry of probe.entries) counts.set(entry.key, (counts.get(entry.key) || 0) + 1);
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  if (duplicates.length) {
    return {
      ok: false,
      ...propertyEditorSourceFailure(
        "duplicate",
        `Clipboard repeats “${duplicates.slice(0, 3).join(", ")}” — keep one entry per key.`,
      ),
    };
  }
  for (const entry of probe.entries) {
    if (entry.support === "unsupported" && entry.refusal) {
      return { ok: false, code: entry.refusal.code, message: entry.refusal.message, hint: "Paste plain values — y opens YAML." };
    }
  }
  const unsupportedWhole = propertyEditorSourceUnsupportedScan(yaml);
  if (unsupportedWhole) {
    return { ok: false, code: unsupportedWhole.code, message: unsupportedWhole.message, hint: "Paste plain values — y opens YAML." };
  }
  const parsedKeys = new Set(Object.keys(parsed));
  const entries = probe.entries.map((entry) => {
    let key = entry.key;
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
      const match = Object.keys(parsed).find((candidate) => String(candidate) === key);
      if (match !== undefined) key = match;
    }
    void parsedKeys;
    return { key, occurrence: entry.occurrence, valueYaml: entry.valueYaml, raw: entry.raw };
  });
  for (const key of Object.keys(parsed)) {
    if (!entries.some((entry) => entry.key === key || String(entry.key) === String(key))) {
      return { ok: false, ...propertyEditorSourceFailure("ambiguous", `Clipboard key “${key}” has no source entry — copy plain mappings.`) };
    }
  }
  return { ok: true, entries, lineEnding: wrapper.lineEnding, wrapped: wrapper.wrapped };
}

function propertyEditorSourceAssembleEntries(entries, sourceText, lineEnding) {
  const selected = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!selected.length) {
    return propertyEditorSourceFailure("empty", "Nothing is selected — mark rows before copying.");
  }
  const refused = selected.filter((entry) => entry.support === "unsupported");
  if (refused.length) {
    const names = refused.slice(0, 3).map((entry) => `“${entry.key}”`).join(", ");
    return {
      ...propertyEditorSourceFailure("unsupported", `Cannot copy opaque ${names} as YAML — y opens YAML.`),
      keys: refused.map((entry) => entry.key),
    };
  }
  const ending = lineEnding === "\r\n" ? "\r\n" : "\n";
  const flow = selected.every((entry) => entry.flow === true);
  if (flow) {
    const inners = selected.map((entry) => String(entry.rawInner || entry.raw || "").trim());
    return { ok: true, flow: true, yaml: `{${inners.join(", ")}}`, lineEnding: ending };
  }
  const raws = selected.map((entry) => {
    const text = typeof entry.raw === "string"
      ? entry.raw
      : String(sourceText == null ? "" : sourceText).slice(entry.start, entry.end);
    return String(text).replace(/(?:\r\n|\n)+$/, "");
  });
  const yaml = raws.join(ending);
  return { ok: true, flow: false, yaml, lineEnding: ending };
}

function propertyEditorSourceInventoryCorresponds(report, entries) {
  const rows = report && Array.isArray(report.properties) ? report.properties : null;
  if (!rows) return { ok: false, code: "report-unavailable" };
  const entryCounts = new Map();
  for (const entry of entries) entryCounts.set(entry.key, (entryCounts.get(entry.key) || 0) + 1);
  const reportCounts = new Map();
  for (const row of rows) {
    if (!row || typeof row.key !== "string") continue;
    reportCounts.set(row.key, (reportCounts.get(row.key) || 0) + 1);
  }
  if (entryCounts.size !== reportCounts.size) return { ok: false, code: "stale" };
  for (const [key, count] of entryCounts) {
    if (reportCounts.get(key) !== count) return { ok: false, code: "stale" };
  }
  const byKeyLine = new Map();
  for (const entry of entries) byKeyLine.set(`${entry.key}::${entry.line}`, true);
  for (const row of rows) {
    if (row && Number.isInteger(row.line) && row.line > 0 && typeof row.key === "string") {
      if (!byKeyLine.has(`${row.key}::${row.line}`)) return { ok: false, code: "stale" };
    }
  }
  return { ok: true };
}

async function propertyEditorReadSourceSnapshot(options = {}) {
  const path = propertyEditorSourceNormalizePath(options.path);
  if (!path) return { ok: false, ...propertyEditorSourceFailure("missing-path", "No note path — reopen the editor.") };
  const parseYaml = options.parseYaml;
  if (typeof parseYaml !== "function") {
    return { ok: false, ...propertyEditorSourceFailure("yaml-parser-unavailable", "YAML validation is unavailable — y opens YAML.") };
  }
  const readSource = options.readSource;
  const readReport = options.readReport;
  const getEditorContent = options.getEditorContent;
  const hasUnsaved = options.hasUnsaved === true
    || (typeof options.hasUnsaved === "function" ? options.hasUnsaved(path) : false);
  const isCancelled = typeof options.isCancelled === "function" ? options.isCancelled : () => false;
  const maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0
    ? options.maxRetries
    : PROPERTY_EDITOR_SOURCE_MAX_RETRIES;
  const reportPath = (report) => propertyEditorSourceNormalizePath(report && report.path);
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (isCancelled()) return { ok: false, ...propertyEditorSourceFailure("cancelled", "Read cancelled — retry the copy.") };
    let report = options.report || null;
    if (typeof readReport === "function") {
      try {
        const fresh = await readReport(path);
        if (fresh) report = fresh;
      } catch (_) {}
    }
    if (isCancelled()) return { ok: false, ...propertyEditorSourceFailure("cancelled", "Read cancelled — retry the copy.") };
    if (!report || !Array.isArray(report.properties)) {
      lastError = { ok: false, ...propertyEditorSourceFailure("report-unavailable", "No fresh property report — retry the copy.") };
      continue;
    }
    if (reportPath(report) && reportPath(report) !== path) {
      return { ok: false, ...propertyEditorSourceFailure("path-mismatch", "The note changed under the editor — reopen it.") };
    }
    let source = null;
    let editorSnapshot = false;
    if (hasUnsaved) {
      let editorText = null;
      if (typeof getEditorContent === "function") {
        try { editorText = await getEditorContent(path); } catch (_) { editorText = null; }
      }
      if (typeof editorText === "string") {
        const probe = propertyEditorSourceFragments(editorText, parseYaml);
        if (probe.ok && propertyEditorSourceInventoryCorresponds(report, probe.entries).ok) {
          source = editorText;
          editorSnapshot = true;
        } else {
          return {
            ok: false,
            ...propertyEditorSourceFailure(
              "unsaved",
              "Unsaved edits are open — save the note before retrying.",
              PROPERTY_EDITOR_SOURCE_SAVE_HINT,
            ),
          };
        }
      } else {
        return {
          ok: false,
          ...propertyEditorSourceFailure(
            "unsaved",
            "Unsaved edits are open — save the note before retrying.",
            PROPERTY_EDITOR_SOURCE_SAVE_HINT,
          ),
        };
      }
    } else {
      if (typeof readSource !== "function") {
        return { ok: false, ...propertyEditorSourceFailure("source-unavailable", "Note source is unavailable — retry the copy.") };
      }
      try {
        source = await readSource(path);
      } catch (_) {
        source = null;
      }
    }
    if (isCancelled()) return { ok: false, ...propertyEditorSourceFailure("cancelled", "Read cancelled — retry the copy.") };
    if (typeof source !== "string") {
      lastError = { ok: false, ...propertyEditorSourceFailure("source-unavailable", "Note source changed — retry the copy.") };
      continue;
    }
    const fragments = propertyEditorSourceFragments(source, parseYaml);
    if (!fragments.ok) {
      if ((fragments.code === "stale" || fragments.code === "ambiguous") && attempt < maxRetries) {
        lastError = fragments;
        continue;
      }
      return fragments;
    }
    const correspond = propertyEditorSourceInventoryCorresponds(report, fragments.entries);
    if (!correspond.ok) {
      lastError = {
        ok: false,
        ...propertyEditorSourceFailure("stale", "The note changed — save it and retry the copy.", PROPERTY_EDITOR_SOURCE_SAVE_HINT),
      };
      continue;
    }
    return {
      ok: true,
      path,
      source,
      entries: fragments.entries,
      lineEnding: fragments.lineEnding,
      flow: fragments.flow === true,
      yamlStart: fragments.yamlStart,
      yamlEnd: fragments.yamlEnd,
      editorSnapshot,
      fingerprint: report.fingerprint || report.fingerprint_after || null,
    };
  }
  return lastError || { ok: false, ...propertyEditorSourceFailure("stale", "The note changed — save it and retry the copy.") };
}
