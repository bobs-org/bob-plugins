function freshnessFooterSetText(node, text) {
  if (!node) {
    return;
  }
  const value = text == null ? "" : String(text);
  try {
    if (typeof node.setText === "function") {
      node.setText(value);
    } else if ("textContent" in node) {
      node.textContent = value;
    }
  } catch (error) {
    // Cosmetic.
  }
}

function freshnessFooterSetAttr(node, name, value) {
  if (!node) {
    return;
  }
  try {
    if (typeof node.setAttribute === "function") {
      node.setAttribute(name, value);
    } else if (name === "title") {
      node.title = value;
    }
  } catch (error) {
    // Cosmetic.
  }
}

function freshnessFooterRemoveAttr(node, name) {
  if (!node || !name) {
    return;
  }
  try {
    if (typeof node.removeAttribute === "function") {
      node.removeAttribute(name);
    }
  } catch (error) {
    // Cosmetic.
  }
}

function freshnessFooterToggleClass(node, name, on) {
  if (!node || !name) {
    return;
  }
  try {
    if (node.classList && typeof node.classList.add === "function") {
      if (on) {
        node.classList.add(name);
      } else if (typeof node.classList.remove === "function") {
        node.classList.remove(name);
      }
      return;
    }
    if (typeof node.addClass === "function" && on) {
      node.addClass(name);
      return;
    }
    if (typeof node.removeClass === "function" && !on) {
      node.removeClass(name);
    }
  } catch (error) {
    // Cosmetic.
  }
}

function freshnessFooterCreateChild(parent, tag, className) {
  if (!parent) {
    return null;
  }
  try {
    if (typeof parent.createEl === "function") {
      return parent.createEl(tag, { cls: className });
    }
  } catch (error) {
    // Fall through to DOM.
  }
  try {
    const doc =
      parent.ownerDocument ||
      (typeof document !== "undefined" ? document : null);
    if (doc && typeof doc.createElement === "function") {
      const node = doc.createElement(tag);
      if (className) {
        node.className = className;
      }
      if (typeof parent.appendChild === "function") {
        parent.appendChild(node);
      }
      return node;
    }
  } catch (error) {
    return null;
  }
  return null;
}

function freshnessFooterEnsureDom(el) {
  if (!el) {
    return null;
  }
  if (el._bobFreshnessParts && el._bobFreshnessParts.button) {
    return el._bobFreshnessParts;
  }
  try {
    if (typeof el.empty === "function") {
      el.empty();
    } else if ("textContent" in el) {
      el.textContent = "";
    }
  } catch (error) {
    // Rebuild below.
  }
  const button = freshnessFooterCreateChild(el, "button", "bob-freshness-main");
  if (!button) {
    return null;
  }
  freshnessFooterSetAttr(button, "type", "button");
  const icon = freshnessFooterCreateChild(
    button,
    "span",
    "bob-freshness-icon",
  );
  freshnessFooterSetText(icon, "⟳");
  const due = freshnessFooterCreateChild(button, "span", "bob-freshness-due");
  const context = freshnessFooterCreateChild(
    el,
    "span",
    "bob-freshness-context",
  );
  const detail = freshnessFooterCreateChild(
    el,
    "span",
    "bob-freshness-detail",
  );
  const hint = freshnessFooterCreateChild(el, "span", "bob-freshness-hint");
  const groups = freshnessFooterCreateChild(
    el,
    "span",
    "bob-freshness-groups",
  );
  const meter = freshnessFooterCreateChild(el, "span", "bob-freshness-meter");
  const parts = { button, icon, due, context, detail, hint, groups, meter };
  el._bobFreshnessParts = parts;
  return parts;
}

function freshnessFooterSetOmitted(node, omitted) {
  freshnessFooterToggleClass(node, "bob-freshness-omit", omitted);
  if (omitted) {
    freshnessFooterSetAttr(node, "hidden", "hidden");
  } else if (node && typeof node.removeAttribute === "function") {
    try {
      node.removeAttribute("hidden");
    } catch (error) {
      // Cosmetic.
    }
  }
}

