// Roll preview for review-walk landings and `api.quickRoll` v1
// (plan 202610/quick_roll_alt_p.md, phase review-preview). One shared
// recommendation planner plus the concise preview model. Everything here is
// pure except the memoized config loader and the plugin mixin at the bottom:
// previews never write, never throw, and never show a Notice.

// Shared planner behind the Task Card Ctrl+Enter recommendation and every
// preview surface. Same inputs and outputs as the body of
// `computePriorityRollRecommendation` (390), parameterized so landings and
// `api.quickRoll` can plan without a picker. Returns the frozen
// recommendation with `priorityName`, `schedulesName`, and `taskLine`, or
// null when the line has no roll recommendation.
function planPriorityRollRecommendationAtLine(options = {}) {
  const config = options.config || null;
  const content = String(options.content || "");
  const line = options.line;
  if (!Number.isInteger(line) || line < 0) {
    return null;
  }
  if (!isObsidianTaskAtLine(content, line)) {
    return null;
  }
  const lines = splitMarkdownContent(content).lines;
  const lineText = lines[line] || "";
  if (!OPEN_OBSIDIAN_TASK_STATUSES.has(getObsidianTaskCheckboxStatus(lineText))) {
    return null;
  }
  const properties =
    config && Array.isArray(config.properties) ? config.properties : [];
  const liveContext = getProjectNotePropertyContext(content, line);
  for (const priorityProperty of properties) {
    if (!priorityProperty || priorityProperty.values !== "priority") {
      continue;
    }
    const schedulesName = normalizeBulletPropertyName(
      priorityProperty.schedules,
    );
    if (!schedulesName) {
      continue;
    }
    const scheduledTarget = resolveBulletPropertyTarget(
      schedulesName,
      liveContext,
    );
    let currentScheduled = "";
    if (scheduledTarget.kind === "project-inline") {
      const scheduledField = findBulletPropertyField(lineText, schedulesName);
      currentScheduled = scheduledField ? scheduledField.value : "";
    } else {
      const scheduledField = findBulletPropertyField(lineText, schedulesName);
      currentScheduled = scheduledField ? scheduledField.value : "";
    }
    const planned = planPriorityRollRecommendation({
      property: priorityProperty,
      content,
      taskLine: line,
      currentScheduled,
      baseDate: options.baseDate,
      random: options.random,
    });
    if (!planned) {
      continue;
    }
    return Object.freeze({
      ...planned,
      priorityName: priorityProperty.name,
      schedulesName,
      taskLine: line,
    });
  }
  return null;
}

// Short window from the level the date is drawn from (the current level for
// a roll, the target level for a decay): `8–30d`, `8d` for a one-day
// window, and "" when the level has no bounds. En dash, never a date.
function formatQuickRollWindow(level) {
  const bounds = getPriorityRollBounds(level);
  if (!bounds) {
    return "";
  }
  if (bounds.minDays === bounds.maxDays) {
    return `${bounds.minDays}d`;
  }
  return `${bounds.minDays}–${bounds.maxDays}d`;
}

// Long window for the tooltip/detail sentence: `8–30 days out`.
function formatQuickRollWindowDays(level) {
  const bounds = getPriorityRollBounds(level);
  if (!bounds) {
    return "";
  }
  if (bounds.minDays === bounds.maxDays) {
    return `${bounds.minDays} days out`;
  }
  return `${bounds.minDays}–${bounds.maxDays} days out`;
}

