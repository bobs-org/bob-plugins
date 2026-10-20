---
title: "BLOCKS dependency mirrors"
description: "How Navigation Hotkeys keeps reverse dependency rows in sync."
---

The task's `Depends-On` links are the source of dependency edges.
Navigation Hotkeys can maintain a reverse `🧱 **BLOCKS:**` line on
each prerequisite so readers can see which open tasks depend on it.

Adding or removing a dependency updates the mirror. A same-note change shares
the dependent task's undo transaction. A cross-note mirror update runs after
the dependency edit commits and checks that the target still matches the
expected preimage. If the mirror is malformed or cannot be updated, the
forward dependency remains in place and the notice adds
`· 🧱 BLOCKS not updated`.

The writer follows `dependencies.blocks_lines` in Bob's shared
config file. The default is `true`; set it to `false` to
stop navigation gestures from writing BLOCKS lines. Bob reads the file under
`$XDG_CONFIG_HOME/bob/config.yml`, using its normal config
directory when the environment variable is unset.

The mirror is managed output. Edit dependencies through the Depends-On
controls; the reverse line is rebuilt from those links.

## Related

- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — dependency stages and gestures.
- [Task dependencies](https://bobs-org.github.io/task-dependencies/) — dependency storage and behavior.
