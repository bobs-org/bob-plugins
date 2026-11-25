// Pure task-settle transform twin (bob-cli-q4.8.1.1 pure-twin).
//
// Ports `src/native/task_settle.rs`: the local future-schedule Blocked rule,
// the grouping transform application, and the surviving-line map (raw Myers
// matches first, exact-text fallback, then the stable task-line key).

function tsTaskLineKey(line, classification) {
  const text = String(line);
  let leading = 0;
  while (text[leading] === " " || text[leading] === "\t") leading += 1;
  const markerEnd = tsAfterListMarker(text, leading);
  if (markerEnd == null) return null;
  let checkboxStart = markerEnd;
  while (text[checkboxStart] === " " || text[checkboxStart] === "\t") checkboxStart += 1;
  if (text[checkboxStart] !== "[") return null;
  const close = text.indexOf("]", checkboxStart + 1);
  if (close === -1) return null;
  const statusText = text.slice(checkboxStart + 1, close);
  const symbols = Array.from(statusText);
  if (symbols.length !== 1) return null;
  const afterCheckbox = text.slice(close + 1);
  const body = afterCheckbox.replace(/^\s+/, "");
  if (!tsMatchesTaskFilter(classification, body)) return null;
  const tokens = body.split(/\s+/).filter(Boolean);
  const stable = [];
  let skipping = false;
  for (const token of tokens) {
    if (skipping) {
      if (token.includes("]")) skipping = false;
      continue;
    }
    if (token.startsWith("[unblocked::")) {
      if (!token.includes("]")) skipping = true;
      continue;
    }
    stable.push(token);
  }
  return `${text.slice(0, checkboxStart)}[?] ${stable.join(" ")}`;
}

function tsMyersMaxD(n, m) {
  return Math.floor((n + m + 1) / 2) + 1;
}

function tsMyersCommonPrefix(before, ob, oe, after, nb, ne) {
  let advance = 0;
  while (ob + advance < oe && nb + advance < ne && before[ob + advance] === after[nb + advance]) {
    advance += 1;
  }
  return advance;
}

function tsMyersCommonSuffix(before, ob, oe, after, nb, ne) {
  let advance = 0;
  while (oe - advance - 1 >= ob && ne - advance - 1 >= nb && before[oe - advance - 1] === after[ne - advance - 1]) {
    advance += 1;
  }
  return advance;
}

// Faithful port of similar 2.7.0's Myers divide-and-conquer (`conquer` +
// `find_middle_snake`), which is what Rust's `capture_diff_slices` uses for
// the surviving-line map. Only Equal runs are collected.
function tsMyersFindMiddleSnake(before, ob, n, after, nb, m, vf, voff, vb, voff) {
  const delta = n - m;
  const odd = (delta & 1) === 1;
  vf[1 + voff] = 0;
  vb[1 + voff] = 0;
  const dMax = tsMyersMaxD(n, m);
  for (let d = 0; d < dMax; d += 1) {
    for (let k = d; k >= -d; k -= 2) {
      let x;
      if (k === -d || (k !== d && vf[k - 1 + voff] < vf[k + 1 + voff])) {
        x = vf[k + 1 + voff];
      } else {
        x = vf[k - 1 + voff] + 1;
      }
      const y = x - k;
      const x0 = x;
      const y0 = y;
      if (x < n && y >= 0 && y < m) {
        x += tsMyersCommonPrefix(before, ob + x, ob + n, after, nb + y, nb + m);
      }
      vf[k + voff] = x;
      if (odd && Math.abs(k - delta) <= d - 1) {
        if (vf[k + voff] + vb[-(k - delta) + voff] >= n) {
          return [x0 + ob, y0 + nb];
        }
      }
    }
    for (let k = d; k >= -d; k -= 2) {
      let x;
      if (k === -d || (k !== d && vb[k - 1 + voff] < vb[k + 1 + voff])) {
        x = vb[k + 1 + voff];
      } else {
        x = vb[k - 1 + voff] + 1;
      }
      let y = x - k;
      if (x < n && y >= 0 && y < m) {
        const advance = tsMyersCommonSuffix(
          before,
          ob,
          ob + n - x,
          after,
          nb,
          nb + m - y,
        );
        x += advance;
        y += advance;
      }
      vb[k + voff] = x;
      if (!odd && Math.abs(k - delta) <= d) {
        if (vb[k + voff] + vf[-(k - delta) + voff] >= n) {
          return [n - x + ob, m - y + nb];
        }
      }
    }
  }
  return null;
}

