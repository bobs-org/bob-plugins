// Task relation chips (bob-cli-a2 chips). Pure model and element builder
// for live LINKS and LINKED FROM rows. Chips render the live relation
// index, never the stored mirror: a stored entry with no live edge is
// stale (LC8), a live edge missing from the text is appended in canonical
// order (LC7), and an unresolvable LINKS target is broken (LC4). Reuses
// the `bob-dep-*` DOM family with no new palette. Labels are muted
// small-caps pills on the arrow side; inverse phrases are display-only
// (derived `‹participle› by` rule plus named pairs); three or more closed chips
// collapse to `✓×N` (LC9). Never throws.
const RELATION_STALE_TOOLTIP =
  "No longer links here · refreshes on the next reconcile";
const RELATION_LINKS_ROW_TOOLTIP =
  "Related tasks · live from the relation index";
const RELATION_LINKED_FROM_ROW_TOOLTIP =
  "Tasks linking here · live from the relation index";
const RELATION_LINKED_FROM_MENTIONS_TOOLTIP =
  "Tasks linking here · relations and 💬 text mentions · live";
const RELATION_MENTION_STALE_TOOLTIP =
  "No longer mentioned here · refreshes on the next reconcile";
const RELATION_MENTION_LABEL = "💬 mentions";

// Display-only inverse phrases (docs/task-relations.md §10). Storage
// stays verbatim; matching is case-insensitive. Delegates to the shared
// derived rule in `145a-relation-inverse-phrase.js`.
function relationInversePhrase(label) {
  try {
    return relationInverseForLabel(label);
  } catch (error) {
    return null;
  }
}

function relationShortText(fullText) {
  const text = String(fullText || "");
  return text.length > 40 ? text.slice(0, 40) + "…" : text;
}

function relationNoteStem(path) {
  try {
    const stem = String(path || "").split("/").pop() || "";
    return stem.replace(/\.md$/i, "");
  } catch (error) {
    return "";
  }
}

// Status → chip state. Memo tasks resolve through their status symbol
// first (the dep-chip mapping); raw index records carry a status word.
function relationStateFromTask(task) {
  try {
    if (task && typeof task === "object") {
      let symbol = "";
      try {
        symbol = planTaskStatusSymbol(task) || "";
      } catch (error) {
        symbol = "";
      }
      if (symbol) return dependencyStateFromSymbol(symbol, task);
      const raw = task.status && typeof task.status === "object"
        ? task.status.type || task.status.name || ""
        : task.status;
      const word = String(raw || "").trim().toUpperCase();
      if (word === "DONE" || word === "X") return "done";
      if (word === "CANCELLED" || word === "-") return "cancelled";
      if (word === "IN_PROGRESS" || word === "/") return "in-progress";
      if (word === "ON_HOLD" || word === "?" || word === "BLOCKED") return "blocked";
      if (word === "NEXT" || word === "*") return "next";
    }
    return "todo";
  } catch (error) {
    return "todo";
  }
}

function relationFullTextFor(task, blockId) {
  try {
    let raw = null;
    try {
      raw = planTaskDescription(task) || null;
    } catch (error) {
      raw = null;
    }
    if (typeof raw !== "string" || !raw) {
      if (task && typeof task.text === "string" && task.text) raw = task.text;
      else return "^" + String(blockId || "");
    }
    // Raw index records carry the whole task line; memo descriptions do
    // not. Strip a leading list marker and checkbox either way.
    const line = String(raw).replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]\n]\]\s+/u, "");
    return dependencyCleanTaskText(line) || ("^" + String(blockId || ""));
  } catch (error) {
    return "^" + String(blockId || "");
  }
}

