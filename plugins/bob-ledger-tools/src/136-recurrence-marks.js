// --- Task recurrence marks: pure mark-core ---------------------------------
// Owned by the `docs/date-marks.md` display contract in bob-cli (the
// "Recurrence (not a date)" section). Pure helpers only: canonical-field
// detection for the Tasks `[repeat:: …]` rule, the spoken-cadence label
// grammar, tooltips, a listener-free DOM builder, and the family
// dispatchers that keep `266-plugin-date-marks.js` small. Every helper
// is synchronous and never throws; bad input yields null. Mirrors the
// date-mark code paths in `136-date-marks.js` and reuses
// `dateMarkFoldLength`, `dateMarkContentStart`,
// `freshnessMarkPosInCode`, `freshnessTaskStatus`,
// `freshnessIsClosedStatus`, `freshnessChecklistForTags`, and
// `checklistKindForText` from the sibling fragments. There is
// deliberately no date logic here: recurrence never parses a date and
// `api.dateMarks` v1 stays dates-only.

const RECURRENCE_MARK_FIELD = "repeat";
const RECURRENCE_MARK_VALUE_RE = /^[a-zA-Z0-9, !]+$/;
const RECURRENCE_MARK_EVERY_RE = /^every\s+\S/i;
const RECURRENCE_MARK_GATE_RE_SOURCE = "(^|[^A-Za-z0-9_-])repeat\\s*::";
const RECURRENCE_MARK_WHEN_DONE_SUFFIX_RE = /\s+when\s+done$/i;

const RECURRENCE_MARK_WEEKDAYS = Object.freeze({
  monday: Object.freeze({ full: "Monday", abbrev: "Mon" }),
  tuesday: Object.freeze({ full: "Tuesday", abbrev: "Tue" }),
  wednesday: Object.freeze({ full: "Wednesday", abbrev: "Wed" }),
  thursday: Object.freeze({ full: "Thursday", abbrev: "Thu" }),
  friday: Object.freeze({ full: "Friday", abbrev: "Fri" }),
  saturday: Object.freeze({ full: "Saturday", abbrev: "Sat" }),
  sunday: Object.freeze({ full: "Sunday", abbrev: "Sun" }),
});

const RECURRENCE_MARK_MONTHS = Object.freeze({
  january: "Jan",
  february: "Feb",
  march: "Mar",
  april: "Apr",
  may: "May",
  june: "Jun",
  july: "Jul",
  august: "Aug",
  september: "Sep",
  october: "Oct",
  november: "Nov",
  december: "Dec",
});

const RECURRENCE_MARK_ORDINAL_RE = /^\d+(?:st|nd|rd|th)$/;

// Collapse whitespace runs to one space and trim. Never throws.
function recurrenceCollapseRule(rule) {
  try {
    return String(rule || "")
      .trim()
      .replace(/\s+/g, " ");
  } catch (error) {
    return "";
  }
}

// Split a collapsed rule into its cadence and its `when done` flag.
// Returns `{ rest, whenDone }` or null for a non-string. Never throws.
function recurrenceSplitWhenDone(collapsed) {
  try {
    const text = String(collapsed || "");
    if (text === "") {
      return null;
    }
    const match = text.match(/^(.*\S)\s+when\s+done$/i);
    if (match) {
      return { rest: match[1], whenDone: true };
    }
    return { rest: text, whenDone: false };
  } catch (error) {
    return null;
  }
}

