// Record walk group rail (bob-cli-oj record-rail): a grouped record walk
// shows the kit's group row under its step row, in place of the whole-walk
// thumb track: `« 🛑 Why SASE… · AI Slop   🔮 Future Work · 2 of 3 ▮■▮
// 🏁 Conclusion · … » ↺`. One answer decides the arms: Bob Navigation
// Hotkeys' walkMode.links v7 when it is there (so an authored «/» link wins
// per role, exactly as for `[N` / `]N`), else Ledger's own navGroups resolver
// (derived stops only). Record targets are never created: a missing group
// head is a ghost that only explains itself. Ungrouped, single-group,
// syncing, and grouping-unavailable walks keep today's rail.

const RECORD_WALK_GROUP_WALK_MODE_VERSION = 7;
const RECORD_WALK_GROUP_STOP_STATES = Object.freeze(["exists", "creatable", "ghost"]);
const RECORD_WALK_GROUP_MEMBER_STATES = Object.freeze(["current", "exists", "missing"]);
const RECORD_WALK_GROUP_CHANGED_NOTICE = "The group stop changed — try again";

function recordWalkGroupText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function recordWalkGroupCapitalize(value) {
  const text = recordWalkGroupText(value);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

// Only a healthy walk over at least two occupied groups asks for an answer,
// so ungrouped albums never pay for the resolver.
function recordWalkGroupEligible(walk) {
  return Boolean(walk && walk.state === "ok" && walk.walkBy && walk.group
    && Number.isInteger(walk.group.count) && walk.group.count >= 2);
}

// The walk_by field's label from bob's album report (`Section`), else the
// key with a capital first letter.
function recordWalkGroupFieldLabel(report, albumPath, key) {
  const field = recordWalkGroupText(key);
  if (!field) return "";
  try {
    const album = recordWalkReportAlbum(report, recordWalkPath(albumPath));
    const match = (Array.isArray(album?.fields) ? album.fields : [])
      .find((candidate) => candidate && candidate.key === field);
    const label = recordWalkGroupText(match?.label);
    if (label) return label;
  } catch (_) {}
  return recordWalkGroupCapitalize(recordWalkHumanizeStem(field) || field);
}

// One group stop as plain data. Derived record stops read `group · head
// title`; an authored «/» stop has no head, so its landing is the target's
// note name. Null when there is nothing to label or (outside ghosts) to open.
function recordWalkGroupStop(stop) {
  if (!stop || typeof stop !== "object") return null;
  const state = RECORD_WALK_GROUP_STOP_STATES.includes(stop.state)
    ? stop.state : (stop.exists === true ? "exists" : "ghost");
  const target = recordWalkGroupText(stop.target);
  const path = recordWalkGroupText(stop.path);
  const source = recordWalkGroupText(stop.source) || "record";
  const authored = source === "authored";
  let landing = authored ? recordWalkStem(path || target) : recordWalkGroupText(stop.landingLabel);
  const groupLabel = recordWalkGroupText(stop.groupLabel)
    || (authored ? "" : recordWalkGroupText(stop.shortLabel)) || landing;
  if (!groupLabel || (!target && state !== "ghost")) return null;
  if (landing.toLocaleLowerCase() === groupLabel.toLocaleLowerCase()) landing = "";
  return {
    path,
    target,
    groupLabel,
    landingLabel: landing,
    shortLabel: (authored ? "" : recordWalkGroupText(stop.shortLabel)) || groupLabel,
    state,
    ghostReason: recordWalkGroupText(stop.ghostReason),
    wraps: stop.wraps === true,
    source,
  };
}

function recordWalkGroupCurrent(group) {
  if (!group || typeof group !== "object") return null;
  const position = Number(group.position);
  const size = Number(group.size);
  if (!Number.isInteger(position) || !Number.isInteger(size) || position < 1 || position > size) return null;
  const index = Number(group.index);
  const count = Number(group.count);
  return {
    label: recordWalkGroupText(group.label),
    position,
    size,
    index: Number.isInteger(index) ? index : null,
    count: Number.isInteger(count) ? count : null,
    members: Array.isArray(group.members)
      ? group.members.map((member) => ({
        label: recordWalkGroupText(member?.label),
        path: recordWalkPath(member?.path),
        state: RECORD_WALK_GROUP_MEMBER_STATES.includes(member?.state) ? member.state : "exists",
      }))
      : null,
  };
}

// Plain group-row inputs from one resolver answer, or null when the rail
// keeps its thumb track. A conflicted role simply has no stop.
function recordWalkGroupRailFrom(answer, walk, options = {}) {
  if (!recordWalkGroupEligible(walk) || !answer || answer.ok !== true) return null;
  const group = recordWalkGroupCurrent(answer.group);
  const prev = recordWalkGroupStop(answer.prevGroup);
  const next = recordWalkGroupStop(answer.nextGroup);
  const grouped = Boolean(group && Number.isInteger(group.count) && group.count >= 2);
  if (!grouped && !prev && !next) return null;
  const fieldLabel = recordWalkGroupText(options.fieldLabel)
    || recordWalkGroupCapitalize(walk.group.field || walk.walkBy);
  return {
    source: options.source === "navGroups" ? "navGroups" : "walkMode",
    field: String(walk.group.field || walk.walkBy),
    fieldLabel,
    unit: fieldLabel.toLocaleLowerCase(),
    group,
    prev,
    next,
  };
}

// Scalars only, so identical rebuilds keep the card and slot signatures.
function recordWalkGroupRailSignature(rail) {
  if (!rail || typeof rail !== "object") return null;
  const stop = (value) => value
    ? [value.target, value.path, value.state, value.wraps === true, value.groupLabel, value.landingLabel, value.ghostReason]
    : null;
  const group = rail.group;
  return JSON.stringify([
    rail.source || "",
    rail.fieldLabel || "",
    group ? [group.label, group.index, group.count, group.position, group.size,
      group.members ? group.members.map((member) => [member.label, member.state]) : null] : null,
    stop(rail.prev),
    stop(rail.next),
  ]);
}

// The kit arm: tooltip names the key and destination; the accessible name
// spells the role and state.
function recordWalkGroupArmSpec(rail, direction) {
  const stop = rail && rail[direction];
  if (!stop) return null;
  const previous = direction === "prev";
  const key = previous ? "[N" : "]N";
  const side = previous ? "Previous" : "Next";
  const unit = rail.unit || "group";
  const landing = stop.landingLabel;
  const wraps = stop.wraps === true;
  const wrapTip = wraps ? " · wraps around" : "";
  let tooltip;
  let ariaLabel;
  if (stop.state === "ghost") {
    tooltip = `${stop.ghostReason || `${landing || stop.groupLabel} is not in the vault`}${wrapTip}`;
    ariaLabel = `${side} ${unit} group: ${stop.groupLabel}, not in vault`;
  } else if (stop.state === "creatable") {
    tooltip = `${landing || stop.groupLabel} isn't created yet — ${key} creates it${wrapTip}`;
    ariaLabel = `${side} ${unit} group: ${stop.groupLabel}, not created yet — activating creates it`;
  } else {
    tooltip = `${key} · ${previous ? "previous" : "next"} ${unit}: ${stop.groupLabel}${landing ? ` → ${landing}` : ""}${wrapTip}`;
    ariaLabel = `${side} ${unit} group: ${stop.groupLabel}${landing ? `, opens ${landing}` : ""}`;
  }
  if (wraps) ariaLabel += ", wraps around";
  return { ...stop, tooltip, ariaLabel };
}

// propertyCardBuildGroupRow spec for a walk's groupRail.
function recordWalkGroupRowSpec(rail, onActivate) {
  if (!rail || typeof rail !== "object") return null;
  const group = rail.group;
  const unit = rail.unit || "group";
  const center = group ? {
    name: group.label,
    text: `${group.position} of ${group.size}`,
    shortText: `${group.position}/${group.size}`,
    ariaLabel: `${group.position} of ${group.size} in this ${unit}`,
    tooltip: Number.isInteger(group.index) && Number.isInteger(group.count)
      ? `${rail.fieldLabel} ${group.index} of ${group.count}: ${group.label}` : group.label,
    position: group.position,
    size: group.size,
    members: group.members ? group.members.map((member) => ({ label: member.label, state: member.state })) : null,
  } : null;
  return {
    label: `${rail.fieldLabel || "Record"} groups`,
    prev: recordWalkGroupArmSpec(rail, "prev"),
    next: recordWalkGroupArmSpec(rail, "next"),
    center,
    onActivate,
  };
}

// The rail's group row element, or null (the rail then keeps its track).
// Arms keep focus across rebuilds and page previews like the step arms.
function recordWalkGroupRowEl(walk, options, doc) {
  if (!walk || !walk.groupRail || typeof propertyCardBuildGroupRow !== "function") return null;
  const spec = recordWalkGroupRowSpec(walk.groupRail, (direction, arm, event) => {
    try { event?.stopPropagation?.(); } catch (_) {}
    options?.handlers?.groupOpen?.(direction, arm, event);
  });
  const built = spec ? propertyCardBuildGroupRow(doc, spec) : null;
  if (!built || !built.element) return null;
  built.element.classList?.add?.("bob-record-walk-group-row");
  for (const direction of ["prev", "next"]) {
    const arm = built.arms?.[direction];
    if (!arm) continue;
    arm.setAttribute("data-record-sheet-focus", `walk-group-${direction}`);
    if (spec[direction]?.state !== "ghost") recordSheetBindHover(arm, options, spec[direction].target);
  }
  return built.element;
}

function recordWalkGroupModified(event) {
  return Boolean(event && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button === 1));
}

