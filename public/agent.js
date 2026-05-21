#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  AISentry — local monitoring agent
//  Monitors Claude Code, Codex, Gemini CLI, Aider, and other AI coding tools.
//  Runs entirely on your machine. Streams data to your browser over SSE.
//  Nothing is sent to any external server.
// ─────────────────────────────────────────────────────────────────────────────

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const https = require('https');
const { execSync } = require('child_process');

const VERSION    = '1.0.0';
const PORT       = parseInt(process.env.PORT || '4242', 10);
const HOSTED_URL = process.env.AISENTRY_HOST || process.env.CLAUDE_MONITOR_HOST || '__HOSTED_URL__';
const HOME       = os.homedir();

// ── Known AI agent directories ────────────────────────────────────────────────
const CLAUDE_DIR   = path.join(HOME, '.claude');
const HISTORY_FILE = path.join(HOME, '.claude', 'history.jsonl');

// Session directories per agent — each gets a label prefix in the project chart
const AGENT_SESSION_DIRS = [
  { dir: path.join(HOME, '.claude', 'projects'), prefix: '' },
  { dir: path.join(HOME, '.gemini'),             prefix: 'gemini:' },
  { dir: path.join(HOME, '.codex'),              prefix: 'codex:'  },
];

// Config/settings files to scan for permissions/risk
const AGENT_CONFIG_PATHS = [
  // Claude Code — per project
  (d) => path.join(d, '.claude', 'settings.json'),
  // Cursor — per project
  (d) => path.join(d, '.cursor', 'settings.json'),
];

// ── Terminal colours ──────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',  dim:    '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan:  '\x1b[36m', blue:   '\x1b[34m', grey:'\x1b[90m', bold:'\x1b[1m',
};

function ts()  { return new Date().toLocaleTimeString('en-GB', { hour12: false }); }
function log(tag, msg, color = C.cyan) {
  process.stdout.write(`${C.grey}${ts()}${C.reset} ${color}${tag.padEnd(5)}${C.reset} ${C.dim}│${C.reset} ${msg}\n`);
}

function banner() {
  const pad = 54, line = '═'.repeat(pad);
  const row = (s) => `${C.bold}${C.cyan}║${C.reset}  ${s}${' '.repeat(pad - 2 - s.replace(/\x1b\[[0-9;]*m/g,'').length)}${C.bold}${C.cyan}║${C.reset}`;
  console.log(`\n${C.bold}${C.cyan}╔${line}╗${C.reset}`);
  console.log(row(`AISentry ${C.dim}v${VERSION}${C.reset}`));
  console.log(row(`Dashboard → ${C.blue}${HOSTED_URL}${C.reset}`));
  console.log(`${C.bold}${C.cyan}╚${line}╝${C.reset}\n`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeExec(cmd, ms = 5000) {
  try { return execSync(cmd, { encoding:'utf8', timeout:ms, stdio:['ignore','pipe','ignore'] }).trim(); }
  catch { return ''; }
}

// ── Sessions ──────────────────────────────────────────────────────────────────
function getSessions() {
  const now = Date.now(), dayAgo = now - 864e5, hourAgo = now - 36e5;

  const hourBuckets = Array.from({ length: 24 }, (_, i) => {
    const t = new Date(now - (23 - i) * 36e5);
    return { label: t.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }), count:0, bytes:0 };
  });

  const projects = {};
  let sessionsToday = 0, sessionsThisHour = 0, bytesToday = 0;

  for (const { dir, prefix } of AGENT_SESSION_DIRS) {
    if (!fs.existsSync(dir)) continue;
    let entries; try { entries = fs.readdirSync(dir); } catch { continue; }

    for (const e of entries) {
      const ep = path.join(dir, e);
      let st; try { st = fs.statSync(ep); } catch { continue; }

      // Claude stores sessions as JSONL files inside project subdirs
      if (prefix === '' && st.isDirectory()) {
        const name = e.replace(/^-Users-[^-]+-Code-/,'').replace(/^-Users-[^-]+-/,'~/').replace(/-/g,'/') || '~/';
        let files; try { files = fs.readdirSync(ep).filter(f=>f.endsWith('.jsonl')); } catch { continue; }
        for (const f of files) {
          let fst; try { fst = fs.statSync(path.join(ep,f)); } catch { continue; }
          if (fst.mtimeMs < dayAgo) continue;
          sessionsToday++; bytesToday += fst.size;
          if (fst.mtimeMs > hourAgo) sessionsThisHour++;
          const bi = 23 - Math.min(23, Math.floor((now - fst.mtimeMs) / 36e5));
          hourBuckets[bi].count++; hourBuckets[bi].bytes += fst.size;
          const k = name; if (!projects[k]) projects[k] = { count:0, bytes:0 };
          projects[k].count++; projects[k].bytes += fst.size;
        }
        continue;
      }

      // Other agents: count any JSONL/JSON session files in the dir
      if (prefix !== '' && (e.endsWith('.jsonl') || e.endsWith('.json'))) {
        if (st.mtimeMs < dayAgo) continue;
        sessionsToday++; bytesToday += st.size;
        if (st.mtimeMs > hourAgo) sessionsThisHour++;
        const bi = 23 - Math.min(23, Math.floor((now - st.mtimeMs) / 36e5));
        hourBuckets[bi].count++; hourBuckets[bi].bytes += st.size;
        const k = `${prefix}${e.replace(/\.(jsonl|json)$/,'').slice(0,24)}`;
        if (!projects[k]) projects[k] = { count:0, bytes:0 };
        projects[k].count++; projects[k].bytes += st.size;
      }
    }
  }

  return { hourBuckets, projects, sessionsToday, sessionsThisHour, bytesToday };
}

