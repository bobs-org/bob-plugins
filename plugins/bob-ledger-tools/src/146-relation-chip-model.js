// Task relation chips (ledger-chips). Pure model and element builder
// for one aggregated `🪢 links` block per task. Chips render the live
// relation index, never the stored mirror: a stored entry with no live
// edge is stale (LC8), a live edge missing from the text is appended in
// canonical order (LC7), and an unresolvable target is broken (LC4).
// Redundant plain records (a pair that also has a statement) render
// nothing. Reuses the `bob-dep-*` DOM family with no new palette. Plain
// chips carry no arrow (LC1); statements are one entry per visual row
// (LC10) with muted small-caps label pills; inverse phrases are
// display-only. Three or more closed chips collapse to `✓×N` (LC9).
// Never throws.
const RELATION_STALE_TOOLTIP =
  "No longer links here · refreshes on the next reconcile";
const RELATION_BLOCK_ROW_TOOLTIP = "Related tasks · live";

// Display-only inverse phrases (docs/task-relations.md §10). Storage
// stays verbatim; matching is case-insensitive.
const RELATION_INVERSE_PHRASES = [
  ["merged into", "merged from"],
  ["duplicate of", "duplicated by"],
  ["follow-up of", "followed up by"],
  ["superseded by", "supersedes"],
  ["split from", "split into"],
];

