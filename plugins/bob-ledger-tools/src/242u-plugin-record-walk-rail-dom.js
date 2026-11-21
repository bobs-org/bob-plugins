// Read-only rail: links always follow the written line, counts only a checked ring.
// Grouped walks add the kit group row (242va) in place of the thumb track.
const RECORD_WALK_RAIL_CLASS = "bob-record-walk-rail";
const RECORD_WALK_SOURCE_CLASS = "bob-record-walk-source";

function recordWalkHasRail(walk) {
  return Boolean(walk && Number.isInteger(walk.lineIndex)
    && ["current", "stale"].includes(walk.lineState));
}

function recordWalkSelectionTouches(state, line) {
  return (state?.selection?.ranges || []).some((range) =>
    Math.min(range.from ?? range.anchor, range.to ?? range.head) <= line.to
    && Math.max(range.from ?? range.anchor, range.to ?? range.head) >= line.from);
}

function recordWalkDisplayLabel(value) {
  return String(value || "").replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1");
}

function recordWalkArm(walk, direction) {
  const previous = direction === "prev";
  const written = previous ? walk.writtenPrev : walk.writtenNext;
  if (!written) return null;
  const title = recordWalkDisplayLabel(written.label).replace(/^[‹<]\s*|\s*[›>]$/g, "").trim()
    || recordWalkHumanizeStem(written.stem) || written.stem;
  const healthy = walk.state === "ok";
  const position = previous
    ? (walk.position === 1 ? walk.total : walk.position - 1)
    : (walk.position === walk.total ? 1 : walk.position + 1);
  const wraps = healthy && (previous ? walk.wrapsPrev : walk.wrapsNext);
  const destination = healthy ? `${title}, ${position} of ${walk.total} in ${walk.album.title}`
    : `${title} — Record walk is syncing`;
  return {
    target: written.target, title, wraps,
    ariaLabel: `${previous ? "Previous" : "Next"} record: ${destination}`,
    tooltip: wraps ? `Wraps around to ${title} (${position} of ${walk.total})`
      : `${previous ? "Previous" : "Next"} record: ${destination}`,
  };
}

function recordWalkRailLink(doc, target, className, options, direction) {
  const link = recordSheetEl(doc, "a", `internal-link ${className}`);
  link.setAttribute("href", target);
  link.setAttribute("data-href", target);
  const open = (event) => {
    if (event.type === "auxclick" && event.button !== 1) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    options?.handlers?.walkOpen?.(target, direction, event);
  };
  link.addEventListener?.("click", open);
  link.addEventListener?.("auxclick", open);
  recordSheetBindHover(link, options, target);
  return link;
}

function recordWalkRailBuildEl(walk, options = {}, doc) {
  if (!recordWalkHasRail(walk) || !doc) return null;
  const rail = recordSheetEl(doc, "nav", RECORD_WALK_RAIL_CLASS);
  rail.setAttribute("aria-label", `Record walk in ${walk.album.title}`);
  rail.setAttribute("data-record-source", walk.path);
  rail.setAttribute("data-walk-state", walk.state);
  rail.setAttribute("data-root-hue", options.hue || walk.album.hue || "");
  const grid = recordSheetEl(doc, "div", "bob-record-walk-grid");
  rail.appendChild(grid);
  const armEl = (direction) => {
    const arm = recordWalkArm(walk, direction);
    if (!arm) return;
    const previous = direction === "prev";
    const link = recordWalkRailLink(doc, arm.target, `bob-record-walk-arm is-${direction}`, options, direction);
    link.setAttribute("aria-label", arm.ariaLabel);
    link.setAttribute("title", arm.tooltip);
    link.setAttribute("data-record-sheet-focus", `walk-${direction}`);
    const glyph = recordSheetEl(doc, "span", "bob-record-walk-glyph");
    glyph.setAttribute("aria-hidden", "true");
    recordSheetText(glyph, previous ? "‹" : "›");
    const title = recordSheetEl(doc, "span", "bob-record-walk-arm-title");
    recordSheetText(title, arm.title);
    const wrap = recordSheetEl(doc, "span", "bob-record-walk-wrap");
    wrap.setAttribute("aria-hidden", "true");
    recordSheetText(wrap, arm.wraps ? "↺" : "");
    for (const child of previous ? [glyph, wrap, title] : [title, wrap, glyph]) link.appendChild(child);
    grid.appendChild(link);
  };
  armEl("prev");
  const centre = recordSheetEl(doc, "div", "bob-record-walk-centre");
  const album = recordWalkRailLink(doc, walk.album.stem, "bob-record-walk-album", options, null);
  album.setAttribute("aria-label", `Album: ${walk.album.title}`);
  album.setAttribute("title", walk.album.title);
  album.setAttribute("data-record-sheet-focus", "walk-album");
  recordSheetText(album, `${walk.album.emoji ? walk.album.emoji + " " : ""}${walk.album.title}`);
  centre.appendChild(album);
  const separator = recordSheetEl(doc, "span", "bob-record-walk-separator");
  separator.setAttribute("aria-hidden", "true");
  recordSheetText(separator, "·");
  centre.appendChild(separator);
  const count = recordSheetEl(doc, "span", "bob-record-walk-count");
  const healthy = walk.state === "ok";
  const groupRow = healthy && typeof recordWalkGroupRowEl === "function" ? recordWalkGroupRowEl(walk, options, doc) : null;
  const order = groupRow ? `By ${walk.groupRail.fieldLabel}, then title · wraps around` : "Alphabetical, wraps around";
  count.setAttribute("aria-label", healthy ? `${walk.position} of ${walk.total}` : "Record walk is syncing");
  count.setAttribute("title", healthy ? order : "Record walk is syncing");
  for (const [kind, text] of [
    ["wide", healthy ? `${walk.position} of ${walk.total}` : "⟳"],
    ["narrow", healthy ? `${walk.position}/${walk.total}` : "⟳"],
  ]) {
    const span = recordSheetEl(doc, "span", `bob-record-walk-count-${kind}`);
    span.setAttribute("aria-hidden", "true");
    recordSheetText(span, text);
    count.appendChild(span);
  }
  centre.appendChild(count);
  grid.appendChild(centre);
  armEl("next");
  // A grouped walk's group row replaces the whole-walk thumb track.
  if (groupRow) {
    rail.setAttribute("data-walk-grouped", "true");
    rail.appendChild(groupRow);
  } else if (healthy && walk.total > 1) {
    const track = recordSheetEl(doc, "div", "bob-record-walk-track");
    track.setAttribute("aria-hidden", "true");
    const thumb = recordSheetEl(doc, "span", "bob-record-walk-thumb");
    thumb.setAttribute("style", `left: ${100 * (walk.position - 0.5) / walk.total}%`);
    track.appendChild(thumb);
    rail.appendChild(track);
  }
  return rail;
}

// Only replace an entire rendered walk paragraph. A moved line stays recognizable;
// paragraphs containing authored prose, code, or another note's embed stay untouched.
function recordWalkReadingParagraphMatches(paragraph, walk) {
  const links = Array.from(paragraph?.querySelectorAll?.("a.internal-link") || []);
  const written = walk?.writtenLinks || [];
  if (!written.length || links.length !== written.length) return false;
  const normalize = (value) => String(value || "").replace(/\.md$/i, "");
  if (!links.every((link, index) => normalize(link.getAttribute("data-href") || link.getAttribute("href"))
    === normalize(written[index].target))) return false;
  const text = (value) => String(value || "").replace(/\s+/g, "").trim();
  return text(paragraph.textContent) === text(written.map((link) => recordWalkDisplayLabel(link.label)).join("·"));
}