// ── Processes ─────────────────────────────────────────────────────────────────
// AI agent process signatures (lowercased fragments to match against ps output)
const AGENT_SIGNATURES = [
  // Claude
  'claude', '.claude/', 'claude-flow', '@claude-flow', 'ruflo',
  // OpenAI Codex
  'codex', '@openai/codex', 'openai-codex',
  // Google Gemini
  'gemini', '@google/gemini-cli', 'gemini-cli',
  // Aider
  ' aider ', '/aider',
  // GitHub Copilot
  'copilot-language-server', 'copilot-cli',
];

// Processes that should never be flagged even if they match
const SKIP_IF_CONTAINS = ['grep', 'agent.js', 'aisentry'];

function matchesAgent(line) {
  const l = line.toLowerCase();
  if (SKIP_IF_CONTAINS.some(s => l.includes(s))) return false;
  return AGENT_SIGNATURES.some(s => l.includes(s));
}

function labelProcess(cmd) {
  const l = cmd.toLowerCase();
  if (l.includes('claude-flow') || l.includes('@claude-flow') || l.includes('ruflo'))
    return { label:'claude-flow daemon',      risk:'high'   };
  if (l.includes('.claude/helpers'))
    return { label:`hook: ${path.basename((cmd.match(/\.claude\/helpers\/([^\s]+)/)||[])[1]||'?')}`, risk:'medium' };
  if (l.includes('@openai/codex') || l.includes('openai-codex'))
    return { label:'Codex CLI',               risk:'ok'     };
  if (l.includes('@google/gemini-cli') || (l.includes('gemini') && !l.includes('gemini.app')))
    return { label:'Gemini CLI',              risk:'ok'     };
  if (l.includes('/aider') || l.match(/\baider\b/))
    return { label:'Aider',                   risk:'ok'     };
  if (l.includes('copilot-language-server') || l.includes('copilot-cli'))
    return { label:'GitHub Copilot',          risk:'ok'     };
  if (l.includes('cursor.app') || l.includes('/cursor/'))
    return { label:'Cursor (desktop)',         risk:'ok'     };
  if (l.includes('claude.app') || l.includes('/claude ') || cmd.includes('Claude'))
    return { label:'Claude',                  risk:'ok'     };
  return { label: cmd.slice(0, 60),           risk:'ok'     };
}

function getProcesses() {
  return safeExec('ps aux').split('\n').slice(1).reduce((acc, line) => {
    if (!matchesAgent(line)) return acc;
    const p = line.trim().split(/\s+/); if (p.length < 11) return acc;
    const [, pid, cpu, mem,,,,,,...rest] = p;
    const cmd = rest.join(' ');
    const { label, risk } = labelProcess(cmd);
    acc.push({ pid, cpu:parseFloat(cpu)||0, mem:parseFloat(mem)||0, label, risk, cmd:cmd.slice(0,140) });
    return acc;
  }, []);
}

