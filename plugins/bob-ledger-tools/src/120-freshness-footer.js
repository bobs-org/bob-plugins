const FRESHNESS_FOOTER_TIERS = [
  "pre",
  "new",
  "projects",
  "pending",
  "next",
  "recurring",
  "tickler",
  "rotten",
  "post",
];

const FRESHNESS_FOOTER_COMMITMENT_TIERS = [
  "pre",
  "new",
  "projects",
  "pending",
  "next",
  "recurring",
  "tickler",
];

const FRESHNESS_FOOTER_ANSWER_TIERS = ["tickler"];

function freshnessFooterAnswerChipStructuredSegments(preview, kind, text) {
  try {
    const parts =
      preview && typeof preview === "object" ? preview.parts : null;
    if (!parts || typeof parts !== "object") {
      return null;
    }
    const keyLabel =
      typeof parts.keyLabel === "string" && parts.keyLabel ? parts.keyLabel : null;
    const verb =
      typeof parts.verb === "string" && parts.verb ? parts.verb : null;
    if (!keyLabel || !verb) {
      return null;
    }
    const fromRaw = parts.fromLabel === undefined ? null : parts.fromLabel;
    const toRaw = parts.toLabel === undefined ? null : parts.toLabel;
    const fromLabel =
      fromRaw === null ? null : typeof fromRaw === "string" && fromRaw ? fromRaw : null;
    const toLabel =
      toRaw === null ? null : typeof toRaw === "string" && toRaw ? toRaw : null;
    if ((fromRaw !== null && fromRaw !== undefined && fromLabel === null) ||
      (toRaw !== null && toRaw !== undefined && toLabel === null)) {
      return null;
    }
    const stepRaw = parts.step === undefined ? null : parts.step;
    const limitRaw = parts.limit === undefined ? null : parts.limit;
    const step =
      stepRaw === null ? null : Number.isInteger(Number(stepRaw)) ? Number(stepRaw) : null;
    const limit =
      limitRaw === null ? null : Number.isInteger(Number(limitRaw)) ? Number(limitRaw) : null;
    if ((stepRaw !== null && stepRaw !== undefined && step === null) ||
      (limitRaw !== null && limitRaw !== undefined && limit === null)) {
      return null;
    }
    const key = (value) => ({ role: "key", text: value });
    const space = () => ({ role: "space", text: " " });
    const seg = (role, value) => ({ role, text: value });
    let segments = null;
    if (kind === "roll") {
      if (verb !== "roll" || fromLabel !== null || !toLabel) {
        return null;
      }
      if ((step === null) !== (limit === null)) {
        return null;
      }
      segments = [key(keyLabel), space(), seg("verb", verb), space(), seg("to", toLabel)];
      if (step !== null && limit !== null) {
        segments.push(space(), seg("count", step + "/" + limit));
      }
    } else if (kind === "decay") {
      if (verb !== "decay" || !fromLabel || !toLabel || step !== null || limit !== null) {
        return null;
      }
      segments = [
        key(keyLabel),
        space(),
        seg("verb", verb),
        space(),
        seg("from", fromLabel),
        seg("arrow", "→"),
        seg("to", toLabel),
      ];
    } else if (kind === "assign") {
      if (verb !== "set" || fromLabel !== null || !toLabel || step !== null || limit !== null) {
        return null;
      }
      segments = [key(keyLabel), space(), seg("verb", verb), space(), seg("to", toLabel)];
    } else if (kind === "cancel") {
      if ((verb !== "cancel?" && verb !== "cancel") || fromLabel !== null || toLabel !== null || step !== null || limit !== null) {
        return null;
      }
      segments = [key(keyLabel), space(), seg("verb", verb)];
    } else {
      return null;
    }
    if (segments.map((entry) => entry.text).join("") !== text) {
      return null;
    }
    return segments;
  } catch (error) {
    return null;
  }
}

function freshnessFooterAnswerChip(preview, current) {
  try {
    const tier = current && typeof current.tier === "string" ? current.tier : "";
    if (!FRESHNESS_FOOTER_ANSWER_TIERS.includes(tier)) {
      return null;
    }
    if (!preview || typeof preview !== "object" || preview.ok !== true) {
      return null;
    }
    if (typeof preview.compact !== "string" || preview.compact.trim() === "") {
      return null;
    }
    const kind = preview.kind;
    if (kind !== "roll" && kind !== "decay" && kind !== "assign" && kind !== "cancel") {
      return null;
    }
    const text = preview.compact.trim();
    const title =
      typeof preview.detail === "string" && preview.detail.trim()
        ? preview.detail.trim()
        : text;
    const key = JSON.stringify([
      current && "key" in Object(current) ? current.key : null,
      current && Number.isInteger(current.rank) ? current.rank : null,
      kind,
      text,
      title,
    ]);
    let segments = freshnessFooterAnswerChipStructuredSegments(preview, kind, text);
    if (!segments) {
      const firstSpace = text.indexOf(" ");
      if (firstSpace < 0) {
        segments = [{ role: "action", text }];
      } else {
        segments = [
          { role: "key", text: text.slice(0, firstSpace) },
          { role: "space", text: " " },
          { role: "action", text: text.slice(firstSpace + 1) },
        ];
      }
      if (segments.map((entry) => entry.text).join("") !== text) {
        return null;
      }
    }
    const frozenSegments = Object.freeze(
      segments.map((entry) => Object.freeze({ role: entry.role, text: entry.text })),
    );
    return Object.freeze({ kind, tier, text, title, key, segments: frozenSegments });
  } catch (error) {
    return null;
  }
}

