// Property-card group row (bob-cli-oj group-rail): the quieter second rail
// row that jumps between groups (`⏮ Q2   ▮▮■▮▮▮▮   Q4 ⏭`), plus the
// missing-target states every rail surface shares. Arms show a skip mark and
// the group name only; the landing note lives in the tooltip and accessible
// name, and the centre is just the member track (hidden for a one-member
// group). One visual rule: a dashed underline with a `+` means "not created
// yet" (creatable); dotted, faint, and `· not in vault` means "won't be
// created from here" (ghost). Rail items and chips draw the same states as
// boxes. Never error red, never Obsidian's unresolved-link look.
//
// The kit never decides activation. Step items and chips reach the rail's
// onNavigate, and group arms reach the row's onActivate, with the item and
// its resolved state; adopters run their own commands. Builders take an
// ownerDocument and a spec, return null instead of throwing, and write text
// only through text nodes.

const PROPERTY_CARD_TARGET_STATES = Object.freeze(["exists", "creatable", "ghost"]);
const PROPERTY_CARD_GROUP_DIRECTIONS = Object.freeze(["prev", "next"]);
const PROPERTY_CARD_GROUP_TICK_STATES = Object.freeze(["current", "exists", "missing"]);
// Larger groups show a continuous bar with a thumb instead of one tick each.
const PROPERTY_CARD_GROUP_TICK_LIMIT = 21;
const PROPERTY_CARD_GHOST_NOTE = "· not in vault";
// Lucide skip-back / skip-forward, drawn inline so Obsidian, the links
// footer, and the preview matrix paint the same mark without setIcon.
const PROPERTY_CARD_SVG_NS = "http://www.w3.org/2000/svg";
const PROPERTY_CARD_GROUP_MARKS = Object.freeze({
  prev: Object.freeze({ icon: "skip-back", shapes: Object.freeze([
    ["polygon", { points: "19 20 9 12 19 4 19 20" }],
    ["line", { x1: "5", x2: "5", y1: "19", y2: "5" }],
  ]) }),
  next: Object.freeze({ icon: "skip-forward", shapes: Object.freeze([
    ["polygon", { points: "5 4 15 12 5 20 5 4" }],
    ["line", { x1: "19", x2: "19", y1: "5", y2: "19" }],
  ]) }),
});

// An explicit known state wins; the legacy `unresolved: true` means
// creatable; neither means exists.
function propertyCardTargetState(item) {
  const state = propertyCardKitText(item?.state).trim();
  if (PROPERTY_CARD_TARGET_STATES.includes(state)) return state;
  return item?.unresolved === true ? "creatable" : "exists";
}

// The item handed to onNavigate / onActivate always carries its state.
function propertyCardKitStatedItem(item, state) {
  return item?.state === state ? item : { ...item, state };
}

function propertyCardKitHidden(node) {
  node.setAttribute("aria-hidden", "true");
  return node;
}

// Enter and Space for controls without an href (ghosts), which browsers do
// not activate natively.
function propertyCardKitBindKeys(node, handler) {
  try {
    node.addEventListener?.("keydown", (event) => {
      const key = event?.key;
      if (key !== "Enter" && key !== " " && key !== "Spacebar") return;
      try { event?.preventDefault?.(); } catch (_) {}
      if (typeof handler === "function") {
        try { handler(event); } catch (_) {}
      }
    });
  } catch (_) {}
}

// Click and middle-click for every target; ghosts also take Enter and Space.
function propertyCardKitBindTarget(node, state, handler) {
  propertyCardKitBindLink(node, handler);
  if (state === "ghost") propertyCardKitBindKeys(node, handler);
}

// A ghost is never a link into the vault: no href, still focusable for its
// tooltip, announced as disabled.
function propertyCardKitGhostControl(node, role) {
  try {
    node.removeAttribute?.("href");
    node.removeAttribute?.("data-href");
  } catch (_) {}
  if (role) node.setAttribute("role", role);
  node.setAttribute("tabindex", "0");
  node.setAttribute("aria-disabled", "true");
}

