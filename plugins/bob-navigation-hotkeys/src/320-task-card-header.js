function buildTaskCardHeader(details = {}) {
  const session = details.session || {};
  const lineText = String(details.lineText || session.lineText || "");
  const fullTitle = lineText ? cleanTaskDisplayText(lineText) : "";
  const filePath = String(details.filePath || "");
  const note = getVaultPathBasenameWithoutExtension(filePath);
  const statusFromTargets = Array.isArray(session.targets)
    ? session.targets.map((target) =>
        getObsidianTaskCheckboxStatus((target && target.rawLine) || ""),
      )
    : [];
  const statuses = Array.isArray(session.statuses) && session.statuses.length > 0
    ? session.statuses
    : statusFromTargets.length > 0
      ? statusFromTargets
      : [session.currentStatus];
  const laneLabels = Array.from(
    new Set(statuses.map(getTaskCardLaneChipLabel).filter(Boolean)),
  );
  const lane =
    laneLabels.length === 0
      ? null
      : laneLabels.length === 1
        ? laneLabels[0]
        : "mixed";
  const priorityStrip = details.priorityStrip || {};
  const mixedPriority = details.mixedMetadata && details.mixedMetadata.priority;
  let priority = null;
  if (!priorityStrip.propertyName) {
    priority = Object.freeze({ available: false, label: "unavailable" });
  } else if (mixedPriority && mixedPriority.mixed) {
    priority = Object.freeze({ available: true, label: "mixed", mixed: true });
  } else {
    const currentValue = normalizeBulletPropertyValue(
      mixedPriority && Array.isArray(mixedPriority.currentValues)
        ? mixedPriority.currentValues[0]
        : priorityStrip.targets &&
            priorityStrip.targets[0] &&
            priorityStrip.targets[0].currentValue,
    );
    const currentLabel = currentValue
      ? getBulletPropertyCurrentLabel(priorityStrip.property, currentValue) ||
        currentValue
      : IMPLICIT_PRIORITY_LEVEL_LABEL;
    priority = Object.freeze({
      available: true,
      label: currentLabel,
      value: currentValue,
      mixed: false,
    });
  }
  const scheduleProjection = details.schedule || null;
  let schedule = Object.freeze({ available: false, label: "unavailable" });
  if (scheduleProjection && scheduleProjection.enabled !== false) {
    if (scheduleProjection.mixed) {
      schedule = Object.freeze({
        available: true,
        mixed: true,
        label: "mixed",
      });
    } else {
      const display = buildTaskCardDateDisplay(
        scheduleProjection.currentValue,
        details.baseDate,
      );
      schedule = display
        ? Object.freeze({
            available: true,
            mixed: false,
            label: `${display.weekday} ${display.iso} · ${display.relative}`,
            ...display,
          })
        : Object.freeze({ available: false, label: "unavailable" });
    }
  }
  const dependsRow =
    (Array.isArray(details.rows) ? details.rows : []).find(
      (row) => row && row.id === "depends-on",
    ) || null;
  const dependencies = dependsRow
    ? Object.freeze({
        available: dependsRow.enabled,
        label: dependsRow.enabled
          ? dependsRow.detail || "none"
          : dependsRow.unavailableReason || "unavailable",
        mixed: Boolean(dependsRow.mixed),
      })
    : Object.freeze({ available: false, label: "unavailable" });
  const refresh = details.refreshDescription
    ? Object.freeze({
        available: true,
        days: details.refreshDescription.days,
        source: details.refreshDescription.source,
        mixed: Boolean(details.refreshDescription.mixed),
        label: details.refreshDescription.mixed
          ? "mixed"
          : details.refreshDescription.detail ||
            `${details.refreshDescription.days}d`,
      })
    : Object.freeze({
        available: false,
        label: "unavailable",
      });
  const targetNotes = Array.from(
    new Set(
      (priorityStrip.targets || [])
        .map((target) =>
          getVaultPathBasenameWithoutExtension((target && target.path) || ""),
        )
        .filter(Boolean),
    ),
  );
  const chips = [];
  if (session.type === "linked") {
    chips.push("via Task Link");
  }
  if (isProjectLifecycleTaskLine(lineText)) {
    chips.push("project");
  }
  if (note) {
    chips.push(note);
  }
  if (lane) {
    chips.push(lane);
  }
  if (priority && priority.available) {
    chips.push(priority.label);
  }
  if (schedule && schedule.available) {
    chips.push(schedule.label);
  }
  if (dependencies.available && dependsRow && dependsRow.detail) {
    chips.push(dependsRow.detail);
  }
  if (refresh.available && refresh.label && refresh.label !== "unavailable") {
    chips.push(refresh.label);
  }
  if (session.type === "counted") {
    const countLabel = session.clamped
      ? `${formatCountLabel(session.targetCount, "task")} of ${session.requestedCount} requested · end of note`
      : formatCountLabel(session.targetCount, "task");
    chips.push(countLabel);
  }
  if (session.type === "linked" && targetNotes.length > 0) {
    chips.push(targetNotes.join(", "));
  }
  return Object.freeze({
    title: fullTitle || "Task Card",
    fullTitle: fullTitle || "Task Card",
    note: note || "",
    lane,
    laneMixed: lane === "mixed",
    priority,
    schedule,
    dependencies,
    review: refresh,
    chips: Object.freeze(chips),
    viaTaskLink: session.type === "linked",
    project: isProjectLifecycleTaskLine(lineText),
    targetNotes: Object.freeze(targetNotes),
    error: session.valid ? null : session.error || "Task context is unavailable",
    empty: !session.valid || session.targetCount === 0,
  });
}

