// Public offer-close API for project promotion (cycler api v5,
// plan:202611/successor_card_verdicts.md promotion phase).
//
// `describeOfferCloses` / `applyOfferCloses` are queued like the other public
// cycler methods; the `...Now` workers below do the work (deadlock rule:
// never call the queued wrappers from inside a queued pass).
//
// Promotion rows use promotion-minted keys (`path#^id`, `path@digest~n`).
// Block-ID rows verify natively in the shared engine. ID-less rows carry a
// different digest than the engine's own `assignSuccessorOfferKeys`, so each
// call translates them to the engine's digest key for the same (path, line)
// and translates receipt keys back. A translation that collides or shifts
// refuses the row instead of resolving a look-alike neighbour.

function successorOfferCloseApiRow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const key = typeof value.key === "string" ? value.key.trim() : "";
  const notePath = successorNormalizeVaultPath(
    String(value.notePath || value.note_path || ""),
  );
  if (!key || !notePath) return null;
  const line = Number.isInteger(value.line) ? value.line : -1;
  const rawLine = typeof value.rawLine === "string"
    ? value.rawLine
    : typeof value.raw_line === "string" ? value.raw_line : null;
  const blockId = typeof value.blockId === "string" && value.blockId
    ? String(value.blockId)
    : (typeof value.block_id === "string" && value.block_id ? String(value.block_id) : null);
  return {
    key,
    notePath,
    status: typeof value.status === "string" ? value.status : " ",
    selectable: value.selectable !== false && value.muted !== true,
    line,
    rawLine,
    blockId,
  };
}

function successorOfferCloseApiKeyPath(key) {
  const text = String(key || "");
  const hash = text.indexOf("#^");
  if (hash >= 0) return text.slice(0, hash);
  const at = text.lastIndexOf("@");
  if (at >= 0) return text.slice(0, at);
  return "";
}

function successorOfferCloseApiCapabilities(plugin) {
  let nav = null;
  try {
    const plugins = plugin && plugin.app && plugin.app.plugins &&
      plugin.app.plugins.plugins;
    nav = plugins ? plugins["bob-navigation-hotkeys"] : null;
  } catch (_error) {
    nav = null;
  }
  const api = nav && nav.api ? nav.api : null;
  return {
    successors: api && api.successors ? api.successors : null,
    cancel: api && api.cancel ? api.cancel : null,
    completeTaskLineText: plugin && typeof plugin.completeTaskLineText === "function"
      ? (line, options) => plugin.completeTaskLineText(line, options)
      : null,
    applyOfferClosesNow: plugin && typeof plugin.applyOfferClosesNow === "function"
      ? (options) => plugin.applyOfferClosesNow(options)
      : null,
  };
}

function successorOfferCloseApiBlockLine(noteText, blockId) {
  const lines = String(noteText || "").split(/\r?\n/);
  for (let line = 0; line < lines.length; line += 1) {
    if (getTrailingBlockId(String(lines[line] || "")) === blockId) return line;
  }
  return -1;
}

class TaskStatusCyclerSuccessorOfferCloseApiMixin {
  describeOfferCloses(options) {
    const run = async () => {
      try {
        return await this.describeOfferClosesNow(options || {});
      } catch (_error) {
        return { descriptors: {}, supported: false };
      }
    };
    if (typeof this.enqueueTaskReferenceMutation === "function") {
      return this.enqueueTaskReferenceMutation(run);
    }
    return run();
  }

  applyOfferCloses(options) {
    const run = async () => {
      try {
        return await this.applyPromotionOfferClosesNow(options || {});
      } catch (_error) {
        return {
          offer_closes: [],
          offer_close_refused: null,
          undo: null,
          resolved: [],
          failures: [{ kind: "write", reason: "The close could not be applied safely." }],
        };
      }
    };
    if (typeof this.enqueueTaskReferenceMutation === "function") {
      return this.enqueueTaskReferenceMutation(run);
    }
    return run();
  }

