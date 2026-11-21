// Day and period card group rail (bob-cli-oj group-rail): one nav answer per
// card from Bob Navigation Hotkeys' walkMode.links v7 (else this plugin's
// api.navGroups), reduced to plain data on the model as `navRail`. The card
// shows the kit group row (`« Q3 · W27   week 8 of 14   2027-Q1 · W01 »`)
// on day, week, and quarter cards, a derived step row on notes with no
// recognized nav line, and the shared exists / creatable / ghost states on
// every rail item, chip, and arm. Group arms re-validate the stop and then
// run Navigation Hotkeys' group commands in the card's own pane.

const INTENTION_CARD_WALK_MODE_VERSION = 7;
// The group a card's group arms jump between, by card kind. Years and
// all_time have no group row.
const INTENTION_CARD_GROUP_UNITS = Object.freeze({ day: "week", week: "quarter", quarter: "year" });
const INTENTION_CARD_GROUP_CHANGED = "The group stop changed — try again";
const INTENTION_CARD_NOT_IN_VAULT = "Note is not in the vault";
const INTENTION_CARD_ALL_TIME_GHOST = "All time is not in the vault — navigation never creates it";
const INTENTION_CARD_TARGET_STATES = Object.freeze(["exists", "creatable", "ghost"]);

function intentionCardNavText(value) {
  return value === null || value === undefined ? "" : String(value);
}

// Plain copy of a resolver stop (walkMode or navGroups), or null.
function intentionCardNavStop(stop) {
  if (!stop || typeof stop !== "object") return null;
  const target = intentionCardNavText(stop.target).trim();
  const state = INTENTION_CARD_TARGET_STATES.includes(stop.state)
    ? stop.state
    : (stop.exists === true ? "exists" : "ghost");
  if (!target && state !== "ghost") return null;
  const landingLabel = intentionCardNavText(stop.landingLabel).trim() || intentionCardNavText(stop.text).trim();
  const groupLabel = intentionCardNavText(stop.groupLabel).trim() || landingLabel || target;
  return {
    target,
    path: intentionCardNavText(stop.path).trim() || null,
    state,
    ghostReason: intentionCardNavText(stop.ghostReason).trim(),
    groupLabel,
    landingLabel,
    shortLabel: intentionCardNavText(stop.shortLabel).trim() || groupLabel,
    wraps: stop.wraps === true,
    source: intentionCardNavText(stop.source).trim() || "authored",
  };
}

function intentionCardNavGroup(group) {
  if (!group || typeof group !== "object") return null;
  const position = Number(group.position);
  const size = Number(group.size);
  if (!Number.isInteger(position) || !Number.isInteger(size) || size < 1 || position < 1 || position > size) return null;
  const members = Array.isArray(group.members)
    ? group.members.filter((member) => member && typeof member === "object").map((member) => ({
      label: intentionCardNavText(member.label),
      state: ["current", "exists", "missing"].includes(member.state) ? member.state : "exists",
    }))
    : null;
  return {
    noun: intentionCardNavText(group.noun).trim(),
    label: intentionCardNavText(group.label).trim(),
    position, size, members,
  };
}

// The calendar note a target lands on ("2027-W01", "Mon Nov 23"), as the
// tooltips and accessible names spell it.
function intentionCardNavLandingName(stop) {
  const path = intentionCardNavText(stop?.path || stop?.target).replace(/\.md$/i, "");
  const subject = path && typeof intentionCardSubjectForPath === "function"
    ? intentionCardSubjectForPath(`${path}.md`, "") : null;
  if (subject?.kind === "day") {
    return typeof navGroupsDayLandingLabel === "function" ? navGroupsDayLandingLabel(subject.id) || subject.id : subject.id;
  }
  if (subject?.id) return subject.id;
  return intentionCardNavText(stop?.landingLabel).trim() || path.split("/").pop() || "";
}

// "daily", "period", or "" for the path a creatable target would create.
function intentionCardNavCreateKind(path) {
  const value = intentionCardNavText(path).replace(/\.md$/i, "");
  const subject = value && typeof intentionCardSubjectForPath === "function"
    ? intentionCardSubjectForPath(`${value}.md`, "") : null;
  if (subject?.kind === "day") return "daily";
  return subject ? "period" : "";
}

