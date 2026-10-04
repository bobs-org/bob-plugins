function isSamePriorityRollTarget(cached, fresh) {
  if (!cached || !fresh || cached.kind !== fresh.kind) {
    return false;
  }
  if (cached.taskLine !== fresh.taskLine) {
    return false;
  }
  if (cached.kind === "decay") {
    return (
      normalizeBulletPropertyValue(
        cached.fromLevel && cached.fromLevel.label,
      ) ===
        normalizeBulletPropertyValue(
          fresh.fromLevel && fresh.fromLevel.label,
        ) &&
      normalizeBulletPropertyValue(cached.toLevel && cached.toLevel.label) ===
        normalizeBulletPropertyValue(fresh.toLevel && fresh.toLevel.label)
    );
  }
  if (cached.kind === "roll" || cached.kind === "cancel") {
    return (
      normalizeBulletPropertyValue(cached.level && cached.level.label) ===
      normalizeBulletPropertyValue(fresh.level && fresh.level.label)
    );
  }
  return false;
}

// What the *next* Ctrl+Enter would do after this recommendation is applied,
// for the notice's `next ^↵` chip. Null when the next press is a plain roll
// (or decay is disabled): no chip. Otherwise `{ next: "decay", nextLabel }`
// or `{ next: "cancel" }`.
function planNextPriorityRollHint(property, recommendation) {
  if (!property || !recommendation) {
    return null;
  }
  const levels = Array.isArray(property.levels) ? property.levels : [];
  if (recommendation.kind === "roll") {
    if (
      recommendation.limit === null ||
      recommendation.limit === undefined ||
      Number(recommendation.step) < Number(recommendation.limit)
    ) {
      return null;
    }
    const nextLevel = levels[recommendation.levelIndex + 1] || null;
    if (nextLevel && nextLevel.label) {
      return Object.freeze({
        next: "decay",
        nextLabel: normalizeBulletPropertyValue(nextLevel.label),
      });
    }
    return Object.freeze({ next: "cancel", nextLabel: "" });
  }
  if (recommendation.kind === "decay") {
    const newLimit = getPriorityLevelRollLimit(
      property,
      recommendation.toLevel,
    );
    if (newLimit === null || newLimit === undefined || 0 < newLimit) {
      return null;
    }
    const afterLevel = levels[recommendation.toLevelIndex + 1] || null;
    if (afterLevel && afterLevel.label) {
      return Object.freeze({
        next: "decay",
        nextLabel: normalizeBulletPropertyValue(afterLevel.label),
      });
    }
    return Object.freeze({ next: "cancel", nextLabel: "" });
  }
  return null;
}

const BULLET_PROPERTY_LOCAL_TASK_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["⇥"], label: "Mark" },
  { keys: ["↵"], label: "Link" },
  { keys: ["esc"], label: "Dismiss" },
];

const BULLET_PROPERTY_WEEKDAY_NAMES = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

// Vault-wide stage rows are keyed by `path#line` so marks never collide
// across notes; current-note rows keep their line-number keys.
function bulletPropertyTaskMarkKey(item) {
  if (!item) {
    return null;
  }
  if (
    item.markKey !== undefined &&
    item.markKey !== null &&
    item.markKey !== ""
  ) {
    return item.markKey;
  }
  return Number.isInteger(item.line) ? item.line : null;
}

function getBulletPropertyLocalTaskHints(hasMarks) {
  return BULLET_PROPERTY_LOCAL_TASK_HINTS.map((hint) => {
    if (!hint.keys.includes("↵")) {
      return hint;
    }

    return { ...hint, label: hasMarks ? "Apply" : "Link" };
  });
}

// Footer hints for the block-ID prompt. In batch mode the Enter action advances
// to the next pending prompt ("Next") until the final one, which applies the
// whole batch ("Apply all"). The single-task prompt keeps "Create & link".
function getBulletPropertyBlockIdHints(options = {}) {
  let label = "Create & link";
  if (options.batch) {
    label = options.last ? "Apply all" : "Next";
  } else if (options.counted) {
    label = "Create & apply";
  }

  return [
    { keys: ["↵"], label },
    { keys: ["esc"], label: "Cancel" },
  ];
}

