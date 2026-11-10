// 진입점 — 슬라이더·드래그 → core.model → manifold 메시 → 3D·SVG·표. 사이드바는 처음 한 번만 그린다(스크롤·포커스 유지).
import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { DEFS, defaults, model, layout, caseJson, C6L, PCB, USBC } from './core.js';
import { initCsg, meshOf, stl } from './csg.js';

const KEY = 'c6lcase.params.v2';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n1 = v => (+v).toFixed(1).replace(/\.0$/, '');
const banner = msg => { $('banner').textContent = msg || ''; $('banner').hidden = !msg; };
const DEF = Object.fromEntries(DEFS.map(d => [d[1], d]));
const clamp = (k, v) => Math.min(DEF[k][4], Math.max(DEF[k][3], v));

function loadParams() {
  const P = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(KEY)) ?? {};
    for (const k in P) if (Number.isFinite(s[k])) P[k] = clamp(k, s[k]);
  } catch {}
  return P;
}
let P = loadParams(), cur = null;
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch {} };

// ---- 사이드바 ----
// 위치 항목 → 가운데 정렬 축(안쪽 공간 기준). C6L 은 SMA 가 벽에 붙어 있어 Y 만
const CENTER = { C6L_Y: 'y', PCB_CX: 'x', PCB_CY: 'y', USBC_CX: 'x', USBC_CY: 'y' };
function buildControls() {
  let h = '';
  for (const g of [...new Set(DEFS.map(d => d[0]))]) {
    h += `<fieldset><legend>${esc(g)}</legend>`;
    for (const [, key, label, min, max, step, unit, , opts] of DEFS.filter(d => d[0] === g))
      if (opts) h += `<div class="sel-row"><label for="n-${key}">${esc(label)}</label><select id="n-${key}" data-key="${key}">${opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></div>`;
      else h += `<div class="row"><label for="n-${key}">${esc(label)} <span style="color:var(--mute)">${esc(unit)}</span>${CENTER[key] ? `<button type="button" class="ctr" data-center="${key}">${CENTER[key].toUpperCase()} 가운데</button>` : ''}</label>`
        + `<input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" aria-label="${esc(label)}">`
        + `<input type="number" id="n-${key}" data-key="${key}" min="${min}" max="${max}" step="${step}"></div>`;
    h += '</fieldset>';
  }
  $('controls').innerHTML = h;
  $('controls').addEventListener('click', e => {
    const k = e.target.dataset?.center;
    if (!k) return;
    const L = layout(P);
    P[k] = clamp(k, CENTER[k] === 'x' ? L.IX / 2 : L.IY / 2);
    syncControls([k]); persist(); schedule();
  });
  $('controls').addEventListener('input', e => {
    const k = e.target.dataset.key, v = parseFloat(e.target.value);
    if (!k || !Number.isFinite(v)) return;
    P[k] = v;
    for (const el of $('controls').querySelectorAll(`[data-key="${k}"]`)) if (el !== e.target) el.value = v;
    persist(); schedule();
  });
}
const syncControls = (keys = Object.keys(P)) => { for (const k of keys) for (const el of $('controls').querySelectorAll(`[data-key="${k}"]`)) el.value = P[k]; };

// ---- 3D ----
const LIFT = { Lid: 1, REF_C6L: 1, REF_buttonPCB: 1, Cover: -1, REF_battery: -1 };   // 분해 방향(C6L·PCB 는 뚜껑, 배터리는 바닥과 함께)
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
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const ghost = color => new THREE.MeshStandardMaterial({ color, transparent: true, opacity: .5, depthWrite: false });
  const mats = {
    Lid: new THREE.MeshStandardMaterial({ color: css('--lid'), roughness: .6 }),
    Body: new THREE.MeshStandardMaterial({ color: css('--base'), roughness: .6 }),
    Cover: new THREE.MeshStandardMaterial({ color: css('--lidb'), roughness: .6 }),
    REF_battery: ghost(0x8a8378), REF_C6L: ghost(0x3d4652), REF_buttonPCB: ghost(0x2e7d4f), REF_usbc: ghost(0x9a9a9a), REF_antLoRa: ghost(0x2f7fd0), REF_antWiFi: ghost(0xc0392b),
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
    prune(keep) { for (const n of Object.keys(groups)) if (!keep.includes(n)) { scene.remove(groups[n]); groups[n].traverse(o => o.geometry?.dispose()); delete groups[n]; } },
    show(on, lift) {
      for (const [n, g] of Object.entries(groups)) { g.visible = on(n); g.position.z = (LIFT[n] ?? 0) * lift; }
      paint();
    },
    fit(L) {
      if (fitted) return; fitted = true;
      const [ox, oy, oz] = L.outer, c = new THREE.Vector3(L.IX / 2, L.IY / 2, oz / 2 - 3), d = Math.max(ox, oy) * 1.7;
      controls.target.copy(c); camera.position.set(c.x - d * .55, c.y - d * .95, c.z + d * .8); controls.update();
    },
  };
}
let v3;
const layerOn = n => n.startsWith('REF') ? $('ly-ref').checked : $('ly-' + n.toLowerCase()).checked;
const show3d = () => { $('lift-n').textContent = $('lift').value; v3?.show(layerOn, +$('lift').value); };