function buildTaskCardTimeline(details = {}) {
  const recommendation = details.recommendation;
  if (!recommendation || !recommendation.available) {
    return null;
  }
  const source = recommendation.source || {};
  const preview = recommendation.preview || {};
  const scheduleDisplay = buildTaskCardDateDisplay(
    details.schedule && details.schedule.currentValue,
    details.baseDate,
  );
  if (recommendation.kind === "batch") {
    return Object.freeze({
      kind: "batch",
      dateStart: normalizeBulletPropertyValue(source.dateStart || preview.dateValue),
      dateEnd: normalizeBulletPropertyValue(source.dateEnd || ""),
      currentOffset:
        scheduleDisplay && Number.isFinite(scheduleDisplay.offset)
          ? scheduleDisplay.offset
          : null,
      frozenOffset: null,
      minDays: null,
      maxDays: null,
      outOfWindow: false,
      label:
        source.dateStart && source.dateEnd && source.dateStart !== source.dateEnd
          ? `${source.dateStart} → ${source.dateEnd}`
          : source.dateStart || source.dateEnd || preview.dateText || "",
    });
  }
  const level = source.toLevel || source.level || null;
  const bounds = getPriorityRollBounds(level);
  const frozenOffset = Number.isFinite(Number(source.offset))
    ? Number(source.offset)
    : null;
  const minDays = bounds ? bounds.minDays : null;
  const maxDays = bounds ? bounds.maxDays : null;
  const outOfWindow =
    frozenOffset !== null &&
    minDays !== null &&
    maxDays !== null &&
    (frozenOffset < minDays || frozenOffset > maxDays);
  return Object.freeze({
    kind: source.kind || preview.kind || "roll",
    dateStart: "",
    dateEnd: "",
    currentOffset:
      scheduleDisplay && Number.isFinite(scheduleDisplay.offset)
        ? scheduleDisplay.offset
        : 0,
    frozenOffset,
    minDays,
    maxDays,
    outOfWindow,
    label:
      frozenOffset === null
        ? ""
        : `${formatTaskCardCompactRelative(frozenOffset)} · ${minDays ?? "?"}–${maxDays ?? "?"}d`,
  });
}

function presentTaskCardRow(row) {
  if (!row) {
    return null;
  }
  const shortcut = TASK_CARD_ROW_SHORTCUTS[row.id] || "";
  let label = row.label || "";
  if (row.id === "schedule") {
    label = "Schedule…";
  } else if (row.id === "depends-on") {
    label = "Blocked by…";
  } else if (row.id === "review-every") {
    label = "Review every…";
  } else if (row.id === "cancel" && label && !label.endsWith("…")) {
    label = `${label}…`;
  }
  return Object.freeze({
    id: row.id,
    kind: row.kind,
    action: row.action,
    shortcut,
    label,
    detail: row.enabled
      ? row.currentLabel || row.detail || ""
      : row.unavailableReason || row.detail || "",
    enabled: Boolean(row.enabled),
    unavailableReason: row.unavailableReason || null,
    selected: false,
    destructive: row.id === "cancel",
    dividerBefore: row.id === "cancel",
  });
}

