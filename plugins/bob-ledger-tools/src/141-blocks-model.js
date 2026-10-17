// Generated BLOCKS chips (bob-cli-7e chips). The row is a projection of
// the in-memory Tasks memo's `id` / `dependsOn` fields. Never use this
// parser as dependency input. Open-owner rows feature-detect nav
// `api.blocks` (v1) for ＋ / hover ×; frozen and stale chips stay
// navigation-only.
const BLOCKS_CHIP_TOOLTIP = "Generated from DEPENDS ON lines · edit on the dependent";
const BLOCKS_CHIP_EDIT_TOOLTIP = "Generated from DEPENDS ON lines · ＋ / × edit through Blocks… (Ctrl+Shift+Alt+B)";

function blocksChipEditEnabled(model, interactive) {
  return Boolean(interactive) && Boolean(model) && !model.frozen;
}

function blocksChipRowTooltip(model, interactive) {
  return blocksChipEditEnabled(model, interactive)
    ? BLOCKS_CHIP_EDIT_TOOLTIP
    : String((model && model.tooltip) || BLOCKS_CHIP_TOOLTIP);
}

function blocksChipRemoveLabel(chip) {
  return "Stop blocking " + String((chip && (chip.fullText || chip.text)) || "task");
}

function blocksAttachChipRemove(el, chip, doc, onRemove) {
  try {
    if (!el || !doc || typeof doc.createElement !== "function") {
      return;
    }
    const remove = doc.createElement("span");
    remove.setAttribute("class", "bob-dep-chip-remove");
    remove.setAttribute("role", "button");
    remove.setAttribute("tabindex", "0");
    remove.setAttribute("aria-label", blocksChipRemoveLabel(chip));
    remove.setAttribute("title", blocksChipRemoveLabel(chip));
    remove.appendChild(doc.createTextNode("×"));
    if (typeof remove.addEventListener === "function") {
      const fire = (event) => {
        try {
          if (event && typeof event.stopPropagation === "function") {
            event.stopPropagation();
          }
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          if (typeof onRemove === "function") {
            onRemove(chip, event);
          }
        } catch (error) {
          // Best-effort only.
        }
      };
      remove.addEventListener("click", fire);
      remove.addEventListener("keydown", (event) => {
        if (event && (event.key === "Enter" || event.key === " ")) {
          fire(event);
        }
      });
    }
    el.appendChild(remove);
  } catch (error) {
    // Listener-free remove still renders.
  }
}

