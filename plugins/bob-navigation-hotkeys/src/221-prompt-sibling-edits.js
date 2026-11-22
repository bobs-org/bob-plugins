// Prompt-surviving snapshots (T11, phase bob-cli-oz.4).
//
// A prompt's `((` can name an ID-less sibling task while the host prompt is
// still open over its own pending write. Naming is one in-place edit of one
// other line (it appends ` ^id`, plus the freshness stamp) and never changes
// the line count. A host that snapshotted its note before the prompt must not
// read that as "the note changed": it adopts the live text when the ONLY
// differences are on lines it does not write. Everything else still refuses.
//
// Pure and never throws. A line-count change, or a change on any protected
// (target) line, returns null, so the host keeps its existing stale refusal.

function navAdoptSiblingEdits(before, live, protectedLines) {
  try {
    if (typeof before !== "string" || typeof live !== "string") return null;
    if (live === before) return before;
    const left = before.split("\n");
    const right = live.split("\n");
    if (left.length !== right.length) return null;
    const guarded = new Set(Array.isArray(protectedLines) ? protectedLines : []);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index] && guarded.has(index)) return null;
    }
    return live;
  } catch (_error) {
    return null;
  }
}

// Cursor hosts: the open editor's text after the prompt, or `content` itself
// when the buffer changed on a target line (the host's own check then refuses).
function navContentAfterPrompt(cm, content, protectedLines) {
  try {
    if (!cm || typeof cm.getValue !== "function") return content;
    const adopted = navAdoptSiblingEdits(content, String(cm.getValue() || ""), protectedLines);
    return adopted === null ? content : adopted;
  } catch (_error) {
    return content;
  }
}

// Link-session hosts: each group's live note text after the prompt. `readNote`
// is the host's own reader (`readLinkPickerNoteContent`); a group whose note
// changed on a target line (or cannot be read) is returned unchanged, so the
// host's preimage check still refuses it.
async function navGroupsAfterPrompt(groups, readNote) {
  const out = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    try {
      const live = await readNote(group);
      const targets = group && group.session && Array.isArray(group.session.targets) ? group.session.targets : [];
      const adopted = navAdoptSiblingEdits(group.content, live, targets.map((target) => target.line));
      out.push(adopted === null || adopted === group.content ? group : Object.freeze({ ...group, content: adopted }));
    } catch (_error) {
      out.push(group);
    }
  }
  return out;
}
