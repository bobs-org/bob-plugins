const FRESHNESS_FOOTER_TIERS = [
  "pre",
  "new",
  "projects",
  "pending",
  "next",
  "tickler",
  "references",
  "rotten",
  "post",
];

const FRESHNESS_FOOTER_COMMITMENT_TIERS = [
  "pre",
  "new",
  "projects",
  "pending",
  "next",
  "tickler",
  "references",
];

function freshnessReviewEntryViewEmpty() {
  return {
    ok: false,
    tier: "",
    label: "",
    detail: "",
    compact: "",
    actionHint: "",
  };
}

// Machine walk tier for an already-evaluated queue entry. v4 `tier`,
// else the legacy v3 `state` mapping (`resurfaced` reads as TICKLER).
function freshnessReviewMachineTier(entry) {
  const tier =
    entry && typeof entry.tier === "string"
      ? entry.tier.trim().toLowerCase()
      : "";
  if (
    tier === "pre" ||
    tier === "new" ||
    tier === "projects" ||
    tier === "pending" ||
    tier === "next" ||
    tier === "tickler" ||
    tier === "references" ||
    tier === "rotten" ||
    tier === "post"
  ) {
    return tier;
  }
  const state =
    entry && typeof entry.state === "string"
      ? entry.state.trim().toLowerCase()
      : "";
  if (state === "new") {
    return "new";
  }
  if (state === "rotten") {
    return "rotten";
  }
  if (state === "resurfaced") {
    return "tickler";
  }
  return "";
}

// `2026-10-07` -> `Oct 7`, else the raw text. Matches the navigation
// notice short-date, so shared presentation stays equivalent.
function freshnessReviewShortDate(text) {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || "").trim());
  if (!match) {
    return String(text || "");
  }
  const month = months[Number(match[2]) - 1];
  if (!month) {
    return String(text || "");
  }
  return month + " " + Number(match[3]);
}

function freshnessReviewLaneConfirmedDetail(entry, todayText) {
  const fresh =
    entry && typeof entry.fresh === "string" && entry.fresh
      ? entry.fresh
      : null;
  if (!fresh) {
    return "never confirmed";
  }
  const freshDay = freshnessDayNumberForDateText(fresh);
  const todayDay = freshnessDayNumberForDateText(todayText);
  let age = null;
  if (freshDay !== null && todayDay !== null) {
    age = todayDay - freshDay;
  } else if (
    entry &&
    Number.isFinite(entry.daysOverdue) &&
    Number.isInteger(entry.interval)
  ) {
    age = Math.max(0, Math.floor(entry.daysOverdue)) + entry.interval;
  }
  if (age === null || !Number.isFinite(age)) {
    return "confirmed " + fresh;
  }
  if (age <= 0) {
    return "confirmed today";
  }
  if (age === 1) {
    return "confirmed yesterday";
  }
  return "confirmed " + age + " days ago";
}

function freshnessReviewTrackerDetail(entry, kind) {
  const fresh =
    entry && typeof entry.fresh === "string" && entry.fresh
      ? entry.fresh
      : null;
  const interval =
    entry && Number.isInteger(entry.interval) ? entry.interval : null;
  const every = interval !== null ? " · every " + interval + "d" : "";
  if (!fresh) {
    return kind + " · never confirmed" + every;
  }
  const overdue =
    entry && Number.isFinite(entry.daysOverdue)
      ? Math.max(0, Math.floor(entry.daysOverdue))
      : null;
  const lead =
    overdue === null
      ? entry && typeof entry.dueOn === "string" && entry.dueOn
        ? "due " + freshnessReviewShortDate(entry.dueOn)
        : "due"
      : overdue < 1
        ? "due today"
        : overdue + "d overdue";
  return (
    kind +
    " · " +
    lead +
    " · confirmed " +
    freshnessReviewShortDate(fresh) +
    every
  );
}

