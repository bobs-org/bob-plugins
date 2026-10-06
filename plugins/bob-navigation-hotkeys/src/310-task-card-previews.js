function buildTaskCardPriorityPreviews(options = {}) {
  const config = options.config || null;
  const property =
    options.property ||
    (config && Array.isArray(config.properties)
      ? config.properties.find((entry) => entry && entry.values === "priority")
      : null) ||
    null;
  const levels =
    property && Array.isArray(property.levels) ? property.levels : [];
  const baseDate =
    options.baseDate instanceof Date
      ? getLocalDateStart(options.baseDate)
      : getLocalDateStart(new Date());
  const random = typeof options.random === "function" ? options.random : Math.random;
  const uniqueTargets = deduplicateTaskCardTargets(options.targets);
  const propertyName = normalizeBulletPropertyName(property && property.name);
  const unavailable = !propertyName
    ? "Priority is not configured"
    : normalizeBulletPropertyValue(options.unavailableReason) ||
      (uniqueTargets.length === 0 ? "No task targets are available" : "");
  const targetPreviews = uniqueTargets.map(({ id, target }) => {
    const rawLine = String((target && target.rawLine) || "");
    const field = propertyName ? findBulletPropertyField(rawLine, propertyName) : null;
    const currentValue = normalizeBulletPropertyValue(field && field.value);
    return {
      id,
      path: String((target && target.path) || ""),
      line: Number.isInteger(target && target.line) ? target.line : null,
      currentValue,
      currentLabel: property
        ? getBulletPropertyCurrentLabel(property, currentValue)
        : currentValue,
      previews: [],
    };
  });
  const levelPreviews = levels.map((level, index) => {
    const label = normalizeBulletPropertyValue(level && level.label);
    const value = normalizeBulletPropertyValue(level && level.value);
    const key = index < 9 ? String(index + 1) : null;
    if (unavailable || !label || !value) {
      const reason = unavailable || "Priority level is not configured";
      return Object.freeze({
        id: `${propertyName || "priority"}:${index}`,
        index,
        key,
        label: label || `Level ${index + 1}`,
        value,
        available: false,
        unavailableReason: reason,
        targetCount: uniqueTargets.length,
        mixed: false,
        currentValues: Object.freeze([]),
        targetPreviews: Object.freeze([]),
        date: "",
        dateStart: "",
        dateEnd: "",
      });
    }
    const bounds = getPriorityRollBounds(level);
    if (!bounds) {
      return Object.freeze({
        id: `${propertyName}:${index}`,
        index,
        key,
        label,
        value,
        available: false,
        unavailableReason: "Priority level has an invalid date window",
        targetCount: uniqueTargets.length,
        mixed: false,
        currentValues: Object.freeze([]),
        targetPreviews: Object.freeze([]),
        date: "",
        dateStart: "",
        dateEnd: "",
      });
    }
    const entries = [];
    for (const targetPreview of targetPreviews) {
      const currentLabel = targetPreview.currentLabel || IMPLICIT_PRIORITY_LEVEL_LABEL;
      const roll = rollPriorityScheduledDateWithOffset(level, baseDate, random);
      const date = formatBulletPropertyDate(roll.date);
      const reason = formatPriorityRollScheduleReason({
        source: "priority",
        fromLevelLabel: currentLabel,
        level,
        rolledDays: roll.offset,
      });
      const entry = Object.freeze({
        targetId: targetPreview.id,
        path: targetPreview.path,
        line: targetPreview.line,
        currentValue: targetPreview.currentValue,
        currentLabel,
        available: Boolean(date && reason),
        unavailableReason: date && reason ? null : "Could not preview this priority level",
        date,
        offset: roll.offset,
        reason,
      });
      entries.push(entry);
      targetPreview.previews.push(entry);
    }
    const dates = entries.map((entry) => entry.date).filter(Boolean).sort();
    const currentValues = Array.from(
      new Set(entries.map((entry) => entry.currentValue)),
    );
    const available = entries.length > 0 && entries.every((entry) => entry.available);
    return Object.freeze({
      id: `${propertyName}:${index}`,
      index,
      key,
      label,
      value,
      available,
      unavailableReason: available
        ? null
        : entries.find((entry) => !entry.available)?.unavailableReason ||
          "No task targets are available",
      targetCount: entries.length,
      mixed: dates.length > 1 || currentValues.length > 1,
      currentValues: Object.freeze(currentValues),
      targetPreviews: Object.freeze(entries),
      date: dates.length === 1 ? dates[0] : "",
      dateStart: dates.length > 0 ? dates[0] : "",
      dateEnd: dates.length > 0 ? dates[dates.length - 1] : "",
    });
  });
  const frozenTargets = Object.freeze(
    targetPreviews.map((target) =>
      Object.freeze({
        ...target,
        previews: Object.freeze(target.previews),
      }),
    ),
  );
  return Object.freeze({
    propertyName,
    property,
    available: !unavailable && levelPreviews.some((level) => level.available),
    unavailableReason: unavailable || null,
    targetCount: uniqueTargets.length,
    levels: Object.freeze(levelPreviews),
    targets: frozenTargets,
  });
}

