// Tier-1 settle for Ctrl+Shift+Enter target-note writes (bob-cli-q4.11).
// Looks up bob-ledger-tools `taskSettle` v1 at call time. Missing, older,
// or throwing providers leave the existing gesture write in place so
// reconcile can heal on its next tick.

function lookupTaskSettle(app) {
  try {
    const plugins = app && app.plugins;
    const byId = plugins && plugins.plugins ? plugins.plugins["bob-ledger-tools"] : null;
    const holder =
      byId ||
      (plugins && typeof plugins.getPlugin === "function"
        ? plugins.getPlugin("bob-ledger-tools")
        : null);
    const settle = holder && holder.api && holder.api.taskSettle;
    if (!settle || settle.version !== 1) return null;
    return settle;
  } catch (_error) {
    return null;
  }
}

function flushTaskSettlePending(app) {
  const settle = lookupTaskSettle(app);
  if (!settle || typeof settle.flushPending !== "function") return [];
  try {
    const flushed = settle.flushPending();
    return Array.isArray(flushed) ? flushed : [];
  } catch (_error) {
    return [];
  }
}

function taskSettleTodayText(now) {
  return formatCalendarDate(localTodayParts(now));
}

function settleClosedNoteContents(app, path, contents, today) {
  const settle = lookupTaskSettle(app);
  if (!settle || typeof settle.settleNote !== "function") return contents;
  try {
    const result = settle.settleNote({
      path,
      contents,
      today,
    });
    if (result && typeof result.contents === "string") return result.contents;
  } catch (_error) {
    // Provider skew or exception leaves the existing gesture write intact.
  }
  return contents;
}

function planTaskIdentityFromPlan(plan) {
  if (!plan || !Array.isArray(plan.edits) || plan.edits.length === 0) return null;
  const first = plan.edits[0];
  if (!first || typeof first.replacement !== "string") return null;
  const identity = { text: first.replacement };
  const blockId = typeof getTrailingBlockId === "function" ? getTrailingBlockId(first.replacement) : null;
  if (blockId) identity.blockId = blockId;
  return identity;
}

function applySettledGestureToEditor(plugin, editor, path, expected, contents, identity) {
  const settle = lookupTaskSettle(plugin && plugin.app);
  if (!settle || typeof settle.applyToEditor !== "function") return false;
  try {
    const now = plugin && typeof plugin.now === "function" ? plugin.now() : new Date();
    const options = {
      expected,
      contents,
      today: taskSettleTodayText(now),
    };
    if (identity) options.identity = identity;
    const result = settle.applyToEditor(editor, path, options);
    return Boolean(result && result.applied);
  } catch (_error) {
    return false;
  }
}