function freshnessReviewRottenDetail(entry) {
  const interval =
    entry && Number.isInteger(entry.interval) ? entry.interval : null;
  const every = interval !== null ? " · every " + interval + "d" : "";
  const overdue =
    entry && Number.isFinite(entry.daysOverdue)
      ? Math.max(0, Math.floor(entry.daysOverdue))
      : null;
  if (overdue === null || overdue < 1) {
    return "due today" + every;
  }
  return "rotten " + overdue + "d" + every;
}

function freshnessReviewRottenCompact(entry) {
  const overdue =
    entry && Number.isFinite(entry.daysOverdue)
      ? Math.max(0, Math.floor(entry.daysOverdue))
      : null;
  if (overdue === null || overdue < 1) {
    return "due today";
  }
  return "rotten " + overdue + "d";
}

// Pure presentation for one already-evaluated review-queue entry.
// Formats stored fields; it does not re-evaluate or mutate rows.
// Never throws: invalid input yields `{ ok: false }`.
function freshnessReviewEntryView(entry, options = {}) {
  try {
    if (!entry || typeof entry !== "object") {
      return freshnessReviewEntryViewEmpty();
    }
    const tier = freshnessReviewMachineTier(entry);
    if (!tier) {
      return freshnessReviewEntryViewEmpty();
    }
    const label =
      (entry && typeof entry.tierLabel === "string" && entry.tierLabel
        ? entry.tierLabel
        : "") ||
      freshnessTierLabel(tier) ||
      tier.toUpperCase();
    const todayText =
      options && typeof options.todayText === "string"
        ? options.todayText
        : null;
    let detail = "";
    let compact = "";
    let actionHint = "";
    if (tier === "pre") {
      detail = "checklist";
      compact = "checklist";
      actionHint = "Ctrl+Enter done · ]s skip";
    } else if (tier === "post") {
      detail = "closeout";
      compact = "closeout";
      actionHint = "Ctrl+Enter done · closes the review";
    } else if (tier === "projects") {
      detail = freshnessReviewTrackerDetail(entry, "Empty project");
      compact = "Empty project";
    } else if (tier === "references") {
      detail = freshnessReviewTrackerDetail(entry, "Reference");
      compact = "Reference";
    } else if (tier === "pending" || tier === "next") {
      detail = freshnessReviewLaneConfirmedDetail(entry, todayText);
      compact = detail;
      actionHint =
        tier === "pending"
          ? "Still pending? Ctrl+Alt+F keep · Alt+N release · Ctrl+Shift+Enter today"
          : "Still next? Ctrl+Alt+F keep · Alt+N release · Ctrl+Shift+Enter today";
    } else if (tier === "tickler") {
      const since =
        entry && typeof entry.dueOn === "string" && entry.dueOn
          ? entry.dueOn
          : entry && typeof entry.fresh === "string"
            ? entry.fresh
            : "";
      detail = since ? "back since " + freshnessReviewShortDate(since) : "tickler";
      compact = detail;
    } else if (tier === "rotten") {
      detail = freshnessReviewRottenDetail(entry);
      compact = freshnessReviewRottenCompact(entry);
    }
    return {
      ok: true,
      tier,
      label,
      detail,
      compact,
      actionHint,
    };
  } catch (error) {
    return freshnessReviewEntryViewEmpty();
  }
}

function freshnessFooterTierCount(counts, key, legacy) {
  const safe = counts && typeof counts === "object" ? counts : {};
  if (safe.byTier && typeof safe.byTier === "object") {
    const value = safe.byTier[key];
    if (Number.isInteger(value) && value >= 0) {
      return value;
    }
  }
  return Number.isInteger(legacy) && legacy >= 0 ? legacy : 0;
}

