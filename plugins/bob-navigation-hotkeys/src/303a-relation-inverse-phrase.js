// Display-only inverse phrases for relation labels
// (`docs/task-relations.md` §10). Named pairs cover labels the
// participle rule cannot produce; every other two-word `‹participle› by`
// label derives a lowercase inverse. Never stored. Never throws.
const RELATION_INVERSE_NAMED_PAIRS = Object.freeze({
  "duplicate of": "duplicated by",
  "follow-up of": "followed up by",
  "merged into": "merged from",
  "split from": "split into",
});
const RELATION_INVERSE_PARTICIPLE_BASES = Object.freeze({
  added: "add",
  adhered: "adhere",
  adored: "adore",
  agreed: "agree",
  annulled: "annul",
  atoned: "atone",
  augured: "augur",
  awed: "awe",
  banged: "bang",
  basted: "baste",
  bathed: "bathe",
  beaten: "beat",
  begun: "begin",
  billeted: "billet",
  binged: "binge",
  bitten: "bite",
  bled: "bleed",
  boomeranged: "boomerang",
  borne: "bear",
  bought: "buy",
  bound: "bind",
  breathed: "breathe",
  bred: "breed",
  broadcast: "broadcast",
  broken: "break",
  brought: "bring",
  built: "build",
  bulleted: "bullet",
  calendared: "calendar",
  caroled: "carol",
  cast: "cast",
  caught: "catch",
  caviled: "cavil",
  chosen: "choose",
  clanged: "clang",
  clothed: "clothe",
  cohered: "cohere",
  collared: "collar",
  combated: "combat",
  competed: "compete",
  concreted: "concrete",
  condoned: "condone",
  contravened: "contravene",
  controlled: "control",
  convened: "convene",
  corralled: "corral",
  cringed: "cringe",
  cut: "cut",
  dealt: "deal",
  debuted: "debut",
  decreed: "decree",
  delineated: "delineate",
  deplored: "deplore",
  dethroned: "dethrone",
  deviled: "devil",
  devoted: "devote",
  dialled: "dial",
  disagreed: "disagree",
  done: "do",
  downscaled: "downscale",
  drawn: "draw",
  driven: "drive",
  duelled: "duel",
  dug: "dig",
  dyed: "dye",
  eaten: "eat",
  egged: "egg",
  eloped: "elope",
  emceed: "emcee",
  enthroned: "enthrone",
  equalled: "equal",
  erred: "err",
  excited: "excite",
  excreted: "excrete",
  exhaled: "exhale",
  expedited: "expedite",
  explored: "explore",
  extolled: "extol",
  extradited: "extradite",
  eyed: "eye",
  fed: "feed",
  felt: "feel",
  filleted: "fillet",
  fled: "flee",
  forecast: "forecast",
  foreseen: "foresee",
  forgotten: "forget",
  fought: "fight",
  found: "find",
  freed: "free",
  fringed: "fringe",
  frolicked: "frolic",
  frozen: "freeze",
  fuelled: "fuel",
  ganged: "gang",
  given: "give",
  gotten: "get",
  grown: "grow",
  guaranteed: "guarantee",
  hanged: "hang",
  hasted: "haste",
  heard: "hear",
  held: "hold",
  hidden: "hide",
  hinged: "hinge",
  hit: "hit",
  hung: "hang",
  hurt: "hurt",
  ideated: "ideate",
  ignited: "ignite",
  ignored: "ignore",
  impaled: "impale",
  imperiled: "imperil",
  imperilled: "imperil",
  impinged: "impinge",
  implored: "implore",
  incited: "incite",
  infringed: "infringe",
  inhaled: "inhale",
  initialled: "initial",
  interfered: "interfere",
  interloped: "interlope",
  intervened: "intervene",
  intoned: "intone",
  invited: "invite",
  kept: "keep",
  known: "know",
  laid: "lay",
  lambasted: "lambaste",
  led: "lead",
  left: "leave",
  lent: "lend",
  let: "let",
  loathed: "loathe",
  lost: "lose",
  made: "make",
  marshalled: "marshal",
  meant: "mean",
  medalled: "medal",
  met: "meet",
  mimicked: "mimic",
  misled: "mislead",
  murmured: "murmur",
  outscored: "outscore",
  overcome: "overcome",
  overfed: "overfeed",
  overridden: "override",
  overrun: "overrun",
  overseen: "oversee",
  overtaken: "overtake",
  overwritten: "overwrite",
  paid: "pay",
  panicked: "panic",
  pasted: "paste",
  patrolled: "patrol",
  pedalled: "pedal",
  penciled: "pencil",
  pencilled: "pencil",
  periled: "peril",
  permeated: "permeate",
  persevered: "persevere",
  pled: "plead",
  postponed: "postpone",
  proven: "prove",
  put: "put",
  quit: "quit",
  read: "read",
  readded: "readd",
  rebuilt: "rebuild",
  recited: "recite",
  redone: "redo",
  refereed: "referee",
  refuelled: "refuel",
  rehomed: "rehome",
  reignited: "reignite",
  reinvited: "reinvite",
  remade: "remake",
  rerouted: "reroute",
  rerun: "rerun",
  rescaled: "rescale",
  reset: "reset",
  restored: "restore",
  resynced: "resync",
  reunited: "reunite",
  revered: "revere",
  rewritten: "rewrite",
  ridden: "ride",
  rivalled: "rival",
  routed: "route",
  run: "run",
  rung: "ring",
  said: "say",
  scythed: "scythe",
  secreted: "secrete",
  seen: "see",
  seethed: "seethe",
  sent: "send",
  set: "set",
  shaken: "shake",
  sheathed: "sheathe",
  shed: "shed",
  shown: "show",
  shut: "shut",
  signalled: "signal",
  singed: "singe",
  sold: "sell",
  soothed: "soothe",
  sought: "seek",
  sped: "speed",
  spent: "spend",
  split: "split",
  spoken: "speak",
  sponged: "sponge",
  spread: "spread",
  spun: "spin",
  stenciled: "stencil",
  stencilled: "stencil",
  stolen: "steal",
  stood: "stand",
  struck: "strike",
  strung: "string",
  stuck: "stick",
  sung: "sing",
  swept: "sweep",
  synced: "sync",
  syringed: "syringe",
  taken: "take",
  tasted: "taste",
  taught: "teach",
  teed: "tee",
  teethed: "teethe",
  telephoned: "telephone",
  thought: "think",
  thrown: "throw",
  tinged: "tinge",
  tithed: "tithe",
  told: "tell",
  torn: "tear",
  totalled: "total",
  trafficked: "traffic",
  trialled: "trial",
  twanged: "twang",
  twinged: "twinge",
  underscored: "underscore",
  understood: "understand",
  undertaken: "undertake",
  undone: "undo",
  united: "unite",
  upheld: "uphold",
  upscaled: "upscale",
  upset: "upset",
  wasted: "waste",
  wed: "wed",
  welcomed: "welcome",
  whinged: "whinge",
  withheld: "withhold",
  won: "win",
  worn: "wear",
  wreathed: "wreathe",
  writhed: "writhe",
  written: "write"
});
const RELATION_INVERSE_ELL_KEEP = new Set([
  "dwell",
  "fell",
  "foretell",
  "knell",
  "misspell",
  "outsell",
  "oversell",
  "quell",
  "resell",
  "respell",
  "retell",
  "sell",
  "shell",
  "smell",
  "spell",
  "swell",
  "tell",
  "undersell",
  "upsell",
  "well",
  "yell"
]);
const RELATION_INVERSE_DOUBLED = "bdgkmnprtv";
const RELATION_INVERSE_TOKEN = /^[a-z]+(-[a-z]+)*$/;

