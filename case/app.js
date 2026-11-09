// 진입점 — 슬라이더 → core.model → manifold 메시 → 3D·SVG·표. 사이드바는 처음 한 번만 그린다(스크롤·포커스 유지).
import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { DEFS, defaults, model, caseJson, C6L, PCB } from './core.js';
import { initCsg, meshOf, stl } from './csg.js';

const KEY = 'c6lcase.params.v1';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n1 = v => (+v).toFixed(1).replace(/\.0$/, '');
const banner = msg => { $('banner').textContent = msg || ''; $('banner').hidden = !msg; };

function loadParams() {
  const P = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(KEY)) ?? {};
    for (const d of DEFS) if (Number.isFinite(s[d[1]])) P[d[1]] = Math.min(d[4], Math.max(d[3], s[d[1]]));
  } catch {}
  return P;
}
let P = loadParams(), cur = null;
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch {} };

// ---- 사이드바 ----
function buildControls() {
  let h = '';
  for (const g of [...new Set(DEFS.map(d => d[0]))]) {
    h += `<fieldset><legend>${esc(g)}</legend>`;
    for (const [, key, label, min, max, step, unit] of DEFS.filter(d => d[0] === g))
      h += `<div class="row"><label for="n-${key}">${esc(label)} <span style="color:var(--mute)">${esc(unit)}</span></label>`
        + `<input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" aria-label="${esc(label)}">`
        + `<input type="number" id="n-${key}" data-key="${key}" min="${min}" max="${max}" step="${step}"></div>`;
    h += '</fieldset>';
  }
  $('controls').innerHTML = h;
  $('controls').addEventListener('input', e => {
    const k = e.target.dataset.key, v = parseFloat(e.target.value);
    if (!k || !Number.isFinite(v)) return;
    P[k] = v;
    for (const el of $('controls').querySelectorAll(`[data-key="${k}"]`)) if (el !== e.target) el.value = v;
    persist(); schedule();
  });
}
const syncControls = () => { for (const el of $('controls').querySelectorAll('input[data-key]')) el.value = P[el.dataset.key]; };

// ---- 3D ----
function createView(el) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0xf4f2ee);
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
  camera.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8378, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-80, -120, 200); scene.add(key);
  const controls = new OrbitControls(camera, renderer.domElement);
  const paint = () => renderer.render(scene, camera);
  controls.addEventListener('change', paint);
  const css = getComputedStyle(document.documentElement);
  const mats = {
    Base: new THREE.MeshStandardMaterial({ color: css.getPropertyValue('--base').trim(), roughness: .6 }),
    Lid: new THREE.MeshStandardMaterial({ color: css.getPropertyValue('--lid').trim(), roughness: .6 }),
    REF_battery: new THREE.MeshStandardMaterial({ color: 0x8a8378, transparent: true, opacity: .3, depthWrite: false }),
    REF_C6L: new THREE.MeshStandardMaterial({ color: 0x3d4652, transparent: true, opacity: .55, depthWrite: false }),
    REF_buttonPCB: new THREE.MeshStandardMaterial({ color: 0x2e7d4f, transparent: true, opacity: .55, depthWrite: false }),
  };
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: .45 });
  const groups = {};
  let fitted = false;
  const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); paint(); };
  new ResizeObserver(resize).observe(el);
  return {
    set(name, mesh) {
      if (groups[name]) { scene.remove(groups[name]); groups[name].traverse(o => o.geometry?.dispose()); }
      let geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(mesh.pos, 3));
      geo.setIndex(new THREE.BufferAttribute(mesh.idx, 1));
      const g = new THREE.Group();
      if (!name.startsWith('REF')) g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat));
      geo = geo.toNonIndexed(); geo.computeVertexNormals();     // 면별 법선(각진 면이 또렷하게)
      g.add(new THREE.Mesh(geo, mats[name]));
      groups[name] = g; scene.add(g);
    },
    show(fn, lift) {
      for (const [n, g] of Object.entries(groups)) { g.visible = fn(n); g.position.z = n === 'Base' || n === 'REF_battery' ? 0 : lift; }   // C6L·PCB 는 뚜껑에 매달려 같이 뜬다
      paint();
    },
    fit(L) {
      if (fitted) return; fitted = true;
      const [ox, oy, oz] = L.outer, c = new THREE.Vector3(L.IX / 2, L.IY / 2, oz / 2 - 2), d = Math.max(ox, oy) * 1.9;
      controls.target.copy(c); camera.position.set(c.x - d * .55, c.y - d * .95, c.z + d * .8); controls.update();
    },
  };
}
let v3;
const layerOn = n => n === 'Base' ? $('ly-base').checked : n === 'Lid' ? $('ly-lid').checked : $('ly-ref').checked;
const show3d = () => { $('lift-n').textContent = $('lift').value; v3?.show(layerOn, +$('lift').value); };

