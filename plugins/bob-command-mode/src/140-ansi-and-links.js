// Bob Command Mode: streaming ANSI parser, JSON pretty-print, vault linkifier,
// interleave replay, pager copy/search/keys. Pure helpers; the pager view
// mounts them. Never innerHTML, never Markdown.

const CM_PAGER_LINE_PX = 19;
const CM_ANSI_FG = {
  30: "var(--text-muted)",
  31: "var(--color-red)",
  32: "var(--color-green)",
  33: "var(--color-yellow, var(--color-orange))",
  34: "var(--color-blue, var(--text-accent))",
  35: "var(--color-purple, var(--text-accent))",
  36: "var(--color-cyan, var(--color-blue, var(--text-accent)))",
  37: "var(--text-normal)",
  90: "var(--text-muted)",
  91: "var(--color-red)",
  92: "var(--color-green)",
  93: "var(--color-yellow, var(--color-orange))",
  94: "var(--color-blue, var(--text-accent))",
  95: "var(--color-purple, var(--text-accent))",
  96: "var(--color-cyan, var(--color-blue, var(--text-accent)))",
  97: "var(--text-normal)",
};
const CM_ANSI_BG = {
  40: "var(--text-muted)",
  41: "var(--color-red)",
  42: "var(--color-green)",
  43: "var(--color-yellow, var(--color-orange))",
  44: "var(--color-blue, var(--text-accent))",
  45: "var(--color-purple, var(--text-accent))",
  46: "var(--color-cyan, var(--color-blue, var(--text-accent)))",
  47: "var(--text-normal)",
};

function cmDefaultAnsiStyle() {
  return { bold: false, dim: false, italic: false, underline: false, fg: null, bg: null, muted: false };
}

function cmAnsiStylesEqual(left, right) {
  if (!left || !right) return false;
  return left.bold === right.bold && left.dim === right.dim && left.italic === right.italic &&
    left.underline === right.underline && left.fg === right.fg && left.bg === right.bg &&
    left.muted === right.muted;
}

function cmCreateAnsiParser() {
  return { leftover: "", style: cmDefaultAnsiStyle() };
}

function cmAnsi256Color(index) {
  const n = Number(index);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 8) return CM_ANSI_FG[30 + n] || null;
  if (n < 16) return CM_ANSI_FG[90 + (n - 8)] || null;
  if (n >= 232) {
    const value = 8 + (n - 232) * 10;
    return "rgb(" + value + "," + value + "," + value + ")";
  }
  const cube = n - 16;
  const ramp = (part) => (part === 0 ? 0 : 55 + part * 40);
  const red = ramp(Math.floor(cube / 36));
  const green = ramp(Math.floor((cube % 36) / 6));
  const blue = ramp(cube % 6);
  return "rgb(" + red + "," + green + "," + blue + ")";
}

function cmApplySgr(style, params) {
  const next = { ...style };
  const codes = params.length ? params : [0];
  for (let index = 0; index < codes.length; index += 1) {
    const code = Number(codes[index]);
    if (!Number.isFinite(code) || code === 0) {
      next.bold = false;
      next.dim = false;
      next.italic = false;
      next.underline = false;
      next.fg = null;
      next.bg = null;
      next.muted = false;
      continue;
    }
    if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) { next.bold = false; next.dim = false; }
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 39) next.fg = null;
    else if (code === 49) next.bg = null;
    else if (CM_ANSI_FG[code]) next.fg = CM_ANSI_FG[code];
    else if (CM_ANSI_BG[code]) next.bg = CM_ANSI_BG[code];
    else if (code === 38 || code === 48) {
      const slot = code === 38 ? "fg" : "bg";
      const mode = Number(codes[index + 1]);
      if (mode === 5 && codes[index + 2] !== undefined) {
        next[slot] = cmAnsi256Color(codes[index + 2]);
        index += 2;
      } else if (mode === 2 && codes[index + 4] !== undefined) {
        const red = Math.max(0, Math.min(255, Number(codes[index + 2]) || 0));
        const green = Math.max(0, Math.min(255, Number(codes[index + 3]) || 0));
        const blue = Math.max(0, Math.min(255, Number(codes[index + 4]) || 0));
        next[slot] = "rgb(" + red + "," + green + "," + blue + ")";
        index += 4;
      } else {
        index += 1;
      }
    }
  }
  return next;
}

