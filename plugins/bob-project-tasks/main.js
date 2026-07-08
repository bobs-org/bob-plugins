const { Notice, Plugin, TFile } = require("obsidian");

const DEBOUNCE_MS = 250;
const PROJECT_TYPE = "[[project]]";
const TASK_COUNT_FIELD = "task_count";
const OPEN_TASK_COUNT_FIELD = "open_task_count";
const TEMPLATE_PATH_PREFIX = "_templates/";

const FRONTMATTER_DELIMITER_RE = /^\s*(?:---|\.\.\.)\s*$/;
const TASK_SECTION_HEADING_RE = /^ {0,3}##[ \t]+Tasks(?:[ \t].*)?$/i;
const LEVEL_TWO_HEADING_RE = /^ {0,3}##[ \t]+/;
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})/;
const TASK_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([^\]\n])\][ \t]+(.*)$/;
const TASK_TAG_RE = /(^|[\s([{])#task(?=$|[\s\])}:.,;!?])/;
const OPEN_TASK_STATUSES = new Set([" ", "/", "*"]);

function isMarkdownFile(file) {
  return file instanceof TFile && file.extension === "md";
}

function isTemplatePath(file) {
  return isMarkdownFile(file) && file.path.startsWith(TEMPLATE_PATH_PREFIX);
}

function isProjectType(value) {
  if (typeof value === "string") {
    return value.trim() === PROJECT_TYPE;
  }

  if (Array.isArray(value)) {
    return value.some((item) => isProjectType(item));
  }

  return false;
}

function isProjectFrontmatter(frontmatter) {
  return Boolean(frontmatter) && isProjectType(frontmatter.type);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function hasTaskCountFields(frontmatter) {
  return (
    hasOwn(frontmatter, TASK_COUNT_FIELD) ||
    hasOwn(frontmatter, OPEN_TASK_COUNT_FIELD)
  );
}

function frontmatterNumberEquals(value, expected) {
  if (typeof value === "number") {
    return value === expected;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed === expected;
  }

  return false;
}

function countFieldsMatch(frontmatter, counts) {
  return (
    frontmatterNumberEquals(frontmatter[TASK_COUNT_FIELD], counts.taskCount) &&
    frontmatterNumberEquals(
      frontmatter[OPEN_TASK_COUNT_FIELD],
      counts.openTaskCount,
    )
  );
}

function bodyLinesFromContent(content) {
  const lines = String(content || "").split(/\r?\n/);
  if (lines.length === 0 || !FRONTMATTER_DELIMITER_RE.test(lines[0])) {
    return lines;
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_DELIMITER_RE.test(lines[index])) {
      return lines.slice(index + 1);
    }
  }

  return lines;
}

function taskSectionLines(content) {
  const lines = bodyLinesFromContent(content);
  const startIndex = lines.findIndex((line) =>
    TASK_SECTION_HEADING_RE.test(line),
  );
  if (startIndex === -1) {
    return [];
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (LEVEL_TWO_HEADING_RE.test(lines[index])) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex + 1, endIndex);
}

function updateFenceState(state, line) {
  const match = FENCE_RE.exec(line);
  if (!match) {
    return state;
  }

  const marker = match[2];
  const markerChar = marker[0];
  if (state.inFence) {
    if (markerChar === state.markerChar && marker.length >= state.markerLength) {
      return { inFence: false, markerChar: "", markerLength: 0 };
    }
    return state;
  }

  return {
    inFence: true,
    markerChar,
    markerLength: marker.length,
  };
}

function countProjectTasks(content) {
  let taskCount = 0;
  let openTaskCount = 0;
  let fenceState = { inFence: false, markerChar: "", markerLength: 0 };

  for (const line of taskSectionLines(content)) {
    const nextFenceState = updateFenceState(fenceState, line);
    if (nextFenceState !== fenceState) {
      fenceState = nextFenceState;
      continue;
    }

    if (fenceState.inFence) {
      continue;
    }

    const taskMatch = TASK_LINE_RE.exec(line);
    if (!taskMatch || !TASK_TAG_RE.test(taskMatch[2])) {
      continue;
    }

    taskCount += 1;
    if (OPEN_TASK_STATUSES.has(taskMatch[1])) {
      openTaskCount += 1;
    }
  }

  return { taskCount, openTaskCount };
}

module.exports = class BobProjectTasksPlugin extends Plugin {
  onload() {
    this.pendingTimers = new Map();

    this.addCommand({
      id: "recount-all-project-tasks",
      name: "Recount all project tasks",
      callback: () => this.recountAllProjectTasks(),
    });

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => this.queueFile(file)),
    );

    this.register(() => this.clearPendingTimers());
  }

  onunload() {
    this.clearPendingTimers();
  }

  queueFile(file) {
    if (!isMarkdownFile(file) || isTemplatePath(file)) {
      return;
    }

    const existingTimer = this.pendingTimers.get(file.path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.pendingTimers.delete(file.path);
      this.refreshFile(file).catch((error) => {
        console.error("Failed to update project task counts", file.path, error);
      });
    }, DEBOUNCE_MS);

    this.pendingTimers.set(file.path, timer);
  }

  clearPendingTimers() {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }

  async recountAllProjectTasks() {
    const files =
      typeof this.app.vault.getMarkdownFiles === "function"
        ? this.app.vault.getMarkdownFiles()
        : this.app.vault.getFiles().filter((file) => isMarkdownFile(file));

    let projectCount = 0;
    let updatedCount = 0;
    let cleanedCount = 0;

    for (const file of files) {
      if (isTemplatePath(file)) {
        continue;
      }

      const result = await this.refreshFile(file);
      if (result.project) {
        projectCount += 1;
      }
      if (result.changed) {
        updatedCount += 1;
      }
      if (result.cleaned) {
        cleanedCount += 1;
      }
    }

    const cleanupText = cleanedCount ? `, ${cleanedCount} cleaned` : "";
    new Notice(
      `Recounted ${projectCount} project notes (${updatedCount} updated${cleanupText})`,
    );
  }

  async refreshFile(file) {
    if (!isMarkdownFile(file) || isTemplatePath(file)) {
      return { project: false, changed: false, cleaned: false };
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache && cache.frontmatter;

    if (!isProjectFrontmatter(frontmatter)) {
      if (!hasTaskCountFields(frontmatter)) {
        return { project: false, changed: false, cleaned: false };
      }

      await this.app.fileManager.processFrontMatter(file, (nextFrontmatter) => {
        delete nextFrontmatter[TASK_COUNT_FIELD];
        delete nextFrontmatter[OPEN_TASK_COUNT_FIELD];
      });
      return { project: false, changed: true, cleaned: true };
    }

    const content = await this.app.vault.cachedRead(file);
    const counts = countProjectTasks(content);
    if (countFieldsMatch(frontmatter, counts)) {
      return { project: true, changed: false, cleaned: false };
    }

    await this.app.fileManager.processFrontMatter(file, (nextFrontmatter) => {
      nextFrontmatter[TASK_COUNT_FIELD] = counts.taskCount;
      nextFrontmatter[OPEN_TASK_COUNT_FIELD] = counts.openTaskCount;
    });

    return { project: true, changed: true, cleaned: false };
  }
};
