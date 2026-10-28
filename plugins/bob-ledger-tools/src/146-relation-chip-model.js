// Task relation chips (bob-cli-a2 chips). Pure model and element builder
// for live LINKS and LINKED FROM rows. Chips render the live relation
// index, never the stored mirror: a stored entry with no live edge is
// stale (LC8), a live edge missing from the text is appended in canonical
// order (LC7), and an unresolvable LINKS target is broken (LC4). Reuses
// the `bob-dep-*` DOM family with no new palette. Labels are muted
// small-caps pills on the arrow side; inverse phrases are display-only
// (decision `inverse_phrases = builtin`); three or more closed chips
// collapse to `✓×N` (LC9). Never throws.
const RELATION_STALE_TOOLTIP =
  "No longer links here · refreshes on the next reconcile";
const RELATION_LINKS_ROW_TOOLTIP =
  "Related tasks · live from the relation index";
const RELATION_LINKED_FROM_ROW_TOOLTIP =
  "Tasks linking here · live from the relation index";

// Display-only inverse phrases (docs/task-relations.md §10). Storage
// stays verbatim; matching is case-insensitive.
const RELATION_INVERSE_PHRASES = [
  ["merged into", "merged from"],
  ["duplicate of", "duplicated by"],
  ["follow-up of", "followed up by"],
  ["superseded by", "supersedes"],
  ["split from", "split into"],
  ["implemented by", "implements"],
  ["verified by", "verifies"],
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

function relationBuildChip({ direction, linkpath, blockId, label, task, otherPath, live, stale, resolved, sourcePath }) {
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
    const chips = [];
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
        const chip = relationBuildChip({
          direction, linkpath: (entry && entry.target) || "", blockId: entryId,
          label, task, otherPath, live: Boolean(edge), stale: !edge, resolved, sourcePath: source,
        });
        if (chip) chips.push(chip);
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
        const chip = relationBuildChip({
          direction, linkpath: "", blockId: otherId, label: (edge && edge.label) || null,
          task, otherPath, live: true, stale: false, sourcePath: source,
        });
        if (chip) chips.push(chip);
      } catch (error) {
        continue;
      }
    }
    const closed = chips.filter((chip) => chip && chip.live && !chip.broken && chip.state === "done");
    let collapsed = null;
    if (closed.length >= 3) {
      for (const chip of closed) chip.collapsed = true;
      collapsed = { count: closed.length };
    }
    const labelled = chips.some((chip) => chip && chip.label);
    const liveCount = chips.filter((chip) => chip && chip.live).length;
    return {
      direction,
      kind: parsed.kind,
      label: direction === "to" ? "🪢 links to" : "🪢 linked from",
      tooltip: direction === "to" ? RELATION_LINKS_ROW_TOOLTIP : RELATION_LINKED_FROM_ROW_TOOLTIP,
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
    const chips = Array.isArray(model.chips) ? model.chips : [];
    const row = doc.createElement("span");
    const rowClasses = ["bob-dep-row", "bob-relation-row"];
    if (model.direction === "from") rowClasses.push("is-incoming");
    if (model.labelled) rowClasses.push("is-labelled");
    row.setAttribute("class", rowClasses.join(" "));
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", String(model.label || "relations") + ", " + model.liveCount + " live");
    if (model.tooltip) row.setAttribute("title", String(model.tooltip));
    const label = doc.createElement("span");
    label.setAttribute("class", "bob-dep-label bob-relation-label");
    label.setAttribute("aria-hidden", "true");
    label.appendChild(doc.createTextNode(String(model.label || "🪢 relations")));
    row.appendChild(label);
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
    const visible = chips.filter((chip) => chip && !chip.collapsed);
    const appendChipEntry = (host, chip) => {
      try {
        if (model.labelled) {
          const entry = doc.createElement("span");
          entry.setAttribute("class", "bob-relation-entry");
          if (model.direction === "to") {
            if (chip.label) {
              entry.appendChild(buildPill(chip.label));
              entry.appendChild(buildArrow());
            }
            entry.appendChild(buildChipEl(chip));
          } else if (chip.inverse) {
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
          host.appendChild(entry);
        } else {
          host.appendChild(buildChipEl(chip));
        }
      } catch (error) {
        // One bad entry never breaks the row.
      }
    };
    if (!model.labelled && model.direction === "to") {
      // LC1: an unlabelled LINKS row reads `🪢 links to → (chip)`.
      row.appendChild(buildArrow());
    }
    for (const chip of visible) appendChipEntry(row, chip);
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
          for (const chip of chips) {
            if (chip && chip.collapsed) appendChipEntry(row, { ...chip, collapsed: false });
          }
          if (typeof collapsed.remove === "function") collapsed.remove();
          else if (collapsed.parentNode && typeof collapsed.parentNode.removeChild === "function") {
            collapsed.parentNode.removeChild(collapsed);
          }
        } catch (error) {
          // An unexpanded row never breaks the chips.
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
      if (model.labelled) {
        const entry = doc.createElement("span");
        entry.setAttribute("class", "bob-relation-entry");
        entry.appendChild(collapsed);
        row.appendChild(entry);
      } else {
        row.appendChild(collapsed);
      }
    }
    if (interactive) relationAttachAddControl(row, doc, model, opts.onAdd);
    return row;
  } catch (error) {
    return null;
  }
}
