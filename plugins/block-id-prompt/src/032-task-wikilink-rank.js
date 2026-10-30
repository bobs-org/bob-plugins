// Ranker for the `((` Task Wikilink Picker: the searchable fields,
// tiered AND matcher, and picker order. This mirrors
// `capture_dependency_tasks::dependency_search_fields`,
// `capture_link_tasks::match_score`, and
// `capture_dependency_tasks::order_for_picker` (with `group_for` and
// the canonical key), so a warm vault paints in the same order bob
// would serve. Pure: no Obsidian imports.

// Raw searchable fields for a parsed task row, in bob's order:
// `locator:block-id` and the block ID (identified rows only), the
// search text, the locator, the full note path, and the section.
function taskWikilinkSearchFields(row) {
  const fields = [];
  if (row.blockId) {
    fields.push(`${row.locator}:${row.blockId}`);
    fields.push(row.blockId);
  }
  fields.push(row.searchText);
  fields.push(row.locator);
  fields.push(row.notePath);
  if (row.section) {
    fields.push(row.section);
  }
  return fields;
}

function taskWikilinkIsWordChar(character) {
  return /[\p{L}\p{N}]/u.test(character);
}

// One term's best tier over the lowercased fields, or null when it
// matches nothing. Tiers, best first: 3 for a field prefix, 2 for a
// word prefix (the preceding character is not alphanumeric), 1 for a
// substring, and 0 for an in-order subsequence.
function taskWikilinkFieldTier(field, term) {
  if (field.startsWith(term)) {
    return 3;
  }
  for (let index = 1; index < field.length; index += 1) {
    if (
      field.startsWith(term, index) &&
      !taskWikilinkIsWordChar(field[index - 1])
    ) {
      return 2;
    }
  }
  if (field.includes(term)) {
    return 1;
  }
  if (taskWikilinkIsSubsequence(field, term)) {
    return 0;
  }
  return null;
}

function taskWikilinkIsSubsequence(field, term) {
  let wanted = 0;
  for (const cell of field) {
    if (cell === term[wanted]) {
      wanted += 1;
      if (wanted === term.length) {
        return true;
      }
    }
  }
  return wanted === term.length;
}

// Total tier score for raw (unlowercased) searchable fields against a
// query, or null when any whitespace-separated term matches nothing.
// An empty query scores zero, so callers rank matches and canonical
// order with one comparator.
function matchScoreWikilinkTasks(rawFields, query) {
  const terms = String(query)
    .split(/\s+/)
    .filter((term) => term !== "")
    .map((term) => term.toLowerCase());
  let total = 0;
  for (const term of terms) {
    let best = null;
    for (const field of rawFields) {
      const tier = taskWikilinkFieldTier(
        String(field).toLowerCase(),
        term,
      );
      if (tier !== null && (best === null || tier > best)) {
        best = tier;
      }
    }
    if (best === null) {
      return null;
    }
    total += best;
  }
  return total;
}

// Stable picker group rank for a task: same-note open tasks first,
// then In Progress, Next, other open tasks, then completed history.
function canonicalKeyWikilinkTask(row, ownerPath) {
  let section;
  if (!row.open) {
    section = 4;
  } else if (ownerPath && ownerPath === row.notePath) {
    section = 0;
  } else if (row.status === "/") {
    section = 1;
  } else if (row.status === "*") {
    section = 2;
  } else {
    section = 3;
  }
  const hidden = row.hidden ? 1 : 0;
  const note = section === 0 ? "" : row.notePath;
  return [section, hidden, note, row.line];
}

function compareCanonicalWikilinkKeys(left, right) {
  if (left[0] !== right[0]) {
    return left[0] - right[0];
  }
  if (left[1] !== right[1]) {
    return left[1] - right[1];
  }
  if (left[2] !== right[2]) {
    return left[2] < right[2] ? -1 : 1;
  }
  return left[3] - right[3];
}

// Order parsed rows for the picker: query matches first (open matches
// by score, then completed-history matches by score, ties keeping
// canonical order), or the plain canonical order for an empty query.
// Completed history always trails open matches so searches still find
// it without burying actionable rows. The sort is stable, so full ties
// keep catalog (path/line) order.
function orderForWikilinkPicker(rows, query, ownerPath) {
  const scored = [];
  for (const row of rows) {
    const score = matchScoreWikilinkTasks(
      taskWikilinkSearchFields(row),
      query,
    );
    if (score !== null) {
      scored.push({ row, score });
    }
  }
  scored.sort((left, right) => {
    const openOrder =
      (left.row.open ? 0 : 1) - (right.row.open ? 0 : 1);
    if (openOrder !== 0) {
      return openOrder;
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return compareCanonicalWikilinkKeys(
      canonicalKeyWikilinkTask(left.row, ownerPath),
      canonicalKeyWikilinkTask(right.row, ownerPath),
    );
  });
  return scored.map((entry) => entry.row);
}

// The bytes an accepted identified row splices: the backend
// `[[target#^id]]` form shared with `capture-task-id`'s
// `wikilink_replacement`. ID-less and guarded rows resolve through the
// explicit Add block ID flow instead, so they splice nothing.
function replacementForWikilinkTask(row, disabledReason) {
  if (!row.blockId || disabledReason) {
    return "";
  }
  return `[[${row.linkTarget}#^${row.blockId}]]`;
}
