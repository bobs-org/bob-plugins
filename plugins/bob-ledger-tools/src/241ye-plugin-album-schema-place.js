// Add-and-place ghosts and shared pointer-drag wiring for the album card.
// A ghost is the live placement preview for choice-add / field-add: the move
// keys (and gap badges) slide it while focus stays in the stage, and the
// single choice.add / field.add op carries its gap as position. The ghost
// never enters arrangement scopes, so compileAlbumArrangement excludes it by
// construction. Pointer drag feeds the same engine via placeAtGap; the
// scope-agnostic math and caret live in 241xb so the bank card reuses them.
function schemaGhostDefaultFor(model, stage) {
  try {
    if (!stage || !model) return null;
    if (stage.kind === "choice-add") {
      const target = typeof albumSchemaTargetByKey === "function"
        ? albumSchemaTargetByKey(model, stage.targetKey)
        : null;
      const field = target?.field || null;
      if (!field) return null;
      const scope = `choices:${field.key}`;
      const order = (Array.isArray(field.choices) ? field.choices : []).map((choice) => String(choice?.value ?? ""));
      let gap = order.length;
      if (target.kind === "choice") {
        const index = order.indexOf(String(target.choice?.value ?? ""));
        if (index >= 0) gap = index + 1;
      }
      return { kind: "choice", scope, gap };
    }
    if (stage.kind === "field-add") {
      const target = typeof albumSchemaTargetByKey === "function"
        ? albumSchemaTargetByKey(model, stage.targetKey)
        : null;
      const fields = Array.isArray(model?.fields) ? model.fields : [];
      let gap = fields.length;
      if (target?.kind === "field" && target.field) {
        const index = fields.findIndex((field) => String(field?.key) === String(target.field.key));
        if (index >= 0) gap = index + 1;
      }
      return { kind: "field", scope: "fields", gap };
    }
    return null;
  } catch (_) {
    return null;
  }
}

function schemaGhostScopeLength(model, scope) {
  try {
    if (scope === "fields") return Array.isArray(model?.fields) ? model.fields.length : 0;
    if (String(scope || "").startsWith("choices:")) {
      const key = String(scope).slice("choices:".length);
      const field = (Array.isArray(model?.fields) ? model.fields : [])
        .find((item) => String(item?.key || "") === key);
      return Array.isArray(field?.choices) ? field.choices.length : 0;
    }
    return 0;
  } catch (_) {
    return 0;
  }
}

function schemaGhostClampGap(model, scope, gap) {
  const length = schemaGhostScopeLength(model, scope);
  const value = Number(gap);
  if (!Number.isFinite(value)) return length;
  return Math.min(Math.max(Math.floor(value), 0), length);
}