// True when the body holds a step-labelled link (`prev`, `next`, `‹ X`,
// `X ›`) anywhere: `[n` / `]n` follow it, so no derived row may stand in.
function intentionCardHasAuthoredStepLink(source) {
  const text = intentionCardNavText(source);
  const labels = [];
  for (const match of text.matchAll(/\[\[[^\]|]*\|([^\]]+)\]\]/g)) labels.push(match[1]);
  for (const match of text.matchAll(/(?<!!)\[([^\]]+)\]\([^)]*\)/g)) labels.push(match[1]);
  return labels.some((raw) => {
    const label = raw.trim();
    return /^(?:prev|next)$/i.test(label) || /^(?:‹|<(?!<))/.test(label) || /(?:›|(?<!>)>)$/.test(label) || /^›/.test(label);
  });
}

// Plain data for the card or null: { from, kind, unit, group, prevGroup,
// nextGroup, conflicts, step }. The group row needs a day, week, or quarter
// card and a group or group stop; a conflicted role has no arm. The derived
// step row (`step`) stands in only when the card has no written rail and
// every present step stop is derived from the calendar.
function intentionCardNavRailModel(answer, options = {}) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    const subject = opts.subject;
    if (!answer || answer.ok !== true || !subject) return null;
    const from = opts.from === "walkMode" ? "walkMode" : "navGroups";
    const kind = intentionCardNavText(subject.kind);
    const unit = INTENTION_CARD_GROUP_UNITS[kind] || "";
    const rawConflicts = Array.isArray(answer.groupConflicts)
      ? answer.groupConflicts
      : (answer.groupConflict ? [answer.groupConflict] : []);
    const conflicts = rawConflicts.filter((role) => role === "prev" || role === "next");
    const prevGroup = unit && !conflicts.includes("prev") ? intentionCardNavStop(answer.prevGroup) : null;
    const nextGroup = unit && !conflicts.includes("next") ? intentionCardNavStop(answer.nextGroup) : null;
    const group = unit ? intentionCardNavGroup(answer.group) : null;
    const grouped = Boolean(unit && (group || prevGroup || nextGroup));
    let step = null;
    if (opts.written !== true && opts.authoredStep !== true) {
      const prev = intentionCardNavStop(answer.prev);
      const next = intentionCardNavStop(answer.next);
      const present = [prev, next].filter(Boolean);
      if (present.length && present.every((stop) => stop.source === "calendar")) {
        step = { prev, next, parent: intentionCardNavStop(opts.parent) };
      }
    }
    if (!grouped && !step) return null;
    return {
      from, kind, unit,
      group: grouped ? group : null,
      prevGroup: grouped ? prevGroup : null,
      nextGroup: grouped ? nextGroup : null,
      conflicts, step,
    };
  } catch (_) {
    return null;
  }
}

// Tooltip for a missing rail item or chip; exists items keep today's DOM.
function intentionCardStepTooltip(state, path, ghostReason) {
  if (state === "ghost") return intentionCardNavText(ghostReason).trim() || INTENTION_CARD_NOT_IN_VAULT;
  if (state !== "creatable") return "";
  const name = intentionCardNavLandingName({ path });
  const kind = intentionCardNavCreateKind(path);
  if (kind === "daily") return `${name} isn't created yet — clicking creates it from the daily template`;
  if (kind === "period") return `${name} isn't created yet — clicking creates it with bob periods ensure`;
  return `${name} isn't created yet — clicking creates it`;
}

function intentionCardStatedItem(item, stop) {
  if (!item) return null;
  const state = stop?.state || "exists";
  if (state === "exists") return { ...item, state };
  const path = stop.path || `${intentionCardNavText(item.target)}.md`;
  return {
    ...item, state, ghostReason: stop.ghostReason || "",
    tooltip: intentionCardStepTooltip(state, path, stop.ghostReason), path,
  };
}

