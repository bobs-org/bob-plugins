// --- Keep-moving marks: pure post-close offer model -----------------------
// Mirrors the task-status-cycler successor planner for a managed Done of X.
// All reads arrive through ctx; this code is synchronous, display-only, and
// keeps unknown inputs distinct from a proven zero.

const KEEP_MOVING_MARK_MAX_PARENT_DEPTH = 16;
const KEEP_MOVING_MARK_OPEN = new Set(["?", " ", "*", "/"]);
const KEEP_MOVING_MARK_LANES = { "/": 0, "*": 1, " ": 2 };
const KEEP_MOVING_MARK_EXCLUDED_PATHS = new Set([
  ".git", ".obsidian", "_conflicts", "_generated", "_templates", "done",
]);

function keepMovingMarkFencedLines(lines) {
  const fenced = new Set();
  let opening = null;
  for (let line = 0; line < lines.length; line += 1) {
    const text = String(lines[line] || "");
    if (!opening) {
      const match = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (match) {
        opening = { marker: match[1][0], length: match[1].length };
        fenced.add(line);
      }
      continue;
    }
    fenced.add(line);
    const close = text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
    if (close && close[1][0] === opening.marker && close[1].length >= opening.length) {
      opening = null;
    }
  }
  return fenced;
}

function keepMovingMarkPath(value) {
  try {
    const path = typeof value === "string" ? value : value && value.path;
    const normalized = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
    return typeof normalizeDependencyMarkdownPath === "function"
      ? normalizeDependencyMarkdownPath(normalized)
      : normalized;
  } catch (error) {
    return "";
  }
}

function keepMovingMarkPathIsIndexed(value) {
  const path = keepMovingMarkPath(value);
  if (!path || path === "dash.md") return false;
  if (typeof isCanonicalDailyNotePath === "function" && isCanonicalDailyNotePath(path)) return false;
  return !path.split("/").some((part) => KEEP_MOVING_MARK_EXCLUDED_PATHS.has(part));
}

function keepMovingMarkFrontmatter(ctx, path, text) {
  try {
    if (ctx && typeof ctx.frontmatterFor === "function") {
      const value = ctx.frontmatterFor(path);
      if (value && typeof value === "object") {
        return value.frontmatter && typeof value.frontmatter === "object"
          ? value.frontmatter
          : value;
      }
    }
  } catch (error) {
    return null;
  }
  try {
    const source = String(text || "");
    const match = source.match(/^\s*---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match || typeof parseYaml !== "function") return null;
    const parsed = parseYaml(match[1]);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

function keepMovingMarkStrings(value, into = []) {
  if (typeof value === "string") {
    if (value.trim()) into.push(value.trim());
  } else if (Array.isArray(value)) {
    for (const item of value) keepMovingMarkStrings(item, into);
  }
  return into;
}

function keepMovingMarkTypeIsProject(frontmatter) {
  try {
    const values = keepMovingMarkStrings(frontmatter && frontmatter.type);
    return values.some((value) => {
      const link = value.match(/^\[\[([^\]]+)\]\]$/);
      const name = (link ? link[1] : value).split("|")[0].split("#")[0]
        .replace(/^\[+|\]+$/g, "").trim().toLowerCase();
      return name === "project";
    });
  } catch (error) {
    return false;
  }
}

function keepMovingMarkTypeName(frontmatter) {
  const values = keepMovingMarkStrings(frontmatter && frontmatter.type).map((value) => {
    const link = value.match(/^\[\[([^\]]+)\]\]$/);
    return (link ? link[1] : value).split("|")[0].split("#")[0]
      .replace(/^\[+|\]+$/g, "").trim().toLowerCase();
  });
  return values.includes("area") ? "area" : values.includes("project") ? "project" : "other";
}

function keepMovingMarkRootFlag(frontmatter) {
  const value = frontmatter && frontmatter.root;
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

function keepMovingMarkParentTarget(frontmatter) {
  try {
    const value = frontmatter && frontmatter.parent;
    let raw = "";
    if (typeof value === "string") {
      raw = value;
    } else if (Array.isArray(value) && value.length === 1 && Array.isArray(value[0]) &&
        value[0].length === 1 && typeof value[0][0] === "string") {
      raw = value[0][0];
    }
    const match = raw.trim().match(/^\[\[([^\]]+)\]\]$/);
    return match ? match[1].split("|")[0].split("#")[0].trim() : "";
  } catch (error) {
    return "";
  }
}

