// --- Reading Board DOM builders (bob-cli-99.3) ----------------------------
// Pure builders over an injected document: the same code renders in
// Obsidian, in fake-DOM tests, and in the browser preview. Builders only
// create elements and attach the listeners they are handed; they never
// touch the vault, the workspace, or the plugin. Text is always set with
// `textContent`, never HTML.

const READING_BOARD_LANE_IDS = Object.freeze(["reading", "next", "ready", "snoozed"]);
const READING_BOARD_LANE_NAMES = Object.freeze({
  reading: "Reading",
  next: "Next",
  ready: "Ready",
  snoozed: "Snoozed",
});
const READING_BOARD_SKELETON_CARDS = Object.freeze({ reading: 2, next: 3, ready: 3, snoozed: 3 });
const READING_BOARD_HINT_TEXT =
  "Arrow keys or h, j, k, and l move between references. Home and End jump within a lane. " +
  "Enter opens the reference. Control or Command with Enter opens its PDF. " +
  "Alt with Enter goes to its reading task. r refreshes the board. c collapses or expands Snoozed.";
const READING_BOARD_SYNC_TOOLTIP = "Frontmatter status catches up on the next Highlights sync";

let readingBoardSerial = 0;

function readingBoardEl(doc, tag, attrs, text) {
  return statsEl(doc, tag, attrs, text);
}

function readingBoardHasClass(node, name) {
  try {
    const current = String((node && node.getAttribute && node.getAttribute("class")) || "");
    return current.split(/\s+/).includes(name);
  } catch (error) {
    return false;
  }
}

function readingBoardToggleClass(node, name, on) {
  try {
    if (!node || typeof node.setAttribute !== "function") {
      return;
    }
    const current = String((node.getAttribute && node.getAttribute("class")) || "")
      .split(/\s+/)
      .filter(Boolean);
    const has = current.includes(name);
    if (on && !has) {
      current.push(name);
    } else if (!on && has) {
      current.splice(current.indexOf(name), 1);
    } else {
      return;
    }
    node.setAttribute("class", current.join(" "));
  } catch (error) {
    // Class toggling is cosmetic.
  }
}

function readingBoardLaneName(laneId) {
  return READING_BOARD_LANE_NAMES[laneId] || String(laneId || "");
}

function readingBoardCountLabel(count) {
  return `${count} ${count === 1 ? "reference" : "references"}`;
}

function readingBoardLaneAriaLabel(laneId, count) {
  return `${readingBoardLaneName(laneId)}, ${readingBoardCountLabel(count)}`;
}

// `HH:MM` out of bob's `generated_at`, or "" when it is not an ISO stamp.
function readingBoardHeaderTime(generatedAt) {
  const match = /T(\d{2}:\d{2})/.exec(typeof generatedAt === "string" ? generatedAt : "");
  return match ? match[1] : "";
}

// `[[note#^id|alias]]` -> `note#^id`, the target `openLinkText` wants.
function readingBoardLinkTarget(link) {
  const text = typeof link === "string" ? link.trim() : "";
  if (!text) {
    return "";
  }
  return text.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
}

function readingBoardTaskTarget(task) {
  if (!task || typeof task !== "object") {
    return "";
  }
  const fromLink = readingBoardLinkTarget(task.link);
  if (fromLink) {
    return fromLink;
  }
  if (task.path && task.block_id) {
    return `${String(task.path).replace(/\.md$/i, "")}#^${task.block_id}`;
  }
  return "";
}

function readingBoardTitleNode(doc, parts, className) {
  const title = readingBoardEl(doc, "span", { class: className });
  for (const part of Array.isArray(parts) ? parts : []) {
    if (part.type === "code") {
      title.appendChild(readingBoardEl(doc, "code", { class: "bob-reading-board-code" }, part.text));
    } else {
      title.appendChild(readingBoardEl(doc, "span", { class: "bob-reading-board-text" }, part.text));
    }
  }
  return title;
}