// Title for the pinned Cancel row: `Cancel task` for one target, otherwise
// the open count. Link sessions say "linked task(s)".
function getCancelTaskRowTitle(description) {
  const open = Math.max(
    1,
    Math.floor(
      numericOrDefault(
        description && description.openCount,
        (description && description.count) || 1,
      ),
    ),
  );
  if (description && description.kind === "link") {
    return open <= 1 ? "Cancel linked task" : `Cancel ${open} linked tasks`;
  }
  return open <= 1 ? "Cancel task" : `Cancel ${open} tasks`;
}

// Footer hints for the cancel-reason prompt: Enter always confirms the stage
// (writing `[-]` + `[cancelled::]`, plus a log entry when a reason was typed
// or a fallback when the task already keeps a log), while Esc keeps the task
// open — hence "Keep open" instead of "Cancel".
function getCancelReasonHints(options = {}) {
  const count = Math.max(1, Math.floor(numericOrDefault(options.count, 1)));
  const plain = count === 1 ? "Cancel task" : "Cancel tasks";
  const enter = options.empty
    ? (options.fallback ? "Cancel & log 🤷" : plain)
    : "Cancel & log reason";
  return [
    { keys: ["↵"], label: enter },
    { keys: ["esc"], label: "Keep open" },
  ];
}

// Render a Lucide icon into `el` via Obsidian's setIcon, guarding against
// environments (e.g. the test harness) where setIcon is unavailable so the UI
// degrades to text-only instead of throwing.
function applyIcon(el, iconName) {
  if (!el) {
    return;
  }

  const setIcon = obsidian && obsidian.setIcon;
  if (typeof setIcon !== "function") {
    return;
  }

  try {
    setIcon(el, iconName);
  } catch (error) {
    // A missing/failed icon must never break rendering.
  }
}

// Append `text` to `el`, wrapping each case-insensitive occurrence of `query`
// in a `bob-cnp-hl` span. Uses text nodes / element helpers only (never
// innerHTML) so arbitrary note titles and paths cannot inject markup.
function appendHighlighted(el, text, query) {
  const source = String(text === null || text === undefined ? "" : text);
  if (!query) {
    el.appendText(source);
    return;
  }

  const lowerSource = source.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let index = 0;
  let matchIndex = lowerSource.indexOf(lowerQuery);

  if (matchIndex === -1) {
    el.appendText(source);
    return;
  }

  while (matchIndex !== -1) {
    if (matchIndex > index) {
      el.appendText(source.slice(index, matchIndex));
    }
    el.createSpan({
      cls: "bob-cnp-hl",
      text: source.slice(matchIndex, matchIndex + lowerQuery.length),
    });
    index = matchIndex + lowerQuery.length;
    matchIndex = lowerSource.indexOf(lowerQuery, index);
  }

  if (index < source.length) {
    el.appendText(source.slice(index));
  }
}

function isProjectType(value) {
  if (typeof value === "string") {
    return value.trim() === PROJECT_TYPE_WIKILINK;
  }

  if (Array.isArray(value)) {
    return value.some((item) => isProjectType(item));
  }

  return false;
}

function isAreaType(value) {
  if (typeof value === "string") {
    return value.trim() === AREA_TYPE_WIKILINK;
  }

  if (Array.isArray(value)) {
    return value.some((item) => isAreaType(item));
  }

  return false;
}

function stripSurroundingQuotes(value) {
  const text = String(value === null || value === undefined ? "" : value).trim();
  if (text.length < 2) {
    return text;
  }

  const first = text.charAt(0);
  const last = text.charAt(text.length - 1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return text.slice(1, -1).trim();
  }

  return text;
}

function stripSurroundingWikiLink(value) {
  const text = stripSurroundingQuotes(value);
  const match = /^\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|[^\]]*)?\]\]$/.exec(text);
  return match ? match[1].trim() : text;
}

