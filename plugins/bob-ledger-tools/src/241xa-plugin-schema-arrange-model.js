// DOM-free schema arrangement model, envelope compilers, and simulators.
// Cards can preview arbitrary reorder gestures locally, then submit one
// compiler-verified envelope through their existing guarded update session.

const SCHEMA_ARRANGE_GAP_ALPHABET = "asdfghjklqwertyuiopzxcvbnm";

function schemaArrangeCloneScopes(scopes) {
  const copy = {};
  for (const [scope, ids] of Object.entries(scopes || {})) {
    if (!Array.isArray(ids)) throw new TypeError(`Arrangement scope ${scope} must be an array.`);
    const values = ids.slice();
    if (new Set(values).size !== values.length) {
      throw new TypeError(`Arrangement scope ${scope} must contain unique ids.`);
    }
    copy[scope] = values;
  }
  return copy;
}

function schemaArrangeCloneJournal(journal) {
  return (journal || []).map((entry) => ({
    scope: entry.scope,
    id: entry.id,
    anchor: entry.anchor,
    anchors: entry.anchors.slice(),
  }));
}

function schemaArrangeFixedFor(fixed, scope) {
  const descriptor = fixed && fixed[scope];
  const local = Array.isArray(descriptor)
    ? { ids: descriptor }
    : descriptor && typeof descriptor === "object" ? descriptor : {};
  const globalIds = fixed?.ids && typeof fixed.ids === "object" ? fixed.ids[scope] : null;
  const globalSlots = fixed?.slots && typeof fixed.slots === "object" ? fixed.slots[scope] : null;
  const ids = new Set([
    ...(Array.isArray(local.ids) ? local.ids : []),
    ...(Array.isArray(globalIds) ? globalIds : []),
  ]);
  const slots = new Set([
    ...(Array.isArray(local.slots) ? local.slots : []),
    ...(Array.isArray(globalSlots) ? globalSlots : []),
  ].filter((index) => Number.isInteger(index) && index >= 0));
  return { ids, slots };
}