function keepMovingMarkResolveParent(target, sourcePath, ctx) {
  try {
    const raw = String(target || "").trim().replace(/\\/g, "/");
    if (!raw || raw.split("/").some((part) => part === "." || part === "..")) return null;
    const pathsRaw = ctx && typeof ctx.markdownPaths === "function" ? ctx.markdownPaths() :
      ctx && Array.isArray(ctx.markdownPaths) ? ctx.markdownPaths : [];
    const paths = [...new Set(pathsRaw.map(keepMovingMarkPath).filter(keepMovingMarkPathIsIndexed))];
    if (!raw.includes("/") && paths.length) {
      const stem = raw.split("/").pop().replace(/\.md$/i, "").toLowerCase();
      const matches = paths.filter((path) =>
        path.split("/").pop().replace(/\.md$/i, "").toLowerCase() === stem,
      );
      if (matches.length > 1) return null;
    }
    if (ctx && typeof ctx.resolveLinkpath === "function") {
      const result = ctx.resolveLinkpath(raw, sourcePath);
      const resolved = keepMovingMarkPath(result);
      if (resolved && keepMovingMarkPathIsIndexed(resolved) && resolved !== keepMovingMarkPath(sourcePath)) {
        return resolved;
      }
      if (result) return null;
    }
    const candidate = keepMovingMarkPath(/\.md$/i.test(raw) ? raw : raw + ".md");
    if (paths.includes(candidate)) return candidate;
    if (!raw.includes("/")) {
      const stem = raw.split("/").pop().replace(/\.md$/i, "").toLowerCase();
      const matches = paths.filter((path) =>
        path.split("/").pop().replace(/\.md$/i, "").toLowerCase() === stem,
      );
      if (matches.length === 1 && matches[0] !== keepMovingMarkPath(sourcePath)) return matches[0];
    }
    return null;
  } catch (error) {
    return null;
  }
}

function keepMovingMarkStatus(line, lineNumber) {
  try {
    if (typeof getTaskStatusForLine === "function") {
      const status = getTaskStatusForLine(String(line || ""), lineNumber || 0);
      return status ? String(status.symbol || "") : "";
    }
  } catch (error) {
    // Use the compact fallback below.
  }
  const match = String(line || "").match(/^\s*(?:[-*+]|\d+[.)])\s+\[([^\]\n])\]/);
  return match ? match[1] : "";
}

function keepMovingMarkIsTaskLine(line) {
  try {
    return typeof lineMatchesTasksGlobalFilterText === "function"
      ? lineMatchesTasksGlobalFilterText(String(line || ""))
      : /(^|[^A-Za-z0-9_/#-])#task(?=$|[^A-Za-z0-9_-])/.test(String(line || ""));
  } catch (error) {
    return false;
  }
}

function keepMovingMarkIsRefLine(line) {
  return /(^|[^A-Za-z0-9_\/#-])#ref(?=$|[^A-Za-z0-9_-])/.test(String(line || ""));
}

function keepMovingMarkHasTag(text, tag) {
  try {
    const source = String(text || "");
    const escaped = String(tag || "").replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[\\s([{])" + escaped + "(?=$|[\\s)\\]},.;:!?])").test(source);
  } catch (error) {
    return false;
  }
}

function keepMovingMarkTaskMetadata(line) {
  try {
    if (typeof parseTaskDependencyMetadata === "function") return parseTaskDependencyMetadata(line);
  } catch (error) {
    // An unparsed field is unknown metadata, not a rendering failure.
  }
  const source = String(line || "");
  const id = source.match(/\[id::\s*([^\]]+)\]/);
  const deps = source.match(/\[dependsOn::\s*([^\]]+)\]/);
  return {
    taskId: id ? id[1].trim() : null,
    dependsOn: deps ? deps[1].split(",").map((value) => value.trim()).filter(Boolean) : [],
  };
}

function keepMovingMarkScheduledMatches(line) {
  try {
    if (typeof findScheduledFieldMatches === "function") return findScheduledFieldMatches(line);
  } catch (error) {
    return [];
  }
  const matches = [];
  const re = /\[scheduled::\s*([^\]]+)\]/g;
  let match;
  while ((match = re.exec(String(line || ""))) !== null) {
    matches.push({ value: match[1].trim(), start: match.index, end: re.lastIndex });
  }
  return matches;
}