// ---- 2D ----
const W2 = () => P.WALL;
function topSvg(L) {
  const W = W2(), [ox, oy] = L.outer, pad = 12, fy = y => L.IY + W - y;        // SVG y 는 아래로 → 뒤집기
  const rect = (r, cls, extra = '') => `<rect class="${cls}" x="${r[0]}" y="${fy(r[3])}" width="${r[2] - r[0]}" height="${r[3] - r[1]}" ${extra}/>`;
  const circ = (c, d, cls) => `<circle class="${cls}" cx="${c[0]}" cy="${fy(c[1])}" r="${d / 2}"/>`;
  const win = ([x, y, wx, wy]) => [x - wx / 2, y - wy / 2, x + wx / 2, y + wy / 2];
  const ri = Math.max(P.R_OUT - W, 0.3);
  let s = `<svg viewBox="${-W - pad} ${-pad} ${ox + 2 * pad} ${oy + 2 * pad + 8}" role="img" aria-label="평면도">`;
  s += `<path class="wall" d="${rr(-W, -W, L.IX + W, L.IY + W, P.R_OUT, fy)} ${rr(0, 0, L.IX, L.IY, ri, fy)}"/>`;
  s += rect([P.CLR, P.CLR, P.CLR + P.BAT_L, P.CLR + P.BAT_W], 'part bat');
  const c = L.c6l;
  s += rect([c[2], c[1], c[2] + P.GROVE_CLR, c[3]], 'zone');
  s += rect(c, 'part c6l', 'rx="3"');
  for (const [sy] of L.sma) s += rect([c[0] - C6L.SMA_LEN, sy - 3.2, c[0], sy + 3.2], 'part c6l');
  s += rect(L.pcb, 'part pcb');
  for (const k of L.keys) s += rect([k[0] - 6, k[1] - 6, k[0] + 6, k[1] + 6], 'part sw');
  for (const st of L.stand) s += circ(st, P.STANDOFF_D, 'boss');
  for (const b of L.boss) s += circ(b, P.BOSS_D, 'boss');
  // 뚜껑 구멍(빨강 점선)
  for (const w of [L.oled, L.ubtn]) s += rect(win(w), 'cut');
  for (const k of L.keys) s += circ(k, P.BTN_HOLE_D, 'cut');
  for (const b of L.boss) s += circ(b, P.LID_HOLE_D, 'cut');
  for (const p of L.pins) s += circ(p, P.PIN_D, 'cut');
  // 벽 구멍
  s += rect([L.usb_x - P.USB_W / 2, L.IY - 0.2, L.usb_x + P.USB_W / 2, L.IY + W + 0.2], 'cut');
  if (P.BAT_PORT_W) { const py = L.IY / 2 + P.BAT_PORT_Y; s += rect([L.IX - 0.2, py - P.BAT_PORT_W / 2, L.IX + W + 0.2, py + P.BAT_PORT_W / 2], 'cut'); }
  const lbl = (x, y, t) => `<text class="lbl" x="${x}" y="${fy(y) + 1}">${esc(t)}</text>`;
  s += lbl((c[0] + c[2]) / 2, c[3] - 3, 'C6L') + lbl(L.oled[0], L.oled[1], 'OLED') + lbl(L.ubtn[0], L.ubtn[1] - 9, '버튼')
    + lbl((L.pcb[0] + L.pcb[2]) / 2, L.pcb[3] - 2.5, '버튼 PCB') + lbl(L.usb_x, L.IY + W + 4, 'USB-C')
    + lbl(c[2] + P.GROVE_CLR / 2, c[1] - 3, 'Grove') + lbl(-W - 5, L.sma[1][0] + 5, 'SMA');
  s += dimH(-W, L.IX + W, -6, fy, `${n1(ox)}`) + '</svg>';
  return s;
}
// 둥근 사각형 path (fy 로 뒤집음)
function rr(x0, y0, x1, y1, r, fy) {
  return `M${x0 + r},${fy(y0)} H${x1 - r} A${r},${r} 0 0 0 ${x1},${fy(y0 + r)} V${fy(y1 - r)} A${r},${r} 0 0 0 ${x1 - r},${fy(y1)} H${x0 + r} A${r},${r} 0 0 0 ${x0},${fy(y1 - r)} V${fy(y0 + r)} A${r},${r} 0 0 0 ${x0 + r},${fy(y0)} Z`;
}
function dimH(x0, x1, y, fy, t) {
  const Y = fy(y);
  return `<g class="dim"><line x1="${x0}" y1="${Y}" x2="${x1}" y2="${Y}"/><text x="${(x0 + x1) / 2}" y="${Y + 4.5}" style="font-size:3.6px">${esc(t)} mm</text></g>`;
}
function secSvg(L) {
  const W = W2(), [ox, , oz] = L.outer, pad = 10, fz = z => L.IH + P.LID_T - z, { IX, IH } = L;
  const rect = (x0, z0, x1, z1, cls) => `<rect class="${cls}" x="${x0}" y="${fz(z1)}" width="${x1 - x0}" height="${z1 - z0}"/>`;
  let s = `<svg viewBox="${-W - pad - 6} ${-pad} ${ox + 2 * pad + 6} ${oz + 2 * pad}" role="img" aria-label="단면도">`;
  s += rect(-W, -P.FLOOR, IX + W, 0, 'wall') + rect(-W, 0, 0, IH, 'wall') + rect(IX, 0, IX + W, IH, 'wall');
  s += rect(-W, IH, IX + W, IH + P.LID_T, 'lidp');
  s += rect(P.CLR, 0, P.CLR + P.BAT_L, P.BAT_T, 'part bat');
  const c = L.c6l, p = L.pcb, pz = IH - L.PCB_GAP - PCB.T;
  s += rect(c[0], IH - C6L.T, c[2], IH, 'part c6l') + rect(c[0] - C6L.SMA_LEN, L.sma[0][1] - 3.2, c[0], L.sma[0][1] + 3.2, 'part c6l');
  s += rect(p[0], pz, p[2], pz + PCB.T, 'part pcb');
  for (const [x] of L.keys) s += rect(x - 6, pz + PCB.T, x + 6, pz + PCB.T + 3.5, 'part sw') + rect(x - 1.75, pz + PCB.T, x + 1.75, pz + PCB.T + P.SW_H, 'part sw');
  for (const [x] of L.stand) s += rect(x - P.STANDOFF_D / 2, IH - L.PCB_GAP, x + P.STANDOFF_D / 2, IH, 'boss');
  s += `<g class="dim"><line x1="${-W - 5}" y1="${fz(-P.FLOOR)}" x2="${-W - 5}" y2="${fz(IH + P.LID_T)}"/><text x="${-W - 7}" y="${fz(oz / 2 - P.FLOOR)}" style="font-size:3.6px" transform="rotate(-90 ${-W - 7} ${fz(oz / 2 - P.FLOOR)})">${n1(oz)} mm</text></g>`;
  return s + '</svg>';
}