Object.assign(AlbumSchemaCardModal.prototype, {
  schemaGhostActive() {
    return Boolean(this.schemaAddGhost
      && this.stage
      && (this.stage.kind === "choice-add" || this.stage.kind === "field-add"));
  },

  schemaGhostEnsure() {
    try {
      if (!this.stage || (this.stage.kind !== "choice-add" && this.stage.kind !== "field-add")) {
        this.schemaAddGhost = null;
        return null;
      }
      const current = this.schemaAddGhost;
      const fresh = schemaGhostDefaultFor(this.schemaModel, this.stage);
      if (!fresh) {
        this.schemaAddGhost = null;
        return null;
      }
      if (!current || current.kind !== fresh.kind || current.scope !== fresh.scope) {
        this.schemaAddGhost = fresh;
      } else {
        this.schemaAddGhost.gap = schemaGhostClampGap(this.schemaModel, current.scope, current.gap);
      }
      return this.schemaAddGhost;
    } catch (_) {
      return null;
    }
  },

  schemaGhostClear() {
    this.schemaAddGhost = null;
    if (this.schemaHintMode?.ghost) this.schemaHintMode = null;
  },

  schemaGhostView() {
    try {
      if (!this.schemaGhostActive()) return null;
      const ghost = this.schemaAddGhost;
      const gap = schemaGhostClampGap(this.schemaModel, ghost.scope, ghost.gap);
      if (ghost.kind === "choice") {
        return {
          kind: "choice",
          scope: ghost.scope,
          gap,
          label: String(this.stageDraft?.values?.choiceLabel ?? ""),
          emoji: String(this.stageDraft?.values?.choiceEmoji ?? ""),
        };
      }
      return {
        kind: "field",
        scope: ghost.scope,
        gap,
        label: String(this.stageDraft?.values?.newFieldLabel ?? ""),
        emoji: "",
      };
    } catch (_) {
      return null;
    }
  },

  schemaGhostPosition() {
    try {
      if (!this.schemaGhostActive()) return null;
      return schemaGhostClampGap(this.schemaModel, this.schemaAddGhost.scope, this.schemaAddGhost.gap);
    } catch (_) {
      return null;
    }
  },

  schemaGhostDescribe() {
    try {
      const view = this.schemaGhostView();
      if (!view) return "";
      const length = schemaGhostScopeLength(this.schemaModel, view.scope);
      const name = view.kind === "choice"
        ? (view.label.trim() ? `choice ${view.label.trim()}` : "new choice")
        : (view.label.trim() ? `field ${view.label.trim()}` : "new field");
      return `${name}, position ${view.gap + 1} of ${length + 1}`;
    } catch (_) {
      return "";
    }
  },

  schemaGhostRepaintAndPreview(announce = true) {
    try {
      this.paintSchemaCard?.("body");
      this.schemaClearEnterLatch?.();
      this.schemaQueueStagePreview(false);
      this.schemaGhostRefreshText();
      if (announce) {
        schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl, this.schemaGhostDescribe());
      }
      return true;
    } catch (_) {
      return false;
    }
  },

  schemaGhostRefreshText() {
    try {
      const view = this.schemaGhostView();
      if (!view) return;
      const card = this.schemaCardEl?.() || this.contentEl;
      const node = card?.querySelector?.("[data-schema-ghost]") || null;
      if (!node) return;
      const text = view.kind === "choice"
        ? `${view.emoji ? `${view.emoji} ` : ""}${view.label.trim() || "New choice"}`
        : `+ ${view.label.trim() || "New field"}`;
      if (typeof notebookSetText === "function") notebookSetText(node, text);
      else node.textContent = text;
    } catch (_) {}
  },

  schemaGhostNudge(delta) {
    try {
      if (!this.schemaGhostActive()) return false;
      const ghost = this.schemaEnsureArrangement ? this.schemaGhostEnsure() : this.schemaAddGhost;
      if (!ghost) return false;
      const before = schemaGhostClampGap(this.schemaModel, ghost.scope, ghost.gap);
      const after = schemaGhostClampGap(this.schemaModel, ghost.scope, before + Number(delta));
      if (after === before) {
        schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl,
          after <= 0 ? "Already first." : "Already last.");
        return false;
      }
      ghost.gap = after;
      return this.schemaGhostRepaintAndPreview(true);
    } catch (_) {
      return false;
    }
  },

  schemaGhostToEdge(edge) {
    try {
      if (!this.schemaGhostActive()) return false;
      const ghost = this.schemaGhostEnsure();
      if (!ghost) return false;
      const length = schemaGhostScopeLength(this.schemaModel, ghost.scope);
      ghost.gap = edge === "first" ? 0 : length;
      return this.schemaGhostRepaintAndPreview(true);
    } catch (_) {
      return false;
    }
  },

  schemaGhostPlace(gap) {
    try {
      if (!this.schemaGhostActive()) return false;
      const ghost = this.schemaGhostEnsure();
      if (!ghost || !Number.isInteger(Number(gap))) return false;
      ghost.gap = schemaGhostClampGap(this.schemaModel, ghost.scope, gap);
      this.schemaHintMode = null;
      return this.schemaGhostRepaintAndPreview(true);
    } catch (_) {
      return false;
    }
  },

  schemaGhostEnterHintMode() {
    try {
      if (!this.schemaGhostActive()) return false;
      const ghost = this.schemaGhostEnsure();
      if (!ghost) return false;
      const length = schemaGhostScopeLength(this.schemaModel, ghost.scope);
      const gaps = [];
      for (let gap = 0; gap <= length; gap += 1) gaps.push(gap);
      if (!gaps.length) return false;
      const labels = typeof schemaArrangeGapBadges === "function" ? schemaArrangeGapBadges(gaps.length) : [];
      this.schemaHintMode = { scope: ghost.scope, id: "__ghost__", gaps, labels, ghost: true };
      this.paintSchemaCard?.("body");
      schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl,
        `Move to… type a gap badge for ${this.schemaGhostDescribe()}. Esc leaves hint mode.`);
      return true;
    } catch (_) {
      return false;
    }
  },

  schemaGhostHintKey(key) {
    try {
      const mode = this.schemaHintMode;
      if (!mode?.ghost || !this.schemaGhostActive()) return false;
      const typed = String(key || "").toLowerCase();
      if (!typed) return false;
      const index = (mode.labels || []).indexOf(typed);
      if (index < 0) {
        const prefix = (mode.labels || []).filter((label) => label.startsWith(typed));
        if (!prefix.length) return false;
        return true;
      }
      const gap = (mode.gaps || [])[index];
      if (!Number.isInteger(gap)) return false;
      return this.schemaGhostPlace(gap);
    } catch (_) {
      return false;
    }
  },

  schemaDragActive() {
    return Boolean(this.schemaDrag?.session);
  },

  schemaDragBegin(scope, id, event) {
    try {
      if (this.schemaDrag?.session) return false;
      if (this.stage || this.sessionState?.status === "applying" || !this.schemaFresh()) return false;
      if (!scope || id === undefined || id === null || String(id) === "") return false;
      this.schemaEnsureArrangement?.();
      const arrangement = this.schemaArrangement;
      if (!arrangement || typeof arrangement.legalGaps !== "function") return false;
      const order = arrangement.projected(scope) || [];
      if (!order.includes(String(id))) return false;
      const session = typeof createSchemaDragSession === "function"
        ? createSchemaDragSession({ scope, id: String(id), order, legalGaps: arrangement.legalGaps(scope, String(id)) })
        : null;
      if (!session) return false;
      try { event?.preventDefault?.(); } catch (_) {}
      this.schemaDrag = { session, pointerId: event?.pointerId ?? null, scope, id: String(id) };
      try {
        const card = this.schemaCardEl?.() || this.contentEl;
        const node = card?.querySelector?.(`[data-arrange-id="${scope}:${String(id).replace(/"/g, "")}"]`) || null;
        const grip = event?.target?.closest?.(".bob-album-schema-grip") || null;
        const lift = node || grip?.closest?.("[data-arrange-id]") || null;
        if (lift?.classList?.add) lift.classList.add("is-dragging");
        this.schemaDrag.lift = lift || null;
      } catch (_) {}
      try {
        if (typeof globalThis !== "undefined" && typeof globalThis.addEventListener === "function" && !this.schemaDrag.bound) {
          const move = (moveEvent) => this.schemaDragOnMove(moveEvent);
          const up = (upEvent) => this.schemaDragOnUp(upEvent);
          const cancel = () => this.schemaDragFinish(true);
          this.schemaDrag.bound = { move, up, cancel };
          globalThis.addEventListener("pointermove", move);
          globalThis.addEventListener("pointerup", up);
          globalThis.addEventListener("pointercancel", cancel);
        }
      } catch (_) {}
      return true;
    } catch (_) {
      return false;
    }
  },

  schemaDragOnMove(event) {
    try {
      const drag = this.schemaDrag;
      if (!drag?.session) return false;
      if (drag.pointerId !== undefined && drag.pointerId !== null
        && event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return false;
      try { event?.preventDefault?.(); } catch (_) {}
      const card = this.schemaCardEl?.() || this.contentEl;
      const rects = typeof schemaDragCollectRects === "function"
        ? schemaDragCollectRects(card, drag.scope)
        : new Map();
      const orientation = typeof schemaDragScopeOrientation === "function"
        ? schemaDragScopeOrientation(drag.scope)
        : "vertical";
      const gap = typeof schemaDragGapFromPoint === "function"
        ? schemaDragGapFromPoint(drag.session.order, drag.id, rects,
          { x: event?.clientX, y: event?.clientY }, orientation)
        : null;
      let hoverScope = drag.scope;
      try {
        const doc = card?.ownerDocument || (typeof document !== "undefined" ? document : null);
        const found = typeof schemaDragScopeAtPoint === "function"
          ? schemaDragScopeAtPoint(doc, event?.clientX, event?.clientY)
          : null;
        if (found) hoverScope = found;
      } catch (_) {}
      drag.session.moveTo(Number.isInteger(gap) ? gap : drag.session.gap, hoverScope);
      if (typeof schemaDragPaintCaret === "function") schemaDragPaintCaret(card, drag.session);
      try {
        const scroller = this.contentEl || card;
        if (typeof schemaDragAutoscrollStep === "function") schemaDragAutoscrollStep(scroller, event?.clientY);
      } catch (_) {}
      return true;
    } catch (_) {
      return false;
    }
  },

  schemaDragOnUp(event) {
    try {
      const drag = this.schemaDrag;
      if (!drag?.session) return false;
      if (drag.pointerId !== undefined && drag.pointerId !== null
        && event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return false;
      return this.schemaDragFinish(false);
    } catch (_) {
      return false;
    }
  },

  schemaDragUpdate(clientX, clientY, hoverScope) {
    try {
      const drag = this.schemaDrag;
      if (!drag?.session) return false;
      const card = this.schemaCardEl?.() || this.contentEl;
      const rects = typeof schemaDragCollectRects === "function"
        ? schemaDragCollectRects(card, drag.scope)
        : new Map();
      const orientation = typeof schemaDragScopeOrientation === "function"
        ? schemaDragScopeOrientation(drag.scope)
        : "vertical";
      const gap = typeof schemaDragGapFromPoint === "function"
        ? schemaDragGapFromPoint(drag.session.order, drag.id, rects, { x: clientX, y: clientY }, orientation)
        : null;
      const scope = hoverScope === undefined ? drag.scope : hoverScope;
      drag.session.moveTo(Number.isInteger(gap) ? gap : drag.session.gap, scope);
      if (typeof schemaDragPaintCaret === "function") schemaDragPaintCaret(card, drag.session);
      return true;
    } catch (_) {
      return false;
    }
  },

  schemaDragFinish(cancelled) {
    try {
      const drag = this.schemaDrag;
      if (!drag?.session) return false;
      try {
        if (typeof globalThis !== "undefined" && typeof globalThis.removeEventListener === "function" && drag.bound) {
          globalThis.removeEventListener("pointermove", drag.bound.move);
          globalThis.removeEventListener("pointerup", drag.bound.up);
          globalThis.removeEventListener("pointercancel", drag.bound.cancel);
        }
      } catch (_) {}
      try { drag.lift?.classList?.remove?.("is-dragging"); } catch (_) {}
      const card = this.schemaCardEl?.() || this.contentEl;
      try {
        if (typeof schemaDragClearCaret === "function") schemaDragClearCaret(card);
      } catch (_) {}
      const session = drag.session;
      this.schemaDrag = null;
      if (cancelled) {
        this.paintSchemaCard?.("body");
        schemaArrangeAnnounce(card, "Drag cancelled. Nothing was written.");
        return true;
      }
      const verdict = typeof session.drop === "function" ? session.drop() : { ok: false, code: "no-gap" };
      if (!verdict.ok) {
        this.paintSchemaCard?.("body");
        if (verdict.code === "out-of-scope") {
          schemaArrangeAnnounce(card, "Choices stay in their field; fields stay in place. Drag snapped back.");
        }
        return true;
      }
      this.schemaEnsureArrangement?.();
      if (!this.schemaArrangement) {
        this.paintSchemaCard?.("body");
        return true;
      }
      const before = typeof schemaArrangeCollectRects === "function"
        ? schemaArrangeCollectRects(card)
        : new Map();
      const result = this.schemaArrangement.placeAtGap(session.scope, session.id, verdict.gap);
      this.schemaHintMode = null;
      if (result?.ok) {
        this.schemaArrangeConfirm = false;
        this.schemaClearEnterLatch?.();
        this.schemaArrangeSyncDraft?.();
        this.paintSchemaCard?.("body");
        if (typeof schemaArrangePlayFlip === "function") schemaArrangePlayFlip(card, before);
        const projected = this.schemaArrangement.projected(session.scope) || [];
        const index = projected.indexOf(session.id);
        if (index >= 0) {
          const label = typeof schemaArrangeAlbumLabelFor === "function"
            ? schemaArrangeAlbumLabelFor(this.schemaModel, session.scope, session.id)
            : session.id;
          schemaArrangeAnnounce(card, `${label}, position ${index + 1} of ${projected.length}`);
        }
        return true;
      }
      this.paintSchemaCard?.("body");
      return true;
    } catch (_) {
      return false;
    }
  },

  schemaDragPointerDown(event) {
    try {
      if (!event || event.button !== undefined && event.button !== 0) return;
      const grip = event.target?.closest?.(".bob-album-schema-grip") || null;
      if (!grip) return;
      const scope = grip.getAttribute?.("data-drag-scope") || "";
      const id = grip.getAttribute?.("data-drag-id") ?? "";
      if (!scope || id === "") return;
      this.schemaDragBegin(scope, id, event);
    } catch (_) {}
  },
});