// Mark a step-row item or chip with its state and return the trailing spans
// (`+` for creatable; `· not in vault` for ghost items, never chips). exists
// changes nothing, so legacy specs keep their DOM. is-unresolved stays on as
// a compatibility marker; the group-row CSS block drops its underline. An
// optional item.tooltip becomes the title; a ghost falls back to its reason.
function propertyCardKitStateMarks(doc, node, item, state, chip) {
  const tooltip = propertyCardKitText(item?.tooltip).trim();
  if (tooltip) node.setAttribute("title", tooltip);
  if (state === "exists") return [];
  node.setAttribute("data-state", state);
  propertyCardKitAddClass(node, `is-${state}`);
  propertyCardKitAddClass(node, "is-unresolved");
  if (state === "creatable") return [propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-rail-plus", "+"))];
  propertyCardKitGhostControl(node, chip ? "" : "link");
  const reason = propertyCardKitText(item?.ghostReason).trim();
  if (!tooltip && reason) node.setAttribute("title", reason);
  return chip ? [] : [propertyCardKitSpan(doc, "bob-property-card-rail-note", PROPERTY_CARD_GHOST_NOTE)];
}

// span.bob-property-card-group-glyph[aria-hidden][data-icon]: the group
// jump mark. Documents without createElementNS (fake test DOMs) get the
// empty span, so tests read data-icon. Never throws.
function propertyCardGroupMark(doc, direction) {
  const mark = PROPERTY_CARD_GROUP_MARKS[direction === "prev" ? "prev" : "next"];
  const span = propertyCardKitHidden(propertyCardKitEl(doc, "span", "bob-property-card-group-glyph"));
  span.setAttribute("data-icon", mark.icon);
  if (typeof doc?.createElementNS !== "function") return span;
  try {
    const svg = doc.createElementNS(PROPERTY_CARD_SVG_NS, "svg");
    for (const [name, value] of [
      ["class", "bob-property-card-group-mark"], ["viewBox", "0 0 24 24"], ["width", "1em"], ["height", "1em"],
      ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"], ["stroke-linecap", "round"],
      ["stroke-linejoin", "round"], ["focusable", "false"], ["aria-hidden", "true"],
    ]) svg.setAttribute(name, value);
    for (const [tag, attrs] of mark.shapes) {
      const shape = doc.createElementNS(PROPERTY_CARD_SVG_NS, tag);
      for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, value);
      svg.appendChild(shape);
    }
    span.appendChild(svg);
  } catch (_) {}
  return span;
}

function propertyCardGroupArmOk(arm) {
  if (!arm || typeof arm !== "object") return false;
  if (!propertyCardKitText(arm.groupLabel).trim()) return false;
  return propertyCardTargetState(arm) === "ghost" || Boolean(propertyCardKitText(arm.target).trim());
}

