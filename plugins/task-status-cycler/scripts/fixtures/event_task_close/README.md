# Event Task close vectors

`vectors.json` was copied byte-for-byte from bob-cli commit
`a4044f40164ce1c89ab1c19b75c2ecd71c1e37e5`, at
`tests/fixtures/event_task_close/vectors.json`. bob-cli is the source of
truth; the Obsidian mirror consumes every `classify` case and every
`close` case that is not marked `rust_only`.

Pin: `buffered-event-classifies-by-its-meeting-span` was added with the
`[buffer::]` field in bob-cli. A buffer never widens a close: the clock class
comes from the bare meeting span, so a MEET closed when lunch ends still
completes lunch even though its `+15` buffer runs on.

The vectors were refreshed from bob-cli's `feat(capture): place MEET
continuation after last open Pomodoro` change; carried MEET continuations now
follow the last open Pomodoro.
