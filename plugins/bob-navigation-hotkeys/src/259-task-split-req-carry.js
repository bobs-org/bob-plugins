// Requirement-carry half of the task-split twin (`256-task-split-plan.js`,
// `257-task-split-apply.js`). Ports the requirement behavior of bob-cli
// `src/native/task_split/plan.rs` plus `carry.rs` (SP32–SP51) on top of the
// note twin: requirement candidates at any depth, state/exclusion refusals,
// overlap refusal, `[>]` stubs, whole-branch extraction with the NOTES rule
// through the task-block twins, the descendant move map, ReqKey selection,
// and the req-aware split notice. Pure: no Obsidian imports.
//
// `planSplitBullets` and `listTaskSplitCandidates` (257) call into these
// helpers; `taskSplitSelectCandidates` and `taskSplitValidateCandidates`
// live here so `257-task-split-apply.js` stays at or below the 1000-line
// fragment cap. Selection kinds stay 1-based, exactly like the Rust twin.

// --- Sync SHA-256 (UTF-8) --------------------------------------------------
// `note_tasks::line_digest` and `task_reqs::req_row_key` hash Rust-trimmed
// text with SHA-256. Node tests inject their own digest, but the live
// plugin and its `api.taskSplit` need a sync twin (Obsidian exposes only
// the async `crypto.subtle`). Pinned against Node's `createHash("sha256")`
// by `test-navigation-task-split-carry-api.cjs`.