class BobLedgerToolsRecordWalkGroupRailMixin {
  recordWalkGroupWalkMode() {
    try {
      const api = typeof this.dependencyNavApi === "function" ? this.dependencyNavApi() : null;
      const walkMode = api && api.walkMode;
      if (walkMode && Number(walkMode.version) >= RECORD_WALK_GROUP_WALK_MODE_VERSION
        && typeof walkMode.links === "function") return walkMode;
    } catch (_) {}
    return null;
  }

  // { answer, source } from walkMode.links v7, else navGroups; null when
  // neither answers. Synchronous and read-only either way.
  recordWalkGroupAnswer(path, sourceText) {
    if (!path || typeof sourceText !== "string") return null;
    try {
      const walkMode = this.recordWalkGroupWalkMode();
      if (walkMode) {
        const answer = walkMode.links({ path, content: sourceText });
        return answer && answer.ok === true ? { answer, source: "walkMode" } : null;
      }
      if (typeof this.navGroupsResolve === "function") {
        const answer = this.navGroupsResolve({ path, content: sourceText });
        return answer && answer.ok === true ? { answer, source: "navGroups" } : null;
      }
    } catch (_) {}
    return null;
  }

  recordWalkGroupRail(path, sourceText, walk) {
    try {
      if (!recordWalkGroupEligible(walk)) return null;
      const resolved = this.recordWalkGroupAnswer(recordWalkPath(walk.path || path), sourceText);
      if (!resolved) return null;
      const report = this.recordSheetState?.()?.report || null;
      const fieldLabel = recordWalkGroupFieldLabel(report, walk.albumPath, walk.group.field || walk.walkBy);
      return recordWalkGroupRailFrom(resolved.answer, walk, { fieldLabel, source: resolved.source });
    } catch (_) {
      return null;
    }
  }