// ---- 2D ----
function topSvg(L) {
  const W = P.WALL, [ox, oy] = L.outer, pad = 12, fy = y => L.IY + W - y;        // SVG y 는 아래로 → 뒤집기
  const rect = (r, cls, extra = '') => `<rect class="${cls}" x="${r[0]}" y="${fy(r[3])}" width="${r[2] - r[0]}" height="${r[3] - r[1]}" ${extra}/>`;
  const circ = (c, d, cls) => `<circle class="${cls}" cx="${c[0]}" cy="${fy(c[1])}" r="${d / 2}"/>`;
  const lbl = (x, y, t) => `<text class="lbl" x="${x}" y="${fy(y) + 1}">${esc(t)}</text>`;
  const ri = Math.max(P.R_OUT - W, 0.3), c = L.c6l, u = L.usbc;
  let s = `<svg viewBox="${-W - pad} ${-pad} ${ox + 2 * pad} ${oy + 2 * pad + 8}" role="img" aria-label="평면도">`;
  s += `<path class="wall" d="${rr(-W, -W, L.IX + W, L.IY + W, P.R_OUT, fy)} ${rr(0, 0, L.IX, L.IY, ri, fy)}"/>`;
  s += rect(L.bat, 'part bat') + lbl((L.bat[0] + L.bat[2]) / 2, L.bat[1] + 3, '배터리(격판 밑)');
  for (const cc of L.cols) s += circ(cc, P.COL_D, 'boss') + circ(cc, P.MAG_D, 'mag');
  for (const r of L.stops) s += rect(r, 'boss');
  for (const [x, y] of L.ribs) s += circ([x, y], 3, 'boss');
  for (const p of L.c6lPads) s += circ(p, P.C6L_PAD_D, 'boss');       // 격판 누름 받침(C6L 밑)
  if (u.mode === 0) s += `<g data-drag="usbc">${rect(u.flange, 'part usb')}${rect(u.slot, 'cut')}${u.holes.map(h => circ(h, 1.8, 'boss')).join('')}${lbl(u.c[0], u.flange[1] - 3.5, 'USB-C')}</g>`;
  if (u.mode === 2) {
    const r = u.cable, rr2 = Math.min(r[2] - r[0], r[3] - r[1]) / 2;
    s += `<g data-drag="usbc">${rect(r, 'part usb', `rx="${rr2}"`)}${lbl(u.c[0], r[1] - 3.5, '케이블 구멍')}</g>` + rect(L.plug, 'zone') + lbl(L.c6lUsb[0], L.plug[3] + 1, '플러그');
  }
  s += `<g data-drag="c6l">${rect([c[2], c[1], c[2] + P.GROVE_CLR, c[3]], 'zone')}${rect(c, 'part c6l', 'rx="3"')}`
    + L.sma.map(([sy]) => rect([c[0] - C6L.SMA_LEN, sy - 3.2, c[0], sy + 3.2], 'part c6l')).join('')
    + lbl((c[0] + c[2]) / 2 + 8, c[3] - 3, 'C6L') + '</g>';
  s += `<g data-drag="pcb">${rect(L.pcb, 'part pcb')}${L.keysAll.map(k => rect([k[0] - 6, k[1] - 6, k[0] + 6, k[1] + 6], 'part sw')).join('')}`
    + L.stand.map(st => circ(st, P.STANDOFF_D, 'boss')).join('') + circ(L.pcbHdr, 2.4, 'mag') + lbl((L.pcb[0] + L.pcb[2]) / 2, (L.pcb[1] + L.pcb[3]) / 2 - 1, '버튼 PCB') + '</g>';
  // 뚜껑 구멍(빨강 점선) — 드래그를 가리지 않게 pointer-events 없음(.cut)
  const [mx, my] = L.oled, wx = P.OLED_WX / 2, wy = P.OLED_WY / 2, o = L.maskOff;
  s += rect([mx - wx - o, my - wy - o, mx + wx + o, my + wy + o], 'zone') + rect([mx - wx, my - wy, mx + wx, my + wy], 'cut');
  s += circ(L.ubtn, P.UBTN_D, 'cut');
  for (const k of L.keys) s += circ(k, P.BTN_HOLE_D, 'cut');
  for (const b of L.cols) s += circ(b, P.LID_CB_D, 'cut');
  for (const p of L.pins) s += circ(p, P.PIN_D, 'cut');
  for (const [sy] of L.sma) s += rect([-W, sy - P.ANT_D / 2, -P.SMA_WALL, sy + P.ANT_D / 2], 'cut');
  s += P.JOINT === 1 ? circ(L.pull, P.NOTCH_R * 2, 'cut') + lbl(L.pull[0], L.pull[1] + P.NOTCH_R + 3, '손가락 구멍(바닥)')
    : rect([L.IX / 2 - P.NOTCH_R, -W - 0.3, L.IX / 2 + P.NOTCH_R, -0.8], 'cut') + lbl(L.IX / 2, -W - 4, '손가락 홈(바닥)');
  s += lbl(mx, my + wy + o + 1.5, 'OLED') + lbl(-W - 5, L.sma[1][0] + 6, '안테나');
  s += dimH(-W, L.IX + W, -10, fy, `${n1(ox)}`) + '</svg>';
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
  const W = P.WALL, [ox, , oz] = L.outer, pad = 10, top = L.IH + P.LID_T, fz = z => top - z, { IX, IH, ZS, ZD0, ZD1 } = L;
  const rect = (x0, z0, x1, z1, cls) => `<rect class="${cls}" x="${x0}" y="${fz(z1)}" width="${x1 - x0}" height="${z1 - z0}"/>`;
  let s = `<svg viewBox="${-W - pad - 6} ${-pad} ${ox + 2 * pad + 6} ${oz + 2 * pad}" role="img" aria-label="단면도">`;
  // 끼움형: 옆벽은 통이 바닥~윗면 전부, 뚜껑·바닥은 통 구멍에 끼우는 판(틈 FIT). 적층형: 높이 ZS·IH 로 나눔
  const J = P.JOINT === 1, e0 = J ? P.FIT : -W, e1 = J ? IX - P.FIT : IX + W;
  s += J ? rect(e0, -P.FLOOR, e1, 0, 'cover') + rect(-W, -P.FLOOR, 0, top, 'wall') + rect(IX, -P.FLOOR, IX + W, top, 'wall')
    : rect(-W, -P.FLOOR, IX + W, 0, 'cover') + rect(-W, 0, 0, ZS, 'cover') + rect(IX, 0, IX + W, ZS, 'cover') + rect(-W, ZS, 0, IH, 'wall') + rect(IX, ZS, IX + W, IH, 'wall');
  s += rect(0, ZD0, IX, ZD1, 'wall');
  for (const [x] of [L.cols[0], L.cols[1]]) s += rect(x - P.COL_D / 2, 0, x + P.COL_D / 2, ZS, 'cover') + rect(x - P.COL_D / 2, ZS, x + P.COL_D / 2, IH, 'boss')
    + rect(x - P.MAG_D / 2, ZS - P.MAG_T, x + P.MAG_D / 2, ZS + P.MAG_T, 'mag') + rect(x - P.INS3_HOLE / 2, IH - P.INS3_L, x + P.INS3_HOLE / 2, IH, 'mag');
  // 뚜껑: OLED 자리는 MASK_T 로 얇게
  const [mx] = L.oled, wx = P.OLED_WX / 2, o = L.maskOff;
  s += `<path class="lidp" d="M${e0},${fz(IH)} H${mx - wx} V${fz(IH + P.MASK_T)} L${mx - wx - o},${fz(top)} H${e0} Z M${mx + wx},${fz(IH)} H${e1} V${fz(top)} H${mx + wx + o} L${mx + wx},${fz(IH + P.MASK_T)} Z"/>`;
  s += rect(L.bat[0], 0, L.bat[2], P.BAT_T, 'part bat');
  const c = L.c6l, p = L.pcb, pz = IH - L.PCB_GAP - PCB.T, u = L.usbc;
  for (const [x] of L.c6lPads) s += rect(x - P.C6L_PAD_D / 2, ZD1, x + P.C6L_PAD_D / 2, IH - C6L.T + P.C6L_PRESS, 'boss');
  s += rect(c[0], IH - C6L.T, c[2], IH, 'part c6l') + rect(c[0] - C6L.SMA_LEN, L.sma[0][1] - 3.2, c[0], L.sma[0][1] + 3.2, 'part c6l');
  s += rect(p[0], pz, p[2], pz + PCB.T, 'part pcb');
  for (const [x] of L.keysAll) s += rect(x - 6, pz + PCB.T, x + 6, pz + PCB.T + 3.5, 'part sw') + rect(x - 1.75, pz + PCB.T, x + 1.75, pz + PCB.T + P.SW_H, 'part sw');
  for (const [x] of L.stand) s += rect(x - P.STANDOFF_D / 2, IH - L.PCB_GAP, x + P.STANDOFF_D / 2, IH, 'boss');
  if (u.mode === 0) s += rect(u.flange[0], ZD0 - USBC.FT, u.flange[2], ZD0, 'part usb') + rect(u.body[0], ZD0, u.body[2], ZD0 - USBC.FT + USBC.BODY_L, 'part usb');
  if (u.mode === 2) s += rect(u.cable[0], ZD0, u.cable[2], ZD1, 'cut');
  s += `<g class="dim"><line x1="${-W - 5}" y1="${fz(-P.FLOOR)}" x2="${-W - 5}" y2="${fz(top)}"/><text x="${-W - 7}" y="${fz(oz / 2 - P.FLOOR)}" style="font-size:3.6px" transform="rotate(-90 ${-W - 7} ${fz(oz / 2 - P.FLOOR)})">${n1(oz)} mm</text></g>`;
  return s + '</svg>';
}

