// Task-merge writes through bob (`docs/task-relations.md` §21 ML1–ML8,
// the nav-merge phase of plan:202611/task_move_merge_split.md). The Links
// stage previews and commits a configured merge label through
// `bob task merge` JSON, the way `api.relationLabels.rename` runs
// `bob relations rename`. Desktop-only: elsewhere every call resolves
// `desktop_only` and writes nothing.
const TASK_MERGE_API_VERSION = 1;
const TASK_MERGE_API_VIA = "bob-ledger-tools";
const TASK_MERGE_MOBILE_MESSAGE = "⤵ merging needs the desktop app";

function taskMergeDecodeReport(stdout, stderr) {
  const label = "bob task merge";
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (_error) {
    return {
      ok: false,
      code: "unsupported",
      message: "Update bob to merge tasks.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "bad-shape",
      message: `${label} returned an unexpected JSON shape.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.schema_version !== TASK_MERGE_API_VERSION) {
    return {
      ok: false,
      code: "bad-version",
      message: `${label} returned an unsupported schema version.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok === false) {
    const error = body.error && typeof body.error === "object" && !Array.isArray(body.error)
      ? body.error
      : {};
    return {
      ok: false,
      code: typeof error.code === "string" && error.code ? error.code : "bob-error",
      message: typeof error.message === "string" && error.message
        ? error.message
        : `${label} reported an error.`,
      detail: statsFirstLine(stderr),
      error,
    };
  }
  if (!Array.isArray(body.merges)) {
    return {
      ok: false,
      code: "bad-shape",
      message: `${label} returned a report without merges.`,
      detail: statsFirstLine(stderr),
    };
  }
  return { ok: true, report: body };
}

// A vault task reference as the `bob task merge` locator spelling:
// `note:block-id` (the `.md` suffix is not part of the route).
function taskMergeLocatorText(ref) {
  const rawPath = String((ref && ref.path) || "").trim();
  const blockId = String((ref && ref.blockId) || "").trim();
  if (!rawPath || !blockId) return "";
  const note = rawPath.replace(/\.md$/u, "");
  if (!note) return "";
  return `${note}:${blockId}`;
}

function taskMergeLocatorList(refs) {
  const seen = new Set();
  const out = [];
  for (const ref of Array.isArray(refs) ? refs : []) {
    const locator = taskMergeLocatorText(ref);
    if (!locator || seen.has(locator)) continue;
    seen.add(locator);
    out.push(locator);
  }
  return out;
}

class BobLedgerToolsTaskMergeMixin {
  taskMergeApi() {
    if (!this.taskMergeApiValue) {
      const plugin = this;
      this.taskMergeApiValue = Object.freeze({
        version: TASK_MERGE_API_VERSION,
        preview: (sources, into, options) =>
          plugin.apiTaskMergePreview(sources, into, options),
        apply: (sources, into, picks, options) =>
          plugin.apiTaskMergeApply(sources, into, picks, options),
      });
    }
    return this.taskMergeApiValue;
  }

  taskMergeIsDesktop() {
    try {
      return typeof Platform !== "undefined" && Platform && Platform.isDesktopApp === true;
    } catch (_error) {
      return false;
    }
  }

  taskMergeSpawn(args) {
    if (!this.taskMergeIsDesktop()) {
      return Promise.resolve({
        ok: false,
        code: "desktop_only",
        message: TASK_MERGE_MOBILE_MESSAGE,
      });
    }
    return bobSpawnJson(args, taskMergeDecodeReport, {
      commandLabel: "bob task merge",
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () => this.statsVaultBasePath(),
      timeout: BOB_SPAWN_TIMEOUT_MS,
      maxBuffer: BOB_SPAWN_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  async apiTaskMergePreview(sources, into, options = {}) {
    try {
      const sourceLocators = taskMergeLocatorList(sources);
      const intoLocator = taskMergeLocatorText(into);
      if (sourceLocators.length === 0 || !intoLocator) {
        return { ok: false, code: "missing", message: "Merging needs source tasks and one target task." };
      }
      const opts = options && typeof options === "object" ? options : {};
      const args = ["task", "merge", "--dry-run", "-f", "json", "-i", intoLocator, ...sourceLocators];
      const result = await this.taskMergeSpawn(args);
      if (opts.via !== undefined && result && typeof result === "object") {
        return { ...result, via: TASK_MERGE_API_VIA };
      }
      return result;
    } catch (_error) {
      return { ok: false, code: "failed", message: "bob task merge preview failed." };
    }
  }

  async apiTaskMergeApply(sources, into, picks, options = {}) {
    try {
      const sourceLocators = taskMergeLocatorList(sources);
      const intoLocator = taskMergeLocatorText(into);
      if (sourceLocators.length === 0 || !intoLocator) {
        return { ok: false, code: "missing", message: "Merging needs source tasks and one target task." };
      }
      const list = Array.isArray(picks) ? picks : [];
      const keys = [];
      for (const pick of list) {
        const key = String((pick && pick.key) || "").trim();
        if (key && !keys.includes(key)) keys.push(key);
      }
      const args = ["task", "merge", "-o", "-f", "json", "-i", intoLocator, ...sourceLocators];
      if (keys.length > 0) {
        const at = args.indexOf("-i");
        args.splice(at, 0, "-p", keys.join(","));
      }
      return await this.taskMergeSpawn(args);
    } catch (_error) {
      return { ok: false, code: "failed", message: "bob task merge failed." };
    }
  }
}
