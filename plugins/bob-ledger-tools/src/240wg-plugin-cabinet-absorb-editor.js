// Cabinet Live Preview absorption (bob-cli-qq absorption): one StateField
// that hides a claimed catalog region at render time. Modeled on the title
// ownership kit (240i): a pure reducer with injectable deps, a refresh
// effect, strict-inside reveal, and atomic ranges (ladder rung b) so Vim
// motion never strands an invisible cursor. Fail-open everywhere: Source
// mode, embeds, hover, canvas, and print carry no claim, so the stored
// section renders natively. Never throws.
const PROPERTY_CARD_CABINET_ABSORB_ATTRS = Object.freeze({ class: "bob-cabinet-absorbed" });

// Lazy CodeMirror pieces, created on first use like the title kit.
let propertyCardCabinetAbsorbEffectType = null;
let propertyCardCabinetAbsorbFieldType = null;
let propertyCardCabinetAbsorbGeneration = 0;
const propertyCardCabinetAbsorbOwners = new WeakMap();

function propertyCardCabinetAbsorbEnsureEffect() {
  if (!propertyCardCabinetAbsorbEffectType) {
    try {
      if (typeof StateEffect !== "undefined" && StateEffect && typeof StateEffect.define === "function") {
        propertyCardCabinetAbsorbEffectType = StateEffect.define();
      }
    } catch (_) {
      propertyCardCabinetAbsorbEffectType = null;
    }
  }
  return propertyCardCabinetAbsorbEffectType;
}

function propertyCardCabinetAbsorbFieldCreate() {
  return { claim: null, ranges: [], revealed: false };
}

function propertyCardCabinetAbsorbStateField(state, field) {
  if (!field || !state || typeof state.field !== "function") return undefined;
  try {
    return state.field(field, false);
  } catch (_) {
    return undefined;
  }
}

