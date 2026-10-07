// --- READY backlog ----------------------------------------------------------
// The shared READY backlog (`docs/plan.md`, "READY backlog"): the global
// dashboard backlog, regardless of which daily file hosts the badge.
//
// The predicate matches the dashboard READY section's effective filters:
// TODO type (including custom TODO symbols), dashboard visibility
// (template/conflict exclusion, dash.md self-exclusion, `#hide`
// case-insensitive substring match like Tasks `tag does not include
// #hide`, and the Tasks global query's `_conflicts` exclusion applied
// explicitly because `getTasks()` returns the raw cache), not
// dependency-blocked (against the full Tasks list), scheduled on or
// before the current local day, and not Today. Self-exclusion always
// refers to `dash.md`, never the hosting daily note. Tasks built-in
// path/folder filters are case-insensitive, so the helper lowercases
// paths before comparing.
const READY_DASH_PATH = "dash.md";
const READY_FALLBACK_CAP = 100;

// Shared dashboard section base visibility: the Tasks-effective filters
// READY and the PENDING/NEXT dashboard sections agree on. Hide uses a
// case-insensitive substring (`#hide`, `#hide/x`, `#Hide` all excluded),
// paths use lowercased `_templates`/`_conflicts` checks, dash
// self-exclusion is case-insensitive, and future schedules are out.
// Status, done, blocked, and TODAY are layered by callers.
function dashboardSectionBaseVisible(task, todayDay, dashPath = READY_DASH_PATH) {
  if (!task || typeof task !== "object") {
    return false;
  }
  const path = String(planTaskPath(task) || "");
  if (!path) {
    return false;
  }
  const lowered = path.toLowerCase();
  if (lowered.includes("_templates")) {
    return false;
  }
  if (lowered.includes("_conflicts")) {
    return false;
  }
  if (lowered === String(dashPath || "").toLowerCase()) {
    return false;
  }
  const tags = planTaskTags(task);
  if (
    tags.some(
      (tag) => typeof tag === "string" && tag.toLowerCase().includes("#hide"),
    )
  ) {
    return false;
  }
  if (todayDay !== null && todayDay !== undefined) {
    const scheduled = planTaskScheduledDay(task);
    if (scheduled !== null && scheduled > todayDay) {
      return false;
    }
  }
  return true;
}

function readyTaskStatusIsTodo(task) {
  if (!task || typeof task !== "object") {
    return false;
  }
  const status =
    task.status && typeof task.status === "object" ? task.status : null;
  if (status && typeof status.type === "string") {
    return status.type === "TODO";
  }
  return false;
}

function readyTaskVisible(task, todayDay) {
  if (!task || typeof task !== "object") {
    return false;
  }
  if (planTaskIsDone(task)) {
    return false;
  }
  if (!readyTaskStatusIsTodo(task)) {
    return false;
  }
  return dashboardSectionBaseVisible(task, todayDay, READY_DASH_PATH);
}

// Dashboard PENDING/NEXT section membership: the dash section model
// excludes TODAY and dash.md itself plus the shared base visibility
// (templates, conflicts, hide, future schedules), dependency-blocked
// tasks, and done tasks. Status uses IN_PROGRESS for PENDING and symbol
// `*` for NEXT; the standard configured statuses are unchanged.
function dashboardLaneStatusMatches(task, lane) {
  if (lane === "next") {
    return planTaskStatusSymbol(task) === "*";
  }
  if (lane === "pending") {
    const status =
      task && task.status && typeof task.status === "object"
        ? task.status
        : null;
    return status !== null && status.type === "IN_PROGRESS";
  }
  return false;
}

function dashboardLaneSectionVisible(task, list, todayDay, lane) {
  if (!dashboardSectionBaseVisible(task, todayDay, READY_DASH_PATH)) {
    return false;
  }
  if (planTaskIsDone(task)) {
    return false;
  }
  if (planTaskIsBlocked(task, list)) {
    return false;
  }
  return dashboardLaneStatusMatches(task, lane);
}