// { prev, parent, next, children: [] } for the derived step row, labelled
// like the written rail (`Fri 20` · `W47` · `Sun 22`; `W46` · `2026-Q4` ·
// `W48`) and stated from the resolver's stops. Null without a stop.
function intentionCardDerivedRailItems(navRail, subject) {
  try {
    const step = navRail?.step;
    if (!step || !subject) return null;
    const word = INTENTION_CARD_PERIOD_WORDS[subject.kind] || "note";
    const item = (stop, info, aria) => {
      if (!stop) return null;
      if (subject.kind === "day" && typeof intentionCardRailDayItem === "function") {
        return intentionCardStatedItem(intentionCardRailDayItem({ target: stop.target }, info, aria), stop);
      }
      const label = stop.shortLabel || stop.groupLabel;
      const name = intentionCardSubjectName(info) || stop.target;
      return intentionCardStatedItem({ label, shortLabel: label, target: stop.target, ariaLabel: `${aria}: ${name}` }, stop);
    };
    const prev = item(step.prev, subject.previous, subject.kind === "day" ? "Previous day" : `Previous ${word}`);
    const next = item(step.next, subject.next, subject.kind === "day" ? "Next day" : `Next ${word}`);
    let parent = null;
    if (step.parent) {
      const info = subject.parent;
      if (subject.kind === "day" && info) {
        parent = { label: info.shortLabel, shortLabel: info.shortLabel, target: step.parent.target, ariaLabel: `Parent week: ${info.id}` };
      } else if (subject.kind === "year") {
        parent = { label: "All time", shortLabel: "All time", target: step.parent.target, ariaLabel: "Parent: All time" };
      } else if (info) {
        parent = { label: info.id, shortLabel: info.id, target: step.parent.target, ariaLabel: `Parent ${info.kind}: ${info.id}` };
      }
      parent = intentionCardStatedItem(parent, step.parent);
    }
    if (!prev && !next && !parent) return null;
    return { prev, parent, next, children: [] };
  } catch (_) {
    return null;
  }
}

function intentionCardGroupArm(direction, stop, unit) {
  if (!stop) return null;
  const word = direction === "prev" ? "Previous" : "Next";
  const key = direction === "prev" ? "[N" : "]N";
  const landing = intentionCardNavLandingName(stop);
  let tooltip = "";
  let ariaLabel = `${word} ${unit} group: ${stop.groupLabel}`;
  if (stop.state === "ghost") {
    tooltip = stop.ghostReason || INTENTION_CARD_NOT_IN_VAULT;
    ariaLabel += ", not in vault";
  } else if (stop.state === "creatable") {
    const kind = intentionCardNavCreateKind(stop.path || stop.target);
    tooltip = kind === "daily"
      ? `${landing} isn't created yet — ${key} creates it from the daily template`
      : kind === "period"
        ? `${landing} isn't created yet — ${key} creates it with bob periods ensure`
        : `${landing} isn't created yet — ${key} creates it`;
    ariaLabel += ", not created yet — activating creates it";
  } else {
    tooltip = `${key} · ${word.toLowerCase()} ${unit}: ${stop.groupLabel} → ${landing}`;
    ariaLabel += `, opens ${landing}`;
  }
  if (stop.wraps) {
    tooltip += " · wraps around";
    ariaLabel += ", wraps around";
  }
  return { ...stop, tooltip, ariaLabel };
}

// The kit group-row spec for a card's nav answer, or null.
function intentionCardGroupRowSpec(navRail, options = {}) {
  try {
    if (!navRail || !navRail.unit) return null;
    const unit = navRail.unit;
    const prev = intentionCardGroupArm("prev", navRail.prevGroup, unit);
    const next = intentionCardGroupArm("next", navRail.nextGroup, unit);
    const group = navRail.group;
    let center = null;
    if (group) {
      const noun = group.noun || INTENTION_CARD_PERIOD_WORDS[navRail.kind] || "note";
      const text = `${noun} ${group.position} of ${group.size}`;
      center = {
        text, shortText: `${group.position}/${group.size}`,
        ariaLabel: group.label ? `${text.charAt(0).toUpperCase()}${text.slice(1)} in ${unit} ${group.label}` : text,
        position: group.position, size: group.size,
        members: group.members ? group.members.map((member) => ({ label: member.label, state: member.state })) : null,
      };
    }
    if (!prev && !next && !center) return null;
    return {
      label: `${unit.charAt(0).toUpperCase()}${unit.slice(1)} groups`,
      prev, next, center,
      onActivate: typeof options.onActivate === "function" ? options.onActivate : undefined,
    };
  } catch (_) {
    return null;
  }
}

// Repaint signature for the nav answer: stop targets and states, group
// position and member states, and whether a derived row shows.
function intentionCardNavRailSignature(navRail) {
  if (!navRail) return null;
  const stop = (value) => (value ? [value.target, value.path, value.state, value.ghostReason, value.groupLabel,
    value.landingLabel, value.shortLabel, value.wraps, value.source] : null);
  return {
    from: navRail.from, unit: navRail.unit, conflicts: navRail.conflicts,
    group: navRail.group ? [navRail.group.noun, navRail.group.label, navRail.group.position, navRail.group.size,
      (navRail.group.members || []).map((member) => `${member.label}:${member.state}`)] : null,
    prevGroup: stop(navRail.prevGroup), nextGroup: stop(navRail.nextGroup),
    step: navRail.step ? [stop(navRail.step.prev), stop(navRail.step.parent), stop(navRail.step.next)] : null,
  };
}

