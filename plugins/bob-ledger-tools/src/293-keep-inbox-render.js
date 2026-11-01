// Keep inbox render (keep-indicator-view): DOM for the `bob-keep-inbox`
// status-bar item. Pure DOM helpers plus one paint entry point; no spawn,
// no vault. `setIcon` is captured from `obsidian` at load time. Never throws.

let KeepInboxObsidianSetIcon = null;
try {
  const obsidianMod = require("obsidian");
  KeepInboxObsidianSetIcon =
    obsidianMod && typeof obsidianMod.setIcon === "function"
      ? obsidianMod.setIcon
      : null;
} catch (error) {
  KeepInboxObsidianSetIcon = null;
}

function keepInboxSetText(node, text) {
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

function keepInboxSetAttr(node, name, value) {
  if (!node || !name) {
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

function keepInboxRemoveAttr(node, name) {
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

function keepInboxToggleClass(node, name, on) {
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

function keepInboxCreateChild(parent, tag, className) {
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

function keepInboxSetIcon(node, name) {
  if (!node || !name) {
    return;
  }
  try {
    if (KeepInboxObsidianSetIcon) {
      KeepInboxObsidianSetIcon(node, name);
      return;
    }
  } catch (error) {
    // Fall through to the data-icon marker below.
  }
  try {
    if (typeof node.setAttribute === "function") {
      node.setAttribute("data-icon", name);
    }
  } catch (error) {
    // Cosmetic.
  }
  try {
    if (!node.textContent) {
      node.textContent = "";
    }
  } catch (error) {
    // Cosmetic.
  }
}

function keepInboxApplyTooltip(node, text) {
  if (!node) {
    return;
  }
  const value = text == null ? "" : String(text);
  if (!value) {
    return;
  }
  try {
    const setter =
      typeof setTooltip === "function"
        ? setTooltip
        : typeof window !== "undefined" && typeof window.setTooltip === "function"
          ? window.setTooltip
          : null;
    if (setter) {
      setter(node, value, { placement: "top" });
      try {
        if (typeof node.removeAttribute === "function") {
          node.removeAttribute("title");
        } else if ("title" in node) {
          node.title = "";
        }
      } catch (error) {
        // Best-effort: never hold both tooltip and title.
      }
      return;
    }
  } catch (error) {
    // Fall through to title.
  }
  keepInboxSetAttr(node, "title", value);
}

function keepInboxEnsureDom(el) {
  if (!el) {
    return null;
  }
  if (el._bobKeepInboxParts && el._bobKeepInboxParts.keepButton) {
    return el._bobKeepInboxParts;
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
  const keepButton = keepInboxCreateChild(el, "button", "bob-keep-pill");
  if (!keepButton) {
    return null;
  }
  keepInboxSetAttr(keepButton, "type", "button");
  const keepIcon = keepInboxCreateChild(keepButton, "span", "bob-keep-pill-icon");
  const keepCount = keepInboxCreateChild(keepButton, "span", "bob-keep-pill-count");
  const connector = keepInboxCreateChild(el, "span", "bob-keep-connector");
  let connectorIcon = null;
  if (connector) {
    connectorIcon = keepInboxCreateChild(connector, "span", "bob-keep-connector-icon");
    keepInboxSetAttr(connector, "aria-hidden", "true");
  }
  const inboxButton = keepInboxCreateChild(el, "button", "bob-keep-inbox-btn");
  if (!inboxButton) {
    return null;
  }
  keepInboxSetAttr(inboxButton, "type", "button");
  const inboxIcon = keepInboxCreateChild(inboxButton, "span", "bob-keep-inbox-icon");
  const inboxCount = keepInboxCreateChild(inboxButton, "span", "bob-keep-inbox-count");
  const parts = {
    keepButton,
    keepIcon,
    keepCount,
    connector,
    connectorIcon,
    inboxButton,
    inboxIcon,
    inboxCount,
  };
  el._bobKeepInboxParts = parts;
  // Recompute tooltips on hover so ages stay current without a repaint.
  try {
    const refresh = () => {
      try {
        const view = el._bobKeepInboxView;
        if (view && view.visible) {
          keepInboxApplyTooltip(keepButton, view.keep.tooltip);
          keepInboxApplyTooltip(inboxButton, view.inbox.tooltip);
        }
      } catch (error) {
        // Hover tooltips are best-effort.
      }
    };
    if (typeof keepButton.addEventListener === "function") {
      keepButton.addEventListener("mouseenter", refresh);
    }
    if (typeof inboxButton.addEventListener === "function") {
      inboxButton.addEventListener("mouseenter", refresh);
    }
  } catch (error) {
    // Listeners are best-effort.
  }
  return parts;
}

function keepInboxSetOmitted(node, omitted) {
  keepInboxToggleClass(node, "bob-keep-omit", omitted);
  if (!node) {
    return;
  }
  if (omitted) {
    keepInboxSetAttr(node, "hidden", "hidden");
  } else if (typeof node.removeAttribute === "function") {
    try {
      node.removeAttribute("hidden");
    } catch (error) {
      // Cosmetic.
    }
  }
}

// Paint the status-bar item. Skips unchanged frames by paint key (like the
// review footer); the one-minute repaint is free. Never throws.
function keepInboxPaint(el, view) {
  if (!el) {
    return null;
  }
  const safe = view && typeof view === "object" ? view : null;
  if (!safe || !safe.visible) {
    keepInboxToggleClass(el, "bob-keep-inbox-hidden", true);
    keepInboxSetAttr(el, "aria-hidden", "true");
    try {
      el._bobKeepInboxView = safe;
      el._bobKeepInboxPaintKey = (safe && safe.paintKey) || "hidden";
    } catch (error) {
      // Cache is best-effort.
    }
    return el._bobKeepInboxParts || null;
  }
  if (el._bobKeepInboxPaintKey === safe.paintKey && el._bobKeepInboxParts) {
    return el._bobKeepInboxParts;
  }
  const parts = keepInboxEnsureDom(el);
  if (!parts) {
    return null;
  }
  keepInboxToggleClass(el, "bob-keep-inbox-hidden", false);
  keepInboxSetAttr(el, "aria-hidden", "false");
  // Keep segment.
  const keep = safe.keep || {};
  keepInboxSetOmitted(parts.keepButton, !keep.visible);
  keepInboxSetAttr(el, "data-keep-tone", keep.visible ? keep.tone || "" : "hidden");
  if (parts.keepButton) {
    keepInboxSetAttr(parts.keepButton, "data-keep-tone", keep.tone || "");
    try {
      parts.keepButton.disabled = !keep.visible;
      parts.keepButton.tabIndex = keep.visible ? 0 : -1;
    } catch (error) {
      // Focus management is best-effort.
    }
  }
  if (keep.visible) {
    keepInboxSetIcon(parts.keepIcon, keep.icon || "lightbulb");
    keepInboxSetText(parts.keepCount, keep.text || "");
    keepInboxSetOmitted(parts.keepCount, !keep.text);
    keepInboxSetAttr(parts.keepButton, "aria-label", keep.aria || keep.tooltip || "");
    keepInboxApplyTooltip(parts.keepButton, keep.tooltip || "");
  } else {
    keepInboxSetText(parts.keepCount, "");
    keepInboxRemoveAttr(parts.keepButton, "aria-label");
  }
  // Connector shows only when both segments show.
  const showConnector = Boolean(
    safe.connector && safe.connector.visible && keep.visible && safe.inbox && safe.inbox.visible,
  );
  keepInboxSetOmitted(parts.connector, !showConnector);
  if (showConnector && parts.connectorIcon) {
    keepInboxSetIcon(parts.connectorIcon, "chevron-right");
  }
  // Inbox segment.
  const inbox = safe.inbox || {};
  keepInboxSetOmitted(parts.inboxButton, !inbox.visible);
  keepInboxSetAttr(el, "data-inbox-tone", inbox.visible ? inbox.tone || "" : "hidden");
  if (parts.inboxButton) {
    keepInboxSetAttr(parts.inboxButton, "data-inbox-tone", inbox.tone || "");
    try {
      parts.inboxButton.disabled = !inbox.visible;
      parts.inboxButton.tabIndex = inbox.visible ? 0 : -1;
    } catch (error) {
      // Focus management is best-effort.
    }
  }
  if (inbox.visible) {
    keepInboxSetIcon(parts.inboxIcon, inbox.icon || "inbox");
    keepInboxSetText(parts.inboxCount, inbox.text || "");
    keepInboxSetAttr(parts.inboxButton, "aria-label", inbox.aria || inbox.tooltip || "");
    keepInboxApplyTooltip(parts.inboxButton, inbox.tooltip || "");
  } else {
    keepInboxSetText(parts.inboxCount, "");
    keepInboxRemoveAttr(parts.inboxButton, "aria-label");
  }
  try {
    el._bobKeepInboxView = safe;
    el._bobKeepInboxPaintKey = safe.paintKey;
  } catch (error) {
    // Cache is best-effort.
  }
  return parts;
}
