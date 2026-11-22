// Requirement pull-in placement (RV `placement`): link carried tasks once
// at their owner's ordinary successor destination, raise them to Next, and
// never stamp freshness. Twin of bob-cli
// `src/native/task_complete/req_placement.rs` against the copied RV29–RV35
// vectors. Pure: staged texts in, postimages and composed restores out. Live
// persistence and managed Done call sites stay with `close_wiring`.

function reqPullInRefusal(code, message, extra) {
  return Object.assign({ ok: false, code, message: String(message || "") }, extra || {});
}

function reqPullInPathComponents(path) {
  return String(path == null ? "" : path).split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  });
}

// Every pulled carry of a write plan, in card order: closing-owner order,
// then requirement document order. The write pass runs bottom-to-top, so its
// outcome order is not the order a reader expects links in.
function reqPulledTasks(owners, outcomes) {
  const order = new Map((owners || []).map((owner, index) => [owner && owner.key, index]));
  return (outcomes || [])
    .filter((outcome) => outcome && outcome.pulled && outcome.carried)
    .map((outcome) => ({
      rowKey: outcome.row_key,
      ownerKey: outcome.owner_key,
      path: String(outcome.carried.path || ""),
      blockId: String(outcome.carried.block_id || ""),
    }))
    .map((task) => {
      const owner = (owners || []).find((entry) => entry && entry.key === task.ownerKey);
      return {
        rowKey: task.rowKey,
        ownerPath: owner ? String(owner.path || "") : "",
        ownerBlockId: owner ? String(owner.block_id || "") : "",
        path: task.path,
        blockId: task.blockId,
      };
    })
    .map((task, position) => ({
      task,
      position: order.has(task.ownerKey) ? order.get(task.ownerKey) : Number.MAX_SAFE_INTEGER,
      components: reqPullInPathComponents(
        (outcomes || []).find((outcome) => outcome && outcome.row_key === task.rowKey)?.path || "",
      ),
    }))
    .sort((left, right) => {
      if (left.position !== right.position) return left.position - right.position;
      const depths = Math.max(left.components.length, right.components.length);
      for (let index = 0; index < depths; index += 1) {
        const peer = (left.components[index] ?? Number.MAX_SAFE_INTEGER)
          - (right.components[index] ?? Number.MAX_SAFE_INTEGER);
        if (peer !== 0) return peer;
      }
      return 0;
    })
    .map((entry) => entry.task);
}

function reqPullInLiveKey(path, blockId) {
  return `${String(path || "")}\n${String(blockId || "")}`;
}

function reqPullInTargetToPath(target) {
  const text = String(target == null ? "" : target);
  if (!text) return null;
  const parts = text.split(/[\\/]/);
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  if (/^[A-Za-z]:/.test(text)) return null;
  let file = parts[parts.length - 1];
  if (!/\.md$/i.test(file)) file = `${file}.md`;
  const prefix = parts.slice(0, -1);
  return prefix.length ? `${prefix.join("/")}/${file}` : file;
}

function reqPullInBasenameKey(path) {
  const base = String(path || "").split("/").pop();
  const stem = base.replace(/\.(md|MD)$/, "");
  return stem.toLowerCase();
}

// Minimal vault index over an explicit path list: an exact vault-relative
// path wins, else a case-insensitively unique basename. Mirrors
// `NoteIndex::resolve` for the day-link shapes placement reads.
function reqPullInIndex(paths) {
  const listed = (Array.isArray(paths) ? paths : []).filter((path) => typeof path === "string" && path);
  const relative = new Set(listed);
  const basenames = new Map();
  for (const path of listed) {
    const key = reqPullInBasenameKey(path);
    if (!basenames.has(key)) basenames.set(key, path);
    else if (basenames.get(key) !== path) basenames.set(key, null);
  }
  return {
    resolve(dayPath, target) {
      if (target == null || String(target) === "") return typeof dayPath === "string" ? dayPath : null;
      const candidate = reqPullInTargetToPath(target);
      if (candidate && relative.has(candidate)) return candidate;
      if (target != null) {
        const hit = basenames.get(reqPullInBasenameKey(String(target)));
        if (typeof hit === "string") return hit;
      }
      return null;
    },
    uniqueBasename(path) {
      const key = reqPullInBasenameKey(path);
      return basenames.get(key) === path;
    },
  };
}