function cmConsumeEscape(text) {
  if (!text || text[0] !== "\u001b") return { length: 0, incomplete: false };
  if (text.length === 1) return { length: 1, incomplete: true };
  const second = text[1];
  if (second === "[") {
    let index = 2;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code >= 64 && code <= 126) {
        const final = text[index];
        const body = text.slice(2, index);
        const params = final === "m"
          ? body.split(";").map((part) => (part === "" ? 0 : Number(part)))
          : [];
        return { length: index + 1, incomplete: false, sgr: final === "m", params };
      }
      index += 1;
    }
    return { length: text.length, incomplete: true };
  }
  if (second === "]") {
    for (let index = 2; index < text.length; index += 1) {
      if (text[index] === "\u0007") return { length: index + 1, incomplete: false };
      if (text[index] === "\u001b" && text[index + 1] === "\\") return { length: index + 2, incomplete: false };
    }
    return { length: text.length, incomplete: true };
  }
  if (second === "(" || second === ")") {
    if (text.length < 3) return { length: text.length, incomplete: true };
    return { length: 3, incomplete: false };
  }
  return { length: 2, incomplete: false };
}

function cmPushAnsiNode(nodes, text, style) {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last && cmAnsiStylesEqual(last.style, style)) last.text += text;
  else nodes.push({ text, style: { ...style } });
}

function cmParseAnsiChunk(parser, chunk) {
  const source = String((parser && parser.leftover) || "") + String(chunk || "");
  if (parser) parser.leftover = "";
  const nodes = [];
  let current = "";
  let index = 0;
  const styleOf = () => (parser && parser.style) || cmDefaultAnsiStyle();
  const flush = () => {
    cmPushAnsiNode(nodes, current, styleOf());
    current = "";
  };
  while (index < source.length) {
    if (source[index] === "\u001b") {
      const consumed = cmConsumeEscape(source.slice(index));
      if (consumed.incomplete) {
        if (parser) parser.leftover = source.slice(index);
        break;
      }
      flush();
      if (consumed.sgr && parser) parser.style = cmApplySgr(parser.style, consumed.params || []);
      index += consumed.length;
      continue;
    }
    current += source[index];
    index += 1;
  }
  flush();
  return nodes;
}

function cmParseAnsi(text) {
  const parser = cmCreateAnsiParser();
  return cmParseAnsiChunk(parser, text);
}

function cmAnsiStyleToCss(style) {
  if (!style) return "";
  const parts = [];
  if (style.bold) parts.push("font-weight:700");
  if (style.dim) parts.push("opacity:0.7");
  if (style.italic) parts.push("font-style:italic");
  if (style.underline) parts.push("text-decoration:underline");
  if (style.fg) parts.push("color:" + style.fg);
  if (style.bg) parts.push("background-color:" + style.bg);
  if (style.muted) parts.push("color:var(--text-muted)");
  return parts.join(";");
}