function tables(m, meshes) {
  const L = m.L, row = (...v) => `<tr>${v.map((x, i) => `<td${i ? ' class="n"' : ''}>${x}</td>`).join('')}</tr>`;
  const vol = n => meshes ? (meshes[n].volume / 1000).toFixed(1) : '…';
  $('t-summary').innerHTML = '<table>'
    + row('바깥 (가로×깊이×높이)', L.outer.map(n1).join(' × ') + ' mm')
    + row('전자부 안쪽 높이', n1(L.IH - L.ZD1) + ' mm')
    + row('배터리 칸 높이', n1(L.ZD0) + ' mm')
    + row('뚜껑 밑 ~ PCB 윗면', n1(L.PCB_GAP) + ' mm')
    + row('출력 부피 뚜껑 / 통 / 바닥', `${vol('Lid')} / ${vol('Body')} / ${vol('Cover')} cm³`)
    + '</table>';
  const ins = (d, l, hole) => `M${d} 열삽입 인서트 L${n1(l)} <small>(구멍 Ø${n1(hole)})</small>`;
  $('t-parts').innerHTML = '<table><tr><th>자리</th><th>부품</th><th class="n">수량</th></tr>'
    + row('뚜껑 ↔ 통 (모서리 기둥 위)', `${ins(3, P.INS3_L, P.INS3_HOLE)} + M3×${L.bolts.lid} 소켓 볼트`, 4)
    + row('버튼 PCB ↔ 뚜껑 기둥', `${ins(3, P.INS3S_L, P.INS3_HOLE)} + M3×${L.bolts.pcb} 볼트`, 4)
    + (L.usbc.mode === 0 ? row('USB-C 커넥터 ↔ 격판 밑', `${ins(2, P.INS2_L, P.INS2_HOLE)} + M2×${L.bolts.usbc} 볼트`, 2) : '')
    + row('바닥 ↔ 통 (기둥 아래)', `네오디뮴 자석 Ø${n1(P.MAG_D)}×${n1(P.MAG_T)} <small>(통·바닥 각 4, 극 맞춰 순간접착)</small>`, 8)
    + row('C6L ↔ 뚜껑', '레고 핀(뚜껑에 일체) — 볼트 없음', 2)
    + '</table>';
  $('t-warn').innerHTML = m.warn.length ? `<table><tr><th>수준</th><th>내용</th></tr>${m.warn.map(([lv, t]) => `<tr class="w-${lv}"><td class="lv ${lv}">${lv}</td><td>${esc(t)}</td></tr>`).join('')}</table>`
    : '<div class="empty lv ok">문제 없음</div>';
}

