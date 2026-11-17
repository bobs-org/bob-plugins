// Shared album/bank arrangement DOM helpers: scopes, loudness, pending
// bar text, delta badges, FLIP runner, gap badges, and live announcer.
// DOM-free math (arrangeGapHintLabels, arrangeFlipPlan) stays in the
// pure model fragment; this file only reads the DOM and formats text.
function schemaArrangeScopesFromAlbumModel(model) {
  const scopes = {};
  const fields = Array.isArray(model?.fields) ? model.fields : [];
  scopes.fields = fields.map((field) => String(field?.key || "")).filter(Boolean);
  for (const field of fields) {
    const key = String(field?.key || "");
    if (!key) continue;
    if (String(field?.kind || "") !== "choices") continue;
    const choices = Array.isArray(field?.choices) ? field.choices : [];
    scopes[`choices:${key}`] = choices.map((choice) => String(choice?.value ?? "")).filter(Boolean);
  }
  return scopes;
}

function schemaArrangeAlbumLabelFor(model, scope, id) {
  try {
    const fields = Array.isArray(model?.fields) ? model.fields : [];
    if (scope === "fields") {
      const field = fields.find((item) => String(item?.key || "") === String(id));
      return String(field?.label || field?.key || id);
    }
    if (scope && scope.startsWith("choices:")) {
      const fieldKey = scope.slice("choices:".length);
      const field = fields.find((item) => String(item?.key || "") === fieldKey);
      const choice = (Array.isArray(field?.choices) ? field.choices : [])
        .find((item) => String(item?.value ?? "") === String(id));
      const raw = String(choice?.label || choice?.value || id);
      const parts = typeof albumSchemaChoiceParts === "function"
        ? albumSchemaChoiceParts(raw)
        : { emoji: "", label: raw };
      return String(parts.label || raw);
    }
  } catch (_) {}
  return String(id);
}

function schemaArrangeAlbumScopeLabel(model, scope) {
  if (scope === "fields") return "field";
  if (scope && scope.startsWith("choices:")) {
    const fieldKey = scope.slice("choices:".length);
    const fields = Array.isArray(model?.fields) ? model.fields : [];
    const field = fields.find((item) => String(item?.key || "") === fieldKey);
    return String(field?.label || fieldKey || "choice");
  }
  return String(scope || "");
}

function schemaArrangeIsLoudAlbumReport(report) {
  try {
    if (!report || report.ok !== true) return { loud: false, reasons: [] };
    const reasons = [];
    const before = report.group_before ?? null;
    const after = report.group_after ?? null;
    if (before !== after) reasons.push("group");
    const perOp = Array.isArray(report.per_op) ? report.per_op : [];
    if (perOp.some((op) => Number.isInteger(op?.newly_invalid) && op.newly_invalid > 0)) {
      reasons.push("invalid");
    }
    if (Array.isArray(report.warnings) && report.warnings.length > 0) reasons.push("warnings");
    return { loud: reasons.length > 0, reasons };
  } catch (_) {
    return { loud: false, reasons: [] };
  }
}

function schemaArrangeDeltaBadge(delta) {
  const value = Number(delta);
  if (!Number.isInteger(value) || value === 0) return "";
  return value < 0 ? `↑${-value}` : `↓${value}`;
}