function blocksAttachAddControl(row, doc, onAdd) {
  try {
    if (!row || !doc || typeof doc.createElement !== "function") {
      return;
    }
    const add = doc.createElement("span");
    add.setAttribute("class", "bob-dep-add");
    add.setAttribute("role", "button");
    add.setAttribute("tabindex", "0");
    add.setAttribute("aria-label", "Edit what this task blocks");
    add.setAttribute("title", "Edit what this task blocks");
    add.appendChild(doc.createTextNode("＋"));
    if (typeof add.addEventListener === "function") {
      const fire = (event) => {
        try {
          if (event && typeof event.stopPropagation === "function") {
            event.stopPropagation();
          }
          if (typeof onAdd === "function") {
            onAdd(event);
          }
        } catch (error) {
          // Best-effort only.
        }
      };
      add.addEventListener("click", fire);
      add.addEventListener("keydown", (event) => {
        if (event && (event.key === "Enter" || event.key === " ")) {
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          fire(event);
        }
      });
    }
    row.appendChild(add);
  } catch (error) {
    // Add button is best-effort.
  }
}
function parseBlocksLine(lineText, opts) {
  try {
    const options = opts && typeof opts === "object" ? opts : {};
    if (options.inCode === true || options.inWorkLog === true || options.isDirectChild === false) {
      return { verdict: "not-a-line" };
    }
    if (typeof lineText !== "string" || /^\s*>/.test(lineText)) {
      return { verdict: "not-a-line" };
    }
    if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(lineText)) {
      return { verdict: "not-a-line" };
    }
    const content = lineText.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\s+/, "");
    const labelRe = /\*\*\s*(BLOCKS|BLOCKING)\s*:\s*\*\*/;
    const label = labelRe.exec(content);
    if (!label) {
      return { verdict: "not-a-line" };
    }
    const before = content.slice(0, label.index);
    const glyphRe = /^(?:🧱|🚧|⛓️|⛓)?\s*$/u;
    if (!glyphRe.test(before)) {
      return { verdict: "malformed" };
    }
    const emojiMatch = /🧱|🚧|⛓️|⛓/u.exec(before);
    const emoji = emojiMatch ? emojiMatch[0] : "missing";
    const linkRe = /(~~)?(!)?\[\[([^\[\]\n]+?)\]\](~~)?/g;
    const targets = [];
    let hasInvalidTarget = false;
    let match = null;
    while ((match = linkRe.exec(content)) !== null) {
      try {
        const inner = String(match[3] || "");
        const pipeAt = inner.indexOf("|");
        const linkBody = pipeAt === -1 ? inner : inner.slice(0, pipeAt);
        const hashAt = linkBody.indexOf("#");
        if (hashAt === -1 || linkBody.slice(hashAt + 1, hashAt + 2) !== "^") {
          hasInvalidTarget = true;
          continue;
        }
        const blockId = linkBody.slice(hashAt + 2);
        if (!blockId) {
          hasInvalidTarget = true;
          continue;
        }
        targets.push({
          raw: match[0],
          linkpath: linkBody.slice(0, hashAt),
          blockId,
          alias: pipeAt === -1 ? null : inner.slice(pipeAt + 1),
          embedded: Boolean(match[2]),
          struck: Boolean(match[1] || match[4]),
          linktext: linkBody,
        });
      } catch (error) {
        hasInvalidTarget = true;
      }
    }
    if (hasInvalidTarget) {
      return { verdict: "malformed" };
    }
    let remainder = content.replace(linkRe, "");
    const remainingLabel = labelRe.exec(remainder);
    if (!remainingLabel) {
      return { verdict: "not-a-line" };
    }
    const after = remainder.slice(remainingLabel.index + remainingLabel[0].length);
    if (!/^[\s•·,]*$/.test(after)) {
      return { verdict: "malformed" };
    }
    if (targets.length === 0) {
      if (!/^[\s]*$/.test(after)) {
        return { verdict: "malformed" };
      }
      return {
        verdict: "empty",
        targets: [],
        canonical: false,
        emoji,
        legacyLabel: label[1] === "BLOCKING",
      };
    }
    let canonical = emoji === "🧱" && label[1] === "BLOCKS";
    if (targets.some((target) => target.alias !== null || target.embedded || target.struck)) {
      canonical = false;
    }
    const unique = new Set(targets.map((target) => target.linktext));
    if (unique.size !== targets.length) {
      canonical = false;
    }
    if (targets.length > 1) {
      const separators = [];
      let cursor = label.index + label[0].length;
      for (const target of targets) {
        const at = content.indexOf(target.raw, cursor);
        if (at === -1) {
          canonical = false;
          break;
        }
        separators.push(content.slice(cursor, at));
        cursor = at + target.raw.length;
      }
      separators.push(content.slice(cursor));
      if (separators[0] !== " " || separators[separators.length - 1] !== "" || separators.slice(1, -1).some((part) => part !== " • ")) {
        canonical = false;
      }
    } else {
      const at = content.indexOf(targets[0].raw, label.index + label[0].length);
      if (at === -1 || content.slice(label.index + label[0].length, at) !== " " || content.slice(at + targets[0].raw.length) !== "") {
        canonical = false;
      }
    }
    if (canonical) {
      const sorted = blocksSortLinks(targets).map((target) => target.linktext);
      if (!targets.every((target, index) => target.linktext === sorted[index])) {
        canonical = false;
      }
    }
    return {
      verdict: "accept",
      count: targets.length,
      targets,
      canonical,
      emoji,
      legacyLabel: label[1] === "BLOCKING",
    };
  } catch (error) {
    return { verdict: "not-a-line" };
  }
}