// ── Permissions ───────────────────────────────────────────────────────────────
function rateRule(rule) {
  if (rule === 'Bash(*)' || rule.includes('node .claude/*'))
    return { risk:'critical', reason:'Blanket execution — any script runs silently' };
  if (rule.startsWith('Bash(node ') && rule.endsWith('*)') && rule.includes('/') && !rule.replace(/\*$/,'').includes('*'))
    return { risk:'low', reason:'Specific script, * covers args only' };
  if (rule.startsWith('Bash(') && rule.endsWith('*)') && !rule.includes('npx'))
    return { risk:'high', reason:'Wildcard Bash permission' };
  if (rule.includes('npx') && rule.endsWith('*'))
    return { risk:'medium', reason:'Wildcard npx' };
  if (rule.startsWith('mcp__') && rule.endsWith(':*'))
    return { risk:'low', reason:'MCP server blanket' };
  return { risk:'ok', reason:'' };
}

function scanSettings(filePath, proj) {
  let data; try { data = JSON.parse(fs.readFileSync(filePath,'utf8')); } catch { return []; }
  const entries = [];
  for (const r of data.permissions?.allow||[]) { const {risk,reason}=rateRule(r); entries.push({project:proj,type:'allow',rule:r,risk,reason}); }
  for (const r of data.permissions?.deny ||[]) { entries.push({project:proj,type:'deny',rule:r,risk:'ok',reason:'Blocked'}); }
  const model = data.claudeFlow?.modelPreferences?.default;
  if (model) entries.push({project:proj,type:'config',rule:`model: ${model}`,risk:model.includes('opus')?'high':'low',reason:model.includes('opus')?'Opus overrides your session model':''});
  const sched = data.claudeFlow?.daemon?.schedules||{};
  if (Object.keys(sched).length) entries.push({project:proj,type:'config',rule:`daemon: ${Object.keys(sched).map(k=>`${k}@${sched[k].interval}`).join(', ')}`,risk:'critical',reason:'Auto-runs AI sessions on a timer'});
  if (data.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS==='1') entries.push({project:proj,type:'config',rule:'AGENT_TEAMS=1',risk:'high',reason:'Autonomous agent auto-assignment'});
  return entries;
}