// Concise preview of exactly what Alt+P would do, from the same
// recommendation the key uses. Frozen `{ ok: true, kind, line, compact,
// detail }`, or frozen `{ ok: false, reason }` for unavailable, no
// priority, closed, and non-task lines. `cancelConfirms` selects the
// confirm (default) or immediate-cancel strings.
function planQuickRollPreview(recommendation, options = {}) {
  const rawLabel = options.keyLabel;
  const keyLabel =
    typeof rawLabel === "string" && rawLabel ? rawLabel : QUICK_ROLL_KEY_LABEL;
  const cancelConfirms =
    options.cancelConfirms === undefined ? true : options.cancelConfirms === true;
  if (!recommendation || typeof recommendation.kind !== "string") {
    return Object.freeze({ ok: false, reason: "no-recommendation" });
  }
  const kind = recommendation.kind;
  if (kind === "roll") {
    const label = normalizeBulletPropertyValue(
      recommendation.level && recommendation.level.label,
    );
    if (!label) {
      return Object.freeze({ ok: false, reason: "no-level" });
    }
    const limit = recommendation.limit;
    const step = recommendation.step;
    const hasLimit =
      limit !== null &&
      limit !== undefined &&
      Number.isFinite(Number(step));
    const window = formatQuickRollWindow(recommendation.level);
    const windowDays = formatQuickRollWindowDays(recommendation.level);
    let compact = "";
    let detail = "";
    if (hasLimit) {
      compact = `${keyLabel} roll ${label} ${step}/${limit}`;
      detail = windowDays
        ? `${keyLabel}: roll ${label} again (${step} of ${limit}), ${windowDays}`
        : `${keyLabel}: roll ${label} again (${step} of ${limit})`;
    } else {
      compact = `${keyLabel} roll ${label}`;
      detail = windowDays
        ? `${keyLabel}: roll ${label} again, ${windowDays}`
        : `${keyLabel}: roll ${label} again`;
    }
    return Object.freeze({
      ok: true,
      kind: "roll",
      line: window ? `${compact} · ${window}` : compact,
      compact,
      detail,
    });
  }
  if (kind === "decay") {
    const fromLabel = normalizeBulletPropertyValue(
      recommendation.fromLevel && recommendation.fromLevel.label,
    );
    const toLabel = normalizeBulletPropertyValue(
      recommendation.toLevel && recommendation.toLevel.label,
    );
    if (!fromLabel || !toLabel) {
      return Object.freeze({ ok: false, reason: "no-level" });
    }
    const window = formatQuickRollWindow(recommendation.toLevel);
    const windowDays = formatQuickRollWindowDays(recommendation.toLevel);
    const compact = `${keyLabel} decay ${fromLabel}→${toLabel}`;
    return Object.freeze({
      ok: true,
      kind: "decay",
      line: window
        ? `${keyLabel} decay ${fromLabel} → ${toLabel} · ${window}`
        : `${keyLabel} decay ${fromLabel} → ${toLabel}`,
      compact,
      detail: windowDays
        ? `${keyLabel}: decay ${fromLabel} → ${toLabel}, ${windowDays}`
        : `${keyLabel}: decay ${fromLabel} → ${toLabel}`,
    });
  }
  if (kind === "cancel") {
    const label = normalizeBulletPropertyValue(
      recommendation.level && recommendation.level.label,
    );
    if (!label) {
      return Object.freeze({ ok: false, reason: "no-level" });
    }
    if (cancelConfirms) {
      return Object.freeze({
        ok: true,
        kind: "cancel",
        line: `${keyLabel} cancel? · decayed past ${label}`,
        compact: `${keyLabel} cancel?`,
        detail: `${keyLabel}: cancel — decayed past ${label} (confirm on the Task Card)`,
      });
    }
    return Object.freeze({
      ok: true,
      kind: "cancel",
      line: `${keyLabel} cancel · decayed past ${label}`,
      compact: `${keyLabel} cancel`,
      detail: `${keyLabel}: cancel — decayed past ${label}`,
    });
  }
  return Object.freeze({ ok: false, reason: "unavailable" });
}

let quickRollPreviewConfigCache = { key: null, value: undefined };

function resetQuickRollPreviewConfigCache() {
  quickRollPreviewConfigCache = { key: null, value: undefined };
}

// Config for preview planning: silent on every failure path (no Notice
// ever) and memoized by the config file's mtime/size, so an edit takes
// effect on the next landing. Missing or broken config yields null.
function loadQuickRollPreviewConfig(options = {}) {
  const fsModule =
    options.fsModule === undefined
      ? requireOptionalNodeModule("fs")
      : options.fsModule;
  const configPath =
    options.configPath ||
    getBulletPropertyConfigPath({
      env: options.env,
      osModule: options.osModule,
    });
  let statKey = null;
  try {
    statKey =
      fsModule && typeof fsModule.statSync === "function"
        ? blocksLinesConfigStatKey(fsModule, configPath)
        : null;
  } catch (error) {
    statKey = null;
  }
  const key = statKey == null ? null : `${configPath}|${statKey}`;
  if (key != null && quickRollPreviewConfigCache.key === key) {
    return quickRollPreviewConfigCache.value;
  }
  let config = null;
  try {
    config = loadBulletPropertyConfig({ ...options, showNotice: () => {} });
  } catch (error) {
    config = null;
  }
  if (key != null) {
    quickRollPreviewConfigCache = { key, value: config };
  }
  return config;
}

