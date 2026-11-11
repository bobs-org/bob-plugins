// Disk reloads stay out of the undo history.
//
// Provenance: an external write to an open note (bob CLI, vault-sync merge,
// Mac Capture, or `vault.process`) reloads the editor through
// `loadFileInternal → setData → setViewData → editor.set → dispatch`. That
// dispatch carries `userEvent: "set"` and is recorded in the CodeMirror 6
// undo history. A new history event clears the redo branch, so Ctrl+R after
// `u` has nothing to redo, and a `u` after the reload reverts the
// background write instead of the user's own edit.
//
// The extender below marks every doc-changing `set` transaction with
// `Transaction.addToHistory.of(false)`. CodeMirror maps both the done and
// undone branches through changes marked this way, so redo survives the
// reload, `u` keeps undoing the user's own edit, and the external text is
// kept. Bob's own open-note writers are unaffected: they go through editor
// transactions (`180-editor-transactions.js`) and carry no `set` event, so
// they stay undoable exactly as documented.
function isDiskReloadTransaction(tr, TransactionClass) {
  try {
    if (!tr || tr.docChanged !== true) {
      return false;
    }
    if (typeof tr.isUserEvent !== "function") {
      return false;
    }
    let isSet = false;
    try {
      isSet = tr.isUserEvent("set");
    } catch (error) {
      return false;
    }
    if (isSet !== true) {
      return false;
    }
    if (
      !TransactionClass ||
      TransactionClass.addToHistory === undefined ||
      TransactionClass.addToHistory === null
    ) {
      return false;
    }
    if (typeof tr.annotation !== "function") {
      return false;
    }
    let existing = null;
    try {
      existing = tr.annotation(TransactionClass.addToHistory);
    } catch (error) {
      return false;
    }
    if (existing === false) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function createReloadHistoryExtension(stateModule) {
  try {
    const source =
      stateModule ||
      (typeof codeMirrorState !== "undefined" ? codeMirrorState : null);
    const EditorStateClass =
      (source && source.EditorState) ||
      (typeof EditorState !== "undefined" ? EditorState : null);
    const TransactionClass =
      (source && source.Transaction) ||
      (typeof Transaction !== "undefined" ? Transaction : null);
    if (!EditorStateClass || !TransactionClass) {
      return null;
    }
    const extender = EditorStateClass.transactionExtender;
    if (!extender || typeof extender.of !== "function") {
      return null;
    }
    const historyTag = TransactionClass.addToHistory;
    if (!historyTag || typeof historyTag.of !== "function") {
      return null;
    }
    return extender.of((tr) => {
      try {
        if (isDiskReloadTransaction(tr, TransactionClass)) {
          return { annotations: historyTag.of(false) };
        }
      } catch (error) {
        // A reload probe must never break the editor.
      }
      return null;
    });
  } catch (error) {
    return null;
  }
}