function taskCardPropertyItems(context, session, config) {
  if (session.type === "linked") {
    const aggregate = createLinkPickerPropertyItems(config, session.targets);
    return aggregate.valid ? aggregate.items : [];
  }
  if (session.type === "counted") {
    const aggregate = createCountedBulletPropertyItems(
      config,
      session.content,
      session.taskSession,
    );
    return aggregate.valid ? aggregate.items : [];
  }
  return createBulletPropertyItems(
    config,
    session.lineText,
    context.propertyContext || {},
  );
}

function taskCardPriorityRecommendation(context, session, priorityProperty) {
  if (Object.prototype.hasOwnProperty.call(context, "frozenRecommendation")) {
    return context.frozenRecommendation || null;
  }
  if (!priorityProperty || !session.valid) {
    return null;
  }
  const baseDate =
    context.baseDate instanceof Date ? getLocalDateStart(context.baseDate) : new Date();
  const random = typeof context.random === "function" ? context.random : Math.random;
  if (session.type === "linked") {
    const summary = planLinkRollBatchSummary(
      session.targets,
      priorityProperty,
      { baseDate, random },
    );
    const actionable =
      (summary.counts.roll || 0) +
      (summary.counts.decay || 0) +
      (summary.counts.cancel || 0);
    if (actionable === 0 && !summary.unavailableReason) {
      return null;
    }
    return Object.freeze({
      kind: "batch",
      source: summary,
      preview: buildLinkRollPreviewModel(summary, baseDate),
      available: actionable > 0 && !summary.unavailableReason,
      unavailableReason:
        summary.unavailableReason ||
        (actionable > 0 ? null : "No priority recommendation is available"),
      effects: summary.counts,
      targetCount: summary.total,
      actionableCount: summary.actionableCount,
      skippedCount: summary.skippedCount,
    });
  }
  if (session.type === "counted") {
    const summary = planPriorityRollRecommendationsForTargets(
      session.content,
      session.targets,
      priorityProperty,
      { baseDate, random },
    );
    const actionable =
      (summary.counts.roll || 0) +
      (summary.counts.decay || 0) +
      (summary.counts.cancel || 0);
    if (actionable === 0 && !summary.unavailableReason) {
      return null;
    }
    return Object.freeze({
      kind: "batch",
      source: summary,
      preview: buildBatchPriorityRollPreviewModel(summary),
      available: actionable > 0 && !summary.unavailableReason,
      unavailableReason:
        summary.unavailableReason ||
        (actionable > 0 ? null : "No priority recommendation is available"),
      effects: summary.counts,
      targetCount: summary.total,
      actionableCount: summary.actionableCount,
      skippedCount: summary.skippedCount,
    });
  }
  const line = session.lineText;
  const status = getObsidianTaskCheckboxStatus(line);
  if (
    !isObsidianTaskLine(line) ||
    !OPEN_OBSIDIAN_TASK_STATUSES.has(status)
  ) {
    return null;
  }
  const liveContext = getProjectNotePropertyContext(
    session.content,
    session.cursorLine,
  );
  const scheduledName = normalizeBulletPropertyName(priorityProperty.schedules);
  const scheduledTarget = resolveBulletPropertyTarget(scheduledName, liveContext);
  const scheduledField = findBulletPropertyField(line, scheduledName);
  const currentScheduled =
    scheduledTarget.kind === "project-frontmatter"
      ? liveContext.frontmatter && liveContext.frontmatter.scheduledDefined
        ? liveContext.frontmatter.scheduledValue
        : ""
      : scheduledField
        ? scheduledField.value
        : "";
  const recommendation = planPriorityRollRecommendation({
    property: priorityProperty,
    content: session.content,
    taskLine: session.cursorLine,
    currentScheduled,
    baseDate,
    random,
  });
  if (!recommendation) {
    return null;
  }
  return Object.freeze({
    kind: "single",
    source: Object.freeze({
      ...recommendation,
      priorityName: priorityProperty.name,
      schedulesName: normalizeBulletPropertyName(priorityProperty.schedules),
      taskLine: session.cursorLine,
    }),
    preview: buildPriorityRollPreviewModel(recommendation, baseDate),
    available:
      recommendation.kind !== "unavailable" &&
      Boolean(recommendation.date || recommendation.kind === "cancel"),
    unavailableReason:
      recommendation.kind === "unavailable"
        ? recommendation.reason || "Recommendation is unavailable"
        : null,
    effects: Object.freeze({
      roll: recommendation.kind === "roll" ? 1 : 0,
      decay: recommendation.kind === "decay" ? 1 : 0,
      cancel: recommendation.kind === "cancel" ? 1 : 0,
      unavailable: recommendation.kind === "unavailable" ? 1 : 0,
    }),
    targetCount: 1,
    actionableCount: recommendation.kind === "unavailable" ? 0 : 1,
    skippedCount: 0,
  });
}