// Canonical link text for sorting appended live chips (docs/task-relations.md
// §4: ASCII case-fold, Unicode code-point order, raw tie-break — exactly
// BK21). Same-note entries sort first on the `#` prefix.
function relationEdgeLinktext(otherPath, blockId, sourcePath) {
  const id = String(blockId || "");
  const target = String(otherPath || "");
  const source = String(sourcePath || "");
  if (!target || target === source) return "#^" + id;
  const withoutMd = target.replace(/\.md$/i, "");
  if (/^done\//i.test(withoutMd)) return withoutMd + "#^" + id;
  const stem = withoutMd.split("/").pop() || withoutMd;
  return stem + "#^" + id;
}

function relationFoldLinktext(linktext) {
  return String(linktext || "").replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function relationCompareLinktext(left, right) {
  const folded = relationCodepointCompare(relationFoldLinktext(left), relationFoldLinktext(right));
  if (folded !== 0) return folded;
  return relationCodepointCompare(String(left || ""), String(right || ""));
}

function relationBuildChip({ direction, linkpath, blockId, label, task, otherPath, live, stale, resolved, sourcePath, alsoMentioned }) {
  try {
    const id = String(blockId || "");
    const known = task && typeof task === "object" ? task : null;
    const resolvedPath = known
      ? (planTaskPath(known) || String(otherPath || ""))
      : String(otherPath || "");
    // Broken means the target cannot be resolved to a task: no record
    // and (when live) an unresolved edge. A stale entry whose target
    // still resolves shows its status, dashed.
    const broken = !known && (!live || resolved !== true);
    const archived = Boolean(resolvedPath && /(^|\/)done\//i.test(resolvedPath));
    const state = broken ? "broken" : relationStateFromTask(known);
    const symbol = broken ? "⚠" : dependencySymbolForState(state);
    const fullText = broken ? "^" + id + " not found" : relationFullTextFor(known, id);
    const crossNote = Boolean(resolvedPath && resolvedPath !== String(sourcePath || ""));
    const noteLabel = crossNote ? "↗ " + (relationNoteStem(linkpath || resolvedPath) || relationNoteStem(resolvedPath)) : null;
    let hidden = false;
    try {
      hidden = Boolean(known && blocksTagPresent(known, "hide"));
    } catch (error) {
      hidden = false;
    }
    const storedLinkpath = String(linkpath || "");
    const linktext = storedLinkpath
      ? storedLinkpath.replace(/\.md$/i, "") + "#^" + id
      : relationEdgeLinktext(resolvedPath, id, sourcePath);
    const inverse = direction === "from" ? relationInversePhrase(label) : null;
    const tooltipParts = broken
      ? ["⚠ ^" + id + " not found"]
      : [fullText, resolvedPath || String(sourcePath || ""), dependencyStatusName(state)];
    if (stale && !broken) tooltipParts.push(RELATION_STALE_TOOLTIP);
    const tooltip = tooltipParts.filter(Boolean).join(" — ");
    let removeLabel = null;
    if (direction === "to") removeLabel = "Unlink " + fullText;
    else removeLabel = "Remove the link from " + fullText;
    return {
      direction,
      blockId: id,
      linkpath: storedLinkpath,
      linktext,
      path: resolvedPath,
      label: label || null,
      kind: "relation",
      alsoMentioned: Boolean(alsoMentioned),
      inverse,
      // Stale chips keep their underlying state; the `is-stale` class
      // (dashed, muted) carries the staleness. Colour carries status.
      state,
      symbol,
      text: broken ? "^" + id + " not found" : relationShortText(fullText),
      fullText,
      noteLabel,
      tooltip,
      ariaLabel: stale && !broken ? fullText + " · stale" : fullText,
      removeLabel,
      live: Boolean(live),
      stale: Boolean(stale),
      broken,
      archived,
      hidden,
      collapsed: false,
    };
  } catch (error) {
    return null;
  }
}

function relationFitMentionQuote(marked, limit = 80) {
  try {
    const value = String(marked || "").trim();
    const open = value.indexOf("⟦");
    const close = open < 0 ? -1 : value.indexOf("⟧", open + 1);
    if (open < 0 || close < 0) return null;
    const points = Array.from(value);
    const start = Array.from(value.slice(0, open)).length;
    const end = Array.from(value.slice(0, close + 1)).length;
    const max = Math.max(24, Math.floor(Number(limit) || 80));
    const tokenLength = end - start;
    if (points.length <= max) return value;
    if (tokenLength >= max - 2) {
      return "…" + points.slice(start, end).join("") + "…";
    }
    const room = max - tokenLength - 2;
    let left = Math.min(start, Math.floor(room / 2));
    let right = Math.min(points.length - end, room - left);
    if (left < Math.floor(room / 2)) right = Math.min(points.length - end, room - left);
    if (right < room - left) left = Math.min(start, room - right);
    const prefix = start > left ? "…" : "";
    const suffix = points.length - end > right ? "…" : "";
    return prefix + points.slice(start - left, start).join("") + points.slice(start, end).join("") + points.slice(end, end + right).join("") + suffix;
  } catch (error) {
    return null;
  }
}

function relationBuildMentionChip({ linkpath, blockId, task, otherPath, live, stale, resolved, sourcePath, display, count, occurrences }) {
  try {
    const base = relationBuildChip({
      direction: "from",
      linkpath,
      blockId,
      label: RELATION_MENTION_LABEL,
      task,
      otherPath,
      live,
      stale,
      resolved,
      sourcePath,
    });
    if (!base) return null;
    const rows = Array.isArray(occurrences) ? occurrences.map((occurrence) => ({ ...occurrence })) : [];
    const shownDisplay = display === "embed" ? "embed" : "mention";
    const firstQuote = shownDisplay === "mention"
      ? rows.find((occurrence) => occurrence && occurrence.site !== "title" && typeof occurrence.excerpt === "string" && occurrence.excerpt.includes("⟦") && occurrence.excerpt.includes("⟧"))
      : null;
    base.kind = "mention";
    base.label = null;
    base.alsoMentioned = false;
    base.display = shownDisplay;
    base.count = Math.max(0, Number(count) || rows.length || 0);
    base.occurrences = rows;
    base.quote = firstQuote ? relationFitMentionQuote(firstQuote.excerpt, 80) : null;
    base.mentionPill = shownDisplay === "embed" ? "💬 embedded in" : "💬 mentioned in";
    base.pillAriaLabel = "Why is this here? " + base.fullText + (shownDisplay === "embed" ? " embeds this task" : " mentions this task") + " in its text";
    base.removeLabel = null;
    base.tooltip = stale ? RELATION_MENTION_STALE_TOOLTIP : base.tooltip;
    base.ariaLabel = base.pillAriaLabel;
    return base;
  } catch (error) {
    return null;
  }
}

function relationApplyChipGroupRules(chips, groupKind) {
  const rows = Array.isArray(chips) ? chips : [];
  const closed = rows.filter((chip) => chip && chip.live && !chip.broken && chip.state === "done");
  let collapsed = null;
  if (closed.length >= 3) {
    for (const chip of closed) chip.collapsed = true;
    collapsed = { count: closed.length };
  }
  let more = null;
  if (groupKind === "mentions") {
    const open = rows.filter((chip) => chip && !chip.broken && chip.state !== "done" && chip.state !== "cancelled");
    if (open.length > 5) {
      for (const chip of open.slice(5)) chip.densityCollapsed = true;
      more = { count: open.length - 5 };
    }
  }
  return { chips: rows, collapsed, more };
}

// Merge one relation row's stored entries with its live index edges.
// `stored` are `parseTaskRelationLine` entries `{ target, blockId, label }`;
// `live` are index edges whose `other` is the displayed end (the target for
// LINKS, the source for LINKED FROM) with `{ path, blockId, task }` plus
// the edge `label`. `lookup(path, blockId)` resolves a stored link to a
// task record or null; `resolve(linkpath)` maps a stored linkpath to a
// vault-relative path. Returns null unless the line parses as the
// requested direction (LC13).
function relationChipModelForRow({ direction, lineText, sourcePath, live, lookup, resolve }) {
  try {
    const parsed = parseTaskRelationLine(String(lineText || ""));
    // An empty row still renders live edges appended in canonical order
    // (LC7); malformed and not-a-line rows never get chips (LC13).
    if (!parsed || (parsed.verdict !== "accepted" && parsed.verdict !== "empty")) return null;
    if (direction === "to" && parsed.kind !== "links") return null;
    if (direction === "from" && parsed.kind !== "linkedFrom") return null;
    const source = String(sourcePath || "");
    const lookupFn = typeof lookup === "function" ? lookup : () => null;
    const resolveFn = typeof resolve === "function"
      ? resolve
      : (linkpath) => (String(linkpath || "").trim() ? String(linkpath).replace(/\.md$/i, "") + ".md" : source);
    const liveRows = Array.isArray(live) ? live : [];
    const liveByKey = new Map();
    for (const edge of liveRows) {
      try {
        if (!edge || typeof edge !== "object") continue;
        const other = edge.other && typeof edge.other === "object" ? edge.other : null;
        const otherPath = other ? String(other.path || "") : "";
        const otherId = other ? String(other.blockId || "") : "";
        if (!otherId) continue;
        const key = otherPath ? otherPath + "\u0000" + otherId : "\u0000" + otherId;
        if (!liveByKey.has(key)) liveByKey.set(key, edge);
      } catch (error) {
        continue;
      }
    }
    const relationChips = [];
    const mentionChips = [];
    const consumed = new Set();
    const stored = Array.isArray(parsed.entries) ? parsed.entries : [];
    for (const entry of stored) {
      try {
        const entryId = String((entry && entry.blockId) || "");
        if (!entryId) continue;
        let entryPath = "";
        try {
          entryPath = String(resolveFn((entry && entry.target) || "", source) || "");
        } catch (error) {
          entryPath = "";
        }
        const exact = entryPath ? entryPath + "\u0000" + entryId : null;
        let edge = exact && liveByKey.has(exact) && !consumed.has(exact) ? liveByKey.get(exact) : null;
        if (!edge) {
          const loose = "\u0000" + entryId;
          if (liveByKey.has(loose) && !consumed.has(loose)) edge = liveByKey.get(loose);
        }
        let task = null;
        let otherPath = entryPath;
        let label = (entry && entry.label) || null;
        let resolved = false;
        if (edge) {
          const key = (edge.other && edge.other.path ? String(edge.other.path) + "\u0000" : "\u0000") + entryId;
          consumed.add(exact && liveByKey.get(exact) === edge ? exact : key);
          consumed.add(key);
          const other = edge.other || {};
          otherPath = String(other.path || entryPath || "");
          if (edge.label) label = edge.label;
          resolved = typeof other.resolved === "boolean" ? other.resolved : Boolean(other.path);
          task = (other.task && typeof other.task === "object" ? other.task : null)
            || lookupFn(otherPath, entryId);
        } else {
          task = lookupFn(entryPath, entryId);
        }
        const isMention = Boolean((entry && entry.kind === "mention") || (edge && edge.kind === "mention") || label === RELATION_MENTION_LABEL);
        const chip = isMention
          ? relationBuildMentionChip({
            linkpath: (entry && entry.target) || "", blockId: entryId, task, otherPath,
            live: Boolean(edge), stale: !edge, resolved, sourcePath: source,
            display: edge && edge.display, count: edge && edge.count, occurrences: edge && edge.occurrences,
          })
          : relationBuildChip({
            direction, linkpath: (entry && entry.target) || "", blockId: entryId,
            label, task, otherPath, live: Boolean(edge), stale: !edge, resolved, sourcePath: source,
            alsoMentioned: Boolean(edge && edge.alsoMentioned),
          });
        if (chip) (isMention ? mentionChips : relationChips).push(chip);
      } catch (error) {
        continue;
      }
    }
    const missing = [];
    for (const [key, edge] of liveByKey) {
      if (!consumed.has(key)) missing.push(edge);
    }
    missing.sort((a, b) => relationCompareLinktext(
      relationEdgeLinktext(a && a.other && a.other.path, a && a.other && a.other.blockId, source),
      relationEdgeLinktext(b && b.other && b.other.path, b && b.other && b.other.blockId, source),
    ));
    for (const edge of missing) {
      try {
        const other = (edge && edge.other) || {};
        const otherId = String(other.blockId || "");
        if (!otherId) continue;
        const otherPath = String(other.path || "");
        const task = (other.task && typeof other.task === "object" ? other.task : null)
          || lookupFn(otherPath, otherId);
        // An unresolvable live edge with no task record is broken, not
        // appended: only the stored text can name it (LC4).
        if (!otherPath && !task) continue;
        const isMention = Boolean(edge && edge.kind === "mention");
        const chip = isMention
          ? relationBuildMentionChip({
            linkpath: "", blockId: otherId, task, otherPath, live: true, stale: false,
            resolved: true, sourcePath: source, display: edge.display, count: edge.count,
            occurrences: edge.occurrences,
          })
          : relationBuildChip({
            direction, linkpath: "", blockId: otherId, label: (edge && edge.label) || null,
            task, otherPath, live: true, stale: false, sourcePath: source,
            alsoMentioned: Boolean(edge && edge.alsoMentioned),
          });
        if (chip) (isMention ? mentionChips : relationChips).push(chip);
      } catch (error) {
        continue;
      }
    }
    const relationGroup = relationApplyChipGroupRules(relationChips, "relations");
    const mentionGroup = relationApplyChipGroupRules(mentionChips, "mentions");
    const chips = [...relationChips, ...mentionChips];
    const labelled = relationChips.some((chip) => chip && chip.label) || mentionChips.length > 0;
    const liveCount = chips.filter((chip) => chip && chip.live).length;
    return {
      direction,
      kind: parsed.kind,
      label: direction === "to" ? "🪢 links to" : "🪢 linked from",
      tooltip: direction === "to" ? RELATION_LINKS_ROW_TOOLTIP : RELATION_LINKED_FROM_MENTIONS_TOOLTIP,
      chips,
      groups: { relations: relationGroup, mentions: mentionGroup },
      collapsed: relationGroup.collapsed,
      labelled,
      liveCount,
      storedCount: chips.length,
    };
  } catch (error) {
    return null;
  }
}

function relationAttachChipRemove(el, chip, doc, onRemove) {
  try {
    if (!el || !chip || !doc || typeof doc.createElement !== "function") return;
    const remove = doc.createElement("span");
    remove.setAttribute("class", "bob-dep-chip-remove");
    remove.setAttribute("role", "button");
    remove.setAttribute("tabindex", "0");
    remove.setAttribute("aria-label", String(chip.removeLabel || ("Remove " + (chip.fullText || ""))));
    remove.setAttribute("title", String(chip.removeLabel || "Remove"));
    remove.appendChild(doc.createTextNode("×"));
    if (typeof remove.addEventListener === "function") {
      const fire = (event) => {
        try {
          if (event && typeof event.stopPropagation === "function") event.stopPropagation();
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          if (typeof onRemove === "function") onRemove(chip, event);
        } catch (error) {
          // Best-effort only.
        }
      };
      remove.addEventListener("click", fire);
      remove.addEventListener("keydown", (event) => {
        if (event && (event.key === "Enter" || event.key === " ")) fire(event);
      });
    }
    el.appendChild(remove);
  } catch (error) {
    // Listener-free remove still renders.
  }
}

function relationAttachAddControl(row, doc, model, onAdd) {
  try {
    if (!row || !doc || typeof doc.createElement !== "function") return;
    const add = doc.createElement("span");
    add.setAttribute("class", "bob-dep-add");
    add.setAttribute("role", "button");
    add.setAttribute("tabindex", "0");
    const addLabel = model && model.direction === "from"
      ? "Choose a task that links here"
      : "Link this task to another";
    add.setAttribute("aria-label", addLabel);
    add.setAttribute("title", addLabel);
    add.appendChild(doc.createTextNode("＋"));
    if (typeof add.addEventListener === "function") {
      const fire = (event) => {
        try {
          if (event && typeof event.stopPropagation === "function") event.stopPropagation();
          if (typeof onAdd === "function") onAdd(event);
        } catch (error) {
          // Best-effort only.
        }
      };
      add.addEventListener("click", fire);
      add.addEventListener("keydown", (event) => {
        if (event && (event.key === "Enter" || event.key === " ")) {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          fire(event);
        }
      });
    }
    row.appendChild(add);
  } catch (error) {
    // Add button is best-effort.
  }
}

function relationChipAriaLabel(chip) {
  try {
    if (!chip || typeof chip !== "object") return "relation";
    if (chip.kind === "mention") return String(chip.fullText || chip.text || "Task") + " · " + (chip.display === "embed" ? "embedded in" : "mentioned in") + " its text" + (chip.stale ? " · stale" : "");
    const parts = [String(chip.fullText || chip.text || "relation")];
    if (chip.direction === "from" && chip.inverse) parts.push("· " + chip.inverse);
    else if (chip.label) parts.push("· " + chip.label);
    if (chip.stale) parts.push("· stale");
    if (chip.broken) parts.push("· missing");
    return parts.join(" ");
  } catch (error) {
    return "relation";
  }
}

// Live Preview row element. `model` is `relationChipModelForRow(...)`;
// `options` carries `{ sourcePath, interactive, onOpen(linktext, event,
// chip), onHover(linktext, event, chipEl), onRemove(chip, event),
// onAdd(event) }`. Labelled rows wrap one entry per visual row;
// unlabelled rows wrap between chips; entries never change line height
// (LC10). Closed and archived targets are dimmed and never struck;
// `#hide` targets are muted. Never throws.
function buildRelationChipElement(doc, model, options) {
  try {
    if (!doc || !model || typeof model !== "object") return null;
    const opts = options && typeof options === "object" ? options : {};
    const interactive = Boolean(opts.interactive);
    const groups = relationChipGroups(model);
    const row = doc.createElement("span");
    const rowClasses = ["bob-dep-row", "bob-relation-row"];
    if (model.direction === "from") rowClasses.push("is-incoming");
    if (model.labelled) rowClasses.push("is-labelled");
    row.setAttribute("class", rowClasses.join(" "));
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", String(model.tooltip || model.label || "relations"));
    if (model.tooltip) row.setAttribute("title", String(model.tooltip));
    const label = doc.createElement("span");
    label.setAttribute("class", "bob-dep-label bob-relation-label");
    label.setAttribute("aria-hidden", "true");
    label.appendChild(doc.createTextNode(String(model.label || "🪢 relations")));
    row.appendChild(label);
    const buildChipEl = (chip) => {
      const el = doc.createElement("span");
      const classes = ["bob-dep-chip", "bob-relation-chip", "is-" + String(chip.state || "todo")];
      if (chip.kind === "mention") classes.push("is-mention");
      if (chip.stale) classes.push("is-stale");
      if (chip.broken) classes.push("is-broken");
      if (chip.archived) classes.push("is-archived");
      if (chip.hidden) classes.push("is-muted");
      el.setAttribute("class", classes.join(" "));
      el.setAttribute("data-state", String(chip.state || "todo"));
      el.setAttribute("role", "link");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", relationChipAriaLabel(chip));
      if (chip.tooltip) el.setAttribute("title", String(chip.tooltip));
      const box = doc.createElement("span");
      box.setAttribute("class", "bob-dep-chip-box");
      box.setAttribute("data-task", String(chip.state || "todo"));
      box.setAttribute("aria-hidden", "true");
      box.appendChild(doc.createTextNode(String(chip.symbol || "○")));
      el.appendChild(box);
      const text = doc.createElement("span");
      text.setAttribute("class", "bob-dep-chip-text");
      text.appendChild(doc.createTextNode(String(chip.text || "")));
      el.appendChild(text);
      if (chip.noteLabel) {
        const note = doc.createElement("span");
        note.setAttribute("class", "bob-dep-chip-note");
        note.appendChild(doc.createTextNode(String(chip.noteLabel)));
        el.appendChild(note);
      }
      if (interactive && chip.kind !== "mention" && chip.live && !chip.broken) {
        relationAttachChipRemove(el, chip, doc, opts.onRemove);
      }
      if (typeof el.addEventListener === "function") {
        const open = (event) => {
          try {
            if (event && event.target && event.target.classList && typeof event.target.classList.contains === "function") {
              try {
                if (event.target.classList.contains("bob-dep-chip-remove")) return;
              } catch (inner) {
                // Fall through to open.
              }
            }
            if (typeof opts.onOpen === "function" && chip.linktext) opts.onOpen(chip.linktext, event, chip);
          } catch (error) {
            // A failed open never breaks other chips.
          }
        };
        el.addEventListener("click", open);
        el.addEventListener("keydown", (event) => {
          if (event && (event.key === "Enter" || event.key === " ")) {
            if (typeof event.preventDefault === "function") event.preventDefault();
            open(event);
          }
        });
        el.addEventListener("mouseover", (event) => {
          try {
            if (typeof opts.onHover === "function" && chip.linktext) opts.onHover(chip.linktext, event, el);
          } catch (error) {
            // Hover preview is best-effort.
          }
        });
      }
      return el;
    };
    const buildPill = (text) => {
      const pill = doc.createElement("span");
      pill.setAttribute("class", "bob-relation-pill");
      pill.appendChild(doc.createTextNode(String(text || "")));
      return pill;
    };
    const buildArrow = (text) => {
      const arrow = doc.createElement("span");
      arrow.setAttribute("class", "bob-relation-arrow");
      arrow.setAttribute("aria-hidden", "true");
      arrow.appendChild(doc.createTextNode(String(text === undefined ? "→" : text)));
      return arrow;
    };
    const buildEntry = (kind, chip) => {
      try {
        const entry = doc.createElement("span");
        entry.setAttribute("class", "bob-relation-entry" + (kind === "mentions" ? " is-mention" : ""));
        const chipEl = buildChipEl(chip);
        if (kind === "mentions") {
          entry.appendChild(relationCreateMentionPill(doc, chip, opts));
          entry.appendChild(chipEl);
          if (chip.quote) relationAppendMentionQuote(entry, chip.quote, doc);
        } else {
          if (model.direction === "to") {
            if (chip.label) {
              entry.appendChild(buildPill(chip.label));
              entry.appendChild(buildArrow());
            }
            entry.appendChild(chipEl);
          } else if (chip.inverse) {
            entry.appendChild(buildPill(chip.inverse));
            entry.appendChild(chipEl);
          } else if (chip.label) {
            entry.appendChild(chipEl);
            const sep = doc.createElement("span");
            sep.setAttribute("class", "bob-relation-sep");
            sep.setAttribute("aria-hidden", "true");
            sep.appendChild(doc.createTextNode("·"));
            entry.appendChild(sep);
            entry.appendChild(buildPill(chip.label));
            entry.appendChild(buildArrow("→ this"));
          } else {
            entry.appendChild(chipEl);
          }
          if (chip.alsoMentioned) relationAppendMixedMentionMarker(entry, doc);
        }
        return entry;
      } catch (error) {
        return null;
      }
    };
    if (!model.labelled && model.direction === "to") {
      // LC1: an unlabelled LINKS row reads `🪢 links to → (chip)`.
      row.appendChild(buildArrow());
    }
    const appendGroup = (kind, group) => {
      const chips = Array.isArray(group && group.chips) ? group.chips : [];
      if (chips.length === 0) return null;
      const host = doc.createElement("span");
      host.setAttribute("class", kind === "mentions" ? "bob-relation-group bob-relation-mention-group" : "bob-relation-group bob-relation-link-group");
      for (const chip of chips) {
        if (!chip || chip.collapsed || chip.densityCollapsed) continue;
        if (kind === "relations" && model.direction === "to" && !model.labelled) {
          host.appendChild(buildChipEl(chip));
        } else {
          const entry = buildEntry(kind, chip);
          if (entry) host.appendChild(entry);
        }
      }
      const addToggle = (count, toggleKind, hidden) => {
        if (!count || hidden.length === 0) return;
        const toggle = doc.createElement("span");
        const noun = kind === "mentions" ? "mentions" : "relations";
        const text = toggleKind === "more" ? "+" + count + " more" : "✓×" + count;
        toggle.setAttribute("class", "bob-dep-chip bob-relation-collapsed" + (toggleKind === "more" ? " bob-relation-more" : " is-done-collapsed"));
        toggle.setAttribute("role", "button");
        toggle.setAttribute("tabindex", "0");
        toggle.setAttribute("aria-label", toggleKind === "more" ? "Show " + count + " more mentions" : "Show " + count + " closed " + noun);
        toggle.setAttribute("title", toggleKind === "more" ? text : text + " closed " + noun);
        toggle.appendChild(doc.createTextNode(text));
        const expand = () => {
          try {
            for (const chip of hidden) {
              if (kind === "relations" && model.direction === "to" && !model.labelled) {
                host.insertBefore(buildChipEl(chip), toggle);
              } else {
                const entry = buildEntry(kind, chip);
                if (entry) host.insertBefore(entry, toggle);
              }
            }
            if (typeof toggle.remove === "function") toggle.remove();
            else if (toggle.parentNode && typeof toggle.parentNode.removeChild === "function") toggle.parentNode.removeChild(toggle);
          } catch (error) {
            // A collapsed group never breaks the other rows.
          }
        };
        if (typeof toggle.addEventListener === "function") {
          toggle.addEventListener("click", expand);
          toggle.addEventListener("keydown", (event) => {
            if (event && (event.key === "Enter" || event.key === " ")) {
              if (typeof event.preventDefault === "function") event.preventDefault();
              expand();
            }
          });
        }
        host.appendChild(toggle);
      };
      addToggle(group.collapsed && Number(group.collapsed.count), "closed", chips.filter((chip) => chip && chip.collapsed));
      addToggle(group.more && Number(group.more.count), "more", chips.filter((chip) => chip && chip.densityCollapsed));
      row.appendChild(host);
      return host;
    };
    const relationHost = appendGroup("relations", groups.relations);
    if (relationHost && groups.mentions.chips.length > 0) {
      const divider = doc.createElement("span");
      divider.setAttribute("class", "bob-relation-divider");
      divider.setAttribute("aria-hidden", "true");
      row.appendChild(divider);
    }
    appendGroup("mentions", groups.mentions);
    if (interactive) relationAttachAddControl(row, doc, model, opts.onAdd);
    return row;
  } catch (error) {
    return null;
  }
}