function freshnessFooterReadTiers(counts) {
  const safe = counts && typeof counts === "object" ? counts : {};
  const tiers = {
    pre: freshnessFooterTierCount(safe, "pre", safe.preDue),
    new: freshnessFooterTierCount(safe, "new", safe.new),
    projects: freshnessFooterTierCount(safe, "projects", safe.projectsDue),
    pending: freshnessFooterTierCount(safe, "pending", safe.pendingDue),
    next: freshnessFooterTierCount(safe, "next", safe.nextDue),
    tickler: freshnessFooterTierCount(safe, "tickler", safe.resurfaced),
    references: freshnessFooterTierCount(safe, "references", safe.referencesDue),
    rotten: freshnessFooterTierCount(safe, "rotten", safe.rotten),
    post: freshnessFooterTierCount(safe, "post", safe.postDue),
  };
  const walk =
    Number.isInteger(safe.walk) && safe.walk >= 0
      ? safe.walk
      : FRESHNESS_FOOTER_TIERS.reduce((sum, key) => sum + tiers[key], 0);
  const upkeep =
    Number.isInteger(safe.upkeepToday) && safe.upkeepToday >= 0
      ? safe.upkeepToday
      : Number.isInteger(safe.refreshedToday) && safe.refreshedToday >= 0
        ? safe.refreshedToday
        : 0;
  const budget =
    Number.isInteger(safe.budget) && safe.budget >= 1 ? safe.budget : null;
  let commitments = 0;
  for (const key of FRESHNESS_FOOTER_COMMITMENT_TIERS) {
    commitments += tiers[key];
  }
  return {
    tiers,
    walk,
    upkeep,
    budget,
    budgetMet: Boolean(safe.budgetMet),
    commitments,
  };
}

function freshnessFooterGroups(counts) {
  try {
    const { tiers } = freshnessFooterReadTiers(counts);
    const groups = [];
    for (const key of FRESHNESS_FOOTER_TIERS) {
      const count = tiers[key];
      if (Number.isInteger(count) && count > 0) {
        groups.push({
          key,
          label: freshnessTierFooterLabel(key),
          count,
        });
      }
    }
    return groups;
  } catch (error) {
    return [];
  }
}

function freshnessFooterHiddenView() {
  return {
    visible: false,
    mode: "hidden",
    walk: 0,
    commitments: 0,
    dueText: "",
    contextText: "",
    detailText: "",
    hintText: "",
    groups: [],
    groupsText: "",
    meterText: "",
    tooltip: "",
    ariaLabel: "",
    current: null,
    action: "review",
  };
}

function freshnessFooterJoin(parts) {
  return parts.filter((part) => part && String(part).trim()).join(" · ");
}