function schemaArrangeSameOrder(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function schemaArrangeCanUseOrder(scope, before, after, fixed) {
  const lock = schemaArrangeFixedFor(fixed, scope);
  for (const id of lock.ids) {
    const beforeIndex = before.indexOf(id);
    if (beforeIndex >= 0 && after.indexOf(id) !== beforeIndex) return false;
  }
  for (const index of lock.slots) {
    if (index < before.length && after[index] !== before[index]) return false;
  }
  return true;
}

function schemaArrangeMoveToIndex(order, id, index) {
  const from = order.indexOf(id);
  if (from < 0 || !Number.isInteger(index) || index < 0 || index >= order.length) return null;
  const next = order.slice();
  next.splice(from, 1);
  next.splice(index, 0, id);
  return next;
}

function schemaArrangeInsertAt(order, id, index) {
  if (!Number.isInteger(index) || index < 0 || index > order.length || order.includes(id)) return null;
  const next = order.slice();
  next.splice(index, 0, id);
  return next;
}

function createArrangement({ scopes = {}, fixed = {} } = {}) {
  const base = schemaArrangeCloneScopes(scopes);
  let projection = schemaArrangeCloneScopes(base);
  let journal = [];
  let undo = [];
  let saveMarker = null;

  function copyState() {
    return {
      projection: schemaArrangeCloneScopes(projection),
      journal: schemaArrangeCloneJournal(journal),
    };
  }

  function restoreState(snapshot) {
    projection = schemaArrangeCloneScopes(snapshot.projection);
    journal = schemaArrangeCloneJournal(snapshot.journal);
  }

  function isDirty() {
    return Object.keys(base).some((scope) => !schemaArrangeSameOrder(base[scope] || [], projection[scope] || []));
  }

  function cleanJournalWhenSettled() {
    if (!isDirty()) journal = [];
  }

  function pushUndo(before, coalesce, scope, id) {
    if (coalesce && undo.length) {
      const last = undo[undo.length - 1];
      if (last.coalesce === coalesce && last.coalesceScope === scope && last.coalesceId === id) return;
    }
    undo.push({ ...before, coalesce: coalesce || null, coalesceScope: scope, coalesceId: id });
  }

  function appendMove(scope, id, before, after) {
    const index = after.indexOf(id);
    const anchors = after.slice(0, index).reverse();
    journal.push({ scope, id, anchor: anchors[0] ?? null, anchors });
    cleanJournalWhenSettled();
  }

  function moveByIndex(scope, id, index, options = {}) {
    const order = projection[scope];
    if (!order || !order.includes(id)) return { ok: false, clamped: false };
    const next = schemaArrangeMoveToIndex(order, id, index);
    if (!next) return { ok: false, clamped: false };
    if (schemaArrangeSameOrder(order, next)) return { ok: false, clamped: false };
    if (!schemaArrangeCanUseOrder(scope, order, next, fixed)) return { ok: false, clamped: true };
    const before = copyState();
    const coalesce = typeof options === "string"
      ? options
      : options?.coalesceKey ?? options?.key ?? null;
    pushUndo(before, coalesce, scope, id);
    const prior = order.slice();
    projection[scope] = next;
    appendMove(scope, id, prior, next);
    return { ok: true, clamped: false };
  }

  function legalGaps(scope, id) {
    const order = projection[scope];
    if (!order || !order.includes(id)) return [];
    const itemIndex = order.indexOf(id);
    const reduced = order.filter((candidate) => candidate !== id);
    const gaps = [];
    for (let gap = 0; gap <= order.length; gap += 1) {
      if (gap === itemIndex || gap === itemIndex + 1) continue;
      const insertIndex = gap > itemIndex ? gap - 1 : gap;
      const next = schemaArrangeInsertAt(reduced, id, insertIndex);
      if (next && schemaArrangeCanUseOrder(scope, order, next, fixed)) gaps.push(gap);
    }
    return gaps;
  }

  function recordTravel(scope, id, direction, requested, options = {}) {
    const order = projection[scope];
    if (!order || !order.includes(id)) return { ok: false, clamped: false };
    const amount = Math.abs(Number(requested));
    if (!Number.isFinite(amount) || amount === 0) return { ok: false, clamped: false };
    const steps = Math.min(Math.floor(amount), order.length);
    if (!steps) return { ok: false, clamped: false };
    let next = order.slice();
    let moved = 0;
    for (; moved < steps; moved += 1) {
      const current = next.indexOf(id);
      const candidate = schemaArrangeMoveToIndex(next, id, current + direction);
      if (!candidate || !schemaArrangeCanUseOrder(scope, next, candidate, fixed)) break;
      next = candidate;
    }
    if (!moved) return { ok: true, clamped: true };
    const before = copyState();
    const coalesce = typeof options === "string"
      ? options
      : options?.coalesceKey ?? options?.key ?? null;
    pushUndo(before, coalesce, scope, id);
    projection[scope] = next;
    appendMove(scope, id, order.slice(), next);
    return { ok: true, clamped: moved < amount };
  }

  return {
    scopeIds() { return Object.keys(base); },
    scopes() { return schemaArrangeCloneScopes(projection); },
    savedScopes() { return schemaArrangeCloneScopes(base); },
    saved(scope) { return (base[scope] || []).slice(); },
    projected(scope) { return (projection[scope] || []).slice(); },
    nudge(scope, id, delta, options = {}) {
      const numeric = Number(delta);
      if (!Number.isFinite(numeric) || numeric === 0) return { ok: false, clamped: false };
      return recordTravel(scope, id, numeric < 0 ? -1 : 1, numeric, options);
    },
    toEdge(scope, id, edge, options = {}) {
      if (edge !== "first" && edge !== "last") return { ok: false, clamped: false };
      const order = projection[scope];
      if (!order || !order.includes(id)) return { ok: false, clamped: false };
      const direction = edge === "first" ? -1 : 1;
      const result = recordTravel(scope, id, direction, order.length, options);
      const projectedIndex = projection[scope].indexOf(id);
      const reachedEdge = edge === "first" ? projectedIndex === 0 : projectedIndex === projection[scope].length - 1;
      return { ...result, clamped: result.ok && !reachedEdge && result.clamped };
    },
    placeAtGap(scope, id, gap, options = {}) {
      const order = projection[scope];
      if (!order || !order.includes(id) || !Number.isInteger(gap) || gap < 0 || gap > order.length) {
        return { ok: false, clamped: false };
      }
      if (!legalGaps(scope, id).includes(gap)) return { ok: false, clamped: false };
      const index = gap > order.indexOf(id) ? gap - 1 : gap;
      return moveByIndex(scope, id, index, options);
    },
    legalGaps,
    delta(scope, id) {
      const from = (base[scope] || []).indexOf(id);
      const to = (projection[scope] || []).indexOf(id);
      return from < 0 || to < 0 ? null : to - from;
    },
    dirty: isDirty,
    movedIds(scope) {
      if (scope !== undefined) {
        const original = base[scope] || [];
        const current = projection[scope] || [];
        return current.filter((id, index) => original[index] !== id);
      }
      return Object.keys(base).flatMap((scopeId) => {
        const original = base[scopeId] || [];
        const current = projection[scopeId] || [];
        return current.filter((id, index) => original[index] !== id).map((id) => ({ scope: scopeId, id }));
      });
    },
    summary() {
      const moved = this.movedIds();
      const moveCount = journal.length;
      const scopesChanged = Object.keys(base).filter((scope) =>
        !schemaArrangeSameOrder(base[scope] || [], projection[scope] || []));
      return {
        dirty: isDirty(),
        moveCount,
        count: moveCount,
        movedIds: moved,
        scopes: scopesChanged,
        text: moveCount ? `${moveCount} move${moveCount === 1 ? "" : "s"}` : "",
      };
    },
    stepBack() {
      const snapshot = undo.pop();
      if (!snapshot) return false;
      restoreState(snapshot);
      return true;
    },
    revert() {
      if (saveMarker) {
        projection = schemaArrangeCloneScopes(saveMarker.scopes);
        journal = journal.slice(0, saveMarker.journalLength);
        undo = undo.slice(0, saveMarker.undoLength);
        return;
      }
      projection = schemaArrangeCloneScopes(base);
      journal = [];
      undo = [];
    },
    rebase(newScopes = {}) {
      const oldJournal = schemaArrangeCloneJournal(journal);
      const nextBase = schemaArrangeCloneScopes(newScopes);
      baseForRebase(nextBase);
      const dropped = [];
      for (const move of oldJournal) {
        const order = projection[move.scope];
        if (!order || !order.includes(move.id)) {
          dropped.push({ scope: move.scope, id: move.id, reason: "vanished" });
          continue;
        }
        const reduced = order.filter((id) => id !== move.id);
        let desired = 0;
        if (move.anchor !== null && reduced.includes(move.anchor)) {
          desired = reduced.indexOf(move.anchor) + 1;
        } else if (move.anchor !== null) {
          const fallback = move.anchors.find((id) => reduced.includes(id));
          desired = fallback === undefined ? 0 : reduced.indexOf(fallback) + 1;
        }
        const candidates = [];
        for (let index = 0; index <= reduced.length; index += 1) {
          const candidate = schemaArrangeInsertAt(reduced, move.id, index);
          if (candidate && schemaArrangeCanUseOrder(move.scope, order, candidate, fixed)) candidates.push(index);
        }
        if (!candidates.length) {
          dropped.push({ scope: move.scope, id: move.id, reason: "fixed" });
          continue;
        }
        const target = candidates.sort((left, right) => Math.abs(left - desired) - Math.abs(right - desired) || left - right)[0];
        const next = schemaArrangeInsertAt(reduced, move.id, target);
        if (!schemaArrangeSameOrder(order, next)) {
          projection[move.scope] = next;
          appendMove(move.scope, move.id, order, next);
        }
      }
      cleanJournalWhenSettled();
      undo = [];
      saveMarker = null;
      return { dropped };
    },
    beginSave() {
      saveMarker = {
        scopes: schemaArrangeCloneScopes(projection),
        journalLength: journal.length,
        undoLength: undo.length,
      };
      return schemaArrangeCloneScopes(saveMarker.scopes);
    },
    settleSave(success) {
      if (!saveMarker) return false;
      if (success === true) {
        const marker = saveMarker;
        for (const scope of Object.keys(base)) {
          base[scope] = (marker.scopes[scope] || []).slice();
        }
        for (const scope of Object.keys(marker.scopes)) {
          if (!Object.prototype.hasOwnProperty.call(base, scope)) base[scope] = marker.scopes[scope].slice();
          if (!Object.prototype.hasOwnProperty.call(projection, scope)) projection[scope] = marker.scopes[scope].slice();
        }
        journal = journal.slice(marker.journalLength);
        undo = undo.slice(marker.undoLength);
        cleanJournalWhenSettled();
      }
      saveMarker = null;
      return true;
    },
  };

  function baseForRebase(nextBase) {
    for (const scope of Object.keys(base)) delete base[scope];
    for (const [scope, ids] of Object.entries(nextBase)) base[scope] = ids.slice();
    projection = schemaArrangeCloneScopes(base);
    journal = [];
  }
}

function schemaArrangeLisIndices(values) {
  const lengths = new Array(values.length).fill(1);
  const fixedCounts = values.map((value, index) => value === index ? 1 : 0);
  const previous = new Array(values.length).fill(-1);
  for (let index = 0; index < values.length; index += 1) {
    for (let candidate = 0; candidate < index; candidate += 1) {
      if (values[candidate] >= values[index]) continue;
      const nextLength = lengths[candidate] + 1;
      const nextFixedCount = fixedCounts[candidate] + (values[index] === index ? 1 : 0);
      if (nextLength > lengths[index]
        || (nextLength === lengths[index] && nextFixedCount > fixedCounts[index])) {
        lengths[index] = nextLength;
        fixedCounts[index] = nextFixedCount;
        previous[index] = candidate;
      }
    }
  }
  let best = -1;
  for (let index = 0; index < values.length; index += 1) {
    if (best < 0 || lengths[index] > lengths[best]
      || (lengths[index] === lengths[best] && fixedCounts[index] > fixedCounts[best])) best = index;
  }
  const indexes = [];
  let cursor = best;
  while (cursor !== undefined && cursor >= 0) {
    indexes.push(cursor);
    cursor = previous[cursor];
  }
  return indexes.reverse();
}

function schemaArrangeMovedSet(saved, projected) {
  if (saved.length !== projected.length) return null;
  const savedIndex = new Map(saved.map((id, index) => [id, index]));
  if (savedIndex.size !== saved.length || projected.some((id) => !savedIndex.has(id)) || new Set(projected).size !== projected.length) {
    return null;
  }
  const stableIndices = new Set(schemaArrangeLisIndices(projected.map((id) => savedIndex.get(id))));
  return new Set(projected.filter((_, index) => !stableIndices.has(index)));
}

function schemaArrangeTargetOrderOps(saved, projected, emit) {
  const moved = schemaArrangeMovedSet(saved, projected);
  if (!moved) return null;
  const ops = [];
  for (let index = projected.length - 1; index >= 0; index -= 1) {
    const id = projected[index];
    if (!moved.has(id)) continue;
    const op = emit(id, index, projected, moved);
    if (!op) return null;
    ops.push(op);
  }
  return ops;
}

function schemaArrangeAbsoluteOrderOps(saved, projected, emit) {
  const moved = schemaArrangeMovedSet(saved, projected);
  if (!moved) return null;
  let current = saved.slice();
  const processed = new Set();
  const ops = [];
  for (let targetIndex = projected.length - 1; targetIndex >= 0; targetIndex -= 1) {
    const id = projected[targetIndex];
    if (!moved.has(id)) continue;
    const without = current.filter((candidate) => candidate !== id);
    let position = null;
    if (targetIndex + 1 < projected.length) {
      position = without.indexOf(projected[targetIndex + 1]);
    } else {
      for (let cursor = targetIndex - 1; cursor >= 0; cursor -= 1) {
        const anchor = projected[cursor];
        if (!moved.has(anchor) || processed.has(anchor)) {
          const anchorIndex = without.indexOf(anchor);
          if (anchorIndex >= 0) position = anchorIndex + 1;
          break;
        }
      }
      if (position === null && without.length === 0) position = 0;
    }
    if (!Number.isInteger(position) || position < 0 || position > without.length) return null;
    const op = emit(id, position, targetIndex, current);
    if (!op) return null;
    const next = schemaArrangeMoveToIndex(current, id, position);
    if (!next) return null;
    current = next;
    processed.add(id);
    ops.push(op);
  }
  return schemaArrangeSameOrder(current, projected) ? ops : null;
}

function schemaArrangePlainScopes(source) {
  if (source && typeof source.savedScopes === "function") return source.savedScopes();
  if (source && source.scopes && typeof source.scopes === "object" && !Array.isArray(source.scopes)) {
    return schemaArrangeCloneScopes(source.scopes);
  }
  return schemaArrangeCloneScopes(source || {});
}

function simulateAlbumOps(source, ops = []) {
  const scopes = schemaArrangePlainScopes(source);
  for (const op of Array.isArray(ops) ? ops : []) {
    if (op?.op === "field.move") {
      const order = scopes.fields;
      const next = Array.isArray(order) && Number.isInteger(op.position)
        ? schemaArrangeMoveToIndex(order, op.field, op.position)
        : null;
      if (!next) return { ok: false, code: "invalid-field-move" };
      scopes.fields = next;
    } else if (op?.op === "choice.move") {
      const scope = `choices:${op.field}`;
      const order = scopes[scope];
      const next = Array.isArray(order) && Number.isInteger(op.position)
        ? schemaArrangeMoveToIndex(order, op.value, op.position)
        : null;
      if (!next) return { ok: false, code: "invalid-choice-move" };
      scopes[scope] = next;
    } else {
      return { ok: false, code: "unsupported-album-op" };
    }
  }
  return scopes;
}

function compileAlbumArrangement(arrangement) {
  if (!arrangement || typeof arrangement.scopeIds !== "function") {
    return { ok: false, code: "compile-mismatch" };
  }
  const ops = [];
  for (const scope of arrangement.scopeIds()) {
    const saved = arrangement.saved(scope);
    const projected = arrangement.projected(scope);
    const scopeOps = schemaArrangeAbsoluteOrderOps(saved, projected, (id, position) => {
      if (scope === "fields") return { op: "field.move", field: id, position };
      if (scope.startsWith("choices:")) {
        return { op: "choice.move", field: scope.slice("choices:".length), value: id, position };
      }
      return null;
    });
    if (!scopeOps) return { ok: false, code: "compile-mismatch" };
    ops.push(...scopeOps);
  }
  const replayed = simulateAlbumOps(arrangement, ops);
  if (!replayed || replayed.ok === false) return { ok: false, code: "compile-mismatch" };
  const expected = arrangement.scopes();
  if (arrangement.scopeIds().some((scope) => !schemaArrangeSameOrder(replayed[scope] || [], expected[scope] || []))) {
    return { ok: false, code: "compile-mismatch" };
  }
  return ops;
}

function schemaArrangeMoveByAnchor(order, item, anchor, side) {
  const from = order.indexOf(item);
  if (from < 0 || item === anchor || (side !== "before" && side !== "after")) return null;
  const next = order.slice();
  next.splice(from, 1);
  const anchorIndex = next.indexOf(anchor);
  if (anchorIndex < 0) return null;
  next.splice(anchorIndex + (side === "after" ? 1 : 0), 0, item);
  return next;
}

function schemaArrangeAnchorForTarget(index, projected, moved) {
  if (index + 1 < projected.length) return { side: "before", anchor: projected[index + 1] };
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (!moved.has(projected[cursor])) return { side: "after", anchor: projected[cursor] };
  }
  return null;
}

