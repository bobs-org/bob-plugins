// Tree-note link-walk answers for api.navGroups v1 (bob-cli-ra engine):
// stop and group shaping plus the reason/message table. Pure: no DOM,
// no app access, never throws, never writes, never spawns. Continues
// 296h-plugin-nav-groups-tree-model.js (same shared scope).

function navGroupsTreeLabelOf(nodes, path) {
  try {
    const node = navGroupsTreeLookup(nodes, path);
    if (node && typeof node.label === "string" && node.label) return node.label;
  } catch (_) {}
  return navGroupsTreeStem(path);
}

function navGroupsTreeParentLabel(nodes, node) {
  try {
    if (!node || node.parentStatus === "sentinel") return "Top level";
    if (node.parentStatus === "ok" && node.parentPath) return navGroupsTreeLabelOf(nodes, node.parentPath);
  } catch (_) {}
  return "Top level";
}

function navGroupsTreeStop({ path, groupLabel, landingLabel, wraps }) {
  return Object.freeze({
    path,
    target: navGroupsTarget(path),
    groupLabel,
    landingLabel,
    shortLabel: landingLabel,
    state: "exists",
    ghostReason: null,
    wraps: wraps === true,
    source: "tree",
  });
}

function navGroupsTreeNoParentMessage(stem) {
  return stem + " has no parent — Ctrl+Shift+- sets one";
}

function navGroupsTreeListParentMessage(stem) {
  return stem + "'s parent lists several notes — keep one";
}

function navGroupsTreeUnresolvedParentMessage(stem, target) {
  return stem + "'s parent " + target + " is not in the vault";
}

function navGroupsTreeLoopMessage(stem) {
  return stem + "'s parent chain loops back to " + stem;
}

function navGroupsTreeLaneWord(kind, lane) {
  if (kind === "project") return (lane === "closed" ? "closed" : "open") + " ";
  return "";
}

function navGroupsTreeOnlyChildMessage({ stem, parentLabel, kind, lane, nextParentLabel }) {
  const singular = NAV_GROUPS_TREE_SINGULAR[kind] || kind;
  let message = stem + " is " + parentLabel + "'s only " + navGroupsTreeLaneWord(kind, lane) + singular;
  if (nextParentLabel) message += " — ]N visits " + nextParentLabel + "'s";
  return message;
}

function navGroupsTreeSingleGroupMessage({ parentLabel, kind, lane }) {
  const singular = NAV_GROUPS_TREE_SINGULAR[kind] || kind;
  return parentLabel + " holds every " + navGroupsTreeLaneWord(kind, lane) + singular + " — ]n walks them";
}

function navGroupsTreeProblemMessage(node, parentLabel) {
  try {
    const stem = node && typeof node.stem === "string" ? node.stem : "";
    const status = node && typeof node.parentStatus === "string" ? node.parentStatus : "missing";
    if (status === "list") return navGroupsTreeListParentMessage(stem);
    if (status === "unresolved") {
      return navGroupsTreeUnresolvedParentMessage(stem, (node && node.parentTarget) || "");
    }
    if (status === "self" || status === "cycle") return navGroupsTreeLoopMessage(stem);
    return navGroupsTreeNoParentMessage(stem);
  } catch (_) {
    return "Link walk is unavailable";
  }
}