function normalizeStatus(value) {
  const scalar = Array.isArray(value) ? value[0] : value;
  const text = stripSurroundingWikiLink(scalar);
  return text.trim().toLowerCase();
}

function formatProjectStatusLabel(statusKey) {
  const label = String(statusKey || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!label) {
    return "No status";
  }

  return label.charAt(0).toUpperCase() + label.slice(1);
}

const PROJECT_SCHEDULE_MONTHS = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]);

function projectScheduleLocalDate(validation) {
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(validation.year, validation.month - 1, validation.day);
  return date;
}

function isFutureInlineScheduledValue(value, today = new Date()) {
  const validation = validateProjectScheduledDate(value);
  if (!validation.valid) {
    return false;
  }
  return (
    compareLocalDates(
      projectScheduleLocalDate(validation),
      getLocalDateStart(today),
    ) > 0
  );
}

function getFutureProjectSchedule(value, now = new Date()) {
  const validation = validateProjectScheduledDate(value);
  if (!validation.valid) {
    return Object.freeze({
      scheduled: false,
      date: "",
      label: "",
    });
  }

  const scheduledDate = projectScheduleLocalDate(validation);
  const localToday = getLocalDateStart(now);
  if (compareLocalDates(scheduledDate, localToday) <= 0) {
    return Object.freeze({
      scheduled: false,
      date: "",
      label: "",
    });
  }

  const tomorrow = addLocalDateDays(localToday, 1);
  let label;
  if (compareLocalDates(scheduledDate, tomorrow) === 0) {
    label = "Tomorrow";
  } else {
    label = `${PROJECT_SCHEDULE_MONTHS[validation.month - 1]} ${validation.day}`;
    if (validation.year !== localToday.getFullYear()) {
      label += `, ${validation.year}`;
    }
  }

  return Object.freeze({
    scheduled: true,
    date: validation.value,
    label,
  });
}

function getProjectNoteInfo(frontmatter, now = new Date()) {
  const isProject = Boolean(frontmatter) && isProjectType(frontmatter.type);
  if (!isProject) {
    return {
      isProject: false,
      statusKey: "",
      label: "",
      emoji: "",
      icon: "file-text",
      variant: "",
      scheduled: false,
      scheduledDate: "",
      scheduledLabel: "",
    };
  }

  const schedule = getFutureProjectSchedule(frontmatter.scheduled, now);
  const normalizedStatus = normalizeStatus(frontmatter.status);
  const statusKey = PROJECT_STATUS_CANCELED_ALIASES.has(normalizedStatus)
    ? "canceled"
    : normalizedStatus;
  const presentation = PROJECT_STATUS_PRESENTATIONS[statusKey];
  if (presentation) {
    return {
      isProject: true,
      statusKey,
      label: presentation.label,
      emoji: presentation.emoji,
      icon: presentation.icon,
      variant: presentation.variant,
      scheduled: schedule.scheduled,
      scheduledDate: schedule.date,
      scheduledLabel: schedule.label,
    };
  }

  return {
    isProject: true,
    statusKey,
    label: formatProjectStatusLabel(statusKey),
    emoji: PROJECT_STATUS_FALLBACK.emoji,
    icon: PROJECT_STATUS_FALLBACK.icon,
    variant: PROJECT_STATUS_FALLBACK.variant,
    scheduled: schedule.scheduled,
    scheduledDate: schedule.date,
    scheduledLabel: schedule.label,
  };
}

