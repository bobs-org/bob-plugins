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

function schemaArrangePendingText(arrangement, model) {
  try {
    if (!arrangement || typeof arrangement.summary !== "function") return "";
    const summary = arrangement.summary();
    if (!summary || !summary.dirty) return "";
    const count = Number(summary.moveCount || summary.count || 0);
    if (!count) return "";
    const noun = count === 1 ? "move" : "moves";
    let detail = "";
    const moved = Array.isArray(summary.movedIds) ? summary.movedIds : [];
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
      const label = schemaArrangeAlbumLabelFor(model, targetScope, id);
      if (from >= 0 && to >= 0) {
        detail = ` · ${label} ${from + 1} → ${to + 1}`;
      }
    }
    return `↕ ${count} ${noun}${detail} · ⏎ save · esc revert · u step back`;
  } catch (_) {
    return "";
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