function cmNormalizePagerNewlines(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function cmBufferFrom(value) {
  if (value == null) {
    if (typeof Buffer !== "undefined" && typeof Buffer.alloc === "function") return Buffer.alloc(0);
    return { length: 0, slice() { return ""; }, subarray() { return ""; }, toString() { return ""; } };
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(value)) return value;
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") return Buffer.from(String(value), "utf8");
  const text = String(value);
  return {
    length: text.length,
    slice(start, end) { return text.slice(start, end); },
    subarray(start, end) { return text.slice(start, end); },
    toString() { return text; },
  };
}

function cmReplayInterleave(stdoutValue, stderrValue, interleave) {
  const stdout = cmBufferFrom(stdoutValue);
  const stderr = cmBufferFrom(stderrValue);
  const chunks = [];
  let outOff = 0;
  let errOff = 0;
  const pairs = Array.isArray(interleave) ? interleave : [];
  const take = (buffer, offset, count, stream) => {
    const end = Math.min(buffer.length, offset + Math.max(0, count));
    const slice = typeof buffer.subarray === "function" ? buffer.subarray(offset, end) : buffer.slice(offset, end);
    const text = typeof slice.toString === "function" ? slice.toString("utf8") : String(slice);
    if (text) chunks.push({ stream, text: cmNormalizePagerNewlines(text) });
    return end;
  };
  for (const pair of pairs) {
    const stream = pair && pair[0];
    const count = Number(pair && pair[1]) || 0;
    if (stream === "out") outOff = take(stdout, outOff, count, "out");
    else if (stream === "err") errOff = take(stderr, errOff, count, "err");
  }
  if (outOff < stdout.length) take(stdout, outOff, stdout.length - outOff, "out");
  if (errOff < stderr.length) take(stderr, errOff, stderr.length - errOff, "err");
  return chunks;
}

function cmTryParseJsonBody(text) {
  const source = cmStripAnsi(text).trim();
  if (!source || (source[0] !== "{" && source[0] !== "[")) return null;
  try {
    const value = JSON.parse(source);
    if (value === null || typeof value !== "object") return null;
    return value;
  } catch (error) {
    return null;
  }
}

function cmJsonPrettyNodes(value) {
  const nodes = [];
  const push = (text, kind) => {
    if (!text) return;
    const style = kind === "key" ? { ...cmDefaultAnsiStyle(), muted: true } : cmDefaultAnsiStyle();
    const last = nodes[nodes.length - 1];
    if (last && last.kind === kind && cmAnsiStylesEqual(last.style, style)) last.text += text;
    else nodes.push({ text, style, kind });
  };
  const walk = (item, level) => {
    const pad = "  ".repeat(level);
    if (item !== null && typeof item === "object") {
      const isArray = Array.isArray(item);
      const entries = isArray
        ? item.map((entry, index) => [index, entry])
        : Object.keys(item).map((key) => [key, item[key]]);
      push(isArray ? "[" : "{", "punct");
      if (!entries.length) {
        push(isArray ? "]" : "}", "punct");
        return;
      }
      push("\n", "punct");
      entries.forEach(([key, entry], index) => {
        push(pad + "  ", "punct");
        if (!isArray) {
          push(JSON.stringify(String(key)), "key");
          push(": ", "punct");
        }
        walk(entry, level + 1);
        if (index < entries.length - 1) push(",", "punct");
        push("\n", "punct");
      });
      push(pad + (isArray ? "]" : "}"), "punct");
      return;
    }
    if (typeof item === "string") push(JSON.stringify(item), "string");
    else if (typeof item === "number" || typeof item === "boolean") push(String(item), "value");
    else push("null", "value");
  };
  walk(value, 0);
  return nodes;
}

function cmMaybePrettyJsonChunks(chunks) {
  const list = Array.isArray(chunks) ? chunks : [];
  const stdout = list.filter((chunk) => chunk && chunk.stream === "out").map((chunk) => chunk.text).join("");
  const parsed = cmTryParseJsonBody(stdout);
  if (!parsed) return list;
  const stderr = list.filter((chunk) => chunk && chunk.stream === "err");
  return [{ stream: "out", nodes: cmJsonPrettyNodes(parsed) }, ...stderr];
}

function cmResolveLinkTarget(app, linkpath) {
  const pathOnly = String(linkpath || "").split("#")[0];
  if (!pathOnly) return null;
  try {
    const vault = app && app.vault;
    if (vault && typeof vault.getAbstractFileByPath === "function") {
      const file = vault.getAbstractFileByPath(pathOnly);
      if (file) return { path: file.path || pathOnly, file };
    }
  } catch (error) {
    // Vault lookup is best effort.
  }
  try {
    const cache = app && app.metadataCache;
    if (cache && typeof cache.getFirstLinkpathDest === "function") {
      const dest = cache.getFirstLinkpathDest(pathOnly, "");
      if (dest) return { path: dest.path || pathOnly, file: dest };
    }
  } catch (error) {
    // Cache lookup is best effort.
  }
  return null;
}

function cmPushLinkSpan(spans, span, app) {
  if (!span || span.end <= span.start) return;
  const resolved = cmResolveLinkTarget(app, span.linkpath);
  if (!resolved) return;
  spans.push({ ...span, path: resolved.path });
}

function cmFindWikiLinkSpans(text, app) {
  const spans = [];
  const regex = /\[\[([^\]|#\n]+)(?:#([^|\]]+))?(?:\|([^\]]+))?\]\]/g;
  let match;
  while ((match = regex.exec(String(text || "")))) {
    const target = match[1] + (match[2] ? "#" + match[2] : "");
    cmPushLinkSpan(spans, {
      start: match.index,
      end: match.index + match[0].length,
      text: match[3] || match[0],
      linkpath: target,
      href: target,
      line: null,
      kind: "wiki",
    }, app);
  }
  return spans;
}

function cmFindMdPathSpans(text, app) {
  const spans = [];
  const regex = /(?<![A-Za-z0-9_./-])((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.md)(?::(\d+)|(#[^\s\]|]+))?/g;
  let match;
  while ((match = regex.exec(String(text || "")))) {
    const line = match[2] ? Number(match[2]) : null;
    const hash = match[3] || "";
    cmPushLinkSpan(spans, {
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      linkpath: match[1],
      href: match[1] + hash,
      line: Number.isFinite(line) ? line : null,
      kind: "path",
    }, app);
  }
  return spans;
}

function cmFindAbsolutePathSpans(text, app, vaultBase) {
  const prefix = String(vaultBase || "").replace(/\/+$/, "");
  if (!prefix) return [];
  const spans = [];
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped + "/((?:[^\\s]+/)*[^\\s]+\\.md)(?::(\\d+)|(#[^\\s\\]|]+))?", "g");
  let match;
  while ((match = regex.exec(String(text || "")))) {
    const line = match[2] ? Number(match[2]) : null;
    const hash = match[3] || "";
    cmPushLinkSpan(spans, {
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      linkpath: match[1],
      href: match[1] + hash,
      line: Number.isFinite(line) ? line : null,
      kind: "absolute",
    }, app);
  }
  return spans;
}

function cmFindLinkSpans(text, options = {}) {
  const source = String(text || "");
  const app = options.app || null;
  const combined = [
    ...cmFindWikiLinkSpans(source, app),
    ...cmFindAbsolutePathSpans(source, app, options.vaultBase),
    ...cmFindMdPathSpans(source, app),
  ].sort((left, right) => left.start - right.start || right.end - left.end);
  const spans = [];
  let cursor = 0;
  for (const span of combined) {
    if (span.start < cursor) continue;
    spans.push(span);
    cursor = span.end;
  }
  return spans;
}

function cmLinkifyAnsiNodes(nodes, options = {}) {
  const result = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const text = String(node.text || "");
    const spans = cmFindLinkSpans(text, options);
    if (!spans.length) {
      result.push({ ...node });
      continue;
    }
    let cursor = 0;
    for (const span of spans) {
      if (span.start > cursor) result.push({ text: text.slice(cursor, span.start), style: node.style });
      result.push({
        text: text.slice(span.start, span.end),
        style: node.style,
        href: span.href,
        path: span.path,
        line: span.line,
      });
      cursor = span.end;
    }
    if (cursor < text.length) result.push({ text: text.slice(cursor), style: node.style });
  }
  return result;
}

function cmDecoratePagerChunks(chunks, options = {}) {
  const pretty = cmMaybePrettyJsonChunks(chunks);
  return pretty.map((chunk) => {
    if (chunk.nodes) {
      return { stream: chunk.stream || "out", nodes: cmLinkifyAnsiNodes(chunk.nodes, options) };
    }
    const parser = cmCreateAnsiParser();
    const ansi = cmParseAnsiChunk(parser, chunk.text || "");
    return { stream: chunk.stream || "out", nodes: cmLinkifyAnsiNodes(ansi, options) };
  });
}

function cmPagerVisibleText(chunks) {
  const parts = [];
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    if (Array.isArray(chunk.nodes)) {
      for (const node of chunk.nodes) parts.push(node.text || "");
    } else {
      parts.push(chunk.text || "");
    }
  }
  return parts.join("");
}

function cmPagerCopyOutput(chunks) {
  return cmStripAnsi(cmPagerVisibleText(chunks));
}

function cmPagerDisplayArgv(record) {
  return cmFormatArgv(["bob", ...cmRecordArgs(record)]);
}

function cmPagerCopyCommand(record) {
  return cmPagerDisplayArgv(record);
}

function cmFormatStartTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return cmPad2(date.getHours()) + ":" + cmPad2(date.getMinutes()) + ":" + cmPad2(date.getSeconds());
}

function cmPagerStatusMeta(record, nowMs = Date.now(), queuedBehind = "") {
  const outcome = record && record.outcome ? record.outcome : "unknown";
  const exitLabel = typeof (record && record.exit_code) === "number" ? "exit " + record.exit_code : "";
  const started = Date.parse(record && record.started_at);
  const elapsed = Number.isFinite(started) ? Math.max(0, nowMs - started) : 0;
  if (outcome === "running") {
    return { glyph: "●", text: "running " + cmFormatClock(elapsed), className: "is-running" };
  }
  if (outcome === "queued") {
    const behind = queuedBehind ? "queued behind " + queuedBehind : "queued";
    return { glyph: "⧗", text: behind, className: "is-queued" };
  }
  if (outcome === "completed") {
    return { glyph: "✓", text: "completed · " + cmFormatDuration(record.duration_ms), className: "is-completed" };
  }
  if (outcome === "attention") {
    return { glyph: "◐", text: ["needs attention", exitLabel].filter(Boolean).join(" · "), className: "is-attention" };
  }
  if (outcome === "failed") {
    return { glyph: "✗", text: ["failed", exitLabel].filter(Boolean).join(" · "), className: "is-failed" };
  }
  if (outcome === "stopped") {
    return { glyph: "■", text: "stopped", className: "is-stopped" };
  }
  return { glyph: "?", text: "unknown", className: "is-unknown" };
}

function cmFindSearchMatches(text, query) {
  const source = String(text || "");
  const needle = String(query || "");
  if (!needle) return [];
  const matches = [];
  let from = 0;
  while (from <= source.length) {
    const index = source.indexOf(needle, from);
    if (index < 0) break;
    matches.push({ start: index, end: index + needle.length });
    from = index + Math.max(1, needle.length);
  }
  return matches;
}

function cmPagerHistoryIds(records) {
  return (Array.isArray(records) ? records : [])
    .map((record) => record && record.id)
    .filter(Boolean)
    .slice()
    .reverse();
}

function cmPagerHistoryState(records, runId) {
  const ids = cmPagerHistoryIds(records);
  const index = ids.indexOf(runId);
  return {
    ids,
    index,
    total: ids.length,
    label: index >= 0 && ids.length ? (index + 1) + " of " + ids.length : "",
    olderId: index >= 0 ? ids[index + 1] || null : null,
    newerId: index >= 0 ? ids[index - 1] || null : null,
  };
}

function cmPagerApplyScroll(scroll, action) {
  const view = Math.max(0, Number(scroll && scroll.view) || 0);
  const height = Math.max(0, Number(scroll && scroll.height) || 0);
  const max = Math.max(0, height - view);
  const half = Math.max(CM_PAGER_LINE_PX, Math.floor(view / 2) || CM_PAGER_LINE_PX * 8);
  let top = Number(scroll && scroll.top) || 0;
  if (action.delta === "line") top += action.dir * CM_PAGER_LINE_PX;
  else if (action.delta === "half") top += action.dir * half;
  else if (action.delta === "home") top = 0;
  else if (action.delta === "end") top = max;
  return Math.max(0, Math.min(max, top));
}

function cmDefaultPagerSearch() {
  return { mode: "off", query: "", matches: [], current: -1 };
}

function cmHandlePagerKey(event, state = {}) {
  if (!event) return { type: "none" };
  if (event.altKey) return { type: "none" };
  const key = event.key;
  const ctrl = Boolean(event.ctrlKey);
  const meta = Boolean(event.metaKey);
  const search = state.search || cmDefaultPagerSearch();
  if (search.mode === "editing") {
    if (key === "Escape") return { type: "search-cancel" };
    if (key === "Enter") return { type: "search-commit" };
    if (key === "Backspace") return { type: "search-backspace" };
    if (!ctrl && !meta && key.length === 1) return { type: "search-type", char: key };
    return { type: "none" };
  }
  if (state.stopConfirm) {
    if (key === "y" || key === "Y" || key === "Enter") return { type: "stop" };
    if (key === "Escape" || key === "n" || key === "N") return { type: "stop-cancel" };
    if (key === "q") return { type: "close" };
  }
  if ((ctrl || meta) && (key === "c" || key === "C")) {
    if (state.hasSelection) return { type: "none" };
    return { type: "stop-request" };
  }
  if (ctrl || meta) return { type: "none" };
  if (search.mode === "idle") {
    if (key === "n") return { type: "search-next" };
    if (key === "N") return { type: "search-prev" };
    if (key === "Escape") return { type: "search-cancel" };
  }
  switch (key) {
    case "j": return { type: "scroll", delta: "line", dir: 1 };
    case "k": return { type: "scroll", delta: "line", dir: -1 };
    case "d": return { type: "scroll", delta: "half", dir: 1 };
    case "u": return { type: "scroll", delta: "half", dir: -1 };
    case "g": return { type: "scroll", delta: "home" };
    case "G": return { type: "scroll", delta: "end" };
    case "/": return { type: "search-start" };
    case "w": return { type: "wrap" };
    case "y": return { type: "copy-output" };
    case "Y": return { type: "copy-command" };
    case "r": return { type: "rerun" };
    case "[": return { type: "history", dir: 1 };
    case "]": return { type: "history", dir: -1 };
    case ":": return { type: "back" };
    case "Escape": return { type: "escape" };
    case "q": return { type: "close" };
    default: return { type: "none" };
  }
}