function tables(m, meshes) {
  const L = m.L, row = (k, v) => `<tr><td>${esc(k)}</td><td class="n">${v}</td></tr>`;
  $('t-summary').innerHTML = '<table>'
    + row('바깥 (가로×깊이×높이)', L.outer.map(n1).join(' × ') + ' mm')
    + row('안쪽', [L.IX, L.IY, L.IH].map(n1).join(' × ') + ' mm')
    + row('뚜껑 밑 ~ PCB 윗면', n1(L.PCB_GAP) + ' mm')
    + (meshes ? row('출력 부피 통 / 뚜껑', `${(meshes.Base.volume / 1000).toFixed(1)} / ${(meshes.Lid.volume / 1000).toFixed(1)} cm³`) : '')
    + row('뚜껑 나사', 'M3×8 셀프태핑 4개')
    + row('PCB 나사', `M3×${Math.round(PCB.T + L.PCB_GAP - 1)} 셀프태핑 4개`)
    + '</table>';
  $('t-warn').innerHTML = `<table><tr><th>수준</th><th>내용</th></tr>${m.warn.map(([lv, t]) => `<tr class="w-${lv}"><td class="lv ${lv}">${lv}</td><td>${esc(t)}</td></tr>`).join('')}</table>`;
}

// ---- 재계산 ----
let timer = 0, ready = false;
const schedule = () => { clearTimeout(timer); timer = setTimeout(rebuild, 120); };
function rebuild() {
  const m = model(P);
  $('v-top').innerHTML = topSvg(m.L);
  $('v-sec').innerHTML = secSvg(m.L);
  let meshes = null;
  if (ready) {
    const t0 = performance.now();
    try {
      meshes = {};
      for (const [n, node] of [...Object.entries(m.bodies), ...Object.entries(m.refs)]) { meshes[n] = meshOf(node); v3.set(n, meshes[n]); }
      v3.fit(m.L); show3d();
      $('status').textContent = `계산 ${Math.round(performance.now() - t0)} ms`;
      banner('');
    } catch (e) { banner('형상 계산 실패: ' + e.message); meshes = null; }
  }
  cur = { m, meshes };
  tables(m, meshes);
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('btn-reset').onclick = () => { P = defaults(); persist(); syncControls(); rebuild(); };
$('btn-json').onclick = () => download('c6l-case.json', JSON.stringify(caseJson(P), null, 1), 'application/json');
$('btn-stl-base').onclick = () => cur?.meshes && download('c6l_case_base.stl', stl(cur.meshes.Base), 'model/stl');
$('btn-stl-lid').onclick = () => cur?.meshes && download('c6l_case_lid.stl', stl(cur.meshes.Lid, (x, y, z) => [x, -y, -z]), 'model/stl');   // X축 180° = 윗면이 바닥
for (const id of ['ly-base', 'ly-lid', 'ly-ref', 'lift']) $(id).addEventListener('input', show3d);

buildControls(); syncControls();
$('status').textContent = '형상 엔진 불러오는 중…';
rebuild();
try {
  v3 = createView($('v-3d'));
  await initCsg();
  ready = true;
  rebuild();
} catch (e) { banner('3D 를 시작하지 못했습니다: ' + e.message); }