function blocksSortLinks(targets) {
  const rows = Array.isArray(targets) ? targets.slice() : [];
  const fold = (value) => String(value || "").replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const compareCodePoints = (left, right) => {
    const a = Array.from(left);
    const b = Array.from(right);
    const size = Math.min(a.length, b.length);
    for (let index = 0; index < size; index += 1) {
      const delta = a[index].codePointAt(0) - b[index].codePointAt(0);
      if (delta !== 0) {
        return delta;
      }
    }
    return a.length - b.length;
  };
  return rows.sort((left, right) => {
    const a = String(left && left.linktext || "");
    const b = String(right && right.linktext || "");
    return compareCodePoints(fold(a), fold(b)) || compareCodePoints(a, b);
  });
}

function blocksTaskIsOpen(task) {
  try {
    const type = task && task.status && task.status.type;
    return type === "TODO" || type === "IN_PROGRESS" || type === "ON_HOLD";
  } catch (error) {
    return false;
  }
}

function blocksTaskIds(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => blocksTaskIds(item));
  }
  if (typeof value !== "string") {
    return [];
  }
  return value.split(",").map((id) => id.trim()).filter(Boolean);
}

function blocksTaskKey(task) {
  try {
    const path = planTaskPath(task) || "";
    const blockId = planTaskBlockId(task) || "";
    return path && blockId ? path + "\u0000" + blockId : "";
  } catch (error) {
    return "";
  }
}

// Memo-local so the reverse index is built once per Tasks memo generation.
// The index is keyed by the prerequisite's `[id::]` value, not its block ID.
function blocksDependentsIndex(memo) {
  try {
    if (!memo || typeof memo !== "object") {
      return new Map();
    }
    if (memo.blocksDependentsIndex instanceof Map) {
      return memo.blocksDependentsIndex;
    }
    const index = new Map();
    const tasks = Array.isArray(memo.tasks) ? memo.tasks : [];
    for (const dependent of tasks) {
      if (!blocksTaskIsOpen(dependent)) {
        continue;
      }
      const ids = blocksTaskIds(dependent.dependsOn);
      for (const id of ids) {
        if (!index.has(id)) {
          index.set(id, []);
        }
        const rows = index.get(id);
        const key = blocksTaskKey(dependent);
        if (key && !rows.some((task) => blocksTaskKey(task) === key)) {
          rows.push(dependent);
        }
      }
    }
    try {
      memo.blocksDependentsIndex = index;
    } catch (error) {
      // A frozen memo still returns a usable index.
    }
    return index;
  } catch (error) {
    return new Map();
  }
}