function propertyCardCabinetAbsorbLineStarts(text) {
  const starts = [0];
  const source = String(text);
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

// Hidden doc ranges for one hide plan: the heading when hideable, the
// callout, and one following blank line so no empty gap remains.
function propertyCardCabinetAbsorbRangesForPlan(text, plan) {
  if (!plan || plan.startLine == null || plan.endLine == null) return [];
  const source = String(text == null ? "" : text);
  const starts = propertyCardCabinetAbsorbLineStarts(source);
  const lineStart = (line) => starts[Math.min(Math.max(line - 1, 0), starts.length - 1)] ?? source.length;
  const lineEnd = (line) => {
    const at = Math.min(Math.max(line - 1, 0), starts.length - 1);
    const next = starts[at + 1];
    let end = next == null ? source.length : next;
    if (end > starts[at] && source[end - 1] === "\n") end -= 1;
    if (end > starts[at] && source[end - 1] === "\r") end -= 1;
    return end;
  };
  const from = lineStart(plan.headingLine != null ? plan.headingLine : plan.startLine);
  let toLine = plan.endLine;
  const after = String(source.split(/\r\n|\r|\n/)[plan.endLine] ?? "");
  if (after.trim() === "") toLine = plan.endLine + 1;
  return [{ from, to: lineEnd(toLine) }];
}

// Strictly inside: both selection ends are strictly within the range.
// Boundary contact never reveals, so a cursor parked at the edge of a
// hidden range keeps the cabinet standing in for it.
function propertyCardCabinetSelectionStrictlyInside(selection, range) {
  try {
    if (!selection || !range) return false;
    const points = [];
    if (typeof selection.anchor === "number" && typeof selection.head === "number") {
      points.push(selection.anchor, selection.head);
    }
    for (const sub of selection.ranges || []) {
      if (typeof sub?.from === "number" && typeof sub?.to === "number") points.push(sub.from, sub.to);
      if (typeof sub?.anchor === "number" && typeof sub?.head === "number") points.push(sub.anchor, sub.head);
    }
    if (points.length === 0) return false;
    return points.every((point) => point > range.from && point < range.to);
  } catch (_) {
    return false;
  }
}

// Pure reducer behind the StateField. tr needs effects, docChanged, state
// ({ doc, selection, field }), and startState. deps may inject { effect,
// livePreviewField, infoField, text } for tests.
function propertyCardCabinetAbsorbFieldReduce(value, tr, deps = {}) {
  const current = value && typeof value === "object" ? value : propertyCardCabinetAbsorbFieldCreate();
  try {
    const effectType = deps.effect || propertyCardCabinetAbsorbEffectType;
    const liveField = Object.prototype.hasOwnProperty.call(deps, "livePreviewField")
      ? deps.livePreviewField
      : (typeof editorLivePreviewField !== "undefined" ? editorLivePreviewField : undefined);
    const infoField = Object.prototype.hasOwnProperty.call(deps, "infoField")
      ? deps.infoField
      : (typeof editorInfoField !== "undefined" ? editorInfoField : undefined);
    let claim = current.claim || null;
    for (const effect of tr?.effects || []) {
      if (!effectType || typeof effect?.is !== "function" || !effect.is(effectType)) continue;
      const payload = effect.value || {};
      if (payload.absorb && typeof payload.absorb.path === "string" && typeof payload.absorb.kind === "string") {
        claim = {
          path: payload.absorb.path,
          kind: payload.absorb.kind,
          fingerprint: payload.absorb.fingerprint == null ? null : String(payload.absorb.fingerprint),
          generation: payload.absorb.generation == null ? null : payload.absorb.generation,
          rung: payload.absorb.rung === "replace" ? "replace" : "atomic",
        };
      } else if (payload.release !== undefined && claim && claim.generation === payload.release) {
        claim = null;
      }
    }
    const state = tr?.state;
    if (claim) {
      if (propertyCardCabinetAbsorbStateField(state, liveField) === false) claim = null;
    }
    if (claim) {
      const info = propertyCardCabinetAbsorbStateField(state, infoField);
      if (info && (info.file?.path ?? null) !== claim.path) claim = null;
    }
    let ranges = current.ranges || [];
    if (!claim) {
      ranges = [];
    } else if (claim !== current.claim || tr?.docChanged) {
      const doc = state?.doc;
      const text = deps.text !== undefined
        ? deps.text
        : (doc && typeof doc.toString === "function"
          ? doc.toString()
          : (typeof doc?.sliceString === "function" && typeof doc?.length === "number"
            ? doc.sliceString(0, doc.length)
            : (typeof state?.doc === "string" ? state.doc : "")));
      const plan = propertyCardCatalogRegionForHide(text, claim.kind);
      if (!plan || plan.damage || (claim.fingerprint != null && plan.fingerprint !== claim.fingerprint)) {
        claim = null;
        ranges = [];
      } else {
        ranges = propertyCardCabinetAbsorbRangesForPlan(text, plan);
      }
    }
    const selection = state?.selection;
    const revealed = ranges.length > 0 && ranges.some((range) => propertyCardCabinetSelectionStrictlyInside(selection, range));
    if (claim === current.claim && ranges === current.ranges && revealed === current.revealed) return current;
    return { claim, ranges, revealed };
  } catch (_) {
    return propertyCardCabinetAbsorbFieldCreate();
  }
}

function propertyCardCabinetAbsorbFieldDecorations(value) {
  let none = null;
  try {
    none = (typeof Decoration !== "undefined" && Decoration && Decoration.none !== undefined) ? Decoration.none : null;
  } catch (_) {
    none = null;
  }
  try {
    if (!value?.claim || !value.ranges || value.ranges.length === 0 || value.revealed) return none;
    if (typeof Decoration === "undefined" || !Decoration || typeof Decoration.replace !== "function") return none;
    const built = value.ranges.map((range) => {
      const replace = Decoration.replace({ block: true });
      if (replace && typeof replace.range === "function") return replace.range(range.from, range.to);
      return { from: range.from, to: range.to, value: replace };
    });
    if (typeof Decoration.set === "function") return Decoration.set(built);
    if (typeof RangeSetBuilder !== "undefined" && RangeSetBuilder) {
      const builder = new RangeSetBuilder();
      for (const span of built) {
        if (span && typeof span.from === "number") builder.add(span.from, span.to, span.value !== undefined ? span.value : span);
        else if (span && typeof builder.add === "function") builder.add(span.from, span.to, span);
      }
      return builder.finish();
    }
    return built;
  } catch (_) {
    return none;
  }
}

// Atomic ranges for the same hidden spans (ladder rung b): the cursor maps
// around them, so Vim motion never lands inside a replaced range. Rung
// "replace" (ladder rung a) skips them, so the spike can measure the bare
// replace behavior against the atomic one.
function propertyCardCabinetAbsorbAtomicRanges(value) {
  try {
    if (!value?.claim || !value.ranges || value.ranges.length === 0 || value.revealed) return [];
    if ((value.claim.rung || "atomic") === "replace") return [];
    return value.ranges.map((range) => ({ from: range.from, to: range.to }));
  } catch (_) {
    return [];
  }
}

// CodeMirror's atomicRanges facet must yield a RangeSet: cursor motion calls
// `.between()` on every provider's result, so a plain array throws on every
// Vim or arrow motion in every Live Preview editor.
function propertyCardCabinetAbsorbAtomicRangeSet(ranges) {
  try {
    const list = (Array.isArray(ranges) ? ranges : []).filter((range) => range
      && Number.isInteger(range.from) && Number.isInteger(range.to) && range.to > range.from);
    if (!list.length) return Decoration.none;
    const atom = Decoration.mark({});
    return Decoration.set(list.map((range) => atom.range(range.from, range.to)), true);
  } catch (_) {
    return Decoration.none;
  }
}

// True when a document position falls strictly inside a hidden span: the
// navigation hook calls the claim's reveal() instead of moving the cursor.
function propertyCardCabinetAbsorbShouldReveal(value, pos) {
  try {
    if (typeof pos !== "number" || !value?.ranges) return false;
    return value.ranges.some((range) => pos > range.from && pos < range.to);
  } catch (_) {
    return false;
  }
}

// The StateField plus atomic ranges for every Live Preview editor. Returns
// null (the caller registers nothing) when any CodeMirror piece is missing.
function propertyCardCabinetAbsorbEditorExtension() {
  try {
    if (propertyCardCabinetAbsorbFieldType) return propertyCardCabinetAbsorbFieldType;
    if (typeof StateField === "undefined" || !StateField || typeof StateField.define !== "function") return null;
    if (typeof Decoration === "undefined" || !Decoration || typeof Decoration.replace !== "function") return null;
    if (typeof EditorView === "undefined" || !EditorView) return null;
    if (typeof EditorView.decorations?.from !== "function") return null;
    if (!propertyCardCabinetAbsorbEnsureEffect()) return null;
    const field = StateField.define({
      create: () => propertyCardCabinetAbsorbFieldCreate(),
      update: (value, tr) => propertyCardCabinetAbsorbFieldReduce(value, tr),
      provide: (defined) => {
        const extensions = [EditorView.decorations.from(defined, (value) => propertyCardCabinetAbsorbFieldDecorations(value))];
        if (EditorView.atomicRanges && typeof EditorView.atomicRanges.of === "function") {
          extensions.push(EditorView.atomicRanges.of((view) => {
            try {
              return propertyCardCabinetAbsorbAtomicRangeSet(
                propertyCardCabinetAbsorbAtomicRanges(view.state.field(defined, false)),
              );
            } catch (_) {
              return propertyCardCabinetAbsorbAtomicRangeSet([]);
            }
          }));
        }
        return extensions;
      },
    });
    propertyCardCabinetAbsorbFieldType = field;
    return field;
  } catch (_) {
    propertyCardCabinetAbsorbFieldType = null;
    return null;
  }
}

function propertyCardCabinetAbsorbDefer(callback) {
  if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else Promise.resolve().then(callback);
}

function propertyCardCabinetAbsorbEditorDispatch(view, payload) {
  const effect = propertyCardCabinetAbsorbEnsureEffect();
  if (!effect) return;
  try {
    view.dispatch({ effects: effect.of(payload) });
  } catch (_) {}
}

// Claim a region in one Live Preview editor. The claim only hides while a
// mounted cabinet vouches for it: pass the cabinet's release alongside so a
// failed body build unhides in the same frame. `options.rung` selects the
// hide ladder rung ("atomic" by default, "replace" for the bare rung a).
// Returns an idempotent release function (with .generation), or null when
// the editor cannot carry it.
function propertyCardCabinetAbsorbInEditor(view, options = {}) {
  try {
    if (!view || typeof view.dispatch !== "function") return null;
    const path = String(options?.path || "");
    const kind = String(options?.kind || "");
    if (!path || !kind || !propertyCardCabinetRegionSpec(kind)) return null;
    if (!propertyCardCabinetAbsorbEnsureEffect()) return null;
    try {
      if (typeof editorLivePreviewField !== "undefined" && propertyCardCabinetAbsorbStateField(view.state, editorLivePreviewField) === false) return null;
    } catch (_) {
      return null;
    }
    if (typeof propertyCardCabinetAbsorbEditorExtension !== "function") return null;
    if (!propertyCardCabinetAbsorbEditorExtension()) return null;
    const defer = typeof options.defer === "function" ? options.defer : propertyCardCabinetAbsorbDefer;
    const current = propertyCardCabinetAbsorbOwners.get(view);
    if (current && !current.released && current.path === path && current.kind === kind) return current.handle;
    propertyCardCabinetAbsorbGeneration += 1;
    const entry = {
      view, path, kind, defer,
      fingerprint: options?.fingerprint == null ? null : String(options.fingerprint),
      rung: options?.rung === "replace" ? "replace" : "atomic",
      generation: propertyCardCabinetAbsorbGeneration, pending: false, released: false, handle: null,
    };
    if (current && !current.released) {
      current.released = true;
      current.defer(() => propertyCardCabinetAbsorbEditorDispatch(current.view, { release: current.generation }));
    }
    const handle = () => {
      if (entry.released) return;
      entry.released = true;
      if (propertyCardCabinetAbsorbOwners.get(view) !== entry) return;
      propertyCardCabinetAbsorbOwners.delete(view);
      entry.defer(() => propertyCardCabinetAbsorbEditorDispatch(entry.view, { release: entry.generation }));
    };
    handle.generation = entry.generation;
    entry.handle = handle;
    propertyCardCabinetAbsorbOwners.set(view, entry);
    entry.pending = true;
    entry.defer(() => {
      entry.pending = false;
      if (entry.released || propertyCardCabinetAbsorbOwners.get(view) !== entry) return;
      propertyCardCabinetAbsorbEditorDispatch(view, {
        absorb: { path: entry.path, kind: entry.kind, fingerprint: entry.fingerprint, generation: entry.generation, rung: entry.rung },
      });
    });
    return handle;
  } catch (_) {
    return null;
  }
}
