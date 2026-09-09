"""Compose the standalone Leaper search-replay viewer HTML with data inlined."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "rl_artifacts/phase1b_diagnostics/viewer_data.json"
OUT = ROOT / "rl_artifacts/phase1b_diagnostics/leaper_search_viewer.html"

data = DATA.read_text(encoding="utf-8")

HTML = r"""<title>Leaper Search Replay</title>
<style>
  :root{
    --ground:#0e1016; --panel:#161a24; --panel2:#1d2230; --line:#2a3040;
    --ink:#e8ebf2; --muted:#8b93a7; --dim:#5b6376;
    --cyan:#39d0ff; --orange:#ff8b3d; --pink:#ff5aa8;
    --green:#39b36a; --amber:#c47f2c; --rock:#666d7e;
    --good:#39b36a; --bad:#ff6b6b;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--ground); color:var(--ink);
    font-family:ui-monospace,"Cascadia Code","SF Mono",Menlo,Consolas,monospace;
    -webkit-font-smoothing:antialiased; padding:24px; line-height:1.5;
  }
  .wrap{max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
  header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:14px}
  h1{font-size:20px;letter-spacing:.14em;text-transform:uppercase;margin:0;font-weight:700}
  h1 .dot{color:var(--cyan)}
  .sub{color:var(--muted);font-size:12.5px;letter-spacing:.02em}
  .tabs{display:flex;gap:8px;flex-wrap:wrap}
  .tab{background:var(--panel);border:1px solid var(--line);color:var(--muted);
    padding:8px 12px;border-radius:8px;cursor:pointer;font:inherit;font-size:12px;
    display:flex;gap:8px;align-items:center;transition:border-color .15s,color .15s}
  .tab:hover{color:var(--ink)}
  .tab.on{border-color:var(--cyan);color:var(--ink);background:var(--panel2)}
  .tab .r{width:8px;height:8px;border-radius:50%}
  .stage{display:grid;grid-template-columns:minmax(0,1fr) 268px;gap:18px}
  @media(max-width:820px){.stage{grid-template-columns:1fr}}
  .arena{background:#0a0c11;border:1px solid var(--line);border-radius:12px;padding:10px;position:relative}
  canvas{width:100%;height:auto;display:block;border-radius:6px;image-rendering:auto}
  .side{display:flex;flex-direction:column;gap:14px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
  .card h2{margin:0 0 10px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:600}
  .kv{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:3px 0;font-variant-numeric:tabular-nums}
  .kv .k{color:var(--muted)} .kv .v{color:var(--ink)}
  .badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;border:1px solid}
  .b-good{color:var(--good);border-color:color-mix(in srgb,var(--good) 55%,transparent);background:color-mix(in srgb,var(--good) 12%,transparent)}
  .b-bad{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 55%,transparent);background:color-mix(in srgb,var(--bad) 12%,transparent)}
  .b-cyan{color:var(--cyan);border-color:color-mix(in srgb,var(--cyan) 55%,transparent);background:color-mix(in srgb,var(--cyan) 12%,transparent)}
  .controls{display:flex;flex-direction:column;gap:10px}
  .row{display:flex;align-items:center;gap:10px}
  button.ctl{background:var(--panel2);border:1px solid var(--line);color:var(--ink);font:inherit;font-size:13px;
    padding:8px 14px;border-radius:8px;cursor:pointer;transition:border-color .15s}
  button.ctl:hover{border-color:var(--cyan)}
  button.ctl:focus-visible,.tab:focus-visible,input:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
  input[type=range]{flex:1;accent-color:var(--cyan);min-width:80px}
  select{background:var(--panel2);border:1px solid var(--line);color:var(--ink);font:inherit;font-size:12px;padding:6px 8px;border-radius:7px}
  .legend{display:flex;flex-wrap:wrap;gap:10px 16px;font-size:12px;color:var(--muted)}
  .legend span{display:flex;align-items:center;gap:6px}
  .sw{width:12px;height:12px;border-radius:3px;display:inline-block}
  .note{font-size:12px;color:var(--dim);line-height:1.6}
  .framenum{font-variant-numeric:tabular-nums}
</style>