function schemaArrangePendingText(arrangement, model, options = {}) {
  try {
    if (!arrangement || typeof arrangement.summary !== "function") return "";
    const summary = arrangement.summary();
    if (!summary || !summary.dirty) return "";
    const count = Number(summary.moveCount || summary.count || 0);
    if (!count) return "";
    const noun = count === 1 ? "move" : "moves";
    let detail = "";
    const moved = Array.isArray(summary.movedIds) ? summary.movedIds : [];
    const labelFor = typeof options.labelFor === "function"
      ? options.labelFor
      : (scope, id) => schemaArrangeAlbumLabelFor(model, scope, id);
    const stepLabel = typeof options.stepLabel === "string" && options.stepLabel
      ? options.stepLabel
      : "u step back";
    if (count === 1 && moved.length === 1) {
      const entry = moved[0];
      const scope = typeof entry === "string" ? null : entry?.scope;
      const id = typeof entry === "string" ? entry : entry?.id;
      const scopes = typeof arrangement.scopeIds === "function" ? arrangement.scopeIds() : [];
      const targetScope = scope || scopes[0] || "fields";
      const from = typeof arrangement.saved === "function"
        ? (arrangement.saved(targetScope) || []).indexOf(id) : -1;
      const to = typeof arrangement.projected === "function"
        ? (arrangement.projected(targetScope) || []).indexOf(id) : -1;
      const label = labelFor(targetScope, id);
      if (from >= 0 && to >= 0) {
        detail = ` · ${label} ${from + 1} → ${to + 1}`;
      }
    }
    return `↕ ${count} ${noun}${detail} · ⏎ save · esc revert · ${stepLabel}`;
  } catch (_) {
    return "";
  }
}

function schemaArrangeBankLabelFor(model, scope, id) {
  try {
    const name = String(scope || "");
    const key = String(id ?? "");
    if (name === "groups") return key;
    if (name === "rules") {
      const item = (Array.isArray(model?.ruleItems) ? model.ruleItems : [])
        .find((row) => String(row?.id || "") === key);
      return String(item?.entry?.match || key);
    }
    if (name.startsWith("group:")) {
      const categories = Array.isArray(model?.categories) ? model.categories : [];
      const entry = categories.find((row) => String(row?.key || "") === key);
      return String(entry?.label || entry?.key || key);
    }
  } catch (_) {}
  return String(id ?? "");
}

function schemaArrangeBankScopeLabel(scope) {
  const name = String(scope || "");
  if (name === "groups") return "group";
  if (name === "rules") return "rule";
  if (name.startsWith("group:")) return "category";
  return name;
}

function schemaArrangeIsLoudBankReport(report, arrangement) {
  try {
    const reasons = [];
    if (arrangement && typeof arrangement.saved === "function" && typeof schemaArrangeSameOrder === "function") {
      const saved = arrangement.saved("rules") || [];
      const projected = arrangement.projected("rules") || [];
      if (saved.length && projected.length && !schemaArrangeSameOrder(saved, projected)) {
        reasons.push("rule");
      }
    }
    const shifted = report?.hotkeys?.shifted;
    if (Array.isArray(shifted) && shifted.length > 0) reasons.push("hotkey");
    if (Array.isArray(report?.warnings) && report.warnings.length > 0) reasons.push("warnings");
    return { loud: reasons.length > 0, reasons };
  } catch (_) {
    return { loud: false, reasons: [] };
  }
}

function schemaArrangeHotkeyShiftBadge(shift) {
  try {
    const from = String(shift?.from || "");
    const to = String(shift?.to || "");
    if (from.length === 1 && to.length === 1 && from.toLowerCase() !== to.toLowerCase()) {
      return `${from.toUpperCase()}→${to.toUpperCase()}`;
    }
  } catch (_) {}
  return "";
}

function schemaArrangeBankOrderDisagrees(report, arrangement, categories) {
  try {
    const listed = Array.isArray(report?.categories) ? report.categories : null;
    if (!listed || !listed.length || !arrangement || typeof arrangement.projected !== "function") {
      return false;
    }
    const groups = arrangement.projected("groups") || [];
    const rows = typeof schemaArrangeExpectedBankCategories === "function"
      ? schemaArrangeExpectedBankCategories(arrangement, Array.isArray(categories) ? categories : [], groups)
      : [];
    const want = rows
      .filter((row) => row && row.hidden !== true)
      .map((row) => String(row?.key || ""))
      .filter(Boolean);
    if (!want.length) return false;
    const wantSet = new Set(want);
    const got = listed
      .map((row) => (typeof row === "string" ? row : String(row?.key || "")))
      .filter((key) => key && wantSet.has(key));
    if (!got.length) return false;
    return typeof schemaArrangeSameOrder === "function"
      ? !schemaArrangeSameOrder(want, got)
      : want.join("\0") !== got.join("\0");
  } catch (_) {
    return false;
  }
}