function getChildNoteInfo(frontmatter, now = new Date()) {
  const projectInfo = getProjectNoteInfo(frontmatter, now);
  if (projectInfo.isProject) {
    return {
      kind: "project",
      decorated: true,
      statusKey: projectInfo.statusKey,
      label: projectInfo.label,
      emoji: projectInfo.emoji,
      icon: projectInfo.icon,
      variant: projectInfo.variant,
      scheduled: projectInfo.scheduled,
      scheduledDate: projectInfo.scheduledDate,
      scheduledLabel: projectInfo.scheduledLabel,
    };
  }

  if (Boolean(frontmatter) && isAreaType(frontmatter.type)) {
    return {
      kind: "area",
      decorated: true,
      statusKey: "",
      label: AREA_PRESENTATION.label,
      emoji: AREA_PRESENTATION.emoji,
      icon: AREA_PRESENTATION.icon,
      variant: AREA_PRESENTATION.variant,
      scheduled: false,
      scheduledDate: "",
      scheduledLabel: "",
    };
  }

  return {
    kind: "plain",
    decorated: false,
    statusKey: "",
    label: "",
    emoji: "",
    icon: "file-text",
    variant: "",
    scheduled: false,
    scheduledDate: "",
    scheduledLabel: "",
  };
}

function getFileChildNoteInfo(app, file, now = new Date()) {
  const frontmatter =
    app &&
    app.metadataCache &&
    typeof app.metadataCache.getFileCache === "function"
      ? app.metadataCache.getFileCache(file)?.frontmatter
      : null;
  return getChildNoteInfo(frontmatter, now);
}

function getChildNoteSummary(childFiles, noteInfoByPath) {
  let projectCount = 0;
  let areaCount = 0;
  let futureScheduledCount = 0;
  const statusCounts = new Map();

  childFiles.forEach((file) => {
    const info = noteInfoByPath.get(file.path);
    if (!info) {
      return;
    }

    if (info.kind === "area") {
      areaCount += 1;
      return;
    }

    if (info.kind !== "project") {
      return;
    }

    projectCount += 1;
    if (info.scheduled) {
      futureScheduledCount += 1;
    }
    const label = info.statusKey
      ? info.statusKey === "wip" ||
        info.statusKey === "done" ||
        info.statusKey === "canceled"
        ? info.statusKey
        : info.label.toLowerCase()
      : "no status";
    statusCounts.set(label, (statusCounts.get(label) || 0) + 1);
  });

  const parts = [];
  if (projectCount > 0) {
    parts.push(`${projectCount} project${projectCount === 1 ? "" : "s"}`);

    const orderedLabels = ["wip", "done", "canceled", "no status"];
    orderedLabels.forEach((label) => {
      const count = statusCounts.get(label);
      if (count) {
        parts.push(`${count} ${label}`);
        statusCounts.delete(label);
      }
    });

    Array.from(statusCounts.keys())
      .sort()
      .forEach((label) => {
        parts.push(`${statusCounts.get(label)} ${label}`);
      });

    if (futureScheduledCount > 0) {
      parts.push(
        `${futureScheduledCount} future-scheduled`,
      );
    }
  }

  if (areaCount > 0) {
    parts.push(`${areaCount} area${areaCount === 1 ? "" : "s"}`);
  }

  return parts;
}

function getChildNoteSearchText(file, noteInfo) {
  const parts = [file.path, file.basename];
  if (noteInfo && noteInfo.kind === "project") {
    parts.push("project", noteInfo.statusKey, noteInfo.label);
    if (noteInfo.scheduled) {
      parts.push(
        "scheduled",
        noteInfo.scheduledDate,
        noteInfo.scheduledLabel,
      );
    }
    if (noteInfo.statusKey === "canceled") {
      parts.push("cancelled");
    }
  } else if (noteInfo && noteInfo.kind === "area") {
    parts.push("area", noteInfo.label);
  }

  return parts
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")
    .toLowerCase();
}

function childNoteMatchesQuery(file, noteInfo, query) {
  return getChildNoteSearchText(file, noteInfo).includes(query);
}