<div class="wrap">
  <header>
    <h1>Leaper<span class="dot">·</span>Search Replay</h1>
    <span class="sub">what the seeker checked, what it missed, and where the frontier note pointed</span>
  </header>

  <div class="tabs" id="tabs"></div>

  <div class="stage">
    <div class="arena">
      <canvas id="cv" width="720" height="720"></canvas>
    </div>
    <div class="side">
      <div class="card">
        <h2>Telemetry</h2>
        <div class="kv"><span class="k">frame</span><span class="v framenum" id="t-frame">0 / 0</span></div>
        <div class="kv"><span class="k">target</span><span class="v" id="t-target">—</span></div>
        <div class="kv"><span class="k">arena checked</span><span class="v" id="t-cov">0%</span></div>
        <div class="kv"><span class="k">frontier note</span><span class="v" id="t-ft">—</span></div>
        <div class="kv"><span class="k">outcome</span><span class="v" id="t-out">—</span></div>
      </div>
      <div class="card controls">
        <h2>Playback</h2>
        <div class="row">
          <button class="ctl" id="play">▶ Play</button>
          <button class="ctl" id="restart">⟲</button>
          <select id="speed" aria-label="speed">
            <option value="0.5">0.5×</option><option value="1" selected>1×</option>
            <option value="2">2×</option><option value="4">4×</option>
          </select>
        </div>
        <input type="range" id="scrub" min="0" max="1" value="0" aria-label="timeline"/>
      </div>
      <div class="card">
        <h2>Legend</h2>
        <div class="legend">
          <span><i class="sw" style="background:var(--green)"></i>checked</span>
          <span><i class="sw" style="background:var(--amber)"></i>blindspot</span>
          <span><i class="sw" style="background:var(--rock)"></i>rock</span>
          <span><i class="sw" style="background:var(--pink)"></i>target</span>
          <span><i class="sw" style="background:var(--orange)"></i>path</span>
          <span><i class="sw" style="background:var(--cyan)"></i>frontier note</span>
        </div>
      </div>
    </div>
  </div>

  <p class="note">
    PPO_33 (frontier model), seed 445774, on fixed exam mazes. Green cells are ground a target
    would have been seen from; amber is unchecked — blindspots, including rock-shadows. The cyan
    marker and dashed line show the frontier destination the note points at (the pink target is
    drawn for you only — the robot never receives its position).
  </p>
</div>

<script id="ep-data" type="application/json">__DATA__</script>
<script>
const EPISODES = JSON.parse(document.getElementById('ep-data').textContent);
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const SIZE = cv.width;
let epi = 0, frame = 0, playing = false, speed = 1, acc = 0, last = 0;
let cover = null, coverBuiltTo = -1;

const css = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
const COL = {green:css('--green'),amber:css('--amber'),rock:css('--rock'),pink:css('--pink'),
  orange:css('--orange'),cyan:css('--cyan'),line:'#232a38'};

function ep(){return EPISODES[epi];}
function W2C(x,z,L){return [ (x+L)/(2*L)*SIZE, SIZE - (z+L)/(2*L)*SIZE ];}

function buildTabs(){
  const t = document.getElementById('tabs');
  EPISODES.forEach((e,i)=>{
    const b=document.createElement('button'); b.className='tab'+(i===0?' on':'');
    const col = e.success?COL.green:COL.pink;
    b.innerHTML=`<span class="r" style="background:${col}"></span>seed ${e.seed} · ${e.label}`;
    b.onclick=()=>{epi=i;frame=0;rebuild();document.querySelectorAll('.tab').forEach((x,j)=>x.classList.toggle('on',j===i));setPlaying(true);};
    t.appendChild(b);
  });
}
function rebuild(){
  const e=ep(); cover=new Uint8Array(e.coverage_steps*e.coverage_steps); coverBuiltTo=-1;
  document.getElementById('scrub').max=e.frames.length-1;
  accumulateTo(frame); draw();
}
function accumulateTo(idx){
  const e=ep();
  if(idx<coverBuiltTo){cover.fill(0);coverBuiltTo=-1;}
  for(let f=coverBuiltTo+1; f<=idx && f<e.frames.length; f++){
    const c=e.frames[f].cov; for(let k=0;k<c.length;k++) cover[c[k]]=1;
  }
  coverBuiltTo=idx;
}