class BobLedgerToolsIntentionCardGroupRailMixin {
  // Navigation Hotkeys' walkMode when it is v7 with links(), else null.
  intentionCardWalkMode() {
    try {
      const api = typeof this.dependencyNavApi === "function" ? this.dependencyNavApi() : null;
      const walkMode = api && api.walkMode && typeof api.walkMode === "object" ? api.walkMode : null;
      if (!walkMode || Number(walkMode.version) < INTENTION_CARD_WALK_MODE_VERSION || typeof walkMode.links !== "function") return null;
      return walkMode;
    } catch (_) {
      return null;
    }
  }

  // { from, answer, provider } or null. walkMode.links when available, else
  // navGroupsResolve shaped like it; provider is always the navGroups answer
  // (the derived parent lives only there).
  intentionCardNavAnswer(path, source) {
    try {
      const request = { path: intentionCardFilePath(path), content: intentionCardNavText(source) };
      if (!request.path) return null;
      let provider = null;
      try {
        provider = typeof this.navGroupsResolve === "function" ? this.navGroupsResolve(request) : null;
      } catch (_) { provider = null; }
      if (provider?.ok !== true) provider = null;
      const walkMode = this.intentionCardWalkMode();
      if (walkMode) {
        const answer = walkMode.links(request);
        return answer?.ok === true ? { from: "walkMode", answer, provider } : null;
      }
      if (!provider) return null;
      return {
        from: "navGroups", provider,
        answer: {
          ok: true, prev: provider.step?.prev || null, next: provider.step?.next || null,
          prevGroup: provider.prevGroup, nextGroup: provider.nextGroup, group: provider.group,
          groupConflicts: [],
        },
      };
    } catch (_) {
      return null;
    }
  }

  // model.navRail: never throws; null keeps exactly today's rail.
  intentionCardNavRail(path, source, model) {
    try {
      if (!model?.subject) return null;
      const resolved = this.intentionCardNavAnswer(path, source);
      if (!resolved) return null;
      return intentionCardNavRailModel(resolved.answer, {
        from: resolved.from, subject: model.subject, written: Boolean(model.rail),
        parent: resolved.provider?.step?.parent || null,
        // Without Navigation Hotkeys no step stop says where it came from.
        authoredStep: resolved.from === "navGroups" && intentionCardHasAuthoredStepLink(source),
      });
    } catch (_) {
      return null;
    }
  }

  // { state, ghostReason?, tooltip?, path? } for one written rail target: a
  // missing pre-adoption calendar path is a ghost, any other missing target
  // is creatable (daily_create = yes).
  intentionCardTargetState(target, sourcePath) {
    try {
      const link = intentionCardNavText(target).split("|")[0].split("#")[0].trim();
      if (!link) return { state: "exists" };
      const subject = typeof intentionCardLinkSubject === "function" ? intentionCardLinkSubject(link, this.intentionCardToday()) : null;
      let path = subject?.path || "";
      if (!path) {
        try { path = this.app?.metadataCache?.getFirstLinkpathDest?.(link, intentionCardNavText(sourcePath))?.path || ""; } catch (_) { path = ""; }
      }
      let exists = false;
      try { exists = Boolean(path && this.app?.vault?.getAbstractFileByPath?.(path)); } catch (_) { exists = false; }
      if (exists) return { state: "exists" };
      const missing = path || `${link.replace(/\.md$/i, "")}.md`;
      if (subject?.kind === "all") {
        return { state: "ghost", ghostReason: INTENTION_CARD_ALL_TIME_GHOST, tooltip: INTENTION_CARD_ALL_TIME_GHOST, path: missing };
      }
      // Only a target that ended before today can be pre-adoption, and the
      // check scans the vault's week notes, so future targets skip it.
      let preAdoption = false;
      try {
        const ended = intentionCardDateOrdinal(subject?.end || subject?.start || subject?.id);
        const today = intentionCardDateOrdinal(this.intentionCardToday());
        preAdoption = Boolean(subject && ended !== null && today !== null && ended < today
          && this.navGroupsPathIsPreAdoption?.(missing) === true);
      } catch (_) { preAdoption = false; }
      if (preAdoption) {
        let reason = "";
        try { reason = intentionCardNavText(this.navGroupsPreAdoptionMessage?.(missing)); } catch (_) { reason = ""; }
        reason = reason || INTENTION_CARD_NOT_IN_VAULT;
        return { state: "ghost", ghostReason: reason, tooltip: reason, path: missing };
      }
      return { state: "creatable", tooltip: intentionCardStepTooltip("creatable", missing, ""), path: missing };
    } catch (_) {
      return { state: "exists" };
    }
  }