function schemaArrangeCollectRects(root) {
  const rects = new Map();
  try {
    const nodes = root?.querySelectorAll?.("[data-arrange-id]") || [];
    for (const node of Array.from(nodes)) {
      const id = node.getAttribute?.("data-arrange-id");
      if (!id) continue;
      let rect = null;
      try {
        rect = node.getBoundingClientRect?.() || null;
      } catch (_) {
        rect = null;
      }
      if (rect && Number.isFinite(Number(rect.left)) && Number.isFinite(Number(rect.top))) {
        rects.set(id, { left: Number(rect.left), top: Number(rect.top) });
      } else {
        const index = Array.from(nodes).indexOf(node);
        rects.set(id, { left: 0, top: index * 24 });
      }
    }
  } catch (_) {}
  return rects;
}

function schemaArrangeReducedMotion() {
  try {
    if (typeof matchMedia === "function") {
      return matchMedia("(prefers-reduced-motion: reduce)").matches === true;
    }
  } catch (_) {}
  try {
    if (typeof globalThis !== "undefined" && globalThis.matchMedia) {
      return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
    }
  } catch (_) {}
  return false;
}

function schemaArrangePlayFlip(root, beforeRects, options = {}) {
  try {
    if (schemaArrangeReducedMotion() && options.force !== true) return {};
    const after = schemaArrangeCollectRects(root);
    const plan = typeof arrangeFlipPlan === "function"
      ? arrangeFlipPlan(beforeRects, after)
      : {};
    const duration = Number.isFinite(Number(options.duration)) ? Number(options.duration) : 140;
    for (const [id, move] of Object.entries(plan || {})) {
      const node = root?.querySelector?.(`[data-arrange-id="${String(id).replace(/"/g, "")}"]`);
      if (!node || !node.style) continue;
      const dx = Number(move?.dx || 0);
      const dy = Number(move?.dy || 0);
      if (!dx && !dy) continue;
      try {
        node.style.transition = "none";
        node.style.transform = `translate(${dx}px, ${dy}px)`;
        const frame = () => {
          try {
            node.style.transition = `transform ${duration}ms ease-out`;
            node.style.transform = "";
            const clear = () => {
              try { node.style.transition = ""; node.style.transform = ""; } catch (_) {}
              try { node.removeEventListener?.("transitionend", clear); } catch (_) {}
            };
            try { node.addEventListener?.("transitionend", clear); } catch (_) {}
            try { globalThis.setTimeout?.(clear, duration + 60); } catch (_) {}
          } catch (_) {}
        };
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => requestAnimationFrame(frame));
        } else if (typeof globalThis.requestAnimationFrame === "function") {
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(frame));
        } else {
          frame();
        }
      } catch (_) {}
    }
    return plan;
  } catch (_) {
    return {};
  }
}

function schemaArrangeAnnounce(card, message) {
  try {
    if (!card || !message) return;
    let live = card.querySelector?.("[data-arrange-announcer]") || null;
    if (!live) {
      const doc = (typeof notebookDomDoc === "function" ? notebookDomDoc(card) : null)
        || card.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!doc || typeof notebookCreateEl !== "function") return;
      live = notebookCreateEl(doc, "p", "bob-album-schema-arrange-live");
      live.setAttribute("data-arrange-announcer", "true");
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      try { live.setAttribute("hidden", ""); } catch (_) {}
      card.appendChild(live);
    }
    if (typeof notebookSetText === "function") notebookSetText(live, String(message));
    else live.textContent = String(message);
  } catch (_) {}
}

function schemaArrangeGapBadges(count) {
  try {
    if (typeof arrangeGapHintLabels === "function") return arrangeGapHintLabels(count);
  } catch (_) {}
  return [];
}

// Shared pointer-drag controller (album now, bank later). The math and the
// caret are scope-agnostic: each card wires pointer events to placeAtGap.
// Gap numbers match the engine: gap g inserts before order[g] with the
// dragged item still in place; the two no-op gaps next to the dragged item
// are legal to hover but drop as a quiet snap-back.
function schemaDragOrientationRect(rect, horizontal) {
  if (!rect) return null;
  const start = Number(horizontal ? rect.left : rect.top);
  const end = Number(horizontal ? rect.right : rect.bottom);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end, center: (start + end) / 2 };
}

