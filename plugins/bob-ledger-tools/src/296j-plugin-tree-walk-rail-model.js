// Pure tree rail model (bob-cli-ra rail): the link-walk rail for area,
// project, notebook, and prose notes, reduced to plain kit specs. No DOM,
// no app access, never throws, never writes, never spawns. Callers pass the
// effective answer (walkMode.links when v7+, else the navGroups-shaped
// fallback) and the derived navGroups provider; the model paints effective
// stops and keeps the derived ring for the tick track.
//
// treeWalkRailModel({ answer, provider }) returns null (no rail) or
// { step, group, label, signature }:
// - step: { prev, parent, next } rail item specs, or null when the ring has
//   fewer than 2 members.
// - group: a kit group-row spec { prev, next, center }, or null. Ticks-only
//   centres need no arms; a one-member ring keeps arms only.
// - label: the rail's accessible name.
// - signature: a stable string over every painted target and label; mounted
//   rails repaint in place only when it changes.

const TREE_WALK_RAIL_LABEL = "Link walk";
const TREE_WALK_RAIL_GROUP_LABEL = "Parent groups";
const TREE_WALK_RAIL_CHANGED = "The stop changed — try again";

function treeWalkRailText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function treeWalkRailPlural(kind) {
  try {
    if (typeof NAV_GROUPS_TREE_PLURAL === "object" && NAV_GROUPS_TREE_PLURAL) {
      const plural = NAV_GROUPS_TREE_PLURAL[kind];
      if (typeof plural === "string" && plural.trim()) return plural.trim();
    }
  } catch (_) {}
  if (kind === "area") return "areas";
  if (kind === "project") return "projects";
  if (kind === "notebook") return "notebooks";
  return "prose notes";
}

function treeWalkRailLaneWord(kind, lane) {
  try {
    if (typeof navGroupsTreeLaneWord === "function") return navGroupsTreeLaneWord(kind, lane).trim();
  } catch (_) {}
  if (kind === "project") return (lane === "closed" ? "closed" : "open");
  return "";
}

// Plain copy of an effective stop, retaining the painted fields. Null when
// the stop has no target (ghosts keep their reason but still need no arm
// without a target, like the kit).
function treeWalkRailCopyStop(stop) {
  if (!stop || typeof stop !== "object") return null;
  const target = treeWalkRailText(stop.target).trim();
  const path = treeWalkRailText(stop.path).trim() || null;
  const state = stop.state === "creatable" || stop.state === "ghost" ? stop.state : "exists";
  if (!target && state !== "ghost") return null;
  return {
    target,
    path,
    state,
    ghostReason: treeWalkRailText(stop.ghostReason).trim(),
    groupLabel: treeWalkRailText(stop.groupLabel).trim(),
    landingLabel: treeWalkRailText(stop.landingLabel).trim() || target,
    shortLabel: treeWalkRailText(stop.shortLabel).trim() || treeWalkRailText(stop.landingLabel).trim() || target,
    wraps: stop.wraps === true,
    source: treeWalkRailText(stop.source).trim(),
  };
}

function treeWalkRailAuthoredSuffix(stop) {
  return stop && stop.source === "authored";
}

// "3 open projects" for projects, "3 notebooks" otherwise.
function treeWalkRailRingCount(kind, lane, size) {
  const plural = treeWalkRailPlural(kind);
  const laneWord = treeWalkRailLaneWord(kind, lane);
  return laneWord ? `${size} ${laneWord} ${plural}` : `${size} ${plural}`;
}

// Step tooltips spell out the key and the landing; wrapping stops name the
// landing and the ring edge. An authored stop adds the authored cue.
function treeWalkRailStepTooltip(direction, stop, { parentLabel, kind, lane, size }) {
  const landing = treeWalkRailText(stop.landingLabel).trim() || treeWalkRailText(stop.target).trim();
  const key = direction === "prev" ? "[n" : "]n";
  const word = direction === "prev" ? "prev" : "next";
  let tooltip = "";
  if (stop.wraps === true) {
    const edge = direction === "prev" ? "last" : "first";
    const ring = `${edge} of ${parentLabel}'s ${treeWalkRailRingCount(kind, lane, size)}`;
    const verb = direction === "prev" ? "wraps to" : "wraps to";
    tooltip = `${key} · ${verb} ${landing}, ${ring}`;
  } else {
    tooltip = `${key} · ${word}: ${landing}`;
  }
  if (treeWalkRailAuthoredSuffix(stop)) tooltip += " · Authored nav link";
  return tooltip;
}

