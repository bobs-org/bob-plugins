// Render the shared signal-bar mark at the start of a Task Card level
// label. The glyph is decorative with an inherited color because the
// P-label is already visible. The P0 chip gets no glyph. Without the
// ledger api, or when render returns null, the label is unchanged.
function renderTaskCardLevelGlyph(labelEl, value, options) {
  try {
    const settings = options && typeof options === "object" ? options : {};
    const api =
      settings.priorityMarks || getLedgerPriorityMarksApi(settings.app);
    if (!api || typeof api.render !== "function") {
      return false;
    }
    if (typeof value !== "string" || value === "") {
      return false;
    }
    if (!labelEl || typeof labelEl.createSpan !== "function") {
      return false;
    }
    const host = labelEl.createSpan({ cls: "bob-task-card-level-glyph" });
    let rendered = null;
    try {
      rendered = api.render(host, value, {
        decorative: true,
        inheritColor: true,
      });
    } catch (error) {
      rendered = null;
    }
    if (!rendered) {
      try {
        if (typeof host.remove === "function") {
          host.remove();
        } else if (labelEl && Array.isArray(labelEl.children)) {
          const index = labelEl.children.indexOf(host);
          if (index >= 0) {
            labelEl.children.splice(index, 1);
          }
        }
      } catch (error) {
        // Glyph cleanup never throws.
      }
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function renderTaskCardView(container, model, options = {}) {
  if (!container) {
    return null;
  }
  container.empty();
  addElementClasses(container, "bob-task-card", "bob-key-card");
  const headerModel = (model && model.header) || {};
  const titleId = "bob-task-card-title";
  const header = container.createDiv({ cls: "bob-task-card-header" });
  const titleEl = header.createDiv({
    cls: "bob-task-card-title bob-key-card-title",
    text: headerModel.title || "Task Card",
    attr: {
      id: titleId,
      title: headerModel.fullTitle || headerModel.title || "Task Card",
    },
  });
  titleEl.setAttribute("id", titleId);
  titleEl.setAttribute(
    "title",
    headerModel.fullTitle || headerModel.title || "Task Card",
  );
  const closeButton = header.createEl("button", {
    cls: "bob-task-card-close",
    text: "Close",
    attr: { type: "button", "aria-label": "Close" },
  });
  closeButton.addEventListener("click", (event) => {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (typeof options.onClose === "function") {
      options.onClose();
    }
  });
  // Preserve native Enter/Space activation; every other key bubbles to the
  // card-level router.
  closeButton.addEventListener("keydown", (event) => {
    if (isCardActivationKey(event)) {
      event.stopPropagation();
    }
  });
  const meta = container.createDiv({
    cls: "bob-task-card-meta",
    attr: { "aria-label": "Task metadata" },
  });
  const chips = Array.isArray(headerModel.chips) ? headerModel.chips : [];
  if (chips.length === 0) {
    meta.createSpan({
      cls: "bob-task-card-chip is-muted",
      text: headerModel.error || "unavailable",
    });
  } else {
    for (const chip of chips) {
      const text = String(chip || "");
      const laneClass =
        text === "NEXT"
          ? " is-lane-next"
          : text === "PENDING"
            ? " is-lane-pending"
            : text === "READY"
              ? " is-lane-ready"
              : text === "BLOCKED"
                ? " is-lane-blocked"
                : "";
      const dateTone =
        headerModel.schedule &&
        headerModel.schedule.overdue &&
        text === headerModel.schedule.label
          ? " is-overdue"
          : headerModel.schedule &&
              headerModel.schedule.today &&
              text === headerModel.schedule.label
            ? " is-today"
            : "";
      meta.createSpan({
        cls: `bob-task-card-chip${laneClass}${dateTone}`,
        text,
      });
    }
  }
  if (headerModel.error) {
    const errorEl = container.createDiv({
      cls: "bob-task-card-error",
      text: headerModel.error,
      attr: { role: "alert" },
    });
    errorEl.setAttribute("role", "alert");
  }
  const isCardActivationKey = (event) =>
    Boolean(event) &&
    (event.key === "Enter" || event.key === " ") &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey;
  const isHeldOrComposingKey = (event) =>
    event.repeat === true || event.isComposing === true || event.keyCode === 229;
  const recommendation = model && model.recommendation;
  if (recommendation && recommendation.available) {
    const preview = recommendation.preview || {};
    const tone =
      preview.tone ||
      (preview.kind === "cancel" || recommendation.source.kind === "cancel"
        ? "danger"
        : preview.kind === "decay"
          ? "warn"
          : "accent");
    const banner = container.createDiv({
      cls: `bob-task-card-banner is-${preview.kind || recommendation.source.kind || "roll"} is-${tone}`,
      attr: { role: "button", tabindex: "0", "aria-label": "Apply recommendation" },
    });
    const activateRecommendation = (event) => {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      if (typeof options.onApplyRecommendation === "function") {
        options.onApplyRecommendation();
      }
    };
    banner.addEventListener("click", activateRecommendation);
    banner.addEventListener("keydown", (event) => {
      if (isCardActivationKey(event)) {
        if (isHeldOrComposingKey(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        activateRecommendation(event);
        return;
      }
    });
    const bannerMain = banner.createDiv({ cls: "bob-task-card-banner-main" });
    appendTaskCardKeycap(bannerMain, "Ctrl+Enter");
    const actionText =
      preview.kind === "cancel" ||
      (recommendation.source && recommendation.source.kind === "cancel")
        ? "Cancel task"
        : preview.action || "Roll";
    bannerMain.createSpan({
      cls: "bob-task-card-banner-action",
      text: actionText,
    });
    if (preview.dateText || preview.dateValue) {
      const dateEl = bannerMain.createSpan({
        cls: "bob-task-card-banner-date",
        text: preview.dateText || preview.dateValue,
      });
      if (preview.kind === "cancel") {
        addElementClasses(dateEl, "is-danger");
      }
    }
    if (preview.meta) {
      bannerMain.createSpan({
        cls: "bob-task-card-banner-meta",
        text: preview.meta,
      });
    }
    if (recommendation.kind === "batch") {
      const counts = recommendation.effects || {};
      const skipped = recommendation.skippedCount || 0;
      banner.createDiv({
        cls: "bob-task-card-banner-batch",
        text: [
          recommendation.actionableCount
            ? `${recommendation.actionableCount} actions`
            : "",
          counts.roll ? `${counts.roll} roll` : "",
          counts.decay ? `${counts.decay} decay` : "",
          counts.cancel ? `${counts.cancel} cancel` : "",
          skipped ? `${skipped} skipped` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
    const timeline = model.timeline;
    if (timeline) {
      const timelineEl = banner.createDiv({
        cls: "bob-task-card-timeline",
      });
      renderTaskCardTimelineTrack(timelineEl, timeline);
      const regen = timelineEl.createDiv({
        cls: "bob-task-card-timeline-regen",
      });
      appendTaskCardKeycap(regen, "Ctrl+R");
      regen.addEventListener("click", (event) => {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        if (typeof options.onRefreshPreviews === "function") {
          options.onRefreshPreviews();
        }
      });
    }
  }
  const strip = model && model.priorityStrip;
  const stripEl = container.createDiv({
    cls: "bob-task-card-strip",
    attr: {
      role: "radiogroup",
      "aria-label": "Priority levels",
    },
  });
  stripEl.setAttribute("role", "radiogroup");
  stripEl.setAttribute("aria-label", "Priority levels");
  const priorityRadios = [];
  const currentPriority = currentTaskCardPriorityValue(model);
  const levels = strip && Array.isArray(strip.levels) ? strip.levels : [];
  if (!strip || !strip.propertyName || levels.length === 0) {
    stripEl.createDiv({
      cls: "bob-task-card-strip-empty",
      text: (strip && strip.unavailableReason) || "Priority is unavailable",
    });
  } else {
    for (const level of levels) {
      const isCurrent =
        currentPriority !== "mixed" &&
        normalizeBulletPropertyValue(level.value) === currentPriority &&
        currentPriority !== "";
      const dateDisplay = buildTaskCardDateDisplay(
        level.mixed ? "" : level.date,
        model && model.baseDate ? parseTaskCardIsoDate(model.baseDate) : null,
      );
      const dateLabel = level.mixed
        ? `${level.dateStart || ""} → ${level.dateEnd || ""}`.trim()
        : dateDisplay
          ? `${dateDisplay.weekday} ${dateDisplay.iso}`
          : level.date || "";
      const levelEl = stripEl.createDiv({
        cls: `bob-task-card-level bob-key-card-row ${taskCardLevelToneClass(level.index)}${
          isCurrent ? " is-current" : ""
        }${level.available ? "" : " is-disabled"}${level.mixed ? " is-mixed" : ""}`,
        attr: {
          role: "radio",
          "aria-checked": isCurrent ? "true" : "false",
          "aria-disabled": level.available ? "false" : "true",
          tabindex: isCurrent ? "0" : "-1",
          "aria-label": `${level.key ? `${level.key} ` : ""}${level.label}${dateLabel ? ` ${dateLabel}` : ""}`,
        },
      });
      levelEl.setAttribute("role", "radio");
      levelEl.setAttribute("aria-checked", isCurrent ? "true" : "false");
      levelEl.setAttribute("tabindex", isCurrent ? "0" : "-1");
      levelEl.addEventListener("click", (event) => {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        if (typeof options.onSelectPriority === "function") {
          options.onSelectPriority(level);
        }
      });
      levelEl.addEventListener("keydown", (event) => {
        if (event && ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const current = priorityRadios.indexOf(levelEl);
          const next = event.key === "Home"
            ? 0
            : event.key === "End"
              ? priorityRadios.length - 1
              : (current + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + priorityRadios.length) % priorityRadios.length;
          if (priorityRadios[next] && typeof priorityRadios[next].focus === "function") {
            priorityRadios[next].focus();
          }
          return;
        }
        if (isCardActivationKey(event)) {
          event.preventDefault();
          event.stopPropagation();
          if (!isHeldOrComposingKey(event) && typeof options.onSelectPriority === "function") {
            options.onSelectPriority(level);
          }
          return;
        }
      });
      priorityRadios.push(levelEl);
      if (level.key) {
        appendTaskCardKeycap(levelEl, level.key);
      }
      const body = levelEl.createDiv({ cls: "bob-task-card-level-body" });
      const labelEl = body.createDiv({ cls: "bob-task-card-level-label" });
      renderTaskCardLevelGlyph(labelEl, level.value, options);
      labelEl.appendText(level.label ?? "");
      body.createDiv({
        cls: "bob-task-card-level-date",
        text: dateLabel || (level.available ? "" : level.unavailableReason || ""),
      });
      if (isCurrent) {
        body.createDiv({
          cls: "bob-task-card-level-hint",
          text: "re-pick · resets streak",
        });
      }
    }
    const zeroCurrent = currentPriority === "";
    const zeroEl = stripEl.createDiv({
      cls: `bob-task-card-level bob-key-card-row is-p0${
        zeroCurrent ? " is-current" : ""
      }`,
      attr: {
        role: "radio",
        "aria-checked": zeroCurrent ? "true" : "false",
        "aria-label": "P0 clear, keeps date",
      },
    });
    zeroEl.setAttribute("role", "radio");
    zeroEl.setAttribute("aria-checked", zeroCurrent ? "true" : "false");
    zeroEl.setAttribute("tabindex", zeroCurrent ? "0" : "-1");
    appendTaskCardKeycap(zeroEl, "0");
    const zeroBody = zeroEl.createDiv({ cls: "bob-task-card-level-body" });
    zeroBody.createDiv({
      cls: "bob-task-card-level-label",
      text: IMPLICIT_PRIORITY_LEVEL_LABEL,
    });
    zeroBody.createDiv({
      cls: "bob-task-card-level-date",
      text: "clear · keeps date",
    });
    zeroEl.addEventListener("click", (event) => {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (typeof options.onClearPriority === "function") {
        options.onClearPriority();
      }
    });
    zeroEl.addEventListener("keydown", (event) => {
      if (isCardActivationKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        if (!isHeldOrComposingKey(event) && typeof options.onClearPriority === "function") {
          options.onClearPriority();
        }
      } else if (event && ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const current = priorityRadios.indexOf(zeroEl);
        const next = event.key === "Home"
          ? 0
          : event.key === "End"
            ? priorityRadios.length - 1
            : (current + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + priorityRadios.length) % priorityRadios.length;
        if (priorityRadios[next] && typeof priorityRadios[next].focus === "function") {
          priorityRadios[next].focus();
        }
      }
    });
    priorityRadios.push(zeroEl);
    if (currentPriority === "mixed") {
      stripEl.createDiv({
        cls: "bob-task-card-strip-mixed",
        text: "mixed priorities",
      });
    }
  }
  const listEl = container.createDiv({
    cls: "bob-task-card-actions",
    attr: {
      role: "listbox",
      "aria-label": "Task Card actions",
      tabindex: "0",
    },
  });
  listEl.setAttribute("role", "listbox");
  listEl.setAttribute("aria-label", "Task Card actions");
  listEl.setAttribute("tabindex", "0");
  const presentedRows = orderedTaskCardRows(model);
  let selectedOptionId = "";
  for (const row of presentedRows) {
    if (row.dividerBefore) {
      listEl.createDiv({
        cls: "bob-task-card-divider",
        attr: { role: "separator" },
      });
    }
    const optionId = `bob-task-card-row-${row.id}`;
    const rowEl = listEl.createDiv({
      cls: `bob-task-card-row bob-key-card-row${
        row.selected ? " is-selected" : ""
      }${row.enabled ? "" : " is-disabled"}${
        row.destructive ? " is-destructive" : ""
      }`,
      attr: {
        id: optionId,
        role: "option",
        "aria-selected": row.selected ? "true" : "false",
        "aria-disabled": row.enabled ? "false" : "true",
      },
    });
    rowEl.setAttribute("id", optionId);
    rowEl.setAttribute("role", "option");
    rowEl.setAttribute("aria-selected", row.selected ? "true" : "false");
    if (row.selected) {
      selectedOptionId = optionId;
    }
    if (row.shortcut) {
      appendTaskCardKeycap(rowEl, row.shortcut);
    } else {
      rowEl.createDiv({ cls: "bob-task-card-key-spacer" });
    }
    const body = rowEl.createDiv({ cls: "bob-task-card-row-body" });
    body.createDiv({ cls: "bob-task-card-row-label", text: row.label });
    if (row.detail) {
      body.createDiv({
        cls: row.enabled
          ? "bob-task-card-row-detail"
          : "bob-task-card-row-reason",
        text: row.detail,
      });
    }
    rowEl.addEventListener("click", (event) => {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (typeof options.onOpenRow === "function") {
        options.onOpenRow(row.id);
      } else if (typeof options.onSelectRow === "function") {
        options.onSelectRow(row.id);
      }
    });
  }
  if (selectedOptionId) {
    listEl.setAttribute("aria-activedescendant", selectedOptionId);
  }
  const moreProperties = (model && model.moreProperties) || [];
  if (moreProperties.length > 0) {
    const more = container.createDiv({
      cls: "bob-task-card-more",
      attr: { "aria-label": "More properties" },
    });
    more.createDiv({
      cls: "bob-task-card-more-title",
      text: "More",
    });
    for (const item of moreProperties) {
      const moreRow = more.createDiv({
        cls: "bob-task-card-more-row",
        attr: { role: "button", tabindex: "0", "aria-label": `Open ${item.propertyName || item.label || "property"}` },
      });
      const openProperty = (event) => {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        if (typeof options.onOpenProperty === "function") {
          options.onOpenProperty(item.propertyName || item.label || "");
        }
      };
      moreRow.addEventListener("click", openProperty);
      moreRow.addEventListener("keydown", (event) => {
        if (event && (event.key === "Enter" || event.key === " ")) {
          if (typeof event.stopPropagation === "function") {
            event.stopPropagation();
          }
          openProperty(event);
          return;
        }
      });
      moreRow.createSpan({
        cls: "bob-task-card-more-name",
        text: item.propertyName || item.label || "property",
      });
      moreRow.createSpan({
        cls: "bob-task-card-more-value",
        text: item.mixed
          ? "mixed"
          : item.currentLabel || item.currentValue || "unset",
      });
    }
  }
  if (model && model.session && model.session.type !== "single") {
    const disclosure = container.createDiv({
      cls: "bob-task-card-disclosure",
    });
    if (model.session.type === "counted") {
      disclosure.createDiv({
        cls: "bob-task-card-disclosure-title",
        text: model.session.clamped
          ? `${model.session.targetCount} of ${model.session.requestedCount} requested · end of note`
          : formatCountLabel(model.session.targetCount, "task"),
      });
    } else if (model.session.type === "linked") {
      disclosure.createDiv({
        cls: "bob-task-card-disclosure-title",
        text: `via Task Link · ${formatCountLabel(model.session.targetCount, "task")}`,
      });
      const notes = (model.header && model.header.targetNotes) || [];
      if (notes.length > 0) {
        disclosure.createDiv({
          cls: "bob-task-card-disclosure-notes",
          text: notes.join(" · "),
        });
      }
    }
    if (recommendation && recommendation.kind === "batch") {
      const entries =
        recommendation.source && Array.isArray(recommendation.source.entries)
          ? recommendation.source.entries
          : [];
      for (const entry of entries.slice(0, 8)) {
        const rec = entry && entry.recommendation;
        disclosure.createDiv({
          cls: "bob-task-card-disclosure-item",
          text: rec
            ? `${rec.kind}${rec.date ? ` · ${rec.date}` : ""}`
            : entry.skipped || "skipped",
        });
      }
    }
  }
  if (headerModel.empty && !headerModel.error) {
    container.createDiv({
      cls: "bob-task-card-empty",
      text: "No task targets are available",
    });
  }
  const footer = container.createDiv({
    cls: "bob-task-card-footer bob-key-card-footer",
  });
  footer.createSpan({
    text: "Ctrl+D clear selected property · Esc / q / Ctrl+[ close",
  });
  if (typeof options.onFocusList === "function") {
    options.onFocusList(listEl);
  } else if (listEl && typeof listEl.focus === "function") {
    listEl.focus();
  }
  return Object.freeze({
    titleId,
    listEl,
    closeButton,
  });
}

// Between the Task Card and the stage it opens the modal borrows the filtered
// picker chrome for one synchronous step. These options paint no title,
// rows, or hints, so no frame can show a property list.
const TASK_CARD_PENDING_STAGE = "stage-pending";

function taskCardNeutralStageOptions() {
  return {
    items: [],
    title: "",
    headerIcon: "list-checks",
    inputLabel: "Filter",
    placeholder: "",
    resultsLabel: "Task Card stage",
    emptyText: "",
    footerHints: [],
    getSubtitle: () => "",
    filterItem: () => true,
    renderItem: () => {},
    openItem: () => false,
  };
}

