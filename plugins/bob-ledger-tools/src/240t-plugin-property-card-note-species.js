// Property-card kit (bob-cli-qm kit): notebook and prose species predicates,
// the precedence function, and the preview gate. Pure: no DOM, no spawns,
// never throws. Later fragments reuse the normalizer instead of retyping
// wikilink forms, and the two species phases reuse the precedence function
// and the gate for their hosts.

// Type-name normalization. Mirrors albumTypeNames (241l): a scalar, list,
// quoted scalar, [[wikilink]] (alias and anchor stripped), comma flow list,
// or "- " item all reduce to lowercase bare names.
function noteCardTypeNames(value) {
  try {
    if (Array.isArray(value)) return value.flatMap((part) => noteCardTypeNames(part));
    if (typeof value !== "string") return [];
    let text = value.trim();
    if (!text) return [];
    if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
      text = text.slice(1, -1).trim();
    }
    if (text.startsWith("[[") && text.endsWith("]]") && /^\[\[[^\[\]]+\]\]$/.test(text)) {
      text = text.slice(2, -2).split("|")[0].split("#")[0].trim();
    } else if (text.startsWith("[") && text.endsWith("]")) {
      return text.slice(1, -1).split(",").flatMap((part) => noteCardTypeNames(part));
    }
    if (text.startsWith("- ")) return noteCardTypeNames(text.slice(2));
    if (text.startsWith("[[") && text.endsWith("]]")) {
      text = text.slice(2, -2).split("|")[0].split("#")[0].trim();
    }
    text = text.replace(/\.md$/i, "").trim().toLowerCase();
    return text ? [text] : [];
  } catch (_) {
    return [];
  }
}

function noteCardFrontmatterType(frontmatter) {
  try {
    if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) return undefined;
    return frontmatter.type;
  } catch (_) {
    return undefined;
  }
}

// The new notebook species claims a note only when its type is exactly
// [[notebook]]. Any mixed type mounts neither new card.
function noteCardIsNotebookKind(frontmatter) {
  try {
    const names = noteCardTypeNames(noteCardFrontmatterType(frontmatter));
    return names.length === 1 && names[0] === "notebook";
  } catch (_) {
    return false;
  }
}

// One shared dual-spelling prose predicate (mirrors qj's rule): scalar or
// list holding only [[prose]] / [[article]]. Writers never retype a note,
// and the kicker word is always PROSE, including the legacy spelling.
function noteCardIsProseKind(frontmatter) {
  try {
    const names = noteCardTypeNames(noteCardFrontmatterType(frontmatter));
    if (!names.length) return false;
    return names.every((name) => name === "prose" || name === "article");
  } catch (_) {
    return false;
  }
}

function noteCardPathText(path) {
  try {
    if (path && typeof path === "object" && typeof path.path === "string") return path.path;
    return typeof path === "string" ? path : "";
  } catch (_) {
    return "";
  }
}

// Exclusions match the home card (_templates/, done/, _conflicts/, the
// untyped type notes). Embeds are a mount-context concern the hosts keep,
// not a frontmatter one this pure function can see.
function noteCardPathExcluded(path) {
  try {
    if (typeof homeCardPathExcluded === "function") return homeCardPathExcluded(noteCardPathText(path));
  } catch (_) {}
  try {
    const text = String(noteCardPathText(path) || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (!text || text === "area.md" || text === "project.md" || text === "bank.md") return true;
    const segments = text.split("/");
    if (segments[0] === "done") return true;
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index] === "_templates" || segments[index] === "_conflicts") return true;
    }
  } catch (_) {
    return true;
  }
  return false;
}

function noteCardBankKind(path) {
  try {
    if (typeof bankSetupIsHubPath === "function") return bankSetupIsHubPath(path) === true;
  } catch (_) {}
  return false;
}

function noteCardAlbumKind(frontmatter) {
  try {
    if (typeof albumSchemaEntryKindOf === "function") return albumSchemaEntryKindOf(frontmatter) === "album";
  } catch (_) {}
  return false;
}

function noteCardRecordKind(frontmatter) {
  try {
    // Canonical records only, like the == registry: the loose album helper
    // classifies other single types as "record", which must not claim here.
    if (typeof recordSheetIsCanonicalRecordType === "function") {
      return recordSheetIsCanonicalRecordType(frontmatter) === true;
    }
  } catch (_) {}
  return false;
}

function noteCardHomeKind(path, frontmatter) {
  try {
    if (typeof homeCardEligible === "function") {
      const eligible = homeCardEligible(path, frontmatter);
      if (eligible && (eligible.kind === "area" || eligible.kind === "project")) return eligible.kind;
    }
  } catch (_) {}
  return null;
}