function freshnessFooterPaintGroups(container, groups) {
  if (!container) {
    return;
  }
  try {
    if (typeof container.empty === "function") {
      container.empty();
    } else if ("textContent" in container) {
      container.textContent = "";
    }
    const nodes = [];
    for (const group of Array.isArray(groups) ? groups : []) {
      const className = group && group.boundary
        ? "bob-freshness-group bob-freshness-group-boundary"
        : "bob-freshness-group";
      const token = freshnessFooterCreateChild(container, "span", className);
      if (!token) {
        continue;
      }
      freshnessFooterSetAttr(token, "data-review-tier", group && group.key);
      const label = freshnessFooterCreateChild(
        token,
        "span",
        "bob-freshness-group-label",
      );
      freshnessFooterSetText(label, group && group.label);
      const count = freshnessFooterCreateChild(
        token,
        "span",
        "bob-freshness-group-count",
      );
      freshnessFooterSetText(count, group && group.count);
      nodes.push(token);
    }
    const more = freshnessFooterCreateChild(
      container,
      "span",
      "bob-freshness-groups-more",
    );
    freshnessFooterSetText(more, "…");
    freshnessFooterSetAttr(more, "aria-hidden", "true");
    freshnessFooterSetOmitted(more, true);
    container._bobFreshnessGroupNodes = nodes;
    container._bobFreshnessGroupsMore = more;
  } catch (error) {
    // Cosmetic.
  }
}

function freshnessFooterPaintHint(node, view) {
  if (!node) {
    return;
  }
  try {
    const answer =
      view && typeof view === "object" && view.answer && typeof view.answer === "object"
        ? view.answer
        : null;
    const hasAnswer =
      answer !== null &&
      typeof answer.key === "string" &&
      Array.isArray(answer.segments);
    if (hasAnswer) {
      if (node._bobAnswerKey !== answer.key) {
        try {
          if (typeof node.empty === "function") {
            node.empty();
          } else if ("textContent" in node) {
            node.textContent = "";
          }
          const chip = freshnessFooterCreateChild(node, "span", "bob-freshness-answer");
          if (!chip) {
            throw new Error("no chip host");
          }
          freshnessFooterSetAttr(chip, "data-review-tier", answer.tier);
          freshnessFooterSetAttr(chip, "data-answer-kind", answer.kind);
          freshnessFooterSetAttr(chip, "title", answer.title || answer.text);
          const segments = answer.segments;
          // The key keycap and its trailing space live directly under the
          // chip, in creation order; every other segment lives inside one
          // action wrap. Spaces stay spans (the fake DOM has no bare text
          // nodes); the flex gap supplies the visible separation.
          let startIndex = 0;
          if (segments.length > 0 && segments[0] && segments[0].role === "key") {
            const keyNode = freshnessFooterCreateChild(
              chip,
              "kbd",
              "bob-freshness-answer-key",
            );
            if (!keyNode) {
              throw new Error("no key host");
            }
            freshnessFooterSetText(keyNode, segments[0].text);
            startIndex = 1;
            if (segments[1] && segments[1].role === "space") {
              const gap = freshnessFooterCreateChild(
                chip,
                "span",
                "bob-freshness-answer-space",
              );
              if (!gap) {
                throw new Error("no gap host");
              }
              freshnessFooterSetText(gap, segments[1].text);
              startIndex = 2;
            }
          }
          const actionWrap = freshnessFooterCreateChild(
            chip,
            "span",
            "bob-freshness-answer-action",
          );
          if (!actionWrap) {
            throw new Error("no action host");
          }
          for (let index = startIndex; index < segments.length; index += 1) {
            const entry = segments[index];
            if (!entry || typeof entry.text !== "string") {
              throw new Error("bad segment");
            }
            const child = freshnessFooterCreateChild(
              actionWrap,
              "span",
              "bob-freshness-answer-" + entry.role,
            );
            if (!child) {
              throw new Error("no segment host");
            }
            freshnessFooterSetText(child, entry.text);
          }
          freshnessFooterToggleClass(node, "bob-freshness-hint-answer", true);
          node._bobAnswerKey = answer.key;
        } catch (error) {
          try {
            if (typeof node.empty === "function") {
              node.empty();
            } else if ("textContent" in node) {
              node.textContent = "";
            }
          } catch (ignored) {
            // Fall through to plain text.
          }
          freshnessFooterToggleClass(node, "bob-freshness-hint-answer", false);
          try {
            node._bobAnswerKey = undefined;
          } catch (ignored) {
            // Best-effort.
          }
          freshnessFooterSetText(node, view ? view.hintText : "");
        }
      } else {
        freshnessFooterToggleClass(node, "bob-freshness-hint-answer", true);
      }
      return;
    }
    if (node._bobAnswerKey !== undefined && node._bobAnswerKey !== null) {
      try {
        if (typeof node.empty === "function") {
          node.empty();
        } else if ("textContent" in node) {
          node.textContent = "";
        }
      } catch (error) {
        // Best-effort.
      }
      freshnessFooterToggleClass(node, "bob-freshness-hint-answer", false);
      try {
        node._bobAnswerKey = undefined;
      } catch (error) {
        // Best-effort.
      }
    } else {
      freshnessFooterToggleClass(node, "bob-freshness-hint-answer", false);
    }
    freshnessFooterSetText(node, view ? view.hintText : "");
  } catch (error) {
    try {
      freshnessFooterSetText(node, view ? view.hintText : "");
    } catch (ignored) {
      // Cosmetic.
    }
  }
}

