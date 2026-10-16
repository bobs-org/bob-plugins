const ARTICLE_PLAN_SCHEMA_VERSION = 1;
const ARTICLE_BOB_TIMEOUT_MS = 1500;
const ARTICLE_BOB_MAX_OUTPUT = 16 * 1024 * 1024;
const ARTICLE_BOB_CANDIDATES = [
  ".cargo/bin/bob",
  ".local/bin/bob",
  "/opt/homebrew/bin/bob",
  "/usr/local/bin/bob",
];

function articleExpandHome(rawPath, home) {
  const value = typeof rawPath === "string" ? rawPath.trim() : "";
  if (value === "~") return home || value;
  if (value.startsWith("~/")) return home ? `${home}${value.slice(1)}` : value;
  return value;
}

function articleHomeDir(options = {}) {
  try {
    const osModule = options.osModule || require("os");
    const home = osModule && typeof osModule.homedir === "function" ? osModule.homedir() : "";
    if (typeof home === "string" && home.trim()) return home.replace(/\/$/, "") || "/";
  } catch (error) {
    // Use the process environment when the OS module is unavailable.
  }
  try {
    const env = options.env || (typeof process !== "undefined" ? process.env : {});
    return typeof env.HOME === "string" ? env.HOME.replace(/\/$/, "") : "";
  } catch (error) {
    return "";
  }
}

function articleBobCandidatePaths(home) {
  const base = typeof home === "string" ? home : "";
  return ARTICLE_BOB_CANDIDATES.map((entry) =>
    entry.startsWith("/") ? entry : base ? `${base}/${entry}` : "",
  ).filter(Boolean);
}

function articleResolveBobPath(configured, options = {}) {
  const home = options.home !== undefined ? options.home : articleHomeDir(options);
  const configPath = articleExpandHome(configured, home);
  if (configPath) return { path: configPath, source: "config" };
  let existsSync = options.existsSync;
  if (!existsSync) {
    try {
      const fs = require("fs");
      existsSync = (path) => fs.existsSync(path);
    } catch (error) {
      existsSync = () => false;
    }
  }
  for (const candidate of articleBobCandidatePaths(home)) {
    try {
      if (existsSync(candidate)) return { path: candidate, source: "candidate" };
    } catch (error) {
      // Try the next known install location.
    }
  }
  return { path: "bob", source: "path" };
}

function articleNormalizeType(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").trim().toLowerCase();
}

function articleHasArticleType(frontmatter) {
  if (!frontmatter || typeof frontmatter !== "object") return false;
  const type = frontmatter.type;
  const values = Array.isArray(type) ? type : [type];
  return values.some((value) => articleNormalizeType(value) === "article");
}

function articleDecodePlan(stdout) {
  let value;
  try {
    value = JSON.parse(String(stdout || ""));
  } catch (error) {
    return { ok: false, code: "bad-json", message: "bob returned invalid JSON." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "bad-shape", message: "bob returned an invalid article plan." };
  }
  if (value.schema_version !== ARTICLE_PLAN_SCHEMA_VERSION) {
    return { ok: false, code: "schema-mismatch", message: "bob returned an unsupported article plan version." };
  }
  if (!Array.isArray(value.notes) || value.notes.length !== 1) {
    return { ok: false, code: "bad-shape", message: "bob returned an article plan for the wrong number of notes." };
  }
  const note = value.notes[0];
  if (
    !note || typeof note !== "object" ||
    !["changed", "unchanged", "skipped", "error"].includes(note.status) ||
    !Array.isArray(note.edits) || !Array.isArray(note.inbound) ||
    !Array.isArray(note.findings)
  ) {
    return { ok: false, code: "bad-shape", message: "bob returned an incomplete article plan." };
  }
  return { ok: true, plan: note };
}

function articleSplitText(text) {
  const source = String(text || "");
  const lines = [];
  const separators = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\n" && source[index] !== "\r") continue;
    lines.push(source.slice(start, index));
    const separator = source[index] === "\r" && source[index + 1] === "\n" ? "\r\n" : source[index];
    separators.push(separator);
    if (separator.length === 2) index += 1;
    start = index + 1;
  }
  const trailingNewline = separators.length > 0 && start === source.length;
  const eol = separators[0] || "\n";
  if (start < source.length) lines.push(source.slice(start));
  else if (source.length === 0) return { lines: [], separators: [], trailingNewline: false, eol: "\n" };
  if (trailingNewline && lines.length === separators.length) separators.pop();
  return {
    lines,
    separators,
    trailingNewline,
    eol,
  };
}