  // The written rail with a state on every item and chip.
  intentionCardRailStates(rail, sourcePath) {
    if (!rail) return rail;
    try {
      const stated = (item) => (item ? { ...item, ...this.intentionCardTargetState(item.target, sourcePath) } : null);
      return {
        ...rail, prev: stated(rail.prev), parent: stated(rail.parent), next: stated(rail.next),
        children: (rail.children || []).map(stated),
      };
    } catch (_) {
      return rail;
    }
  }

  intentionCardNotice(message) {
    const text = intentionCardNavText(message).trim();
    if (!text) return;
    try {
      const NoticeCtor = typeof Notice !== "undefined" ? Notice : globalThis.Notice;
      if (typeof NoticeCtor === "function") new NoticeCtor(text);
    } catch (_) {}
  }

  intentionCardHasCommand(commandId) {
    try {
      const commands = this.app?.commands;
      const command = commands?.commands?.[commandId] || commands?.findCommand?.(commandId) || null;
      return Boolean(command && typeof commands?.executeCommandById === "function");
    } catch (_) {
      return false;
    }
  }

  // Run a Navigation Hotkeys command in the card's own pane, as rail
  // prev / next do. False when the command or the pane is missing.
  intentionCardRunInLeaf(commandId, sourcePath, event) {
    try {
      if (!this.intentionCardHasCommand(commandId)) return false;
      const leaf = this.intentionCardLeafForEvent?.(event, sourcePath);
      if (!leaf || intentionCardFilePath(leaf.view?.file?.path) !== intentionCardFilePath(sourcePath)) return false;
      this.app.workspace.setActiveLeaf?.(leaf, { focus: true });
      this.app.commands.executeCommandById(commandId);
      return true;
    } catch (_) {
      return false;
    }
  }

  // Rail items and chips: a ghost shows its reason and stops; unmodified
  // prev / next run the step commands (they create and refuse on their
  // own); a creatable period note is created through bob first; everything
  // else keeps today's open path.
  async intentionCardRailActivate(direction, item, sourcePath, event) {
    try {
      const state = INTENTION_CARD_TARGET_STATES.includes(item?.state) ? item.state : "exists";
      if (state === "ghost") {
        this.intentionCardNotice(item?.ghostReason || INTENTION_CARD_NOT_IN_VAULT);
        return false;
      }
      const step = direction === "prev" || direction === "next";
      const modified = typeof intentionCardLinkModified === "function" && intentionCardLinkModified(event);
      if (step && !modified && this.intentionCardHasCommand(`bob-navigation-hotkeys:open-${direction}-link`)) {
        return this.intentionCardRailNavigate(direction, item, sourcePath, event);
      }
      if (state === "creatable") {
        const path = intentionCardNavText(item?.path) || `${intentionCardNavText(item?.target).replace(/\.md$/i, "")}.md`;
        const period = typeof periodNotesPeriodForPath === "function" ? periodNotesPeriodForPath(path) : null;
        if (period && typeof this.periodNotesEnsureForPath === "function") {
          const result = await this.periodNotesEnsureForPath(path);
          if (!result || result.ok !== true) {
            this.intentionCardNotice(result?.message || `${intentionCardNavLandingName({ path })} could not be created`);
            return false;
          }
          return this.intentionCardOpenLink(path.replace(/\.md$/i, ""), sourcePath, event);
        }
      }
      if (typeof this.intentionCardRailNavigate === "function") return this.intentionCardRailNavigate(direction, item, sourcePath, event);
      return this.intentionCardOpenLink(item?.target, sourcePath, event);
    } catch (_) {
      return false;
    }
  }