  async describeOfferClosesNow(options = {}) {
    const rows = Array.isArray(options.rows) ? options.rows : [];
    const parsed = rows
      .map(successorOfferCloseApiRow)
      .filter(Boolean)
      .filter((row) => row.selectable && Number.isInteger(row.line) && row.line >= 0 &&
        typeof row.rawLine === "string");
    const active = options.context && typeof options.context === "object" ? options.context : {};
    const cache = new Map();
    const noteTexts = new Map();
    for (const row of parsed) {
      if (noteTexts.has(row.notePath)) continue;
      let text = null;
      try {
        text = await this.readSuccessorNoteText(row.notePath, active, cache);
      } catch (_error) {
        text = null;
      }
      if (typeof text === "string") noteTexts.set(row.notePath, text);
    }
    const capabilities = successorOfferCloseApiCapabilities(this);
    if (!isSuccessorOfferCloseSupported(capabilities)) {
      return { descriptors: {}, supported: false };
    }
    const dated = typeof options.today === "string" && options.today
      ? options.today
      : formatLocalDate();
    let markUnblockedLine = null;
    try {
      markUnblockedLine = this.getFreshnessMarkUnblockedLine();
    } catch (_error) {
      markUnblockedLine = null;
    }
    const dependency = await this.successorOfferCloseApiDependencyContext(
      noteTexts,
      active,
      cache,
    );
    const translation = successorOfferCloseApiTranslateKeys(parsed, noteTexts);
    const offers = [];
    for (const row of parsed) {
      if (!noteTexts.has(row.notePath)) continue;
      const engineKey = translation.forward.get(row.key);
      if (!engineKey) continue;
      offers.push({
        key: engineKey,
        text: row.rawLine,
        notePath: row.notePath,
        status: row.status,
        group: "project",
        line: row.line,
        task: {
          path: row.notePath,
          line: row.line,
          rawLine: row.rawLine,
          blockId: row.blockId,
        },
      });
    }
    let descriptors = new Map();
    try {
      descriptors = buildSuccessorOfferCloseDescriptors(offers, {
        noteTexts,
        tasks: dependency.tasks,
        today: dated,
        dailyPath: "",
        dailyBefore: [],
        dailyAfter: [],
        dependencySnapshotAvailable: dependency.available,
        markUnblockedLine,
        newTaskKeys: new Set(),
        hasLiveLink: null,
        liveKeys: new Set(),
      }, capabilities);
    } catch (_error) {
      descriptors = new Map();
    }
    const out = {};
    for (const [promoKey, engineKey] of translation.forward) {
      const descriptor = descriptors instanceof Map
        ? descriptors.get(engineKey)
        : descriptors && descriptors[engineKey];
      if (descriptor && typeof descriptor === "object") out[promoKey] = { ...descriptor };
    }
    return { descriptors: out, supported: true };
  }