function taskCardAvailabilityReason(session, rowName) {
  if (!session.valid) {
    return session.error || "Task context is unavailable";
  }
  if (session.targetCount === 0) {
    return "No task targets are available";
  }
  if (session.type === "single" && !isObsidianTaskLine(session.lineText)) {
    return rowName === "depends-on"
      ? "Depends on requires a #task checkbox"
      : rowName === "cancel"
        ? "Only #task checkboxes can be cancelled"
        : "Task action requires a #task checkbox";
  }
  return "No eligible task targets";
}

function taskCardPropertyProjection(item) {
  const property = item && item.property;
  const propertyName = normalizeBulletPropertyName(property && property.name);
  const currentValues = Array.isArray(item && item.currentValues)
    ? item.currentValues.map((value) => normalizeBulletPropertyValue(value))
    : item && item.defined
      ? [normalizeBulletPropertyValue(item.currentValue)]
      : [];
  const valueState = item && item.valueState
    ? item.valueState
    : item && item.defined
      ? "common"
      : "absent";
  return Object.freeze({
    id: `property:${propertyName}`,
    propertyName,
    values: property && property.values,
    label: propertyName,
    enabled: Boolean(propertyName),
    unavailableReason: propertyName ? null : "Property is not configured",
    currentValue: normalizeBulletPropertyValue(item && item.currentValue),
    currentLabel: normalizeBulletPropertyValue(item && item.currentLabel),
    currentValues: Object.freeze(currentValues),
    currentLabels: Object.freeze(
      (Array.isArray(item && item.currentLabels) ? item.currentLabels : []).map(
        (value) => normalizeBulletPropertyValue(value),
      ),
    ),
    valueState,
    mixed: valueState === "mixed" || item?.mixed === true,
    defined: item?.defined === true,
    definedCount: Math.max(0, Math.floor(numericOrDefault(item?.definedCount, 0))),
    targetCount: Math.max(0, Math.floor(numericOrDefault(item?.targetCount, 0))),
    deletable: property && property.values !== "local_task_id",
  });
}