// Match the active editor cursor to a live queue entry. `cursor` is
// `{ path, line0, sourceLine, sourceLines? }` with a 0-based line.
// Exact path+line wins when the source line still matches; a moved
// line is accepted only as a unique verified originalMarkdown identity.
// Duplicate text or duplicate block IDs never borrow another rank.
function freshnessMatchQueueCursor(queue, cursor) {
  try {
    if (!cursor || typeof cursor !== "object") {
      return null;
    }
    const path = String(cursor.path || "");
    const line0 = Number.isInteger(cursor.line0)
      ? cursor.line0
      : Number.isInteger(cursor.line)
        ? cursor.line
        : null;
    const sourceLine =
      typeof cursor.sourceLine === "string" ? cursor.sourceLine : null;
    if (!path || !Number.isInteger(line0) || line0 < 0) {
      return null;
    }
    const list = Array.isArray(queue) ? queue : [];
    const onPath = [];
    for (const entry of list) {
      if (entry && String(entry.path || "") === path) {
        onPath.push(entry);
      }
    }
    if (onPath.length === 0) {
      return null;
    }
    const lineMatches = [];
    for (const entry of onPath) {
      const zero = Number.isInteger(entry.lineNumber)
        ? entry.lineNumber
        : Number.isInteger(entry.line)
          ? entry.line - 1
          : null;
      if (zero === line0) {
        lineMatches.push(entry);
      }
    }
    if (lineMatches.length > 1) {
      return null;
    }
    if (lineMatches.length === 1) {
      const entry = lineMatches[0];
      const want = String(entry.originalMarkdown || entry.text || "");
      if (sourceLine !== null && want && sourceLine !== want) {
        return null;
      }
      return entry;
    }
    if (!sourceLine) {
      return null;
    }
    const textMatches = [];
    const blockIds = new Map();
    for (const entry of onPath) {
      if (String(entry.originalMarkdown || "") === sourceLine) {
        textMatches.push(entry);
      }
      const blockId =
        entry && entry.blockId ? String(entry.blockId) : "";
      if (blockId) {
        blockIds.set(blockId, (blockIds.get(blockId) || 0) + 1);
      }
    }
    if (textMatches.length !== 1) {
      return null;
    }
    const unique = textMatches[0];
    const uniqueBlock =
      unique && unique.blockId ? String(unique.blockId) : "";
    if (uniqueBlock && (blockIds.get(uniqueBlock) || 0) > 1) {
      return null;
    }
    const sourceLines = cursor.sourceLines;
    if (Array.isArray(sourceLines)) {
      let hits = 0;
      for (const line of sourceLines) {
        if (line === sourceLine) {
          hits += 1;
          if (hits > 1) {
            return null;
          }
        }
      }
      if (hits !== 1) {
        return null;
      }
    }
    return unique;
  } catch (error) {
    return null;
  }
}