function reqPullInBlockIdByte(value) {
  return /^[A-Za-z0-9-]$/.test(value);
}

// Every `[[target#^block]]` (or `![[...]]`) occurrence on one day line,
// with its strike state. Mirrors `block_link_occurrences` for the link
// shapes a ledger carries; nested-bracket lines keep only the first span.
function reqPullInBlockLinks(lineText) {
  const line = String(lineText == null ? "" : lineText);
  let spans = [];
  try {
    spans = typeof getStrikethroughSpans === "function" ? getStrikethroughSpans(line) || [] : [];
  } catch (_error) {
    spans = [];
  }
  const links = [];
  let offset = 0;
  while (offset < line.length) {
    const open = line.indexOf("[[", offset);
    if (open === -1) break;
    const close = line.indexOf("]]", open + 2);
    if (close === -1) break;
    offset = close + 2;
    const inside = line.slice(open + 2, close);
    const head = inside.split("|", 1)[0] || "";
    const hash = head.indexOf("#^");
    if (hash === -1) continue;
    const target = head.slice(0, hash).trim();
    const blockId = head.slice(hash + 2).trim();
    if (!blockId || ![...blockId].every(reqPullInBlockIdByte)) continue;
    const embedded = open > 0 && line[open - 1] === "!";
    const tokenStart = embedded ? open - 1 : open;
    let struck = false;
    try {
      struck = typeof rangeIsStruck === "function" ? rangeIsStruck(tokenStart, close + 2, spans) : false;
    } catch (_error) {
      struck = false;
    }
    links.push({ target, blockId, struck });
  }
  return links;
}

function reqPullInEntryOpen(line) {
  const match = String(line || "").match(/^\-\s+\[([^\]\n]*)\]/);
  if (!match) return null;
  const box = match[1].trim();
  if (box.toLowerCase() === "x" || box === "-") return false;
  return true;
}

function reqPullInEntryTimed(line) {
  let parts = null;
  try {
    parts = typeof parsePomodoroEntryLineParts === "function" ? parsePomodoroEntryLineParts(line) : null;
  } catch (_error) {
    parts = null;
  }
  if (!parts) return false;
  return !parts.placeholder;
}

function reqPullInEntryName(line) {
  let parts = null;
  try {
    parts = typeof parsePomodoroEntryLineParts === "function" ? parsePomodoroEntryLineParts(line) : null;
  } catch (_error) {
    parts = null;
  }
  return (parts && parts.name) || "";
}

function reqPullInBlockEnd(lines, headline, sectionEnd) {
  let end = headline + 1;
  while (end < sectionEnd && end < lines.length) {
    const line = String(lines[end] || "");
    if (line.trim() !== "" && /^[ \t]*/.exec(line)[0].length === 0) break;
    end += 1;
  }
  while (end > headline + 1 && String(lines[end - 1] || "").trim() === "") end -= 1;
  return end;
}

function reqPullInBulletEnd(lines, bulletLine, entryEnd, indentLen) {
  let index = bulletLine + 1;
  const indented = (line) => /^[ \t]*/.exec(String(line || ""))[0].length > indentLen;
  const blankThenIndented = (at) => {
    if (String(lines[at] || "").trim() !== "") return false;
    for (let next = at + 1; next < entryEnd; next += 1) {
      const text = String(lines[next] || "");
      if (text.trim() === "") continue;
      return /^[ \t]*/.exec(text)[0].length > indentLen;
    }
    return false;
  };
  while (index < entryEnd) {
    if (indented(lines[index]) || blankThenIndented(index)) index += 1;
    else break;
  }
  return index;
}

function reqPullInManagedLine(line) {
  try {
    if (typeof stripPomodoroMarkersFromLine === "function" && typeof isTaskLinkExclusionLine === "function") {
      return isTaskLinkExclusionLine(stripPomodoroMarkersFromLine(line));
    }
  } catch (_error) {}
  return false;
}