function draw(){
  const e=ep(), L=e.world_limit, steps=e.coverage_steps, cell=e.coverage_cell;
  const px=SIZE/(2*L);
  ctx.fillStyle='#0a0c11'; ctx.fillRect(0,0,SIZE,SIZE);
  // coverage tiles
  const tile=cell*px;
  for(let ix=0;ix<steps;ix++){for(let iz=0;iz<steps;iz++){
    const on=cover[ix*steps+iz];
    ctx.fillStyle=on?COL.green:COL.amber; ctx.globalAlpha=on?0.42:0.30;
    const cx=-L+ix*cell, cz=-L+iz*cell; const [sx,sy]=W2C(cx,cz+cell,L);
    ctx.fillRect(sx, sy, tile*0.96, tile*0.96);
  }}
  ctx.globalAlpha=1;
  // grid lines
  ctx.strokeStyle=COL.line; ctx.lineWidth=1;
  for(let g=0;g<=steps;g++){const p=g/steps*SIZE;
    ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,SIZE);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,p);ctx.lineTo(SIZE,p);ctx.stroke();}
  // obstacles
  for(const o of e.obstacles){const [sx,sy]=W2C(o[0],o[1],L);
    ctx.fillStyle=COL.rock; ctx.beginPath();ctx.arc(sx,sy,o[2]*px,0,7);ctx.fill();}
  const fr=e.frames[frame];
  // path up to now
  ctx.strokeStyle=COL.orange; ctx.lineWidth=2; ctx.globalAlpha=.95; ctx.beginPath();
  for(let f=0;f<=frame;f++){const[sx,sy]=W2C(e.frames[f].x,e.frames[f].z,L);
    if(f===0)ctx.moveTo(sx,sy);else ctx.lineTo(sx,sy);}
  ctx.stroke(); ctx.globalAlpha=1;
  // vision rays
  const fov=e.vision_fov_deg*Math.PI/180, n=e.ray_count, rng=e.ray_max_range;
  const [bx,by]=W2C(fr.x,fr.z,L);
  for(let i=0;i<n;i++){
    const rel=-fov/2+(i+0.5)*fov/n, ang=fr.yaw+rel, read=fr.vision[i]??1;
    const ex=fr.x+Math.sin(ang)*read*rng, ez=fr.z+Math.cos(ang)*read*rng;
    const [sx,sy]=W2C(ex,ez,L);
    const h=Math.round(read*120); ctx.strokeStyle=`hsl(${h} 70% 55%)`;
    ctx.globalAlpha=.5; ctx.lineWidth=1.4; ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(sx,sy);ctx.stroke();
  }
  ctx.globalAlpha=1;
  // frontier note
  if(fr.ft && fr.ft[2]>0.5){const[fx,fy]=W2C(fr.ft[0],fr.ft[1],L);
    ctx.strokeStyle=COL.cyan; ctx.setLineDash([6,5]); ctx.lineWidth=1.6; ctx.globalAlpha=.85;
    ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(fx,fy);ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha=1; ctx.fillStyle=COL.cyan; ctx.beginPath();ctx.arc(fx,fy,5,0,7);ctx.fill();}
  // target (display only)
  const [tx,ty]=W2C(e.target[0],e.target[1],L); const ts=1.4*px;
  ctx.fillStyle=COL.pink; ctx.fillRect(tx-ts,ty-ts,ts*2,ts*2);
  ctx.strokeStyle='#fff';ctx.globalAlpha=.5;ctx.strokeRect(tx-ts,ty-ts,ts*2,ts*2);ctx.globalAlpha=1;
  // leaper body + facing
  ctx.fillStyle='#e8ebf2'; ctx.beginPath();ctx.arc(bx,by,0.9*px,0,7);ctx.fill();
  const hx=Math.sin(fr.yaw),hz=Math.cos(fr.yaw);
  const [nx,ny]=W2C(fr.x+hx*2.4,fr.z+hz*2.4,L);
  ctx.strokeStyle=COL.orange;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(nx,ny);ctx.stroke();
  updatePanel(fr);
}

function updatePanel(fr){
  const e=ep();
  document.getElementById('t-frame').textContent=`${frame} / ${e.frames.length-1}`;
  const tstate = fr.seen?'VISIBLE':(fr.ever?'REMEMBERED · hidden':'NOT DISCOVERED');
  const tcol = fr.seen?'b-good':(fr.ever?'b-cyan':'b-bad');
  document.getElementById('t-target').innerHTML=`<span class="badge ${tcol}">${tstate}</span>`;
  let checked=0; for(let i=0;i<cover.length;i++)checked+=cover[i];
  document.getElementById('t-cov').textContent=Math.round(100*checked/cover.length)+'%';
  if(fr.ft && fr.ft[2]>0.5){
    const d=Math.hypot(fr.ft[0]-fr.x, fr.ft[1]-fr.z);
    document.getElementById('t-ft').textContent=`→ (${fr.ft[0].toFixed(0)}, ${fr.ft[1].toFixed(0)})  ${d.toFixed(0)}u`;
  } else document.getElementById('t-ft').textContent='none valid';
  const ok=e.success;
  document.getElementById('t-out').innerHTML=
    `<span class="badge ${ok?'b-good':'b-bad'}">${ok?'REACHED':(e.detected?'DETECTED, MISSED':'NEVER FOUND')}</span>`;
  document.getElementById('scrub').value=frame;
}

function setPlaying(p){playing=p;document.getElementById('play').textContent=p?'❚❚ Pause':'▶ Play';}
document.getElementById('play').onclick=()=>setPlaying(!playing);
document.getElementById('restart').onclick=()=>{frame=0;accumulateTo(0);draw();setPlaying(true);};
document.getElementById('speed').onchange=e=>speed=parseFloat(e.target.value);
document.getElementById('scrub').oninput=e=>{setPlaying(false);frame=parseInt(e.target.value);accumulateTo(frame);draw();};

const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
function loop(ts){
  if(playing){const dt=(ts-last)/1000; acc+=dt*30*speed;
    while(acc>=1){ if(frame<ep().frames.length-1){frame++;accumulateTo(frame);} else {setPlaying(false);} acc-=1; }
    draw();
  }
  last=ts; requestAnimationFrame(loop);
}
buildTabs(); rebuild(); setPlaying(!reduce);
requestAnimationFrame(t=>{last=t;requestAnimationFrame(loop);});
</script>
"""

OUT.write_text(HTML.replace("__DATA__", data), encoding="utf-8")
kb = OUT.stat().st_size / 1024
print(f"wrote {OUT} ({kb:.0f} KB)")