function noteCardTemporalKind(path, today) {
  try {
    if (typeof intentionCardSubjectForPath === "function") {
      const subject = intentionCardSubjectForPath(path, today);
      if (subject && ["day", "week", "quarter", "year"].includes(subject.kind)) return subject.kind;
    }
  } catch (_) {}
  return null;
}

// One kit function resolves a note's top species in bob's props order:
// bank path; album; record; area/project; temporal; notebook; prose; none.
// The bank hub path wins before exclusions (it is itself a type note); every
// other claim needs a non-excluded path. Existing species keep their own
// predicates — this function only composes them, and never throws.
function propertyCardNoteSpecies(input = {}) {
  try {
    const path = noteCardPathText(input && input.path);
    const frontmatter = input && typeof input.frontmatter === "object" && input.frontmatter !== null
      ? input.frontmatter
      : {};
    const today = input && input.today !== undefined ? input.today : undefined;
    if (!path) return null;
    if (noteCardBankKind(path)) return "bank";
    if (noteCardPathExcluded(path)) return null;
    if (noteCardAlbumKind(frontmatter)) return "album";
    if (noteCardRecordKind(frontmatter)) return "record";
    const home = noteCardHomeKind(path, frontmatter);
    if (home) return home;
    const temporal = noteCardTemporalKind(path, today);
    if (temporal) return temporal;
    if (noteCardIsNotebookKind(frontmatter)) return "notebook";
    if (noteCardIsProseKind(frontmatter)) return "prose";
    return null;
  } catch (_) {
    return null;
  }
}

// Preview gate (bob-cli-qm). Both new species stay off in the live vault
// until ledger-tools plugin data lists them in `cardPreviewKinds`:
// ["notebook", "prose"]. Existing species are always live; unknown kinds
// never are. The acceptance harness writes the key into its disposable
// vault; go-live deletes the gate, the key, and their tests.
const PROPERTY_CARD_PREVIEW_KINDS = Object.freeze(["notebook", "prose"]);

function propertyCardPreviewKindsFromData(data) {
  try {
    const raw = data && typeof data === "object" && !Array.isArray(data) ? data.cardPreviewKinds : null;
    if (!Array.isArray(raw)) return [];
    return raw.filter((kind) => kind === "notebook" || kind === "prose");
  } catch (_) {
    return [];
  }
}

function propertyCardPreviewRemember(plugin, data) {
  const kinds = propertyCardPreviewKindsFromData(data);
  try {
    if (plugin && typeof plugin === "object") plugin.propertyCardPreviewKinds = kinds;
  } catch (_) {}
  return kinds;
}

async function propertyCardPreviewLoad(plugin) {
  if (!plugin || typeof plugin !== "object") return [];
  if (plugin.propertyCardPreviewLoaded === true) {
    return Array.isArray(plugin.propertyCardPreviewKinds) ? plugin.propertyCardPreviewKinds : [];
  }
  if (plugin.propertyCardPreviewLoadPromise) return plugin.propertyCardPreviewLoadPromise;
  const load = (async () => {
    let stored = null;
    try {
      if (plugin.ledgerToolsPluginDataLoaded === true
        && plugin.ledgerToolsPluginData && typeof plugin.ledgerToolsPluginData === "object") {
        stored = plugin.ledgerToolsPluginData;
      } else if (typeof plugin.loadLedgerToolsPluginData === "function") {
        stored = await plugin.loadLedgerToolsPluginData();
      } else if (typeof plugin.loadData === "function") {
        stored = await plugin.loadData();
      }
    } catch (_) {
      stored = null;
    }
    const kinds = propertyCardPreviewRemember(plugin, stored);
    plugin.propertyCardPreviewLoaded = true;
    return kinds;
  })();
  plugin.propertyCardPreviewLoadPromise = load;
  try {
    return await load;
  } finally {
    if (plugin.propertyCardPreviewLoadPromise === load) plugin.propertyCardPreviewLoadPromise = null;
  }
}

function propertyCardKindLive(plugin, kind) {
  try {
    if (kind !== "notebook" && kind !== "prose") {
      return typeof kind === "string" && PROPERTY_CARD_KINDS.includes(kind);
    }
    const kinds = plugin && Array.isArray(plugin.propertyCardPreviewKinds)
      ? plugin.propertyCardPreviewKinds
      : null;
    if (!kinds) return false;
    return kinds.includes(kind);
  } catch (_) {
    return false;
  }
}