function schemaDragGapFromPoint(order, id, rects, point, orientation) {
  try {
    const horizontal = orientation === "horizontal";
    const value = Number(horizontal ? point?.x : point?.y);
    if (!Array.isArray(order) || !Number.isFinite(value)) return null;
    const get = rects instanceof Map
      ? (key) => rects.get(key)
      : (key) => rects?.[key];
    for (let index = 0; index < order.length; index += 1) {
      const span = schemaDragOrientationRect(get(order[index]), horizontal);
      if (!span) continue;
      if (value < span.center) return index;
    }
    return order.length;
  } catch (_) {
    return null;
  }
}

function schemaDragScopeAtPoint(doc, x, y) {
  try {
    const el = doc?.elementFromPoint?.(x, y) || null;
    const scope = el?.closest?.("[data-drag-scope]") || null;
    const name = scope?.getAttribute?.("data-drag-scope");
    return name ? String(name) : null;
  } catch (_) {
    return null;
  }
}

function schemaDragCollectRects(root, scope) {
  const rects = new Map();
  try {
    const nodes = root?.querySelectorAll?.("[data-arrange-id]") || [];
    for (const node of Array.from(nodes)) {
      const arrangeId = node.getAttribute?.("data-arrange-id") || "";
      const prefix = `${scope}:`;
      if (!arrangeId.startsWith(prefix)) continue;
      const id = arrangeId.slice(prefix.length);
      let rect = null;
      try {
        rect = node.getBoundingClientRect?.() || null;
      } catch (_) {
        rect = null;
      }
      if (rect && Number.isFinite(Number(rect.top)) && Number.isFinite(Number(rect.left))) {
        rects.set(id, {
          top: Number(rect.top),
          bottom: Number(rect.bottom ?? rect.top),
          left: Number(rect.left),
          right: Number(rect.right ?? rect.left),
        });
      }
    }
  } catch (_) {}
  return rects;
}

function schemaDragScopeOrientation(scope) {
  const name = String(scope || "");
  return name.startsWith("choices:") || name.startsWith("group:") ? "horizontal" : "vertical";
}

function createSchemaDragSession({ scope, id, order, legalGaps }) {
  const legal = Array.isArray(legalGaps) ? legalGaps.slice() : [];
  return {
    scope: String(scope || ""),
    id: String(id ?? ""),
    order: Array.isArray(order) ? order.slice() : [],
    legal,
    gap: null,
    hoverScope: String(scope || ""),
    valid: false,
    moved: false,
    moveTo(gap, hoverScope) {
      if (Number.isInteger(gap)) {
        this.gap = gap;
        this.moved = true;
      }
      if (hoverScope !== undefined) this.hoverScope = hoverScope == null ? null : String(hoverScope);
      this.valid = this.hoverScope === this.scope && legal.includes(this.gap);
      return this.valid;
    },
    drop() {
      if (this.hoverScope !== undefined && this.hoverScope !== null && this.hoverScope !== this.scope) {
        return { ok: false, code: "out-of-scope", gap: this.gap };
      }
      if (!Number.isInteger(this.gap)) return { ok: false, code: "no-gap", gap: this.gap };
      if (!legal.includes(this.gap)) return { ok: false, code: "no-op", gap: this.gap };
      return { ok: true, gap: this.gap };
    },
    cancel() {
      this.gap = null;
      this.valid = false;
      this.moved = false;
    },
  };
}

function schemaDragCaretEl(root) {
  try {
    return root?.querySelector?.("[data-drag-caret]") || null;
  } catch (_) {
    return null;
  }
}