// Preview for one 0-based review-queue line. The tier gate lives here so
// the toast and the footer share it: PRE/POST checklist rows never preview.
// Accepts `content` or `lines`; `config` loads silently when omitted. The
// date is unused, so planning runs with a constant random. Never throws.
function quickRollPreviewForLine(options = {}) {
  try {
    const tier =
      typeof options.tier === "string"
        ? options.tier.trim().toLowerCase()
        : "";
    if (tier === "pre" || tier === "post") {
      return Object.freeze({ ok: false, reason: "checklist-tier" });
    }
    const config =
      options.config === undefined
        ? loadQuickRollPreviewConfig()
        : options.config;
    if (!config) {
      return Object.freeze({ ok: false, reason: "no-config" });
    }
    let content = "";
    if (typeof options.content === "string") {
      content = options.content;
    } else if (Array.isArray(options.lines)) {
      content = options.lines.join("\n");
    }
    const line = options.line;
    if (!Number.isInteger(line)) {
      return Object.freeze({ ok: false, reason: "no-line" });
    }
    const recommendation = planPriorityRollRecommendationAtLine({
      config,
      content,
      line,
      baseDate: options.baseDate instanceof Date ? options.baseDate : new Date(),
      random: () => 0,
    });
    return planQuickRollPreview(recommendation, {
      keyLabel: options.keyLabel,
      cancelConfirms: options.cancelConfirms,
    });
  } catch (error) {
    return Object.freeze({ ok: false, reason: "preview-failed" });
  }
}

// Append the preview as the last toast line, after everything the notice
// already contains (including a wrapped tail or a POST tail). An empty
// preview line leaves the notice byte-for-byte unchanged.
function appendQuickRollLine(notice, line) {
  const text = String(notice || "");
  const tail = String(line || "");
  if (!tail) {
    return text;
  }
  if (!text) {
    return tail;
  }
  return `${text}\n${tail}`;
}

// Additive nav `api.quickRoll` v1: `{ version: 1, keyLabel, preview }`.
// `preview({ content | lines, line, tier })` is synchronous and never
// throws. With a null plugin (after unload) it reports `unavailable`.
function createQuickRollApi(plugin) {
  if (!plugin) {
    return Object.freeze({
      version: 1,
      keyLabel: QUICK_ROLL_KEY_LABEL,
      preview: () => Object.freeze({ ok: false, reason: "unavailable" }),
    });
  }
  return Object.freeze({
    version: 1,
    keyLabel: QUICK_ROLL_KEY_LABEL,
    preview: (args = {}) => {
      try {
        let content = "";
        if (args && typeof args.content === "string") {
          content = args.content;
        } else if (args && Array.isArray(args.lines)) {
          content = args.lines.join("\n");
        }
        return quickRollPreviewForLine({
          content,
          line: args ? args.line : undefined,
          tier: args ? args.tier : undefined,
        });
      } catch (error) {
        return Object.freeze({ ok: false, reason: "preview-failed" });
      }
    },
  });
}

class BobNavigationHotkeysQuickRollPreviewMixin {
  // Preview line for a landed review entry, or "" when the row has no
  // recommended roll. Reads the landed note from the active editor when it
  // shows the entry, else via `vault.cachedRead`. Never throws.
  async reviewQuickRollLine(entry) {
    try {
      const path =
        entry && typeof entry.path === "string" ? entry.path : "";
      if (!path) {
        return "";
      }
      let content = null;
      try {
        const activeView =
          typeof this.getActiveMarkdownView === "function"
            ? this.getActiveMarkdownView()
            : null;
        const activeEditor = activeView && activeView.editor;
        if (
          activeView &&
          activeView.file &&
          activeView.file.path === path &&
          activeEditor &&
          typeof activeEditor.getValue === "function"
        ) {
          content = String(activeEditor.getValue() || "");
        } else {
          const vault = this.app && this.app.vault;
          const file =
            vault && typeof vault.getAbstractFileByPath === "function"
              ? vault.getAbstractFileByPath(path)
              : null;
          if (!file || !vault || typeof vault.cachedRead !== "function") {
            return "";
          }
          content = String((await vault.cachedRead(file)) || "");
        }
      } catch (error) {
        return "";
      }
      const resolved = resolveReviewQueueLine(content, entry);
      if (!resolved || resolved.ok !== true) {
        return "";
      }
      const preview = quickRollPreviewForLine({
        content,
        line: resolved.line,
        tier: reviewEntryMachineTier(entry),
      });
      if (!preview || preview.ok !== true) {
        return "";
      }
      return preview.line || "";
    } catch (error) {
      return "";
    }
  }
}
