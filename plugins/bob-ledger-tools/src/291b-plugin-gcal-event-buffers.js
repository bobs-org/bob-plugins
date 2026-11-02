// Hatched lead-in / lead-out wings on Event time pills. Pure helpers plus
// a Live Preview widget; 291 calls these from the existing painter so that
// fragment stays under the 1000-line cap. The occupied span is the meeting
// plus `[buffer::]`; the bold clock stays the meeting span.

function gcalEventsTimeAttributes(row, hue) {
  const attributes = { "data-time": row.time };
  if (row.state) attributes["data-state"] = row.state;
  if (row.state === "running" && hue) attributes["data-theme-hue"] = hue;
  if (row.offClock) attributes["data-off-clock"] = "true";
  if (row.buffer && row.buffer.beforeMin) attributes["data-buffer-before"] = String(row.buffer.beforeMin);
  if (row.buffer && row.buffer.afterMin) attributes["data-buffer-after"] = String(row.buffer.afterMin);
  if (row.bufferPhase) attributes["data-buffer-phase"] = row.bufferPhase;
  const tooltip = row.buffer
    ? eventRunBufferTooltip(
      row.buffer,
      eventRunBufferedSpan(
        row.startMinutes,
        Number.isFinite(row.endMinutes)
          ? (row.endMinutes < row.startMinutes ? row.endMinutes + 1440 : row.endMinutes)
          : row.bufferedEndMinutes,
        row.buffer,
      ),
    )
    : "";
  if (tooltip) attributes.title = tooltip;
  return attributes;
}

function gcalEventsWingModel(row, side, hue) {
  if (!row || !row.buffer) return null;
  const minutes = side === "before" ? row.buffer.beforeMin : row.buffer.afterMin;
  if (!minutes) return null;
  const phase = row.bufferPhase === (side === "before" ? "lead-in" : "lead-out")
    ? row.bufferPhase
    : null;
  return {
    side,
    minutes,
    label: `${minutes}m`,
    hue: hue || null,
    offClock: Boolean(row.offClock),
    phase,
    tooltip: eventRunBufferTooltip(
      row.buffer,
      {
        startMin: row.bufferedStartMinutes,
        endOnTimeline: row.bufferedEndMinutes,
        timeRange: row.bufferedTimeRange,
      },
    ),
  };
}

function buildCalendarEventBufferWing(doc, model) {
  if (!doc || typeof doc.createElement !== "function" || !model) return null;
  const el = doc.createElement("span");
  el.className = "bob-calendar-event-buffer";
  el.textContent = model.label;
  el.setAttribute("data-side", model.side);
  el.setAttribute("data-minutes", String(model.minutes));
  if (model.hue) el.setAttribute("data-theme-hue", model.hue);
  if (model.offClock) el.setAttribute("data-off-clock", "true");
  if (model.phase) el.setAttribute("data-buffer-phase", model.phase);
  if (model.tooltip) el.setAttribute("title", model.tooltip);
  el.setAttribute("aria-hidden", "true");
  return el;
}

let CalendarEventBufferWingWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  CalendarEventBufferWingWidget = class extends WidgetType {
    constructor(model) {
      super();
      this.model = model;
      this.key = [
        model && model.side,
        model && model.minutes,
        model && model.hue,
        model && model.offClock ? "o" : "",
        model && model.phase,
      ].join("|");
    }

    eq(other) {
      return Boolean(other && other instanceof CalendarEventBufferWingWidget && other.key === this.key);
    }

    toDOM() {
      const dom = buildCalendarEventBufferWing(
        typeof document !== "undefined" ? document : null,
        this.model,
      );
      if (dom) return dom;
      try {
        return typeof document !== "undefined" && document
          ? document.createElement("span")
          : null;
      } catch (error) {
        return null;
      }
    }

    ignoreEvent() {
      return true;
    }
  };
}

function gcalEventsBufferDecorations(row, base, hue) {
  const extras = [];
  if (!row || !Decoration) return extras;
  if (row.bufferField && row.bufferField.end > row.bufferField.start) {
    extras.push({
      from: base + row.bufferField.start,
      to: base + row.bufferField.end,
      decoration: Decoration.mark({
        class: "bob-calendar-event-buffer-field",
        attributes: { title: eventRunBufferTooltip(row.buffer, {
          startMin: row.bufferedStartMinutes,
          endOnTimeline: row.bufferedEndMinutes,
          timeRange: row.bufferedTimeRange,
        }) },
      }),
    });
  }
  if (!CalendarEventBufferWingWidget || typeof Decoration.widget !== "function") return extras;
  const before = gcalEventsWingModel(row, "before", hue);
  if (before) {
    extras.push({
      from: base + row.timeStart,
      to: base + row.timeStart,
      decoration: Decoration.widget({
        widget: new CalendarEventBufferWingWidget(before),
        side: -1,
      }),
    });
  }
  const after = gcalEventsWingModel(row, "after", hue);
  if (after) {
    extras.push({
      from: base + row.timeEnd,
      to: base + row.timeEnd,
      decoration: Decoration.widget({
        widget: new CalendarEventBufferWingWidget(after),
        side: 1,
      }),
    });
  }
  return extras;
}