// Release-task summary modal for Alt+N: asks once for an optional Work Log
// summary when releasing an In Progress task. Worded like block-id-prompt's
// "Unlink task" prompt but titled "Release task". Escape cancels the whole
// gesture; a blank submit releases without a log.
class LaneReleaseSummaryModal extends Modal {
  constructor(app, onDone) {
    super(app);
    this.onDone = onDone;
    this.completed = false;
    this.inputEl = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createDiv({ cls: "bob-lane-release-title", text: "Release task" });
    contentEl.createDiv({
      cls: "bob-lane-release-subtitle",
      text: "Optional: why is this pending? Saved to the Work Log.",
    });
    this.inputEl = contentEl.createEl("input", {
      attr: {
        placeholder: "What did you get done?",
        type: "text",
      },
    });
    const row = contentEl.createDiv({ cls: "bob-lane-release-actions" });
    const cancelBtn = row.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
    const releaseBtn = row.createEl("button", { text: "Release" });
    releaseBtn.addEventListener("click", () => this.submit());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        this.submit();
      }
    });
    window.setTimeout(() => {
      if (this.inputEl) {
        this.inputEl.focus();
      }
    }, 0);
  }

  submit() {
    this.completed = true;
    const value = this.inputEl ? this.inputEl.value : "";
    try {
      if (typeof this.onDone === "function") {
        this.onDone(String(value || ""));
      }
    } finally {
      this.close();
    }
  }

  onClose() {
    contentElCleanup(this.contentEl);
    if (!this.completed && typeof this.onDone === "function") {
      try {
        this.onDone(null);
      } catch (error) {
        // Best effort.
      }
    }
    this.onDone = null;
  }
}

// Alt+F / Alt+Shift+F summary stage for Pending tasks. This is deliberately
// separate from both lane release and scheduling: the refresh gesture only
// stamps the task and optionally prepends a Work Log entry.
class FreshnessRefreshSummaryModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options || {};
    this.onDone = this.options.onDone;
    this.completed = false;
    this.inputEl = null;
    this.previewEl = null;
    this.hintsEl = null;
    this.refreshButton = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bob-cnp-modal");
    contentEl.addClass("bob-cnp");
    const totalCount = Math.max(
      1,
      Math.floor(numericOrDefault(this.options.totalCount, 1)),
    );
    const eligibleCount = Math.max(
      0,
      Math.floor(numericOrDefault(this.options.eligibleCount, totalCount)),
    );
    const taskWord = totalCount === 1 ? "task" : "tasks";
    const header = contentEl.createDiv({ cls: "bob-cnp-header" });
    const headerIcon = header.createDiv({ cls: "bob-cnp-header-icon" });
    applyIcon(headerIcon, "refresh-cw");
    const headerText = header.createDiv({ cls: "bob-cnp-header-text" });
    headerText.createDiv({
      cls: "bob-cnp-title",
      text: totalCount === 1 ? "Refresh task" : `Refresh ${totalCount} tasks`,
    });
    const subtitleParts = [];
    if (eligibleCount !== totalCount) {
      subtitleParts.push(`${eligibleCount} of ${totalCount} ${taskWord} qualify`);
    }
    subtitleParts.push("nothing written yet");
    headerText.createDiv({
      cls: "bob-cnp-subtitle",
      text: subtitleParts.join(" · "),
    });
    const inputWrap = contentEl.createDiv({ cls: "bob-cnp-search" });
    const inputIcon = inputWrap.createDiv({ cls: "bob-cnp-search-icon" });
    applyIcon(inputIcon, "briefcase");
    this.inputEl = inputWrap.createEl("input", {
      cls: "bob-cnp-input",
      attr: {
        "aria-label": "Work summary",
        placeholder: "What did you get done? (optional · ↵ to skip)",
        type: "text",
      },
    });
    this.previewEl = contentEl.createDiv({ cls: "bob-cnp-results" });
    this.hintsEl = contentEl.createDiv({ cls: "bob-cnp-footer" });
    this.inputEl.addEventListener("input", () => this.renderPreview());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        this.submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    });
    const actions = contentEl.createDiv({ cls: "bob-cnp-modal-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.close());
    this.refreshButton = actions.createEl("button", { text: "Refresh" });
    this.refreshButton.addEventListener("click", () => this.submit());
    this.renderPreview();
    window.setTimeout(() => {
      if (this.inputEl) {
        this.inputEl.focus();
      }
    }, 0);
  }

  renderPreview() {
    if (!this.previewEl || !this.inputEl) {
      return;
    }
    const summary = normalizeLaneWorkSummary(this.inputEl.value);
    const hasInlineField = summary.includes("::");
    this.previewEl.empty();
    const row = this.previewEl.createDiv({
      cls: "bob-cnp-row bob-cnp-schedule-reason-row",
    });
    addElementClasses(
      row,
      summary ? (hasInlineField ? "is-warning" : "is-valid") : "is-empty",
    );
    const icon = row.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(icon, summary ? (hasInlineField ? "alert-triangle" : "check-circle-2") : "minus-circle");
    const text = row.createDiv({ cls: "bob-cnp-row-text" });
    text.createDiv({
      cls: "bob-cnp-row-title",
      text: summary
        ? formatLaneWorkLogEntry(
            summary,
            String(this.options.dateText || ""),
          )
        : "No summary",
    });
    if (hasInlineField) {
      text.createDiv({
        cls: "bob-cnp-row-meta",
        text: '"::" creates a Dataview inline field on this bullet',
      });
    }
    const eligibleCount = Math.max(
      1,
      Math.floor(numericOrDefault(this.options.eligibleCount, 1)),
    );
    text.createDiv({
      cls: "bob-cnp-schedule-reason-preview",
      text: summary
        ? eligibleCount === 1
          ? "Prepends under 🛠️ **WORK LOG** on the qualifying task"
          : `Prepends under 🛠️ **WORK LOG** on each of the ${eligibleCount} qualifying tasks`
        : "Refresh only; no Work Log entry",
    });
    if (this.hintsEl) {
      this.hintsEl.empty();
      const enter = this.hintsEl.createSpan({ cls: "bob-cnp-hint" });
      enter.createEl("kbd", { cls: "bob-cnp-kbd", text: "↵" });
      enter.createSpan({
        cls: "bob-cnp-hint-label",
        text: summary ? "Refresh & log summary" : "Refresh without a summary",
      });
      const escape = this.hintsEl.createSpan({ cls: "bob-cnp-hint" });
      escape.createEl("kbd", { cls: "bob-cnp-kbd", text: "esc" });
      escape.createSpan({ cls: "bob-cnp-hint-label", text: "Cancel" });
    }
  }

  submit() {
    if (this.completed) {
      return;
    }
    this.completed = true;
    const value = this.inputEl ? this.inputEl.value : "";
    try {
      if (typeof this.onDone === "function") {
        this.onDone(String(value || ""));
      }
    } finally {
      this.close();
    }
  }

  onClose() {
    contentElCleanup(this.contentEl);
    if (!this.completed && typeof this.onDone === "function") {
      try {
        this.onDone(null);
      } catch (error) {
        // Best effort.
      }
    }
    this.onDone = null;
  }
}