// Wiring that keeps 241y under its line budget: ghost lifecycle, ghost move
// keys inside stage inputs, ghost-aware stage positions, pointer-drag
// plumbing, and drag-aware Escape all compose on top of the arrange wiring.
(function schemaPlaceWireCard() {
  try {
    const proto = AlbumSchemaCardModal.prototype;
    if (!proto || proto.__schemaPlaceWired) return;
    const origStage = proto.schemaStage;
    const origCancelStage = proto.schemaCancelStage;
    const origBuildOp = proto.schemaBuildStageOp;
    const origKeyDown = proto.schemaOnKeyDown;
    const origEscape = proto.schemaHandleEscape;
    const origPaintOptions = proto.schemaPaintOptions;
    const origOpen = proto.onOpen;
    const origClose = proto.onClose;

    proto.schemaStage = function schemaStagePlace(...args) {
      const opened = origStage.apply(this, args);
      try {
        if (opened) {
          // Seed the ghost and repaint the body only. Like the base card,
          // opening a stage previews nothing: the first keystroke or ghost
          // move queues the preview, so a second stage can still open.
          this.schemaGhostEnsure();
          if (this.schemaAddGhost) this.paintSchemaCard?.("body");
        }
      } catch (_) {}
      return opened;
    };

    proto.schemaCancelStage = function schemaCancelStagePlace(...args) {
      try { this.schemaGhostClear(); } catch (_) {}
      return origCancelStage.apply(this, args);
    };

    proto.schemaBuildStageOp = function schemaBuildStageOpPlace(...args) {
      const op = origBuildOp.apply(this, args);
      try {
        if (op && (this.stage?.kind === "choice-add" || this.stage?.kind === "field-add")) {
          const position = this.schemaGhostPosition?.();
          if (Number.isInteger(position)) op.position = position;
        }
      } catch (_) {}
      return op;
    };

    proto.schemaPaintOptions = function schemaPaintOptionsPlace(...args) {
      const options = origPaintOptions.apply(this, args);
      try {
        if (options) options.ghost = this.schemaGhostView?.() || null;
      } catch (_) {}
      return options;
    };

    proto.schemaOnKeyDown = function schemaOnKeyDownPlace(event) {
      try {
        if (!event || event.isComposing || event.keyCode === 229) return origKeyDown.call(this, event);
        if (event.defaultPrevented || event.__schemaEscapeHandled) return;
        if (this.schemaGhostActive()) {
          const inInput = Boolean(event.target?.closest?.("input,select,textarea"));
          const altJ = event.altKey && (event.key === "j" || event.key === "J" || event.code === "KeyJ");
          const altK = event.altKey && (event.key === "k" || event.key === "K" || event.code === "KeyK");
          const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
          const altArrow = event.altKey && arrows.includes(event.key);
          if (altJ || altK || altArrow) {
            try { event.preventDefault?.(); } catch (_) {}
            const down = altJ || event.key === "ArrowDown" || event.key === "ArrowRight";
            if (event.shiftKey) {
              try { this.schemaGhostToEdge?.(down ? "last" : "first"); } catch (_) {}
            } else {
              try { this.schemaGhostNudge?.(down ? 1 : -1); } catch (_) {}
            }
            return;
          }
          const altM = event.altKey && (event.key === "m" || event.key === "M" || event.code === "KeyM");
          if (altM) {
            try { event.preventDefault?.(); } catch (_) {}
            try { this.schemaGhostEnterHintMode?.(); } catch (_) {}
            return;
          }
          if (this.schemaHintMode?.ghost) {
            if (event.key !== "Escape" && event.key !== "Enter") {
              const key = String(event.key || "").toLowerCase();
              if (key && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                try { event.preventDefault?.(); } catch (_) {}
                try { this.schemaGhostHintKey?.(key); } catch (_) {}
                return;
              }
            }
          }
          if (!inInput && !event.altKey && !event.ctrlKey && !event.metaKey
            && (event.key === "m" || event.key === "M")) {
            try {
              if (this.schemaGhostEnterHintMode?.()) {
                try { event.preventDefault?.(); } catch (_) {}
                return;
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
      return origKeyDown.call(this, event);
    };

    proto.schemaHandleEscape = function schemaHandleEscapePlace(...args) {
      try {
        if (this.schemaDragActive?.()) {
          this.schemaDragFinish(true);
          return "stay";
        }
      } catch (_) {}
      try {
        if (this.schemaHintMode?.ghost) {
          this.schemaHintMode = null;
          this.paintSchemaCard?.("body");
          return "stay";
        }
      } catch (_) {}
      return origEscape.apply(this, args);
    };

    proto.onOpen = function onOpenPlace(...args) {
      const result = origOpen.apply(this, args);
      try {
        if (!this.schemaDragPointerListener) {
          this.schemaDragPointerListener = (event) => this.schemaDragPointerDown(event);
          this.contentEl?.addEventListener?.("pointerdown", this.schemaDragPointerListener);
        }
      } catch (_) {}
      return result;
    };

    proto.onClose = function onClosePlace(...args) {
      try {
        if (this.schemaDrag?.bound && typeof globalThis !== "undefined"
          && typeof globalThis.removeEventListener === "function") {
          globalThis.removeEventListener("pointermove", this.schemaDrag.bound.move);
          globalThis.removeEventListener("pointerup", this.schemaDrag.bound.up);
          globalThis.removeEventListener("pointercancel", this.schemaDrag.bound.cancel);
        }
      } catch (_) {}
      try { this.schemaDrag = null; } catch (_) {}
      try { this.schemaGhostClear(); } catch (_) {}
      return origClose.apply(this, args);
    };

    try {
      Object.defineProperty(proto, "__schemaPlaceWired", { value: true, configurable: true });
    } catch (_) {
      proto.__schemaPlaceWired = true;
    }
  } catch (_) {}
})();