// The ledger slice placement reads: open entries plus the first live link
// per note block under them. Mirrors `DayView::parse`.
function reqPullInLogicalLines(dayText) {
  const text = String(dayText == null ? "" : dayText);
  const raw = text.split("\n");
  if (text.endsWith("\n")) raw.pop();
  return raw.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function reqPullInDayView(dayText, dayPath, indexPaths) {
  const text = String(dayText == null ? "" : dayText);
  const lines = reqPullInLogicalLines(text);
  const index = reqPullInIndex(indexPaths);
  const entries = [];
  const live = new Map();
  let section = null;
  try {
    section = typeof findPomodorosSectionInLines === "function" ? findPomodorosSectionInLines(lines) : null;
  } catch (_error) {
    section = null;
  }
  if (!section) return { lines, entries, live, index };
  const end = Math.min(section.endLine + 1, lines.length);
  for (let line = section.startLine; line < end; line += 1) {
    const raw = String(lines[line] || "");
    const open = raw.startsWith("-") ? reqPullInEntryOpen(raw) : null;
    if (open === null) continue;
    const entryEnd = reqPullInBlockEnd(lines, line, end);
    const entryIndex = entries.length;
    entries.push({
      line,
      end: entryEnd,
      name: reqPullInEntryName(raw),
      open,
      timed: reqPullInEntryTimed(raw),
    });
    if (!open) continue;
    for (let bullet = line + 1; bullet < entryEnd; bullet += 1) {
      const bulletText = String(lines[bullet] || "");
      if (reqPullInManagedLine(bulletText)) continue;
      const indent = /^[ \t]*/.exec(bulletText)[0];
      if (indent.length === 0) continue;
      const marker = bulletText.slice(indent.length).match(/^(?:[-+*]|\d+[.)])\s/);
      if (!marker) continue;
      const occurrences = reqPullInBlockLinks(bulletText);
      if (occurrences.length === 0) continue;
      const bulletEnd = reqPullInBulletEnd(lines, bullet, entryEnd, indent.length);
      for (const link of occurrences) {
        if (link.struck) continue;
        const resolved = index.resolve(dayPath, link.target);
        if (!resolved) continue;
        const key = reqPullInLiveKey(resolved, link.blockId);
        if (!live.has(key)) {
          live.set(key, { entryIndex, bulletLine: bullet, bulletEnd, indent });
        }
      }
    }
  }
  return { lines, entries, live, index };
}

function reqPullInEntryDisplayName(view, entryIndex) {
  const entry = view.entries[entryIndex];
  return entry ? entry.name : "";
}

// The ordinary successor destination for one created task: the shared
// closing target, else the owner's slot anchor (or the root's), else the
// implicit destination. Mirrors `default_destination`; `null` means the
// batch must refuse, never silently downgrade.
function reqPullInDefaultDestination(view, dayText, completed, closingTarget, ownerPath, ownerBlockId) {
  if (dayText == null) return null;
  const destination = (entryName, entryRole, fallback) => ({
    entryName: String(entryName || ""),
    entryRole,
    fallback: fallback === true,
  });
  if (closingTarget) {
    return {
      target: closingTarget.target,
      destination: destination(
        closingTarget.name,
        closingTarget.entryCreated ? "created" : "closing",
        false,
      ),
    };
  }
  const anchor = reqPullInAnchorForOwner(view, completed, ownerPath, ownerBlockId);
  if (anchor) {
    return {
      target: { kind: "slot", entryIndex: anchor.entryIndex, bulletEnd: anchor.bulletEnd, indent: anchor.indent },
      destination: destination(reqPullInEntryDisplayName(view, anchor.entryIndex), "slot", false),
    };
  }
  const implicit = reqPullInImplicitDestination(view);
  if (!implicit) return null;
  return {
    target: implicit.target,
    destination: destination(implicit.entryName, "implicit", true),
  };
}