function planTaskCard(context = {}) {
  const config = context.config || { properties: [] };
  const properties = Array.isArray(config.properties) ? config.properties : [];
  const session = taskCardSessionContext(context);
  const propertyItems = taskCardPropertyItems(context, session, config);
  const priorityProperty = properties.find(
    (property) => property && property.values === "priority",
  ) || null;
  const dateProperties = properties.filter(
    (property) => property && property.values === "date",
  );
  const scheduleProperty = priorityProperty
    ? dateProperties.find((property) => property.name === priorityProperty.schedules)
    : dateProperties.find((property) => property.name === "scheduled") ||
      dateProperties[0] ||
      null;
  const propertyProjections = propertyItems.map(taskCardPropertyProjection);
  const propertyByName = new Map(
    propertyProjections.map((item) => [item.propertyName, item]),
  );
  const scheduleProjection = scheduleProperty
    ? propertyByName.get(normalizeBulletPropertyName(scheduleProperty.name)) ||
      taskCardPropertyProjection({ property: scheduleProperty })
    : null;
  const priorityProjection = priorityProperty
    ? propertyByName.get(normalizeBulletPropertyName(priorityProperty.name)) ||
      taskCardPropertyProjection({ property: priorityProperty })
    : null;
  const dependencyProperty = properties.find(
    (property) =>
      property &&
      property.values === "local_task_id" &&
      normalizeBulletPropertyName(property.name) === "dependsOn",
  ) || null;
  const dependencyItem = dependencyProperty
    ? propertyByName.get("dependsOn") || null
    : null;
  const dependencyProjection = dependencyProperty
    ? dependencyItem || taskCardPropertyProjection({ property: dependencyProperty })
    : null;
  const targets = session.targets;
  const targetStatuses = targets.map((target) =>
    getObsidianTaskCheckboxStatus((target && target.rawLine) || ""),
  );
  const distinctStatuses = Array.from(new Set(targetStatuses));
  const previewTargets = deduplicateTaskCardTargets(targets).map((entry) => entry.target);
  const recommendation = taskCardPriorityRecommendation(context, session, priorityProperty);
  const priorityStrip = buildTaskCardPriorityPreviews({
    property: priorityProperty,
    targets: session.valid ? previewTargets : [],
    unavailableReason: session.error,
    baseDate: context.baseDate,
    random: context.random,
  });
  const laneDescription =
    session.type === "linked"
      ? describeLaneRow("", { linkResolved: session.targets })
      : session.type === "counted"
        ? describeLaneRow(session.content, { taskSession: session.taskSession })
        : describeLaneRow(session.content, { cursorLine: session.cursorLine });
  const freshnessApi = context.freshnessApi || null;
  const refreshDescription =
    session.type === "linked"
      ? describeRefreshRow("", {
          linkResolved: session.targets,
          freshnessApi,
        })
      : session.type === "counted"
        ? describeRefreshRow(session.content, {
            taskSession: session.taskSession,
            freshnessApi,
          })
        : describeRefreshRow(session.content, {
            cursorLine: session.cursorLine,
            freshnessApi,
          });
  const cancelDescription =
    session.type === "linked"
      ? describeCancelTaskRow("", { linkResolved: session.targets })
      : session.type === "counted"
        ? describeCancelTaskRow(session.content, { taskSession: session.taskSession })
        : describeCancelTaskRow(session.content, { cursorLine: session.cursorLine });
  const row = (value) => Object.freeze(value);
  const scheduleAvailable = Boolean(
    scheduleProperty && session.targetCount > 0 && session.valid,
  );
  const laneAvailable = Boolean(laneDescription && session.valid);
  const dependencyAvailable = Boolean(
    dependencyProperty && dependencyItem && session.valid,
  );
  const refreshAvailable = Boolean(refreshDescription && session.valid);
  const cancelAvailable = Boolean(
    cancelDescription && !cancelDescription.recurring && session.valid,
  );
  const rows = Object.freeze([
    row({
      id: "schedule",
      kind: "property",
      action: "schedule",
      propertyName: scheduleProperty ? scheduleProperty.name : "",
      label: "Schedule",
      enabled: scheduleAvailable,
      unavailableReason: scheduleAvailable
        ? null
        : scheduleProperty
          ? taskCardAvailabilityReason(session, "schedule")
          : "Schedule is not configured",
      currentValue: scheduleProjection && scheduleProjection.currentValue,
      currentLabel: scheduleProjection && scheduleProjection.currentLabel,
      currentValues: scheduleProjection ? scheduleProjection.currentValues : Object.freeze([]),
      mixed: Boolean(scheduleProjection && scheduleProjection.mixed),
      valueState: scheduleProjection ? scheduleProjection.valueState : "absent",
      deletable: Boolean(scheduleProperty),
      targetCount: session.targetCount,
    }),
    row({
      id: "depends-on",
      kind: "action",
      action: "dependencies",
      label: "Depends on",
      enabled: dependencyAvailable,
      unavailableReason: dependencyAvailable
        ? null
        : dependencyProperty
          ? taskCardAvailabilityReason(session, "depends-on")
          : "Depends on is not configured",
      propertyName: dependencyProperty ? dependencyProperty.name : "",
      detail: dependencyProjection && dependencyProjection.currentLabel,
      mixed: Boolean(dependencyProjection && dependencyProjection.mixed),
      targetCount: session.targetCount,
      deletable: false,
    }),
    row({
      id: "review-every",
      kind: "action",
      action: "refresh",
      label: "Review every",
      enabled: refreshAvailable,
      unavailableReason: refreshAvailable
        ? null
        : freshnessApi
          ? taskCardAvailabilityReason(session, "refresh")
          : "Freshness API is unavailable",
      detail: refreshDescription && refreshDescription.detail,
      mixed: Boolean(refreshDescription && refreshDescription.mixed),
      targetCount: session.targetCount,
      deletable: false,
    }),
    row({
      id: "cancel",
      kind: "action",
      action: "cancel",
      label: cancelDescription
        ? getCancelTaskRowTitle(cancelDescription)
        : "Cancel task",
      enabled: cancelAvailable,
      unavailableReason: cancelAvailable
        ? null
        : cancelDescription && cancelDescription.recurring
          ? "Recurring tasks are cancelled with Obsidian Tasks"
          : taskCardAvailabilityReason(session, "cancel"),
      detail: cancelDescription && cancelDescription.detail,
      targetCount: cancelDescription ? cancelDescription.openCount : session.targetCount,
      deletable: false,
    }),
    row({
      id: "lane",
      kind: "action",
      action: "toggle-lane",
      label: laneDescription
        ? laneDescription.mode === "release"
          ? "Release to Ready"
          : "Commit to Next"
        : "Next / Ready",
      enabled: laneAvailable,
      unavailableReason: laneAvailable
        ? null
        : session.valid && session.targets.length > 0 && session.targets.every(
            (target) => getObsidianTaskCheckboxStatus(target.rawLine || "") === "?",
          )
          ? "Blocked is derived"
          : taskCardAvailabilityReason(session, "lane"),
      detail: laneDescription && laneDescription.detail,
      needsReason: Boolean(laneDescription && laneDescription.needsReason),
      targetCount: laneDescription ? laneDescription.count : session.targetCount,
      deletable: false,
    }),
  ]);
  const selectedRowId = rows.some((item) => item.id === context.selectedRowId)
    ? context.selectedRowId
    : "schedule";
  const mixedMetadata = {};
  for (const projection of propertyProjections) {
    mixedMetadata[projection.propertyName] = Object.freeze({
      valueState: projection.valueState,
      mixed: projection.mixed,
      currentValues: projection.currentValues,
      targetCount: projection.targetCount || session.targetCount,
      definedCount: projection.definedCount,
    });
  }
  const frozenMixedMetadata = Object.freeze(mixedMetadata);
  const baseDate =
    context.baseDate instanceof Date
      ? getLocalDateStart(context.baseDate)
      : getLocalDateStart(new Date());
  const header = buildTaskCardHeader({
    session,
    lineText: session.lineText,
    filePath: context.filePath || "",
    schedule: scheduleProjection,
    priorityStrip,
    mixedMetadata: frozenMixedMetadata,
    refreshDescription,
    rows,
    baseDate,
    inboxRoute: context.inboxRoute || null,
  });
  const timeline = buildTaskCardTimeline({
    recommendation,
    schedule: scheduleProjection,
    baseDate,
  });
  return Object.freeze({
    kind: "task-card",
    session: Object.freeze({
      type: session.type,
      targetCount: session.targetCount,
      linkCount: session.type === "linked" ? session.sourceTargets.length : 0,
      requestedCount: session.requestedCount,
      clamped: session.clamped,
      valid: session.valid,
      error: session.error,
      currentStatus:
        distinctStatuses.length === 1
          ? distinctStatuses[0]
          : getObsidianTaskCheckboxStatus(session.lineText),
      statuses: Object.freeze(distinctStatuses),
      mixedStatus: distinctStatuses.length > 1,
    }),
    title: truncateBulletPropertySubtitle(session.lineText),
    header,
    timeline,
    baseDate: formatBulletPropertyDate(baseDate),
    rows,
    selectedRowId,
    inputActive: context.inputActive === true,
    schedule: scheduleProjection,
    priorityStrip,
    recommendation,
    properties: Object.freeze(propertyProjections),
    moreProperties: Object.freeze(
      propertyProjections.filter(
        (item) =>
          item.propertyName !== (scheduleProperty && scheduleProperty.name) &&
          item.propertyName !== (priorityProperty && priorityProperty.name) &&
          item.propertyName !== (dependencyProperty && dependencyProperty.name),
      ),
    ),
    mixedMetadata: frozenMixedMetadata,
    availability: Object.freeze({
      schedule: scheduleAvailable,
      priority: priorityStrip.available,
      recommendation: Boolean(recommendation && recommendation.available),
      dependencies: dependencyAvailable,
      refresh: refreshAvailable,
      cancel: cancelAvailable,
      lane: laneAvailable,
    }),
  });
}

