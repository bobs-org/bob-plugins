// Derived record group stops from the same cached report and cross-checked
// record-walk model used by the card. Record targets are never created.
function navGroupsRecordStop(stop, plugin) {
  const head = stop && stop.head;
  const path = recordWalkPath(head && head.path);
  if (!path) return null;
  const exists = plugin.navGroupsVaultHas(path);
  return Object.freeze({
    path,
    target: navGroupsTarget(path),
    groupLabel: stop.label,
    landingLabel: head.title,
    shortLabel: stop.label,
    state: exists ? "exists" : "ghost",
    ghostReason: exists ? null : `${head.title || recordWalkStem(path)} is not in the vault — record navigation never creates it`,
    wraps: stop.wraps === true,
    source: "record",
  });
}

function navGroupsRecordNone(reason, message) {
  return Object.freeze({ reason, message });
}

function navGroupsRecordResolve(plugin, request) {
  if (typeof recordWalkModel !== "function") return null;
  const reportState = typeof plugin.albumReportState === "function"
    ? plugin.albumReportState() : null;
  const model = recordWalkModel({
    path: request.path,
    sourceText: typeof request.content === "string" ? request.content : null,
    report: reportState && reportState.report,
    metadataCache: plugin.app && plugin.app.metadataCache,
    vault: plugin.app && plugin.app.vault,
  });
  if (!model) return null;

  const album = model.album || {};
  const title = String(album.title || recordWalkStem(model.albumPath) || "Album");
  if (model.reason === "grouping_unavailable") {
    return navGroupsOk({
      route: "record",
      kind: "record",
      none: navGroupsRecordNone("grouping_unavailable", "Record groups need Bob with grouped-walk support"),
    });
  }
  if (model.state === "syncing") {
    return navGroupsOk({
      route: "record",
      kind: "record",
      none: navGroupsRecordNone("syncing", "Record walk is syncing"),
    });
  }
  if (!model.walkBy || !model.group) {
    return navGroupsOk({
      route: "record",
      kind: "record",
      none: navGroupsRecordNone("ungrouped", `${title} walks by title — set walk_by on the album to group it`),
    });
  }
  if (model.group.count < 2) {
    return navGroupsOk({
      route: "record",
      kind: "record",
      none: navGroupsRecordNone("single-group", `${title} has one ${model.group.field} group — ]n walks it`),
    });
  }

  const currentMembers = (Array.isArray(model.groupMembers) ? model.groupMembers : []).map((member) => {
    const path = recordWalkPath(member.path);
    const state = path === model.path
      ? "current"
      : plugin.navGroupsVaultHas(path) ? "exists" : "missing";
    return Object.freeze({ label: member.title, path, state });
  });
  const group = navGroupsGroup({
    noun: model.group.field,
    label: model.group.label,
    shortLabel: model.group.label,
    position: model.group.position,
    size: model.group.size,
    index: model.group.index,
    count: model.group.count,
    members: Object.freeze(currentMembers),
    atStart: model.group.position === 1,
    atEnd: model.group.position === model.group.size,
    enteringNext: model.nextGroup && model.nextGroup.label,
    enteringPrev: model.prevGroup && model.prevGroup.label,
  });
  return navGroupsOk({
    route: "record",
    kind: "record",
    group,
    prevGroup: navGroupsRecordStop(model.prevGroup, plugin),
    nextGroup: navGroupsRecordStop(model.nextGroup, plugin),
  });
}