function reqPullInAnchorForOwner(view, completed, ownerPath, ownerBlockId) {
  const at = (entry) => ({
    entryIndex: entry.entryIndex,
    bulletEnd: entry.bulletEnd,
    indent: entry.indent,
  });
  if (ownerBlockId) {
    const hit = view.live.get(reqPullInLiveKey(ownerPath, ownerBlockId));
    if (hit) return at(hit);
  }
  const list = Array.isArray(completed) ? completed : [];
  const ownerIsRoot = list.some((task) => task && task.isRoot && task.path === ownerPath && task.blockId === ownerBlockId);
  if (ownerIsRoot) return null;
  const root = list.find((task) => task && task.isRoot);
  if (!root || !root.blockId) {
    if (!root) return null;
  }
  const hit = root && view.live.get(reqPullInLiveKey(root.path, root.blockId || ""));
  return hit ? at(hit) : null;
}

function reqPullInImplicitDestination(view) {
  const open = view.entries
    .map((entry, entryIndex) => ({ entry, entryIndex }))
    .filter((item) => item.entry.open);
  const pick = open.find((item) => item.entry.timed) || open[0];
  if (!pick) return null;
  const insertAt = reqPullInBlockEnd(view.lines, pick.entry.line, view.lines.length);
  return {
    target: { kind: "closing", entryIndex: pick.entryIndex, insertAt, createdName: null },
    entryName: pick.entry.name,
  };
}

// Resolve the closing target against the post-close day text: the
// continuation the close left behind, else the first open same-name entry
// after the closed one, else a created placeholder directly below the
// closed entry. Mirrors `resolve_closing_target`.
function reqPullInClosingTarget(view, closing) {
  const lines = view.lines;
  const end = lines.length;
  const blockEnd = (headline) => reqPullInBlockEnd(lines, Math.min(headline, end), end);
  const positionOf = (line) => view.entries.findIndex((entry) => entry.line === line);
  if (closing && closing.continuation) {
    const position = positionOf(Number(closing.continuation.line) - 1);
    if (position !== -1) {
      const entry = view.entries[position];
      return {
        target: { kind: "closing", entryIndex: position, insertAt: blockEnd(entry.line), createdName: null },
        name: entry.name,
        entryCreated: closing.continuation.created === true,
      };
    }
  }
  const continuationName = closing ? String(closing.continuationName || "") : "";
  if (continuationName) {
    const closedPosition = positionOf(Number(closing.closedLine));
    if (closedPosition !== -1) {
      const reuse = view.entries
        .map((entry, entryIndex) => ({ entry, entryIndex }))
        .slice(closedPosition + 1)
        .find((item) => item.entry.open && item.entry.name === continuationName);
      if (reuse) {
        return {
          target: {
            kind: "closing",
            entryIndex: reuse.entryIndex,
            insertAt: blockEnd(reuse.entry.line),
            createdName: null,
          },
          name: reuse.entry.name,
          entryCreated: false,
        };
      }
    }
  }
  const closedPosition = positionOf(Number(closing ? closing.closedLine : NaN));
  const insertAt = closedPosition !== -1
    ? blockEnd(view.entries[closedPosition].line)
    : blockEnd(Number(closing ? closing.closedLine : 0));
  return {
    target: { kind: "closing", entryIndex: null, insertAt, createdName: continuationName },
    name: continuationName,
    entryCreated: true,
  };
}

// Next rank for a linked successor: ` ` and `?` become `*`; `*` and `/`
// are unchanged. Mirrors `successor_new_status`.
function reqPullInNewStatus(previous) {
  if (previous === "?" || previous === " ") return "*";
  return previous;
}

// Raise the task with `blockId` to Next in place. Returns the edited text
// and the task's previous status. No freshness field is ever written.
function reqPullInRaiseToNext(contents, blockId, options) {
  const text = String(contents == null ? "" : contents);
  if (!blockId) return null;
  let tasks = [];
  try {
    tasks = taskReqNoteTasks(text, options) || [];
  } catch (_error) {
    return null;
  }
  const matches = tasks.filter((task) => String(task.blockId || "") === String(blockId));
  if (matches.length !== 1) return null;
  const task = matches[0];
  const previous = typeof task.statusSymbol === "string" && task.statusSymbol ? task.statusSymbol : " ";
  const next = reqPullInNewStatus(previous);
  const lines = text.split("\n");
  const raw = lines[task.lineIndex];
  if (raw == null) return null;
  const ending = raw.endsWith("\r") ? "\r" : "";
  const core = ending ? raw.slice(0, -1) : raw;
  let edited = null;
  try {
    edited = typeof replaceTaskStatusSymbol === "function"
      ? replaceTaskStatusSymbol(core, next)
      : null;
  } catch (_error) {
    edited = null;
  }
  if (typeof edited !== "string") return null;
  if (edited === core && next !== previous) return null;
  lines[task.lineIndex] = ending ? `${edited}\r` : edited;
  return { text: lines.join("\n"), previous };
}