function tsMyersConquer(before, ob, oe, after, nb, ne, vf, voff, vb, voff, runs) {
  const prefix = tsMyersCommonPrefix(before, ob, oe, after, nb, ne);
  if (prefix > 0) runs.push({ oldIndex: ob, newIndex: nb, length: prefix });
  ob += prefix;
  nb += prefix;
  const suffix = tsMyersCommonSuffix(before, ob, oe, after, nb, ne);
  const suffixOld = oe - suffix;
  const suffixNew = ne - suffix;
  oe -= suffix;
  ne -= suffix;
  const oldEmpty = ob >= oe;
  const newEmpty = nb >= ne;
  if (!oldEmpty || !newEmpty) {
    if (newEmpty) {
      // deletion: no equal run
    } else if (oldEmpty) {
      // insertion: no equal run
    } else {
      const middle = tsMyersFindMiddleSnake(before, ob, oe - ob, after, nb, ne - nb, vf, voff, vb, voff);
      if (middle) {
        const [xStart, yStart] = middle;
        tsMyersConquer(before, ob, xStart, after, nb, yStart, vf, voff, vb, voff, runs);
        tsMyersConquer(before, xStart, oe, after, yStart, ne, vf, voff, vb, voff, runs);
      }
    }
  }
  if (suffix > 0) runs.push({ oldIndex: suffixOld, newIndex: suffixNew, length: suffix });
}