function treeWalkRailStepItem(direction, stop, context) {
  const copied = treeWalkRailCopyStop(stop);
  if (!copied) return null;
  if (!treeWalkRailText(copied.target).trim() && copied.state !== "ghost") return null;
  const tooltip = treeWalkRailStepTooltip(direction, copied, context);
  const item = {
    label: copied.landingLabel || copied.target,
    shortLabel: copied.shortLabel || copied.landingLabel || copied.target,
    target: copied.target,
    path: copied.path,
    state: copied.state,
    ghostReason: copied.ghostReason,
    tooltip,
    ariaLabel: tooltip,
    wraps: copied.wraps,
  };
  if (copied.state !== "ghost" && copied.ghostReason) item.ghostReason = copied.ghostReason;
  if (treeWalkRailAuthoredSuffix(copied)) item.source = "authored";
  return item;
}

function treeWalkRailParentItem(parentStop) {
  const copied = treeWalkRailCopyStop(parentStop);
  if (!copied) return null;
  if (!treeWalkRailText(copied.target).trim()) return null;
  const landing = treeWalkRailText(copied.landingLabel).trim() || treeWalkRailText(copied.target).trim();
  const tooltip = `↑ · parent: ${landing}`;
  return {
    label: landing,
    shortLabel: copied.shortLabel || landing,
    target: copied.target,
    path: copied.path,
    state: copied.state || "exists",
    ghostReason: copied.ghostReason,
    tooltip,
    ariaLabel: tooltip,
    wraps: false,
  };
}

// "]N · next: goo's projects → alpha". Wrapping jumps add the wrap flag
// (the kit paints ↺); tooltips name the wrap like the calendar rail.
function treeWalkRailGroupArm(direction, stop, { kind }) {
  const copied = treeWalkRailCopyStop(stop);
  if (!copied) return null;
  if (!treeWalkRailText(copied.groupLabel).trim()) return null;
  if (!treeWalkRailText(copied.target).trim() && copied.state !== "ghost") return null;
  const key = direction === "prev" ? "[N" : "]N";
  const word = direction === "prev" ? "prev" : "next";
  const parentLabel = treeWalkRailText(copied.groupLabel).trim();
  const landing = treeWalkRailText(copied.landingLabel).trim() || treeWalkRailText(copied.target).trim();
  const plural = treeWalkRailPlural(kind);
  let tooltip = `${key} · ${word}: ${parentLabel}'s ${plural} → ${landing}`;
  let ariaLabel = `${direction === "prev" ? "Previous" : "Next"} parent group: ${parentLabel}, opens ${landing}`;
  if (copied.state === "ghost") {
    const reason = treeWalkRailText(copied.ghostReason).trim();
    if (reason) tooltip = reason;
    ariaLabel += ", not in vault";
  } else {
    if (copied.wraps === true) {
      tooltip += " · wraps around";
      ariaLabel += ", wraps around";
    }
  }
  if (treeWalkRailAuthoredSuffix(copied)) {
    tooltip += " · Authored nav link";
    ariaLabel += ", authored nav link";
  }
  const arm = {
    groupLabel: parentLabel,
    shortLabel: copied.shortLabel || parentLabel,
    landingLabel: landing,
    target: copied.target,
    path: copied.path,
    state: copied.state,
    ghostReason: copied.ghostReason,
    tooltip,
    ariaLabel,
    wraps: copied.wraps,
  };
  if (treeWalkRailAuthoredSuffix(copied)) arm.source = "authored";
  return arm;
}

// "PROJECT · bob · 2 of 3 open": kind, parent, position, lane for projects.
function treeWalkRailCenterText(kind, parentLabel, position, size, lane) {
  const upper = treeWalkRailText(kind).trim().toUpperCase() || "NOTE";
  const laneWord = treeWalkRailLaneWord(kind, lane);
  const tail = laneWord ? `${position} of ${size} ${laneWord}` : `${position} of ${size}`;
  return `${upper} · ${parentLabel} · ${tail}`;
}