function blocksTagPresent(task, expected) {
  try {
    const want = String(expected || "").replace(/^#/, "");
    return Array.isArray(task && task.tags) && task.tags.some((tag) => String(tag || "").replace(/^#/, "") === want);
  } catch (error) {
    return false;
  }
}

function blocksProjectName(task) {
  try {
    const rawPath = planTaskPath(task) || "";
    const name = rawPath.split("/").pop() || "project";
    return name.replace(/\.md$/i, "");
  } catch (error) {
    return "project";
  }
}

function blocksLastBlocker(dependent, owner, memo, today) {
  try {
    const ownerId = String(owner && owner.id || "").trim();
    const depends = blocksTaskIds(dependent && dependent.dependsOn);
    if (!ownerId || !depends.includes(ownerId)) {
      return { lastBlocker: false, reasons: [] };
    }
    const allTasks = Array.isArray(memo && memo.tasks) ? memo.tasks : [];
    const reasons = [];
    const otherIds = Array.from(new Set(depends.filter((id) => id !== ownerId)));
    for (const id of otherIds) {
      const open = allTasks.find((task) => String(task && task.id || "").trim() === id && blocksTaskIsOpen(task));
      if (open) {
        reasons.push('also waits on "' + (dependencyCleanTaskText(planTaskDescription(open) || "") || "another task") + '"');
      }
    }
    const scheduledDay = planTaskScheduledDay(dependent);
    const todayDay = planDayNumber(today || memo && memo.dateText);
    if (scheduledDay !== null && todayDay !== null && scheduledDay > todayDay) {
      reasons.push(blocksTaskScheduledText(dependent, scheduledDay));
    }
    const projectBlocked = blocksTagPresent(dependent, "prj_is_blocked");
    if (projectBlocked) {
      reasons.push("project " + blocksProjectName(dependent));
    }
    return { lastBlocker: reasons.length === 0, reasons };
  } catch (error) {
    return { lastBlocker: false, reasons: [] };
  }
}

function blocksTaskScheduledText(task, dayNumber) {
  try {
    for (const key of ["scheduled", "scheduledDate", "scheduledDay"]) {
      const value = task && task[key];
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.slice(0, 10);
      }
      if (value && typeof value.format === "function") {
        const formatted = value.format("YYYY-MM-DD");
        if (typeof formatted === "string" && /^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
          return formatted;
        }
      }
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
      }
    }
    const text = String(dayNumber || "");
    if (/^\d{8}$/.test(text)) {
      return text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6);
    }
    return "scheduled in the future";
  } catch (error) {
    return "scheduled in the future";
  }
}

function blocksCanonicalLinktext(task, sourcePath) {
  try {
    const blockId = planTaskBlockId(task) || "";
    const path = planTaskPath(task) || "";
    if (!blockId) {
      return "";
    }
    if (path && path === String(sourcePath || "")) {
      return "#^" + blockId;
    }
    const stem = path.split("/").pop().replace(/\.md$/i, "");
    return (stem ? stem : "") + "#^" + blockId;
  } catch (error) {
    return "";
  }
}

function blocksBuildChip(task, linkpath, blockId, sourcePath, owner, memo, isLive, frozen, today) {
  const taskPath = planTaskPath(task) || "";
  const id = String(blockId || planTaskBlockId(task) || "");
  const projectTask = id === "prj";
  const fullText = projectTask ? blocksProjectName(task) : (dependencyCleanTaskText(planTaskDescription(task) || "") || ("^" + id));
  const shortText = fullText.length > 40 ? fullText.slice(0, 40) + "…" : fullText;
  const symbol = projectTask ? "🧩" : dependencySymbolForState(dependencyStateFromSymbol(planTaskStatusSymbol(task), task));
  const state = projectTask ? dependencyStateFromSymbol(planTaskStatusSymbol(task), task) : dependencyStateFromSymbol(planTaskStatusSymbol(task), task);
  const noteStem = String(linkpath || "").split("/").pop().replace(/\.md$/i, "");
  const crossNote = Boolean(taskPath && taskPath !== sourcePath);
  const noteLabel = crossNote ? "↗ " + (noteStem || taskPath.split("/").pop().replace(/\.md$/i, "")) : null;
  const last = isLive && !frozen ? blocksLastBlocker(task, owner, memo, today) : { lastBlocker: false, reasons: [] };
  const hidden = blocksTagPresent(task, "hide");
  const tooltipParts = [fullText, taskPath || sourcePath || "", dependencyStatusName(state)];
  if (last.reasons.length > 0) {
    tooltipParts.push(last.reasons.join(" · "));
  }
  if (!isLive && !frozen) {
    tooltipParts.push("No longer waiting on this task · refreshes on the next reconcile");
  }
  const canonical = linkpath
    ? String(linkpath).replace(/\.md$/i, "") + "#^" + id
    : blocksCanonicalLinktext(task, sourcePath);
  return {
    blockId: id,
    linktext: canonical,
    linkpath: linkpath || "",
    path: taskPath,
    state: isLive || frozen ? state : "stale",
    symbol,
    text: shortText,
    fullText,
    noteLabel,
    lastBlocker: Boolean(last.lastBlocker && !frozen),
    tooltip: tooltipParts.filter(Boolean).join(" — "),
    ariaLabel: fullText + (last.lastBlocker && !frozen ? ", last blocker" : "") + (hidden ? ", hidden task" : ""),
    hidden,
    stale: !isLive && !frozen,
    projectTask,
    live: Boolean(isLive),
  };
}