function taskCardIntentForRow(row) {
  if (!row) {
    return Object.freeze({
      type: "unavailable",
      action: "open-row",
      reason: "No card action is selected",
    });
  }
  if (!row.enabled) {
    return Object.freeze({
      type: "unavailable",
      action: row.action || row.id,
      rowId: row.id,
      reason: row.unavailableReason || "This action is unavailable",
    });
  }
  return Object.freeze({
    type: "open-action",
    action: row.action,
    rowId: row.id,
    propertyName: row.propertyName || "",
    targetCount: row.targetCount || 0,
  });
}

function resolveTaskCardKey(model, event) {
  if (!model || model.kind !== "task-card" || !event) {
    return null;
  }
  if (
    event.isComposing === true ||
    event.keyCode === 229 ||
    model.inputActive === true ||
    event.inputActive === true ||
    event.inTextInput === true
  ) {
    return null;
  }
  const target = event.target;
  if (
    target &&
    (target.isContentEditable === true ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(String(target.tagName || "").toUpperCase()))
  ) {
    return null;
  }
  const key = String(event.key || "");
  const lower = key.toLowerCase();
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const shift = event.shiftKey === true;
  const alt = event.altKey === true;
  const modified = ctrl || meta || shift || alt;
  const repeatedAction = event.repeat === true;
  const rows = Array.isArray(model.rows) ? model.rows : [];
  const selected = rows.find((row) => row.id === model.selectedRowId) || null;
  const rowById = (id) => rows.find((row) => row.id === id) || null;
  const unavailable = (action, reason) =>
    Object.freeze({ type: "unavailable", action, reason });
  const movement = (direction) =>
    Object.freeze({ type: "move-selection", direction, fromRowId: model.selectedRowId });
  const actionKey =
    (!modified && /^[0-9bfx]$/i.test(key)) ||
    (ctrl && !meta && !shift && !alt && ["Enter", "r", "d"].includes(key)) ||
    (meta && !ctrl && !shift && !alt && key === "Enter") ||
    (alt && !ctrl && !meta && !shift && lower === "n");
  if (repeatedAction && actionKey) {
    return Object.freeze({ type: "ignored", reason: "repeated-action-key" });
  }
  if (
    (!modified && key === "ArrowUp") ||
    (ctrl && !meta && !shift && !alt && lower === "p")
  ) {
    return movement("previous");
  }
  if (
    (!modified && key === "ArrowDown") ||
    (ctrl && !meta && !shift && !alt && lower === "n")
  ) {
    return movement("next");
  }
  if ((ctrl || meta) && !shift && !alt && key === "Enter") {
    const recommendation = model.recommendation;
    if (!recommendation || !recommendation.available) {
      return unavailable(
        "apply-recommendation",
        recommendation?.unavailableReason || "No recommendation is available",
      );
    }
    return Object.freeze({
      type: "apply-recommendation",
      recommendation: recommendation.source,
      effects: recommendation.effects,
      targetCount: recommendation.targetCount,
    });
  }
  if (ctrl && !meta && !shift && !alt && lower === "r") {
    if (!model.priorityStrip || !model.priorityStrip.available) {
      return unavailable(
        "refresh-priority-previews",
        model.priorityStrip?.unavailableReason || "Priority is not configured",
      );
    }
    return Object.freeze({
      type: "refresh-previews",
      includeRecommendation: true,
      includePriorityStrip: true,
    });
  }
  if (alt && !ctrl && !meta && !shift && lower === "n") {
    return taskCardIntentForRow(rowById("lane"));
  }
  if (ctrl && !meta && !shift && !alt && lower === "d") {
    if (!selected || selected.kind !== "property" || !selected.deletable) {
      return unavailable("delete-property", "Only a selected property can be deleted");
    }
    if (!selected.enabled) {
      return unavailable(
        "delete-property",
        selected.unavailableReason || "The selected property is unavailable",
      );
    }
    return Object.freeze({
      type: "delete-property",
      rowId: selected.id,
      propertyName: selected.propertyName,
      targetCount: selected.targetCount || model.session.targetCount,
    });
  }
  if (!modified && /^[1-9]$/.test(key)) {
    const level = model.priorityStrip?.levels?.find((item) => item.key === key);
    if (!level) {
      return unavailable("set-priority", "Priority level is not configured");
    }
    if (!level.available) {
      return unavailable("set-priority", level.unavailableReason || "Priority level is unavailable");
    }
    return Object.freeze({
      type: "set-priority",
      propertyName: model.priorityStrip.propertyName,
      levelIndex: level.index,
      levelLabel: level.label,
      value: level.value,
      key,
      previews: level.targetPreviews,
      targetCount: level.targetCount,
      mixed: level.mixed,
    });
  }
  if (!modified && key === "0") {
    if (!model.priorityStrip?.propertyName) {
      return unavailable("clear-priority", "Priority is not configured");
    }
    return Object.freeze({
      type: "clear-priority",
      propertyName: model.priorityStrip.propertyName,
      value: "",
      keepScheduled: true,
      targetCount: model.priorityStrip.targetCount,
    });
  }
  if (!modified && lower === "b") {
    return taskCardIntentForRow(rowById("depends-on"));
  }
  if (!modified && lower === "f") {
    return taskCardIntentForRow(rowById("review-every"));
  }
  if (!modified && lower === "x") {
    return taskCardIntentForRow(rowById("cancel"));
  }
  if (!modified && key === "Enter") {
    return taskCardIntentForRow(selected);
  }
  if (isTaskCardCloseKeydown(event)) {
    return Object.freeze({ type: "close-card" });
  }
  if (!modified && key === "Backspace") {
    return Object.freeze({ type: "back" });
  }
  return null;
}