// Shape the full api.navGroups v1 tree answer for one member note, or
// null when the path is not a walk member. Members with a malformed
// parent get explicit stepNone + none reasons and no ring or tour.
function navGroupsTreeAnswerFor(tables, path) {
  try {
    const nodes = tables && tables.nodes ? tables.nodes : null;
    const rings = tables && tables.rings ? tables.rings : null;
    const tours = tables && tables.tours ? tables.tours : null;
    if (!nodes) return null;
    const normalized = navGroupsNormalizePath(path);
    const node = navGroupsTreeLookup(nodes, normalized);
    if (!node || !navGroupsTreeIsKind(node.kind)) return null;
    const kind = node.kind;
    const lane = kind === "project" ? node.lane || "open" : null;
    const problem = node.parentReason ? node.parentReason : null;
    const parentLabel = navGroupsTreeParentLabel(nodes, node);
    if (problem) {
      const message = navGroupsTreeProblemMessage(node, parentLabel);
      const tagged = Object.freeze({ reason: problem, message });
      return navGroupsOk({
        route: "tree",
        kind,
        lane,
        step: navGroupsStep(null, null, null),
        stepNone: tagged,
        group: null,
        prevGroup: null,
        nextGroup: null,
        none: tagged,
      });
    }
    const sentinel = node.parentStatus === "sentinel";
    const parentPath = node.parentPath ? node.parentPath : "";
    const ring = (rings && rings.get(navGroupsTreeRingKey(kind, lane, parentPath))) || [node];
    const position = Math.max(1, ring.findIndex((member) => member && member.path === node.path) + 1);
    const size = ring.length;
    const universe = navGroupsTreeUniverseKey(kind, lane);
    const tour = (tours && tours.get(universe)) || [];
    const tourIndex = Math.max(0, tour.findIndex((entry) => entry && entry.parentPath === parentPath));
    const count = tour.length;
    const singleGroup = count <= 1;

    let prev = null;
    let next = null;
    if (size > 1) {
      const prevMember = ring[(position - 2 + size) % size];
      const nextMember = ring[position % size];
      prev = navGroupsTreeStop({
        path: prevMember.path,
        groupLabel: parentLabel,
        landingLabel: prevMember.label,
        wraps: position === 1,
      });
      next = navGroupsTreeStop({
        path: nextMember.path,
        groupLabel: parentLabel,
        landingLabel: nextMember.label,
        wraps: position === size,
      });
    }
    let parentStop = null;
    if (!sentinel && parentPath) {
      const parentNode = navGroupsTreeLookup(nodes, parentPath);
      let grandLabel = navGroupsTreeLabelOf(nodes, parentPath);
      try {
        if (parentNode) {
          if (parentNode.parentStatus === "sentinel") grandLabel = "Top level";
          else if (parentNode.parentStatus === "ok" && parentNode.parentPath) {
            grandLabel = navGroupsTreeLabelOf(nodes, parentNode.parentPath);
          } else grandLabel = parentNode.label || grandLabel;
        }
      } catch (_) {}
      parentStop = navGroupsTreeStop({
        path: parentPath,
        groupLabel: grandLabel,
        landingLabel: navGroupsTreeLabelOf(nodes, parentPath),
        wraps: false,
      });
    }
    const stepNone = size > 1 ? null : Object.freeze({
      reason: "only-child",
      message: navGroupsTreeOnlyChildMessage({
        stem: node.stem,
        parentLabel,
        kind,
        lane,
        nextParentLabel: singleGroup
          ? ""
          : navGroupsTreeParentLabelFromPath(nodes, tour[(tourIndex + 1) % count].parentPath),
      }),
    });
    let prevGroup = null;
    let nextGroup = null;
    if (!singleGroup) {
      const prevEntry = tour[(tourIndex - 1 + count) % count];
      const nextEntry = tour[(tourIndex + 1) % count];
      const prevFirst = prevEntry.ring[0];
      const nextFirst = nextEntry.ring[0];
      const prevLabel = navGroupsTreeParentLabelFromPath(nodes, prevEntry.parentPath);
      const nextLabel = navGroupsTreeParentLabelFromPath(nodes, nextEntry.parentPath);
      prevGroup = navGroupsTreeStop({
        path: prevFirst.path,
        groupLabel: prevLabel,
        landingLabel: prevFirst.label,
        wraps: tourIndex === 0,
      });
      nextGroup = navGroupsTreeStop({
        path: nextFirst.path,
        groupLabel: nextLabel,
        landingLabel: nextFirst.label,
        wraps: tourIndex === count - 1,
      });
    }
    const members = Object.freeze(ring.map((member) => Object.freeze({
      label: member.label,
      path: member.path,
      state: member.path === node.path ? "current" : "exists",
    })));
    const group = Object.freeze({
      noun: "parent",
      memberNoun: kind,
      label: parentLabel,
      shortLabel: parentLabel,
      parentPath,
      position,
      size,
      index: tourIndex + 1,
      count: Math.max(count, 1),
      members,
      atStart: position === 1,
      atEnd: size > 0 && position === size,
      enteringNext: null,
      enteringPrev: null,
    });
    return navGroupsOk({
      route: "tree",
      kind,
      lane,
      step: navGroupsStep(prev, next, parentStop),
      stepNone,
      group,
      prevGroup,
      nextGroup,
      none: singleGroup
        ? Object.freeze({
          reason: "single-group",
          message: navGroupsTreeSingleGroupMessage({ parentLabel, kind, lane }),
        })
        : null,
    });
  } catch (_) {
    return null;
  }
}

function navGroupsTreeParentLabelFromPath(nodes, parentPath) {
  try {
    if (navGroupsTreeIsSentinelPath(parentPath)) return "Top level";
    return navGroupsTreeLabelOf(nodes, parentPath);
  } catch (_) {
    return "Top level";
  }
}