// Compact live review footer from one memo's `counts` and `queue`.
// Visible only for a usable, warm snapshot whose queue length is > 0.
// Never throws; unavailable, cold, or failed data hide the item.
function freshnessFooterView(memo, options = {}) {
  try {
    if (options && options.tasksAvailable === false) {
      return freshnessFooterHiddenView();
    }
    if (!memo || typeof memo !== "object") {
      return freshnessFooterHiddenView();
    }
    if (memo.tasksAvailable === false) {
      return freshnessFooterHiddenView();
    }
    const counts = memo.counts && typeof memo.counts === "object"
      ? memo.counts
      : memo;
    const queue = Array.isArray(memo.queue)
      ? memo.queue
      : Array.isArray(options.queue)
        ? options.queue
        : [];
    if (queue.length === 0) {
      return freshnessFooterHiddenView();
    }
    const read = freshnessFooterReadTiers(counts);
    if (!Number.isInteger(read.walk) || read.walk <= 0) {
      return freshnessFooterHiddenView();
    }
    const navAvailable = options.navAvailable !== false;
    const action = navAvailable ? "jump" : "review";
    const hintDefault = navAvailable ? "]s next" : "open review";
    let current = null;
    const currentEntry =
      options.current && typeof options.current === "object"
        ? options.current
        : null;
    if (currentEntry) {
      const presentation = freshnessReviewEntryView(currentEntry, {
        todayText: options.todayText,
      });
      if (presentation.ok) {
        const rank = Number.isInteger(currentEntry.rank)
          ? currentEntry.rank
          : null;
        const total = Number.isInteger(read.walk) ? read.walk : queue.length;
        if (rank !== null && rank >= 1) {
          current = {
            key: currentEntry.key || null,
            rank,
            total,
            tier: presentation.tier,
            label:
              freshnessTierFooterLabel(presentation.tier) ||
              presentation.label,
            tierRank: Number.isInteger(currentEntry.tierRank)
              ? currentEntry.tierRank
              : null,
            tierTotal: Number.isInteger(currentEntry.tierTotal)
              ? currentEntry.tierTotal
              : null,
            compact: presentation.compact,
            detail: presentation.detail,
            actionHint: presentation.actionHint,
          };
        }
      }
    }
    const allGroups = freshnessFooterGroups(counts);
    const groups = current
      ? allGroups.filter((group) => group.key !== current.tier)
      : allGroups.slice();
    const groupsText = groups
      .map((group) => group.label + " " + group.count)
      .join(" · ");
    const meter =
      read.budget !== null
        ? read.upkeep + "/" + read.budget
        : String(read.upkeep);
    const meterText = "✓ " + meter + " today";
    const dueText = current
      ? "Review " + current.rank + "/" + current.total
      : "Review " + read.walk + " due";
    let contextText = "";
    let detailText = "";
    let hintText = "";
    if (current) {
      if (
        current.label &&
        Number.isInteger(current.tierRank) &&
        Number.isInteger(current.tierTotal)
      ) {
        contextText = current.label + " " + current.tierRank + "/" + current.tierTotal;
      } else if (current.label) {
        contextText = current.label;
      }
      detailText = current.compact || "";
    } else if (read.commitments > 0) {
      contextText =
        read.commitments === 1
          ? "1 commitment"
          : read.commitments + " commitments";
      hintText = hintDefault;
    } else if (read.budgetMet) {
      contextText = "Upkeep budget met";
      hintText = hintDefault;
    } else {
      contextText = "Commitments done";
      hintText = hintDefault;
    }
    let mode = "due";
    if (read.tiers.new > 0) {
      mode = "new";
    } else if (read.commitments > 0) {
      mode = "due";
    } else if (read.budgetMet) {
      mode = "budget";
    } else {
      mode = "due";
    }
    const mostOverdue =
      Number.isInteger(options.mostOverdue) && options.mostOverdue >= 0
        ? options.mostOverdue
        : null;
    const shownTiers = new Set(groups.map((group) => group.key));
    if (current && current.tier) {
      shownTiers.add(current.tier);
    }
    const legendParts = [];
    if (shownTiers.has("pending")) {
      legendParts.push("WIP = PENDING");
    }
    if (shownTiers.has("tickler")) {
      legendParts.push("TICKS = TICKLER");
    }
    if (shownTiers.has("references")) {
      legendParts.push("REFS = REFERENCES");
    }
    const legendText = legendParts.join(" · ");
    const tooltipLines = [
      freshnessFooterJoin([
        dueText,
        contextText,
        detailText,
        hintText,
      ]),
      groupsText,
      freshnessFooterJoin([
        meterText,
        mostOverdue === null ? "" : "oldest " + mostOverdue + "d overdue",
      ]),
      legendText,
      "Footer splits TICKS from ROTTEN; dashboard ROTTEN chips still fold both.",
    ];
    if (current && current.detail && current.detail !== current.compact) {
      tooltipLines.splice(1, 0, current.detail);
    }
    if (current && current.actionHint) {
      tooltipLines.push(current.actionHint);
    }
    tooltipLines.push(
      action === "jump"
        ? "click for the next due task"
        : "click to open the review page",
    );
    const tooltip = tooltipLines.filter(Boolean).join("\n");
    const ariaLabel = freshnessFooterJoin([
      dueText,
      contextText,
      detailText,
      groupsText,
      meterText,
      hintText,
    ]);
    return {
      visible: true,
      mode,
      walk: read.walk,
      commitments: read.commitments,
      dueText,
      contextText,
      detailText,
      hintText,
      groups,
      groupsText,
      meterText,
      tooltip,
      ariaLabel,
      current,
      action,
    };
  } catch (error) {
    return freshnessFooterHiddenView();
  }
}

function freshnessFooterSetText(node, text) {
  if (!node) {
    return;
  }
  const value = text == null ? "" : String(text);
  try {
    if (typeof node.setText === "function") {
      node.setText(value);
    } else if ("textContent" in node) {
      node.textContent = value;
    }
  } catch (error) {
    // Cosmetic.
  }
}

function freshnessFooterSetAttr(node, name, value) {
  if (!node) {
    return;
  }
  try {
    if (typeof node.setAttribute === "function") {
      node.setAttribute(name, value);
    } else if (name === "title") {
      node.title = value;
    }
  } catch (error) {
    // Cosmetic.
  }
}