const TASK_CARD_ROW_ORDER = Object.freeze([
  "schedule",
  "depends-on",
  "review-every",
  "lane",
  "cancel",
]);

const TASK_CARD_ROW_SHORTCUTS = Object.freeze({
  schedule: "Enter",
  "depends-on": "b",
  "review-every": "f",
  lane: "Alt+N",
  cancel: "x",
});

function getTaskCardLaneChipLabel(status) {
  switch (String(status ?? "")) {
    case " ":
      return "READY";
    case "*":
      return "NEXT";
    case "/":
      return "PENDING";
    case "?":
      return "BLOCKED";
    default:
      return null;
  }
}

function parseTaskCardIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(
    normalizeBulletPropertyValue(value),
  );
  if (!match) {
    return null;
  }
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatTaskCardCompactRelative(offset) {
  const days = Number(offset);
  if (!Number.isFinite(days)) {
    return "";
  }
  if (days === 0) {
    return "today";
  }
  if (days > 0) {
    return `in ${days}d`;
  }
  return `${Math.abs(days)}d overdue`;
}

function buildTaskCardDateDisplay(iso, baseDate) {
  const date = parseTaskCardIsoDate(iso);
  if (!date) {
    return null;
  }
  const start =
    baseDate instanceof Date
      ? getLocalDateStart(baseDate)
      : getLocalDateStart(new Date());
  const offset = getLocalDayOffset(start, date);
  return Object.freeze({
    iso: formatBulletPropertyDate(date),
    weekday: getBulletPropertyDateWeekday(date),
    offset,
    relative: formatTaskCardCompactRelative(offset),
    today: offset === 0,
    overdue: offset < 0,
  });
}

