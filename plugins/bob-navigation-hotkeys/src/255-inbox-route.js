// Inbox routing core (route-core): pure, Obsidian-free helpers for routing
// tasks out of inbox notes. Nothing here touches the vault, the editor, or
// the walk; the plugin mixin (`655-plugin-inbox-route.js`) and the route
// picker modal (`205-inbox-route-picker-modal.js`) consume these. Nothing
// here throws.
const INBOX_NOTE_PATH = "inbox.md";

const INBOX_ROUTE_TASK_SUBTITLE_LIMIT = 80;

// A note is an inbox note when it is the inbox note itself (`inbox.md` at
// the vault root) or an area note whose frontmatter `parent` resolves to
// it. Only direct children count: a project filed under an inbox is not an
// inbox note. `inboxFile` is the vault file for `inbox.md` (null when the
// vault has none) and `pointsToInbox(frontmatter)` resolves the note's
// `parent` field against it. Never cached across gestures.
function classifyInboxNote(note, inboxFile, pointsToInbox) {
  try {
    const path = normalizeVaultRelativePath(note && note.path);
    if (!path) {
      return false;
    }
    if (path === INBOX_NOTE_PATH) {
      return true;
    }
    if (
      !inboxFile ||
      normalizeVaultRelativePath(inboxFile.path) !== INBOX_NOTE_PATH ||
      typeof pointsToInbox !== "function"
    ) {
      return false;
    }
    const info = getChildNoteInfo(note && note.frontmatter);
    if (!info || info.kind !== "area") {
      return false;
    }
    return pointsToInbox(note && note.frontmatter) === true;
  } catch (error) {
    return false;
  }
}

// Identity text for one task line: the display description with inline
// fields, status, and block ID stripped, so a re-discovered line still
// matches after an action rewrote its metadata.
function normalizeInboxRouteTaskIdentity(line) {
  try {
    return cleanTaskDisplayText(line);
  } catch (error) {
    return String(line || "").trim();
  }
}

// Snapshot the pre-gesture identity of route targets
// (`discoverMovableObsidianTaskTargets` rows): `{ line, raw, blockId, text }`.
function captureInboxRouteExpected(targets) {
  const list = Array.isArray(targets) ? targets : [];
  return Object.freeze(
    list.map((target) => {
      const raw = String((target && (target.rawLine ?? target.raw)) || "");
      let blockId = null;
      try {
        blockId = getTrailingBlockId(raw);
      } catch (error) {
        blockId = null;
      }
      return Object.freeze({
        line: target && Number.isInteger(target.line) ? target.line : null,
        raw,
        blockId,
        text: normalizeInboxRouteTaskIdentity(raw),
      });
    }),
  );
}