// a.bob-property-card-group-arm[data-group][data-state]. The prev arm reads
// `⏮ Q2`, the next arm `Q4 + ⏭`: the mark (aria-hidden), the group label
// (wide and narrow), `+` on creatable arms, `· not in vault` on ghosts, and
// `↺` when the jump wraps. The landing (spec.landingLabel) is accepted but
// never painted; the tooltip and accessible name carry it.
function propertyCardGroupArm(doc, direction, arm, onActivate) {
  const state = propertyCardTargetState(arm);
  const stated = propertyCardKitStatedItem(arm, state);
  const link = propertyCardKitEl(doc, "a", "bob-property-card-group-arm");
  link.setAttribute("data-group", direction);
  link.setAttribute("data-state", state);
  if (state === "ghost") propertyCardKitGhostControl(link, "link");
  else {
    const target = propertyCardKitText(arm.target).trim();
    link.setAttribute("data-href", target);
    link.setAttribute("href", target);
  }
  const tooltip = propertyCardKitText(arm.tooltip).trim()
    || (state === "ghost" ? propertyCardKitText(arm.ghostReason).trim() : "");
  if (tooltip) link.setAttribute("title", tooltip);
  const ariaLabel = propertyCardKitText(arm.ariaLabel).trim();
  if (ariaLabel) link.setAttribute("aria-label", ariaLabel);

  const groupLabel = propertyCardKitText(arm.groupLabel).trim();
  const parts = [
    propertyCardKitSpan(doc, "bob-property-card-group-label", groupLabel),
    propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-group-label-narrow",
      propertyCardKitText(arm.shortLabel).trim() || groupLabel)),
  ];
  if (state === "creatable") parts.push(propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-group-plus", "+")));
  if (state === "ghost") parts.push(propertyCardKitSpan(doc, "bob-property-card-group-note", PROPERTY_CARD_GHOST_NOTE));
  const glyph = propertyCardGroupMark(doc, direction);
  const ordered = direction === "prev" ? [glyph, ...parts] : [...parts, glyph];
  if (arm.wraps === true) ordered.push(propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-group-wrap", "↺")));
  for (const node of ordered) link.appendChild(node);
  propertyCardKitBindTarget(link, state, (event) => {
    if (typeof onActivate === "function") onActivate(direction, stated, event);
  });
  return link;
}

function propertyCardGroupTickState(member) {
  const state = propertyCardKitText(member?.state).trim();
  return PROPERTY_CARD_GROUP_TICK_STATES.includes(state) ? state : "exists";
}

// span.bob-property-card-group-track[aria-hidden]: one tick per member, or a
// continuous bar with a thumb when the group is larger than 21 or members
// are absent. Null when neither form has the numbers it needs.
function propertyCardGroupTrack(doc, center) {
  const size = Number(center.size);
  const position = Number(center.position);
  const members = Array.isArray(center.members)
    ? center.members.filter((member) => member && typeof member === "object")
    : [];
  const tooLarge = Number.isFinite(size) && size > PROPERTY_CARD_GROUP_TICK_LIMIT;
  const track = propertyCardKitHidden(propertyCardKitEl(doc, "span", "bob-property-card-group-track"));
  if (members.length && members.length <= PROPERTY_CARD_GROUP_TICK_LIMIT && !tooLarge) {
    track.setAttribute("data-track", "ticks");
    for (const member of members) {
      const tick = propertyCardKitEl(doc, "span", "bob-property-card-group-tick");
      tick.setAttribute("data-state", propertyCardGroupTickState(member));
      const label = propertyCardKitText(member.label).trim();
      if (label) tick.setAttribute("title", label);
      track.appendChild(tick);
    }
    return track;
  }
  if (!Number.isInteger(size) || !Number.isInteger(position) || size < 1 || position < 1 || position > size) return null;
  track.setAttribute("data-track", "bar");
  const thumb = propertyCardKitEl(doc, "span", "bob-property-card-group-thumb");
  const left = Math.round((10000 * (position - 0.5)) / size) / 100;
  thumb.setAttribute("style", `left: ${left}%`);
  track.appendChild(thumb);
  return track;
}

// div.bob-property-card-group-center[title]: the member track and a visually
// hidden position label that carries the meaning; no visible text (the card
// already names the group). The title spells the full position (tooltip,
// else the label, else the text). Null without position text.
function propertyCardGroupCenter(doc, center) {
  const text = propertyCardKitText(center?.text).trim();
  if (!text) return null;
  const element = propertyCardKitEl(doc, "div", "bob-property-card-group-center");
  const label = propertyCardKitText(center.ariaLabel).trim() || text;
  element.setAttribute("title", propertyCardKitText(center.tooltip).trim() || label);
  element.appendChild(propertyCardKitSpan(doc, "bob-property-card-group-position-label", label));
  const track = propertyCardGroupTrack(doc, center);
  if (track) element.appendChild(track);
  return { element, track };
}

// { element, arms: { prev, next }, center, track } or null when there is no
// arm and no center. spec: { label?, prev?, next?, center?, onActivate? }
// where an arm is { groupLabel, landingLabel?, shortLabel?, target, state,
// ghostReason?, wraps?, tooltip?, ariaLabel? } and center is { name?, text,
// shortText?, ariaLabel?, tooltip?, position, size, members? } (name,
// shortText, and landingLabel are accepted and not painted). A centre for a
// one-member group (size <= 1) is absent. Missing cells keep their grid
// column with an empty gap span.
function propertyCardBuildGroupRow(doc, spec = {}) {
  try {
    if (!propertyCardKitDocOk(doc)) return null;
    const options = spec && typeof spec === "object" ? spec : {};
    const present = PROPERTY_CARD_GROUP_DIRECTIONS.filter((direction) => propertyCardGroupArmOk(options[direction]));
    const center = options.center && typeof options.center === "object" && !(Number(options.center.size) <= 1)
      ? propertyCardGroupCenter(doc, options.center)
      : null;
    if (!present.length && !center) return null;
    const element = propertyCardKitEl(doc, "div", "bob-property-card-group-row");
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", propertyCardKitText(options.label).trim() || "Group navigation");
    const gap = (cell) => {
      const node = propertyCardKitEl(doc, "span", "bob-property-card-group-gap");
      node.setAttribute("data-group", cell);
      return node;
    };
    const arms = { prev: null, next: null };
    for (const cell of ["prev", "center", "next"]) {
      if (cell === "center") {
        element.appendChild(center ? center.element : gap(cell));
      } else if (present.includes(cell)) {
        arms[cell] = propertyCardGroupArm(doc, cell, options[cell], options.onActivate);
        element.appendChild(arms[cell]);
      } else {
        element.appendChild(gap(cell));
      }
    }
    return { element, arms, center: center?.element || null, track: center?.track || null };
  } catch (_) {
    return null;
  }
}