function reqPullInRawTaskLine(contents, blockId, options) {
  const text = String(contents == null ? "" : contents);
  let tasks = [];
  try {
    tasks = taskReqNoteTasks(text, options) || [];
  } catch (_error) {
    return null;
  }
  const match = tasks.find((task) => String(task.blockId || "") === String(blockId));
  if (!match) return "";
  const lines = text.split("\n");
  const raw = lines[match.lineIndex] || "";
  return raw.endsWith("\r") ? raw.slice(0, -1) : raw;
}

// Shortest unambiguous link form for a pull-in target. Mirrors
// `successor_link_text`: a target living in the day file still names the
// note; otherwise the basename when unique in the index, else the full
// vault-relative path without `.md`. Archive targets always keep the path.
function reqPullInSuccessorLink(targetPath, blockId, dayPath, index) {
  const id = String(blockId || "").replace(/^\^/, "");
  if (String(targetPath || "") === String(dayPath || "")) {
    const stem = String(dayPath || "").split("/").pop().replace(/\.md$/i, "");
    return `[[${stem}#^${id}]]`;
  }
  const target = String(targetPath || "").replace(/\.md$/i, "");
  if (/^done(\/|$)/.test(String(targetPath || ""))) return `[[${target}#^${id}]]`;
  if (index && typeof index.uniqueBasename === "function" && index.uniqueBasename(targetPath)) {
    const stem = String(targetPath || "").split("/").pop().replace(/\.md$/i, "");
    return `[[${stem}#^${id}]]`;
  }
  return `[[${target}#^${id}]]`;
}