// Shed groups from the end, shorten stage detail, then hide detail,
// shortcut hint, and upkeep meter. With an answer chip the meter sheds
// before the hint, so the chip outlasts it. The current tier stays visible.
function freshnessFooterFit(el, parts, view) {
  const groupContainer = parts && parts.groups;
  const nodes = groupContainer && Array.isArray(groupContainer._bobFreshnessGroupNodes)
    ? groupContainer._bobFreshnessGroupNodes
    : [];
  const hasGroups = Boolean(view && view.groupsText);
  const fallbackGroup = nodes.length === 0 && hasGroups;
  const total = fallbackGroup ? 1 : nodes.length;
  let shown = hasGroups ? total : 0;
  let detail = Boolean(view && view.detailText);
  let detailText = detail ? String(view.detailText) : "";
  const compactDetail =
    view && typeof view.detailCompactText === "string"
      ? view.detailCompactText
      : detailText;
  let hint = Boolean(view && view.hintText);
  let meter = Boolean(view && view.meterText);
  const apply = () => {
    freshnessFooterSetText(parts.detail, detailText);
    freshnessFooterSetOmitted(groupContainer, shown === 0);
    nodes.forEach((node, index) => {
      freshnessFooterSetOmitted(node, index >= shown);
    });
    freshnessFooterSetOmitted(
      groupContainer && groupContainer._bobFreshnessGroupsMore,
      !(shown > 0 && shown < total),
    );
    freshnessFooterSetOmitted(parts.detail, !detail);
    freshnessFooterSetOmitted(parts.hint, !hint);
    freshnessFooterSetOmitted(parts.meter, !meter);
  };
  const result = () => ({
    groups: shown > 0,
    groupsShown: shown,
    detail,
    hint,
    meter,
  });
  apply();
  let width = 0;
  try {
    width = Number(el.clientWidth);
  } catch (error) {
    return result();
  }
  if (!Number.isFinite(width) || width <= 0) {
    return result();
  }
  const overflows = () => {
    try {
      return Number(el.scrollWidth) > Number(el.clientWidth) + 1;
    } catch (error) {
      return false;
    }
  };
  while (overflows() && shown > 0) {
    shown -= 1;
    apply();
  }
  if (overflows() && detail && detailText !== compactDetail) {
    detailText = compactDetail;
    apply();
  }
  if (overflows() && detail) {
    detail = false;
    apply();
  }
  const answerChip = Boolean(view && view.answer);
  if (answerChip) {
    if (overflows() && meter) {
      meter = false;
      apply();
    }
    if (overflows() && hint) {
      hint = false;
      apply();
    }
  } else {
    if (overflows() && hint) {
      hint = false;
      apply();
    }
    if (overflows() && meter) {
      meter = false;
      apply();
    }
  }
  return result();
}