function calendarEventApplyTimeAttributes(timeEl, row, hue) {
  if (!timeEl || typeof timeEl.setAttribute !== "function") return;
  const attributes = gcalEventsTimeAttributes(row, hue);
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null || value === "") timeEl.removeAttribute(name);
    else timeEl.setAttribute(name, value);
  }
  if (!attributes["data-state"] && typeof timeEl.removeAttribute === "function") {
    timeEl.removeAttribute("data-state");
  }
  if (!attributes["data-theme-hue"]) timeEl.removeAttribute("data-theme-hue");
  if (!attributes["data-buffer-phase"]) timeEl.removeAttribute("data-buffer-phase");
}

function calendarEventPaintBufferField(row) {
  try {
    const fields = row.querySelectorAll
      ? row.querySelectorAll(".dataview.inline-field, span.inline-field")
      : [];
    for (const field of fields || []) {
      const key = field.querySelector
        ? field.querySelector(".inline-field-key, .dataview.inline-field-key")
        : null;
      const keyText = String(
        (key && (key.getAttribute("data-dv-key") || key.textContent)) || "",
      ).trim();
      if (eventRunAsciiLower(keyText) !== "buffer") continue;
      if (field.classList) field.classList.add("bob-calendar-event-buffer-field");
      field.setAttribute("data-buffer-field", "true");
    }
  } catch (error) {}
}

function calendarEventPaintBufferWings(row, timeEl, modelRow, hue) {
  try {
    if (!timeEl || !modelRow || !modelRow.buffer) return false;
    const doc = timeEl.ownerDocument;
    if (!doc || typeof doc.createElement !== "function") return false;
    const parent = timeEl.parentNode;
    if (!parent) return false;
    let wrap = timeEl.parentNode;
    if (!wrap.classList || !wrap.classList.contains("bob-calendar-event-time-wrap")) {
      wrap = doc.createElement("span");
      wrap.className = "bob-calendar-event-time-wrap";
      parent.insertBefore(wrap, timeEl);
      wrap.appendChild(timeEl);
    }
    const existing = wrap.querySelectorAll
      ? wrap.querySelectorAll(".bob-calendar-event-buffer")
      : [];
    for (const node of existing || []) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
    const before = gcalEventsWingModel(modelRow, "before", hue);
    if (before) {
      const el = buildCalendarEventBufferWing(doc, before);
      if (el) wrap.insertBefore(el, timeEl);
    }
    const after = gcalEventsWingModel(modelRow, "after", hue);
    if (after) {
      const el = buildCalendarEventBufferWing(doc, after);
      if (el) wrap.appendChild(el);
    }
    calendarEventPaintBufferField(row);
    return true;
  } catch (error) {
    return false;
  }
}

// Off-clock chip for Live Preview: one dashed `timer-off` chip per Event
// Task tag. CodeMirror splits a highest-precedence mark at Obsidian's tag
// spans, so a mark paints two pills; a replace widget paints one. The text
// is the tag's own spelling without the `#`, the same as Reading view.
function buildCalendarEventOffClockChip(doc, text) {
  try {
    if (!doc || typeof doc.createElement !== "function") return null;
    const label = String(text || "");
    if (!label) return null;
    const el = doc.createElement("span");
    el.className = "bob-calendar-event-off-clock";
    el.textContent = label;
    el.setAttribute("data-off-clock", "true");
    el.setAttribute("title", GCAL_EVENTS_OFF_CLOCK_TITLE);
    return el;
  } catch (error) {
    return null;
  }
}

let CalendarEventOffClockChipWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  CalendarEventOffClockChipWidget = class extends WidgetType {
    constructor(text) {
      super();
      this.text = String(text || "");
    }

    eq(other) {
      return Boolean(
        other &&
          other instanceof CalendarEventOffClockChipWidget &&
          other.text === this.text,
      );
    }

    toDOM(view) {
      const doc = typeof document !== "undefined" ? document : null;
      const dom = buildCalendarEventOffClockChip(doc, this.text);
      if (dom) {
        try {
          if (typeof addTaskTagMarkReveal === "function") addTaskTagMarkReveal(dom, view);
        } catch (error) {
          // A listener-free chip still renders.
        }
        return dom;
      }
      try {
        return doc ? doc.createElement("span") : null;
      } catch (error) {
        return null;
      }
    }
  };
}
