// Project-resident verdict + destination + picker API (moved from 085b to keep
// 085b under the 1000-line cap; shared scope).

function decideProjectResidentVerdict(task, project, unblocking, ctx = {}) {
  const openIdsAfter = ctx.openIdsAfter instanceof Set ? ctx.openIdsAfter : new Set();
  const today = typeof ctx.today === "string" ? ctx.today : formatLocalDate();
  const hasLiveLinkBefore = typeof ctx.hasLiveLinkBefore === "function" ? ctx.hasLiveLinkBefore : () => false;
  const cancelledClose = ctx.cancelledClose === true;
  const linkUnblocked = ctx.linkUnblocked !== false;
  const anchorOf = typeof ctx.anchorOf === "function" ? ctx.anchorOf : () => ({ kind: "none", entryLine: null, bulletLine: null });
  const dailyBefore = ctx.dailyBefore || [];
  const projectPredecessors = unblocking.map((identity) => ({
    note_path: String(identity.path || ""),
    block_id: String(identity.blockId || ""),
    text: String(identity.text || ""),
  }));
  const ownOpen = (task.dependsOn || []).filter((id) => openIdsAfter.has(String(id)));
  let ownFuture = null;
  try {
    ownFuture = task.rawLine ? findSingleFutureScheduledField(task.rawLine, today) : null;
  } catch (error) {
    ownFuture = null;
  }
  if (ownOpen.length > 0 || ownFuture) {
    return {
      kind: "stillBlocked",
      row: {
        note_path: task.path,
        block_id: task.blockId || "",
        line: task.line,
        text: successorDisplayText(task),
        status_symbol: task.status,
        reason: ownFuture && ownOpen.length === 0 ? "scheduled" : "waits_on",
        waits_on: ownOpen.length,
        scheduled: ownFuture ? ownFuture.value : null,
        project: String(task.path || ""),
        mutedProject: true,
        trigger: "dependency",
      },
    };
  }
  if (task.hidden === true || (task.rawLine && successorHasHideTag(task.rawLine))) {
    return { kind: "recover", reason: "hidden", predecessorRows: projectPredecessors, foldedProject: String(task.path || "") };
  }
  if (hasLiveLinkBefore(task)) {
    return { kind: "recover", reason: "already_planned", predecessorRows: projectPredecessors, foldedProject: String(task.path || "") };
  }
  if (cancelledClose || linkUnblocked === false) {
    return { kind: "recover", reason: cancelledClose ? "cancelled" : "disabled", predecessorRows: projectPredecessors };
  }
  const predAnchors = unblocking.map((identity) => ({ identity, anchor: anchorOf(identity) }))
    .filter((entry) => entry.anchor.kind !== "none")
    .sort((l, r) => successorAnchorPosition(l.anchor) - successorAnchorPosition(r.anchor) ||
      (l.anchor.bulletLine ?? -1) - (r.anchor.bulletLine ?? -1));
  if (predAnchors.length > 0) {
    return {
      kind: "offer",
      anchor: predAnchors[0].anchor,
      predecessorRows: projectPredecessors,
      group: "project",
      project: String(task.path || ""),
    };
  }
  const implicitResident = resolveSuccessorImplicitDestination(dailyBefore);
  if (!implicitResident) {
    return { kind: "recover", reason: "no_destination", predecessorRows: projectPredecessors };
  }
  return {
    kind: "offer",
    anchor: { kind: "implicit", entryLine: implicitResident.entryLine, bulletLine: null },
    implicit: implicitResident,
    predecessorRows: projectPredecessors,
    group: "project",
    project: String(task.path || ""),
  };
}

// Destination object for an offer (§12.5): { day_file, entry_name,
// entry_role, fallback }. entry_role is slot|closing|implicit|created;
// fallback true when the implicit path was used because no §12.3 anchor
// existed. `anchor` is the offer's anchor; `implicit` is the resolved
// implicit entry when anchor.kind === "implicit".
function successorOfferDestination(anchor, implicit, dailyLines, dailyPath) {
  const dayFile = String(dailyPath || "");
  try {
    if (anchor && anchor.kind === "implicit" && implicit) {
      const name = typeof implicit.name === "string" ? implicit.name : successorEntryNameAt(successorNormalizeLines(dailyLines), implicit.entryLine);
      return { day_file: dayFile, entry_name: String(name || ""), entry_role: "implicit", fallback: true };
    }
    if (anchor && anchor.kind === "closing") {
      const name = successorEntryNameAt(successorNormalizeLines(dailyLines), anchor.entryLine);
      return { day_file: dayFile, entry_name: String(name || ""), entry_role: "closing", fallback: false };
    }
    if (anchor && anchor.entryLine != null) {
      const name = successorEntryNameAt(successorNormalizeLines(dailyLines), anchor.entryLine);
      const role = anchor.kind === "inherit" ? "slot" : "slot";
      return { day_file: dayFile, entry_name: String(name || ""), entry_role: role, fallback: false };
    }
  } catch (error) {
    // Fall through.
  }
  return { day_file: dayFile, entry_name: "", entry_role: "implicit", fallback: true };
}

// Defensive feature detection for nav api.successors v1 (§12.13).
function getSuccessorPickerApi(app) {
  try {
    const plugins = (app && app.plugins && app.plugins.plugins) || {};
    const nav = plugins["bob-navigation-hotkeys"];
    const api = nav && nav.api;
    const successors = api && api.successors;
    if (!successors || !(Number(successors.version) >= 1)) {
      return null;
    }
    if (typeof successors.pick !== "function") {
      return null;
    }
    return successors;
  } catch (error) {
    return null;
  }
}
