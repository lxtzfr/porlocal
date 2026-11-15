// Served by the daemon at `/`: one self-contained page polling /api/state (no build step, no dependency).
export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>porlocal</title>
<style>
  :root { --bg:#f7f7f8; --panel:#fff; --text:#1d1d1f; --muted:#6e6e73; --line:#e3e3e8; --ok:#1a7f37; --warn:#9a6700; --bad:#cf222e; --accent:#0969da; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1115; --panel:#171a21; --text:#e6e6e6; --muted:#9198a1; --line:#2a2f3a; --ok:#3fb950; --warn:#d29922; --bad:#f85149; --accent:#58a6ff; } }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; background:var(--bg); color:var(--text); }
  header { display:flex; align-items:baseline; gap:12px; padding:16px; }
  h1 { font-size:18px; margin:0; } h2 { font-size:14px; margin:0 0 8px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
  main { padding:0 16px 24px; display:grid; gap:16px; }
  section { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px; overflow-x:auto; }
  table { border-collapse:collapse; width:100%; } th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); white-space:nowrap; }
  th { color:var(--muted); font-weight:500; font-size:12px; } td.path { color:var(--muted); font-size:12px; max-width:320px; overflow:hidden; text-overflow:ellipsis; }
  .badge { display:inline-block; padding:1px 8px; border-radius:10px; font-size:12px; border:1px solid currentColor; }
  .ready { color:var(--ok); } .starting { color:var(--warn); } .exited, .stopped { color:var(--muted); } .bad { color:var(--bad); } .warn { color:var(--warn); }
  a { color:var(--accent); } button { font:inherit; font-size:12px; padding:2px 8px; border:1px solid var(--line); background:transparent; color:var(--text); border-radius:6px; cursor:pointer; }
  button:hover { border-color:var(--accent); } .muted { color:var(--muted); } .empty { color:var(--muted); padding:6px 8px; }
  pre { margin:0; max-height:420px; overflow:auto; font:12px/1.4 ui-monospace, Consolas, monospace; white-space:pre-wrap; word-break:break-all; }
</style>
</head>
<body>
<header><h1>porlocal</h1><span id="status" class="muted"></span></header>
<main>
  <section><h2>Processes</h2><div id="processes"></div></section>
  <section id="logbox" hidden><h2 id="logtitle">Logs</h2><pre id="log"></pre></section>
  <section><h2>Leased ports</h2><div id="leases"></div></section>
  <section><h2>Devices</h2><div id="devices"></div></section>
</main>
<script>
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h'; };
let logId = null;
async function call(path, body) {
  const res = await fetch(path, body ? { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json(); if (!res.ok) { alert(data.error); throw new Error(data.error); } return data;
}
function table(head, rows, empty) {
  if (!rows.length) return '<div class="empty">' + empty + '</div>';
  return '<table><tr>' + head.map((h) => '<th>' + h + '</th>').join('') + '</tr>' + rows.map((r) => '<tr>' + r.join('') + '</tr>').join('') + '</table>';
}
function owner(p) {
  if (!p.owner) return '<span class="muted">none</span>';
  const lost = p.ownerLostAt ? ' <span class="bad">gone, stops in ' + Math.max(0, Math.round((p.graceMs - (Date.now() - p.ownerLostAt)) / 1000)) + 's</span>' : '';
  return esc(p.owner.name) + ' <span class="muted">' + p.owner.pid + '</span>' + lost;
}
async function refresh() {
  let s; try { s = await call('/api/state'); } catch { document.getElementById('status').textContent = 'daemon unreachable'; return; }
  document.getElementById('status').textContent = s.processes.filter((p) => p.status === 'ready' || p.status === 'starting').length + ' running, updated ' + new Date().toLocaleTimeString();
  const running = (p) => p.status === 'ready' || p.status === 'starting';
  document.getElementById('processes').innerHTML = table(['Service', 'Port', 'Status', 'Owner', 'PID', 'Up', 'Checkout', ''],
    s.processes.sort((a, b) => a.id.localeCompare(b.id)).map((p) => [
      '<td><b>' + esc(p.id) + '</b>' + (p.needsRestart ? ' <span class="warn" title="a port it reads moved">restart needed</span>' : '') + '</td>',
      '<td><a href="http://localhost:' + p.port + '" target="_blank" rel="noopener">' + p.port + '</a></td>',
      '<td><span class="badge ' + esc(p.status) + '">' + esc(p.status) + (p.exitCode != null && p.status === 'exited' ? ' ' + p.exitCode : '') + '</span>' + (p.stopReason && p.status === 'stopped' ? ' <span class="muted">' + esc(p.stopReason) + '</span>' : '') + '</td>',
      '<td>' + owner(p) + '</td>', '<td>' + p.pid + '</td>', '<td>' + (running(p) ? ago(p.startedAt) : '') + '</td>',
      '<td class="path" title="' + esc(p.workspace) + '">' + esc(p.workspace) + '</td>',
      '<td>' + [['logs', 'logs'], ...(running(p) ? [['restart', 'restart'], ['stop', 'stop'], ...(p.owner ? [['keep', 'keep']] : [])] : [['restart', 'start'], ['forget', 'forget']])]
        .map(([a, label]) => '<button data-act="' + a + '" data-id="' + esc(p.id) + '">' + label + '</button>').join(' ') + '</td>',
    ]), 'Nothing launched yet: <code>porlocal run &lt;service&gt;</code>');
  document.getElementById('leases').innerHTML = table(['Port', 'Service', 'Checkout', 'Declared'],
    s.leases.sort((a, b) => a.port - b.port).map((l) => ['<td>' + l.port + '</td>', '<td>' + esc(l.service) + '</td>', '<td class="path">' + esc(l.workspace) + '</td>',
      '<td>' + (l.preferred == null ? '<span class="muted">dynamic</span>' : l.preferred === l.port ? l.preferred : '<span class="warn">' + l.preferred + ' taken</span>') + '</td>']), 'No lease.');
  document.getElementById('devices').innerHTML = (s.adb ? '' : '<div class="empty bad">adb not found: set ADB to its path.</div>') +
    '<div class="empty">Connected: ' + (s.devices.length ? s.devices.map(esc).join(', ') : 'none') + '</div>' +
    table(['Device', 'Device port', 'Host port', 'Service', 'Checkout'], s.bindings.map((b) => ['<td>' + esc(b.device) + '</td>', '<td>' + b.devicePort + '</td>', '<td>' + (b.hostPort ?? '?') + '</td>',
      '<td>' + esc(b.service) + '</td>', '<td class="path">' + esc(b.workspace) + '</td>']), 'No binding: <code>porlocal device bind &lt;service&gt; --port 3001</code>');
  if (logId) showLog(logId);
}
async function showLog(id) {
  logId = id; const box = document.getElementById('logbox'); box.hidden = false;
  document.getElementById('logtitle').textContent = 'Logs: ' + id;
  const pre = document.getElementById('log'); const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
  pre.textContent = (await call('/api/logs?id=' + encodeURIComponent(id) + '&tail=300')).text;
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  if (b.dataset.act === 'logs') return showLog(b.dataset.id);
  b.disabled = true; try { await call('/api/' + b.dataset.act, { id: b.dataset.id }); } finally { b.disabled = false; refresh(); }
});
refresh(); setInterval(refresh, 2000);
</script>
</body>
</html>
`