function scanGeminiConfig() {
  const cfgPath = path.join(HOME, '.gemini', 'settings.json');
  if (!fs.existsSync(cfgPath)) return [];
  let data; try { data = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch { return []; }
  const entries = [];
  if (data.model) entries.push({ project:'~/.gemini', type:'config', rule:`model: ${data.model}`, risk:'low', reason:'Gemini CLI model setting' });
  if (data.sandbox === false) entries.push({ project:'~/.gemini', type:'config', rule:'sandbox: false', risk:'medium', reason:'Gemini CLI running without sandbox' });
  return entries;
}

function scanCodexConfig() {
  const cfgPath = path.join(HOME, '.codex', 'config.json');
  if (!fs.existsSync(cfgPath)) return [];
  let data; try { data = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch { return []; }
  const entries = [];
  if (data.model) entries.push({ project:'~/.codex', type:'config', rule:`model: ${data.model}`, risk:'low', reason:'Codex CLI model setting' });
  if (data.approval_policy === 'never') entries.push({ project:'~/.codex', type:'config', rule:'approvalPolicy: never', risk:'high', reason:'Codex executes commands without asking' });
  if (data.full_auto) entries.push({ project:'~/.codex', type:'config', rule:'fullAuto: true', risk:'critical', reason:'Codex runs fully autonomously' });
  return entries;
}

function getPermissions() {
  const results = [];
  const label = d => d.replace(HOME+'/Code/','').replace(HOME+'/','~/') || '~/';
  const scanDir = d => {
    for (const cfgPath of AGENT_CONFIG_PATHS) {
      const p = cfgPath(d);
      if (fs.existsSync(p)) results.push(...scanSettings(p, label(d)));
    }
  };

  scanDir(HOME);
  results.push(...scanGeminiConfig());
  results.push(...scanCodexConfig());

  const codeDir = path.join(HOME,'Code');
  if (!fs.existsSync(codeDir)) return results;
  let top; try { top=fs.readdirSync(codeDir); } catch { return results; }
  for (const t of top) {
    const tp=path.join(codeDir,t); try { if(!fs.statSync(tp).isDirectory()) continue; } catch { continue; }
    scanDir(tp);
    let sub; try { sub=fs.readdirSync(tp); } catch { continue; }
    for (const s of sub) { const sp=path.join(tp,s); try { if(fs.statSync(sp).isDirectory()) scanDir(sp); } catch {} }
  }
  return results;
}

// ── Network ───────────────────────────────────────────────────────────────────
const SYS_PROCS = new Set(['identitys','IdentityService','mDNSResponder','configd','sharingd','rapportd','trustd','Electron','copilotd']);

function classifyEndpoint(remote) {
  if (remote.startsWith('[fe80:') || remote.startsWith('[::1]') || remote.includes('127.0.0.1') || remote.includes('localhost'))
    return { risk:'ok', flag:'local' };
  if (remote.includes('anthropic.com') || remote.includes('claude.ai'))
    return { risk:'ok', flag:'anthropic' };
  if (remote.includes('openai.com') || remote.includes('oaistatic.com'))
    return { risk:'ok', flag:'openai' };
  if (remote.includes('googleapis.com') || remote.includes('generativelanguage.googleapis.com'))
    return { risk:'ok', flag:'google' };
  if (remote.includes('github.com') || remote.includes('githubusercontent.com') || remote.includes('copilot-proxy'))
    return { risk:'ok', flag:'github' };
  if (remote.endsWith(':443'))
    return { risk:'medium', flag:'unknown HTTPS' };
  return { risk:'high', flag:'unknown' };
}

function getNetwork() {
  const pids = [];
  for (const line of safeExec('ps aux').split('\n')) {
    if (!matchesAgent(line)) continue;
    // Skip desktop GUI apps
    const l = line.toLowerCase();
    if (l.includes('claude.app') || l.includes('cursor.app') || l.includes('electron') || l.includes('helper (renderer)')) continue;
    const pid = line.trim().split(/\s+/)[1];
    if (pid && /^\d+$/.test(pid)) pids.push(pid);
  }
  if (!pids.length) return [];

  const pidSet = new Set(pids);
  const seen = new Set(), result = [];

  for (const line of safeExec(`lsof -i -P -n -p ${pids.slice(0,20).join(',')} 2>/dev/null`).split('\n').slice(1)) {
    if (!line.includes('->') && !line.includes('LISTEN')) continue;
    const p = line.trim().split(/\s+/); if (p.length < 9) continue;
    if (SYS_PROCS.has(p[0]) || !pidSet.has(p[1])) continue;
    const key = `${p[1]}:${p[8]}`; if (seen.has(key)) continue; seen.add(key);
    const name = p[8]||'';
    if (!name.includes('->')) { if (name.includes('LISTEN')) result.push({ proc:p[0],pid:p[1],dest:name,risk:'ok',flag:'listening' }); continue; }
    const remote = name.split('->')[1];
    const { risk, flag } = classifyEndpoint(remote);
    result.push({ proc:p[0], pid:p[1], dest:remote, risk, flag });
  }
  return result;
}

// ── Activity (Claude only — other agents don't expose a history file) ─────────
function getRecentActivity() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    const stat = fs.statSync(HISTORY_FILE);
    const fd   = fs.openSync(HISTORY_FILE, 'r');
    const buf  = Buffer.alloc(Math.min(8192, stat.size));
    fs.readSync(fd, buf, 0, buf.length, Math.max(0, stat.size - 8192));
    fs.closeSync(fd);
    return buf.toString('utf8').split('\n').filter(Boolean).slice(-25).reverse().map(l => {
      try {
        const d = JSON.parse(l);
        const proj = (d.project||'').replace(HOME+'/Code/','').replace(HOME+'/','~/');
        const t = new Date(d.timestamp||0), today = t.toDateString()===new Date().toDateString();
        return { time:t.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}), date:today?'today':t.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}), project:proj||'~/', prompt:(d.display||'').slice(0,100).replace(/\n/g,' '), sessionId:(d.sessionId||'').slice(0,8) };
      } catch { return null; }
    }).filter(Boolean).slice(0,20);
  } catch { return []; }
}

// ── Collect ───────────────────────────────────────────────────────────────────
let updateAvailable = false;

function collectAll() {
  const s = getSessions();
  return {
    version: VERSION, ts: new Date().toISOString(), updateAvailable,
    stats: { sessionsToday:s.sessionsToday, sessionsThisHour:s.sessionsThisHour, mbToday:+(s.bytesToday/1024/1024).toFixed(2), projectsActive:Object.keys(s.projects).length },
    hourBuckets:    s.hourBuckets,
    projects:       Object.entries(s.projects).map(([name,v])=>({name,count:v.count,mb:+(v.bytes/1024/1024).toFixed(2)})).sort((a,b)=>b.count-a.count).slice(0,10),
    processes:      getProcesses(),
    permissions:    getPermissions(),
    network:        getNetwork(),
    recentActivity: getRecentActivity(),
  };
}