// Insert successor bullets into the day text, reporting 1-based post lines.
// Mirrors `insert_successor_links`: slot anchors insert after the anchor
// bullet's subtree in successor order; closing targets append after the
// target entry's existing children (replacing a lone stub); a created
// placeholder goes immediately after the closed entry's block. `view` is the
// `reqPullInDayView` of `dayText`, used for lone-stub and `next_up` entry
// coordinates.
function reqPullInInsertLinks(dayText, view, placements) {
  const text = String(dayText == null ? "" : dayText);
  if (!Array.isArray(placements) || placements.length === 0) return { text, placed: [] };
  const lines = reqPullInLogicalLines(text);
  const ending = text.includes("\r\n") ? "\r\n" : "\n";
  const jobs = placements.map((placement, order) => {
    const target = placement.target || {};
    if (target.kind === "slot") {
      return {
        order,
        insertAt: target.bulletEnd,
        entry: target.entryIndex,
        created: false,
        createdName: null,
        bullet: `${target.indent || ""}- ${placement.blockLink}`,
      };
    }
    const created = target.entryIndex == null && target.createdName != null;
    return {
      order,
      insertAt: target.insertAt,
      entry: target.entryIndex,
      created,
      createdName: target.createdName,
      bullet: `\t- ${placement.blockLink}`,
    };
  });
  jobs.sort((left, right) => left.insertAt - right.insertAt);
  const groups = [];
  for (let position = 0; position < jobs.length; position += 1) {
    const job = jobs[position];
    const last = groups.length ? groups[groups.length - 1] : null;
    const first = last ? jobs[last[0]] : null;
    if (
      first
      && first.insertAt === job.insertAt
      && first.entry === job.entry
      && first.created === job.created
      && (first.createdName || null) === (job.createdName || null)
    ) {
      last.push(position);
    } else {
      groups.push([position]);
    }
  }
  const entries = (view && Array.isArray(view.entries)) ? view.entries : [];
  const segments = lines.slice();
  const hadTrailing = text.endsWith("\n");
  const addedBelow = new Map();
  const bulletPost = new Map();
  const createdPost = new Map();
  const applied = [];
  const shiftAt = (pre) => applied
    .filter((entry) => entry[0] <= pre)
    .reduce((total, entry) => total + entry[1], 0);
  for (const group of groups) {
    const first = jobs[group[0]];
    const at = Math.min(first.insertAt, lines.length) + shiftAt(first.insertAt);
    // Lone-stub replacement: a closing target into an existing entry whose
    // only child is a blank bullet takes that bullet's line for the first
    // successor instead of appending.
    let stubAt = null;
    if (!first.created && first.entry != null) {
      const entry = entries[first.entry];
      if (entry && first.insertAt === entry.line + 2 && String(lines[entry.line + 1] || "").trim() === "-") {
        stubAt = entry.line + 1 + shiftAt(entry.line + 1);
      }
    }
    const fresh = [];
    if (first.created) {
      const name = first.createdName || "";
      fresh.push(name ? `- [ ] () \u2014 ${name}` : "- [ ] ()");
      const placeholderPost = at + fresh.length - 1;
      for (const jobIndex of group) createdPost.set(jobs[jobIndex].order, placeholderPost);
    }
    group.forEach((jobIndex, position) => {
      const job = jobs[jobIndex];
      if (position === 0 && stubAt != null && segments[stubAt] !== undefined) {
        segments[stubAt] = job.bullet;
        bulletPost.set(job.order, stubAt);
      } else {
        fresh.push(job.bullet);
        bulletPost.set(job.order, at + fresh.length - 1);
      }
    });
    // The stub take rewrites a line in place, so only spliced lines count
    // as net additions.
    for (let index = 0; index < fresh.length; index += 1) segments.splice(at + index, 0, fresh[index]);
    const net = fresh.length;
    addedBelow.set(first.insertAt, (addedBelow.get(first.insertAt) || 0) + net);
    applied.push([first.insertAt, net]);
  }
  const shift = (pre) => {
    let total = 0;
    for (const [position, count] of addedBelow) {
      if (position <= pre) total += count;
    }
    return total;
  };
  const finalText = segments.length === 0
    ? ""
    : (hadTrailing ? `${segments.join(ending)}${ending}` : segments.join(ending));
  // `next_up`: the target entry is the first open untimed placeholder in
  // the resulting ledger — the one a bare `=` would start.
  const postView = reqPullInDayView(finalText, null, []);
  const nextUp = postView.entries.find((entry) => entry.open && !entry.timed);
  const nextUpLine = nextUp ? nextUp.line : null;
  const placedByOrder = new Map();
  for (const job of jobs) {
    const line = (bulletPost.has(job.order) ? bulletPost.get(job.order) : 0) + 1;
    let entryLine = 0;
    if (job.created) {
      entryLine = (createdPost.has(job.order) ? createdPost.get(job.order) : 0) + 1;
    } else if (job.entry != null && entries[job.entry]) {
      entryLine = entries[job.entry].line + shift(entries[job.entry].line) + 1;
    }
    placedByOrder.set(job.order, {
      line,
      entryLine,
      entryCreated: job.created,
      nextUp: nextUpLine === entryLine - 1,
    });
  }
  const placed = [];
  for (let order = 0; order < jobs.length; order += 1) {
    placed.push(placedByOrder.get(order) || {
      line: 0,
      entryLine: 0,
      entryCreated: false,
      nextUp: false,
    });
  }
  return { text: finalText, placed };
}

