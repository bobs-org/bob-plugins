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
  const code = character.charCodeAt(0);
  if (code < 128) {
    return (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    );
  }
  return /[\p{L}\p{N}]/u.test(character);
}

// Tiers 3/2/1 over one lowercased field, or null: the prefix,
// word-prefix, and substring checks. The word-prefix scan uses the
// native `indexOf` to visit only the indices where the term actually
// occurs instead of probing every index: identical tiers, linear
// instead of quadratic behavior on long fields.
function substringTierOfWikilinkField(field, term) {
  if (field.startsWith(term)) {
    return 3;
  }
  let at = field.indexOf(term, 1);
  let seen = false;
  while (at !== -1) {
    seen = true;
    if (!taskWikilinkIsWordChar(field[at - 1])) {
      return 2;
    }
    at = field.indexOf(term, at + 1);
  }
  return seen ? 1 : null;
}

function taskWikilinkSubstringTier(field, term) {
  return substringTierOfWikilinkField(field, term);
}

// One term's best tier over the lowercased fields, or null when it
// matches nothing. Tiers, best first: 3 for a field prefix, 2 for a
// word prefix (the preceding character is not alphanumeric), 1 for a
// substring, and 0 for an in-order subsequence.
function taskWikilinkFieldTier(field, term) {
  const tier = taskWikilinkSubstringTier(field, term);
  if (tier !== null) {
    return tier;
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

// Lowercased searchable fields for one row, in hit-likelihood order:
// search text first (text queries hit it and break earliest), then the
// block ID, the `locator:block-id` composite, the locator, the note
// path, and the section. The SET of strings is exactly bob's
// `dependency_search_fields`, only reordered: scoring takes the max
// over fields, so order never changes a score, it only decides how
// soon tier 3 ends the term. Snapshot rows from `TaskWikilinkIndex`
// carry this array precomputed as `loweredSearchFields` so every
// per-keystroke rank reuses it; any other row computes it on demand.
function loweredTaskWikilinkSearchFields(row) {
  if (row && Array.isArray(row.loweredSearchFields)) {
    return row.loweredSearchFields;
  }
  const lower = (value) => String(value).toLowerCase();
  const fields = [lower(row.searchText)];
  if (row.blockId) {
    fields.push(lower(row.blockId));
    fields.push(lower(`${row.locator}:${row.blockId}`));
  }
  fields.push(lower(row.locator));
  fields.push(lower(row.notePath));
  if (row.section) {
    fields.push(lower(row.section));
  }
  return fields;
}

function splitWikilinkQueryTerms(query) {
  return String(query)
    .split(/\s+/)
    .filter((term) => term !== "")
    .map((term) => term.toLowerCase());
}

// Total tier score over already-lowercased fields and pre-split terms.
// This is the hot loop behind every keystroke: one call per row, with
// the field-tier body inline so thousands of rows don't pay a call per
// field. It returns exactly what the layered
// `taskWikilinkFieldTier`-per-field loop returns — the max tier per
// term — which the ranker differential test pins across randomized
// rows and queries. Two max-preserving prunes keep it in budget:
// tier 3 ends the term outright, and once the best tier so far is 2
// only a field prefix (tier 3) can still win, so the remaining
// `indexOf` scans are skipped; likewise the subsequence check runs
// only while no tier has been found at all.
function scoreLoweredFieldsWithTerms(fields, terms) {
  // Indexed loops, not for..of: iterator protocol overhead dominates
  // at 60k field visits per keystroke over a 5,000-row vault.
  let total = 0;
  for (let t = 0; t < terms.length; t += 1) {
    const term = terms[t];
    let best = null;
    for (let f = 0; f < fields.length; f += 1) {
      const field = fields[f];
      let tier = null;
      if (field.startsWith(term)) {
        tier = 3;
      } else if (best === null || best < 2) {
        let at = field.indexOf(term, 1);
        while (at !== -1) {
          tier = 1;
          // Inline the ASCII fast path of `taskWikilinkIsWordChar`
          // (non-ASCII still delegates): a cross-fragment call here
          // blocks inlining of this 60k-visits-per-keystroke loop.
          const prev = field.charCodeAt(at - 1);
          const wordChar =
            prev < 128
              ? (prev >= 48 && prev <= 57) ||
                (prev >= 65 && prev <= 90) ||
                (prev >= 97 && prev <= 122)
              : taskWikilinkIsWordChar(field[at - 1]);
          if (!wordChar) {
            tier = 2;
            break;
          }
          at = field.indexOf(term, at + 1);
        }
        if (tier === null && best === null) {
          if (taskWikilinkIsSubsequence(field, term)) {
            tier = 0;
          }
        }
      }
      if (tier !== null && (best === null || tier > best)) {
        best = tier;
        if (best === 3) {
          break;
        }
      }
    }
    if (best === null) {
      return null;
    }
    total += best;
  }
  return total;
}

// Total tier score over already-lowercased fields. Parses the query,
// then delegates to the fused scorer, so both entry points agree.
function matchScoreLoweredFields(fields, query) {
  return scoreLoweredFieldsWithTerms(fields, splitWikilinkQueryTerms(query));
}

// Total tier score for raw (unlowercased) searchable fields against a
// query, or null when any whitespace-separated term matches nothing.
// An empty query scores zero, so callers rank matches and canonical
// order with one comparator.
function matchScoreWikilinkTasks(rawFields, query) {
  // Lowercase once per call, not once per term: per-keystroke ranking
  // over thousands of rows must not re-allocate every field per term.
  return matchScoreLoweredFields(
    rawFields.map((field) => String(field).toLowerCase()),
    query,
  );
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
  // Terms parse once per keystroke, not once per row.
  const terms = splitWikilinkQueryTerms(query);
  const scored = [];
  for (const row of rows) {
    const score = scoreLoweredFieldsWithTerms(
      loweredTaskWikilinkSearchFields(row),
      terms,
    );
    if (score !== null) {
      // The canonical key is computed once per row, not once per sort
      // comparison: identical order, linear instead of log-linear key
      // builds over thousands of rows.
      scored.push({
        row,
        score,
        openOrder: row.open ? 0 : 1,
        key: canonicalKeyWikilinkTask(row, ownerPath),
      });
    }
  }
  scored.sort((left, right) => {
    if (left.openOrder !== right.openOrder) {
      return left.openOrder - right.openOrder;
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return compareCanonicalWikilinkKeys(left.key, right.key);
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