// ── SSE ───────────────────────────────────────────────────────────────────────
const clients = new Set();
function push(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch { clients.delete(res); } }
}

function logScan(d) {
  const ch = d.permissions.filter(p=>['critical','high'].includes(p.risk)).length;
  const fp = d.processes.filter(p=>p.risk!=='ok').length;
  const fn = d.network.filter(n=>n.risk!=='ok').length;
  log('scan', `${d.stats.sessionsToday} sessions · ${d.stats.sessionsThisHour} this hr · ${d.stats.mbToday} MB · ${d.stats.projectsActive} projects`);
  log('perm', ch ? `${C.red}${ch} critical/high${C.reset}` : `${C.green}✓ clean${C.reset}`, ch?C.red:C.green);
  log('proc', fp ? `${C.yellow}${fp} flagged${C.reset} / ${d.processes.length}` : `${C.green}✓${C.reset} ${d.processes.length} tracked`, fp?C.yellow:C.green);
  log('net',  fn ? `${C.yellow}${fn} unknown${C.reset} / ${d.network.length}` : `${C.green}✓${C.reset} ${d.network.length} conns`, fn?C.yellow:C.green);
}

// ── Version check ─────────────────────────────────────────────────────────────
function checkVersion() {
  try {
    const u = new URL(`${HOSTED_URL}/version.json`);
    const req = https.get({ hostname:u.hostname, path:u.pathname+u.search, timeout:5000 }, res => {
      let body=''; res.on('data',d=>body+=d);
      res.on('end', () => {
        try {
          const remote = JSON.parse(body);
          if (remote.agent && remote.agent !== VERSION) {
            updateAvailable = true;
            log('upd', `${C.yellow}v${remote.agent} available → curl -fsSL ${HOSTED_URL}/install.sh | bash${C.reset}`, C.yellow);
          }
        } catch {}
      });
    });
    req.on('error', ()=>{}); req.end();
  } catch {}
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':          '*',
  'Access-Control-Allow-Methods':         'GET, OPTIONS',
  'Access-Control-Allow-Headers':         'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { Object.entries(CORS).forEach(([k,v])=>res.setHeader(k,v)); res.writeHead(204); res.end(); return; }
  Object.entries(CORS).forEach(([k,v])=>res.setHeader(k,v));
  const url = (req.url||'/').split('?')[0];

  if (url === '/ping') {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ ok:true, version:VERSION, port:PORT, updateAvailable }));
    return;
  }

  if (url === '/events') {
    res.setHeader('Content-Type',     'text/event-stream');
    res.setHeader('Cache-Control',    'no-cache');
    res.setHeader('Connection',       'keep-alive');
    res.setHeader('X-Accel-Buffering','no');
    res.writeHead(200);
    clients.add(res);
    log('conn', `connected ${C.dim}[${clients.size} active]${C.reset}`, C.blue);
    const data = collectAll(); logScan(data);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    const hb = setInterval(()=>{ try { res.write(': ping\n\n'); } catch { clearInterval(hb); } }, 25000);
    req.on('close', ()=>{ clients.delete(res); clearInterval(hb); log('conn', `disconnected ${C.dim}[${clients.size} active]${C.reset}`, C.grey); });
    return;
  }

  res.writeHead(404); res.end('Not found');
}).listen(PORT, '127.0.0.1', () => {
  banner();
  log('init', `${C.green}✓ listening on http://localhost:${PORT}${C.reset}`, C.green);
  log('init', `open ${C.blue}${HOSTED_URL}/monitor${C.reset} in your browser`, C.dim);
  console.log(`${C.grey}${'─'.repeat(56)}${C.reset}`);
  const first = collectAll(); logScan(first);
  console.log(`${C.grey}${'─'.repeat(56)}${C.reset}`);
  setInterval(()=>{ if(clients.size>0){ const d=collectAll(); logScan(d); push(d); } }, 5000);
  checkVersion();
  setInterval(checkVersion, 36e5);
}).on('error', e => {
  if (e.code === 'EADDRINUSE') process.stderr.write(`\nPort ${PORT} in use. Try: PORT=4243 node agent.js\n\n`);
  else process.stderr.write(`Error: ${e.message}\n`);
  process.exit(1);
});
