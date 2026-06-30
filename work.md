# Work Playbook

Operational conventions for this machine. The bot loads this file on **every**
turn, so edits take effect immediately, so keep it short, accurate, and specific.
Everything below is an editable example; replace it with what's true for your machine.

## Ground rules
- This runs unattended over Telegram. Prefer non-interactive commands (no prompts
  that wait for stdin); pass flags like `-y` where appropriate.
- Confirm before anything destructive or irreversible (deleting data, dropping a
  database, `rm -rf`, force-pushing). State exactly what will happen first.
- When a request is ambiguous, ask one short clarifying question rather than guess.

## Task auto-creation (remind me / todo / follow up)
When the president says anything that implies a future action or reminder, create
a Kanban card immediately without asking. Trigger phrases include (but are not
limited to): "remind me", "don't forget", "follow up on", "note this", "add to
the backlog", "todo", "make a card", "track this". Examples:
- "Remind me to renew the SSL cert next month" → `task_create` title="Renew SSL cert", notes with context.
- "Follow up with Mark on the landing page copy" → card in backlog, delegate-ready.
- "Note this: switch to PostgreSQL when we hit 10k users" → backlog card with that note.
Always confirm the card was created (title + column) in your reply.

## Inbox / suggestions (for Atlas and Leads)
Use `crew_suggest` for any non-urgent idea, finding, or proposal that needs the
president's review but does not require immediate action. The president triages
from `/inbox` or the panel Crew tab (accept → backlog card, delegate → Lead run,
dismiss → archive).
- **When to suggest vs. report**: suggest when the outcome is uncertain or the
  president should decide; report (`crew_report`) when the work is done and you
  are recording the result.
- **When to ask the president directly**: use `crew_ask_president` only when you
  are mid-task and genuinely blocked on a decision. State the question tightly
  (one sentence) and offer concrete options when possible. The president's plain
  text reply resolves it and the turn continues.

## Delegation patterns (for Leads)
Leads can hand subtasks to other Leads or specialists via `crew_delegate`. Rules:
- Delegate only work that is clearly within the target Lead's portfolio.
- Pass enough context in the task description for the target to act without
  follow-up questions (cwd, relevant file paths, acceptance criteria).
- After `crew_delegate` returns, incorporate the result into your own reply or
  report before finishing. Never just forward raw output without synthesis.
- If the target Lead needs a president decision mid-task, that Lead uses
  `crew_ask_president`; do not chain delegation to avoid the question.
- Log the outcome with `crew_report` once the delegated subtask is done, so the
  activity feed shows who did what.

## Services
When asked to start/stop/restart a service, use these exact commands:

- **Apache (httpd)**: `sudo apachectl restart`. Config test first with `sudo apachectl configtest`.
  - Logs: `/usr/local/var/log/httpd/` (or `/var/log/apache2/`).
- **nginx**: `sudo nginx -t && sudo nginx -s reload`.
- **PostgreSQL** (Homebrew): `brew services restart postgresql`.
- **Docker containers**: `docker restart <name>`; check with `docker ps`.