// Link every pulled carry at its owner's ordinary successor destination,
// raise it to Next, and never stamp freshness. `outcomes` are the write
// plan's applied outcomes; `notes` is the staged post-write texts keyed by
// vault-relative path; `day` is the staged day text (post ordinary
// successor insertion) or `null` when this gesture has no day file.
// `routePulledTask`, when supplied, routes a default destination through
// the same D7 type routing ordinary offers use and may refuse with
// `{ refusal: { code, message } }`; without it destinations stay as
// resolved. Any refusal stages nothing.
function planReqPullInLinks(input) {
  const options = input && typeof input === "object" ? input : {};
  const owners = Array.isArray(options.owners) ? options.owners : [];
  const outcomes = Array.isArray(options.outcomes) ? options.outcomes : [];
  const dayPath = typeof options.dayPath === "string" ? options.dayPath : "";
  const dayText = options.day == null ? null : String(options.day);
  const indexPaths = Array.isArray(options.index) ? options.index : [];
  const completed = Array.isArray(options.completed) ? options.completed : [];
  const closing = options.closing && typeof options.closing === "object" ? options.closing : null;
  const taskOptions = options.settings && typeof options.settings === "object" ? options.settings : undefined;
  const store = typeof reqCloseWriteCoerceNotes === "function"
    ? reqCloseWriteCoerceNotes(options.notes)
    : new Map();
  const pulled = reqPulledTasks(owners, outcomes);
  if (pulled.length === 0) {
    return { ok: true, dayAfter: null, links: [], notesAfter: {}, postimages: {}, restores: [] };
  }
  const view = reqPullInDayView(dayText == null ? "" : dayText, dayPath, indexPaths);
  const closingTarget = closing ? reqPullInClosingTarget(view, closing) : null;
  // Status edits first: they are in place, so placement coordinates
  // computed on the day text stay valid even when a created task lives in
  // the day file itself.
  const working = new Map(store);
  const previous = [];
  const taskLines = new Map();
  for (const task of pulled) {
    const current = working.has(task.path)
      ? working.get(task.path)
      : (task.path === dayPath && dayText != null ? dayText : undefined);
    if (typeof current !== "string") {
      return reqPullInRefusal("req_close_stale", `the carried requirement's new task changed: ${task.rowKey}`, {
        rowKey: task.rowKey,
      });
    }
    taskLines.set(task.rowKey, reqPullInRawTaskLine(current, task.blockId, taskOptions));
    const raised = reqPullInRaiseToNext(current, task.blockId, taskOptions);
    if (!raised) {
      return reqPullInRefusal("req_close_stale", `the carried requirement's new task changed: ${task.rowKey}`, {
        rowKey: task.rowKey,
      });
    }
    previous.push(raised.previous);
    working.set(task.path, raised.text);
  }
  const placements = [];
  const destinations = [];
  const positions = [];
  const router = typeof options.routePulledTask === "function" ? options.routePulledTask : null;
  for (let position = 0; position < pulled.length; position += 1) {
    const task = pulled[position];
    // Link once: a created task already live in an open entry keeps that
    // link and gains no second bullet.
    if (view.live.has(reqPullInLiveKey(task.path, task.blockId))) continue;
    const resolved = reqPullInDefaultDestination(
      view,
      dayText,
      completed,
      closingTarget,
      task.ownerPath,
      task.ownerBlockId,
    );
    if (!resolved) {
      return reqPullInRefusal(
        "req_pull_in_no_destination",
        `no open Pomodoro to pull the carried requirement into: ${task.rowKey}`,
        { rowKey: task.rowKey },
      );
    }
    let target = resolved.target;
    let destination = resolved.destination;
    let routed = false;
    if (router) {
      let routedResult = null;
      try {
        routedResult = router({
          task,
          taskLine: taskLines.get(task.rowKey) || "",
          dayText: dayText == null ? "" : dayText,
          dayPath,
          target,
          destination,
          today: typeof options.today === "string" ? options.today : "",
        });
      } catch (_error) {
        routedResult = null;
      }
      if (!routedResult || routedResult.refusal) {
        return reqPullInRefusal(
          "req_pull_in_no_destination",
          `no open Pomodoro to pull the carried requirement into: ${task.rowKey}`,
          { rowKey: task.rowKey },
        );
      }
      target = routedResult.target || target;
      destination = routedResult.destination || destination;
      routed = routedResult.routed === true;
    }
    placements.push({
      target,
      blockLink: reqPullInSuccessorLink(task.path, task.blockId, dayPath, view.index),
    });
    destinations.push({ destination, routed });
    positions.push(position);
  }
  const dayWithEdits = working.has(dayPath) ? working.get(dayPath) : undefined;
  const insertionBase = dayWithEdits !== undefined ? dayWithEdits : dayText;
  let dayAfter = dayWithEdits !== undefined && dayWithEdits !== dayText ? dayWithEdits : null;
  let placed = [];
  if (placements.length > 0) {
    const inserted = reqPullInInsertLinks(insertionBase == null ? "" : insertionBase, view, placements);
    dayAfter = inserted.text !== dayText ? inserted.text : dayAfter;
    if (dayAfter === dayText) dayAfter = null;
    placed = inserted.placed;
  }
  const links = [];
  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index];
    const task = pulled[position];
    const destination = destinations[index].destination;
    const routed = destinations[index].routed;
    const report = placed[index] || { line: 0, entryLine: 0, entryCreated: false, nextUp: false };
    const closingCreated = Boolean(closingTarget && !routed && closingTarget.entryCreated);
    links.push({
      rowKey: task.rowKey,
      path: task.path,
      blockId: task.blockId,
      previousStatus: previous[position],
      status: reqPullInNewStatus(previous[position]),
      destination: {
        dayFile: dayPath,
        entryName: destination.entryName,
        entryRole: destination.entryRole,
        fallback: destination.fallback,
      },
      routed,
      link: {
        entryName: destination.entryName,
        entryLine: report.entryLine,
        line: report.line,
        blockLink: placements[index].blockLink,
        entryCreated: report.entryCreated || closingCreated,
        nextUp: report.nextUp,
        blockIdCreated: false,
      },
    });
  }
  // Drop unchanged note texts so callers stage only real edits.
  const notesAfter = {};
  const postimages = {};
  const restores = [];
  for (const [path, text] of working) {
    if (path === dayPath) continue;
    if (store.get(path) === text) continue;
    notesAfter[path] = text;
    postimages[path] = text;
    restores.push({
      path,
      before: store.has(path) ? store.get(path) : "",
      after: text,
      created: !store.has(path),
    });
  }
  if (dayAfter != null) {
    postimages[dayPath] = dayAfter;
    restores.push({
      path: dayPath,
      before: dayText == null ? "" : dayText,
      after: dayAfter,
      created: false,
    });
  }
  return { ok: true, dayAfter, links, notesAfter, postimages, restores };
}

