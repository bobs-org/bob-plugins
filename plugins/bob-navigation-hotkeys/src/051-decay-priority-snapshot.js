// Snapshot the priority ladder from bob/config.yml for the decay card.
// Never reads `this.config` on the plugin: the picker is the only owner of
// that field. Distinct load errors replace the single "no priority ladder
// is configured" dead end.

const FRESHNESS_DECAY_PRIORITY_LOAD_ERRORS = Object.freeze({
  missing: "config file missing",
  unreadable: "config unreadable",
  invalid: "config invalid",
  noProperty: "no `priority` property in bob/config.yml",
});

function freezeFreshnessDecayPrioritySnapshot(fields) {
  const property = fields && fields.property ? fields.property : null;
  return Object.freeze({
    config: fields && fields.config ? fields.config : null,
    property,
    loadError: fields && fields.loadError ? fields.loadError : null,
    priorityConfig:
      fields && typeof fields.priorityConfig === "string"
        ? fields.priorityConfig
        : serializeFreshnessDecayPriorityProperty(property),
  });
}

function loadFreshnessDecayPrioritySnapshot(options = {}) {
  const loaded = loadBulletPropertyConfig({
    ...options,
    detailed: true,
    showNotice:
      typeof options.showNotice === "function" ? options.showNotice : () => {},
  });
  const error = loaded && loaded.error ? loaded.error : null;
  const config = loaded && loaded.config ? loaded.config : null;
  if (error === "missing") {
    return freezeFreshnessDecayPrioritySnapshot({
      loadError: FRESHNESS_DECAY_PRIORITY_LOAD_ERRORS.missing,
    });
  }
  if (error === "unreadable") {
    return freezeFreshnessDecayPrioritySnapshot({
      loadError: FRESHNESS_DECAY_PRIORITY_LOAD_ERRORS.unreadable,
    });
  }
  if (error === "invalid" || !config) {
    return freezeFreshnessDecayPrioritySnapshot({
      loadError: FRESHNESS_DECAY_PRIORITY_LOAD_ERRORS.invalid,
    });
  }
  const property = findFreshnessDecayPriorityProperty(config);
  if (!property) {
    return freezeFreshnessDecayPrioritySnapshot({
      config,
      loadError: FRESHNESS_DECAY_PRIORITY_LOAD_ERRORS.noProperty,
    });
  }
  return freezeFreshnessDecayPrioritySnapshot({ config, property });
}

function buildFreshnessDecayCardFooter(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const parts = ["Esc changes nothing"];
  const has = (action) => list.some((row) => row && row.action === action);
  if (has("step")) parts.push("↵ never drops");
  if (has("stay")) parts.push("Alt+F stays");
  if (has("lessOften")) parts.push("L less often");
  if (has("reword")) parts.push("E rewords");
  if (has("drop")) parts.push("D / X drops");
  if (list.some((row) => row && String(row.action || "").startsWith("level:"))) {
    parts.push("1–4 pick a P-level");
  }
  if (has("step") || has("stay")) parts.push("Ctrl+Z undoes");
  return parts.join(" · ");
}