function orderedTaskCardRows(model) {
  const rows = Array.isArray(model && model.rows) ? model.rows : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = [];
  for (const id of TASK_CARD_ROW_ORDER) {
    const row = byId.get(id);
    if (!row) {
      continue;
    }
    const presented = presentTaskCardRow(row);
    ordered.push(
      Object.freeze({
        ...presented,
        selected: row.id === (model && model.selectedRowId),
      }),
    );
  }
  for (const row of rows) {
    if (TASK_CARD_ROW_ORDER.includes(row.id)) {
      continue;
    }
    const presented = presentTaskCardRow(row);
    ordered.push(
      Object.freeze({
        ...presented,
        selected: row.id === (model && model.selectedRowId),
      }),
    );
  }
  return Object.freeze(ordered);
}

function taskCardLevelToneClass(index) {
  if (index === 0) {
    return "is-p1";
  }
  if (index === 1) {
    return "is-p2";
  }
  if (index === 2) {
    return "is-p3";
  }
  if (index === 3) {
    return "is-p4";
  }
  return "is-extra";
}

function currentTaskCardPriorityValue(model) {
  const mixed = model && model.mixedMetadata && model.mixedMetadata.priority;
  if (!mixed || mixed.mixed) {
    return mixed && mixed.mixed ? "mixed" : "";
  }
  return normalizeBulletPropertyValue(
    Array.isArray(mixed.currentValues) ? mixed.currentValues[0] : "",
  );
}

function appendTaskCardKeycap(parent, text) {
  if (!parent || !text) {
    return null;
  }
  return parent.createEl("kbd", {
    cls: "bob-key-card-key bob-task-card-key",
    text,
  });
}

function renderTaskCardTimelineTrack(container, timeline) {
  if (!container || !timeline) {
    return;
  }
  const track = container.createDiv({ cls: "bob-task-card-timeline-track" });
  track.createSpan({
    cls: "bob-task-card-timeline-today",
    text: "today",
  });
  if (timeline.kind === "batch") {
    track.createSpan({
      cls: "bob-task-card-timeline-span",
      text: timeline.label || "multiple dates",
    });
    return;
  }
  const min = Number(timeline.minDays);
  const max = Number(timeline.maxDays);
  const frozen = Number(timeline.frozenOffset);
  const current = Number(timeline.currentOffset);
  const points = [0];
  if (Number.isFinite(min)) {
    points.push(min);
  }
  if (Number.isFinite(max)) {
    points.push(max);
  }
  if (Number.isFinite(frozen)) {
    points.push(frozen);
  }
  if (Number.isFinite(current)) {
    points.push(current);
  }
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = Math.max(1, hi - lo);
  const place = (value, cls, label) => {
    if (!Number.isFinite(value)) {
      return;
    }
    const tick = track.createDiv({ cls: `bob-task-card-timeline-tick ${cls}` });
    const percent = ((value - lo) / span) * 100;
    tick.style.left = `${Math.max(0, Math.min(100, percent))}%`;
    tick.setAttribute("title", label);
    tick.setAttribute("aria-label", label);
  };
  if (Number.isFinite(min) && Number.isFinite(max)) {
    const windowEl = track.createDiv({
      cls: "bob-task-card-timeline-window",
    });
    windowEl.style.left = `${Math.max(0, Math.min(100, ((min - lo) / span) * 100))}%`;
    windowEl.style.width = `${Math.max(0, Math.min(100, ((max - min) / span) * 100))}%`;
    windowEl.setAttribute("aria-hidden", "true");
    track.createSpan({
      cls: "bob-task-card-timeline-bound is-min",
      text: `${min}d`,
    });
    track.createSpan({
      cls: "bob-task-card-timeline-bound is-max",
      text: `${max}d`,
    });
  }
  place(current, "is-current", "current date");
  if (Number.isFinite(frozen)) {
    place(
      frozen,
      timeline.outOfWindow ? "is-frozen is-out-of-window" : "is-frozen",
      `preview ${formatTaskCardCompactRelative(frozen)}`,
    );
  }
}

