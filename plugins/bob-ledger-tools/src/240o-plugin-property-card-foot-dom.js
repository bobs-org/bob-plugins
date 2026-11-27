// Shared property-card foot row and properties drawer (bob-cli-pf drawer-record).
// Pure DOM kit: the foot follows the nav rail, outside the collapsible body.
// The drawer builds its body only when opened. Painting never spawns bob and
// never writes the vault; view navigation stays distinct from vault mutation.
//
// spec for propertyCardFootBuildEl(doc, spec):
//   { path, disclosureId, open, inventory, stamp,
//     handlers: { onToggle(path, nextOpen), jumpYaml(key, line),
//                 jumpRecovery(), openPath(target, event),
//                 hoverLink(event, node, linktext), searchTag(tag, event),
//                 openNested(key, event), onOpenEditor(key) (only when the
//                 editor hook is registered), onAddProperty(), onEditAll() } }
const PROPERTY_CARD_FOOT_CLASS = "bob-property-card-foot";
const PROPERTY_CARD_FOOT_DRAWER_CLASS = "bob-property-card-foot-drawer";
const PROPERTY_CARD_FOOT_WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;
const PROPERTY_CARD_FOOT_SAFE_URL_RE = /^(https?:)\/\//i;
const PROPERTY_CARD_FOOT_TAG_KEYS_RE = /^tags?$/i;
const PROPERTY_CARD_FOOT_TAG_TEXT_RE = /^#[^\s#][^\s]*$/;
const PROPERTY_CARD_FOOT_LIST_PREVIEW_LIMIT = 6;

function propertyCardFootText(value) {
  return value === null || value === undefined ? "" : String(value);
}

