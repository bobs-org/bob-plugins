# Attempt 7 startup diagnostics

Obsidian started from `/snap/obsidian/current/app/obsidian` with profile `/var/tmp/bob-cabinets-e2e-KhR6KS/profile` and opened the scratch vault. The profile log records package load, a successful update check, and version 1.15.1. The report has no runner error and no Obsidian exit status because the process stayed available during the acceptance run.

- `obsidian-log.txt`: captured Obsidian startup log.
- `profile-obsidian.json`: Obsidian's profile vault registry.
- `obsidian-process.json`: process details and diagnosis from the report.
- `runner-output.log`: complete retained monitor output, including the acceptance summary.