function contentElCleanup(contentEl) {
  try {
    if (contentEl && typeof contentEl.empty === "function") {
      contentEl.empty();
    }
  } catch (error) {
    // Best effort.
  }
}

// Footer hints for the lane-release reason stage: Enter confirms (releasing
// plus a Work Log entry when a summary was typed), Esc cancels the release.
function getLaneReleaseReasonHints(options = {}) {
  const enter = options.empty ? "Release without a summary" : "Release & log summary";
  return [
    { keys: ["↵"], label: enter },
    { keys: ["esc"], label: "Cancel" },
  ];
}

function getSchedulingWorkLogHints(options = {}) {
  const enter = options.empty ? "Schedule without a summary" : "Schedule & log summary";
  return [
    { keys: ["↵"], label: enter },
    { keys: ["esc"], label: "Cancel" },
  ];
}

function formatSchedulingWorkLogDateSpan(dates) {
  const values = Array.from(dates || [])
    .map((date) => normalizeBulletPropertyValue(date))
    .filter(Boolean)
    .sort();
  if (values.length === 0) {
    return "";
  }
  if (values.length === 1 || values[0] === values[values.length - 1]) {
    return `scheduled → ${values[0]}`;
  }
  return `scheduled → ${values[0]} → ${values[values.length - 1]}`;
}