function tsMyersEqualRuns(before, after) {
  const n = before.length;
  const m = after.length;
  if (n === 0 || m === 0) return [];
  const maxD = tsMyersMaxD(n, m);
  const vf = new Array(2 * maxD).fill(0);
  const vb = new Array(2 * maxD).fill(0);
  const runs = [];
  tsMyersConquer(before, 0, n, after, 0, m, vf, maxD, vb, maxD, runs);
  runs.sort((a, b) => a.oldIndex - b.oldIndex || a.newIndex - b.newIndex);
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.oldIndex + last.length === run.oldIndex && last.newIndex + last.length === run.newIndex) {
      last.length += run.length;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function tsMapSurvivingLines(beforeText, afterText, classification) {
  const before = taskSettleLogicalLines(beforeText);
  const after = taskSettleLogicalLines(afterText);
  const mapped = new Map();
  const used = new Set();
  for (const run of tsMyersEqualRuns(before, after)) {
    for (let offset = 0; offset < run.length; offset += 1) {
      mapped.set(run.oldIndex + offset, run.newIndex + offset);
      used.add(run.newIndex + offset);
    }
  }
  const keyCache = new Map();
  const keyOf = (index) => {
    if (!keyCache.has(index)) keyCache.set(index, tsTaskLineKey(before[index], classification));
    return keyCache.get(index);
  };
  const afterKeyCache = new Map();
  const afterKeyOf = (index) => {
    if (!afterKeyCache.has(index)) {
      afterKeyCache.set(index, tsTaskLineKey(after[index], classification));
    }
    return afterKeyCache.get(index);
  };
  for (let oldIndex = 0; oldIndex < before.length; oldIndex += 1) {
    if (mapped.has(oldIndex)) continue;
    const line = before[oldIndex];
    let best = -1;
    let bestDistance = Infinity;
    for (let newIndex = 0; newIndex < after.length; newIndex += 1) {
      if (used.has(newIndex) || after[newIndex] !== line) continue;
      const distance = Math.abs(newIndex - oldIndex);
      if (distance < bestDistance || (distance === bestDistance && newIndex < best)) {
        best = newIndex;
        bestDistance = distance;
      }
    }
    let rewritten = -1;
    const key = keyOf(oldIndex);
    if (key != null) {
      let bestKey = -1;
      let bestKeyDistance = Infinity;
      for (let newIndex = 0; newIndex < after.length; newIndex += 1) {
        if (used.has(newIndex)) continue;
        if (afterKeyOf(newIndex) !== key) continue;
        const distance = Math.abs(newIndex - oldIndex);
        if (distance < bestKeyDistance || (distance === bestKeyDistance && newIndex < bestKey)) {
          bestKey = newIndex;
          bestKeyDistance = distance;
        }
      }
      rewritten = bestKey;
    }
    const chosen = best !== -1 ? best : rewritten;
    if (chosen !== -1) {
      mapped.set(oldIndex, chosen);
      used.add(chosen);
    }
  }
  const out = {};
  for (const [oldIndex, newIndex] of [...mapped.entries()].sort((a, b) => a[0] - b[0])) {
    out[oldIndex] = newIndex;
  }
  return out;
}

function taskSettleLocalSchedules(contents, today, classification) {
  const text = String(contents);
  const lines = taskSettleLogicalLines(text);
  const segments = tsSplitSegments(text);
  if (lines.length === 0 || segments.length === 0 || lines.length !== segments.length) {
    return text;
  }
  let changed = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    let leading = 0;
    while (line[leading] === " " || line[leading] === "\t") leading += 1;
    const markerEnd = tsAfterListMarker(line, leading);
    if (markerEnd == null) continue;
    let checkboxStart = markerEnd;
    while (line[checkboxStart] === " " || line[checkboxStart] === "\t") checkboxStart += 1;
    if (line[checkboxStart] !== "[") continue;
    const close = line.indexOf("]", checkboxStart + 1);
    if (close === -1) continue;
    const symbols = Array.from(line.slice(checkboxStart + 1, close));
    if (symbols.length !== 1) continue;
    const status = symbols[0];
    if (!tsIsOpenStatus(classification, status)) continue;
    const afterCheckbox = line.slice(close + 1);
    if (afterCheckbox !== "" && !/^\s/.test(afterCheckbox)) continue;
    const body = afterCheckbox.replace(/^\s+/, "");
    if (!tsMatchesTaskFilter(classification, body)) continue;
    const blockId = tsTrailingBlockId(body);
    const metadata = tsTaskMetadata(body, blockId);
    if (!(metadata.scheduled != null && metadata.scheduled > today)) continue;
    let rewritten = line;
    if (status !== "?") {
      rewritten = `${rewritten.slice(0, checkboxStart + 1)}?${rewritten.slice(checkboxStart + 1 + status.length)}`;
    }
    const pruned = tsPruneUnblocked(rewritten, today);
    if (pruned != null) rewritten = pruned;
    if (rewritten !== line) {
      const segment = segments[lineIndex];
      let ending = "";
      if (segment.endsWith("\r\n")) ending = "\r\n";
      else if (segment.endsWith("\n")) ending = "\n";
      segments[lineIndex] = `${rewritten}${ending}`;
      changed = true;
    }
  }
  if (!changed) return text;
  return segments.join("");
}

function taskSettleNote(relativePath, contents, today, classification, dailyPath) {
  const text = String(contents);
  const scheduled = taskSettleLocalSchedules(text, today, classification);
  let transformed;
  if (taskSettleGroupingEligible(relativePath, scheduled, dailyPath)) {
    transformed = taskSettleTransform(scheduled, classification);
  } else {
    transformed = { contents: scheduled, changed: false, groupedSections: [], warnings: [] };
  }
  const lineMap = tsMapSurvivingLines(text, transformed.contents, classification);
  return {
    contents: transformed.contents,
    changed: transformed.contents !== text,
    lineMap,
    groupedSections: transformed.groupedSections,
    warnings: transformed.warnings,
  };
}

function taskSettleTextValue(value) {
  const lines = value.lines || [];
  const ending = value.ending || "\n";
  let result = lines.join(ending);
  if (value.final_newline) result += ending;
  return result;
}