// Destination preflight for carry-plus-pull-in: the same ordinary
// successor resolution the link pass runs, checked before any write. No
// valid destination refuses the whole batch instead of silently
// downgrading to an unlinked carry. `context` carries the gesture's day
// text, index paths, completed set, and closing context; the returned
// function matches the `pullInPreflight({ owners, verdicts, notes })`
// seam the apply service consults.
function createReqPullInPreflight(context) {
  const scope = context && typeof context === "object" ? context : {};
  return ({ owners, verdicts, notes } = {}) => {
    const list = Array.isArray(owners) ? owners : [];
    const picks = Array.isArray(verdicts) ? verdicts : [];
    const files = (notes && typeof notes === "object" && !Array.isArray(notes)) ? notes : {};
    const dayPath = typeof scope.dayPath === "string" ? scope.dayPath : "";
    const dayText = scope.day != null
      ? String(scope.day)
      : (typeof files[dayPath] === "string" ? files[dayPath] : null);
    const view = reqPullInDayView(dayText == null ? "" : dayText, dayPath, scope.index || []);
    const closing = scope.closing && typeof scope.closing === "object" ? scope.closing : null;
    const closingTarget = closing ? reqPullInClosingTarget(view, closing) : null;
    for (const pick of picks) {
      if (!pick || pick.verdict !== "carry_pulled" || !pick.row) continue;
      const owner = list.find((entry) => entry && entry.key === pick.row.owner_key);
      const ownerPath = owner ? String(owner.path || "") : String(pick.row.owner_path || "");
      const ownerBlockId = owner ? String(owner.block_id || "") : String(pick.row.owner_block_id || "");
      const resolved = reqPullInDefaultDestination(
        view,
        dayText,
        scope.completed || [],
        closingTarget,
        ownerPath,
        ownerBlockId,
      );
      if (!resolved) {
        return reqPullInRefusal(
          "req_pull_in_no_destination",
          `no open Pomodoro to pull the carried requirement into: ${pick.row.key}`,
          { rowKey: pick.row.key },
        );
      }
    }
    return { ok: true };
  };
}