// The canonical repeat field on `text`, or null. The occurrence gate
// counts `(^|[^A-Za-z0-9_-])repeat\s*::` (case-insensitive) and
// requires exactly one; the canonical form is `[repeat:: …]` or
// `(repeat:: …)` with matching brackets, a lowercase key touching
// `::`, padding spaces only, and a value that matches Tasks' charset
// `^[a-zA-Z0-9, !]+$` and starts with `every` plus a space and more
// text (case-insensitive, after stripping a trailing `when done`).
// Returns a frozen `{ rule, whenDone, fieldStart, fieldEnd }`
// (UTF-16 offsets) where `rule` is the whitespace-collapsed value as
// written (including `when done`). Never throws.
function recurrenceMarkCanonicalField(text) {
  try {
    const input = String(text || "");
    if (input === "") {
      return null;
    }
    let occurrences = 0;
    try {
      const gate = new RegExp(RECURRENCE_MARK_GATE_RE_SOURCE, "gi");
      let gateMatch = gate.exec(input);
      while (gateMatch !== null) {
        occurrences += 1;
        if (occurrences > 1) {
          break;
        }
        gateMatch = gate.exec(input);
      }
    } catch (error) {
      return null;
    }
    if (occurrences !== 1) {
      return null;
    }
    const found = [];
    try {
      const bracketRe = /\[ *repeat:: *([^\]\n]*) *\]/g;
      let match = bracketRe.exec(input);
      while (match !== null) {
        found.push({ match, index: match.index });
        if (found.length > 1) {
          break;
        }
        match = bracketRe.exec(input);
      }
    } catch (error) {
      return null;
    }
    try {
      const parenRe = /\( *repeat:: *([^\)\n]*) *\)/g;
      let match = parenRe.exec(input);
      while (match !== null) {
        found.push({ match, index: match.index });
        if (found.length > 1) {
          break;
        }
        match = parenRe.exec(input);
      }
    } catch (error) {
      return null;
    }
    if (found.length !== 1) {
      return null;
    }
    const entry = found[0];
    const raw = entry.match[1] !== undefined ? entry.match[1] : "";
    const collapsed = recurrenceCollapseRule(raw);
    if (collapsed === "" || !RECURRENCE_MARK_VALUE_RE.test(collapsed)) {
      return null;
    }
    if (!RECURRENCE_MARK_EVERY_RE.test(collapsed)) {
      return null;
    }
    const split = recurrenceSplitWhenDone(collapsed);
    if (!split) {
      return null;
    }
    if (!RECURRENCE_MARK_EVERY_RE.test(split.rest)) {
      return null;
    }
    return Object.freeze({
      rule: collapsed,
      whenDone: split.whenDone,
      fieldStart: entry.index,
      fieldEnd: entry.index + entry.match[0].length,
    });
  } catch (error) {
    return null;
  }
}

// The parsed parts of a recurrence rule, or null when the rule is not
// Tasks-readable. Returns a frozen
// `{ collapsed, whenDone, rest, body }` where `collapsed` is the
// whitespace-collapsed rule as written, `rest` is `collapsed` minus a
// trailing `when done`, and `body` is `rest` minus its leading
// `every ` (both preserving case). Never throws.
function recurrenceRuleParts(rule) {
  try {
    const collapsed = recurrenceCollapseRule(rule);
    if (collapsed === "" || !RECURRENCE_MARK_VALUE_RE.test(collapsed)) {
      return null;
    }
    if (!RECURRENCE_MARK_EVERY_RE.test(collapsed)) {
      return null;
    }
    const split = recurrenceSplitWhenDone(collapsed);
    if (!split) {
      return null;
    }
    if (!RECURRENCE_MARK_EVERY_RE.test(split.rest)) {
      return null;
    }
    const prefix = split.rest.match(/^every\s+/i);
    if (!prefix) {
      return null;
    }
    const body = split.rest.slice(prefix[0].length);
    if (body.trim() === "") {
      return null;
    }
    return Object.freeze({
      collapsed,
      whenDone: split.whenDone,
      rest: split.rest,
      body,
    });
  } catch (error) {
    return null;
  }
}

function recurrenceWeekdayEntry(token) {
  try {
    const key = String(token || "").trim().toLowerCase();
    return RECURRENCE_MARK_WEEKDAYS[key] || null;
  } catch (error) {
    return null;
  }
}

function recurrenceMonthAbbrev(token) {
  try {
    const key = String(token || "").trim().toLowerCase();
    return RECURRENCE_MARK_MONTHS[key] || null;
  } catch (error) {
    return null;
  }
}

// A weekday list after `week on` / `weeks on`: comma and/or separated
// full English names. Returns the lowercased names in order, or null.
// Never throws.
function recurrenceWeekdayList(listText) {
  try {
    const raw = String(listText || "");
    if (raw.trim() === "") {
      return null;
    }
    const normalized = raw.replace(/\s+and\s+/gi, ",");
    const tokens = normalized
      .split(",")
      .map((part) => String(part || "").trim())
      .filter((part) => part !== "");
    if (tokens.length === 0) {
      return null;
    }
    const lowered = [];
    for (const token of tokens) {
      const entry = recurrenceWeekdayEntry(token);
      if (!entry) {
        return null;
      }
      lowered.push(String(token).trim().toLowerCase());
    }
    return Object.freeze(lowered);
  } catch (error) {
    return null;
  }
}

