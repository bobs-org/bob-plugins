// Cabinet absorption recognizer (bob-cli-qq absorption): a pure,
// region.rs-mirroring scan of note source for bob-owned catalog callouts.
//
// For each known catalog kind it returns the owned region (the `> [!{callout}]`
// head line plus contiguous `>` lines), the hideable H2 heading when the
// section holds nothing else, a fingerprint of the owned bytes, and damage
// when the region is malformed, duplicated, or ambiguous. Anything damaged
// is never hidden: cabinets fail open to the stored section. Never throws.
const PROPERTY_CARD_CABINET_REGION_SPECS = Object.freeze([
  { kind: "areas", callout: "areas", heading: "Areas", strictBare: true, legacy: null },
  { kind: "projects", callout: "projects", heading: "Projects", strictBare: true, legacy: null },
  { kind: "notebooks", callout: "notebooks", heading: "Notebooks", strictBare: false, legacy: { begin: "<!-- bob:notebooks:begin v1 -->", end: "<!-- bob:notebooks:end -->", opener: "<!-- bob:notebooks:", noun: "notebook catalog" } },
  { kind: "albums", callout: "albums", heading: "Albums", strictBare: true, legacy: null },
  // Records heads carry a tally title (`> [!records] 24 restaurants ...`),
  // so recognition accepts any title after the callout name.
  { kind: "records", callout: "records", heading: "Records", strictBare: false, legacy: null },
]);

function propertyCardCabinetRegionSpec(kind) {
  return PROPERTY_CARD_CABINET_REGION_SPECS.find((spec) => spec.kind === kind) || null;
}

function propertyCardCabinetSplitLines(text) {
  const source = String(text == null ? "" : text);
  if (source === "") return { lines: [], eol: "\n" };
  const eol = /\r\n/.test(source) ? "\r\n" : "\n";
  return { lines: source.split(/\r\n|\r|\n/), eol };
}

// First body line index after a leading `---` frontmatter block, or 0 when
// the note has none (a lone opening fence is not frontmatter). A UTF-8 BOM
// before the opening fence is allowed, mirroring region.rs.
function propertyCardCabinetFrontmatterEnd(lines) {
  if (lines.length === 0) return 0;
  const first = String(lines[0]).replace(/^\uFEFF/, "");
  if (first !== "---") return 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---") return index + 1;
  }
  return 0;
}

function propertyCardCabinetFenceMarker(line) {
  const content = String(line);
  let indent = 0;
  while (indent < content.length && content[indent] === " ") indent += 1;
  if (indent > 3) return null;
  const rest = content.slice(indent);
  const character = rest[0];
  if (character !== "`" && character !== "~") return null;
  let length = 0;
  while (rest[length] === character) length += 1;
  if (length < 3) return null;
  return { character, length };
}

function propertyCardCabinetClosesFence(line, open) {
  if (!open) return false;
  const marker = propertyCardCabinetFenceMarker(line);
  if (!marker) return false;
  if (marker.character !== open.character || marker.length < open.length) return false;
  return String(line).trimStart().slice(marker.length).trim() === "";
}