## Scheduled jobs / crontab
- View current crontab: `crontab -l`.
- Edit safely (don't open the interactive editor): write the full crontab to a
  file and install it, e.g. `crontab /path/to/new.crontab`. Always show the diff
  vs. `crontab -l` before installing, and keep a backup of the previous one.
- Job format reminder: `min hour day-of-month month day-of-week command`.
- For macOS-native scheduling prefer `launchd` plists in `~/Library/LaunchAgents/`
  when a job must survive reboots or run in a user session.

## Deploys / common tasks
<!-- Add your own recurring tasks here so the bot does them the same way each time. -->
- Example, "deploy the site": `cd /path/to/project && git pull && npm ci && npm run build && sudo apachectl restart`.

## Managing this agent (self-service)
This bot runs as an OS service: **systemd** (`myhq`) on Linux, or a
**launchd** LaunchAgent (`sh.gyorgy.myhq`) on macOS. Prefer the
cross-platform wrapper, run from the project directory:

- **Restart**: `./scripts/agentctl.sh restart`
- **Stop / Start**: `./scripts/agentctl.sh stop` / `./scripts/agentctl.sh start`
- **Status**: `./scripts/agentctl.sh status`
- **Logs**: `./scripts/agentctl.sh logs`

Native equivalents if you need them:
- Linux: `sudo systemctl restart myhq` (logs: `journalctl -u myhq`)
- macOS: `launchctl kickstart -k gui/$(id -u)/sh.gyorgy.myhq`

Notes:
- On Linux the systemctl management commands are passwordless (a scoped sudoers
  rule installed by the installer). On macOS it is a per-user agent, so no sudo.
- **Restarting kills the current process**: the in-flight reply stops and the
  Telegram connection re-establishes automatically. That is expected: run the
  restart command last, and do not try to report back afterward in the same turn.

### Updating to the latest version
When asked to "update", "update to the latest version", "pull the latest", or
similar, run the project's update script from the project directory:

```
./scripts/update.sh
```

**Always use this script, never hand-roll `git pull` + restart.** The script is
the only path that also reinstalls dependencies and rebuilds; pulling by hand
skips `npm install` / `npm run build`, so new code or dependency changes won't
actually take effect until someone runs them manually.

It does everything in one shot: fetches `origin`, **hard-resets** the checkout to
the remote ref (local edits to *tracked* files are discarded; untracked files
and the gitignored `data/` dir are left alone), runs `npm install`, rebuilds the
panel UI + bot (`npm run build`, which also runs `npm install` inside `panel/`),
and restarts the service **only if** one is installed.

- Pin a specific branch/tag/commit by passing it: `./scripts/update.sh <git-ref>`
  (defaults to the current branch).
- Output reports whether it was already up to date or the commit range applied.
- Because the script restarts the service itself at the end, the **same caveat as
  a manual restart applies**: the current process is killed, so run it as the last
  action and don't try to report back afterward in the same turn. If no service is
  installed, the script just builds and you must restart the manual run yourself.
- Your customizations are preserved: panel-managed config (workers, providers,
  schedules, main-agent model, sessions) lives in the gitignored `data/` dir and
  is untouched, and this `work.md` is backed up and restored across the reset.
  Other local edits to *tracked* files are discarded; say so first if you have any.

## Fleet API (Panel)

When the panel is enabled, the whole fleet can be managed programmatically over a
local REST API (workers, tasks, schedules, memory, vault, providers, heartbeat,
council, tunnel, and more). You normally manage the fleet through your MCP tools,
not curl, so the full endpoint catalogue with copy-paste `curl` examples lives in
**[`PANEL_API.md`](PANEL_API.md)**. Read that file when you actually need to
script the panel or call an endpoint directly. Auth is the `PANEL_TOKEN` from
`.env`, sent as `Authorization: Bearer $PANEL_TOKEN`.

## Temporary swap (Linux only)
When a task requires more memory than is available (large builds, model inference,
bulk data processing), add temporary swap from the project directory:

```bash
./scripts/tmpswap.sh on 4          # add 4GB (default); first arg is size in GB
# ... do the heavy work ...
./scripts/tmpswap.sh off           # remove when done (reclaims disk space)
```

The script checks that the requested size does not exceed 80% of free disk space
before creating the file. The swap lives at `/var/tmp/myhq-swap` by default and
is NOT added to `/etc/fstab`; it disappears on reboot even if you forget to run
`off`. Always remove it after the task to reclaim the disk space.

On macOS the script exits cleanly with a message: macOS manages swap automatically.

## Telegram bot tips
- **Set bot profile photo**: use `setMyProfilePhoto` (NOT `setMyPhoto`, which 404s).
  The `photo` param must be an `InputProfilePhoto` JSON object. A bare
  `-F photo=@file` always fails with "photo isn't specified". Correct form:

  ```bash
  curl -s -F 'photo={"type":"static","photo":"attach://av"}' \
    -F "av=@photo.png" \
    "https://api.telegram.org/bot${TOKEN}/setMyProfilePhoto"
  ```

  On Windows use the PowerShell byte-stream approach (see skill `set-telegram-bot-photo`).
- **Image source**: any PNG/JPEG works, download from the web, generate one, or use
  an existing file. No need to author an SVG first.

## Conventions
- Where new files go: for one-off creations (a script you were asked to write, a
  generated file, a download, scratch work), write them into the current working
  directory using **relative paths** (e.g. `./png2webp.sh`), not an absolute path
  into the bot's own source tree. The working directory defaults to a gitignored
  `data/` folder, so ad-hoc creations stay out of the project. When the request is
  clearly about an existing project, work inside that project instead.
- Timezone / schedules: assume the machine's local time unless a job says UTC.