function recurrenceOrdinalDay(ordinal) {
  try {
    const token = String(ordinal || "").trim().toLowerCase();
    const match = token.match(/^(\d+)(?:st|nd|rd|th)$/);
    if (!match) {
      return null;
    }
    const day = Number(match[1]);
    if (!Number.isSafeInteger(day) || day < 1 || day > 31) {
      return null;
    }
    return String(day);
  } catch (error) {
    return null;
  }
}

// The spoken cadence for `rule` ("say it the way a person would").
// Labels are lowercase except weekday and month names, use `·`
// (U+00B7 with spaces) between cadence and detail, and are never
// truncated. Anything unrecognized returns the rule as written
// (collapsed), minus `when done`. Returns null for an unreadable
// rule. Never throws.
function recurrenceMarkLabel(rule) {
  try {
    const parts = recurrenceRuleParts(rule);
    if (!parts) {
      return null;
    }
    const bodyLower = String(parts.body || "").trim().toLowerCase();
    if (bodyLower === "") {
      return null;
    }
    if (bodyLower === "day") {
      return "daily";
    }
    if (bodyLower === "weekday") {
      return "weekdays";
    }
    if (bodyLower === "week") {
      return "weekly";
    }
    if (bodyLower === "month") {
      return "monthly";
    }
    if (bodyLower === "year") {
      return "yearly";
    }
    const single = bodyLower.match(/^1\s+(day|weekday|week|month|year)$/);
    if (single) {
      const unit = single[1];
      if (unit === "day") {
        return "daily";
      }
      if (unit === "weekday") {
        return "weekdays";
      }
      if (unit === "week") {
        return "weekly";
      }
      if (unit === "month") {
        return "monthly";
      }
      return "yearly";
    }
    const plural = bodyLower.match(/^(\d+)\s+(days|weeks|months|years)$/);
    if (plural) {
      const count = Number(plural[1]);
      if (Number.isSafeInteger(count) && count >= 2) {
        return "every " + String(count) + " " + plural[2];
      }
      return parts.rest;
    }
    const weekdayOnly = recurrenceWeekdayEntry(bodyLower);
    if (weekdayOnly) {
      return weekdayOnly.full + "s";
    }
    let match = bodyLower.match(/^week\s+on\s+(.+)$/);
    if (match) {
      const list = recurrenceWeekdayList(match[1]);
      if (list && list.length === 1) {
        const entry = recurrenceWeekdayEntry(list[0]);
        if (entry) {
          return entry.full + "s";
        }
      }
      if (list && list.length >= 2) {
        const abbrevs = list.map((name) => recurrenceWeekdayEntry(name).abbrev);
        return "weekly \u00b7 " + abbrevs.join(", ");
      }
      return parts.rest;
    }
    match = bodyLower.match(/^(\d+)\s+weeks?\s+on\s+(.+)$/);
    if (match) {
      const count = Number(match[1]);
      const list = recurrenceWeekdayList(match[2]);
      if (
        Number.isSafeInteger(count) &&
        count >= 2 &&
        list &&
        list.length >= 1
      ) {
        const abbrevs = list.map((name) => recurrenceWeekdayEntry(name).abbrev);
        return "every " + String(count) + " weeks \u00b7 " + abbrevs.join(", ");
      }
      if (Number.isSafeInteger(count) && count === 1 && list) {
        if (list.length === 1) {
          const entry = recurrenceWeekdayEntry(list[0]);
          if (entry) {
            return entry.full + "s";
          }
        }
        if (list.length >= 2) {
          const abbrevs = list.map((name) => recurrenceWeekdayEntry(name).abbrev);
          return "weekly \u00b7 " + abbrevs.join(", ");
        }
      }
      return parts.rest;
    }
    match = bodyLower.match(/^month\s+on\s+the\s+(.+)$/);
    if (match) {
      const suffix = String(match[1] || "").trim();
      if (suffix === "last") {
        return "monthly \u00b7 last";
      }
      const lastDay = suffix.match(/^last\s+(\w+)$/);
      if (lastDay) {
        const entry = recurrenceWeekdayEntry(lastDay[1]);
        if (entry) {
          return "monthly \u00b7 last " + entry.abbrev;
        }
        return parts.rest;
      }
      if (RECURRENCE_MARK_ORDINAL_RE.test(suffix)) {
        return "monthly \u00b7 " + suffix;
      }
      const ordinalDay = suffix.match(/^(\d+(?:st|nd|rd|th))\s+(\w+)$/);
      if (ordinalDay) {
        if (!RECURRENCE_MARK_ORDINAL_RE.test(ordinalDay[1])) {
          return parts.rest;
        }
        const entry = recurrenceWeekdayEntry(ordinalDay[2]);
        if (entry) {
          return "monthly \u00b7 " + ordinalDay[1] + " " + entry.abbrev;
        }
        return parts.rest;
      }
      return parts.rest;
    }
    match = bodyLower.match(/^(\d+)\s+months\s+on\s+the\s+(.+)$/);
    if (match) {
      const count = Number(match[1]);
      const suffix = String(match[2] || "").trim();
      const renderMonthly = (text) => {
        if (!Number.isSafeInteger(count)) {
          return parts.rest;
        }
        if (count === 1) {
          return text;
        }
        if (count >= 2) {
          return text.replace(/^monthly/, "every " + String(count) + " months");
        }
        return parts.rest;
      };
      if (suffix === "last") {
        return renderMonthly("monthly \u00b7 last");
      }
      const lastDay = suffix.match(/^last\s+(\w+)$/);
      if (lastDay) {
        const entry = recurrenceWeekdayEntry(lastDay[1]);
        if (entry) {
          return renderMonthly("monthly \u00b7 last " + entry.abbrev);
        }
        return parts.rest;
      }
      if (RECURRENCE_MARK_ORDINAL_RE.test(suffix)) {
        return renderMonthly("monthly \u00b7 " + suffix);
      }
      const ordinalDay = suffix.match(/^(\d+(?:st|nd|rd|th))\s+(\w+)$/);
      if (ordinalDay) {
        if (!RECURRENCE_MARK_ORDINAL_RE.test(ordinalDay[1])) {
          return parts.rest;
        }
        const entry = recurrenceWeekdayEntry(ordinalDay[2]);
        if (entry) {
          return renderMonthly(
            "monthly \u00b7 " + ordinalDay[1] + " " + entry.abbrev,
          );
        }
        return parts.rest;
      }
      return parts.rest;
    }
    match = bodyLower.match(/^([a-z]+)\s+on\s+the\s+(\d+(?:st|nd|rd|th))$/);
    if (match) {
      const abbrev = recurrenceMonthAbbrev(match[1]);
      const day = recurrenceOrdinalDay(match[2]);
      if (abbrev && day) {
        return "yearly \u00b7 " + abbrev + " " + day;
      }
      return parts.rest;
    }
    return parts.rest;
  } catch (error) {
    return null;
  }
}