function schemaArrangeRuleMatch(rule) {
  return String(rule?.match ?? rule?.match_was ?? "");
}

function schemaArrangeBankInitial(source, rules = []) {
  const scopes = schemaArrangePlainScopes(source);
  const categories = Array.isArray(source?.categories) ? source.categories : [];
  const actualRules = Array.isArray(source?.rules) ? source.rules : rules;
  return {
    groups: (scopes.groups || []).slice(),
    categories: categories.map((category) => ({ ...category })),
    rules: actualRules.map((rule) => ({ ...rule })),
  };
}

function schemaArrangeBankOrderCategories(categories, groups) {
  const byGroup = new Map();
  for (const category of categories) {
    const name = String(category?.group ?? "");
    if (!byGroup.has(name)) byGroup.set(name, []);
    byGroup.get(name).push(category);
  }
  const result = [];
  const seenGroups = new Set();
  for (const group of groups) {
    const name = String(group);
    seenGroups.add(name);
    result.push(...(byGroup.get(name) || []));
  }
  for (const [group, rows] of byGroup) {
    if (!seenGroups.has(group)) result.push(...rows);
  }
  return result;
}

function simulateBankOps(source, ops = [], context = {}) {
  const state = source && Array.isArray(source.categories) && Array.isArray(source.rules)
    ? {
      groups: (source.groups || []).slice(),
      categories: source.categories.map((category) => ({ ...category })),
      rules: source.rules.map((rule) => ({ ...rule })),
    }
    : schemaArrangeBankInitial(source, context.rules || []);
  for (const op of Array.isArray(ops) ? ops : []) {
    if (op?.op === "group.move") {
      const anchor = op.before ?? op.after;
      if (!state.groups.includes(op.group) || !state.groups.includes(anchor) || op.group === anchor) {
        return { ok: false, code: "invalid-group-move" };
      }
      const next = schemaArrangeMoveByAnchor(state.groups, op.group, anchor, op.before !== undefined ? "before" : "after");
      if (!next) return { ok: false, code: "invalid-group-move" };
      state.groups = next;
      state.categories = schemaArrangeBankOrderCategories(state.categories, state.groups);
    } else if (op?.op === "category.move") {
      const anchor = op.before ?? op.after;
      const item = state.categories.find((category) => category.key === op.key);
      const target = state.categories.find((category) => category.key === anchor);
      if (!item || !target || item.group !== target.group || item.key === target.key) {
        return { ok: false, code: "invalid-category-move" };
      }
      const order = state.categories.map((category) => category.key);
      const next = schemaArrangeMoveByAnchor(order, op.key, anchor, op.before !== undefined ? "before" : "after");
      if (!next) return { ok: false, code: "invalid-category-move" };
      const byKey = new Map(state.categories.map((category) => [category.key, category]));
      state.categories = next.map((key) => byKey.get(key));
    } else if (op?.op === "rule.move") {
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= state.rules.length
        || schemaArrangeRuleMatch(state.rules[op.index]) !== String(op.match_was)
        || !Number.isInteger(op.position) || op.position < 0 || op.position >= state.rules.length) {
        return { ok: false, code: "invalid-rule-move" };
      }
      const [rule] = state.rules.splice(op.index, 1);
      state.rules.splice(op.position, 0, rule);
    } else {
      return { ok: false, code: "unsupported-bank-op" };
    }
  }
  return state;
}