// Verify re-discovered route targets against the pre-gesture snapshot: same
// count, and the same block ID when one existed, otherwise the same task
// description. Never guesses: any mismatch refuses.
function verifyInboxRouteTargets(expected, rediscovered) {
  try {
    const want = Array.isArray(expected) ? expected : [];
    const got = Array.isArray(rediscovered) ? rediscovered : [];
    if (want.length === 0 || want.length !== got.length) {
      return false;
    }
    for (let index = 0; index < want.length; index += 1) {
      const entry = want[index] || {};
      const found = got[index] || {};
      const raw = String(found.rawLine ?? found.raw ?? "");
      if (!raw) {
        return false;
      }
      const wantId = entry.blockId || null;
      if (wantId) {
        let gotId = null;
        try {
          gotId = getTrailingBlockId(raw);
        } catch (error) {
          gotId = null;
        }
        if (gotId !== wantId) {
          return false;
        }
        continue;
      }
      if (normalizeInboxRouteTaskIdentity(raw) !== String(entry.text || "")) {
        return false;
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Route destinations are the task-move destinations minus every inbox note.
// The source and template notes are dropped too, so a raw file list still
// routes safely. `isInbox(path, entry)` mirrors `isInboxNotePath`.
function filterInboxRouteDestinations(destinations, isInbox, sourcePath) {
  const source = normalizeVaultRelativePath(sourcePath || "");
  const test = typeof isInbox === "function" ? isInbox : null;
  return Object.freeze(
    (Array.isArray(destinations) ? destinations : []).filter((entry) => {
      const path = normalizeVaultRelativePath(entry && entry.file && entry.file.path);
      if (!path) {
        return false;
      }
      if (source && path === source) {
        return false;
      }
      if (TASK_MOVE_TEMPLATE_PATHS.has(path)) {
        return false;
      }
      if (test) {
        let inbox = false;
        try {
          inbox = test(path, entry) === true;
        } catch (error) {
          inbox = true;
        }
        if (inbox) {
          return false;
        }
      }
      return true;
    }),
  );
}

// Preflight a route against live source content and a destination snapshot:
// destination still an area or open project, a `## Tasks` section where a
// project needs one, and no block-ID collision, counting block IDs the
// pending action is about to assign (`reservedBlockIds`). Wraps
// `planTaskMoveAcrossFiles` with empty `otherContents` and adds the
// reserved-ID collision check. Returns `{ ok, reason }`.
function preflightInboxRoute(options = {}) {
  try {
    const reserved =
      options.reservedBlockIds instanceof Set
        ? options.reservedBlockIds
        : new Set(options.reservedBlockIds || []);
    if (reserved.size > 0) {
      const destinationIds = collectTaskMoveBlockIds(options.destinationContent);
      for (const id of reserved) {
        if (id && destinationIds.has(id)) {
          return Object.freeze({
            ok: false,
            reason: `Destination already contains block ID: ${id}`,
          });
        }
      }
    }
    const plan = planTaskMoveAcrossFiles({
      sourcePath: options.sourcePath,
      destinationPath: options.destinationPath,
      sourceContent: options.sourceContent,
      destinationContent: options.destinationContent,
      otherContents: new Map(),
      targets: options.targets,
      stampLine: options.stampLine,
      freshDateText: options.freshDateText,
    });
    if (!plan.valid) {
      return Object.freeze({ ok: false, reason: plan.error });
    }
    return Object.freeze({ ok: true, reason: null });
  } catch (error) {
    return Object.freeze({ ok: false, reason: "Route preflight failed" });
  }
}

// Short lower-case action label for the route picker subtitle and footer,
// for example `set P2`, `schedule Fri Oct 9`, or `link to today`. Gates
// pass `{ label }` (or a plain string); `{ verb, detail }` composes.
function formatInboxRouteActionLabel(action) {
  if (typeof action === "string") {
    const text = action.trim();
    return text || "apply";
  }
  if (action && typeof action === "object") {
    if (typeof action.label === "string" && action.label.trim()) {
      return action.label.trim();
    }
    const verb = String(action.verb || "").trim();
    const detail = String(action.detail || "").trim();
    if (verb && detail) {
      return `${verb} ${detail}`;
    }
    if (verb) {
      return verb;
    }
  }
  return "apply";
}

// Move notice appended after a routed action: `Moved to <dest>`,
// counted `Moved <N> tasks to <dest>`.
function formatInboxRouteMoveNotice(options = {}) {
  const name = String(options.destinationName || "destination");
  const count = Math.max(1, Math.floor(numericOrDefault(options.count, 1)) || 1);
  if (count === 1) {
    return `Moved to ${name}`;
  }
  return `Moved ${count} tasks to ${name}`;
}

function truncateInboxRouteText(text, limit = INBOX_ROUTE_TASK_SUBTITLE_LIMIT) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= limit) {
    return cleaned || "(untitled task)";
  }
  return `${cleaned.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

// Picker subtitle: `<task text, cleaned and truncated> · then <action>`,
// counted `<N> tasks · then <action>`.
function formatInboxRouteTaskSubtitle(options = {}) {
  const count = Math.max(1, Math.floor(numericOrDefault(options.count, 1)) || 1);
  const head =
    count === 1
      ? truncateInboxRouteText(options.taskText)
      : `${count} tasks`;
  return `${head} · then ${formatInboxRouteActionLabel(options.actionLabel)}`;
}

// nav `inboxRoute` v1 (`docs/task-dependencies.md` §9, additive): the
// inbox-routing contract for Ctrl+Shift+P and Ctrl+Shift+Enter gates.
// `api.version` stays 3; consumers feature-detect
// `api.inboxRoute?.version >= 1`. `isInboxNote` is sync and never throws;
// `prompt` and `commit` return Promises that never reject. With a null plugin
// (after unload), `isInboxNote` returns false, `prompt` resolves
// `{ kind: "stay" }` (today's behavior), and `commit` resolves
// `{ ok: false, reason: "unavailable" }`.
function createInboxRouteApi(plugin) {
  const safeIsInboxNote = (path) => {
    try {
      if (!plugin || typeof plugin.isInboxNotePath !== "function") {
        return false;
      }
      return plugin.isInboxNotePath(path) === true;
    } catch (error) {
      return false;
    }
  };
  const safePrompt = (request) => {
    try {
      if (!plugin || typeof plugin.promptInboxRoute !== "function") {
        return Promise.resolve({ kind: "stay" });
      }
      return Promise.resolve(plugin.promptInboxRoute(request || {})).then(
        (outcome) => {
          if (
            outcome &&
            outcome.kind === "move" &&
            typeof outcome.path === "string" &&
            outcome.path
          ) {
            return {
              kind: "move",
              path: outcome.path,
              name: String(outcome.name || ""),
            };
          }
          if (outcome && outcome.kind === "stay") {
            return { kind: "stay" };
          }
          return { kind: "cancel" };
        },
        () => ({ kind: "stay" }),
      );
    } catch (error) {
      return Promise.resolve({ kind: "stay" });
    }
  };
  const safeCommit = (request) => {
    const unavailable = () =>
      Object.freeze({
        ok: false,
        name: "",
        count: 0,
        notice: "",
        handledRefs: Object.freeze([]),
        reason: "unavailable",
      });
    try {
      if (!plugin || typeof plugin.commitInboxRoute !== "function") {
        return Promise.resolve(unavailable());
      }
      return Promise.resolve(plugin.commitInboxRoute(request || {})).then(
        (result) => {
          if (result && result.ok === true) {
            return Object.freeze({
              ok: true,
              name: String(result.destinationName || result.name || ""),
              count: Math.max(
                0,
                Math.floor(numericOrDefault(result.count, 0)) || 0,
              ),
              notice: String(result.notice || ""),
              handledRefs: Object.freeze(
                Array.isArray(result.handledRefs) ? result.handledRefs : [],
              ),
              reason: null,
            });
          }
          return Object.freeze({
            ok: false,
            name: "",
            count: 0,
            notice: String((result && result.notice) || ""),
            handledRefs: Object.freeze([]),
            reason: String((result && result.reason) || "route-failed"),
          });
        },
        () => unavailable(),
      );
    } catch (error) {
      return Promise.resolve(unavailable());
    }
  };
  return Object.freeze({
    version: 1,
    isInboxNote: safeIsInboxNote,
    prompt: safePrompt,
    commit: safeCommit,
  });
}