function articleNormalizeEdits(edits) {
  const grouped = new Map();
  for (const edit of edits) {
    if (
      !edit || !Number.isInteger(edit.line) || edit.line < 1 ||
      !Number.isInteger(edit.delete) || edit.delete < 0 || !Array.isArray(edit.insert) ||
      !edit.insert.every((line) => typeof line === "string")
    ) throw new Error("bob returned an invalid line edit.");
    const key = edit.line;
    const current = grouped.get(key) || { line: key, delete: 0, insert: [] };
    current.delete += edit.delete;
    current.insert.push(...edit.insert);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((left, right) => left.line - right.line);
}

function articleApplyEditsToText(text, edits) {
  const split = articleSplitText(text);
  const lines = [...split.lines];
  const normalized = articleNormalizeEdits(edits);
  for (const edit of [...normalized].reverse()) {
    const index = edit.line - 1;
    if (index > lines.length || index + edit.delete > lines.length) {
      throw new Error("bob returned line edits outside the sent note.");
    }
    lines.splice(index, edit.delete, ...edit.insert);
  }
  return lines.join(split.eol) + (split.trailingNewline && lines.length ? split.eol : "");
}

function articleNarrowChange(from, to, oldText, newText) {
  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldText.length - prefix && suffix < newText.length - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) suffix += 1;
  return {
    from: from + prefix,
    to: to - suffix,
    insert: newText.slice(prefix, newText.length - suffix),
  };
}

function articleBuildChanges(text, edits) {
  const source = String(text || "");
  const split = articleSplitText(source);
  const starts = [];
  let offset = 0;
  for (let index = 0; index < split.lines.length; index += 1) {
    starts.push(offset);
    offset += split.lines[index].length;
    if (index < split.separators.length) offset += split.separators[index].length;
  }
  const changes = [];
  for (const edit of articleNormalizeEdits(edits)) {
    const index = edit.line - 1;
    if (index > split.lines.length || index + edit.delete > split.lines.length) {
      throw new Error("bob returned line edits outside the sent note.");
    }
    if (edit.delete === 0) {
      const insertion = edit.insert.join(split.eol);
      let at = source.length;
      let replacement = insertion;
      if (index < split.lines.length) {
        at = starts[index];
        replacement += split.eol;
      } else if (split.trailingNewline && source.length > 0) {
        const finalEol = split.separators[split.separators.length - 1] || split.eol;
        at = source.length - finalEol.length;
        replacement = `${split.eol}${insertion}`;
      } else if (split.lines.length > 0) {
        replacement = `${split.eol}${insertion}`;
      }
      changes.push(articleNarrowChange(at, at, "", replacement));
      continue;
    }
    let from = starts[index];
    const last = index + edit.delete - 1;
    let to = starts[last] + split.lines[last].length;
    if (edit.insert.length === 0 && last < split.lines.length - 1) {
      to += split.separators[last].length;
    } else if (
      edit.insert.length === 0 && last === split.lines.length - 1 &&
      !split.trailingNewline && index > 0
    ) {
      const precedingEol = split.separators[index - 1] || split.eol;
      from -= precedingEol.length;
    }
    const oldText = source.slice(from, to);
    const newText = edit.insert.join(split.eol);
    changes.push(articleNarrowChange(from, to, oldText, newText));
  }
  return changes.sort((left, right) => left.from - right.from || left.to - right.to);
}

function articleApplyChangesToText(text, changes) {
  let result = String(text || "");
  for (const change of [...changes].sort((left, right) => right.from - left.from)) {
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}

function articleNoticeText(plan) {
  const head = typeof plan.notice === "string" ? plan.notice : "Article formatted";
  const warnings = plan.findings.filter((finding) => {
    const severity = String(finding && finding.severity || "").toLowerCase();
    return severity === "warning" || severity === "warn";
  });
  if (warnings.length === 0) return head;
  const shown = warnings.slice(0, 2).map((finding) => finding.message || finding.code || "Article finding");
  if (warnings.length > shown.length) shown.push(`+${warnings.length - shown.length} more`);
  return `${head}\n${shown.join(" · ")}`;
}

function articleEditPreviewLines(text, edits) {
  const lines = articleSplitText(text).lines;
  const result = [];
  for (const edit of articleNormalizeEdits(edits)) {
    const start = edit.line - 1;
    if (start > 0) result.push({ kind: "context", text: lines[start - 1] });
    for (const line of lines.slice(edit.line - 1, edit.line - 1 + edit.delete)) {
      result.push({ kind: "remove", text: line });
    }
    for (const line of edit.insert) result.push({ kind: "add", text: line });
    const after = start + edit.delete;
    if (after < lines.length) result.push({ kind: "context", text: lines[after] });
    if (result.length === 0 || result[result.length - 1].kind !== "context") {
      result.push({ kind: "context", text: "…" });
    }
  }
  return result;
}