function readingBoardTooltipAttrs(text) {
  return text ? { "aria-label": text, "data-tooltip-position": "top" } : {};
}

function readingBoardActionButton(doc, kind, label, tooltip, onClick) {
  const button = readingBoardEl(doc, "button", {
    class: `bob-reading-board-action bob-reading-board-action-${kind}`,
    type: "button",
    tabindex: "-1",
    "data-action": kind,
    ...readingBoardTooltipAttrs(tooltip),
  }, label);
  button.addEventListener("click", (event) => {
    try {
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
    } catch (error) {
      // Event hygiene is best-effort.
    }
    onClick(event);
  });
  return button;
}

function readingBoardActions(doc, card, ctx) {
  const actions = readingBoardEl(doc, "div", { class: "bob-reading-board-actions" });
  const handlers = ctx.handlers || {};
  if (ctx.caps && ctx.caps.pdf && card.sourcePdf) {
    actions.appendChild(
      readingBoardActionButton(doc, "pdf", "PDF", "Open the PDF in Highlights", (event) =>
        handlers.pdf && handlers.pdf(card, event),
      ),
    );
  }
  if (card.task && readingBoardTaskTarget(card.task)) {
    actions.appendChild(
      readingBoardActionButton(doc, "task", "Task", "Go to the reading task", (event) =>
        handlers.task && handlers.task(card, event),
      ),
    );
  }
  return actions.children.length > 0 ? actions : null;
}