// Shared `y` row jump, generalized from the record sheet's
// recordSheetBindYamlJump. The handler sees (key, line); line is the exact
// 1-based source line when the inventory knows it, else null.
function propertyCardFootBindYamlJump(node, handler, key, line) {
  if (!node || typeof node.addEventListener !== "function") return;
  if (typeof handler !== "function" || !key) return;
  node.setAttribute("tabindex", "0");
  node.addEventListener("keydown", (event) => {
    if (!event) return;
    if (event.isComposing || event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const keyName = event.key || "";
    if (keyName !== "y" && keyName !== "Y") return;
    try { event.preventDefault?.(); } catch (_) {}
    try { handler(key, Number.isInteger(line) && line > 0 ? line : null); } catch (_) {}
  });
}

function propertyCardFootReducedMotion() {
  try {
    if (typeof matchMedia === "function") {
      return matchMedia("(prefers-reduced-motion: reduce)").matches === true;
    }
  } catch (_) {}
  return false;
}

// Scroll an expanded foot into view without moving the cursor. Collapse
// never scrolls; callers only invoke this on expand.
function propertyCardFootReveal(footEl) {
  try {
    if (!footEl || typeof footEl.scrollIntoView !== "function") return false;
    if (propertyCardFootReducedMotion()) {
      footEl.scrollIntoView({ block: "nearest" });
    } else {
      footEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    return true;
  } catch (_) {
    return false;
  }
}

function propertyCardFootParseWikilink(raw) {
  const text = propertyCardFootText(raw).trim();
  if (!text) return null;
  const inner = text.startsWith("[[") && text.endsWith("]]") ? text.slice(2, -2) : text;
  if (!inner || inner.includes("[[") || inner.includes("\n")) return null;
  const pipe = inner.indexOf("|");
  const targetPart = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : "";
  if (!targetPart) return null;
  return {
    raw: text.startsWith("[[") ? text : `[[${inner}]]`,
    target: targetPart,
    alias,
    complete: text.startsWith("[[") && text.endsWith("]]"),
  };
}

function propertyCardFootSafeUrl(value) {
  const text = propertyCardFootText(value).trim();
  if (!text || !PROPERTY_CARD_FOOT_SAFE_URL_RE.test(text)) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch (_) {
    return null;
  }
}

function propertyCardFootIsTag(key, text) {
  if (PROPERTY_CARD_FOOT_TAG_KEYS_RE.test(String(key || "").trim())) return true;
  return PROPERTY_CARD_FOOT_TAG_TEXT_RE.test(String(text || "").trim());
}

function propertyCardFootCompactValue(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "invalid date";
    try {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    } catch (_) {
      return String(value);
    }
  }
  if (Array.isArray(value)) return value.map((item) => propertyCardFootCompactValue(item)).join(", ");
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

// Accessible value text for one inventory row. Mirrors the drawer's visible
// text so tests and aria-labels agree.
function propertyCardFootRowText(row) {
  if (!row || typeof row !== "object") return "";
  switch (row.valueState) {
    case "pending": return "…";
    case "absent": return "—";
    case "null": return "—";
    case "empty-string": return "empty";
    case "empty-list": return "empty list";
    case "true": return "✓";
    case "false": return "✗";
    case "invalid-date": return "invalid date";
    case "date":
      return row.value instanceof Date && !Number.isNaN(row.value.getTime())
        ? propertyCardFootCompactValue(row.value)
        : propertyCardFootCompactValue(row.value);
    case "map": {
      const size = row.value && typeof row.value === "object" && !Array.isArray(row.value)
        ? Object.keys(row.value).length
        : null;
      return Number.isInteger(size) ? `map · ${size} ${size === 1 ? "field" : "fields"}` : "map";
    }
    default:
      return propertyCardFootCompactValue(row.value);
  }
}

// Lint summary for the foot chip. Causes: invalid created, unparseable or
// unclosed frontmatter, duplicate keys, and (when the caller carries them)
// report-backed contract issues. The chip never opens the drawer; with a
// first setting and an opener it jumps to =+ instead of toggling anything.
function propertyCardFootLint(spec = {}) {
  const kinds = [];
  const inventory = spec.inventory && typeof spec.inventory === "object" ? spec.inventory : null;
  const stamp = spec.stamp && typeof spec.stamp === "object" ? spec.stamp : null;
  if (stamp && stamp.state === "invalid") kinds.push("invalid created");
  if (inventory) {
    if (inventory.state === "invalid") kinds.push("frontmatter doesn't parse");
    else if (inventory.state === "unclosed") kinds.push("frontmatter is unclosed");
    for (const issue of Array.isArray(inventory.issues) ? inventory.issues : []) {
      if (issue && (issue.kind === "duplicate" || issue.kind === "duplicate-key") && issue.key) {
        kinds.push(`duplicate key: ${issue.key}`);
      }
    }
  }
  const contract = [];
  if (Array.isArray(spec.contractIssues)) {
    for (const issue of spec.contractIssues) {
      if (!issue || typeof issue !== "object") continue;
      const message = typeof issue.message === "string" ? issue.message.trim() : "";
      const code = typeof issue.code === "string" ? issue.code.trim() : "";
      if (message) contract.push({ code, message });
    }
  }
  for (const issue of contract) kinds.push(issue.message);
  let firstSetting = "";
  if (contract.length) {
    try {
      if (typeof spec.firstSetting === "string" && spec.firstSetting.trim()) {
        firstSetting = spec.firstSetting.trim();
      } else if (Array.isArray(spec.contractIssues)) {
        const named = spec.contractIssues.find((issue) => issue && typeof issue.setting === "string" && issue.setting.trim());
        firstSetting = named ? named.setting.trim() : "";
      }
    } catch (_) {
      firstSetting = "";
    }
  }
  const count = kinds.length;
  return {
    count,
    kinds,
    contract: contract.length,
    firstSetting,
    tooltip: count ? `Properties need attention: ${kinds.join("; ")}` : "",
  };
}

function propertyCardFootBindLink(node, openPath, target, hoverLink) {
  propertyCardKitBindLink(node, (event) => {
    if (typeof openPath === "function") {
      try { openPath(target, event); } catch (_) {}
    }
  });
  if (typeof hoverLink === "function" && target) {
    try {
      node.addEventListener?.("mouseover", (event) => {
        try { hoverLink(event, node, target); } catch (_) {}
      });
    } catch (_) {}
  }
}

function propertyCardFootRenderWikilink(parent, doc, display, link, handlers) {
  const node = doc.createElement("a");
  node.setAttribute("class", "bob-property-card-foot-link internal-link");
  node.setAttribute("href", link.target || "");
  node.setAttribute("data-href", link.target || "");
  propertyCardKitAppendText(doc, node, display || link.target || "");
  propertyCardFootBindLink(node, handlers?.openPath, link.raw || link.target, handlers?.hoverLink);
  parent.appendChild(node);
  return node;
}

function propertyCardFootRenderUrl(parent, doc, href, text) {
  const node = doc.createElement("a");
  node.setAttribute("class", "bob-property-card-foot-url external-link");
  node.setAttribute("href", href);
  node.setAttribute("rel", "noopener noreferrer");
  node.setAttribute("target", "_blank");
  node.setAttribute("title", href);
  propertyCardKitAppendText(doc, node, text || href);
  parent.appendChild(node);
  return node;
}

function propertyCardFootRenderTag(parent, doc, tag, handlers) {
  const node = doc.createElement("button");
  node.setAttribute("type", "button");
  node.setAttribute("class", "bob-property-card-foot-tag");
  node.setAttribute("title", `Search ${tag}`);
  node.setAttribute("aria-label", `Search ${tag}`);
  propertyCardKitAppendText(doc, node, tag);
  node.addEventListener?.("click", (event) => {
    try { event.preventDefault?.(); } catch (_) {}
    if (typeof handlers?.searchTag === "function") {
      try { handlers.searchTag(tag, event); } catch (_) {}
    }
  });
  parent.appendChild(node);
  return node;
}

// One scalar item inside a value cell or list preview.
function propertyCardFootRenderScalar(parent, doc, key, raw, handlers) {
  const text = propertyCardFootText(raw);
  const href = propertyCardFootSafeUrl(text);
  if (href) {
    propertyCardFootRenderUrl(parent, doc, href, text);
    return;
  }
  const link = propertyCardFootParseWikilink(text);
  if (link && link.complete) {
    propertyCardFootRenderWikilink(parent, doc, link.alias || link.target, link, handlers);
    return;
  }
  if (propertyCardFootIsTag(key, text)) {
    propertyCardFootRenderTag(parent, doc, text, handlers);
    return;
  }
  propertyCardKitAppendText(doc, parent, text);
}

function propertyCardFootRenderValueCell(cell, doc, row, handlers) {
  const key = row.key;
  switch (row.valueState) {
    case "pending": {
      const pending = propertyCardKitSpan(doc, "bob-property-card-foot-pending", "…");
      pending.setAttribute("title", "Waiting for metadata");
      cell.appendChild(pending);
      return;
    }
    case "absent": {
      const absent = propertyCardKitSpan(doc, "bob-property-card-foot-empty", "—");
      absent.setAttribute("title", "Not in cache");
      cell.appendChild(absent);
      return;
    }
    case "null": {
      const empty = propertyCardKitSpan(doc, "bob-property-card-foot-empty", "—");
      cell.appendChild(empty);
      return;
    }
    case "empty-string": {
      const empty = propertyCardKitSpan(doc, "bob-property-card-foot-empty", "empty");
      cell.appendChild(empty);
      return;
    }
    case "empty-list": {
      const empty = propertyCardKitSpan(doc, "bob-property-card-foot-empty", "empty list");
      cell.appendChild(empty);
      return;
    }
    case "true": {
      const mark = propertyCardKitSpan(doc, "bob-property-card-foot-bool", "✓");
      mark.setAttribute("aria-label", "true");
      cell.appendChild(mark);
      return;
    }
    case "false": {
      const mark = propertyCardKitSpan(doc, "bob-property-card-foot-bool", "✗");
      mark.setAttribute("aria-label", "false");
      cell.appendChild(mark);
      return;
    }
    case "invalid-date": {
      const lint = propertyCardKitSpan(doc, "bob-property-card-foot-lint", "invalid date");
      cell.appendChild(lint);
      return;
    }
    case "map": {
      if (row.nested != null && typeof handlers?.openNested === "function") {
        const opener = doc.createElement("button");
        opener.setAttribute("type", "button");
        opener.setAttribute("class", "bob-property-card-foot-nested");
        const size = row.value && typeof row.value === "object" && !Array.isArray(row.value)
          ? Object.keys(row.value).length
          : null;
        const label = Number.isInteger(size) ? `${key} · ${size} ${size === 1 ? "field" : "fields"}  =` : `${key}  =`;
        propertyCardKitAppendText(doc, opener, label);
        opener.setAttribute("aria-label", `Open ${key} editor`);
        opener.addEventListener?.("click", (event) => {
          try { event.preventDefault?.(); } catch (_) {}
          try { handlers.openNested(key, event); } catch (_) {}
        });
        cell.appendChild(opener);
      } else {
        const summary = propertyCardKitSpan(doc, "bob-property-card-foot-map", propertyCardFootRowText(row));
        cell.appendChild(summary);
      }
      return;
    }
    case "list": {
      const items = Array.isArray(row.value) ? row.value : [];
      const shown = items.slice(0, PROPERTY_CARD_FOOT_LIST_PREVIEW_LIMIT);
      for (const item of shown) {
        const chip = propertyCardKitEl(doc, "span", "bob-property-card-foot-chip");
        propertyCardFootRenderScalar(chip, doc, key, item, handlers);
        cell.appendChild(chip);
      }
      if (items.length > shown.length) {
        cell.appendChild(propertyCardKitSpan(doc, "bob-property-card-foot-more", `+${items.length - shown.length}`));
      }
      return;
    }
    default: {
      const text = propertyCardFootCompactValue(row.value);
      const wrap = propertyCardKitEl(doc, "span", "bob-property-card-foot-scalar");
      wrap.setAttribute("title", text);
      propertyCardFootRenderScalar(wrap, doc, key, row.value, handlers);
      cell.appendChild(wrap);
    }
  }
}

function propertyCardFootAccessName(row) {
  const name = propertyCardFootText(row.key).trim() || "Property";
  const value = propertyCardFootRowText(row).trim();
  const occurrence = Number.isInteger(row.occurrence) && row.occurrence > 1 ? ` (occurrence ${row.occurrence})` : "";
  const lint = row.duplicate === true ? ", duplicate key" : "";
  return value ? `${name}${occurrence}: ${value}${lint}` : `${name}${occurrence}${lint}`;
}

// One inventory row: key, value, where-mark. Focusable; `y` jumps to the
// exact source line when the inventory knows it.
function propertyCardFootRenderRow(list, doc, row, handlers) {
  const wrap = propertyCardKitEl(doc, "div", row.duplicate === true
    ? "bob-property-card-foot-row is-duplicate"
    : "bob-property-card-foot-row");
  wrap.setAttribute("data-property-key", row.key);
  if (Number.isInteger(row.occurrence)) wrap.setAttribute("data-occurrence", String(row.occurrence));
  if (Number.isInteger(row.line) && row.line > 0) wrap.setAttribute("data-line", String(row.line));
  wrap.setAttribute("aria-label", propertyCardFootAccessName(row));
  propertyCardFootBindYamlJump(wrap, handlers?.jumpYaml, row.key, row.line);
  const openEditor = typeof handlers?.onOpenEditor === "function" ? handlers.onOpenEditor : null;
  const keyCell = propertyCardKitEl(doc, "dt", "bob-property-card-foot-key");
  if (openEditor) {
    const keyButton = doc.createElement("button");
    keyButton.setAttribute("type", "button");
    keyButton.setAttribute("class", "bob-property-card-foot-key-button");
    keyButton.setAttribute("aria-label", `Edit ${row.key}`);
    propertyCardKitAppendText(doc, keyButton, row.key);
    keyButton.addEventListener?.("click", (event) => {
      try { event.preventDefault?.(); } catch (_) {}
      try { openEditor(row.key); } catch (_) {}
    });
    keyButton.addEventListener?.("keydown", (event) => {
      if (!event || event.isComposing || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== "Enter") return;
      try { event.preventDefault?.(); } catch (_) {}
      try { openEditor(row.key); } catch (_) {}
    });
    keyCell.appendChild(keyButton);
  } else {
    propertyCardKitAppendText(doc, keyCell, row.key);
  }
  wrap.appendChild(keyCell);
  const valueCell = propertyCardKitEl(doc, "dd", "bob-property-card-foot-value");
  propertyCardFootRenderValueCell(valueCell, doc, row, handlers);
  wrap.appendChild(valueCell);
  if (row.mark) {
    const mark = propertyCardKitSpan(doc, "bob-property-card-foot-mark", String(row.mark));
    wrap.appendChild(mark);
  } else if (row.legacy) {
    wrap.appendChild(propertyCardKitSpan(doc, "bob-property-card-foot-legacy", "legacy"));
  }
  if (row.duplicate === true) {
    wrap.appendChild(propertyCardKitSpan(doc, "bob-property-card-foot-lint", "duplicate key"));
  }
  list.appendChild(wrap);
  return wrap;
}

function propertyCardFootRenderRecovery(drawerBody, doc, spec) {
  const handlers = spec.handlers || {};
  const recovery = doc.createElement("button");
  recovery.setAttribute("type", "button");
  recovery.setAttribute("class", "bob-property-card-foot-recovery");
  propertyCardKitAppendText(doc, recovery, "Frontmatter doesn't parse — y opens YAML");
  recovery.addEventListener?.("click", (event) => {
    try { event.preventDefault?.(); } catch (_) {}
    try { handlers.jumpRecovery?.(); } catch (_) {}
  });
  recovery.addEventListener?.("keydown", (event) => {
    if (!event || event.isComposing || event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const keyName = event.key || "";
    if (keyName !== "y" && keyName !== "Y" && keyName !== "Enter" && keyName !== " ") return;
    try { event.preventDefault?.(); } catch (_) {}
    try { handlers.jumpRecovery?.(); } catch (_) {}
  });
  try { recovery.setAttribute("tabindex", "0"); } catch (_) {}
  drawerBody.appendChild(recovery);
}

// Fill an open drawer body from the inventory: loose rows, then "On this
// card", then the initially folded "Managed · N" sub-fold.
function propertyCardFootRenderDrawer(doc, drawerBody, spec) {
  try {
    if (!propertyCardKitDocOk(doc) || !drawerBody) return false;
    const inventory = spec.inventory && typeof spec.inventory === "object" ? spec.inventory : null;
    const handlers = spec.handlers || {};
    if (!inventory || inventory.state === "invalid" || inventory.state === "unclosed") {
      propertyCardFootRenderRecovery(drawerBody, doc, spec);
      return true;
    }
    const groups = Array.isArray(inventory.groups) ? inventory.groups : [];
    for (const group of groups) {
      const rows = Array.isArray(group?.rows) ? group.rows : [];
      if (!rows.length) continue;
      if (group.id === "managed") {
        const fold = propertyCardKitEl(doc, "div", "bob-property-card-foot-managed");
        const toggle = doc.createElement("button");
        toggle.setAttribute("type", "button");
        toggle.setAttribute("class", "bob-property-card-foot-managed-toggle");
        toggle.setAttribute("aria-expanded", "false");
        propertyCardKitAppendText(doc, toggle, `▸ Managed · ${rows.length}`);
        const managedBody = propertyCardKitEl(doc, "div", "bob-property-card-foot-managed-body");
        managedBody.setAttribute("hidden", "");
        toggle.addEventListener?.("click", (event) => {
          try { event.preventDefault?.(); } catch (_) {}
          const willOpen = managedBody.hasAttribute?.("hidden") === true;
          if (willOpen) managedBody.removeAttribute?.("hidden");
          else managedBody.setAttribute?.("hidden", "");
          toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
          const label = toggle.childNodes?.[0];
          if (label && label.nodeType === 3) label.textContent = `${willOpen ? "▾" : "▸"} Managed · ${rows.length}`;
          else propertyCardKitAppendText(doc, toggle, "");
        });
        fold.appendChild(toggle);
        const list = propertyCardKitEl(doc, "dl", "bob-property-card-foot-list");
        for (const row of rows) propertyCardFootRenderRow(list, doc, row, handlers);
        managedBody.appendChild(list);
        fold.appendChild(managedBody);
        drawerBody.appendChild(fold);
        continue;
      }
      if (group.id === "card") {
        drawerBody.appendChild(propertyCardKitSpan(doc, "bob-property-card-foot-group", "On this card"));
      }
      const list = propertyCardKitEl(doc, "dl", "bob-property-card-foot-list");
      for (const row of rows) propertyCardFootRenderRow(list, doc, row, handlers);
      drawerBody.appendChild(list);
    }
    try {
      const openEditor = handlers && typeof handlers.onOpenEditor === "function" ? handlers.onOpenEditor : null;
      if (openEditor) {
        const actions = propertyCardKitEl(doc, "div", "bob-property-card-foot-actions");
        const add = doc.createElement("button");
        add.setAttribute("type", "button");
        add.setAttribute("class", "bob-property-card-foot-add");
        add.setAttribute("data-property-foot-action", "add");
        add.setAttribute("aria-label", "Add property");
        propertyCardKitAppendText(doc, add, "＋ Add property");
        add.addEventListener?.("click", (event) => {
          try { event.preventDefault?.(); } catch (_) {}
          try {
            if (handlers && typeof handlers.onAddProperty === "function") handlers.onAddProperty();
            else openEditor();
          } catch (_) {}
        });
        actions.appendChild(add);
        const all = doc.createElement("button");
        all.setAttribute("type", "button");
        all.setAttribute("class", "bob-property-card-foot-edit-all");
        all.setAttribute("data-property-foot-action", "edit-all");
        all.setAttribute("aria-label", "Edit all properties");
        propertyCardKitAppendText(doc, all, "✎ Edit all (+)");
        all.addEventListener?.("click", (event) => {
          try { event.preventDefault?.(); } catch (_) {}
          try {
            if (handlers && typeof handlers.onEditAll === "function") handlers.onEditAll();
            else openEditor();
          } catch (_) {}
        });
        actions.appendChild(all);
        drawerBody.appendChild(actions);
      }
    } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

// The foot is the card's Properties cabinet: one cabinet header over a drawer
// shell. The drawer body is built only when open; closed drawers keep an empty
// shell for aria-controls.
function propertyCardFootBuildEl(doc, spec = {}) {
  try {
    if (!propertyCardKitDocOk(doc)) return null;
    const options = spec && typeof spec === "object" ? spec : {};
    return propertyCardFootBuildCabinetEl(doc, options);
  } catch (_) {
    return null;
  }
}