function freshnessFooterToggleClass(node, name, on) {
  if (!node || !name) {
    return;
  }
  try {
    if (node.classList && typeof node.classList.add === "function") {
      if (on) {
        node.classList.add(name);
      } else if (typeof node.classList.remove === "function") {
        node.classList.remove(name);
      }
      return;
    }
    if (typeof node.addClass === "function" && on) {
      node.addClass(name);
      return;
    }
    if (typeof node.removeClass === "function" && !on) {
      node.removeClass(name);
    }
  } catch (error) {
    // Cosmetic.
  }
}

function freshnessFooterCreateChild(parent, tag, className) {
  if (!parent) {
    return null;
  }
  try {
    if (typeof parent.createEl === "function") {
      return parent.createEl(tag, { cls: className });
    }
  } catch (error) {
    // Fall through to DOM.
  }
  try {
    const doc =
      parent.ownerDocument ||
      (typeof document !== "undefined" ? document : null);
    if (doc && typeof doc.createElement === "function") {
      const node = doc.createElement(tag);
      if (className) {
        node.className = className;
      }
      if (typeof parent.appendChild === "function") {
        parent.appendChild(node);
      }
      return node;
    }
  } catch (error) {
    return null;
  }
  return null;
}

function freshnessFooterEnsureDom(el) {
  if (!el) {
    return null;
  }
  if (el._bobFreshnessParts && el._bobFreshnessParts.button) {
    return el._bobFreshnessParts;
  }
  try {
    if (typeof el.empty === "function") {
      el.empty();
    } else if ("textContent" in el) {
      el.textContent = "";
    }
  } catch (error) {
    // Rebuild below.
  }
  const button = freshnessFooterCreateChild(el, "button", "bob-freshness-main");
  if (!button) {
    return null;
  }
  freshnessFooterSetAttr(button, "type", "button");
  const icon = freshnessFooterCreateChild(
    button,
    "span",
    "bob-freshness-icon",
  );
  freshnessFooterSetText(icon, "⟳");
  const due = freshnessFooterCreateChild(button, "span", "bob-freshness-due");
  const context = freshnessFooterCreateChild(
    el,
    "span",
    "bob-freshness-context",
  );
  const detail = freshnessFooterCreateChild(
    el,
    "span",
    "bob-freshness-detail",
  );
  const hint = freshnessFooterCreateChild(el, "span", "bob-freshness-hint");
  const groups = freshnessFooterCreateChild(
    el,
    "span",
    "bob-freshness-groups",
  );
  const meter = freshnessFooterCreateChild(el, "span", "bob-freshness-meter");
  const parts = { button, icon, due, context, detail, hint, groups, meter };
  el._bobFreshnessParts = parts;
  return parts;
}

function freshnessFooterSetOmitted(node, omitted) {
  freshnessFooterToggleClass(node, "bob-freshness-omit", omitted);
  if (omitted) {
    freshnessFooterSetAttr(node, "hidden", "hidden");
  } else if (node && typeof node.removeAttribute === "function") {
    try {
      node.removeAttribute("hidden");
    } catch (error) {
      // Cosmetic.
    }
  }
}