function keepMovingMarkValidDate(value) {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 ||
      date.getDate() !== Number(match[3])) return null;
  return text;
}

function keepMovingMarkTaskRows(path, text) {
  try {
    const lines = String(text || "").split(/\r?\n/);
    const fenced = keepMovingMarkFencedLines(lines);
    const rows = [];
    for (let line = 0; line < lines.length; line += 1) {
      const rawLine = String(lines[line] || "");
      if (fenced.has(line) || /^\s*>/.test(rawLine)) continue;
      const status = keepMovingMarkStatus(rawLine, line);
      if (!status || (!keepMovingMarkIsTaskLine(rawLine) && !keepMovingMarkIsRefLine(rawLine))) continue;
      const blockId = typeof getTrailingBlockId === "function"
        ? String(getTrailingBlockId(rawLine) || "")
        : String((rawLine.match(/\s\^([A-Za-z0-9-]+)\s*$/) || [])[1] || "");
      const meta = keepMovingMarkTaskMetadata(rawLine);
      const scheduled = keepMovingMarkScheduledMatches(rawLine);
      rows.push({
        path: keepMovingMarkPath(path),
        line,
        status,
        blockId,
        taskId: meta.taskId || null,
        dependsOn: Array.isArray(meta.dependsOn) ? meta.dependsOn.map(String) : [],
        text: rawLine,
        rawLine,
        isTask: keepMovingMarkIsTaskLine(rawLine),
        isReference: !keepMovingMarkIsTaskLine(rawLine) && keepMovingMarkIsRefLine(rawLine),
        hide: keepMovingMarkHasTag(rawLine, "#hide"),
        projectBlocked: keepMovingMarkHasTag(rawLine, "#prj_is_blocked"),
        scheduled: scheduled.length === 1 ? keepMovingMarkValidDate(scheduled[0].value) : null,
        scheduledCount: scheduled.length,
      });
    }
    return rows;
  } catch (error) {
    return [];
  }
}

function keepMovingMarkFrontmatterSchedule(text, frontmatter) {
  const lines = String(text || "").split(/\r?\n/);
  if (!/^\s*---\s*$/.test(lines[0] || "")) return { count: 0, value: null, valid: true };
  let count = 0;
  for (let line = 1; line < lines.length; line += 1) {
    if (/^\s*---\s*$/.test(lines[line])) break;
    if (/^scheduled\s*:/.test(lines[line])) count += 1;
  }
  if (!count) return { count: 0, value: null, valid: true };
  const value = keepMovingMarkValidDate(frontmatter && frontmatter.scheduled);
  return { count, value, valid: count === 1 && Boolean(value) };
}

function keepMovingMarkParseProject(path, text, ctx = {}) {
  try {
    const projectPath = keepMovingMarkPath(path);
    const source = typeof text === "string" ? text : "";
    if (!projectPath || !source || !keepMovingMarkPathIsIndexed(projectPath)) return null;
    const base = projectPath.split("/").pop().toLowerCase();
    if (["inbox.md", "mac_inbox.md", "gkeep_inbox.md"].includes(base)) return null;
    const frontmatter = keepMovingMarkFrontmatter(ctx, projectPath, source);
    if (!keepMovingMarkTypeIsProject(frontmatter)) return null;
    const terminal = String(frontmatter && frontmatter.status || "").trim().toLowerCase();
    if (["done", "canceled", "cancelled"].includes(terminal)) return null;
    const lines = source.split(/\r?\n/);
    const fenced = keepMovingMarkFencedLines(lines);
    const anchors = [];
    for (let line = 0; line < lines.length; line += 1) {
      const raw = String(lines[line] || "").replace(/[ \t]+$/, "");
      if (!fenced.has(line) && (raw === "^prj" || raw.endsWith(" ^prj") || raw.endsWith("\t^prj"))) {
        anchors.push(line);
      }
    }
    if (anchors.length !== 1) return null;
    const rows = keepMovingMarkTaskRows(projectPath, source);
    const allPrj = rows.filter((row) => row.blockId === "prj");
    if (allPrj.length !== 1 || allPrj[0].line !== anchors[0] || !allPrj[0].isTask ||
        !KEEP_MOVING_MARK_OPEN.has(allPrj[0].status)) return null;
    const root = allPrj[0];
    if (root.scheduledCount > 1 || (root.scheduledCount === 1 && !root.scheduled)) return null;
    const fmSchedule = keepMovingMarkFrontmatterSchedule(source, frontmatter);
    if (!fmSchedule.valid) return null;
    return {
      path: projectPath,
      text: source,
      stem: base.replace(/\.md$/i, ""),
      frontmatter,
      root,
      residents: rows.filter((row) => row !== root),
      scheduled: fmSchedule.count > 0 ? fmSchedule.value : root.scheduled,
    };
  } catch (error) {
    return null;
  }
}

