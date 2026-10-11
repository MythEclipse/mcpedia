// Self-contained observability dashboard HTML (Phase 8).
// A single static HTML string with zero build-time dependencies. The page
// reads /metrics (same origin) and queries the MCP /mcp endpoint directly.
// All KB-sourced fields are esc() escaped for defense-in-depth (data is
// server-trusted, but we never pass unsanitized strings to innerHTML).

// XSS note: this dashboard consumes only same-origin server data
// (/metrics + MCP results). The esc() calls on slug/title/section/error are
// defense-in-depth; no user-supplied free text reaches innerHTML.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MCPedia — Dashboard</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--fg:#e6edf3;--muted:#8b949e;--accent:#58a6ff;--ok:#3fb950;--err:#f85149}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);color:var(--fg)}
header{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
header h1{font-size:16px;margin:0;font-weight:600}header .dot{width:9px;height:9px;border-radius:50%;background:var(--ok)}
main{padding:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;align-items:start}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px}
.card h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 10px}
.metric{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--border)}
.metric:last-child{border-bottom:0}.metric b{color:var(--accent)}
.search{grid-column:1/-1}.search input{width:100%;padding:10px;background:#0d1117;border:1px solid var(--border);border-radius:8px;color:var(--fg);font:inherit}
.result{margin-top:10px}.hit{padding:8px 0;border-bottom:1px solid var(--border)}
.hit a{color:var(--accent);text-decoration:none}.hit span{color:var(--muted)}
.err{color:var(--err)}.pill{display:inline-block;padding:1px 7px;border-radius:999px;background:#21262d;border:1px solid var(--border);color:var(--muted);font-size:11px}
</style></head>
<body>
<header><span class="dot" id="live"></span><h1>MCPedia Dashboard</h1><span class="pill" id="uptime"></span></header>
<main>
  <section class="card"><h2>Index Queue (BullMQ)</h2><div id="queue"></div></section>
  <section class="card"><h2>Service</h2><div id="svc"></div></section>
  <section class="card search"><h2>Search the knowledge base (via MCP)</h2>
    <input id="q" placeholder="type a query, e.g. 'cloudflare 525 tls' and press Enter" autocomplete="off"/>
    <div class="result" id="results"></div>
  </section>
</main>
<script>
const MCP="/mcp";
const esc=s=>String(s).replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
function getMetric(t,name){const m=t.match(new RegExp(name+"\\\\s+([0-9.]+)"));return m?m[1]:'?';}
async function loadMetrics(){try{const t=await(await fetch("/metrics")).text();
  document.getElementById("uptime").textContent="up "+getMetric(t,"mcpedia_uptime_seconds")+"s";
  const states=["waiting","active","completed","failed","delayed"];
  document.getElementById("queue").innerHTML=states.map(s=>
    '<div class="metric"><span>'+s+'</span><b>'+getMetric(t,'mcpedia_queue_jobs{state="'+s+'"}')+'</b></div>').join("");
  document.getElementById("svc").innerHTML='<div class="metric"><span>metrics</span><b>live</b></div><div class="metric"><span>mcp</span><b>'+MCP+'</b></div>';
  document.getElementById("live").style.background="var(--ok)";
}catch(e){document.getElementById("live").style.background="var(--err)";document.getElementById("queue").innerHTML='<div class="err">metrics fetch failed: '+esc(e.message)+'</div>';}}
async function mcpCall(m,p){const r=await fetch(MCP,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})});
  const raw=await r.text();const ev=raw.split("\\n").find(l=>l.startsWith("data: "));
  if(!ev)throw new Error("no SSE data");return JSON.parse(ev.slice(6)).result;}
async function search(q){const el=document.getElementById("results");el.innerHTML='<span class="muted">searching…</span>';
  try{await mcpCall("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"dashboard",version:"1"}});
  const r=await mcpCall("tools/call",{name:"hybrid_search",arguments:{query:q,limit:8}});
  const hits=JSON.parse(r.content[0].text);
  if(!hits.length){el.innerHTML='<span class="muted">no results</span>';return;}
  el.innerHTML=hits.map(h=>'<div class="hit"><a href="/'+esc(h.doc.slug)+'" target="_blank">'+esc(h.doc.title||h.doc.slug)+'</a><span>'+esc(h.doc.section||'')+(h.rank!=null?' · rank '+h.rank.toFixed(3):'')+'</span></div>').join("");
}catch(e){el.innerHTML='<div class="err">search failed: '+esc(e.message)+'</div>';}}
document.getElementById("q").addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.value.trim())search(e.target.value.trim())});
loadMetrics();setInterval(loadMetrics,5000);
</script></body></html>`