  recordWalkAttachGroupRail(path, sourceText, walk) {
    if (walk && typeof walk === "object") walk.groupRail = this.recordWalkGroupRail(path, sourceText, walk);
    return walk;
  }

  // The pane's current text: its editor, else its view data, else the vault.
  async recordWalkGroupSourceText(sourcePath) {
    const target = recordWalkPath(sourcePath);
    try {
      const view = this.recordSheetMarkdownLeaf(sourcePath)?.view;
      if (view && recordWalkPath(view.file?.path) === target) {
        const editorText = view.editor?.getValue?.();
        if (typeof editorText === "string") return editorText;
        const viewData = view.getViewData?.();
        if (typeof viewData === "string") return viewData;
      }
    } catch (_) {}
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(target);
      if (file && typeof this.app.vault.cachedRead === "function") {
        const text = await this.app.vault.cachedRead(file);
        if (typeof text === "string") return text;
      }
    } catch (_) {}
    const cached = this.recordSheetSourceCache?.get?.(target);
    return typeof cached === "string" ? cached : null;
  }

  // A plain click re-asks the resolver and runs `[N` / `]N` in the card's own
  // pane; a modified click on an existing head opens it like a Markdown link;
  // a ghost only explains itself (and may ask bob to repair the walk).
  async recordWalkGroupOpen(direction, arm, sourcePath, event) {
    try {
      if ((direction !== "prev" && direction !== "next") || !arm) return false;
      const state = RECORD_WALK_GROUP_STOP_STATES.includes(arm.state) ? arm.state : "exists";
      if (state === "ghost") {
        new Notice(arm.ghostReason || "That record is not in the vault — record navigation never creates it");
        const capabilities = this.recordSheetState?.()?.report?.capabilities;
        if (Array.isArray(capabilities) && capabilities.includes(RECORD_WALK_CAPABILITY)) {
          this.albumScheduleSync?.("record-walk-missing-target");
        }
        return false;
      }
      if (state === "exists" && recordWalkGroupModified(event)) {
        return await this.recordWalkOpen(arm.target, null, sourcePath, event);
      }
      const text = await this.recordWalkGroupSourceText(sourcePath);
      const resolved = this.recordWalkGroupAnswer(sourcePath, text);
      const latest = resolved ? recordWalkGroupStop(resolved.answer[`${direction}Group`]) : null;
      if (!latest || latest.target !== arm.target || latest.path !== arm.path || latest.state !== state) {
        this.scheduleRecordSheetRefresh?.();
        new Notice(RECORD_WALK_GROUP_CHANGED_NOTICE);
        return false;
      }
      if (resolved.source === "walkMode") {
        const commandId = `bob-navigation-hotkeys:open-${direction}-group-link`;
        const commands = this.app?.commands;
        const command = commands?.commands?.[commandId] || commands?.findCommand?.(commandId);
        const leaf = this.recordSheetMarkdownLeaf(sourcePath);
        // A click in an inactive pane must run the command against that pane.
        if (command && typeof commands.executeCommandById === "function"
          && recordWalkPath(leaf?.view?.file?.path) === recordWalkPath(sourcePath)) {
          this.app.workspace.setActiveLeaf?.(leaf, { focus: true });
          commands.executeCommandById(commandId);
          return true;
        }
      }
      if (state === "creatable") {
        new Notice(`${latest.landingLabel || latest.groupLabel} isn't created yet — Bob Navigation Hotkeys creates it with ]N`);
        return false;
      }
      return await this.recordWalkOpen(latest.target, null, sourcePath, event);
    } catch (_) {
      return false;
    }
  }
}