function treeWalkRailCenter(providerGroup, kind, lane) {
  if (!providerGroup || typeof providerGroup !== "object") return null;
  const position = Number(providerGroup.position);
  const size = Number(providerGroup.size);
  if (!Number.isInteger(position) || !Number.isInteger(size) || size < 1 || position < 1 || position > size) return null;
  if (size <= 1) return null;
  const parentLabel = treeWalkRailText(providerGroup.label).trim() || "Top level";
  const text = treeWalkRailCenterText(kind, parentLabel, position, size, lane);
  const members = Array.isArray(providerGroup.members)
    ? providerGroup.members
      .filter((member) => member && typeof member === "object")
      .map((member) => ({
        label: treeWalkRailText(member.label).trim(),
        state: member.state === "current" ? "current" : "exists",
      }))
      .filter((member) => member.label)
    : null;
  return {
    text,
    shortText: `${position}/${size}`,
    ariaLabel: text,
    tooltip: text,
    position,
    size,
    members,
  };
}

function treeWalkRailSignatureOf(payload) {
  try {
    return JSON.stringify(payload);
  } catch (_) {
    return "";
  }
}

function treeWalkRailModel(input = {}) {
  try {
    const answer = input && typeof input === "object" ? input.answer : null;
    const provider = input && typeof input === "object" ? input.provider : null;
    if (!answer || answer.ok !== true) return null;
    if (!provider || provider.ok !== true || provider.route !== "tree") return null;
    const kind = treeWalkRailText(provider.kind).trim();
    if (kind !== "area" && kind !== "project" && kind !== "notebook" && kind !== "prose") return null;
    const lane = provider.lane == null ? null : treeWalkRailText(provider.lane).trim() || null;
    const group = provider.group && typeof provider.group === "object" ? provider.group : null;
    if (!group) return null;
    const ringSize = Number(group.size);
    const tourCount = Number(group.count);
    if (!Number.isInteger(ringSize) || !Number.isInteger(tourCount)) return null;
    if (ringSize <= 1 && tourCount <= 1) return null;
    const parentLabel = treeWalkRailText(group.label).trim() || "Top level";
    const context = { parentLabel, kind, lane, size: ringSize };

    let step = null;
    if (ringSize >= 2) {
      const effectivePrev = answer.prev || provider.step?.prev || null;
      const effectiveNext = answer.next || provider.step?.next || null;
      const prev = treeWalkRailStepItem("prev", effectivePrev, context);
      const next = treeWalkRailStepItem("next", effectiveNext, context);
      const parent = provider.step?.parent ? treeWalkRailParentItem(provider.step.parent) : null;
      if (prev || next || parent) {
        step = { prev, parent, next, children: [] };
        if (!prev && !next && !parent) step = null;
      }
      if (step && !step.prev && !step.next && !step.parent) step = null;
      // The step row appears only when the ring has at least 2 members;
      // a parent alone never keeps it.
      if (step && !step.prev && !step.next) step = null;
    }

    let railGroup = null;
    if (tourCount >= 2) {
      const effectivePrevGroup = answer.prevGroup || provider.prevGroup || null;
      const effectiveNextGroup = answer.nextGroup || provider.nextGroup || null;
      const prevArm = treeWalkRailGroupArm("prev", effectivePrevGroup, { kind });
      const nextArm = treeWalkRailGroupArm("next", effectiveNextGroup, { kind });
      const center = ringSize >= 2 ? treeWalkRailCenter(group, kind, lane) : null;
      if (prevArm || nextArm || center) {
        railGroup = {
          label: TREE_WALK_RAIL_GROUP_LABEL,
          prev: prevArm,
          next: nextArm,
          center,
        };
      }
    } else if (ringSize >= 2) {
      const center = treeWalkRailCenter(group, kind, lane);
      if (center) {
        railGroup = { label: TREE_WALK_RAIL_GROUP_LABEL, prev: null, next: null, center };
      }
    }

    if (!step && !railGroup) return null;
    const payload = {
      step,
      group: railGroup,
      label: TREE_WALK_RAIL_LABEL,
      kind,
      lane,
    };
    return {
      step: payload.step,
      group: payload.group,
      label: payload.label,
      kind: payload.kind,
      lane: payload.lane,
      signature: treeWalkRailSignatureOf(payload),
    };
  } catch (_) {
    return null;
  }
}