// Pure dashboard section budget over Tasks-plugin task objects.
// `isToday` is the caller's Today predicate. Returns
// `{ section, lane, cap, over, today }` with integers when available.
// Throws when `isToday` throws so callers degrade to unavailable rather
// than a partially gated zero.
function dashboardLaneBudgetFromTasks(tasks, today, caps, lane, isToday) {
  if (lane !== "pending" && lane !== "next") {
    throw new Error(`unknown lane: ${lane}`);
  }
  const effective = effectivePlanCaps(caps);
  const list = Array.isArray(tasks) ? tasks : [];
  const todayDay = planDayNumber(today === undefined ? new Date() : today);
  const isTodayPredicate =
    typeof isToday === "function" ? isToday : () => false;
  const cap = lane === "pending" ? effective.maxPending : effective.maxNext;
  const whole = laneBudgetFromTasks(list, today, effective, lane);
  let section = 0;
  let todayInLane = 0;
  for (const task of list) {
    if (!dashboardLaneSectionVisible(task, list, todayDay, lane)) {
      continue;
    }
    let todayFlag = false;
    try {
      todayFlag = Boolean(isTodayPredicate(task));
    } catch (error) {
      throw error;
    }
    if (todayFlag) {
      todayInLane += 1;
      continue;
    }
    section += 1;
  }
  return {
    section,
    lane: whole.count,
    count: section,
    laneCount: whole.count,
    today: todayInLane,
    cap,
    over: whole.over,
  };
}

// Shared dashboard lane badge view-model. `budget` is
// `{ section, lane, cap, over, today }` with nulls for unavailable.
// The badge shows the section count over the whole-lane cap
// (`section/cap`); the whole-lane pressure stays in the tooltip and
// accessible label. Red uses the whole lane (`lane > cap`).
function dashboardLaneBadgeModel(budget, lane) {
  const label = lane === "next" ? "NEXT" : "PENDING";
  const cap =
    budget && Number.isInteger(budget.cap) && budget.cap >= 1
      ? budget.cap
      : lane === "next"
        ? 15
        : 10;
  const section =
    budget &&
    (typeof budget.section === "number" || budget.section === null)
      ? budget.section
      : budget && typeof budget.count === "number"
        ? budget.count
        : null;
  const laneCount =
    budget &&
    (typeof budget.lane === "number" || budget.lane === null)
      ? budget.lane
      : budget && typeof budget.laneCount === "number"
        ? budget.laneCount
        : null;
  const today =
    budget && (typeof budget.today === "number" || budget.today === null)
      ? budget.today
      : null;
  if (
    section === null ||
    laneCount === null ||
    !Number.isInteger(section) ||
    section < 0 ||
    !Number.isInteger(laneCount) ||
    laneCount < 0
  ) {
    return {
      text: `${label} –`,
      tooltip: `${label} section unavailable; limit ${cap}. Live section excluding Today. Open ${label} Tasks in dash.`,
      aria: `${label}: unavailable (limit ${cap}). Open ${label} Tasks in dash.`,
      over: false,
      placeholder: true,
      section: null,
      lane: null,
      today: null,
      cap,
    };
  }
  const over = laneCount > cap;
  const todayText = Number.isInteger(today) ? today : Math.max(0, laneCount - section);
  const tooltip = over
    ? `${section} in this section; whole lane ${laneCount}/${cap}; ${todayText} in TODAY · ${laneCount - cap} over the limit. Live section excluding Today. Open ${label} Tasks in dash.`
    : `${section} in this section; whole lane ${laneCount}/${cap}; ${todayText} in TODAY. Live section excluding Today. Open ${label} Tasks in dash.`;
  const aria = over
    ? `${label}: ${section} of ${cap} in this section, whole lane ${laneCount} of ${cap}, ${laneCount - cap} over the limit, ${todayText} in TODAY. Open ${label} Tasks in dash.`
    : `${label}: ${section} of ${cap} in this section, whole lane ${laneCount} of ${cap}, ${todayText} in TODAY. Open ${label} Tasks in dash.`;
  return {
    text: `${label} ${section}/${cap}`,
    tooltip,
    aria,
    over,
    placeholder: false,
    section,
    lane: laneCount,
    today: todayText,
    cap,
  };
}