// The render model for one recurrence rule: a frozen
// `{ field, rule, whenDone, label, tooltip, key }`, or null for an
// unreadable rule. `rule` is the whitespace-collapsed rule as written
// (including `when done`). The tooltip is two lines and never
// contains `::`: `Repeats <rule>` plus the `when done` cadence line.
// Never throws.
function recurrenceMarkModel(rule) {
  try {
    const parts = recurrenceRuleParts(rule);
    if (!parts) {
      return null;
    }
    const label = recurrenceMarkLabel(rule);
    if (typeof label !== "string" || label === "") {
      return null;
    }
    const tooltip =
      "Repeats " +
      parts.collapsed +
      "\n" +
      (parts.whenDone
        ? "Next date counts from completion"
        : "Next date follows the schedule");
    if (tooltip.indexOf("::") !== -1 || label.indexOf("::") !== -1) {
      return null;
    }
    let key = "";
    try {
      key = JSON.stringify(["repeat", parts.collapsed, label, tooltip]);
    } catch (error) {
      key = "repeat|" + parts.collapsed + "|" + label;
    }
    return Object.freeze({
      field: RECURRENCE_MARK_FIELD,
      rule: parts.collapsed,
      whenDone: parts.whenDone,
      label,
      tooltip,
      key,
    });
  } catch (error) {
    return null;
  }
}

