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

// Shed groups from the end of the walk, then optional detail, shortcut
// hint, and upkeep meter. The due rank and current tier stay visible.
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
  let hint = Boolean(view && view.hintText);
  let meter = Boolean(view && view.meterText);
  const apply = () => {
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
  if (overflows() && detail) {
    detail = false;
    apply();
  }
  if (overflows() && hint) {
    hint = false;
    apply();
  }
  if (overflows() && meter) {
    meter = false;
    apply();
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
    freshnessFooterSetText(parts.hint, "");
    freshnessFooterPaintGroups(parts.groups, []);
    freshnessFooterSetText(parts.meter, "");
    freshnessFooterRemoveAttr(parts.context, "data-review-tier");
    freshnessFooterSetAttr(parts.button, "aria-label", "Review footer hidden");
    freshnessFooterSetAttr(el, "title", "");
    return parts;
  }
  freshnessFooterSetText(parts.due, view.dueText);
  freshnessFooterSetText(parts.context, view.contextText);
  freshnessFooterSetText(parts.detail, view.detailText);
  freshnessFooterSetText(parts.hint, view.hintText);
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
  freshnessFooterSetAttr(parts.button, "aria-label", view.ariaLabel || view.tooltip);
  freshnessFooterSetAttr(el, "title", view.tooltip);
  freshnessFooterSetAttr(parts.button, "title", view.tooltip);
  freshnessFooterFit(el, parts, view);
  return parts;
}
