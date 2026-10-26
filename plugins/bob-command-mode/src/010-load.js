// Bob Command Mode: shared requires, injection points, and constants.
// Fragments share one script scope; every helper here is file-scoped on purpose.
const {
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} = require("obsidian");

// Run record schema version written into every <id>.json file.
const CM_RECORD_SCHEMA = 1;
// api.commandMode version exposed to other plugins.
const CM_API_VERSION = 1;
// Protocol version requested from `bob __catalog`.
const CM_CATALOG_PROTOCOL = 1;
// Catalog fetch limits: `bob __catalog` must answer fast and small.
const CM_CATALOG_TIMEOUT_MS = 5000;
const CM_CATALOG_MAX_BYTES = 8 * 1024 * 1024;
// Live-tail polling cadence while a run is active.
const CM_TAIL_POLL_MS = 150;
// In-memory cap per stream; files keep everything, the pager links to the log.
const CM_MEM_CAP_BYTES = 4 * 1024 * 1024;
// Kill grace periods: reads after a budget timeout, explicit stops.
const CM_READ_KILL_GRACE_MS = 3000;
const CM_STOP_KILL_GRACE_MS = 5000;
// Adoption polling cadence for records left unfinished by a previous instance.
const CM_ADOPT_POLL_MS = 1000;
// Reader parallelism; writers always run one at a time.
const CM_MAX_PARALLEL_READS = 4;
// Retention defaults, both overridable in settings.
const CM_DEFAULT_KEEP_RUNS = 50;
const CM_DEFAULT_KEEP_DAYS = 14;
// Catalog-advertised feature flags honored when building the child env.
const CM_FEATURE_COLOR = "clicolor-force";
const CM_FEATURE_PROGRESS = "progress-env";
const CM_FEATURE_RECEIPT = "run-receipt";
// bob's lock contention line; matched case-insensitively.
const CM_LOCK_PHRASE = "another Bob vault maintenance run is already active";
// Workspace event fired for every finished run.
const CM_RUN_FINISHED_EVENT = "bob-command-mode:run-finished";
// Directory (under the state root) holding per-run files.
const CM_RUNS_DIRNAME = "command-mode/runs";

// Lazily loaded Node modules. Direct require calls keep the fragments working
// under Obsidian and under plain Node tests; tests may inject fakes instead.
let CmChildProcess = null;
let CmFileSystem = null;
let CmOperatingSystem = null;
let CmPathModule = null;

function cmChildProcess() {
  if (!CmChildProcess) CmChildProcess = require("child_process");
  return CmChildProcess;
}

function cmFs() {
  if (!CmFileSystem) CmFileSystem = require("fs");
  return CmFileSystem;
}

function cmOs() {
  if (!CmOperatingSystem) CmOperatingSystem = require("os");
  return CmOperatingSystem;
}

function cmPath() {
  if (!CmPathModule) CmPathModule = require("path");
  return CmPathModule;
}

function cmIsDesktopApp() {
  try {
    if (typeof process === "undefined" || !process.platform) return true;
    return process.platform !== "win32";
  } catch (error) {
    return true;
  }
}