// True when a Live Preview line must keep its native repeat pill: the
// line is a checklist member, the task is open, and the rule lacks
// `when done`. Mirrors the `checklist_repeat_not_when_done` lint scope
// (open members), so the display never hides what the lint flags.
// Never throws.
function recurrenceMarkGuarded(lineText) {
  try {
    if (typeof lineText !== "string" || lineText === "") {
      return false;
    }
    const canonical = recurrenceMarkCanonicalField(lineText);
    if (!canonical || canonical.whenDone) {
      return false;
    }
    let kind = null;
    try {
      kind =
        typeof checklistKindForText === "function"
          ? checklistKindForText(lineText)
          : null;
    } catch (error) {
      kind = null;
    }
    if (kind === null || kind === undefined) {
      return false;
    }
    let status = null;
    try {
      status =
        typeof freshnessTaskStatus === "function"
          ? freshnessTaskStatus(lineText)
          : null;
    } catch (error) {
      status = null;
    }
    if (status === null || status === undefined) {
      return false;
    }
    try {
      if (typeof freshnessIsClosedStatus === "function") {
        if (freshnessIsClosedStatus(status)) {
          return false;
        }
      } else if (status === "x" || status === "X" || status === "-") {
        return false;
      }
    } catch (error) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function recurrenceRenderedTaskItem(node) {
  try {
    let current =
      node && node.parentNode ? node.parentNode : node || null;
    let guard = 0;
    while (current && guard < 100) {
      guard += 1;
      try {
        const tag = String(
          current.tagName || current.nodeName || "",
        ).toUpperCase();
        if (tag === "LI") {
          let hasClass = false;
          try {
            hasClass = Boolean(
              current.classList &&
                typeof current.classList.contains === "function" &&
                current.classList.contains("task-list-item"),
            );
          } catch (error) {
            hasClass = false;
          }
          if (!hasClass) {
            hasClass =
              String(current.className || "")
                .split(/\s+/)
                .indexOf("task-list-item") !== -1;
          }
          return hasClass ? current : null;
        }
      } catch (error) {
        // Keep walking on per-ancestor failure.
      }
      current = current.parentNode || null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function recurrenceRenderedOwnTags(li) {
  try {
    if (!li) {
      return Object.freeze([]);
    }
    const tags = [];
    const stack = [];
    try {
      for (const child of li.childNodes || []) {
        stack.push(child);
      }
    } catch (error) {
      return Object.freeze([]);
    }
    let guard = 0;
    while (stack.length > 0 && guard < 10000) {
      guard += 1;
      const node = stack.pop();
      if (!node || typeof node !== "object") {
        continue;
      }
      if (node.nodeType === 1) {
        const tagName = String(
          node.tagName || node.nodeName || "",
        ).toUpperCase();
        if (
          tagName === "UL" ||
          tagName === "OL" ||
          tagName === "CODE" ||
          tagName === "PRE"
        ) {
          continue;
        }
        let isTag = false;
        try {
          isTag = Boolean(
            node.classList &&
              typeof node.classList.contains === "function" &&
              node.classList.contains("tag"),
          );
        } catch (error) {
          isTag = false;
        }
        if (!isTag) {
          isTag =
            String(node.className || "").split(/\s+/).indexOf("tag") !== -1;
        }
        if (tagName === "A" && isTag) {
          try {
            tags.push(String(node.textContent || ""));
          } catch (error) {
            // Skip one unreadable anchor.
          }
          continue;
        }
      }
      try {
        for (const child of node.childNodes || []) {
          stack.push(child);
        }
      } catch (error) {
        continue;
      }
    }
    return Object.freeze(tags);
  } catch (error) {
    return Object.freeze([]);
  }
}

// True when a rendered-view text node must keep its native repeat
// pill, using the same open-member-without-`when done` rule as Live
// Preview. Membership comes from the nearest `li.task-list-item`
// ancestor's own `a.tag` pills (skipping nested lists and code) and
// openness comes from its `data-task`. Never throws.
function recurrenceMarkRenderedGuard(textNode, root) {
  try {
    if (!textNode || typeof textNode !== "object") {
      return false;
    }
    let value = "";
    try {
      value =
        typeof textNode.nodeValue === "string"
          ? textNode.nodeValue
          : typeof textNode.textContent === "string"
            ? textNode.textContent
            : "";
    } catch (error) {
      return false;
    }
    if (!value || value.indexOf("repeat") === -1) {
      return false;
    }
    const canonical = recurrenceMarkCanonicalField(value);
    if (!canonical || canonical.whenDone) {
      return false;
    }
    const li = recurrenceRenderedTaskItem(textNode);
    if (!li) {
      return false;
    }
    if (root && li === root) {
      return false;
    }
    let status = null;
    try {
      status =
        li && typeof li.getAttribute === "function"
          ? li.getAttribute("data-task")
          : null;
    } catch (error) {
      status = null;
    }
    if (typeof status !== "string") {
      return false;
    }
    try {
      if (typeof freshnessIsClosedStatus === "function") {
        if (freshnessIsClosedStatus(status)) {
          return false;
        }
      } else if (status === "x" || status === "X" || status === "-") {
        return false;
      }
    } catch (error) {
      return false;
    }
    let kind = null;
    try {
      const tags = recurrenceRenderedOwnTags(li);
      kind =
        typeof freshnessChecklistForTags === "function"
          ? freshnessChecklistForTags(tags)
          : null;
    } catch (error) {
      kind = null;
    }
    return kind !== null && kind !== undefined;
  } catch (error) {
    return false;
  }
}

// Listener-free recurrence element, mirroring `buildDateMarkElement`.
// Produces `span.bob-date-mark[data-field="repeat"]` with `data-rule`
// (the collapsed rule as written), `data-when-done`, `data-fold-space`
// (`data-rendered="true"` on rendered views), the glyph plus label
// children, `role="img"`, `aria-label`, and
// `data-tooltip-position="top"`. It has no `data-date` and no
// `data-when`. `decorative` renders `aria-hidden` with no label;
// `inheritColor` makes the ink `currentColor`. Never throws: bad
// input yields null.
function buildRecurrenceMarkElement(doc, model, options) {
  try {
    if (!doc || !model || typeof model !== "object") {
      return null;
    }
    if (model.field !== RECURRENCE_MARK_FIELD) {
      return null;
    }
    if (typeof model.rule !== "string" || model.rule === "") {
      return null;
    }
    if (typeof model.label !== "string" || model.label === "") {
      return null;
    }
    if (typeof model.tooltip !== "string" || model.tooltip === "") {
      return null;
    }
    if (typeof doc.createElement !== "function") {
      return null;
    }
    if (typeof doc.createTextNode !== "function") {
      return null;
    }
    const settings =
      options && typeof options === "object" ? options : {};
    const foldSpace = Boolean(settings.foldSpace);
    const decorative = Boolean(settings.decorative);
    const inheritColor = Boolean(settings.inheritColor);
    const rendered = Boolean(settings.rendered);
    const span = doc.createElement("span");
    span.setAttribute("class", "bob-date-mark");
    span.setAttribute("data-field", RECURRENCE_MARK_FIELD);
    span.setAttribute("data-rule", String(model.rule));
    span.setAttribute(
      "data-when-done",
      model.whenDone ? "true" : "false",
    );
    span.setAttribute("data-fold-space", foldSpace ? "true" : "false");
    if (rendered) {
      span.setAttribute("data-rendered", "true");
    }
    if (inheritColor) {
      span.setAttribute("data-inherit-color", "true");
    }
    if (decorative) {
      span.setAttribute("aria-hidden", "true");
    } else {
      span.setAttribute("role", "img");
      span.setAttribute("aria-label", String(model.tooltip || ""));
      span.setAttribute("data-tooltip-position", "top");
    }
    const glyph = doc.createElement("span");
    glyph.setAttribute("class", "bob-date-mark-glyph");
    glyph.setAttribute("aria-hidden", "true");
    span.appendChild(glyph);
    const label = doc.createElement("span");
    label.setAttribute("class", "bob-date-mark-label");
    label.setAttribute("aria-hidden", "true");
    label.appendChild(doc.createTextNode(String(model.label)));
    span.appendChild(label);
    return span;
  } catch (error) {
    return null;
  }
}

// A Live Preview line's date-family sources, in line order: canonical
// date fields plus at most one repeat source with the guard applied,
// sorted by `fieldStart` with the same fold rule (`RangeSetBuilder`
// needs sorted adds). Returns a frozen array of frozen sources;
// repeat sources carry `{ field: "repeat", rule, whenDone, ... }`
// while date sources keep `{ field, date, ... }`. Never throws.
function dateFamilyMarkSources(lineText) {
  try {
    if (typeof lineText !== "string" || lineText === "") {
      return Object.freeze([]);
    }
    let dates = [];
    try {
      dates =
        typeof dateMarkSources === "function"
          ? dateMarkSources(lineText) || []
          : [];
    } catch (error) {
      dates = [];
    }
    const out = [];
    for (const entry of dates) {
      out.push(entry);
    }
    try {
      const canonical = recurrenceMarkCanonicalField(lineText);
      if (canonical && !recurrenceMarkGuarded(lineText)) {
        let start = 0;
        try {
          start =
            typeof dateMarkContentStart === "function"
              ? dateMarkContentStart(lineText)
              : 0;
        } catch (error) {
          start = 0;
        }
        let fold = 0;
        try {
          fold =
            typeof dateMarkFoldLength === "function"
              ? dateMarkFoldLength(lineText, canonical.fieldStart, start)
              : 0;
        } catch (error) {
          fold = 0;
        }
        out.push(
          Object.freeze({
            field: RECURRENCE_MARK_FIELD,
            rule: canonical.rule,
            whenDone: canonical.whenDone,
            fieldStart: canonical.fieldStart,
            fieldEnd: canonical.fieldEnd,
            foldLength: fold,
          }),
        );
      }
    } catch (error) {
      // One bad repeat field never breaks the date marks.
    }
    out.sort((a, b) => a.fieldStart - b.fieldStart);
    return Object.freeze(out);
  } catch (error) {
    return Object.freeze([]);
  }
}

// A rendered-view text node's date-family sources, in node order.
// `guardResolver` is called lazily, only when the text holds a repeat
// source, and a truthy result drops the repeat source. Repeat sources
// never fold. Never throws.
function dateFamilyMarkSourcesInText(text, guardResolver) {
  try {
    if (typeof text !== "string" || text === "") {
      return Object.freeze([]);
    }
    let dates = [];
    try {
      dates =
        typeof dateMarkSourcesInText === "function"
          ? dateMarkSourcesInText(text) || []
          : [];
    } catch (error) {
      dates = [];
    }
    const out = [];
    for (const entry of dates) {
      out.push(entry);
    }
    try {
      const canonical = recurrenceMarkCanonicalField(text);
      if (canonical) {
        let guarded = false;
        if (typeof guardResolver === "function") {
          try {
            guarded = Boolean(guardResolver());
          } catch (error) {
            guarded = false;
          }
        }
        if (!guarded) {
          out.push(
            Object.freeze({
              field: RECURRENCE_MARK_FIELD,
              rule: canonical.rule,
              whenDone: canonical.whenDone,
              fieldStart: canonical.fieldStart,
              fieldEnd: canonical.fieldEnd,
              foldLength: 0,
            }),
          );
        }
      }
    } catch (error) {
      // One bad repeat field never breaks the date marks.
    }
    out.sort((a, b) => a.fieldStart - b.fieldStart);
    return Object.freeze(out);
  } catch (error) {
    return Object.freeze([]);
  }
}

// The render model for one date-family source: repeat sources use
// `recurrenceMarkModel`, everything else uses `dateMarkModel`.
// Never throws.
function dateFamilyMarkModel(source, todayText) {
  try {
    if (!source || typeof source !== "object") {
      return null;
    }
    if (source.field === RECURRENCE_MARK_FIELD) {
      try {
        if (typeof recurrenceMarkModel === "function") {
          return recurrenceMarkModel(source.rule);
        }
      } catch (error) {
        return null;
      }
      return null;
    }
    try {
      if (typeof dateMarkModel === "function") {
        return dateMarkModel(source.field, source.date, todayText);
      }
    } catch (error) {
      return null;
    }
    return null;
  } catch (error) {
    return null;
  }
}
