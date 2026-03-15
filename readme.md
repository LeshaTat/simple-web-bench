# Workbench

Local web UI for a home Ubuntu server. Two things:

- **Scripts** — run/stop shell scripts from the browser, see running status, last run time, and live log output
- **Dashboard** — markdown file rendered as a link page to local services

LAN only. No auth. No internet dependency.

---

## Setup

```bash
npm install
npm start
# → http://localhost:3000
```

Default port is `3000`. Override with `PORT=8080 npm start`.

---

## File Structure

```
workbench/
├── server.js
├── package.json
├── data/
│   ├── scripts.json           # your scripts (gitignored)
│   ├── scripts.example.json   # example template
│   ├── dashboard.md           # your links (gitignored)
│   └── dashboard.example.md   # example template
├── logs/                      # auto-created, one file per script run
└── public/
    └── index.html
```

`scripts.json` and `dashboard.md` are gitignored. Copy the `.example` files to get started, or the server will use the examples as fallback.

---

## Configuring Scripts

Copy `data/scripts.example.json` to `data/scripts.json` and edit. Restart the server after changes.

```json
[
  {
    "name": "backup",
    "label": "Run Backup",
    "command": "bash",
    "args": ["/home/user/scripts/backup.sh"],
    "cwd": "/home/user"
  }
]
```

| Field | Required | Description |
|---|---|---|
| `name` | yes | Unique identifier, used for log filenames |
| `label` | no | Display name shown in the UI (falls back to `name`) |
| `command` | yes | Executable to run |
| `args` | no | Array of arguments |
| `cwd` | no | Working directory (defaults to server process cwd) |

---

## Dashboard

Copy `data/dashboard.example.md` to `data/dashboard.md` and edit. Changes are picked up on next page load — no restart needed.

```markdown
# Local Services

## Monitoring
- [Grafana](http://localhost:3001)
- [Prometheus](http://localhost:9090)

## Dev
- [Gitea](http://localhost:3002)
```

---

## Logs

Each script run creates a new log file: `logs/<name>_YYYY-MM-DD_HH-MM-SS.log`.

On the next run, the previous log is deleted and a new one is created. The UI always shows the last 200 lines on load, then streams live while the script runs.

To keep logs permanently, back up the `logs/` directory before running scripts.

---

## Running as a Service

Create `/etc/systemd/system/workbench.service`:

```ini
[Unit]
Description=Workbench
After=network.target

[Service]
ExecStart=/usr/bin/node /home/user/workbench/server.js
WorkingDirectory=/home/user/workbench
Restart=on-failure
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now workbench
```