function schemaDragEnsureCaret(root, doc) {
  let caret = schemaDragCaretEl(root);
  if (caret) return caret;
  try {
    const owner = doc || root?.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!owner) return null;
    if (typeof notebookCreateEl === "function") {
      caret = notebookCreateEl(owner, "div", "bob-album-schema-insert-caret");
    } else if (typeof owner.createElement === "function") {
      caret = owner.createElement("div");
      try { caret.setAttribute("class", "bob-album-schema-insert-caret"); } catch (_) {}
    } else {
      return null;
    }
    try { caret.setAttribute("data-drag-caret", "true"); } catch (_) {}
    try { caret.setAttribute("aria-hidden", "true"); } catch (_) {}
    return caret;
  } catch (_) {
    return null;
  }
}

function schemaDragScopeItems(container, scope) {
  const items = [];
  try {
    const prefix = `${scope}:`;
    const walk = (node) => {
      for (const child of Array.from(node?.children || [])) {
        if (typeof child.getAttribute === "function"
          && String(child.getAttribute("data-arrange-id") || "").startsWith(prefix)) {
          items.push(child);
        } else if (typeof child.querySelectorAll === "function") {
          for (const found of Array.from(child.querySelectorAll("[data-arrange-id]") || [])) {
            if (String(found.getAttribute?.("data-arrange-id") || "").startsWith(prefix)) items.push(found);
          }
          continue;
        }
        walk(child);
      }
    };
    walk(container);
  } catch (_) {}
  return items;
}

function schemaDragPaintCaret(root, session) {
  try {
    const existing = schemaDragCaretEl(root);
    if (!session || !Number.isInteger(session.gap)) {
      try { existing?.remove?.(); } catch (_) {
        try { existing?.parentNode?.removeChild?.(existing); } catch (_) {}
      }
      return null;
    }
    const scope = session.hoverScope || session.scope;
    const containers = root?.querySelectorAll?.(`[data-drag-scope="${String(scope).replace(/"/g, "")}"]`) || [];
    const container = Array.from(containers)[0] || null;
    if (!container) return null;
    const caret = schemaDragEnsureCaret(root, root?.ownerDocument) || schemaDragEnsureCaret(root, null);
    if (!caret) return null;
    try {
      const cls = `bob-album-schema-insert-caret${session.valid ? "" : " is-not-allowed"}`;
      if (typeof caret.setAttribute === "function") caret.setAttribute("class", cls);
      else caret.className = cls;
    } catch (_) {}
    try {
      const items = schemaDragScopeItems(container, session.scope);
      const before = items[Math.min(Math.max(session.gap, 0), items.length)] || null;
      if (typeof container.insertBefore === "function") container.insertBefore(caret, before);
      else if (typeof container.appendChild === "function" && !caret.parentNode) container.appendChild(caret);
    } catch (_) {}
    return caret;
  } catch (_) {
    return null;
  }
}

function schemaDragClearCaret(root) {
  return schemaDragPaintCaret(root, null);
}

// Nudge a scroll container when the pointer hovers near its top or bottom
// edge. Returns true when it scrolled. Pure enough for unit tests: any
// {scrollTop, scrollHeight, clientHeight} stub works.
function schemaDragAutoscrollStep(container, clientY, options = {}) {
  try {
    if (!container || !Number.isFinite(Number(clientY))) return false;
    const zone = Number.isFinite(Number(options.zone)) ? Number(options.zone) : 48;
    const speed = Number.isFinite(Number(options.speed)) ? Number(options.speed) : 12;
    let top = null;
    let height = null;
    try {
      const rect = container.getBoundingClientRect?.() || null;
      if (rect) {
        top = Number(rect.top);
        height = Number(rect.height ?? rect.bottom - rect.top);
      }
    } catch (_) {}
    if (top === null || top === undefined) {
      top = Number(container.offsetTop ?? 0);
      height = Number(container.clientHeight ?? 0);
    }
    if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return false;
    const y = Number(clientY);
    const max = Number(container.scrollHeight ?? 0) - Number(container.clientHeight ?? 0);
    if (!(max > 0)) return false;
    if (y < top + zone && y >= top - zone) {
      container.scrollTop = Math.max(0, Number(container.scrollTop ?? 0) - speed);
      return true;
    }
    if (y > top + height - zone && y <= top + height + zone) {
      container.scrollTop = Math.min(max, Number(container.scrollTop ?? 0) + speed);
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}