// Build one row model from the stored line and the memo's live reverse index.
// `lookup(linkpath, blockId)` resolves a stored link to a Tasks task or null.
function blocksChipModel(lineText, sourcePath, owner, memo, lookup, today) {
  try {
    const parsed = parseBlocksLine(String(lineText || ""));
    if (!parsed || (parsed.verdict !== "accept" && parsed.verdict !== "empty")) {
      return null;
    }
    const source = String(sourcePath || "");
    const frozen = !blocksTaskIsOpen(owner);
    const reverse = blocksDependentsIndex(memo);
    const ownerId = String(owner && owner.id || "").trim();
    const liveTasks = !frozen && ownerId ? (reverse.get(ownerId) || []) : [];
    const liveByKey = new Map();
    for (const task of liveTasks) {
      const key = blocksTaskKey(task);
      if (key && !liveByKey.has(key)) {
        liveByKey.set(key, task);
      }
    }
    const lookupFn = typeof lookup === "function" ? lookup : () => null;
    const chips = [];
    const represented = new Set();
    const stored = parsed.verdict === "accept" ? parsed.targets : [];
    for (const target of stored) {
      const resolved = lookupFn(target.linkpath, target.blockId);
      const task = resolved && resolved.isTask === false ? null : resolved;
      const key = blocksTaskKey(task);
      const liveTask = key ? liveByKey.get(key) : null;
      const chip = blocksBuildChip(task, target.linkpath, target.blockId, source, owner, memo, Boolean(liveTask), frozen, today);
      if (!task) {
        chip.state = frozen ? "broken" : "stale";
        chip.symbol = "⚠";
        chip.text = "^" + target.blockId + (frozen ? " not found" : "");
        chip.fullText = chip.text;
        chip.tooltip = frozen ? "⚠ ^" + target.blockId + " not found" : "No longer waiting on this task · refreshes on the next reconcile";
        chip.ariaLabel = frozen ? "Missing task ^" + target.blockId : "Stale dependent ^" + target.blockId;
        chip.live = false;
        chip.stale = !frozen;
      }
      if (key && liveTask) {
        represented.add(key);
      }
      const rowKey = key || String(target.linkpath || "") + "\u0000" + target.blockId;
      if (!represented.has("stored:" + rowKey)) {
        chips.push(chip);
        represented.add("stored:" + rowKey);
      }
    }
    if (!frozen) {
      const missing = [];
      for (const task of liveTasks) {
        const key = blocksTaskKey(task);
        if (key && !represented.has(key)) {
          missing.push(task);
        }
      }
      const sorted = blocksSortLinks(missing.map((task) => ({
        task,
        linktext: blocksCanonicalLinktext(task, source),
      })));
      for (const row of sorted) {
        const task = row.task;
        const blockId = planTaskBlockId(task) || "";
        const linktext = row.linktext;
        const hashAt = linktext.indexOf("#^");
        const linkpath = hashAt > 0 ? linktext.slice(0, hashAt) : "";
        chips.push(blocksBuildChip(task, linkpath, blockId, source, owner, memo, true, false, today));
      }
    }
    const liveCount = chips.filter((chip) => chip.live).length;
    const lastCount = chips.filter((chip) => chip.live && chip.lastBlocker).length;
    let summary = "";
    if (frozen) {
      const count = chips.length;
      if (count > 0) {
        summary = "✓ freed " + count;
      }
    } else if (liveCount > 0) {
      summary = lastCount === liveCount
        ? "frees " + liveCount
        : "frees " + lastCount + " of " + liveCount;
    }
    return {
      chips,
      frozen,
      label: frozen ? "🧱 was blocking" : "🧱 blocks",
      summary,
      liveCount,
      storedCount: chips.length,
      tooltip: BLOCKS_CHIP_TOOLTIP,
    };
  } catch (error) {
    return null;
  }
}