function relationInversePhrase(label) {
  try {
    const needle = String(label || "").trim().toLocaleLowerCase();
    if (!needle) return null;
    for (const pair of RELATION_INVERSE_PHRASES) {
      if (String(pair[0]).toLocaleLowerCase() === needle) return pair[1];
    }
    return null;
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

function relationBuildChip({ direction, linkpath, blockId, label, task, otherPath, live, stale, resolved, sourcePath, relKind, peer, storedOn }) {
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
    const kind = relKind === "statement" ? "statement" : relKind === "plain" ? "plain" : direction === "from" ? "statement" : "plain";
    let removeLabel = null;
    if (kind === "plain") removeLabel = "Unlink " + fullText;
    else removeLabel = "Remove '" + String(label || "") + "'";
    let relAction = null;
    try {
      const peerRef = peer && typeof peer === "object"
        ? { path: String(peer.path || ""), blockId: String(peer.blockId || "") }
        : { path: String(resolvedPath || ""), blockId: id };
      if (kind === "plain") {
        relAction = { kind: "plain", storedOn: storedOn || null, peer: peerRef };
      } else {
        relAction = { kind: "statement", label: label || null, source: null, target: null, peer: peerRef };
      }
    } catch (error) {
      relAction = null;
    }
    return {
      direction,
      relKind: kind,
      relAction,
      storedOn: storedOn || null,
      peer: peer && typeof peer === "object" ? { path: String(peer.path || ""), blockId: String(peer.blockId || "") } : null,
      blockId: id,
      linkpath: storedLinkpath,
      linktext,
      path: resolvedPath,
      label: label || null,
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

// One aggregated `🪢 links` block for a task, built from the live pair
// view plus both stored relation lines. `outgoing` / `incoming` are full
// live edge arrays (`{ label, other: { path, blockId, ... } }`) whose
// `other` is the displayed end; group them with
// `relationGroupRelatedEdges` (same helper as `api.relationIndex.related`).
// `linksText` / `linkedFromText` are the task's stored relation lines
// (null when absent). `lookup(path, blockId)` resolves a link to a task
// record or null; `resolve(linkpath)` maps a stored linkpath to a
// vault-relative path. `owner` is `{ blockId, line, text }` (line 1-based,
// blockId possibly null). A stored entry covered by a grouped entry
// renders through that entry; an uncovered stored entry is stale (LC8) and
// a redundant plain record renders nothing (LC17). Returns null unless at
// least one stored line parses (LC13), or when the task has no relations
// at all so the raw lines stay as-is.
function relationBlockModelForTask({ sourcePath, owner, linksText, linkedFromText, outgoing, incoming, grouped: providedGrouped, lookup, resolve }) {
  try {
    const source = String(sourcePath || "");
    const ownerId = owner && owner.blockId ? String(owner.blockId) : "";
    const lookupFn = typeof lookup === "function" ? lookup : () => null;
    const resolveFn = typeof resolve === "function"
      ? resolve
      : (linkpath) => (String(linkpath || "").trim() ? String(linkpath).replace(/\.md$/i, "") + ".md" : source);
    const parseLine = (text, kind) => {
      if (text === null || text === undefined) return null;
      const parsed = parseTaskRelationLine(String(text));
      if (!parsed || (parsed.verdict !== "accepted" && parsed.verdict !== "empty")) return null;
      if (parsed.kind !== kind) return null;
      return parsed;
    };
    const links = parseLine(linksText, "links");
    const linkedFrom = parseLine(linkedFromText, "linkedFrom");
    if (!links && !linkedFrom) return null;
    const outgoingRows = Array.isArray(outgoing) ? outgoing : [];
    const incomingRows = Array.isArray(incoming) ? incoming : [];
    // Mount code passes the `api.relationIndex.related()` view straight
    // through so plain, outgoing, and incoming come from one generation;
    // tests and the no-`related` fallback pass raw edge arrays instead.
    const grouped = providedGrouped && typeof providedGrouped === "object"
      ? {
        plain: Array.isArray(providedGrouped.plain) ? providedGrouped.plain : [],
        outgoing: Array.isArray(providedGrouped.outgoing) ? providedGrouped.outgoing : [],
        incoming: Array.isArray(providedGrouped.incoming) ? providedGrouped.incoming : [],
      }
      : relationGroupRelatedEdges(source, ownerId, outgoingRows, incomingRows);
    // Coverage: a stored entry is live when a grouped entry names the
    // same other task (exact path match, or blockId-only when either
    // side has no path). A redundant plain record is covered by the
    // pair's statement, so it renders nothing.
    const covers = (entries, entryPath, entryId) => entries.some((item) => {
      const other = item && item.other ? item.other : null;
      if (!other || String(other.blockId || "") !== String(entryId || "")) return false;
      const otherPath = String(other.path || "");
      return !otherPath || !entryPath || otherPath === entryPath;
    });
    // Only a rendered entry covers its stored row: an unresolvable live
    // edge with no task record (LC4) leaves the stored entry to render
    // as broken instead of swallowing it.
    const renderable = (item) => {
      const other = item && item.other ? item.other : null;
      if (!other) return false;
      return Boolean(other.path)
        || (other.task && typeof other.task === "object")
        || Boolean(other.text) || Boolean(other.status);
    };
    const allRelated = [...grouped.plain, ...grouped.outgoing, ...grouped.incoming].filter(renderable);
    const taskFor = (other, entryPath, entryId) => {
      if (other && other.task && typeof other.task === "object") return other.task;
      const path = String((other && other.path) || entryPath || "");
      const id = String((other && other.blockId) || entryId || "");
      let found = null;
      try {
        found = lookupFn(path, id);
      } catch (error) {
        found = null;
      }
      if (found && typeof found === "object") return found;
      // Index rows carry raw note text when the Tasks memo omits the
      // note (done/ archives); surface it when memo lookup misses.
      if (other && (other.text || other.status)) {
        return { path, blockId: id, text: other.text || null, status: other.status || null };
      }
      return null;
    };
    const chipForRelated = (item, direction, relKind, storedOn) => {
      const other = item && item.other ? item.other : {};
      const otherPath = String(other.path || "");
      const otherId = String(other.blockId || "");
      if (!otherId) return null;
      const task = taskFor(other, otherPath, otherId);
      // An unresolvable live edge with no task record is broken, not
      // appended: only the stored text can name it (LC4).
      if (!otherPath && !task) return null;
      return relationBuildChip({
        direction, linkpath: "", blockId: otherId, label: item.label || null,
        task, otherPath, live: true, stale: false,
        resolved: typeof other.resolved === "boolean" ? other.resolved : Boolean(otherPath),
        sourcePath: source, relKind, peer: { path: otherPath, blockId: otherId }, storedOn: storedOn || null,
      });
    };
    const plain = [];
    for (const item of grouped.plain) {
      const chip = chipForRelated(item, "to", "plain", item.storedOn);
      if (chip) plain.push(chip);
    }
    const outgoingChips = [];
    for (const edge of grouped.outgoing) {
      const chip = chipForRelated(edge, "to", "statement", "this");
      if (chip) outgoingChips.push(chip);
    }
    const incomingChips = [];
    for (const edge of grouped.incoming) {
      const chip = chipForRelated(edge, "from", "statement", "other");
      if (chip) incomingChips.push(chip);
    }
    // Stale leftovers: stored entries no grouped entry covers, in stored
    // order (LINKS leftovers join the plain or outgoing section by label,
    // LINKED FROM leftovers join the plain or incoming section).
    const stalePlain = [];
    const staleOutgoing = [];
    const staleIncoming = [];
    const collectStale = (parsed, section) => {
      for (const entry of Array.isArray(parsed && parsed.entries) ? parsed.entries : []) {
        try {
          const entryId = String((entry && entry.blockId) || "");
          if (!entryId) continue;
          let entryPath = "";
          try {
            entryPath = String(resolveFn((entry && entry.target) || "", source) || "");
          } catch (error) {
            entryPath = "";
          }
          if (covers(allRelated, entryPath, entryId)) continue;
          const label = (entry && entry.label) || null;
          const task = taskFor(null, entryPath, entryId);
          const chip = relationBuildChip({
            direction: section === "incoming" ? "from" : "to",
            linkpath: (entry && entry.target) || "", blockId: entryId,
            label, task, otherPath: entryPath, live: false, stale: true,
            resolved: Boolean(task), sourcePath: source,
            relKind: label ? "statement" : "plain",
            peer: { path: entryPath, blockId: entryId }, storedOn: null,
          });
          if (!chip) continue;
          if (label) (section === "incoming" ? staleIncoming : staleOutgoing).push(chip);
          else stalePlain.push(chip);
        } catch (error) {
          continue;
        }
      }
    };
    collectStale(links, "outgoing");
    collectStale(linkedFrom, "incoming");
    const chips = [...plain, ...stalePlain, ...outgoingChips, ...staleOutgoing, ...incomingChips, ...staleIncoming];
    if (!chips.length) return null;
    const closed = chips.filter((chip) => chip && chip.live && !chip.broken && chip.state === "done");
    let collapsed = null;
    if (closed.length >= 3) {
      for (const chip of closed) chip.collapsed = true;
      collapsed = { count: closed.length };
    }
    const labelled = chips.some((chip) => chip && chip.label);
    const liveCount = chips.filter((chip) => chip && chip.live).length;
    return {
      kind: "block",
      label: "🪢 links",
      tooltip: RELATION_BLOCK_ROW_TOOLTIP,
      hasContinuation: Boolean(links && linkedFrom),
      plain: [...plain, ...stalePlain],
      outgoing: [...outgoingChips, ...staleOutgoing],
      incoming: [...incomingChips, ...staleIncoming],
      chips,
      collapsed,
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
    const addLabel = "Link another task";
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

// Live Preview block element. `model` is `relationBlockModelForTask(...)`;
// `options` carries `{ mode: "full" | "continuation", sourcePath,
// interactive, onOpen(linktext, event, chip), onHover(linktext, event,
// chipEl), onRemove(chip, event), onAdd(event) }`. Full mode renders the
// `🪢 links` heading, plain chips, and outgoing statements (plus incoming
// statements when the task has no second relation line); continuation
// mode renders only the incoming statements under no heading (LC18
// fallback: a block replace decoration must come from a StateField, which
// the refresh fan-out cannot drive yet). Statements wrap one entry per
// visual row (LC10); entries never change line height. Closed and
// archived targets are dimmed and never struck; `#hide` targets are
// muted. Never throws.
function buildRelationBlockElement(doc, model, options) {
  try {
    if (!doc || !model || typeof model !== "object") return null;
    const opts = options && typeof options === "object" ? options : {};
    const interactive = Boolean(opts.interactive);
    const continuation = opts.mode === "continuation";
    const row = doc.createElement("span");
    const rowClasses = ["bob-dep-row", "bob-relation-row", "bob-relation-block"];
    if (continuation) rowClasses.push("bob-relation-continuation");
    if (model.labelled) rowClasses.push("is-labelled");
    row.setAttribute("class", rowClasses.join(" "));
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", String(model.label || "🪢 links") + ", " + model.liveCount + " live");
    if (model.tooltip) row.setAttribute("title", String(model.tooltip));
    if (!continuation) {
      const label = doc.createElement("span");
      label.setAttribute("class", "bob-dep-label bob-relation-label");
      label.setAttribute("aria-hidden", "true");
      label.appendChild(doc.createTextNode(String(model.label || "🪢 links")));
      row.appendChild(label);
    }
    const buildChipEl = (chip) => {
      const el = doc.createElement("span");
      const classes = ["bob-dep-chip", "bob-relation-chip", "is-" + String(chip.state || "todo")];
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
      if (interactive && chip.live && !chip.broken) {
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
    const appendStatementEntry = (host, chip) => {
      try {
        const entry = doc.createElement("span");
        entry.setAttribute("class", "bob-relation-entry");
        if (chip.direction === "from") {
          if (chip.inverse) {
            entry.appendChild(buildPill(chip.inverse));
            entry.appendChild(buildChipEl(chip));
          } else if (chip.label) {
            entry.appendChild(buildChipEl(chip));
            const sep = doc.createElement("span");
            sep.setAttribute("class", "bob-relation-sep");
            sep.setAttribute("aria-hidden", "true");
            sep.appendChild(doc.createTextNode("·"));
            entry.appendChild(sep);
            entry.appendChild(buildPill(chip.label));
            entry.appendChild(buildArrow("→ this"));
          } else {
            entry.appendChild(buildChipEl(chip));
          }
        } else {
          if (chip.label) {
            entry.appendChild(buildPill(chip.label));
            entry.appendChild(buildArrow());
          }
          entry.appendChild(buildChipEl(chip));
        }
        host.appendChild(entry);
      } catch (error) {
        // One bad entry never breaks the block.
      }
    };
    const plain = Array.isArray(model.plain) ? model.plain : [];
    const outgoing = Array.isArray(model.outgoing) ? model.outgoing : [];
    const incoming = Array.isArray(model.incoming) ? model.incoming : [];
    // Continuation mode shows the incoming statements only; full mode
    // shows them too unless a second relation line carries them.
    const sections = continuation
      ? [incoming]
      : (model.hasContinuation ? [plain, outgoing] : [plain, outgoing, incoming]);
    for (const section of sections) {
      for (const chip of section) {
        if (!chip || chip.collapsed) continue;
        if (chip.label) appendStatementEntry(row, chip);
        else {
          try {
            row.appendChild(buildChipEl(chip));
          } catch (error) {
            // One bad chip never breaks the block.
          }
        }
      }
    }
    if (model.collapsed && Number(model.collapsed.count) > 0) {
      const count = Number(model.collapsed.count);
      const collapsed = doc.createElement("span");
      collapsed.setAttribute("class", "bob-dep-chip is-done-collapsed bob-relation-collapsed");
      collapsed.setAttribute("role", "button");
      collapsed.setAttribute("tabindex", "0");
      collapsed.setAttribute("aria-label", "Show " + count + " closed relations");
      collapsed.setAttribute("title", "✓×" + count + " closed");
      collapsed.appendChild(doc.createTextNode("✓×" + count));
      const expand = () => {
        try {
          for (const chip of (Array.isArray(model.chips) ? model.chips : [])) {
            if (!chip || !chip.collapsed) continue;
            const fresh = { ...chip, collapsed: false };
            if (fresh.label) appendStatementEntry(row, fresh);
            else row.insertBefore(buildChipEl(fresh), collapsed);
          }
          if (typeof collapsed.remove === "function") collapsed.remove();
          else if (collapsed.parentNode && typeof collapsed.parentNode.removeChild === "function") {
            collapsed.parentNode.removeChild(collapsed);
          }
        } catch (error) {
          // An unexpanded block never breaks the chips.
        }
      };
      if (typeof collapsed.addEventListener === "function") {
        collapsed.addEventListener("click", expand);
        collapsed.addEventListener("keydown", (event) => {
          if (event && (event.key === "Enter" || event.key === " ")) {
            if (typeof event.preventDefault === "function") event.preventDefault();
            expand();
          }
        });
      }
      row.appendChild(collapsed);
    }
    if (interactive && !continuation) relationAttachAddControl(row, doc, model, opts.onAdd);
    return row;
  } catch (error) {
    return null;
  }
}