  async applyPromotionOfferClosesNow(options = {}) {
    const rawCloses = Array.isArray(options.closes) ? options.closes : [];
    const rowList = Array.isArray(options.rows)
      ? options.rows.map(successorOfferCloseApiRow).filter(Boolean)
      : [];
    const rowsByKey = new Map(rowList.map((row) => [row.key, row]));
    const expectedInput = options.expectedLines && typeof options.expectedLines === "object"
      ? options.expectedLines
      : {};
    const normalized = normalizeSuccessorChoices({ picks: [], closes: rawCloses });
    const validCloses = normalized && Array.isArray(normalized.closes) ? normalized.closes : [];
    const validKeys = new Set(validCloses.map((close) => String(close.key)));
    const refused = [];
    for (const close of rawCloses) {
      const key = close && typeof close.key === "string" ? String(close.key) : "";
      if (!key || validKeys.has(key)) continue;
      const row = rowsByKey.get(key);
      refused.push({
        key,
        outcome: close && (close.outcome === "done" || close.outcome === "cancelled")
          ? close.outcome
          : "done",
        text: row && typeof row.rawLine === "string"
          ? successorOfferCloseTaskDisplay({ text: row.rawLine, rawLine: row.rawLine })
          : key,
        why: successorOfferCloseRefusalDescriptor("changed_identity", key, " ").why,
      });
    }
    if (validCloses.length === 0) {
      return {
        offer_closes: [],
        offer_close_refused: refused.length > 0
          ? {
            count: refused.length,
            rows: refused.map((entry) => ({ text: entry.text, why: entry.why })),
          }
          : null,
        undo: null,
        resolved: [],
        failures: null,
      };
    }
    const active = options.context && typeof options.context === "object" ? options.context : {};
    const cache = new Map();
    const paths = new Set();
    for (const close of validCloses) {
      const row = rowsByKey.get(String(close.key));
      if (row) {
        paths.add(row.notePath);
        continue;
      }
      const fromKey = successorOfferCloseApiKeyPath(String(close.key));
      if (fromKey) paths.add(successorNormalizeVaultPath(fromKey));
    }
    const noteTexts = new Map();
    for (const path of paths) {
      let text = null;
      try {
        text = await this.readSuccessorNoteText(path, active, cache);
      } catch (_error) {
        text = null;
      }
      if (typeof text === "string") noteTexts.set(path, text);
    }
    const dated = typeof options.today === "string" && options.today
      ? options.today
      : formatLocalDate();
    let markUnblockedLine = null;
    try {
      markUnblockedLine = this.getFreshnessMarkUnblockedLine();
    } catch (_error) {
      markUnblockedLine = null;
    }
    const dependency = await this.successorOfferCloseApiDependencyContext(
      noteTexts,
      active,
      cache,
    );
    const translation = successorOfferCloseApiTranslateKeys(
      rowList.filter((row) => validKeys.has(row.key) && noteTexts.has(row.notePath)),
      noteTexts,
    );
    const offers = [];
    const engineCloses = [];
    const engineExpected = {};
    for (const close of validCloses) {
      const promoKey = String(close.key);
      const row = rowsByKey.get(promoKey);
      let engineKey = translation.forward.get(promoKey) || null;
      let line = row && Number.isInteger(row.line) ? row.line : -1;
      let path = row ? row.notePath : successorOfferCloseApiKeyPath(promoKey);
      if (!engineKey && row && row.blockId && noteTexts.has(row.notePath)) {
        const found = successorOfferCloseApiBlockLine(noteTexts.get(row.notePath), row.blockId);
        if (found >= 0 && `${row.notePath}#^${row.blockId}` === promoKey) {
          engineKey = promoKey;
          line = found;
          path = row.notePath;
        }
      }
      const expected = typeof expectedInput[promoKey] === "string"
        ? expectedInput[promoKey]
        : row && typeof row.rawLine === "string" ? row.rawLine : null;
      if (!engineKey || !path || line < 0 || typeof expected !== "string") {
        refused.push({
          key: promoKey,
          outcome: close.outcome,
          text: row && typeof row.rawLine === "string" ? row.rawLine : promoKey,
          why: successorOfferCloseRefusalDescriptor("changed_identity", promoKey, " ").why,
        });
        continue;
      }
      offers.push({
        key: engineKey,
        text: row && typeof row.rawLine === "string" ? row.rawLine : expected,
        notePath: path,
        status: row ? row.status : " ",
        group: "project",
        line,
        task: {
          path,
          line,
          rawLine: expected,
          blockId: row && row.blockId ? row.blockId : null,
        },
      });
      const entry = { key: engineKey, outcome: close.outcome };
      if (close.outcome === "cancelled" && typeof close.reason === "string" && close.reason) {
        entry.reason = close.reason;
      }
      engineCloses.push(entry);
      engineExpected[engineKey] = expected;
    }
    if (engineCloses.length === 0) {
      const sorted = refused.slice().sort((a, b) => String(a.key).localeCompare(String(b.key)));
      return {
        offer_closes: [],
        offer_close_refused: {
          count: sorted.length,
          rows: sorted.map((entry) => ({ text: entry.text, why: entry.why })),
        },
        undo: null,
        resolved: [],
        failures: null,
      };
    }
    const capabilities = successorOfferCloseApiCapabilities(this);
    let dailyPath = "";
    let dailyLines = [];
    try {
      dailyPath = todayDailyPath(this.app) || "";
      if (dailyPath) {
        const dailyText = await this.readSuccessorNoteText(dailyPath, active, cache);
        if (typeof dailyText === "string") dailyLines = dailyText.split(/\r?\n/);
        else dailyPath = "";
      }
    } catch (_error) {
      dailyPath = "";
      dailyLines = [];
    }
    let result = null;
    try {
      result = await this.applyOfferClosesNow({
        closes: engineCloses,
        offers,
        expectedLines: engineExpected,
        noteTexts,
        context: {
          ...active,
          today: dated,
          dailyPath,
          dailyBefore: dailyLines,
          dailyAfter: dailyLines,
          noteTexts,
          tasks: dependency.tasks,
          dependencySnapshotAvailable: dependency.available,
          markUnblockedLine,
          hasLiveLink: dailyPath
            ? successorOfferCloseLiveLinkCheck(dailyLines, dailyPath)
            : null,
        },
        cache,
        capabilities,
      });
    } catch (_error) {
      result = null;
    }
    const reverse = translation.reverse;
    const translateKey = (key) => reverse.get(String(key)) || String(key);
    const offerCloses = result && Array.isArray(result.offer_closes)
      ? result.offer_closes.map((entry) => ({ ...entry, key: translateKey(entry.key) }))
      : [];
    const resolved = result && Array.isArray(result.resolved)
      ? result.resolved.map((entry) => ({ ...entry, key: translateKey(entry.key) }))
      : [];
    const translatedRefused = refused.map((entry) => ({ text: entry.text, why: entry.why }));
    let offerCloseRefused = result && result.offer_close_refused
      ? {
        count: Number(result.offer_close_refused.count) || 0,
        rows: [
          ...(Array.isArray(result.offer_close_refused.rows)
            ? result.offer_close_refused.rows.map((row) => ({
              text: String(row && row.text || ""),
              why: String(row && row.why || ""),
            }))
            : []),
          ...translatedRefused,
        ],
      }
      : (translatedRefused.length > 0
        ? { count: translatedRefused.length, rows: translatedRefused }
        : null);
    if (offerCloseRefused) {
      offerCloseRefused = {
        count: Math.max(
          Number(offerCloseRefused.count) || 0,
          offerCloseRefused.rows.length,
        ),
        rows: offerCloseRefused.rows,
      };
    }
    return {
      offer_closes: offerCloses,
      offer_close_refused: offerCloseRefused,
      undo: result && result.undo ? result.undo : null,
      resolved,
      failures: result && Array.isArray(result.failures) && result.failures.length > 0
        ? result.failures
        : null,
    };
  }