// Pure, testable READY count over Tasks-plugin task objects. `isToday`
// is the caller's Today predicate. Throws when `isToday` or `isBlocked`
// throws, so callers can degrade to an unavailable badge rather than a
// partial count.
//
// The optional `isReviewBucket` predicate gates the shared READY count
// (`docs/freshness.md` §4 in bob-cli): tasks it flags (NEW or ROTTEN
// review) are excluded from READY. A throwing predicate discards the
// partial gated count and recomputes the legacy ungated count, so a
// failure halfway through a batch never leaves a partially gated badge.
function readyCountFromTasks(tasks, today, isToday, isReviewBucket) {
  const list = Array.isArray(tasks) ? tasks : [];
  const todayDay = planDayNumber(today === undefined ? new Date() : today);
  const isTodayPredicate =
    typeof isToday === "function" ? isToday : () => false;
  const gated = typeof isReviewBucket === "function";
  const legacyCount = () => {
    let total = 0;
    for (const task of list) {
      if (!readyTaskVisible(task, todayDay)) {
        continue;
      }
      if (planTaskIsBlocked(task, list)) {
        continue;
      }
      let todayFlag = false;
      try {
        todayFlag = Boolean(isTodayPredicate(task));
      } catch (error) {
        throw error;
      }
      if (todayFlag) {
        continue;
      }
      total += 1;
    }
    return total;
  };
  if (!gated) {
    return legacyCount();
  }
  let count = 0;
  for (const task of list) {
    if (!readyTaskVisible(task, todayDay)) {
      continue;
    }
    if (planTaskIsBlocked(task, list)) {
      continue;
    }
    let todayFlag = false;
    try {
      todayFlag = Boolean(isTodayPredicate(task));
    } catch (error) {
      throw error;
    }
    if (todayFlag) {
      continue;
    }
    let review = false;
    try {
      review = Boolean(isReviewBucket(task));
    } catch (error) {
      return legacyCount();
    }
    if (review) {
      continue;
    }
    count += 1;
  }
  return count;
}

function readyBudgetFromTasks(tasks, today, caps, isToday, isReviewBucket) {
  const effective = effectivePlanCaps(caps);
  const cap = planReadyCapOrDefault(effective.maxReady, READY_FALLBACK_CAP);
  const count = readyCountFromTasks(
    tasks,
    today,
    isToday,
    isReviewBucket,
  );
  return { count, cap, over: count > cap };
}

// Shared READY badge view-model. `budget` is `{ count, cap, over }` with
// `count === null` for unavailable. Never throws.
function readyBadgeModel(budget, options = {}) {
  const invalid = Boolean(options.invalid);
  const cap =
    budget && Number.isInteger(budget.cap) && budget.cap >= 1
      ? budget.cap
      : READY_FALLBACK_CAP;
  const count =
    budget && (typeof budget.count === "number" || budget.count === null)
      ? budget.count
      : null;
  if (count === null || !Number.isInteger(count) || count < 0) {
    return {
      text: "READY –",
      tooltip:
        `READY backlog unavailable; limit ${cap}. ` +
        `Live current backlog excluding Today. Open READY Tasks in dash.` +
        (invalid ? " Plan config invalid, using defaults." : ""),
      aria: `READY: unavailable (limit ${cap}). Open READY Tasks in dash.`,
      over: false,
      placeholder: true,
      count: null,
      cap,
    };
  }
  const over = count > cap;
  const excess = count - cap;
  // Freshness-gated lanes carry total lane pressure: the gated READY
  // count plus the NEW and ROTTEN review buckets behind it.
  const lane = options.lane || null;
  const laneValid =
    lane &&
    Number.isInteger(lane.total) &&
    lane.total >= 0 &&
    Number.isInteger(lane.new) &&
    lane.new >= 0 &&
    Number.isInteger(lane.rotten) &&
    lane.rotten >= 0 &&
    lane.ready === count;
  const tooltip = laneValid
    ? `READY ${count}/${cap} · lane ${lane.total} = ${lane.new} new + ${lane.rotten} rotten + ${lane.ready} ready` +
      (over ? ` · ${excess} over the limit` : "") +
      (invalid ? " · plan config invalid, using defaults" : "")
    : over
      ? `${count} ready tasks; limit ${cap}; ${excess} over the limit. ` +
        `Live current backlog excluding Today. Open READY Tasks in dash.` +
        (invalid ? " Plan config invalid, using defaults." : "")
      : `${count} ready tasks; limit ${cap}. ` +
        `Live current backlog excluding Today. Open READY Tasks in dash.` +
        (invalid ? " Plan config invalid, using defaults." : "");
  const aria = over
    ? `READY: ${count} of ${cap} tasks, ${excess} over the limit. Open READY Tasks in dash.`
    : `READY: ${count} of ${cap} tasks. Open READY Tasks in dash.`;
  return {
    text: `READY ${count}/${cap}`,
    tooltip,
    aria,
    over,
    placeholder: false,
    count,
    cap,
  };
}

