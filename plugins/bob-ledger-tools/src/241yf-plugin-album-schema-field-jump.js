// Album Schema Card field jumps: Ctrl+J/K steps and 1-9 jumps in
// painted order. Pure navigation: selection, reveal, and announcement
// only. Never touches the session, previews, writers, or the arrangement.
Object.assign(AlbumSchemaCardModal.prototype, {
  schemaFieldJumpFields(targets) {
    return (Array.isArray(targets) ? targets : []).filter((target) => target?.kind === "field");
  },

  schemaFieldJumpAnnounce(message) {
    try {
      schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl, message);
    } catch (_) {}
  },

  schemaFieldJumpBump(sign) {
    try {
      const root = this.schemaCardEl?.() || this.contentEl;
      let node = null;
      try {
        node = root?.querySelector?.(`[data-target-key="${String(this.selectedKey || "")}"]`) || null;
      } catch (_) {
        node = null;
      }
      if (typeof schemaCardBump === "function") schemaCardBump(node, sign);
    } catch (_) {}
  },

  schemaFieldJumpMiss(sign, message, event) {
    if (event?.repeat) return true;
    try { this.schemaFieldJumpBump(sign); } catch (_) {}
    try { this.schemaFieldJumpAnnounce(message); } catch (_) {}
    return true;
  },

  schemaFieldJumpGoto(key, fields) {
    const index = fields.findIndex((field) => field?.key === key);
    if (index < 0) return false;
    const targets = this.schemaTargets();
    const targetIndex = targets.findIndex((target) => target?.key === key);
    this.selectedKey = key;
    this.selectedIndex = targetIndex >= 0 ? targetIndex : 0;
    try { this.paintSchemaCard("select"); } catch (_) {}
    try { this.schemaFieldRevealGroup(fields[index]?.field?.key); } catch (_) {}
    const label = String(fields[index]?.field?.label || fields[index]?.field?.key || "Field");
    try { this.schemaFieldJumpAnnounce(`${label}, field ${index + 1} of ${fields.length}`); } catch (_) {}
    return true;
  },

  schemaFieldRevealGroup(fieldKey) {
    try {
      const root = this.schemaCardEl?.() || this.contentEl;
      if (!root?.querySelector) return;
      let head = null;
      try {
        head = root.querySelector(`[data-target-key="field:${String(fieldKey ?? "")}"]`);
      } catch (_) {
        head = null;
      }
      if (!head) return;
      let body = null;
      try {
        const siblings = Array.from(head.parentNode?.children || []);
        const at = siblings.indexOf(head);
        const next = at >= 0 ? siblings[at + 1] : null;
        const cls = String(next?.getAttribute?.("class") || "");
        if (next && /bob-album-schema-choice-cloud/.test(cls)) body = next;
      } catch (_) {
        body = null;
      }
      if (typeof schemaCardRevealGroup === "function") schemaCardRevealGroup(head, body);
    } catch (_) {}
  },

  schemaFieldStep(delta, event) {
    if (!this.session) return false;
    const targets = this.schemaTargets();
    const fields = this.schemaFieldJumpFields(targets);
    const down = Number(delta) >= 0;
    if (!fields.length) {
      return this.schemaFieldJumpMiss(down ? 1 : -1, "This album has no fields yet.", event);
    }
    const key = typeof albumSchemaFieldStepKey === "function"
      ? albumSchemaFieldStepKey(targets, this.selectedKey, delta)
      : null;
    if (!key) {
      return this.schemaFieldJumpMiss(down ? 1 : -1, down ? "No next field" : "No previous field", event);
    }
    return this.schemaFieldJumpGoto(key, fields);
  },

  schemaFieldNumber(n, event) {
    if (!this.session) return false;
    const targets = this.schemaTargets();
    const fields = this.schemaFieldJumpFields(targets);
    if (!fields.length) {
      return this.schemaFieldJumpMiss(1, "This album has no fields yet.", event);
    }
    const key = typeof albumSchemaFieldNumberKey === "function"
      ? albumSchemaFieldNumberKey(targets, n)
      : null;
    if (!key) {
      const noun = fields.length === 1 ? "1 field" : `${fields.length} fields`;
      return this.schemaFieldJumpMiss(1, `No field ${Number(n)} · this album has ${noun}`, event);
    }
    return this.schemaFieldJumpGoto(key, fields);
  },
});