function schemaArrangeExpectedBankCategories(arrangement, categories, groups) {
  const byKey = new Map(categories.map((category) => [category.key, category]));
  const result = [];
  const emitted = new Set();
  for (const group of groups) {
    const scope = `group:${group}`;
    const listed = arrangement.scopeIds().includes(scope) ? arrangement.projected(scope) : [];
    for (const key of listed) {
      const category = byKey.get(key);
      if (category && String(category.group) === String(group)) {
        result.push(category);
        emitted.add(key);
      }
    }
    for (const category of categories) {
      if (category?.hidden === true) continue;
      if (String(category.group) === String(group) && !emitted.has(category.key)) {
        result.push(category);
        emitted.add(category.key);
      }
    }
  }
  for (const category of categories) {
    if (!emitted.has(category.key)) result.push(category);
  }
  return result;
}

function compileBankArrangement(arrangement, { categories = [], rules = [] } = {}) {
  if (!arrangement || typeof arrangement.scopeIds !== "function") {
    return { ok: false, code: "compile-mismatch" };
  }
  const groups = arrangement.saved("groups");
  const projectedGroups = arrangement.projected("groups");
  const ops = [];
  const groupOps = schemaArrangeTargetOrderOps(groups, projectedGroups, (id, index, target, moved) => {
    const anchor = schemaArrangeAnchorForTarget(index, target, moved);
    return anchor ? { op: "group.move", group: id, [anchor.side]: anchor.anchor } : null;
  });
  if (!groupOps) return { ok: false, code: "compile-mismatch" };
  ops.push(...groupOps);

  const categoryRows = Array.isArray(categories) ? categories.map((category) => ({ ...category })) : [];
  for (const scope of arrangement.scopeIds().filter((scopeId) => scopeId.startsWith("group:"))) {
    const group = scope.slice("group:".length);
    const saved = arrangement.saved(scope);
    const projected = arrangement.projected(scope);
    const groupOpsForCategories = schemaArrangeTargetOrderOps(saved, projected, (id, index, target, moved) => {
      const anchor = schemaArrangeAnchorForTarget(index, target, moved);
      if (!anchor) return null;
      const item = categoryRows.find((category) => category.key === id);
      const neighbor = categoryRows.find((category) => category.key === anchor.anchor);
      if (!item || !neighbor || String(item.group) !== group || String(neighbor.group) !== group) return null;
      return { op: "category.move", key: id, [anchor.side]: anchor.anchor };
    });
    if (!groupOpsForCategories) return { ok: false, code: "compile-mismatch" };
    ops.push(...groupOpsForCategories);
  }

  const savedRuleIds = arrangement.saved("rules");
  const projectedRuleIds = arrangement.projected("rules");
  const ruleMoved = schemaArrangeMovedSet(savedRuleIds, projectedRuleIds);
  if (!ruleMoved) return { ok: false, code: "compile-mismatch" };
  const liveRuleIds = savedRuleIds.slice();
  const liveRules = Array.isArray(rules) ? rules.map((rule) => ({ ...rule })) : [];
  const ruleOps = schemaArrangeAbsoluteOrderOps(savedRuleIds, projectedRuleIds, (id, position) => {
    const currentIndex = liveRuleIds.indexOf(id);
    if (currentIndex < 0 || !liveRules[currentIndex]) return null;
    const op = {
      op: "rule.move",
      index: currentIndex,
      match_was: schemaArrangeRuleMatch(liveRules[currentIndex]),
      position,
    };
    const [ruleId] = liveRuleIds.splice(currentIndex, 1);
    liveRuleIds.splice(position, 0, ruleId);
    const [rule] = liveRules.splice(currentIndex, 1);
    liveRules.splice(position, 0, rule);
    return op;
  });
  if (!ruleOps) return { ok: false, code: "compile-mismatch" };
  ops.push(...ruleOps);

  const initial = {
    groups,
    categories: categoryRows,
    rules: Array.isArray(rules) ? rules.map((rule) => ({ ...rule })) : [],
  };
  const replayed = simulateBankOps(initial, ops);
  if (!replayed || replayed.ok === false) return { ok: false, code: "compile-mismatch" };
  const expectedCategories = schemaArrangeExpectedBankCategories(arrangement, categoryRows, projectedGroups);
  const expectedRules = arrangement.projected("rules");
  const identityReplay = simulateBankOps({
    groups,
    categories: categoryRows,
    rules: (Array.isArray(rules) ? rules : []).map((rule, index) => ({ ...rule, __arrangeId: savedRuleIds[index] })),
  }, ops);
  if (!schemaArrangeSameOrder(replayed.groups, projectedGroups)
    || !schemaArrangeSameOrder(replayed.categories.map((category) => category.key), expectedCategories.map((category) => category.key))
    || !identityReplay || identityReplay.ok === false
    || !schemaArrangeSameOrder(identityReplay.rules.map((rule) => rule.__arrangeId), expectedRules)) {
    // Rule identities are tracked separately from their (possibly duplicate) match text.
    return { ok: false, code: "compile-mismatch" };
  }
  return ops;
}