function relationInverseCollapseKey(label) {
  const collapsed = String(label || "").trim().split(/\s+/u).filter(Boolean).join(" ");
  const stripped = collapsed.endsWith(":") ? collapsed.slice(0, -1) : collapsed;
  return stripped.trim().toLowerCase();
}

function relationInverseIsVowelAt(stem, index) {
  const c = stem.charAt(index);
  if (c === "a" || c === "e" || c === "i" || c === "o") return true;
  if (c === "u") {
    const prev = index > 0 ? stem.charAt(index - 1) : "";
    if (prev === "q") return false;
    if (prev === "g" && index + 1 < stem.length) {
      const next = stem.charAt(index + 1);
      if ("aeiouy".indexOf(next) >= 0) return false;
    }
    return true;
  }
  if (c === "y") return index > 0 && !relationInverseIsVowelAt(stem, index - 1);
  return false;
}

function relationInverseVowelGroupCount(stem) {
  let count = 0;
  let inVowel = false;
  for (let index = 0; index < stem.length; index += 1) {
    const vowel = relationInverseIsVowelAt(stem, index);
    if (vowel && !inVowel) count += 1;
    inVowel = vowel;
  }
  return count;
}

function relationInverseNeedsE(stem) {
  const len = stem.length;
  const last = stem.charAt(len - 1);
  const prev = stem.charAt(len - 2);
  if (last === "u") return true;
  if ("aeioy".indexOf(last) >= 0) return false;
  if ("vczs".indexOf(last) >= 0) return true;
  if ("wxh".indexOf(last) >= 0) return false;
  if (last === "l" && !relationInverseIsVowelAt(stem, len - 2)) {
    return prev !== "r" && prev !== "l" && prev !== "w";
  }
  if (last === "r" && !relationInverseIsVowelAt(stem, len - 2)) {
    return prev !== "r";
  }
  if (last === "g") {
    if (prev === "d" || prev === "r" || prev === "l") return true;
    if (prev === "n") {
      const before = len >= 3 ? stem.charAt(len - 3) : "";
      return before === "a" || before === "e" || before === "u";
    }
    return relationInverseIsVowelAt(stem, len - 2);
  }
  if (!relationInverseIsVowelAt(stem, len - 2)) return false;
  if (len >= 3 && relationInverseIsVowelAt(stem, len - 3)) {
    return stem.endsWith("iat") || stem.endsWith("uat") || stem.endsWith("uad") || stem.endsWith("creat");
  }
  if (relationInverseVowelGroupCount(stem) === 1) return true;
  const pair = stem.slice(len - 2);
  if (pair === "at") return true;
  if (pair === "et") return stem.endsWith("let");
  if (pair === "ot") return stem.endsWith("mot") || stem.endsWith("not") || stem.endsWith("quot");
  if (pair === "op") return stem.endsWith("scop");
  return (
    pair === "ab" || pair === "eb" || pair === "ib" || pair === "ob" || pair === "ub"
    || pair === "ad" || pair === "ed" || pair === "id" || pair === "od" || pair === "ud"
    || pair === "ak" || pair === "ek" || pair === "ik" || pair === "ok" || pair === "uk"
    || pair === "am" || pair === "em" || pair === "im" || pair === "um" || pair === "ap"
    || pair === "yp" || pair === "ar" || pair === "ir" || pair === "ur" || pair === "il"
    || pair === "ol" || pair === "ul" || pair === "in" || pair === "un" || pair === "ut"
  );
}