// Structured READY content: the shared badge renders separate label and
// value spans (`.bob-plan-ready-label` / `.bob-plan-ready-value`) so the
// dashboard and daily surfaces can style them like neighboring chips. One
// routine owns both initial paint and live refresh so updates never flatten
// the anchor back to plain text.
const READY_LABEL_TEXT = "READY";
const READY_LABEL_CLS = "bob-plan-ready-label";
const READY_VALUE_CLS = "bob-plan-ready-value";

function readyBadgeValueText(model) {
  if (
    !model ||
    model.placeholder ||
    model.count === null ||
    model.count === undefined
  ) {
    return "–";
  }
  return `${model.count}/${model.cap}`;
}

function setReadySpanText(span, text) {
  if (!span) {
    return;
  }
  if (typeof span.setText === "function") {
    span.setText(text);
    return;
  }
  // Real DOM elements expose textContent; minimal test stubs use `.text`.
  // Assigning `.text` on a real Element is a harmless expando, while setting
  // textContent on a stub without that field would create a misleading
  // duplicate source of truth, so prefer whichever already exists.
  if ("textContent" in span && typeof span.textContent === "string") {
    span.textContent = text;
  } else if ("text" in span) {
    span.text = text;
  } else if ("textContent" in span) {
    span.textContent = text;
  } else {
    span.text = text;
  }
}

function collectReadySpans(anchor, cls) {
  if (!anchor) {
    return [];
  }
  try {
    if (typeof anchor.querySelectorAll === "function") {
      return Array.from(anchor.querySelectorAll(`.${cls}`));
    }
  } catch (error) {
    // Fall through to the children scan below.
  }
  const children =
    (Array.isArray(anchor.children) && anchor.children) ||
    (Array.isArray(anchor.childNodes) && anchor.childNodes) ||
    [];
  return children.filter((child) => {
    if (!child) {
      return false;
    }
    if (typeof child.cls === "string") {
      return child.cls.split(/\s+/).includes(cls);
    }
    const classAttr =
      child.attrs && typeof child.attrs.class === "string"
        ? child.attrs.class
        : typeof child.className === "string"
          ? child.className
          : null;
    if (typeof classAttr === "string") {
      return classAttr.split(/\s+/).includes(cls);
    }
    if (child.classList && typeof child.classList.contains === "function") {
      try {
        return child.classList.contains(cls);
      } catch (error) {
        return false;
      }
    }
    return false;
  });
}

function findReadySpan(anchor, cls) {
  if (!anchor) {
    return null;
  }
  try {
    if (typeof anchor.querySelector === "function") {
      return anchor.querySelector(`.${cls}`) || null;
    }
  } catch (error) {
    // Fall through to the children scan below.
  }
  const matches = collectReadySpans(anchor, cls);
  return matches.length > 0 ? matches[0] : null;
}