function freshnessReviewEntryViewEmpty() {
  return {
    ok: false,
    tier: "",
    label: "",
    detail: "",
    compact: "",
    stage: null,
    actionHint: "",
  };
}

function freshnessReviewStagePresentation(entry) {
  const raw = entry && typeof entry.stage === "string" ? entry.stage.trim() : "";
  if (!raw) {
    return null;
  }
  const label = raw.toUpperCase();
  const rank = Number.isInteger(entry.stageRank) ? entry.stageRank : null;
  const total = Number.isInteger(entry.stageTotal) ? entry.stageTotal : null;
  const detail = rank !== null && rank >= 1 && total !== null && total >= 2
    ? `${label} ${rank}/${total}`
    : label;
  return { label, detail };
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
    tier === "recurring" ||
    tier === "tickler" ||
    tier === "rotten" ||
    tier === "post"
  ) {
    return tier;
  }
  // Legacy queue entries are tagged only by navigation when they came
  // from a freshness namespace <=10. New producers never emit this tier.
  if (
    tier === "references" &&
    entry &&
    entry.legacyReferenceTier === true
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
    let stage = null;
    let actionHint = "";
    if (tier === "pre") {
      stage = freshnessReviewStagePresentation(entry);
      detail = stage ? stage.detail : "checklist";
      compact = stage ? stage.label : "checklist";
      actionHint = "Ctrl+Enter done · ]s skip";
    } else if (tier === "post") {
      stage = freshnessReviewStagePresentation(entry);
      detail = stage ? stage.detail : "closeout";
      compact = stage ? stage.label : "closeout";
      actionHint = stage ? "Ctrl+Enter done · ]s skip" : "Ctrl+Enter done · closes the review";
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
    } else if (tier === "recurring") {
      const overdue =
        entry && Number.isFinite(entry.daysOverdue)
          ? Math.max(0, Math.floor(entry.daysOverdue))
          : null;
      detail =
        overdue === null || overdue < 1
          ? "recurring · due today"
          : "recurring · " + overdue + "d overdue";
      compact = detail;
      actionHint =
        "Ctrl+Enter done · Ctrl+Shift+Enter today · Ctrl+Shift+P reschedule · ]s skip";
    } else if (tier === "tickler") {
      const since =
        entry && typeof entry.dueOn === "string" && entry.dueOn
          ? entry.dueOn
          : entry && typeof entry.fresh === "string"
            ? entry.fresh
            : "";
      const source = entry && entry.returnedBy;
      const prefix = source === "unblocked" ? "unblocked " : "scheduled ";
      detail = since ? prefix + freshnessReviewShortDate(since) : "tickler";
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
      stage: stage ? stage.label : null,
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
    recurring: freshnessFooterTierCount(safe, "recurring", safe.recurringDue),
    tickler: freshnessFooterTierCount(safe, "tickler", safe.resurfaced),
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
    answer: null,
  };
}

function freshnessFooterOffwalkQuickRoll(preview) {
  try {
    if (
      !preview ||
      typeof preview !== "object" ||
      preview.ok !== true ||
      typeof preview.compact !== "string" ||
      preview.compact.trim() === "" ||
      !["roll", "decay", "cancel"].includes(preview.kind)
    ) {
      return null;
    }
    return {
      compact: preview.compact.trim(),
      detail: typeof preview.detail === "string" ? preview.detail.trim() : "",
    };
  } catch (error) {
    return null;
  }
}