// Hide optional parts in this order until the item fits: groups, then
// optional detail, shortcut hint, upkeep meter. The main due total or
// current rank and tier stay visible.
function freshnessFooterFit(el, parts, view) {
  const show = {
    groups: Boolean(view && view.groupsText),
    detail: Boolean(view && view.detailText),
    hint: Boolean(view && view.hintText),
    meter: Boolean(view && view.meterText),
  };
  const apply = () => {
    freshnessFooterSetOmitted(parts.groups, !show.groups);
    freshnessFooterSetOmitted(parts.detail, !show.detail);
    freshnessFooterSetOmitted(parts.hint, !show.hint);
    freshnessFooterSetOmitted(parts.meter, !show.meter);
  };
  apply();
  let width = 0;
  try {
    width = Number(el.clientWidth);
  } catch (error) {
    return show;
  }
  if (!Number.isFinite(width) || width <= 0) {
    return show;
  }
  const overflows = () => {
    try {
      return Number(el.scrollWidth) > Number(el.clientWidth) + 1;
    } catch (error) {
      return false;
    }
  };
  if (!overflows()) {
    return show;
  }
  show.groups = false;
  apply();
  if (!overflows()) {
    return show;
  }
  show.detail = false;
  apply();
  if (!overflows()) {
    return show;
  }
  show.hint = false;
  apply();
  if (!overflows()) {
    return show;
  }
  show.meter = false;
  apply();
  return show;
}

function freshnessFooterPaint(el, view) {
  if (!el) {
    return null;
  }
  const parts = freshnessFooterEnsureDom(el);
  if (!parts) {
    return null;
  }
  const visible = Boolean(view && view.visible);
  freshnessFooterToggleClass(el, "bob-freshness-hidden", !visible);
  freshnessFooterSetAttr(el, "aria-hidden", visible ? "false" : "true");
  const modes = [
    "bob-freshness-unavailable",
    "bob-freshness-new",
    "bob-freshness-due",
    "bob-freshness-clear",
    "bob-freshness-budget",
    "bob-freshness-hidden",
  ];
  const wanted = visible
    ? "bob-freshness-" + (view.mode || "due")
    : "bob-freshness-hidden";
  try {
    if (el.classList && typeof el.classList.add === "function") {
      for (const mode of modes) {
        if (mode === wanted || (mode === "bob-freshness-hidden" && !visible)) {
          el.classList.add(mode);
        } else if (typeof el.classList.remove === "function") {
          el.classList.remove(mode);
        }
      }
      el.classList.add("bob-freshness");
      if (!visible) {
        el.classList.add("bob-freshness-hidden");
      }
    }
  } catch (error) {
    // Classes are cosmetic.
  }
  if (parts.button) {
    try {
      parts.button.disabled = !visible;
      parts.button.tabIndex = visible ? 0 : -1;
    } catch (error) {
      // Focus management is best-effort.
    }
  }
  if (!visible) {
    freshnessFooterSetText(parts.due, "");
    freshnessFooterSetText(parts.context, "");
    freshnessFooterSetText(parts.detail, "");
    freshnessFooterSetText(parts.hint, "");
    freshnessFooterSetText(parts.groups, "");
    freshnessFooterSetText(parts.meter, "");
    freshnessFooterSetAttr(parts.button, "aria-label", "Review footer hidden");
    freshnessFooterSetAttr(el, "title", "");
    return parts;
  }
  freshnessFooterSetText(parts.due, view.dueText);
  freshnessFooterSetText(parts.context, view.contextText);
  freshnessFooterSetText(parts.detail, view.detailText);
  freshnessFooterSetText(parts.hint, view.hintText);
  freshnessFooterSetText(parts.groups, view.groupsText);
  freshnessFooterSetText(parts.meter, view.meterText);
  freshnessFooterSetOmitted(parts.context, !view.contextText);
  freshnessFooterSetOmitted(parts.detail, !view.detailText);
  freshnessFooterSetOmitted(parts.hint, !view.hintText);
  freshnessFooterSetOmitted(parts.groups, !view.groupsText);
  freshnessFooterSetOmitted(parts.meter, !view.meterText);
  freshnessFooterToggleClass(
    parts.context,
    "bob-freshness-tier",
    Boolean(view.current),
  );
  freshnessFooterSetAttr(parts.button, "aria-label", view.ariaLabel || view.tooltip);
  freshnessFooterSetAttr(el, "title", view.tooltip);
  freshnessFooterSetAttr(parts.button, "title", view.tooltip);
  freshnessFooterFit(el, parts, view);
  return parts;
}