function createReadySpan(anchor, cls, text) {
  if (anchor && typeof anchor.createEl === "function") {
    return anchor.createEl("span", { cls, text });
  }
  // Minimal-stub fallback: track the child so structure assertions still see
  // exactly one label and one value.
  const span = {
    tag: "span",
    cls,
    text,
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  if (Array.isArray(anchor.children)) {
    anchor.children.push(span);
  }
  return span;
}

// Update the anchor's child spans plus its model-dependent title,
// accessibility label, and state classes without replacing the anchor or
// disturbing its event listeners. Repeated calls leave exactly one label
// and one value span.
function setReadyAnchorContent(anchor, model, options = {}) {
  if (!anchor) {
    return;
  }
  // bob-cli-3d fix: keep the caller's chip-kind class instead of
  // hard-coding `bob-plan-ready`. Callers pass `{ kind: "pending" }`,
  // `{ kind: "next" }`, or `{ kind: "crowded" }`; the default stays
  // "ready" so existing callers are unchanged. `model.kind` is honored
  // as a fallback for models that carry it.
  const rawKind =
    options && typeof options.kind === "string" && options.kind
      ? options.kind
      : model && typeof model.kind === "string" && model.kind
        ? model.kind
        : "ready";
  const kind =
    rawKind === "pending" ||
    rawKind === "next" ||
    rawKind === "crowded" ||
    rawKind === "ready"
      ? rawKind
      : "ready";
  const labelText =
    options && typeof options.label === "string" && options.label
      ? options.label
      : model && typeof model.label === "string" && model.label
        ? model.label
        : READY_LABEL_TEXT;
  const valueText = readyBadgeValueText(model);
  let label = findReadySpan(anchor, READY_LABEL_CLS);
  if (!label) {
    label = createReadySpan(anchor, READY_LABEL_CLS, labelText);
  }
  setReadySpanText(label, labelText);
  let value = findReadySpan(anchor, READY_VALUE_CLS);
  if (!value) {
    value = createReadySpan(anchor, READY_VALUE_CLS, valueText);
  }
  setReadySpanText(value, valueText);
  // Drop extras so repeated updates never accumulate spans.
  for (const cls of [READY_LABEL_CLS, READY_VALUE_CLS]) {
    const matches = collectReadySpans(anchor, cls);
    for (let index = 1; index < matches.length; index += 1) {
      const extra = matches[index];
      try {
        if (extra && typeof extra.remove === "function") {
          extra.remove();
        } else if (
          anchor &&
          typeof anchor.removeChild === "function" &&
          extra &&
          extra.parentNode === anchor
        ) {
          anchor.removeChild(extra);
        } else if (anchor && Array.isArray(anchor.children)) {
          const at = anchor.children.indexOf(extra);
          if (at !== -1) {
            anchor.children.splice(at, 1);
          }
        }
      } catch (error) {
        // Best-effort dedupe only.
      }
    }
  }
  // Clear any flattened direct text left by older renders (or stub `.text`)
  // while preserving the span children. Never assign `.text` on a live
  // element: in Obsidian it is a setter that wipes the span children.
  try {
    const childNodes =
      anchor && anchor.childNodes != null ? anchor.childNodes : null;
    if (childNodes && typeof childNodes.length === "number") {
      for (const node of Array.from(childNodes)) {
        if (
          node &&
          node.nodeType === 3 &&
          node !== label &&
          node !== value
        ) {
          if (typeof anchor.removeChild === "function") {
            anchor.removeChild(node);
          }
        }
      }
    }
  } catch (error) {
    // Best-effort cleanup only.
  }
  try {
    const descriptor = anchor
      ? Object.getOwnPropertyDescriptor(anchor, "text")
      : undefined;
    if (descriptor && typeof descriptor.value === "string") {
      // Stub anchors carry `.text` as an own data property alongside
      // `.children`; keep it empty so a stale flattened value can never
      // shadow the spans. A live Obsidian accessor lives on the prototype
      // and must be left alone.
      anchor.text = "";
    }
  } catch (error) {
    // Best-effort cleanup only.
  }
  if (typeof anchor.setAttribute === "function") {
    anchor.setAttribute("title", model.tooltip);
    anchor.setAttribute("aria-label", model.aria);
    const cls =
      `bob-plan-chip bob-plan-${kind}${model.over ? " bob-plan-over" : ""}${model.placeholder ? " bob-plan-unavailable" : ""}`;
    anchor.setAttribute("class", cls);
    if (anchor.attrs && typeof anchor.attrs === "object") {
      anchor.attrs.class = cls;
    }
  }
  if (anchor && typeof anchor.cls === "string") {
    anchor.cls =
      `bob-plan-chip bob-plan-${kind}${model.over ? " bob-plan-over" : ""}${model.placeholder ? " bob-plan-unavailable" : ""}`;
  }
  if (anchor && typeof anchor.title === "string") {
    anchor.title = model.tooltip;
  }
}

// Shared NEW/ROTTEN chip content: separate label and value spans like
// the READY badge, so dashboard and rotten-summary chips style like
// neighboring chips. NEW shows 0 when empty and is red above 0;
// ROTTEN is neutral at 0, orange above 0, red once any tickler or
// age-expired row is a full interval overdue.
const REVIEW_LABEL_CLS = "bob-plan-review-label";
const REVIEW_VALUE_CLS = "bob-plan-review-value";

function reviewChipText(kind, review) {
  const active = review && review.available === true ? review : null;
  if (kind === "rotten") {
    return {
      label: "ROTTEN",
      value: active ? active.rottenText.replace(/^ROTTEN /, "") : "–",
      tooltip: active ? active.tooltip : "ROTTEN unavailable",
      aria: active ? active.tooltip : "ROTTEN: unavailable",
    };
  }
  return {
    label: "NEW",
    value: active ? String(active.new) : "–",
    tooltip: active
      ? "NEW " + active.new + " unconfirmed · " + active.meter + " today"
      : "NEW unavailable",
    aria: active
      ? "NEW: " + active.new + " unconfirmed"
      : "NEW: unavailable",
  };
}

function reviewChipClass(kind, review) {
  const active = review && review.available === true ? review : null;
  let cls = "bob-plan-chip bob-plan-review bob-plan-" + kind;
  if (!active) {
    return cls + " bob-plan-unavailable";
  }
  if (kind === "rotten") {
    if (review.escalated) {
      return cls + " bob-plan-over";
    }
    if (review.rotten > 0) {
      return cls + " bob-plan-warn";
    }
    return cls;
  }
  if (review.new > 0) {
    return cls + " bob-plan-over";
  }
  return cls;
}

function reviewChipHref(kind) {
  return kind === "rotten" ? "rotten" : "dash#NEW Tasks";
}

function setReviewAnchorContent(anchor, kind, review) {
  if (!anchor) {
    return;
  }
  const content = reviewChipText(kind, review);
  const cls = reviewChipClass(kind, review);
  let label = findReadySpan(anchor, REVIEW_LABEL_CLS);
  if (!label) {
    label = createReadySpan(anchor, REVIEW_LABEL_CLS, content.label);
  }
  setReadySpanText(label, content.label);
  let value = findReadySpan(anchor, REVIEW_VALUE_CLS);
  if (!value) {
    value = createReadySpan(anchor, REVIEW_VALUE_CLS, content.value);
  }
  setReadySpanText(value, content.value);
  for (const spanCls of [REVIEW_LABEL_CLS, REVIEW_VALUE_CLS]) {
    const matches = collectReadySpans(anchor, spanCls);
    for (let index = 1; index < matches.length; index += 1) {
      const extra = matches[index];
      try {
        if (extra && typeof extra.remove === "function") {
          extra.remove();
        } else if (anchor && Array.isArray(anchor.children)) {
          const at = anchor.children.indexOf(extra);
          if (at !== -1) {
            anchor.children.splice(at, 1);
          }
        }
      } catch (error) {
        // Best-effort dedupe only.
      }
    }
  }
  if (typeof anchor.setAttribute === "function") {
    anchor.setAttribute("title", content.tooltip);
    anchor.setAttribute("aria-label", content.aria);
    anchor.setAttribute("class", cls);
    if (anchor.attrs && typeof anchor.attrs === "object") {
      anchor.attrs.class = cls;
    }
  }
  if (anchor && typeof anchor.cls === "string") {
    anchor.cls = cls;
  }
  if (anchor && typeof anchor.title === "string") {
    anchor.title = content.tooltip;
  }
}

function paintReviewElement(host, kind, review) {
  try {
    if (!host || typeof host.createEl !== "function") {
      return null;
    }
    const anchor = host.createEl("a", {
      cls: reviewChipClass(kind, review),
      title: reviewChipText(kind, review).tooltip,
      href: reviewChipHref(kind),
    });
    setReviewAnchorContent(anchor, kind, review);
    if (anchor && typeof anchor.setAttribute === "function") {
      anchor.setAttribute("aria-label", reviewChipText(kind, review).aria);
      anchor.setAttribute("role", "link");
      if (
        typeof anchor.hasAttribute !== "function" ||
        !anchor.hasAttribute("tabindex")
      ) {
        anchor.setAttribute("tabindex", "0");
      }
    }
    return anchor;
  } catch (error) {
    return null;
  }
}