function keepMovingMarkLeafProject(path, text, ctx = {}) {
  try {
    const project = keepMovingMarkParseProject(path, text, ctx);
    if (!project || keepMovingMarkTypeName(project.frontmatter) !== "project") return false;
    if (keepMovingMarkRootFlag(project.frontmatter)) return false;
    const seen = new Set([project.path]);
    let currentPath = project.path;
    for (let depth = 1; depth < KEEP_MOVING_MARK_MAX_PARENT_DEPTH; depth += 1) {
      const currentText = currentPath === project.path ? project.text :
        (ctx && typeof ctx.noteTextFor === "function" ? ctx.noteTextFor(currentPath) : "");
      const currentFrontmatter = keepMovingMarkFrontmatter(ctx, currentPath, currentText);
      const target = keepMovingMarkParentTarget(currentFrontmatter);
      if (!target) return false;
      const parentPath = keepMovingMarkResolveParent(target, currentPath, ctx);
      if (!parentPath) return false;
      if (seen.has(parentPath)) return true;
      const parentText = ctx && typeof ctx.noteTextFor === "function" ? ctx.noteTextFor(parentPath) : "";
      const parentFrontmatter = keepMovingMarkFrontmatter(ctx, parentPath, parentText);
      if (!parentFrontmatter) return false;
      const parentType = keepMovingMarkTypeName(parentFrontmatter);
      if (parentType === "area") return false;
      if (parentType === "project") return true;
      seen.add(parentPath);
      currentPath = parentPath;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function keepMovingMarkLinkTarget(linkInner) {
  const raw = String(linkInner || "").split("|")[0].trim();
  const match = /^(.*?)#\^([A-Za-z0-9-]+)$/.exec(raw);
  return match ? { pathPart: match[1].trim().replace(/\.md$/i, ""), blockId: match[2] } : null;
}

function keepMovingMarkParseLiveLink(lineText) {
  try {
    let line = String(lineText || "");
    const marker = line.match(/^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)/);
    if (!marker) return null;
    line = line.slice(marker[0].length).trim();
    line = line.replace(/^(?:🍅[ \t]*)+/, "");
    if (typeof isTaskLinkExclusionLine === "function" && isTaskLinkExclusionLine(lineText)) return null;
    const match = /^(!)?\[\[([^\]\n]+)\]\][ \t]*(?:#[ \t]*)?$/.exec(line);
    if (!match) return null;
    const target = keepMovingMarkLinkTarget(match[2]);
    if (!target) return null;
    return { ...target, embedded: Boolean(match[1]) };
  } catch (error) {
    return null;
  }
}

function keepMovingMarkLiveLinks(content) {
  try {
    const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
    const section = typeof findPomodorosSection === "function"
      ? findPomodorosSection(lines)
      : null;
    if (!section) return [];
    const fenced = keepMovingMarkFencedLines(lines);
    const links = [];
    for (let entryLine = section.startLine; entryLine <= section.endLine; entryLine += 1) {
      const entryText = String(lines[entryLine] || "");
      if (typeof isTopLevelTaskLine === "function" && !isTopLevelTaskLine(entryText)) continue;
      if (/^[ \t]/.test(entryText) || keepMovingMarkStatus(entryText, entryLine) !== " ") continue;
      const parts = typeof parsePomodoroEntryLineParts === "function"
        ? parsePomodoroEntryLineParts(entryText)
        : true;
      if (!parts) continue;
      let end = entryLine + 1;
      while (end <= section.endLine) {
        const child = String(lines[end] || "");
        if (!child.trim() || !/^[ \t]+(?:[-*+]|\d+[.)])[ \t]+/.test(child)) break;
        end += 1;
      }
      for (let line = entryLine + 1; line < end; line += 1) {
        if (fenced.has(line)) continue;
        const link = keepMovingMarkParseLiveLink(lines[line]);
        if (link) links.push({ line, ...link });
      }
      entryLine = Math.max(entryLine, end - 1);
    }
    return links;
  } catch (error) {
    return [];
  }
}

function keepMovingMarkLinkMatchesIdentity(link, identity, dailyPath) {
  try {
    if (!link || !identity || !link.blockId || !identity.blockId ||
        String(link.blockId) !== String(identity.blockId)) return false;
    const target = keepMovingMarkPath(link.pathPart || "");
    const path = keepMovingMarkPath(identity.path || "");
    if (!target) return Boolean(dailyPath && path === keepMovingMarkPath(dailyPath));
    const targetStem = target.replace(/\.md$/i, "");
    const pathStem = path.replace(/\.md$/i, "");
    return targetStem === pathStem || targetStem === pathStem.split("/").pop();
  } catch (error) {
    return false;
  }
}

function keepMovingMarkTaskIsOpen(task) {
  try {
    if (typeof blocksTaskIsOpen === "function") return blocksTaskIsOpen(task);
    return !planTaskIsDone(task);
  } catch (error) {
    return false;
  }
}

function keepMovingMarkTaskLine(task) {
  for (const key of ["lineNumber", "line", "lineNumberZeroBased"]) {
    if (Number.isInteger(task && task[key])) return Number(task[key]);
  }
  return null;
}

function keepMovingMarkBuildMemoIndex(memo) {
  const index = { byPathAndBlock: new Map(), byPathAndLine: new Map() };
  for (const task of memo && Array.isArray(memo.tasks) ? memo.tasks : []) {
    const path = keepMovingMarkPath(planTaskPath(task));
    if (!path) continue;
    const blockId = String(planTaskBlockId(task) || "");
    const line = keepMovingMarkTaskLine(task);
    for (const [map, suffix] of [
      [index.byPathAndBlock, blockId],
      [index.byPathAndLine, Number.isInteger(line) ? String(line) : ""],
    ]) {
      if (!suffix) continue;
      const key = path + "\0" + suffix;
      const matches = map.get(key) || [];
      matches.push(task);
      map.set(key, matches);
    }
  }
  return index;
}

function keepMovingMarkMemoMatch(row, memo, index) {
  try {
    const path = keepMovingMarkPath(row.path);
    const memoIndex = index || keepMovingMarkBuildMemoIndex(memo);
    const key = path + "\0" + (row.blockId || String(row.line));
    const matches = row.blockId
      ? memoIndex.byPathAndBlock.get(key) || []
      : memoIndex.byPathAndLine.get(key) || [];
    if (matches.length !== 1) return null;
    const line = keepMovingMarkTaskLine(matches[0]);
    if (line !== null && line !== row.line) return null;
    return matches[0];
  } catch (error) {
    return null;
  }
}

function keepMovingMarkTaskId(task) {
  try {
    return String(unblockedGlyphTaskId(task) || "").trim();
  } catch (error) {
    return "";
  }
}

function keepMovingMarkOpenIds(memo, closingTask) {
  const ids = new Set();
  const closingId = keepMovingMarkTaskId(closingTask);
  for (const task of memo && Array.isArray(memo.tasks) ? memo.tasks : []) {
    if (!keepMovingMarkTaskIsOpen(task)) continue;
    const id = keepMovingMarkTaskId(task);
    if (id && id !== closingId) ids.add(id);
  }
  return ids;
}

function keepMovingMarkRelationIndex(ctx) {
  return ctx && (ctx.relationIndex || ctx.relationsIndex || ctx.relations) || null;
}

function keepMovingMarkSuccessorLabelKeys(ctx) {
  const config = ctx && ctx.config || {};
  const raw = config.successorLabels || config.successor_labels ||
    (config.relations && config.relations.successor_labels) ||
    (ctx && ctx.successorLabels) || [];
  const values = Array.isArray(raw) ? raw : raw && Array.isArray(raw.labels) ? raw.labels : [];
  return new Set(values.map((value) => {
    if (value && typeof value === "object") return String(value.key || value.name || "");
    return String(value || "");
  }).filter(Boolean).map((value) =>
    typeof relationLabelKey === "function" ? relationLabelKey(value) : value.trim().toLowerCase(),
  ));
}

function keepMovingMarkRelationStateReady(ctx, labels) {
  if (!labels.size) return true;
  const index = keepMovingMarkRelationIndex(ctx);
  if (!index) return false;
  try {
    return typeof index.ready === "function" && index.ready() === true;
  } catch (error) {
    return false;
  }
}

function keepMovingMarkRelationSuccessor(row, closingTask, ctx, labels) {
  if (!labels.size) return false;
  const index = keepMovingMarkRelationIndex(ctx);
  if (!index || typeof index.outgoing !== "function") return false;
  try {
    const edges = index.outgoing(row.path, row.blockId) || [];
    return edges.some((edge) => {
      if (!edge || edge.kind === "mention") return false;
      const key = typeof relationLabelKey === "function"
        ? relationLabelKey(edge.label || edge.relationLabel || "")
        : String(edge.label || "").trim().toLowerCase();
      if (!labels.has(key)) return false;
      const target = edge.target || edge.to || {};
      const targetPath = target.path || edge.targetPath || (edge.targetRef && edge.targetRef.path) || "";
      const targetBlock = target.blockId || target.block_id || edge.targetBlockId ||
        (edge.targetRef && edge.targetRef.blockId) || "";
      if (String(targetBlock) !== String(planTaskBlockId(closingTask) || "")) return false;
      const resolvedPath = targetPath && ctx && typeof ctx.resolveLinkpath === "function"
        ? keepMovingMarkPath(ctx.resolveLinkpath(targetPath, row.path) || targetPath)
        : keepMovingMarkPath(targetPath);
      return !resolvedPath || resolvedPath === keepMovingMarkPath(planTaskPath(closingTask));
    });
  } catch (error) {
    return false;
  }
}

function keepMovingMarkSubtreeEmbeds(project, row) {
  try {
    const lines = String(project.text || "").split(/\r?\n/);
    const indent = (String(lines[row.line] || "").match(/^[ \t]*/) || [""])[0].length;
    const fenced = keepMovingMarkFencedLines(lines);
    for (let line = row.line + 1; line < lines.length; line += 1) {
      const raw = String(lines[line] || "");
      if (!raw.trim()) continue;
      if ((raw.match(/^[ \t]*/) || [""])[0].length <= indent) break;
      if (!fenced.has(line) && /!\[\[[^\]\n]*#\^[A-Za-z0-9-]+(?:\|[^\]\n]*)?\]\]/.test(raw)) return true;
    }
    return false;
  } catch (error) {
    return true;
  }
}

function keepMovingMarkAgreement(row, memo, memoIndex) {
  if (!row.isTask) return true;
  const task = keepMovingMarkMemoMatch(row, memo, memoIndex);
  return Boolean(task && keepMovingMarkTaskIsOpen(task));
}

// Row titles for the tooltip (§6 KT1): the contract shows clean prose
// ("Ship it"), while dependencyCleanTaskText keeps the note line's
// bullet and checkbox ("- [*] Ship it"). Strip the leading list marker
// and checkbox first; the §12.6 cleaning still runs on the residue.
function keepMovingMarkRowTitle(rawLine) {
  try {
    let text = String(rawLine || "");
    text = text.replace(/^\s*(?:[-*+]|\d+[.)])\s*\[[ xX/*?\-]\]\s*/, "");
    text = text.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "");
    if (typeof dependencyCleanTaskText === "function") {
      return dependencyCleanTaskText(text);
    }
    return text;
  } catch (error) {
    return String(rawLine || "");
  }
}

function keepMovingMarkCount(closingTask, projectInput, ctx = {}) {
  const unknown = { state: "unknown", count: 0, rows: [], folded: { blocked: 0, scheduled: 0, hidden: 0 }, projectPath: "", projectStem: "" };
  try {
    const config = ctx.config || {};
    if (config.keepMoving === false || config.keep_moving === false ||
        config.linkUnblocked === false || config.link_unblocked === false ||
        ctx.toggleOn === false || ctx.enabled === false) return { ...unknown, state: "zero" };
    const memo = ctx.memo;
    if (!memo || !Array.isArray(memo.tasks) || memo.tasks.length === 0 || memo.warm === false) return unknown;
    const path = keepMovingMarkPath(projectInput && projectInput.path || planTaskPath(closingTask));
    const source = projectInput && typeof projectInput.text === "string"
      ? projectInput.text
      : ctx && typeof ctx.noteTextFor === "function" ? ctx.noteTextFor(path) : "";
    if (!source) return unknown;
    const project = projectInput && projectInput.root && Array.isArray(projectInput.residents)
      ? projectInput
      : keepMovingMarkParseProject(path, source, ctx);
    if (!project) return { ...unknown, state: "zero", projectPath: path };
    const resultBase = {
      state: "zero", count: 0, rows: [],
      folded: { blocked: 0, scheduled: 0, hidden: 0 },
      projectPath: project.path,
      projectStem: project.stem,
    };
    const blockId = String(planTaskBlockId(closingTask) || "");
    const linkedRow = project.residents.find((row) => row.blockId === blockId && row.isTask);
    if (!blockId || !linkedRow || !KEEP_MOVING_MARK_OPEN.has(linkedRow.status)) return resultBase;
    if (project.root.blockId === blockId || project.path !== keepMovingMarkPath(planTaskPath(closingTask))) return resultBase;
    if (keepMovingMarkLeafProject(project.path, project.text, ctx) !== true) return resultBase;
    if (keepMovingMarkSubtreeEmbeds(project, linkedRow)) return resultBase;
    const memoIndex = ctx.memoIndex || keepMovingMarkBuildMemoIndex(memo);
    const closingMemo = keepMovingMarkMemoMatch(linkedRow, memo, memoIndex);
    if (!closingMemo || !keepMovingMarkTaskIsOpen(closingMemo)) return unknown;
    const labels = keepMovingMarkSuccessorLabelKeys(ctx);
    if (!keepMovingMarkRelationStateReady(ctx, labels)) return unknown;
    const liveLinks = keepMovingMarkLiveLinks(ctx.dayText || ctx.content || "");
    for (const resident of [project.root, ...project.residents]) {
      if (!KEEP_MOVING_MARK_OPEN.has(resident.status) || resident === linkedRow) continue;
      if (liveLinks.some((link) => keepMovingMarkLinkMatchesIdentity(
        link, { path: project.path, blockId: resident.blockId }, ctx.dailyPath,
      ))) return resultBase;
    }
    const openIds = keepMovingMarkOpenIds(memo, closingMemo);
    const today = String(ctx.today || memo.dateText || "");
    const rootBlocked = project.root.status === "?" || project.root.projectBlocked ||
      project.root.dependsOn.some((id) => openIds.has(String(id))) ||
      Boolean(project.scheduled && keepMovingMarkValidDate(project.scheduled) && project.scheduled > today);
    if (rootBlocked) return resultBase;
    const folded = { blocked: 0, scheduled: 0, hidden: 0 };
    const rows = [];
    for (const resident of project.residents) {
      if (resident === linkedRow || resident.blockId === "prj" ||
          !KEEP_MOVING_MARK_OPEN.has(resident.status)) continue;
      if (!keepMovingMarkAgreement(resident, memo, memoIndex)) return unknown;
      const id = resident.taskId;
      const blocked = resident.status === "?" || resident.projectBlocked ||
        resident.dependsOn.some((dependency) => openIds.has(String(dependency)));
      const scheduled = !blocked && resident.scheduled && resident.scheduled > today;
      const hidden = !blocked && !scheduled && resident.hide;
      if (blocked) { folded.blocked += 1; continue; }
      if (scheduled) { folded.scheduled += 1; continue; }
      if (hidden) { folded.hidden += 1; continue; }
      if (id && id === keepMovingMarkTaskId(closingMemo)) continue;
      if (resident.dependsOn.some((dependency) => id && String(dependency) === keepMovingMarkTaskId(closingMemo))) continue;
      if (keepMovingMarkRelationSuccessor(resident, closingMemo, ctx, labels)) continue;
      if (liveLinks.some((link) => keepMovingMarkLinkMatchesIdentity(
        link, { path: project.path, blockId: resident.blockId }, ctx.dailyPath,
      ))) continue;
      if (!Object.prototype.hasOwnProperty.call(KEEP_MOVING_MARK_LANES, resident.status)) continue;
      const title = keepMovingMarkRowTitle(resident.rawLine);
      rows.push({
        path: project.path, line: resident.line, blockId: resident.blockId,
        taskId: resident.taskId, status: resident.status,
        lane: resident.status === "/" ? "Pending" : resident.status === "*" ? "Next" : "Ready",
        title: String(title || "").trim(), text: resident.rawLine, rawLine: resident.rawLine,
        dependsOn: resident.dependsOn.slice(),
      });
    }
    rows.sort((left, right) =>
      KEEP_MOVING_MARK_LANES[left.status] - KEEP_MOVING_MARK_LANES[right.status] ||
      left.line - right.line,
    );
    resultBase.folded = folded;
    resultBase.rows = rows;
    resultBase.count = rows.length;
    resultBase.state = rows.length ? "positive" : "zero";
    return resultBase;
  } catch (error) {
    return unknown;
  }
}

function keepMovingMarkTodayGate(dailyPath, today, options = {}) {
  try {
    if (typeof options.isToday === "boolean") return options.isToday;
    const expected = String(options.todayDailyPath || "");
    if (expected) return keepMovingMarkPath(expected) === keepMovingMarkPath(dailyPath);
    if (typeof isCanonicalDailyNotePath !== "function" || !isCanonicalDailyNotePath(dailyPath)) return false;
    const compact = String(today || "").replace(/-/g, "");
    const match = String(dailyPath || "").match(/(?:^|\/)\d{4}\/(\d{8})\.md$/i);
    return !compact || !match || match[1] === compact;
  } catch (error) {
    return false;
  }
}

function keepMovingMarkCandidateLinks(content, memo, today, options = {}) {
  try {
    const ctx = options.ctx && typeof options.ctx === "object" ? { ...options.ctx } : { ...options };
    const config = ctx.config || {};
    if (config.keepMoving === false || config.keep_moving === false ||
        config.linkUnblocked === false || config.link_unblocked === false ||
        options.enabled === false || options.toggleOn === false) return [];
    if (!keepMovingMarkTodayGate(options.dailyPath || ctx.dailyPath, today, options)) return [];
    if (!memo || !Array.isArray(memo.tasks) || memo.tasks.length === 0 || memo.warm === false) return [];
    ctx.memo = memo;
    ctx.memoIndex = keepMovingMarkBuildMemoIndex(memo);
    ctx.today = String(today || memo.dateText || "");
    ctx.dailyPath = options.dailyPath || ctx.dailyPath || "";
    ctx.dayText = String(content || "");
    const links = typeof progressMarkLinks === "function" ? progressMarkLinks(content) : [];
    if (!links.length) return [];
    const index = typeof unblockedGlyphIndex === "function" ? unblockedGlyphIndex(memo.tasks) : null;
    const resolutionCache = new Map();
    const countCache = new Map();
    const out = [];
    for (const link of links) {
      try {
        const line = Number(link.line);
        if (typeof options.isVisible === "function" && !options.isVisible(line, Number(link.ch) || 0)) continue;
        const key = String(link.target || "") + "\0" + String(link.blockId || "");
        let task = resolutionCache.get(key);
        if (!resolutionCache.has(key)) {
          task = freesMarkLinkedTask(index, link.target, link.blockId, ctx.dailyPath);
          resolutionCache.set(key, task || null);
          if (typeof options.onResolve === "function") options.onResolve(key, task || null);
        }
        if (!task || !keepMovingMarkTaskIsOpen(task)) continue;
        const path = keepMovingMarkPath(planTaskPath(task));
        const blockId = String(planTaskBlockId(task) || "");
        if (!path || !blockId) continue;
        const identity = path + "\0" + blockId;
        let model = countCache.get(identity);
        if (!countCache.has(identity)) {
          model = keepMovingMarkCount(task, { path }, ctx);
          countCache.set(identity, model);
          if (typeof options.onCount === "function") options.onCount(identity, model);
        }
        if (!model) model = { state: "unknown", count: 0, rows: [], folded: { blocked: 0, scheduled: 0, hidden: 0 } };
        out.push({
          line, ch: Number(link.ch) || 0, target: link.target, blockId,
          ownerPath: path, ownerBlockId: blockId, ownerKey: identity,
          projectPath: model.projectPath || path,
          projectStem: model.projectStem || path.split("/").pop().replace(/\.md$/i, ""),
          count: model.count || 0, state: model.state || "unknown",
          rows: model.rows || [], folded: model.folded || { blocked: 0, scheduled: 0, hidden: 0 },
          dailyPath: ctx.dailyPath, linktext: path.replace(/\.md$/i, ""),
        });
      } catch (error) {
        continue;
      }
    }
    return out;
  } catch (error) {
    return [];
  }
}

function keepMovingMarkLinks(content, memo, today, options = {}) {
  try {
    return keepMovingMarkCandidateLinks(content, memo, today, options)
      .filter((entry) => entry.state === "positive" && entry.count >= 1);
  } catch (error) {
    return [];
  }
}
