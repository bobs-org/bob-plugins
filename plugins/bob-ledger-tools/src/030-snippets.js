function computeRange(now, durationMultiplier, offsetMultiplier, dashPresent) {
  const safeDate = coerceDate(now);
  const durationSteps = numericOrDefault(durationMultiplier, 5);
  const offsetSteps = numericOrDefault(offsetMultiplier, dashPresent ? 1 : 0);
  const offsetMinutes = offsetSteps * STEP_MINUTES;
  const durationMinutes = durationSteps * STEP_MINUTES;
  const currentMinutes = safeDate.getHours() * 60 + safeDate.getMinutes();
  const startMinutes = normalizeMinutes(
    Math.ceil((currentMinutes - offsetMinutes) / STEP_MINUTES) * STEP_MINUTES,
  );
  const endMinutes = normalizeMinutes(startMinutes + durationMinutes);
  const start = formatTime(startMinutes);
  const end = formatTime(endMinutes);
  const metadata = ` ${formatDurationField(durationMinutes)}`;

  return {
    startMinutes,
    endMinutes,
    durationMinutes,
    start,
    end,
    text: formatTimeRange(startMinutes, endMinutes, "compact", metadata),
  };
}

function computeSnippetExpansion(trigger, now = new Date()) {
  if (!trigger) {
    return null;
  }

  if (trigger.kind === "emDash") {
    return { replacement: EM_DASH_REPLACEMENT };
  }

  if (trigger.kind === "task") {
    const createdDate = formatLocalDate(now);
    return {
      replacement: `#task  [created::${createdDate}]`,
      cursorOffset: "#task ".length,
    };
  }

  if (trigger.kind === "ledgerRange") {
    const range = computeRange(
      now,
      trigger.durationMultiplier,
      trigger.offsetMultiplier,
      trigger.dashPresent,
    ).text;
    return {
      replacement: `${range} `,
      range,
    };
  }

  if (trigger.kind === "time") {
    const text = formatOffsetTime(now, trigger.offset);
    return { replacement: text, text };
  }

  if (trigger.kind === "date") {
    const text = formatOffsetDate(now, trigger.offset);
    return { replacement: text, text };
  }

  if (trigger.kind === "datedEntry") {
    const dateText = formatOffsetDate(now, trigger.offset);
    const replacement = `_${dateText}_ — `;
    return {
      replacement,
      cursorOffset: replacement.length,
      text: replacement,
    };
  }

  if (trigger.kind === "datetime") {
    const text = formatOffsetDateTime(now, trigger.offset);
    return { replacement: text, text };
  }

  return null;
}

function expansionCursorCh(expansion) {
  if (!expansion) {
    return null;
  }

  const offset = Number.isInteger(expansion.cursorOffset)
    ? expansion.cursorOffset
    : String(expansion.replacement || "").length;
  return expansion.fromCh + offset;
}

function isWordChar(value) {
  return typeof value === "string" && WORD_CHAR_RE.test(value);
}

function isTriggerBoundaryBlocked(trigger, nextChar) {
  if (trigger.kind === "emDash") {
    return nextChar === "-";
  }

  return isWordChar(nextChar);
}

function findExpansion(line, cursorCh, now = new Date()) {
  if (typeof line !== "string" || !Number.isInteger(cursorCh)) {
    return null;
  }

  if (cursorCh < 0 || cursorCh > line.length) {
    return null;
  }

  const trigger = parseTrigger(line.slice(0, cursorCh));
  if (!trigger || isTriggerBoundaryBlocked(trigger, line[cursorCh])) {
    return null;
  }

  const snippetExpansion = computeSnippetExpansion(trigger, now);
  if (!snippetExpansion) {
    return null;
  }

  let fromCh = trigger.startCh;
  let toCh = cursorCh;
  let replacement = snippetExpansion.replacement;

  if (
    trigger.kind === "ledgerRange" &&
    line[fromCh - 1] === "(" &&
    line[cursorCh] === ")"
  ) {
    fromCh -= 1;
    toCh += 1;
    replacement = snippetExpansion.range;
  }

  const expansion = {
    fromCh,
    toCh,
    replacement,
    trigger: trigger.trigger,
  };

  if (snippetExpansion.range !== undefined) {
    expansion.range = snippetExpansion.range;
  }

  if (snippetExpansion.text !== undefined) {
    expansion.text = snippetExpansion.text;
  }

  if (snippetExpansion.cursorOffset !== undefined) {
    expansion.cursorOffset = snippetExpansion.cursorOffset;
  }

  return expansion;
}

function expandLineAtCursor(line, cursorCh, now = new Date()) {
  const expansion = findExpansion(line, cursorCh, now);

  if (!expansion) {
    return null;
  }

  return {
    line:
      line.slice(0, expansion.fromCh) +
      expansion.replacement +
      line.slice(expansion.toCh),
    cursorCh: expansionCursorCh(expansion),
    expansion,
  };
}