function relationInverseThirdPerson(base) {
  if (
    base.endsWith("s") || base.endsWith("x") || base.endsWith("z")
    || base.endsWith("ch") || base.endsWith("sh")
  ) {
    return base + "es";
  }
  const len = base.length;
  if (len >= 2 && base.charAt(len - 1) === "y" && !relationInverseIsVowelAt(base, len - 2)) {
    return base.slice(0, len - 1) + "ies";
  }
  if (len >= 2 && base.charAt(len - 1) === "o" && !relationInverseIsVowelAt(base, len - 2)) {
    return base + "es";
  }
  return base + "s";
}

function relationInverseFromParticiple(participle) {
  if (Object.prototype.hasOwnProperty.call(RELATION_INVERSE_PARTICIPLE_BASES, participle)) {
    return relationInverseThirdPerson(RELATION_INVERSE_PARTICIPLE_BASES[participle]);
  }
  if (!participle.endsWith("ed") || participle.length < 4) return null;
  const stem = participle.slice(0, -2);
  if (relationInverseVowelGroupCount(stem) === 0) return null;
  if (stem.endsWith("e")) return null;
  if (stem.endsWith("i")) return stem + "es";
  if (stem.endsWith("y")) return relationInverseThirdPerson(stem);
  const len = stem.length;
  const last = stem.charAt(len - 1);
  if (len >= 3 && last === stem.charAt(len - 2) && RELATION_INVERSE_DOUBLED.indexOf(last) >= 0) {
    return relationInverseThirdPerson(stem.slice(0, -1));
  }
  if (stem.endsWith("ll")) {
    const dropLast = stem.endsWith("ell")
      && !RELATION_INVERSE_ELL_KEEP.has(stem)
      && relationInverseVowelGroupCount(stem) >= 2;
    return relationInverseThirdPerson(dropLast ? stem.slice(0, -1) : stem);
  }
  if (stem.endsWith("ss") || stem.endsWith("zz") || stem.endsWith("ff")) {
    return relationInverseThirdPerson(stem);
  }
  const base = relationInverseNeedsE(stem) ? stem + "e" : stem;
  return relationInverseThirdPerson(base);
}

function relationInverseForLabel(label) {
  try {
    const key = relationInverseCollapseKey(label);
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(RELATION_INVERSE_NAMED_PAIRS, key)) {
      return RELATION_INVERSE_NAMED_PAIRS[key];
    }
    const tokens = key.split(" ");
    if (tokens.length !== 2 || tokens[1] !== "by") return null;
    const token = tokens[0];
    if (!RELATION_INVERSE_TOKEN.test(token)) return null;
    const hyphen = token.lastIndexOf("-");
    const head = hyphen >= 0 ? token.slice(0, hyphen + 1) : "";
    const participle = hyphen >= 0 ? token.slice(hyphen + 1) : token;
    const third = relationInverseFromParticiple(participle);
    if (!third) return null;
    return head + third;
  } catch (error) {
    return null;
  }
}
