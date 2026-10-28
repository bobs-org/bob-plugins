// Lane-walk toast: rich `.bob-nh-notice` card plus the plain-text
// fallback. Replaces the previous lane-walk notice instead of stacking.
function renderLaneWalkNoticeFragment(model, root) {
  const lane = normalizeLaneWalkLane(model && model.lane) || "pending";
  const card = root.createDiv({
    cls: `bob-nh-notice bob-nh-lane-walk is-${lane}`,
    attr: { "aria-label": model.text },
  });
  const headerEl = card.createDiv({ cls: "bob-nh-notice-header" });
  const boxOpts = {
    cls:
      lane === "ready"
        ? "bob-nh-lane-walk-box is-empty"
        : "bob-nh-lane-walk-box",
    attr: { "aria-hidden": "true" },
  };
  if (lane !== "ready") {
    boxOpts.text = lane === "next" ? "*" : "/";
  }
  headerEl.createSpan(boxOpts);
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
    const laneCounts = { pending: 0, next: 0, ready: 0 };
    for (const item of lanes) {
      const itemLane = normalizeLaneWalkLane(item) || "pending";
      laneCounts[itemLane] += 1;
    }
    for (const itemLane of LANE_WALK_LANES) {
      const count = laneCounts[itemLane];
      if (count <= 0) {
        continue;
      }
      const current = itemLane === lane;
      const seg = bar.createDiv({
        cls: `bob-nh-lane-walk-bar-${itemLane}${current ? " is-current-lane" : ""}`,
      });
      try {
        seg.setAttribute("style", `flex-grow: ${count}`);
      } catch (error) {
        // Inline flex is best-effort.
      }
      if (current) {
        const caret = seg.createDiv({ cls: "bob-nh-lane-walk-caret" });
        try {
          const denom =
            Number.isInteger(model.laneTotal) && model.laneTotal > 0
              ? model.laneTotal
              : count;
          const rank =
            Number.isInteger(model.laneRank) && model.laneRank >= 1
              ? model.laneRank
              : 1;
          const percent = ((rank - 0.5) / denom) * 100;
          caret.setAttribute("style", `left: ${percent}%`);
        } catch (error) {
          // Caret position is best-effort.
        }
      }
    }
  } else if (lanes && lanes.length > 0) {
    lanes.forEach((itemLaneRaw, index) => {
      const itemLane = normalizeLaneWalkLane(itemLaneRaw) || "pending";
      const isCurrent = index === model.rank - 1;
      const inCurrentLane = itemLane === lane;
      const cls = `bob-nh-lane-walk-dot is-${itemLane}${isCurrent ? " is-current" : ""}${inCurrentLane ? " is-current-lane" : ""}`;
      railEl.createSpan({ cls, attr: { "aria-hidden": "true" } });
      if (index < lanes.length - 1) {
        const nextLane = normalizeLaneWalkLane(lanes[index + 1]) || "pending";
        if (nextLane !== itemLane) {
          railEl.createSpan({
            cls: "bob-nh-lane-walk-gap",
            attr: { "aria-hidden": "true" },
          });
        }
      }
    });
  } else {
    railEl.createSpan({
      cls: `bob-nh-lane-walk-dot is-${lane} is-current is-current-lane`,
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
  hintEl.createSpan({
    text: ` ${laneWalkHintAction(lane)}`,
  });
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
  const title =
    model && typeof model.title === "string" && model.title
      ? model.title
      : model && model.hasReview
        ? "Ready tasks are waiting in review"
        : model && model.hasToday
          ? "Every Pending, Next, and Ready task is on today's plan"
          : "No Pending, Next, or Ready tasks";
  card.createDiv({
    cls: "bob-nh-lane-walk-title",
    text: title,
  });
  if (model && (model.hasReview === true || model.hasToday === true)) {
    const chipsEl = card.createDiv({ cls: "bob-nh-notice-chips" });
    if (model.hasReview === true) {
      chipsEl.createSpan({
        cls: "bob-nh-notice-chip is-info",
        text: `REVIEW ${model.review}`,
      });
    }
    if (model.hasToday === true) {
      chipsEl.createSpan({
        cls: "bob-nh-notice-chip",
        text: `TODAY ${model.today}`,
      });
    }
  }
  if (model && model.hasReview === true) {
    const hintEl = card.createDiv({ cls: "bob-nh-lane-walk-hint" });
    hintEl.createSpan({ cls: "bob-nh-lane-walk-key", text: "]s" });
    hintEl.createSpan({ text: " walks NEW and ROTTEN" });
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