  // The source pane's current text: its editor or view data, else the
  // vault's cached bytes.
  async intentionCardPaneText(sourcePath, event) {
    const path = intentionCardFilePath(sourcePath);
    try {
      const leaf = this.intentionCardLeafForEvent?.(event, path);
      const view = leaf?.view;
      if (view && intentionCardFilePath(view.file?.path) === path) {
        const text = typeof view.editor?.getValue === "function" ? view.editor.getValue()
          : typeof view.getViewData === "function" ? view.getViewData()
            : typeof view.data === "string" ? view.data : null;
        if (typeof text === "string") return text;
      }
    } catch (_) {}
    try {
      const vault = this.app?.vault;
      const file = vault?.getAbstractFileByPath?.(path);
      if (file && typeof vault.cachedRead === "function") return await vault.cachedRead(file);
      if (file && typeof vault.read === "function") return await vault.read(file);
    } catch (_) {}
    return null;
  }

  // Group arms. A ghost shows its reason. A modified click on an existing
  // arm opens it like a Markdown link. Otherwise the stop is re-validated
  // against the pane's current text; a changed stop repaints and refuses,
  // and a matching one runs open-prev-group-link / open-next-group-link in
  // the card's pane. Without Navigation Hotkeys an existing arm opens
  // through the card's link opener and a creatable one explains.
  async intentionCardGroupActivate(direction, arm, sourcePath, event) {
    try {
      if (direction !== "prev" && direction !== "next" || !arm) return false;
      const state = INTENTION_CARD_TARGET_STATES.includes(arm.state) ? arm.state : "exists";
      if (state === "ghost") {
        this.intentionCardNotice(arm.ghostReason || INTENTION_CARD_NOT_IN_VAULT);
        return false;
      }
      const modified = typeof intentionCardLinkModified === "function" && intentionCardLinkModified(event);
      if (modified && state === "exists") return this.intentionCardOpenLink(arm.target, sourcePath, event);
      const text = await this.intentionCardPaneText(sourcePath, event);
      const latest = typeof text === "string" ? this.intentionCardNavAnswer(sourcePath, text) : null;
      const conflicts = latest?.answer?.groupConflicts || [];
      const stop = latest && !conflicts.includes(direction) ? intentionCardNavStop(latest.answer[`${direction}Group`]) : null;
      if (!stop || stop.target !== arm.target || stop.state !== state || (stop.path || null) !== (arm.path || null)) {
        try { this.intentionCardHost().scheduleRefresh(); } catch (_) {}
        this.intentionCardNotice(INTENTION_CARD_GROUP_CHANGED);
        return false;
      }
      if (latest.from === "walkMode"
        && this.intentionCardRunInLeaf(`bob-navigation-hotkeys:open-${direction}-group-link`, sourcePath, event)) return true;
      if (state === "exists") return this.intentionCardOpenLink(arm.target, sourcePath, event);
      this.intentionCardNotice(`${intentionCardNavLandingName(arm)} isn't created yet — Bob Navigation Hotkeys creates it with ]N`);
      return false;
    } catch (_) {
      return false;
    }
  }

  // Existence repaints: a calendar note created, deleted, or renamed can
  // change any card's states and ticks. Registered once, after layout so
  // the vault's initial load does not fire it.
  intentionCardWatchVault() {
    if (this.intentionCardVaultWatched === true) return;
    const vault = this.app?.vault;
    if (!vault || typeof vault.on !== "function" || typeof this.registerEvent !== "function") return;
    this.intentionCardVaultWatched = true;
    const watch = () => {
      for (const name of ["create", "delete", "rename"]) {
        try {
          this.registerEvent(vault.on(name, (file, oldPath) => this.intentionCardOnVaultChange(file, oldPath)));
        } catch (_) {}
      }
    };
    const workspace = this.app?.workspace;
    if (workspace && typeof workspace.onLayoutReady === "function") {
      try { workspace.onLayoutReady(watch); } catch (_) { watch(); }
    } else {
      watch();
    }
  }

  intentionCardIsCalendarPath(path) {
    const value = intentionCardFilePath(path);
    if (!value) return false;
    if (value === "all_time.md") return true;
    try { return Boolean(intentionCardSubjectForPath(value, this.intentionCardToday())); } catch (_) { return false; }
  }

  intentionCardOnVaultChange(file, oldPath) {
    try {
      if (!this.intentionCardActive) return false;
      const paths = [file?.path, oldPath].filter((value) => typeof value === "string" && value);
      if (!paths.some((path) => this.intentionCardIsCalendarPath(path))) return false;
      this.intentionCardHost().scheduleRefresh();
      return true;
    } catch (_) {
      return false;
    }
  }
}