function buildBlocksChipElement(doc, model, options) {
  try {
    if (!doc || !model || typeof model !== "object") {
      return null;
    }
    const opts = options && typeof options === "object" ? options : {};
    const interactive = blocksChipEditEnabled(model, opts.interactive);
    const row = doc.createElement("span");
    row.setAttribute("class", "bob-dep-row bob-blocks-row" + (model.frozen ? " is-frozen" : ""));
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", String(model.label || "BLOCKS") + (model.summary ? ", " + model.summary : ""));
    row.setAttribute("title", blocksChipRowTooltip(model, interactive));
    const label = doc.createElement("span");
    label.setAttribute("class", "bob-dep-label bob-blocks-label");
    label.setAttribute("aria-hidden", "true");
    label.appendChild(doc.createTextNode(String(model.label || "🧱 blocks")));
    row.appendChild(label);
    for (const chip of Array.isArray(model.chips) ? model.chips : []) {
      const el = doc.createElement("span");
      const classes = ["bob-dep-chip", "bob-blocks-chip", "is-" + String(chip.state || "todo")];
      if (chip.stale) classes.push("is-stale");
      if (chip.hidden) classes.push("is-muted");
      if (chip.projectTask) classes.push("is-project");
      el.setAttribute("class", classes.join(" "));
      el.setAttribute("data-state", String(chip.state || "todo"));
      el.setAttribute("role", "link");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", String(chip.ariaLabel || chip.tooltip || chip.text || ""));
      if (chip.tooltip) el.setAttribute("title", String(chip.tooltip));
      const box = doc.createElement("span");
      box.setAttribute("class", "bob-dep-chip-box");
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
      if (chip.lastBlocker) {
        const key = doc.createElement("span");
        key.setAttribute("class", "bob-blocks-key");
        key.setAttribute("aria-label", "Last blocking reason");
        key.setAttribute("title", "This is the last reason keeping this task Blocked");
        key.appendChild(doc.createTextNode("🔑"));
        el.appendChild(key);
      }
      if (interactive && chip.live) {
        blocksAttachChipRemove(el, chip, doc, opts.onRemove);
      }
      if (typeof el.addEventListener === "function") {
        const open = (event) => {
          try {
            if (event && event.target && event.target.classList && typeof event.target.classList.contains === "function") {
              try {
                if (event.target.classList.contains("bob-dep-chip-remove")) {
                  return;
                }
              } catch (inner) {
                // Fall through to open.
              }
            }
            if (opts.plugin && typeof opts.plugin.dependencyOpenTarget === "function") {
              opts.plugin.dependencyOpenTarget(chip.linktext, opts.sourcePath || "", event);
            }
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
            if (opts.plugin && typeof opts.plugin.dependencyHoverTarget === "function") {
              opts.plugin.dependencyHoverTarget(chip.linktext, opts.sourcePath || "", event, el, row);
            }
          } catch (error) {
            // Hover preview is best-effort.
          }
        });
      }
      row.appendChild(el);
    }
    if (interactive) {
      blocksAttachAddControl(row, doc, opts.onAdd);
    }
    if (model.summary) {
      const summary = doc.createElement("span");
      summary.setAttribute("class", "bob-dep-summary bob-blocks-summary");
      summary.appendChild(doc.createTextNode(String(model.summary)));
      row.appendChild(summary);
    }
    return row;
  } catch (error) {
    return null;
  }
}