// ---- 재계산: 2D·표는 바로, 3D(manifold)는 입력이 멈춘 뒤 ----
let timer = 0, ready = false;
function draw2d() {
  const m = model(P);
  $('v-top').innerHTML = topSvg(m.L);
  $('v-sec').innerHTML = secSvg(m.L);
  tables(m, cur?.meshes);
  return m;
}
const schedule = () => { draw2d(); clearTimeout(timer); timer = setTimeout(rebuild, 150); };
function rebuild() {
  const m = model(P);
  let meshes = null;
  if (ready) {
    const t0 = performance.now();
    try {
      meshes = {};
      const all = [...Object.entries(m.bodies), ...Object.entries(m.refs)];
      for (const [n, node] of all) { meshes[n] = meshOf(node); v3.set(n, meshes[n]); }
      v3.prune(all.map(([n]) => n));
      v3.fit(m.L); show3d();
      $('status').textContent = `계산 ${Math.round(performance.now() - t0)} ms`;
      banner('');
    } catch (e) { banner('형상 계산 실패: ' + e.message); meshes = null; }
  }
  cur = { m, meshes };
  draw2d();
}

// ---- 평면도 드래그 (C6L 은 SMA 가 벽에 붙어 있어야 해서 Y 만) ----
const DRAG = { c6l: [null, 'C6L_Y'], pcb: ['PCB_CX', 'PCB_CY'], usbc: ['USBC_CX', 'USBC_CY'] };
let drag = null;
const svgPt = e => { const svg = $('v-top').querySelector('svg'), pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse()); return [pt.x, -pt.y]; };
$('v-top').addEventListener('pointerdown', e => {
  const g = e.target.closest('[data-drag]');
  if (!g) return;
  const [kx, ky] = DRAG[g.dataset.drag];
  drag = { kx, ky, p0: svgPt(e), v0: [P[kx], P[ky]] };
  $('v-top').setPointerCapture(e.pointerId);       // 컨테이너에 잡는다(SVG 는 매번 새로 그려진다)
  e.preventDefault();
});
$('v-top').addEventListener('pointermove', e => {
  if (!drag) return;
  const [x, y] = svgPt(e), snap = v => Math.round(v * 2) / 2;
  if (drag.kx) P[drag.kx] = clamp(drag.kx, snap(drag.v0[0] + x - drag.p0[0]));
  P[drag.ky] = clamp(drag.ky, snap(drag.v0[1] + y - drag.p0[1]));
  syncControls([drag.kx, drag.ky].filter(Boolean));
  schedule();
});
const endDrag = () => { if (drag) { drag = null; persist(); } };
$('v-top').addEventListener('pointerup', endDrag);
$('v-top').addEventListener('pointercancel', endDrag);

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('btn-reset').onclick = () => { P = defaults(); persist(); syncControls(); rebuild(); };
$('btn-json').onclick = () => download('c6l-case.json', JSON.stringify(caseJson(P), null, 1), 'application/json');
for (const n of ['Lid', 'Body', 'Cover'])     // 뚜껑은 X축 180°(윗면이 바닥), 통은 격판이 바닥에 오도록 그대로
  $('btn-stl-' + n).onclick = () => cur?.meshes && download(`c6l_case_${n.toLowerCase()}.stl`, stl(cur.meshes[n], n === 'Lid' ? (x, y, z) => [x, -y, -z] : undefined), 'model/stl');
for (const id of ['ly-lid', 'ly-body', 'ly-cover', 'ly-ref', 'lift']) $(id).addEventListener('input', show3d);

buildControls(); syncControls();
$('status').textContent = '형상 엔진 불러오는 중…';
draw2d();
try {
  v3 = createView($('v-3d'));
  await initCsg();
  ready = true;
  rebuild();
} catch (e) { banner('3D 를 시작하지 못했습니다: ' + e.message); }