// ATX heading level and trimmed title (closing hashes removed), or null.
// Mirrors region.rs: at most 3 leading spaces, `#` run, then space/EOL.
function propertyCardCabinetAtxHeading(content) {
  const line = String(content);
  let indent = 0;
  while (indent < line.length && line[indent] === " ") indent += 1;
  if (indent > 3) return null;
  let level = 0;
  while (line[indent + level] === "#") level += 1;
  if (level < 1 || level > 6) return null;
  const rest = line.slice(indent + level);
  if (rest !== "" && rest[0] !== " " && rest[0] !== "\t") return null;
  let title = rest.trim();
  title = title.replace(/ +#+$/, "").replace(/#+$/, "").trim();
  return { level, title };
}

// True when `content` is a `> [!{callout}]` head: at most 3 spaces of
// indentation, then `>`, then `[!{callout}]` case-insensitively, with an
// optional `-`/`+` fold sign and title. A `|alias` form is not a head.
function propertyCardCabinetIsCalloutHead(content, callout) {
  const line = String(content);
  let indent = 0;
  while (indent < line.length && line[indent] === " ") indent += 1;
  if (indent > 3) return false;
  const rest = line.slice(indent);
  if (!rest.startsWith(">")) return false;
  const afterGt = rest.slice(1).replace(/^[ \t]+/, "");
  if (!afterGt.startsWith("[")) return false;
  const close = afterGt.indexOf("]");
  if (close < 0) return false;
  const inner = afterGt.slice(1, close).trim();
  if (!inner.startsWith("!")) return false;
  if (inner.slice(1).toLowerCase() !== String(callout).toLowerCase()) return false;
  let tail = afterGt.slice(close + 1).replace(/^[ \t]+/, "");
  if (tail.startsWith("-") || tail.startsWith("+")) tail = tail.slice(1);
  return !tail.replace(/^[ \t]+/, "").startsWith("|");
}

// True when `content` is a blockquote line: at most 3 spaces, then `>`.
function propertyCardCabinetIsQuoteLine(content) {
  const line = String(content);
  let indent = 0;
  while (indent < line.length && line[indent] === " ") indent += 1;
  if (indent > 3) return false;
  return line.slice(indent).startsWith(">");
}

function propertyCardCabinetNameChars(value) {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

// A real, malformed opener for a strict callout: `[!{callout}...` that is
// not a valid head. Limited to the exact callout name, so `[!albums-card]`
// stays authored content. Mirrors region.rs.
function propertyCardCabinetMalformedHead(lines, real, callout, at) {
  if (!real(at)) return -1;
  if (propertyCardCabinetIsCalloutHead(lines[at], callout)) return -1;
  const line = String(lines[at]);
  let indent = 0;
  while (indent < line.length && line[indent] === " ") indent += 1;
  if (indent > 3) return -1;
  const rest = line.slice(indent);
  if (!rest.startsWith(">")) return -1;
  const afterGt = rest.slice(1).replace(/^[ \t]+/, "");
  if (!afterGt.startsWith("[!")) return -1;
  const name = afterGt.slice(2).split(/[^A-Za-z0-9_-]/)[0] || "";
  if (!propertyCardCabinetNameChars(name)) return -1;
  return name.toLowerCase() === String(callout).toLowerCase() ? at : -1;
}

// FNV-1a over the owned bytes: cheap, stable, and enough to notice a vault
// change between claim and paint.
function propertyCardCabinetFingerprint(bytes) {
  let hash = 0x811c9dc5;
  const source = String(bytes);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a:${hash.toString(16).padStart(8, "0")}`;
}

function propertyCardCabinetDamage(line, message) {
  return { line, message: String(message) };
}

// Scan one note for one spec. Returns { kind, regions, damage }: regions are
// 1-based { startLine, endLine, lines, legacy } in document order, and at most
// one region may hide. Duplicates are damage, never a guess.
function propertyCardCatalogScanSpec(text, spec) {
  const kind = spec.kind;
  const split = propertyCardCabinetSplitLines(text);
  const lines = split.lines;
  const bodyFirst = propertyCardCabinetFrontmatterEnd(lines);
  const fenced = new Array(lines.length).fill(false);
  let open = null;
  for (let index = bodyFirst; index < lines.length; index += 1) {
    if (open) {
      fenced[index] = true;
      if (propertyCardCabinetClosesFence(lines[index], open)) open = null;
    } else {
      const marker = propertyCardCabinetFenceMarker(lines[index]);
      if (marker) {
        fenced[index] = true;
        open = marker;
      }
    }
  }
  const real = (index) => index >= bodyFirst && index < lines.length && !fenced[index];

  if (spec.strictBare) {
    for (let index = bodyFirst; index < lines.length; index += 1) {
      const at = propertyCardCabinetMalformedHead(lines, real, spec.callout, index);
      if (at >= 0) {
        return { kind, regions: [], damage: propertyCardCabinetDamage(at + 1, `malformed [!${spec.callout}] callout head; repair the catalog by hand`) };
      }
    }
  }

  let legacy = null;
  if (spec.legacy) {
    const begins = [];
    const ends = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (!real(index)) continue;
      const trimmed = String(lines[index]).trim();
      if (trimmed === spec.legacy.begin) begins.push(index);
      else if (trimmed === spec.legacy.end) ends.push(index);
      else if (String(lines[index]).includes(spec.legacy.opener)) {
        return { kind, regions: [], damage: propertyCardCabinetDamage(index + 1, `unsupported or malformed ${spec.legacy.noun} marker; repair the old markers by hand`) };
      }
    }
    if (begins.length === 0 && ends.length === 0) legacy = null;
    else if (begins.length === 1 && ends.length === 1 && begins[0] < ends[0]) legacy = { begin: begins[0], end: ends[0] };
    else {
      const first = Math.min(...begins, ...ends);
      const message = begins.length === 0
        ? `${spec.legacy.noun} end marker has no begin marker; repair the old markers by hand`
        : ends.length === 0
          ? `${spec.legacy.noun} begin marker has no end marker; repair the old markers by hand`
          : begins[0] > ends[0]
            ? `${spec.legacy.noun} markers are reversed; repair the old markers by hand`
            : `${spec.legacy.noun} markers are duplicated; repair the old markers by hand`;
      return { kind, regions: [], damage: propertyCardCabinetDamage(first + 1, message) };
    }
  }

  const bare = [];
  let index = bodyFirst;
  while (index < lines.length) {
    if (!real(index) || !propertyCardCabinetIsCalloutHead(lines[index], spec.callout)) {
      index += 1;
      continue;
    }
    let end = index;
    let next = index + 1;
    while (next < lines.length && real(next) && propertyCardCabinetIsQuoteLine(lines[next])) {
      end = next;
      next += 1;
    }
    bare.push([index, end]);
    index = end + 1;
  }

  const regions = [];
  if (legacy) regions.push({ start: legacy.begin, end: legacy.end, legacy: true });
  for (const [start, end] of bare) {
    if (legacy && start >= legacy.begin && end <= legacy.end) continue;
    regions.push({ start, end, legacy: false });
  }
  regions.sort((a, b) => a.start - b.start);

  if (regions.length > 1) {
    return { kind, regions: [], damage: propertyCardCabinetDamage(regions[0].start + 1, `duplicate [!${spec.callout}] catalog; repair the catalog by hand`) };
  }
  return {
    kind,
    regions: regions.map((region) => ({
      startLine: region.start + 1,
      endLine: region.end + 1,
      lines: lines.slice(region.start, region.end + 1),
      legacy: region.legacy,
    })),
    damage: null,
  };
}

// Recognize every catalog kind in `text`. Mirrors region.rs and
// records_spec: case-insensitive heads, optional fold signs, frontmatter and
// fences ignored, and the records head title. Never throws.
function propertyCardCatalogRegions(text) {
  try {
    const out = {};
    for (const spec of PROPERTY_CARD_CABINET_REGION_SPECS) {
      out[spec.kind] = propertyCardCatalogScanSpec(text, spec);
    }
    return out;
  } catch (_) {
    return {};
  }
}

// The hideable plan for one kind: the callout span plus the H2 heading line
// when the section (up to the next heading of level 2 or less, or EOF)
// holds nothing but the callout and whitespace. A heading whose text differs
// is never adopted. Returns { kind, startLine, endLine, headingLine|null,
// fingerprint, damage|null } with 1-based lines, or null when absent.
function propertyCardCatalogRegionForHide(text, kind) {
  try {
    const spec = propertyCardCabinetRegionSpec(kind);
    if (!spec) return null;
    const split = propertyCardCabinetSplitLines(text);
    const lines = split.lines;
    const scan = propertyCardCatalogScanSpec(text, spec);
    if (scan.damage) return { kind, startLine: null, endLine: null, headingLine: null, fingerprint: null, damage: scan.damage };
    if (scan.regions.length === 0) return null;
    const region = scan.regions[0];
    const bodyFirst = propertyCardCabinetFrontmatterEnd(lines);

    let headingLine = null;
    for (let at = 0; at < lines.length; at += 1) {
      if (at < bodyFirst) continue;
      const heading = propertyCardCabinetAtxHeading(lines[at]);
      if (!heading || heading.level !== 2 || heading.title !== spec.heading) continue;
      const sectionEnd = (() => {
        for (let next = at + 1; next < lines.length; next += 1) {
          if (next < bodyFirst) continue;
          const following = propertyCardCabinetAtxHeading(lines[next]);
          if (following && following.level <= 2) return next;
        }
        return lines.length;
      })();
      if (region.startLine - 1 < at + 1 || region.startLine - 1 >= sectionEnd) continue;
      let authored = false;
      for (let row = at + 1; row < sectionEnd; row += 1) {
        if (row >= region.startLine - 1 && row <= region.endLine - 1) continue;
        if (String(lines[row]).trim() !== "") {
          authored = true;
          break;
        }
      }
      if (!authored) headingLine = at + 1;
      break;
    }

    const fingerprint = propertyCardCabinetFingerprint(`${spec.callout}\n${region.lines.join("\n")}`);
    return { kind, startLine: region.startLine, endLine: region.endLine, headingLine, fingerprint, damage: null };
  } catch (_) {
    return null;
  }
}
