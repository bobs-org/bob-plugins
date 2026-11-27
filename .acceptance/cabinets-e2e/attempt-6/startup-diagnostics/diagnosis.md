# Attempt 6 startup diagnosis

Attempt 6's only failed check is `runner-error`; Obsidian exited before the scratch
vault opened, and the report contains no screenshots. The process exited with code 1
after logging only that it loaded `obsidian.asar`. The profile log contains the same
single startup line, and `obsidian.json` shows the scratch vault was marked open.

Athena's `/tmp` is a 32 GB tmpfs with no free space. `xvfb-run` creates its X11
authorization file under `TMPDIR`, but Xvfb still needs `/tmp` for its display lock
and Unix socket. Setting `TMPDIR=/var/tmp` alone does not redirect those X11 files.

On the unchanged host `/tmp`, `TMPDIR=/var/tmp xvfb-run -a /bin/true` timed out during
Xvfb startup. In a rootless private mount namespace with a 2 GB tmpfs mounted over
`/tmp`, the same command exited 0. A real Obsidian launch in that namespace logged the
scratch vault path and completed its startup/update check; its process exited 0 when
the diagnostic probe stopped it after 12 seconds. Attempt 7 uses this isolated `/tmp`.
