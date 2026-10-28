// Lane-walk toast: rich `.bob-nh-notice` card plus the plain-text
// fallback. Replaces the previous lane-walk notice instead of stacking.
function renderLaneWalkNoticeFragment(model, root) {
  const lane = model && model.lane === "next" ? "next" : "pending";
  const card = root.createDiv({
    cls: `bob-nh-notice bob-nh-lane-walk is-${lane}`,
    attr: { "aria-label": model.text },
  });
  const headerEl = card.createDiv({ cls: "bob-nh-notice-header" });
  headerEl.createSpan({
    cls: "bob-nh-lane-walk-box",
    text: lane === "next" ? "*" : "/",
    attr: { "aria-hidden": "true" },
  });
  headerEl.createSpan({ cls: "bob-nh-notice-level", text: model.laneLabel });
  headerEl.createSpan({
    cls: "bob-nh-notice-count",
    text: `${model.laneRank} of ${model.laneTotal}`,
  });
  headerEl.createSpan({
    cls: "bob-nh-notice-receipt",
    text: `${model.rank}/${model.total}`,
  });

  const lanes = Array.isArray(model.railLanes) ? model.railLanes : null;
  const railEl = card.createDiv({
    cls: "bob-nh-lane-walk-rail",
    attr: { "aria-hidden": "true" },
  });
  if (lanes && lanes.length > 30) {
    const bar = railEl.createDiv({ cls: "bob-nh-lane-walk-bar" });
    const pendingCount = lanes.filter((item) => item !== "next").length;
    const nextCount = lanes.length - pendingCount;
    const pendingSeg = bar.createDiv({
      cls: "bob-nh-lane-walk-bar-pending",
    });
    const nextSeg = bar.createDiv({ cls: "bob-nh-lane-walk-bar-next" });
    try {
      pendingSeg.setAttribute("style", `flex-grow: ${pendingCount}`);
      nextSeg.setAttribute("style", `flex-grow: ${nextCount}`);
    } catch (error) {
      // Inline flex is best-effort.
    }
    const caret = bar.createDiv({ cls: "bob-nh-lane-walk-caret" });
    try {
      const percent = ((model.rank - 0.5) / lanes.length) * 100;
      caret.setAttribute("style", `left: ${percent}%`);
    } catch (error) {
      // Caret position is best-effort.
    }
  } else if (lanes && lanes.length > 0) {
    const pendingTotal = lanes.filter((item) => item !== "next").length;
    lanes.forEach((itemLane, index) => {
      const isCurrent = index === model.rank - 1;
      const cls = `bob-nh-lane-walk-dot is-${itemLane}${isCurrent ? " is-current" : ""}`;
      railEl.createSpan({ cls, attr: { "aria-hidden": "true" } });
      if (
        pendingTotal > 0 &&
        index === pendingTotal - 1 &&
        index < lanes.length - 1 &&
        lanes[index + 1] === "next"
      ) {
        railEl.createSpan({
          cls: "bob-nh-lane-walk-gap",
          attr: { "aria-hidden": "true" },
        });
      }
    });
  } else {
    railEl.createSpan({
      cls: `bob-nh-lane-walk-dot is-${lane} is-current`,
      attr: { "aria-hidden": "true" },
    });
  }

  card.createDiv({ cls: "bob-nh-lane-walk-title", text: model.title });

  const chipsEl = card.createDiv({ cls: "bob-nh-notice-chips" });
  if (model.noteName) {
    chipsEl.createSpan({
      cls: "bob-nh-notice-chip",
      text: String(model.noteName),
    });
  }
  if (model.workLog && model.workLog.date && model.workLog.summary) {
    chipsEl.createSpan({
      cls: "bob-nh-notice-chip",
      text: `🛠️ ${reviewShortDate(model.workLog.date)} — ${model.workLog.summary}`,
    });
  } else if (model.created) {
    chipsEl.createSpan({
      cls: "bob-nh-notice-chip",
      text: `created ${reviewShortDate(model.created)}`,
    });
  }
  if (model.wrapped === true) {
    chipsEl.createSpan({
      cls: "bob-nh-notice-chip is-info",
      text: "↻ wrapped",
    });
  }

  const hintEl = card.createDiv({ cls: "bob-nh-lane-walk-hint" });
  hintEl.createSpan({ cls: "bob-nh-lane-walk-key", text: "Ctrl+Shift+Enter" });
  hintEl.createSpan({ text: " today · " });
  hintEl.createSpan({ cls: "bob-nh-lane-walk-key", text: "Alt+N" });
  hintEl.createSpan({ text: " release" });
  return card;
}

function renderLaneWalkEmptyFragment(model, root) {
  const card = root.createDiv({
    cls: "bob-nh-notice bob-nh-lane-walk is-clear",
    attr: { "aria-label": model.text },
  });
  const headerEl = card.createDiv({ cls: "bob-nh-notice-header" });
  const iconEl = headerEl.createSpan({ cls: "bob-nh-notice-icon" });
  try {
    applyIcon(iconEl, "check-circle-2");
  } catch (error) {
    // Icon is best-effort.
  }
  headerEl.createSpan({ cls: "bob-nh-notice-level", text: "Lanes clear" });
  if (model && model.hasToday === true) {
    card.createDiv({
      cls: "bob-nh-lane-walk-title",
      text: "Every Pending and Next task is on today's plan",
    });
    const chipsEl = card.createDiv({ cls: "bob-nh-notice-chips" });
    chipsEl.createSpan({
      cls: "bob-nh-notice-chip",
      text: `TODAY ${model.today}`,
    });
  } else {
    card.createDiv({
      cls: "bob-nh-lane-walk-title",
      text: "No Pending or Next tasks",
    });
  }
  return card;
}

function showLaneWalkNotice(plugin, model) {
  const fallbackText =
    model && typeof model.text === "string" ? model.text : String(model || "");
  const showText = (text) => {
    try {
      new Notice(String(text));
    } catch (error) {
      // Notice is best-effort in tests.
    }
  };
  try {
    try {
      if (
        plugin &&
        plugin.laneWalkNotice &&
        typeof plugin.laneWalkNotice.hide === "function"
      ) {
        plugin.laneWalkNotice.hide();
      }
    } catch (error) {
      // Replacing the previous notice is best-effort.
    }
    if (plugin) {
      plugin.laneWalkNotice = null;
    }
    if (typeof document === "undefined") {
      showText(fallbackText);
      return;
    }
    const fragment = document.createDocumentFragment();
    if (!fragment || typeof fragment.createDiv !== "function") {
      showText(fallbackText);
      return;
    }
    if (model && model.empty === true) {
      renderLaneWalkEmptyFragment(model, fragment);
    } else {
      renderLaneWalkNoticeFragment(model, fragment);
    }
    const notice = new Notice(fragment);
    if (plugin) {
      plugin.laneWalkNotice = notice;
    }
  } catch (error) {
    showText(fallbackText);
  }
}
