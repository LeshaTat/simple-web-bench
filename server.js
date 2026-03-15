const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DATA_DIR = path.join(__dirname, 'data');
const LOGS_DIR = path.join(__dirname, 'logs');
const SCRIPTS_FILE = path.join(DATA_DIR, 'scripts.json');
const SCRIPTS_EXAMPLE = path.join(DATA_DIR, 'scripts.example.json');
const DASHBOARD_FILE = path.join(DATA_DIR, 'dashboard.md');
const DASHBOARD_EXAMPLE = path.join(DATA_DIR, 'dashboard.example.md');

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// name -> { process, logFile }
const running = {};

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadScripts() {
  const file = fs.existsSync(SCRIPTS_FILE) ? SCRIPTS_FILE : SCRIPTS_EXAMPLE;
  return JSON5.parse(fs.readFileSync(file, 'utf8'));
}

// Last log file for a given script name (sorted by timestamp in filename)
function getLastLogFile(name) {
  const prefix = name + '_';
  const files = fs.readdirSync(LOGS_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith('.log'))
    .sort();
  return files.length ? files[files.length - 1] : null;
}

// Filename: backup_2024-01-15_10-23-00.log  →  ISO string
function parseTimestamp(filename) {
  const m = filename.match(/_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.log$/);
  if (!m) return null;
  return new Date(`${m[1]}T${m[2].replace(/-/g, ':')}`).toISOString();
}

function nowFilestamp() {
  return new Date().toISOString()
    .replace('T', '_')
    .replace(/:/g, '-')
    .replace(/\..+/, '');
}

function tailFile(filePath, lines = 200) {
  if (!fs.existsSync(filePath)) return '';
  const all = fs.readFileSync(filePath, 'utf8').split('\n');
  return all.slice(-lines).join('\n');
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

// ── Static ────────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/vendor/marked.min.js', (req, res) => {
  const base = path.dirname(require.resolve('marked/package.json'));
  res.sendFile(path.join(base, 'marked.min.js'));
});

// ── API ───────────────────────────────────────────────────────────────────────

// All scripts with current state
app.get('/api/scripts', (req, res) => {
  const scripts = loadScripts();
  const result = scripts.map(s => {
    const lastLogFile = getLastLogFile(s.name);
    return {
      ...s,
      running: !!running[s.name],
      lastRun: lastLogFile ? parseTimestamp(lastLogFile) : null,
    };
  });
  res.json(result);
});

// Start script — 409 if already running
app.post('/api/scripts/:name/run', (req, res) => {
  const scripts = loadScripts();
  const script = scripts.find(s => s.name === req.params.name);
  if (!script) return res.status(404).json({ error: 'Not found' });
  if (running[script.name]) return res.status(409).json({ error: 'Already running' });

  // Remove previous log
  const old = getLastLogFile(script.name);
  if (old) fs.unlinkSync(path.join(LOGS_DIR, old));

  const logFilename = `${script.name}_${nowFilestamp()}.log`;
  const logPath = path.join(LOGS_DIR, logFilename);
  const logStream = fs.createWriteStream(logPath);

  const proc = spawn(script.command, script.args || [], {
    cwd: script.cwd || process.cwd(),
    env: process.env,
  });

  running[script.name] = { process: proc, logFile: logFilename };
  broadcast({ type: 'status', script: script.name, running: true, lastRun: parseTimestamp(logFilename) });

  function pipe(data) {
    const text = data.toString();
    logStream.write(text);
    broadcast({ type: 'log', script: script.name, data: text });
  }

  proc.stdout.on('data', pipe);
  proc.stderr.on('data', pipe);

  proc.on('close', code => {
    logStream.end(`\n[exited with code ${code}]\n`);
    delete running[script.name];
    broadcast({
      type: 'status',
      script: script.name,
      running: false,
      lastRun: parseTimestamp(logFilename),
    });
  });

  res.json({ ok: true });
});

// Stop script — 409 if not running
app.post('/api/scripts/:name/stop', (req, res) => {
  const entry = running[req.params.name];
  if (!entry) return res.status(409).json({ error: 'Not running' });
  entry.process.kill();
  res.json({ ok: true });
});

// Last N lines of the most recent log
// ?tail=200 (default)
app.get('/api/scripts/:name/log', (req, res) => {
  const tail = parseInt(req.query.tail) || 200;
  const lastLogFile = getLastLogFile(req.params.name);
  if (!lastLogFile) return res.json({ content: '', lastRun: null });
  const content = tailFile(path.join(LOGS_DIR, lastLogFile), tail);
  res.json({ content, lastRun: parseTimestamp(lastLogFile) });
});

// Raw markdown
app.get('/api/dashboard', (req, res) => {
  const file = fs.existsSync(DASHBOARD_FILE) ? DASHBOARD_FILE : DASHBOARD_EXAMPLE;
  const content = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8')
    : '# Dashboard\n\nAdd links to `data/dashboard.md`.';
  res.json({ content });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────

app.get(['/', '/scripts'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── WebSocket ─────────────────────────────────────────────────────────────────

// Clients connect, server broadcasts to all — no subscription protocol needed
wss.on('connection', () => {});

// ── Boot ──────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Workbench → http://localhost:${PORT}`);
});