  async successorOfferCloseApiDependencyContext(noteTexts, active, cache) {
    let tasks = [];
    let available = false;
    try {
      const pool = await this.buildSuccessorPool(new Set(), active || {}, cache || new Map());
      if (pool && pool.warm && Array.isArray(pool.tasks)) {
        const overlaid = new Set((noteTexts instanceof Map ? [...noteTexts.keys()] : []));
        tasks = pool.tasks.filter((task) => task && !overlaid.has(String(task.path || "")));
        available = true;
      }
    } catch (_error) {
      tasks = [];
      available = false;
    }
    if (!available) {
      try {
        const cold = await this.readSuccessorColdDocuments(active || {}, cache || new Map());
        if (cold && Array.isArray(cold.documents)) {
          const overlaid = new Set((noteTexts instanceof Map ? [...noteTexts.keys()] : []));
          const fresh = cold.documents.filter((document) =>
            document && !overlaid.has(String(document.path || "")));
          tasks = tasksFromDocuments(fresh);
          available = cold.complete === true;
        }
      } catch (_error) {
        tasks = [];
        available = false;
      }
    }
    return { tasks, available };
  }
}

// Translate promotion-minted row keys to the engine's digest keys for the
// same (path, line). Block-ID rows keep their key when it names the line's
// trailing block ID. ID-less rows take the engine's recomputed key; pairs
// that collide share one engine key and are dropped (fail closed).
function successorOfferCloseApiTranslateKeys(rows, noteTexts) {
  const forward = new Map();
  const reverse = new Map();
  const table = buildSuccessorNoteDigestTable(noteTexts);
  const claimed = new Map();
  const candidates = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.key || !row.notePath) continue;
    const text = noteTexts instanceof Map ? noteTexts.get(row.notePath) : null;
    if (typeof text !== "string") continue;
    const lines = String(text).split(/\r?\n/);
    const current = lines[row.line];
    if (current !== row.rawLine) continue;
    let engineKey = null;
    if (row.blockId) {
      if (row.key !== `${row.notePath}#^${row.blockId}`) continue;
      if (getTrailingBlockId(String(current)) !== row.blockId) continue;
      engineKey = row.key;
    } else {
      const parsed = parseTaskDependencyLine(current, row.notePath, row.line);
      if (!parsed) continue;
      const probe = {
        path: row.notePath,
        line: row.line,
        status: parsed.status,
        blockId: null,
        taskId: parsed.taskId || null,
        dependsOn: Array.isArray(parsed.dependsOn) ? parsed.dependsOn.slice() : [],
        text: current,
        rawLine: current,
        globalFilter: "#task",
      };
      try {
        engineKey = assignSuccessorOfferKeys([probe], table).get(probe) || null;
      } catch (_error) {
        engineKey = null;
      }
      if (!engineKey) continue;
    }
    candidates.push({ promoKey: row.key, engineKey });
    claimed.set(engineKey, (claimed.get(engineKey) || 0) + 1);
  }
  for (const candidate of candidates) {
    if (claimed.get(candidate.engineKey) !== 1) continue;
    if (forward.has(candidate.promoKey)) continue;
    forward.set(candidate.promoKey, candidate.engineKey);
    if (!reverse.has(candidate.engineKey)) reverse.set(candidate.engineKey, candidate.promoKey);
  }
  return { forward, reverse };
}