function freshnessFooterPaint(el, view) {
  if (!el) {
    return null;
  }
  const parts = freshnessFooterEnsureDom(el);
  if (!parts) {
    return null;
  }
  const visible = Boolean(view && view.visible);
  freshnessFooterToggleClass(el, "bob-freshness-hidden", !visible);
  freshnessFooterSetAttr(el, "aria-hidden", visible ? "false" : "true");
  const modes = [
    "bob-freshness-unavailable",
    "bob-freshness-new",
    "bob-freshness-due",
    "bob-freshness-clear",
    "bob-freshness-budget",
    "bob-freshness-hidden",
  ];
  const wanted = visible
    ? "bob-freshness-" + (view.mode || "due")
    : "bob-freshness-hidden";
  try {
    if (el.classList && typeof el.classList.add === "function") {
      for (const mode of modes) {
        if (mode === wanted || (mode === "bob-freshness-hidden" && !visible)) {
          el.classList.add(mode);
        } else if (typeof el.classList.remove === "function") {
          el.classList.remove(mode);
        }
      }
      el.classList.add("bob-freshness");
      if (!visible) {
        el.classList.add("bob-freshness-hidden");
      }
    }
  } catch (error) {
    // Classes are cosmetic.
  }
  if (parts.button) {
    try {
      parts.button.disabled = !visible;
      parts.button.tabIndex = visible ? 0 : -1;
    } catch (error) {
      // Focus management is best-effort.
    }
  }
  if (!visible) {
    freshnessFooterSetText(parts.due, "");
    freshnessFooterSetText(parts.context, "");
    freshnessFooterSetText(parts.detail, "");
    freshnessFooterPaintHint(parts.hint, view);
    freshnessFooterPaintGroups(parts.groups, []);
    freshnessFooterSetText(parts.meter, "");
    freshnessFooterRemoveAttr(parts.context, "data-review-tier");
    freshnessFooterRemoveAttr(parts.detail, "data-review-tier");
    freshnessFooterSetAttr(parts.button, "aria-label", "Review footer hidden");
    freshnessFooterSetAttr(el, "title", "");
    return parts;
  }
  freshnessFooterSetText(parts.due, view.dueText);
  freshnessFooterSetText(parts.context, view.contextText);
  freshnessFooterSetText(parts.detail, view.detailText);
  freshnessFooterPaintHint(parts.hint, view);
  freshnessFooterPaintGroups(parts.groups, view.groups);
  freshnessFooterSetText(parts.meter, view.meterText);
  freshnessFooterSetOmitted(parts.context, !view.contextText);
  freshnessFooterSetOmitted(parts.detail, !view.detailText);
  freshnessFooterSetOmitted(parts.hint, !view.hintText);
  freshnessFooterSetOmitted(parts.meter, !view.meterText);
  freshnessFooterToggleClass(
    parts.context,
    "bob-freshness-tier",
    Boolean(view.current),
  );
  if (
    view.current &&
    FRESHNESS_FOOTER_TIERS.includes(view.current.tier)
  ) {
    freshnessFooterSetAttr(
      parts.context,
      "data-review-tier",
      view.current.tier,
    );
  } else {
    freshnessFooterRemoveAttr(parts.context, "data-review-tier");
  }
  if (
    view.current &&
    view.current.stage &&
    FRESHNESS_FOOTER_TIERS.includes(view.current.tier)
  ) {
    freshnessFooterSetAttr(
      parts.detail,
      "data-review-tier",
      view.current.tier,
    );
  } else {
    freshnessFooterRemoveAttr(parts.detail, "data-review-tier");
  }
  freshnessFooterSetAttr(parts.button, "aria-label", view.ariaLabel || view.tooltip);
  freshnessFooterSetAttr(el, "title", view.tooltip);
  freshnessFooterSetAttr(parts.button, "title", view.tooltip);
  freshnessFooterFit(el, parts, view);
  return parts;
}
