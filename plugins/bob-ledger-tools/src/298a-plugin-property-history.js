// Session-only per-path undo/redo stacks for props writes. Entries keep the
// inverse batch and the fingerprint that batch expects; that expect is never
// rewritten to the current fingerprint. New successful edits clear redo.
// No-op, failed, and stale applies do not consume history.
function propertyHistoryEntry(inverseOps, expect) {
  const ops = Array.isArray(inverseOps) ? propertyCloneJson(inverseOps) : [];
  if (!Array.isArray(ops) || ops.length === 0) return null;
  return {
    inverseOps: ops,
    expect: typeof expect === "string" ? expect : "",
  };
}

function createPropertyHistory(options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? options.limit
    : PROPERTY_HISTORY_LIMIT;
  const stacks = new Map();

  function keyOf(path) {
    return propertyNotePath(path);
  }

  function bucket(path, create) {
    const key = keyOf(path);
    if (!key) return null;
    let entry = stacks.get(key);
    if (!entry && create) {
      entry = { undo: [], redo: [] };
      stacks.set(key, entry);
    }
    return entry;
  }

  function bound(list) {
    while (list.length > limit) list.shift();
  }

  function snapshot(path) {
    const entry = bucket(path, false);
    return {
      undo: entry ? entry.undo.length : 0,
      redo: entry ? entry.redo.length : 0,
    };
  }

  function peekUndo(path) {
    const entry = bucket(path, false);
    if (!entry || entry.undo.length === 0) return null;
    return entry.undo[entry.undo.length - 1];
  }

  function peekRedo(path) {
    const entry = bucket(path, false);
    if (!entry || entry.redo.length === 0) return null;
    return entry.redo[entry.redo.length - 1];
  }

  function pushEdit(path, inverseOps, expect) {
    const record = propertyHistoryEntry(inverseOps, expect);
    if (!record) return snapshot(path);
    const entry = bucket(path, true);
    if (!entry) return snapshot(path);
    entry.undo.push(record);
    bound(entry.undo);
    entry.redo = [];
    return snapshot(path);
  }

  function popUndo(path) {
    const entry = bucket(path, false);
    if (!entry || entry.undo.length === 0) return null;
    return entry.undo.pop();
  }

  function popRedo(path) {
    const entry = bucket(path, false);
    if (!entry || entry.redo.length === 0) return null;
    return entry.redo.pop();
  }

  function restoreUndo(path, record) {
    if (!record || !Array.isArray(record.inverseOps) || record.inverseOps.length === 0) {
      return snapshot(path);
    }
    const entry = bucket(path, true);
    if (!entry) return snapshot(path);
    entry.undo.push({
      inverseOps: propertyCloneJson(record.inverseOps),
      expect: typeof record.expect === "string" ? record.expect : "",
    });
    bound(entry.undo);
    return snapshot(path);
  }

  function restoreRedo(path, record) {
    if (!record || !Array.isArray(record.inverseOps) || record.inverseOps.length === 0) {
      return snapshot(path);
    }
    const entry = bucket(path, true);
    if (!entry) return snapshot(path);
    entry.redo.push({
      inverseOps: propertyCloneJson(record.inverseOps),
      expect: typeof record.expect === "string" ? record.expect : "",
    });
    bound(entry.redo);
    return snapshot(path);
  }

  function completeUndo(path, inverseOps, expect) {
    const record = propertyHistoryEntry(inverseOps, expect);
    if (!record) return snapshot(path);
    const entry = bucket(path, true);
    if (!entry) return snapshot(path);
    entry.redo.push(record);
    bound(entry.redo);
    return snapshot(path);
  }

  function completeRedo(path, inverseOps, expect) {
    const record = propertyHistoryEntry(inverseOps, expect);
    if (!record) return snapshot(path);
    const entry = bucket(path, true);
    if (!entry) return snapshot(path);
    entry.undo.push(record);
    bound(entry.undo);
    return snapshot(path);
  }

  function migrate(fromPath, toPath) {
    const from = keyOf(fromPath);
    const to = keyOf(toPath);
    if (!from || from === to) return;
    const entry = stacks.get(from);
    stacks.delete(from);
    if (!to) return;
    if (entry) stacks.set(to, entry);
  }

  function release(path) {
    const key = keyOf(path);
    if (key) stacks.delete(key);
  }

  function clear() {
    stacks.clear();
  }

  return {
    limit,
    snapshot,
    peekUndo,
    peekRedo,
    pushEdit,
    popUndo,
    popRedo,
    restoreUndo,
    restoreRedo,
    completeUndo,
    completeRedo,
    migrate,
    release,
    clear,
  };
}