// Wire the gestures shared by every card and row: click, modifier-click,
// middle-click, hover preview, and the file menu. Keyboard routing lives
// on the board root so the board stays one Tab stop.
function readingBoardWireCard(node, card, ctx, hoverTarget) {
  const handlers = ctx.handlers || {};
  node.addEventListener("click", (event) => handlers.open && handlers.open(card, event, false));
  node.addEventListener("auxclick", (event) => {
    if (event && event.button === 1) {
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      handlers.open && handlers.open(card, event, true);
    }
  });
  node.addEventListener("mousedown", (event) => {
    // Middle-press would start browser autoscroll before auxclick fires.
    if (event && event.button === 1 && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
  });
  node.addEventListener("contextmenu", (event) => handlers.contextmenu && handlers.contextmenu(card, event));
  (hoverTarget || node).addEventListener("mouseover", (event) =>
    handlers.hover && handlers.hover(card, node, event),
  );
  node.addEventListener("focus", () => handlers.focus && handlers.focus(card, node));
}

// Outline every on-board card that is a prerequisite of `card`. Matching is
// by reference path, so a chain (Part 2 waits on Part 1) lights Part 1.
function readingBoardHighlightPrerequisites(cardNodes, card, on) {
  try {
    const prerequisites = card && Array.isArray(card.prerequisites) ? card.prerequisites : [];
    for (const prerequisite of prerequisites) {
      const nodes = cardNodes instanceof Map ? cardNodes.get(prerequisite.ref_path) : null;
      for (const node of nodes || []) {
        readingBoardToggleClass(node, "bob-reading-board-prerequisite", on);
      }
    }
  } catch (error) {
    // Highlighting is cosmetic.
  }
}

function readingBoardRegister(ctx, laneId, card, node) {
  ctx.order[laneId].push(node);
  ctx.nodeInfo.set(node, { laneId, path: card.path, card });
  if (!ctx.cardNodes.has(card.path)) {
    ctx.cardNodes.set(card.path, []);
  }
  ctx.cardNodes.get(card.path).push(node);
}

function readingBoardBuildCard(doc, card, laneId, ctx) {
  const node = readingBoardEl(doc, "div", {
    class: `bob-reading-board-card${card.today ? " bob-reading-board-card-today" : ""}`,
    role: "listitem",
    tabindex: "-1",
    draggable: "false",
    "data-lane": laneId,
    "data-path": card.path,
    "data-status": card.status,
  });
  if (card.today) {
    node.appendChild(
      readingBoardEl(doc, "span", {
        class: "bob-reading-board-today",
        ...readingBoardTooltipAttrs("Linked under today's Pomodoros"),
      }, "TODAY"),
    );
  }
  const title = readingBoardEl(doc, "div", { class: "bob-reading-board-title" });
  title.appendChild(readingBoardTitleNode(doc, card.titleParts, "bob-reading-board-title-text"));
  if (card.statusSync && card.statusSync !== "ok") {
    title.appendChild(
      readingBoardEl(doc, "span", {
        class: "bob-reading-board-sync",
        ...readingBoardTooltipAttrs(READING_BOARD_SYNC_TOOLTIP),
      }, "*"),
    );
  }
  node.appendChild(title);
  const meta = readingBoardEl(doc, "div", { class: "bob-reading-board-meta" });
  const segments = [readingBoardEl(doc, "span", { class: "bob-reading-board-kind" }, card.kind.text)];
  if (card.parent) {
    segments.push(readingBoardEl(doc, "span", { class: "bob-reading-board-topic" }, card.parent));
  }
  if (card.addedMark) {
    const mark = buildDateMarkElement(doc, card.addedMark, {});
    if (mark) {
      segments.push(mark);
    }
  }
  if (card.audio) {
    segments.push(
      readingBoardEl(doc, "span", {
        class: "bob-reading-board-audio",
        ...readingBoardTooltipAttrs("Has audio"),
      }, "♫"),
    );
  }
  if (card.annotationCount > 0) {
    segments.push(
      readingBoardEl(doc, "span", {
        class: "bob-reading-board-annotations",
        ...readingBoardTooltipAttrs(
          `${card.annotationCount} ${card.annotationCount === 1 ? "annotation" : "annotations"}`,
        ),
      }, `✎ ${card.annotationCount}`),
    );
  }
  segments.forEach((segment, index) => {
    if (index > 0) {
      meta.appendChild(readingBoardEl(doc, "span", { class: "bob-reading-board-sep", "aria-hidden": "true" }, "·"));
    }
    meta.appendChild(segment);
  });
  if (card.priorityMark) {
    const mark = buildPriorityMarkElement(doc, card.priorityMark, {});
    if (mark) {
      meta.appendChild(mark);
    }
  }
  node.appendChild(meta);
  const actions = readingBoardActions(doc, card, ctx);
  if (actions) {
    node.appendChild(actions);
  }
  readingBoardWireCard(node, card, ctx, title);
  readingBoardRegister(ctx, laneId, card, node);
  return node;
}

// The reason glyph in the date column of a Waiting-on row.
function readingBoardReasonGlyph(card) {
  const first = (Array.isArray(card.reasons) ? card.reasons : []).find(
    (reason) => reason && reason.kind && reason.kind !== "local_schedule",
  );
  if (first && first.kind === "local_dependency") {
    return "⛓";
  }
  if (first && first.kind === "project") {
    return "🧱";
  }
  return "⏸";
}

function readingBoardBuildRow(doc, card, groupId, ctx) {
  const node = readingBoardEl(doc, "div", {
    class: "bob-reading-board-row",
    role: "listitem",
    tabindex: "-1",
    draggable: "false",
    "data-lane": "snoozed",
    "data-group": groupId,
    "data-path": card.path,
    "data-status": card.status,
  });
  const main = readingBoardEl(doc, "div", { class: "bob-reading-board-row-main" });
  let when = null;
  if (groupId === "waking") {
    when = readingBoardEl(doc, "span", {
      class: "bob-reading-board-when bob-reading-board-when-waking",
      ...readingBoardTooltipAttrs(card.wakeTooltip),
    }, card.wakeLabel || "⏰ now");
  } else if (groupId !== "waiting_on" && card.schedule) {
    when = readingBoardEl(doc, "span", {
      class: "bob-reading-board-when",
      ...readingBoardTooltipAttrs(card.schedule.tooltip),
    }, card.schedule.label);
  } else {
    when = readingBoardEl(doc, "span", {
      class: "bob-reading-board-when bob-reading-board-when-reason",
      ...readingBoardTooltipAttrs(card.reasonTooltip),
    }, readingBoardReasonGlyph(card));
  }
  main.appendChild(when);
  const title = readingBoardTitleNode(doc, card.titleParts, "bob-reading-board-row-title");
  title.setAttribute("aria-label", card.title);
  title.setAttribute("data-tooltip-position", "top");
  main.appendChild(title);
  if (card.priorityMark) {
    const mark = buildPriorityMarkElement(doc, card.priorityMark, {});
    if (mark) {
      main.appendChild(mark);
    }
  }
  const returnMatch = card.returnLane ? /^(→\s*\S+)/.exec(card.returnLane.text) : null;
  if (returnMatch) {
    main.appendChild(
      readingBoardEl(doc, "span", {
        class: "bob-reading-board-return",
        ...readingBoardTooltipAttrs(`Returns to ${card.returnLane.text.replace(/^→\s*/, "")} when it wakes`),
      }, returnMatch[1]),
    );
  }
  node.appendChild(main);
  if (groupId === "waiting_on") {
    const reason = readingBoardEl(doc, "div", {
      class: "bob-reading-board-reason",
      ...readingBoardTooltipAttrs(card.reasonTooltip),
    }, card.reasonText || "⏸ blocked");
    if (card.schedule) {
      reason.appendChild(
        readingBoardEl(doc, "span", {
          class: "bob-reading-board-wake",
          ...readingBoardTooltipAttrs(card.schedule.tooltip),
        }, `💤 ${card.schedule.label}`),
      );
    }
    node.appendChild(reason);
    node.addEventListener("mouseenter", () => readingBoardHighlightPrerequisites(ctx.cardNodes, card, true));
    node.addEventListener("mouseleave", () => readingBoardHighlightPrerequisites(ctx.cardNodes, card, false));
    node.addEventListener("focus", () => readingBoardHighlightPrerequisites(ctx.cardNodes, card, true));
    node.addEventListener("blur", () => readingBoardHighlightPrerequisites(ctx.cardNodes, card, false));
  }
  const actions = readingBoardActions(doc, card, ctx);
  if (actions) {
    node.appendChild(actions);
  }
  readingBoardWireCard(node, card, ctx, title);
  readingBoardRegister(ctx, "snoozed", card, node);
  return node;
}

function readingBoardBuildLane(doc, lane, ctx) {
  const collapsed = lane.id === "snoozed" && ctx.state && ctx.state.snoozedCollapsed === true;
  const section = readingBoardEl(doc, "section", {
    class: `bob-reading-board-lane bob-reading-board-lane-${lane.id}${collapsed ? " bob-reading-board-lane-collapsed" : ""}`,
    "data-lane": lane.id,
  });
  const head = readingBoardEl(doc, "header", { class: "bob-reading-board-lane-head" });
  head.appendChild(readingBoardEl(doc, "span", { class: "bob-reading-board-lane-label" }, lane.label));
  head.appendChild(readingBoardEl(doc, "span", { class: "bob-reading-board-lane-count" }, String(lane.count)));
  if (lane.id === "snoozed") {
    const toggle = readingBoardEl(doc, "button", {
      class: "bob-reading-board-collapse",
      type: "button",
      tabindex: "-1",
      "aria-expanded": collapsed ? "false" : "true",
      "aria-label": collapsed ? "Expand Snoozed" : "Collapse Snoozed",
      "data-tooltip-position": "top",
    }, collapsed ? "▸" : "▾");
    toggle.addEventListener("click", (event) => {
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      ctx.handlers && ctx.handlers.toggleSnoozed && ctx.handlers.toggleSnoozed();
    });
    head.appendChild(toggle);
    ctx.toggleButton = toggle;
  }
  section.appendChild(head);
  if (collapsed) {
    return { section, body: null };
  }
  // Explicit tabindex -1: Chromium otherwise makes a scroll box a Tab stop,
  // and the board is one Tab stop (roving focus follows the keys).
  const body = readingBoardEl(doc, "div", { class: "bob-reading-board-lane-body", tabindex: "-1" });
  const list = readingBoardEl(doc, "div", {
    class: "bob-reading-board-list",
    role: "list",
    "aria-label": readingBoardLaneAriaLabel(lane.id, lane.count),
  });
  if (lane.id === "snoozed") {
    for (const group of lane.groups || []) {
      if (!group.cards || group.cards.length === 0) {
        continue;
      }
      list.appendChild(
        readingBoardEl(doc, "div", {
          class: "bob-reading-board-group",
          "data-group": group.id,
          "aria-hidden": "true",
        }, group.label),
      );
      for (const card of group.cards) {
        list.appendChild(readingBoardBuildRow(doc, card, group.id, ctx));
      }
    }
  } else {
    for (const card of lane.cards || []) {
      list.appendChild(readingBoardBuildCard(doc, card, lane.id, ctx));
    }
  }
  body.appendChild(list);
  if (lane.count === 0) {
    body.appendChild(readingBoardEl(doc, "div", { class: "bob-reading-board-empty" }, lane.emptyText));
  }
  section.appendChild(body);
  return { section, body };
}

function readingBoardBuildHeader(doc, model, ctx) {
  const header = readingBoardEl(doc, "div", { class: "bob-reading-board-header" });
  header.appendChild(readingBoardEl(doc, "span", { class: "bob-reading-board-name" }, "🗂️ Reading Board"));
  header.appendChild(
    readingBoardEl(
      doc,
      "span",
      { class: "bob-reading-board-summary" },
      `${model.summary.awake} awake · ${model.summary.snoozed} snoozed`,
    ),
  );
  // Time and refresh stay together when the header wraps on a narrow note.
  const end = readingBoardEl(doc, "span", { class: "bob-reading-board-header-end" });
  const time = readingBoardHeaderTime(model.generatedAt);
  ctx.timeEl = readingBoardEl(doc, "span", {
    class: "bob-reading-board-time",
    ...readingBoardTooltipAttrs(model.generatedAt ? `Data from ${model.generatedAt}` : ""),
  }, time);
  end.appendChild(ctx.timeEl);
  const refresh = readingBoardEl(doc, "button", {
    class: "bob-reading-board-refresh",
    type: "button",
    tabindex: "-1",
    "aria-label": "Refresh reading board",
    "data-tooltip-position": "top",
  }, "↻");
  refresh.addEventListener("click", (event) => {
    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
    ctx.handlers && ctx.handlers.refresh && ctx.handlers.refresh();
  });
  end.appendChild(refresh);
  header.appendChild(end);
  ctx.refreshButton = refresh;
  return header;
}

// One muted line, optionally ending in a Retry button.
function readingBoardBuildLint(doc, text, onRetry) {
  const line = readingBoardEl(doc, "div", { class: "bob-reading-board-lint" });
  line.appendChild(readingBoardEl(doc, "span", { class: "bob-reading-board-lint-text" }, text));
  if (typeof onRetry === "function") {
    const retry = readingBoardEl(doc, "button", {
      class: "bob-reading-board-link",
      type: "button",
      tabindex: "-1",
    }, "Retry");
    retry.addEventListener("click", (event) => {
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      onRetry();
    });
    line.appendChild(retry);
  }
  return line;
}

function readingBoardBuildErrorCard(doc, errorModel, onRetry) {
  const card = readingBoardEl(doc, "div", { class: "bob-reading-board-error", role: "alert" });
  card.appendChild(readingBoardEl(doc, "div", { class: "bob-reading-board-error-title" }, errorModel.title));
  card.appendChild(readingBoardEl(doc, "div", { class: "bob-reading-board-error-hint" }, errorModel.hint));
  if (errorModel.retry) {
    const retry = readingBoardEl(doc, "button", {
      class: "bob-reading-board-link",
      type: "button",
    }, "Retry");
    retry.addEventListener("click", (event) => {
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      onRetry();
    });
    card.appendChild(retry);
  }
  return card;
}

// First paint: four ghost lanes in the real grid, so nothing jumps when
// the data lands. Decorative: assistive tech hears one loading status.
function readingBoardBuildSkeleton(doc) {
  readingBoardSerial += 1;
  const root = readingBoardEl(doc, "div", {
    class: "bob-reading-board bob-reading-board-loading",
    role: "status",
    "aria-busy": "true",
    "aria-label": "Reading Board loading",
  });
  const header = readingBoardEl(doc, "div", { class: "bob-reading-board-header" });
  header.appendChild(readingBoardEl(doc, "span", { class: "bob-reading-board-name" }, "🗂️ Reading Board"));
  root.appendChild(header);
  const lanes = readingBoardEl(doc, "div", { class: "bob-reading-board-lanes", "aria-hidden": "true" });
  const labels = { reading: "📖 Reading", next: "⭐ Next", ready: "📥 Ready", snoozed: "💤 Snoozed" };
  for (const laneId of READING_BOARD_LANE_IDS) {
    const section = readingBoardEl(doc, "section", {
      class: `bob-reading-board-lane bob-reading-board-lane-${laneId}`,
      "data-lane": laneId,
    });
    const head = readingBoardEl(doc, "header", { class: "bob-reading-board-lane-head" });
    head.appendChild(readingBoardEl(doc, "span", { class: "bob-reading-board-lane-label" }, labels[laneId]));
    head.appendChild(readingBoardEl(doc, "span", { class: "bob-reading-board-lane-count" }, "–"));
    section.appendChild(head);
    // Explicit tabindex -1: Chromium otherwise makes a scroll box a Tab stop,
  // and the board is one Tab stop (roving focus follows the keys).
  const body = readingBoardEl(doc, "div", { class: "bob-reading-board-lane-body", tabindex: "-1" });
    for (let index = 0; index < READING_BOARD_SKELETON_CARDS[laneId]; index += 1) {
      const ghost = readingBoardEl(doc, "div", { class: "bob-reading-board-card bob-reading-board-ghost" });
      ghost.appendChild(readingBoardEl(doc, "div", { class: "bob-reading-board-ghost-bar" }));
      ghost.appendChild(readingBoardEl(doc, "div", { class: "bob-reading-board-ghost-bar bob-reading-board-ghost-short" }));
      body.appendChild(ghost);
    }
    section.appendChild(body);
    lanes.appendChild(section);
  }
  root.appendChild(lanes);
  return root;
}

// The full board. `ctx` carries everything the builders need and collects
// what the caller needs back: node registry, keyboard order, and the few
// nodes that are updated in place.
//   ctx = { handlers, caps, state, lints: [{text, retry}], busy, live }
function readingBoardBuildBoard(doc, model, options = {}) {
  readingBoardSerial += 1;
  const hintId = `bob-reading-board-hint-${readingBoardSerial}`;
  const ctx = {
    handlers: options.handlers || {},
    caps: options.caps || { pdf: false },
    state: options.state || { snoozedCollapsed: false },
    order: { reading: [], next: [], ready: [], snoozed: [] },
    nodeInfo: new Map(),
    cardNodes: new Map(),
    timeEl: null,
    refreshButton: null,
    toggleButton: null,
  };
  const root = readingBoardEl(doc, "div", {
    class: `bob-reading-board${options.busy ? " bob-reading-board-busy" : ""}`,
    role: "region",
    "aria-label": "Reading Board",
    "aria-describedby": hintId,
    "aria-busy": options.busy ? "true" : null,
    tabindex: "-1",
  });
  root.appendChild(readingBoardBuildHeader(doc, model, ctx));
  root.appendChild(readingBoardEl(doc, "div", { class: "bob-reading-board-sr", id: hintId }, READING_BOARD_HINT_TEXT));
  for (const lint of options.lints || []) {
    root.appendChild(readingBoardBuildLint(doc, lint.text, lint.retry));
  }
  if (options.live) {
    root.appendChild(options.live);
  }
  const bodies = {};
  if (model.emptyText) {
    root.appendChild(readingBoardEl(doc, "div", { class: "bob-reading-board-empty-board" }, model.emptyText));
  } else {
    const lanes = readingBoardEl(doc, "div", { class: "bob-reading-board-lanes" });
    for (const laneId of READING_BOARD_LANE_IDS) {
      const built = readingBoardBuildLane(doc, model.lanes[laneId], ctx);
      bodies[laneId] = built.body;
      lanes.appendChild(built.section);
    }
    root.appendChild(lanes);
  }
  return {
    root,
    bodies,
    order: ctx.order,
    nodeInfo: ctx.nodeInfo,
    cardNodes: ctx.cardNodes,
    timeEl: ctx.timeEl,
    refreshButton: ctx.refreshButton,
  };
}

// Keyboard order: the lanes that currently show at least one node.
function readingBoardNavLanes(order, state) {
  const collapsed = state && state.snoozedCollapsed === true;
  return READING_BOARD_LANE_IDS
    .filter((laneId) => !(laneId === "snoozed" && collapsed))
    .map((laneId) => ({ id: laneId, nodes: order[laneId] || [] }))
    .filter((lane) => lane.nodes.length > 0);
}

const READING_BOARD_MOVE_KEYS = Object.freeze({
  ArrowLeft: "left",
  h: "left",
  ArrowRight: "right",
  l: "right",
  ArrowUp: "up",
  k: "up",
  ArrowDown: "down",
  j: "down",
  Home: "home",
  End: "end",
});

// The node a movement key lands on, or null when the key is not a
// movement key or the move would leave the board.
function readingBoardMoveTarget(lanes, laneId, index, key) {
  const direction = READING_BOARD_MOVE_KEYS[key];
  const laneIndex = lanes.findIndex((lane) => lane.id === laneId);
  if (!direction || laneIndex < 0) {
    return null;
  }
  const lane = lanes[laneIndex];
  const at = Math.max(0, Math.min(index, lane.nodes.length - 1));
  if (direction === "up") {
    return at > 0 ? lane.nodes[at - 1] : null;
  }
  if (direction === "down") {
    return at < lane.nodes.length - 1 ? lane.nodes[at + 1] : null;
  }
  if (direction === "home") {
    return lane.nodes[0];
  }
  if (direction === "end") {
    return lane.nodes[lane.nodes.length - 1];
  }
  const next = lanes[laneIndex + (direction === "left" ? -1 : 1)];
  if (!next) {
    return null;
  }
  return next.nodes[Math.min(at, next.nodes.length - 1)];
}

// The node that should be the board's Tab stop: the remembered anchor
// (same lane, then same path in any lane), else the first node shown.
function readingBoardPickAnchor(lanes, anchor) {
  if (anchor && anchor.path) {
    for (const lane of lanes) {
      for (const node of lane.nodes) {
        if (
          node.getAttribute("data-path") === anchor.path &&
          (!anchor.laneId || node.getAttribute("data-lane") === anchor.laneId)
        ) {
          return node;
        }
      }
    }
    for (const lane of lanes) {
      for (const node of lane.nodes) {
        if (node.getAttribute("data-path") === anchor.path) {
          return node;
        }
      }
    }
  }
  return lanes.length > 0 ? lanes[0].nodes[0] : null;
}