function arrangeGapHintLabels(count) {
  const size = Math.max(0, Math.floor(Number(count) || 0));
  if (!size) return [];
  let width = 1;
  let capacity = SCHEMA_ARRANGE_GAP_ALPHABET.length;
  while (capacity < size) {
    width += 1;
    capacity *= SCHEMA_ARRANGE_GAP_ALPHABET.length;
  }
  const labels = [];
  for (let value = 0; value < size; value += 1) {
    let remainder = value;
    const chars = new Array(width);
    for (let position = width - 1; position >= 0; position -= 1) {
      chars[position] = SCHEMA_ARRANGE_GAP_ALPHABET[remainder % SCHEMA_ARRANGE_GAP_ALPHABET.length];
      remainder = Math.floor(remainder / SCHEMA_ARRANGE_GAP_ALPHABET.length);
    }
    labels.push(chars.join(""));
  }
  return labels;
}

function arrangeFlipPlan(beforeRects, afterRects) {
  const readEntries = (value) => value instanceof Map ? [...value.entries()] : Object.entries(value || {});
  const before = new Map(readEntries(beforeRects));
  const plan = {};
  for (const [id, after] of readEntries(afterRects)) {
    const prior = before.get(id);
    if (!prior || !after) continue;
    const left = Number(prior.left ?? prior.x);
    const top = Number(prior.top ?? prior.y);
    const nextLeft = Number(after.left ?? after.x);
    const nextTop = Number(after.top ?? after.y);
    if (![left, top, nextLeft, nextTop].every(Number.isFinite)) continue;
    const dx = left - nextLeft;
    const dy = top - nextTop;
    if (dx || dy) plan[id] = { dx, dy };
  }
  return plan;
}