function freshnessFooterHintOnlyView(preview, navAvailable) {
  const action = navAvailable ? "jump" : "review";
  const tooltipLines = ["Nothing due · " + preview.compact];
  if (preview.detail) {
    tooltipLines.push(preview.detail);
  }
  tooltipLines.push(
    action === "jump"
      ? "click for the next due task"
      : "click to open the review page",
  );
  const dueText = "Nothing due";
  const hintText = preview.compact;
  return {
    visible: true,
    mode: "clear",
    walk: 0,
    commitments: 0,
    dueText,
    contextText: "",
    detailText: "",
    hintText,
    groups: [],
    groupsText: "",
    meterText: "",
    tooltip: tooltipLines.join("\n"),
    ariaLabel: dueText + " · " + hintText,
    current: null,
    action,
    answer: null,
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
// A usable, warm snapshot shows the review queue, or only a prioritized
// Alt+P hint when nothing is due and the cursor has a matching preview.
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
    const navAvailable = options.navAvailable !== false;
    const offwalkQuickRoll = freshnessFooterOffwalkQuickRoll(options.quickRoll);
    if (queue.length === 0) {
      return offwalkQuickRoll
        ? freshnessFooterHintOnlyView(offwalkQuickRoll, navAvailable)
        : freshnessFooterHiddenView();
    }
    const read = freshnessFooterReadTiers(counts);
    if (!Number.isInteger(read.walk) || read.walk <= 0) {
      return offwalkQuickRoll
        ? freshnessFooterHintOnlyView(offwalkQuickRoll, navAvailable)
        : freshnessFooterHiddenView();
    }
    const action = navAvailable ? "jump" : "review";
    // Walker-footer host (plan 202611/walker_footers.md): the gated `s`
    // panel teaches the repeat key, so it hints `]] next` via
    // `options.repeatHint`. Absent, the hint is today's `]s next` and the
    // legacy fallback stays byte-compatible.
    const repeatHint =
      options &&
      typeof options.repeatHint === "string" &&
      options.repeatHint
        ? options.repeatHint
        : "]s next";
    const hintDefault = navAvailable ? repeatHint : "open review";
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
            stage: presentation.stage,
            actionHint: presentation.actionHint,
          };
        }
      }
    }
    const allGroups = freshnessFooterGroups(counts);
    const filteredGroups = current
      ? allGroups.filter((group) => group.key !== current.tier)
      : allGroups.slice();
    const boundaryIndex = filteredGroups.findIndex(
      (group) => !FRESHNESS_FOOTER_COMMITMENT_TIERS.includes(group.key),
    );
    const hasCommitmentBeforeBoundary =
      boundaryIndex > 0 &&
      filteredGroups
        .slice(0, boundaryIndex)
        .some((group) => FRESHNESS_FOOTER_COMMITMENT_TIERS.includes(group.key));
    const groups = filteredGroups.map((group, index) => ({
      key: group.key,
      label: group.label,
      count: group.count,
      boundary: index === boundaryIndex && hasCommitmentBeforeBoundary,
    }));
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
    // Additive roll preview from nav `api.quickRoll` v1 (plan
    // 202610/quick_roll_alt_p.md, phase footer-preview). Queue rows retain
    // their existing preview behavior. Off-walk previews use the hint slot
    // only for prioritized tasks.
    const quickRollOption =
      options && options.quickRoll && typeof options.quickRoll === "object"
        ? options.quickRoll
        : null;
    const quickRollReady =
      current !== null &&
      quickRollOption !== null &&
      quickRollOption.ok === true &&
      typeof quickRollOption.compact === "string" &&
      quickRollOption.compact.trim() !== "";
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
      detailText = (current.stage ? current.detail : current.compact) || "";
      if (quickRollReady) {
        hintText = quickRollOption.compact;
      }
    } else if (read.commitments > 0) {
      contextText =
        read.commitments === 1
          ? "1 commitment"
          : read.commitments + " commitments";
      hintText = offwalkQuickRoll ? offwalkQuickRoll.compact : hintDefault;
    } else if (read.budgetMet) {
      contextText = "Upkeep budget met";
      hintText = offwalkQuickRoll ? offwalkQuickRoll.compact : hintDefault;
    } else {
      contextText = "Commitments done";
      hintText = offwalkQuickRoll ? offwalkQuickRoll.compact : hintDefault;
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
    if (shownTiers.has("recurring")) {
      legendParts.push("RECUR = RECURRING");
    }
    if (shownTiers.has("tickler")) {
      legendParts.push("TICKS = TICKLER");
    }
    const legendText = legendParts.join(" · ");
    const tooltipLines = [
      freshnessFooterJoin([
        dueText,
        contextText,
        current ? current.compact : detailText,
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
    if (
      quickRollReady &&
      typeof quickRollOption.detail === "string" &&
      quickRollOption.detail.trim() !== ""
    ) {
      tooltipLines.push(quickRollOption.detail);
    } else if (offwalkQuickRoll && offwalkQuickRoll.detail) {
      tooltipLines.push(offwalkQuickRoll.detail);
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
    const answer =
      current && quickRollReady
        ? freshnessFooterAnswerChip(quickRollOption, current)
        : null;
    return {
      visible: true,
      mode,
      walk: read.walk,
      commitments: read.commitments,
      dueText,
      contextText,
      detailText,
      detailCompactText: current ? current.compact : "",
      hintText,
      groups,
      groupsText,
      meterText,
      tooltip,
      ariaLabel,
      current,
      action,
      answer,
    };
  } catch (error) {
    return freshnessFooterHiddenView();
  }
}