const TASK_SPLIT_SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function taskSplitSha256Bytes(text) {
  const input = String(text == null ? "" : text);
  const bytes = [];
  for (let index = 0; index < input.length; index += 1) {
    let point = input.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        point = 0x10000 + ((point - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (point < 0x80) {
      bytes.push(point);
    } else if (point < 0x800) {
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      bytes.push(
        0xe0 | (point >> 12),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return bytes;
}

function taskSplitSha256Hex(text) {
  const bytes = taskSplitSha256Bytes(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0x00);
  }
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push(
    (high >>> 24) & 0xff, (high >>> 16) & 0xff,
    (high >>> 8) & 0xff, high & 0xff,
    (low >>> 24) & 0xff, (low >>> 16) & 0xff,
    (low >>> 8) & 0xff, low & 0xff,
  );
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  const words = new Array(64);
  const rotr = (value, bits) =>
    ((value >>> bits) | (value << (32 - bits))) >>> 0;
  for (let block = 0; block < bytes.length; block += 64) {
    for (let index = 0; index < 16; index += 1) {
      const offset = block + index * 4;
      words[index] = (
        ((bytes[offset] << 24) | (bytes[offset + 1] << 16) |
          (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
      );
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = (rotr(words[index - 15], 7) ^ rotr(words[index - 15], 18) ^
        (words[index - 15] >>> 3)) >>> 0;
      const s1 = (rotr(words[index - 2], 17) ^ rotr(words[index - 2], 19) ^
        (words[index - 2] >>> 10)) >>> 0;
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3;
    let e = h4; let f = h5; let g = h6; let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + s1 + ch + TASK_SPLIT_SHA256_K[index] + words[index]) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => (`00000000${word.toString(16)}`).slice(-8))
    .join("");
}

// Rust `char::is_whitespace` (Unicode White_Space); JS `String#trim` differs
// on U+0085 and U+FEFF, so digests trim with this class instead.
const TASK_SPLIT_RUST_TRIM_END_RE =
  /[ \t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/;
function taskSplitRustTrimEnd(text) {
  return String(text == null ? "" : text).replace(
    TASK_SPLIT_RUST_TRIM_END_RE,
    "",
  );
}

// `note_tasks::line_digest`: SHA-256 of the Rust-trimmed line, first 8 hex.
function taskSplitLineDigest(line) {
  return taskSplitSha256Hex(taskSplitRustTrimEnd(line)).slice(0, 8);
}

// `task_reqs::req_row_key` suffix (`/req/<path>~<8-hex>`) for a candidate's
// clean title. `ownerKey` is the caller's; the plan matches with `endsWith`.
function taskSplitReqRowSuffix(path, cleanText) {
  const dotted = (Array.isArray(path) ? path : []).join(".");
  return `/req/${dotted}~${taskSplitSha256Hex(String(cleanText == null ? "" : cleanText)).slice(0, 8)}`;
}

// --- Requirement candidates -----------------------------------------------

// Why a selected req refuses: only an open req (or an unknown mark) that no
// dropped or carried ancestor excludes travels. Mirrors `carry::req_refusal`.
function taskSplitReqRefusal(req) {
  if (!req) {
    return null;
  }
  if (req.state === "excluded") {
    if (req.excludedBecause === "dropped") {
      return taskSplitError(
        "split_req_excluded",
        "Its parent requirement was dropped — restore it first",
      );
    }
    return taskSplitError(
      "split_req_excluded",
      "Its parent requirement was carried into its own task — it goes with it",
    );
  }
  if (req.mark === "open" || req.mark === "unknown") {
    return null;
  }
  if (req.mark === "dropped") {
    return taskSplitError(
      "split_not_splittable",
      "Dropped — restore it first",
    );
  }
  if (req.mark === "carried") {
    return taskSplitError(
      "split_not_splittable",
      "Carried — open the linked task",
    );
  }
  return taskSplitError(
    "split_not_splittable",
    "Checked box — split an unchecked note instead",
  );
}

function taskSplitOverlapRefusal(ancestorTitle, title) {
  return taskSplitError(
    "split_overlap",
    `“${ancestorTitle}” already takes this branch — carry it alone and “${title}” goes with it`,
  );
}

// `capture::list_item_body`: the text after any `-`/`+`/`-`/ordered marker.
function taskSplitReqRawBody(strippedLine) {
  const text = String(strippedLine == null ? "" : strippedLine);
  const indent = taskSplitIndentOf(text);
  const rest = text.slice(indent.length);
  const first = rest.charAt(0);
  let marker = 0;
  if (first === "-" || first === "*" || first === "+") {
    marker = 1;
  } else if (first >= "0" && first <= "9") {
    let digits = 0;
    while (rest.charAt(digits) >= "0" && rest.charAt(digits) <= "9") {
      digits += 1;
    }
    if (
      digits > 0 &&
      (rest.charAt(digits) === "." || rest.charAt(digits) === ")")
    ) {
      marker = digits + 1;
    }
  }
  if (marker === 0) {
    return rest;
  }
  const after = rest.slice(marker);
  if (after.charAt(0) !== " " && after.charAt(0) !== "\t") {
    return rest;
  }
  return after.replace(/^[ \t]+/, "");
}

// The req forest rows owned by `ownerLine` (0-based) inside its block.
function taskSplitReqNodesFor(source, ownerLine, ownerEnd) {
  const text = String(source == null ? "" : source);
  return taskReqForest(text)
    .filter(
      (node) =>
        node.ownerIndex === ownerLine &&
        node.lineIndex <= ownerEnd &&
        node.lineIndex > ownerLine,
    )
    .sort((left, right) => left.lineIndex - right.lineIndex);
}

// Requirement candidates: each req with its whole branch, in document
// order. Mirrors the req half of `plan::collect_candidates`.
function taskSplitCollectReqCandidates(source, ownerLine, ownerEnd) {
  const lines = taskSplitLines(source);
  const stripped = lines.map((line) => taskSplitStripEnding(line));
  return taskSplitReqNodesFor(source, ownerLine, ownerEnd).map((node) => {
    const end = taskSplitListSubtreeEnd(stripped, node.lineIndex, ownerEnd);
    const childLines =
      end > node.lineIndex
        ? lines.slice(node.lineIndex + 1, Math.min(end, lines.length - 1) + 1)
        : [];
    return {
      line: node.lineIndex,
      end,
      indent: taskSplitIndentOf(stripped[node.lineIndex]),
      rawBody: taskSplitReqRawBody(stripped[node.lineIndex]),
      title: node.text,
      childLines,
      drawerTitle: null,
      parent:
        node.parentIndex === null || node.parentIndex === undefined
          ? ownerLine
          : node.parentIndex,
      req: {
        depth: node.depth,
        mark: node.mark,
        state: node.state,
        carriable:
          taskSplitReqRefusal({
            mark: node.mark,
            state: node.state,
            excludedBecause: node.excludedBecause,
          }) === null,
        path: Array.isArray(node.path) ? node.path.slice() : [],
        parentReq:
          node.parentIndex === null || node.parentIndex === undefined
            ? null
            : node.parentIndex,
        excludedBecause: node.excludedBecause || null,
      },
    };
  });
}

// A requirement line names its root owner: the real task its req chain
// hangs off. Returns the 0-based owner line, or null when `line` is no req.
function taskSplitReqOwnerForLine(source, line) {
  const nodes = taskReqForest(String(source == null ? "" : source));
  const node = nodes.find((entry) => entry.lineIndex === line) || null;
  return node ? node.ownerIndex : null;
}

// --- Carried block (`carry::carried_block`) ---------------------------------

function taskSplitWithNewline(line) {
  const text = String(line == null ? "" : line);
  return text.endsWith("\n") ? text : `${text}\n`;
}

// Build the new task block for a carried req: the task line plus its rebased
// subtree, the back-link in the managed zone, and the notes filed by the
// NOTES rule. Returns `{lines, moves}` where `moves` pairs 0-based offsets
// of moved nonblank lines before and after the layout.
function taskSplitCarriedBlock(taskLine, children, backLink, fallbackIndent) {
  let scratch = taskSplitWithNewline(taskLine);
  for (const child of children || []) {
    scratch += taskSplitWithNewline(child);
  }
  const original = scratch;
  const task = taskBlockFindTask(scratch, 0, {});
  if (task) {
    const slot = taskBlockInsertionSlot(scratch, task, "managed-link", {});
    const block = taskBlockRead(scratch, task, {});
    const indent =
      block.children.length > 0 ? slot.indent : String(fallbackIndent || "");
    if (backLink) {
      const line = formatLinkedFromLine(indent, [
        { link: backLink, label: TASK_MENTION_LABEL },
      ]);
      scratch = `${scratch.slice(0, slot.offset)}${line}\n${scratch.slice(slot.offset)}`;
    }
  }
  const tidyTask = taskBlockFindTask(scratch, 0, {});
  const tidy = tidyTask ? taskBlockPlanTidy(scratch, tidyTask, {}) : null;
  if (tidy) {
    scratch = tidy.updated;
  }
  return { lines: taskSplitLines(scratch), moves: taskSplitCarryMoveOffsets(original, scratch) };
}

// Groups of nonblank lines that travel as one: each direct child subtree of
// the block's task, except that a drawer splits into its header and one
// group per entry.
function taskSplitCarryBlockUnits(contents) {
  const task = taskBlockFindTask(contents, 0, {});
  if (!task) {
    return [];
  }
  const block = taskBlockRead(contents, task, {});
  const stripped = taskSplitLines(contents).map((line) =>
    taskSplitStripEnding(line),
  );
  const nonblank = (from, to) => {
    const out = [];
    for (let index = from; index <= to; index += 1) {
      if (taskReqTrim(String(stripped[index] || "")) !== "") {
        out.push(index);
      }
    }
    return out;
  };
  const units = [];
  for (const child of block.children) {
    if (!child.kind || child.kind.type !== "drawer") {
      units.push(nonblank(child.lineIndex, child.endIndex));
      continue;
    }
    const starts = [child.lineIndex];
    for (
      let entry = child.lineIndex + 1;
      entry <= child.endIndex;
      entry += 1
    ) {
      if (
        taskSplitListBody(taskSplitLines(contents)[entry]) !== null &&
        taskSplitIndentOf(stripped[entry]).length >
          taskSplitIndentOf(stripped[child.lineIndex]).length &&
        taskSplitParentListLine(stripped, entry, 0) === child.lineIndex
      ) {
        starts.push(entry);
      }
    }
    for (let position = 0; position < starts.length; position += 1) {
      const stop =
        position + 1 < starts.length
          ? starts[position + 1] - 1
          : child.endIndex;
      units.push(nonblank(starts[position], stop));
    }
  }
  return units;
}

// Pair each nonblank line of `before`'s child units with its line in
// `after`. Units keep their text (only leading indentation is rebased), and
// identical units always share a zone, so the first unclaimed unit with the
// same text is the one that moved there.
function taskSplitCarryMoveOffsets(before, after) {
  const beforeLines = taskSplitLines(before).map(taskSplitStripEnding);
  const afterLines = taskSplitLines(after).map(taskSplitStripEnding);
  const beforeUnits = taskSplitCarryBlockUnits(before);
  const afterUnits = taskSplitCarryBlockUnits(after);
  const textOf = (unitLines, unit) =>
    unit.map((index) => taskReqTrim(String(unitLines[index] || "")));
  const afterTexts = afterUnits.map((unit) => textOf(afterLines, unit));
  const claimed = afterUnits.map(() => false);
  const moves = [];
  for (const unit of beforeUnits) {
    const wanted = JSON.stringify(textOf(beforeLines, unit));
    let found = -1;
    for (let index = 0; index < afterUnits.length; index += 1) {
      if (
        !claimed[index] &&
        JSON.stringify(afterTexts[index]) === wanted
      ) {
        found = index;
        break;
      }
    }
    if (found === -1) {
      continue;
    }
    claimed[found] = true;
    for (let slot = 0; slot < unit.length; slot += 1) {
      moves.push([unit[slot], afterUnits[found][slot]]);
    }
  }
  moves.sort((left, right) => left[0] - right[0]);
  return moves;
}

// One indentation unit of the source: a carried req's own indent beyond its
// structural parent's, else a tab.
function taskSplitNestingUnit(sourceLines, candidate) {
  if (candidate.parent === null || candidate.parent === undefined) {
    return "\t";
  }
  const parentLine = taskSplitStripEnding(
    sourceLines[candidate.parent] || "",
  );
  const parentIndent = taskSplitIndentOf(parentLine);
  if (!candidate.indent.startsWith(parentIndent)) {
    return "\t";
  }
  const unit = candidate.indent.slice(parentIndent.length);
  return unit !== "" ? unit : "\t";
}

// --- Selection and validation (`plan::select_candidates`) ------------------
// Moved from `257-task-split-apply.js` and extended: requirement candidates
// nest, so a line maps to the innermost candidate whose branch holds it;
// `lines` maps every touched line; `count` walks siblings under one parent;
// `reqkey` selects a close-card requirement row. Unchanged otherwise.

function taskSplitValidateCandidates(candidates, selected) {
  for (const index of selected) {
    const item = candidates[index];
    if (item.req) {
      const refused = taskSplitReqRefusal(item.req);
      if (refused) {
        return refused;
      }
      if (item.title.trim() === "") {
        return taskSplitError(
          "split_not_splittable",
          "Bullet has no text to split",
        );
      }
      if (taskSplitIsStub(item.title)) {
        return taskSplitError(
          "split_stub",
          "Stub only links a task — split a note with its own text instead",
        );
      }
      continue;
    }
    const parsed = taskSplitParseBullet(item.rawBody);
    if (item.rawBody.includes("#task")) {
      return taskSplitError(
        "split_already_task",
        "Already a task — split one of its notes or drawer entries instead",
      );
    }
    if (parsed.checked) {
      return taskSplitError(
        "split_not_splittable",
        "Checked box — split an unchecked note instead",
      );
    }
    if (parsed.title.trim() === "") {
      return taskSplitError(
        "split_not_splittable",
        "Bullet has no text to split",
      );
    }
    if (taskSplitIsStub(parsed.title)) {
      return taskSplitError(
        "split_stub",
        "Stub only links a task — split a note with its own text instead",
      );
    }
  }
  // A req travels with its whole branch: selecting it together with one of
  // its ancestors is an overlap.
  for (const index of selected) {
    const item = candidates[index];
    let parent = item.req ? item.req.parentReq : null;
    while (parent !== null && parent !== undefined) {
      const ancestor = candidates.findIndex((other) => other.line === parent);
      if (ancestor === -1) {
        break;
      }
      if (selected.includes(ancestor)) {
        return taskSplitOverlapRefusal(
          candidates[ancestor].title,
          item.title,
        );
      }
      parent = candidates[ancestor].req
        ? candidates[ancestor].req.parentReq
        : null;
    }
  }
  return null;
}

function taskSplitSelectCandidates(candidates, lines, selection, owner, options) {
  // Requirement candidates nest, so a line maps to the innermost candidate
  // whose branch holds it: the one that starts last.
  const lineToCandidate = (line) => {
    let found = -1;
    for (let index = 0; index < candidates.length; index += 1) {
      if (line >= candidates[index].line && line <= candidates[index].end) {
        found = index;
      }
    }
    return found;
  };
  const kind = selection.kind || "cursor";
  if (kind === "cursor") {
    const index = Math.max(0, (selection.line || 1) - 1);
    if (owner.kind === "task" && index === owner.line) {
      return {
        selected: null,
        error: taskSplitError(
          "split_already_task",
          "Already a task — split one of its notes or drawer entries instead",
        ),
      };
    }
    const found = lineToCandidate(index);
    if (found !== -1) {
      const error = taskSplitValidateCandidates(candidates, [found]);
      return { selected: error ? null : [found], error };
    }
    const raw = lines[index] == null ? "" : String(lines[index]);
    if (
      raw.includes("DEPENDS ON") ||
      raw.includes("BLOCKS:") ||
      raw.includes("LINKS:") ||
      raw.includes("LINKED FROM") ||
      raw.includes("SCHEDULE LOG") ||
      raw.includes("WORK LOG") ||
      raw.includes("ROTTEN LOG") ||
      raw.includes("CANCEL LOG") ||
      raw.trimStart().startsWith("- (**")
    ) {
      return {
        selected: null,
        error: taskSplitError(
          "split_managed_line",
          "Managed line — Bob writes it; split a note or drawer entry instead",
        ),
      };
    }
    if (raw.trimStart().startsWith("- [x]") || raw.trimStart().startsWith("- [X]")) {
      return {
        selected: null,
        error: taskSplitError(
          "split_not_splittable",
          "Checked box — split an unchecked note instead",
        ),
      };
    }
    if (lineToCandidate(index) === -1 && raw.includes("[[") && !raw.includes(" ")) {
      return {
        selected: null,
        error: taskSplitError(
          "split_stub",
          "Stub only links a task — split a note with its own text instead",
        ),
      };
    }
    return {
      selected: null,
      error: taskSplitError(
        "split_not_splittable",
        "That line is not a splittable note",
      ),
    };
  }
  if (kind === "count") {
    const start = lineToCandidate(Math.max(0, (selection.line || 1) - 1));
    if (start === -1) {
      return {
        selected: null,
        error: taskSplitError(
          "split_not_splittable",
          "That line is not a splittable note",
        ),
      };
    }
    const anchor = candidates[start];
    const siblings = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const item = candidates[index];
      if (
        item.indent === anchor.indent &&
        item.drawerTitle === anchor.drawerTitle &&
        item.parent === anchor.parent &&
        item.line >= anchor.line
      ) {
        siblings.push(index);
      }
    }
    const picked = siblings.slice(0, Math.max(0, selection.count || 0));
    const error = taskSplitValidateCandidates(candidates, picked);
    return { selected: error ? null : picked, error };
  }
  if (kind === "lines") {
    // Every touched line selects its innermost candidate, so a selection
    // inside a nested req's branch never selects the ancestor too.
    const from = Math.max(0, (selection.from || 1) - 1);
    const to = Math.max(1, selection.to || 1);
    const touched = new Set();
    for (let line = from; line < to; line += 1) {
      const found = lineToCandidate(line);
      if (found !== -1) {
        touched.add(found);
      }
    }
    const picked = [...touched].sort(
      (left, right) => candidates[left].line - candidates[right].line,
    );
    const error = taskSplitValidateCandidates(candidates, picked);
    return { selected: error ? null : picked, error };
  }
  if (kind === "nth") {
    const picked = [];
    for (const ordinal of selection.picks || []) {
      if (!ordinal || ordinal > candidates.length) {
        return {
          selected: null,
          error: taskSplitError(
            "split_nth_missing",
            `no splittable bullet ${ordinal}`,
          ),
        };
      }
      picked.push(ordinal - 1);
    }
    const error = taskSplitValidateCandidates(candidates, picked);
    return { selected: error ? null : picked, error };
  }
  if (kind === "match") {
    const picked = [];
    for (const text of selection.texts || []) {
      const matches = [];
      for (let index = 0; index < candidates.length; index += 1) {
        if (candidates[index].title.includes(text)) {
          matches.push(index);
        }
      }
      if (matches.length === 1) {
        picked.push(matches[0]);
      } else if (matches.length === 0) {
        return {
          selected: null,
          error: taskSplitError(
            "split_match_missing",
            `no splittable bullet contains ${JSON.stringify(text)}`,
          ),
        };
      } else {
        return {
          selected: null,
          error: taskSplitError(
            "split_match_ambiguous",
            `more than one splittable bullet contains ${JSON.stringify(text)}`,
          ),
        };
      }
    }
    const error = taskSplitValidateCandidates(candidates, picked);
    return { selected: error ? null : picked, error };
  }
  if (kind === "section") {
    const picked = candidates.map((item, index) => index);
    const error = taskSplitValidateCandidates(candidates, picked);
    return { selected: error ? null : picked, error };
  }
  if (kind === "bulletref") {
    const value = String(selection.ref || "");
    const separator = value.indexOf(":");
    const line = Number(separator === -1 ? "" : value.slice(0, separator));
    const digest = separator === -1 ? "" : value.slice(separator + 1);
    const lineDigest =
      options && typeof options.lineDigest === "function"
        ? options.lineDigest
        : taskSplitLineDigest;
    let found = -1;
    if (Number.isInteger(line) && line >= 1) {
      for (let index = 0; index < candidates.length; index += 1) {
        const item = candidates[index];
        if (
          item.line + 1 === line &&
          lineDigest(taskSplitStripEnding(lines[item.line] || "")) === digest
        ) {
          found = index;
          break;
        }
      }
    }
    if (found === -1) {
      return {
        selected: null,
        error: taskSplitError(
          "split_stale_ref",
          "stale bullet reference; list candidates and try again",
        ),
      };
    }
    const error = taskSplitValidateCandidates(candidates, [found]);
    return { selected: error ? null : [found], error };
  }
  if (kind === "reqkey") {
    const key = String(selection.key || "");
    let found = -1;
    for (let index = 0; index < candidates.length; index += 1) {
      const item = candidates[index];
      if (
        item.req &&
        key.endsWith(taskSplitReqRowSuffix(item.req.path, item.title))
      ) {
        found = index;
        break;
      }
    }
    if (found === -1) {
      return {
        selected: null,
        error: taskSplitError(
          "split_stale_ref",
          "stale requirement reference; list candidates and try again",
        ),
      };
    }
    const error = taskSplitValidateCandidates(candidates, [found]);
    return { selected: error ? null : [found], error };
  }
  return {
    selected: null,
    error: taskSplitError(
      "split_not_splittable",
      "That line is not a splittable note",
    ),
  };
}

// --- Pure carry planner (`carry::carry_req`) --------------------------------
// Plans one requirement carry without touching the vault: `files` holds the
// owner note plus any already-read destination note, `args` carries the
// 1-based `line`, the `expectedLine` digest the caller saw, and an optional
// exact `expectedOwnerPreimage` owner-block guard. Returns `{ok: true,
// plan, task, moveMap}` or a typed refusal. The caller persists
// `plan.files` (destination first) and navigates to `task`.
function taskSplitPlanCarryReq(files, args) {
  const sourceFiles = files && typeof files === "object" ? files : {};
  const input = args && typeof args === "object" ? args : {};
  const notePath = String(input.notePath || "");
  const source = Object.prototype.hasOwnProperty.call(sourceFiles, notePath)
    ? String(sourceFiles[notePath])
    : null;
  if (source === null) {
    return taskSplitError(
      "split_owner_missing",
      `${notePath} does not exist in the vault`,
    );
  }
  const line = Math.floor(Number(input.line || 0));
  const lines = taskSplitLines(source);
  if (!Number.isInteger(line) || line < 1 || line > lines.length) {
    return taskSplitError(
      "split_stale_ref",
      "stale requirement reference; list candidates and try again",
    );
  }
  if (input.expectedLine !== undefined && input.expectedLine !== null) {
    const actual = taskSplitLineDigest(taskSplitStripEnding(lines[line - 1]));
    if (actual !== String(input.expectedLine)) {
      return taskSplitError(
        "split_stale_ref",
        "stale requirement reference; list candidates and try again",
      );
    }
  }
  const node =
    taskReqForest(source).find((entry) => entry.lineIndex === line - 1) ||
    null;
  if (!node) {
    return taskSplitError("not_a_req", "This line is not a requirement");
  }
  const stripped = lines.map((entry) => taskSplitStripEnding(entry));
  const frontmatterEnd = taskSplitFrontmatterEnd(stripped);
  const fenced = taskSplitFencedLines(
    stripped,
    frontmatterEnd === -1 ? 0 : frontmatterEnd + 1,
  );
  const resolved = taskSplitResolveOwner(lines, stripped, fenced, notePath, {
    ownerLine: node.ownerIndex + 1,
    selection: { kind: "cursor", line: node.ownerIndex + 1 },
  });
  if (resolved.error) {
    return resolved.error;
  }
  const owner = resolved.owner;
  if (
    input.expectedOwnerPreimage !== undefined &&
    input.expectedOwnerPreimage !== null
  ) {
    const blockText = lines.slice(owner.line, owner.end + 1).join("");
    if (blockText !== String(input.expectedOwnerPreimage)) {
      return taskSplitError(
        "split_stale_ref",
        "The owner changed — list candidates and try again",
      );
    }
  }
  const plan = planSplitBullets(sourceFiles, {
    ownerPath: notePath,
    ownerLine: node.ownerIndex + 1,
    selection: { kind: "cursor", line },
    today: String(input.today || ""),
    settings: input.settings || {},
  });
  if (!plan.ok) {
    return plan;
  }
  const task = Array.isArray(plan.tasks) ? plan.tasks[0] : null;
  if (!task || task.req_depth === undefined || task.req_depth === null) {
    return taskSplitError("not_a_req", "This line is not a requirement");
  }
  return {
    ok: true,
    plan,
    task: {
      path: task.path,
      line: task.line,
      blockId: task.block_id,
      text: task.title,
    },
    moveMap: {
      sourcePath: notePath,
      destinationPath: task.path,
      moves: Array.isArray(task.moves) ? task.moves : [],
    },
  };
}

// `plan::split_notice`: names requirements when every pick is one and
// bullets when notes and requirements mix.
function taskSplitNoticeFor(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const reqs = list.filter(
    (task) => task && task.req_depth !== undefined && task.req_depth !== null,
  ).length;
  let noun;
  if (reqs === 0) {
    noun = list.length === 1 ? "note" : "notes";
  } else if (reqs === list.length) {
    noun = list.length === 1 ? "requirement" : "requirements";
  } else {
    noun = "bullets";
  }
  const displayTitles = list
    .map((task) => `◯ ${taskSplitShortNoticeTitle(task.title)}`)
    .join(" · ");
  return `✂ Split ${list.length} ${noun} into tasks · ${displayTitles}`;
}
