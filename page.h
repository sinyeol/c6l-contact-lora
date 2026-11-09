#pragma once
// 수신기가 태블릿에 주는 상태 페이지. /s 를 300ms 마다 읽어 25칸을 제자리에서 갱신한다.
const char PAGE[] = R"html(<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>접점 상태</title>
<style>
:root{color-scheme:dark;--bg:#111418;--tile:#1c2128;--line:#2d333b;--fg:#e6edf3;--mut:#8b949e;--on:#238636;--warn:#d29922}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.3 system-ui,sans-serif}
header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px}
h1{font-size:18px;margin:0}
#g{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:0 16px 16px}
@media (max-width:700px){#g{grid-template-columns:repeat(3,1fr)}}
.t{background:var(--tile);border:1px solid var(--line);border-radius:10px;padding:10px;min-width:0}
.t.off{opacity:.45}
.h{display:flex;justify-content:space-between;align-items:baseline;gap:6px}
.h b{font-size:22px}
.m{color:var(--mut);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p{display:flex;gap:6px;align-items:center;margin-top:6px;padding:6px 8px;border-radius:6px;background:#0d1117}
.p.on{background:var(--on);color:#fff}
.v{font-weight:700}
.c{margin-left:auto;font-size:13px;opacity:.8}
#st.bad{color:var(--warn)}
</style></head><body>
<header><h1>접점 상태</h1><span id="st">연결 중…</span></header>
<main id="g"></main>
<script>
const N=25,OFF=75,g=document.getElementById('g'),st=document.getElementById('st'),tiles=[];
for(let i=1;i<=N;i++){
  const t=document.createElement('div');t.className='t off';
  t.innerHTML=`<div class="h"><b>${String(i).padStart(2,'0')}</b><span class="m">대기</span></div>`+
    [1,2].map(k=>`<div class="p"><span>접점${k}</span><span class="v">-</span><span class="c"></span></div>`).join('');
  g.append(t);tiles.push(t);
}
const ago=s=>s<60?s+'초':s<3600?Math.floor(s/60)+'분':Math.floor(s/3600)+'시간';
async function tick(){
  try{
    const d=await (await fetch('/s',{cache:'no-store'})).json();
    let on=0;
    d.forEach((n,i)=>{
      const t=tiles[i],live=!!n&&n.a<OFF;on+=live;
      t.classList.toggle('off',!live);
      t.querySelector('.m').textContent=!n?'대기':live?`${n.a}초 전 · ${n.r}dBm`:`끊김 ${ago(n.a)}`;
      t.querySelectorAll('.p').forEach((p,k)=>{
        const c=!!n&&(n.b>>k&1)===1;
        p.classList.toggle('on',c);
        p.querySelector('.v').textContent=!n?'-':c?'ON':'OFF';
        p.querySelector('.c').textContent=n?'×'+n['c'+(k+1)]:'';
      });
    });
    st.textContent=`연결 ${on}/${N}`;st.className='';
  }catch(e){st.textContent='수신기 연결 끊김';st.className='bad'}
  setTimeout(tick,300);
}
tick();
</script></body></html>)html";
