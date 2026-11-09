// 단일 진실: 파라미터 → 배치(L) → 검사(warn) → CSG 트리(bodies/refs). DOM 없음(node 로도 돈다).
// 브라우저는 manifold 로, Fusion 스크립트(C6LCaseBuild.py)는 TemporaryBRepManager 로 같은 트리를 계산한다.
// 좌표(mm): X=길이(+X 오른쪽), Y=깊이(+Y 뒤), Z=위. 안쪽 바닥 앞-왼쪽 모서리가 원점.
// 아래층 = 배터리(바닥에 눕힘), 위층 = 뚜껑 밑에 매단 C6L(뒤 줄, OLED 위) + 버튼 PCB(앞 줄).
// 트리 노드: {t:'box',p:[x0,y0,z0,x1,y1,z1]} | {t:'cyl',a:[x,y,z],b:[x,y,z],r1,r2} | {t:'add'|'sub'|'and',c:[…]} (sub = c[0] − 나머지)

// Unit C6L (docs.m5stack.com U202 Model Size: 24×56×8, SMA 포함 62) — 위치는 Grove 끝 기준
export const C6L = { L: 56, W: 24, T: 8, SMA_DX: 7, SMA_LEN: 6, USB: 20.3, LEGO: 12, LEGO_DX: 8,
  OLED: 34.4, OLED_WX: 12, OLED_WY: 16, UBTN: 22.3, UBTN_WX: 9, UBTN_WY: 15 };
// 3버튼 PCB (첨부 도면 66.04×22.352, 구멍 간격 59.944×16.764). 키 X 는 도면 비례 측정(피치 20.32)
export const PCB = { L: 66.04, W: 22.352, T: 1.6, HX: (66.04 - 59.944) / 2, HY: (22.352 - 16.764) / 2,
  KEYS: [12.70, 33.02, 53.34], KEY_FROM_TOP: 12.5 };

// [그룹, 키, 라벨, min, max, step, 단위, 기본값]
export const DEFS = [
  ['케이스', 'WALL', '벽 두께', 1.2, 4, 0.1, 'mm', 2],
  ['케이스', 'FLOOR', '바닥 두께', 1.2, 4, 0.1, 'mm', 2],
  ['케이스', 'LID_T', '뚜껑 두께', 1.2, 4, 0.1, 'mm', 2],
  ['케이스', 'R_OUT', '바깥 모서리 R', 0.5, 10, 0.5, 'mm', 4],
  ['케이스', 'CLR', '부품 여유(한 면)', 0, 2, 0.1, 'mm', 0.5],
  ['배터리', 'BAT_L', '길이', 40, 130, 0.5, 'mm', 88],
  ['배터리', 'BAT_W', '폭', 30, 90, 0.5, 'mm', 56],
  ['배터리', 'BAT_T', '두께', 3, 25, 0.5, 'mm', 9],
  ['배터리', 'BAT_GAP', '배터리 위 틈(폼테이프)', 0, 5, 0.5, 'mm', 1],
  ['배터리', 'BAT_PORT_W', '충전구 폭 (0 = 없음, +X 벽)', 0, 30, 0.5, 'mm', 12],
  ['배터리', 'BAT_PORT_H', '충전구 높이', 2, 15, 0.5, 'mm', 6],
  ['배터리', 'BAT_PORT_Y', '충전구 위치(가운데 기준)', -30, 30, 0.5, 'mm', 0],
  ['C6L', 'SMA_FROM_FRONT', 'SMA 중심 ~ 앞면(OLED)', 2, 6, 0.1, 'mm', 5],
  ['C6L', 'SMA_HOLE_D', 'SMA 홈 지름', 6.4, 8, 0.1, 'mm', 6.8],
  ['C6L', 'SMA_SPOT_D', '바깥 자리파기 지름', 8, 13, 0.5, 'mm', 11],
  ['C6L', 'SMA_WALL', 'SMA 자리 벽 두께', 0.8, 4, 0.1, 'mm', 1.2],
  ['C6L', 'USB_W', 'USB-C 구멍 폭', 9, 16, 0.5, 'mm', 13],
  ['C6L', 'USB_H', 'USB-C 구멍 높이', 4, 9, 0.5, 'mm', 7.5],
  ['C6L', 'PIN_D', '레고 핀 지름(구멍 Ø5)', 4.4, 5, 0.05, 'mm', 4.8],
  ['C6L', 'PIN_LEN', '레고 핀 길이', 2, 8, 0.5, 'mm', 6],
  ['C6L', 'GROVE_CLR', 'Grove 플러그 자리', 0, 25, 1, 'mm', 10],
  ['버튼 PCB', 'SW_H', '택트 스위치 높이(PCB~스템 끝)', 4, 15, 0.1, 'mm', 7.3],
  ['버튼 PCB', 'BTN_HOLE_D', '뚜껑 버튼 구멍', 3, 14, 0.5, 'mm', 8],
  ['버튼 PCB', 'BTN_PROUD', '스템이 뚜껑 위로 나옴', -2, 4, 0.1, 'mm', 0.5],
  ['버튼 PCB', 'UNDER_PCB', 'PCB 밑 리드 여유', 0, 6, 0.5, 'mm', 2.5],
  ['버튼 PCB', 'PCB_Y', '앞 벽 ~ PCB', 0, 10, 0.5, 'mm', 1],
  ['나사', 'BOSS_D', '뚜껑 보스 지름', 5, 10, 0.5, 'mm', 7],
  ['나사', 'BOSS_PILOT_DEPTH', '보스 나사 구멍 깊이', 4, 12, 0.5, 'mm', 7],
  ['나사', 'LID_HOLE_D', '뚜껑 나사 구멍', 2, 4, 0.1, 'mm', 3.4],
  ['나사', 'PILOT_D', '셀프태핑 구멍(M3)', 1.8, 3, 0.1, 'mm', 2.5],
  ['나사', 'STANDOFF_D', 'PCB 기둥 지름', 4, 8, 0.5, 'mm', 6],
];
export const defaults = () => Object.fromEntries(DEFS.map(d => [d[1], d[7]]));

export function layout(P) {
  const L = { IX: P.BAT_L + 2 * P.CLR, IY: P.BAT_W + 2 * P.CLR };
  L.PCB_GAP = P.SW_H - P.LID_T - P.BTN_PROUD;            // 뚜껑 밑면 ~ PCB 윗면
  L.ZB = P.BAT_T + P.BAT_GAP;                            // 위층 바닥
  L.IH = L.ZB + Math.max(C6L.T, L.PCB_GAP + PCB.T + P.UNDER_PCB) + 0.5;
  const { IX, IY, IH } = L;
  // C6L: SMA 끝이 -X 벽, 뒤(+Y) 벽에 붙임 → USB 가 뒤 벽을 본다
  const cx0 = P.CLR, cy0 = IY - P.CLR - C6L.W, cy = cy0 + C6L.W / 2, gx = cx0 + C6L.L;
  Object.assign(L, { c6l: [cx0, cy0, gx, cy0 + C6L.W], c6l_cy: cy, grove_x: gx,
    sma: [-1, 1].map(s => [cy + s * C6L.SMA_DX, IH - P.SMA_FROM_FRONT]),
    usb_x: gx - C6L.USB,
    pins: [-1, 1].map(s => [gx - C6L.LEGO, cy + s * C6L.LEGO_DX]),
    oled: [gx - C6L.OLED, cy, C6L.OLED_WX, C6L.OLED_WY], ubtn: [gx - C6L.UBTN, cy, C6L.UBTN_WX, C6L.UBTN_WY] });
  // PCB: 앞 줄 가운데, 헤더 쪽이 뒤(+Y)
  const px0 = (IX - PCB.L) / 2, py0 = P.PCB_Y;
  L.pcb = [px0, py0, px0 + PCB.L, py0 + PCB.W];
  L.keys = PCB.KEYS.map(k => [px0 + k, py0 + PCB.W - PCB.KEY_FROM_TOP]);
  L.stand = [PCB.HX, PCB.L - PCB.HX].flatMap(x => [PCB.HY, PCB.W - PCB.HY].map(y => [px0 + x, py0 + y]));
  // 뚜껑 나사 보스: 세 모서리 + C6L 이 막은 뒤-왼쪽 대신 왼쪽 벽(PCB 와 C6L 사이)
  const r = P.BOSS_D / 2;
  L.boss = [[r, r], [IX - r, r], [IX - r, IY - r], [r, cy0 - P.CLR - r]];
  L.outer = [IX + 2 * P.WALL, IY + 2 * P.WALL, IH + P.FLOOR + P.LID_T];
  return L;
}

const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const sq = (c, d) => [c[0] - d / 2, c[1] - d / 2, c[0] + d / 2, c[1] + d / 2];
const win = w => [w[0] - w[2] / 2, w[1] - w[3] / 2, w[0] + w[2] / 2, w[1] + w[3] / 2];

export function check(P, L) {
  const W = [], err = m => W.push(['error', m]), warn = m => W.push(['warn', m]);
  if (L.PCB_GAP < 3.5) err(`PCB 가 뚜껑에 너무 붙음(${L.PCB_GAP.toFixed(1)}mm) — 스위치 몸통이 뚜껑에 닿는다. 스위치 높이·돌출을 확인`);
  const c6lZone = [L.c6l[0], L.c6l[1], L.grove_x + P.GROVE_CLR, L.c6l[3]];
  for (const [n, r] of [['C6L+Grove', c6lZone], ['버튼 PCB', L.pcb]])
    if (r[0] < 0 || r[1] < 0 || r[2] > L.IX || r[3] > L.IY) err(`${n} 가 안쪽을 벗어남 — 배터리 치수(안쪽 크기)를 키울 것`);
  if (overlap(c6lZone, L.pcb)) err('C6L 과 버튼 PCB 가 겹침 — 배터리 폭(안쪽 깊이)이 부족');
  L.boss.forEach((b, i) => { for (const r of [c6lZone, L.pcb]) if (overlap(sq(b, P.BOSS_D), r)) err(`뚜껑 보스 ${i + 1} 이 부품과 겹침`); });
  for (const k of L.keys) for (const s of L.stand)
    if (Math.hypot(k[0] - s[0], k[1] - s[1]) <= (P.BTN_HOLE_D + P.STANDOFF_D) / 2) { err('버튼 구멍이 PCB 기둥과 겹침 — 구멍·기둥 지름을 줄일 것'); break; }
  if (overlap(win(L.oled), win(L.ubtn))) err('OLED 창과 C6L 버튼 창이 겹침');
  if (2 * C6L.SMA_DX <= P.SMA_SPOT_D) err('SMA 자리파기 두 개가 서로 겹침');
  const thread = C6L.SMA_LEN - P.CLR - P.SMA_WALL;
  if (thread < 4) warn(`SMA 나사가 벽 밖으로 ${thread.toFixed(1)}mm 만 나옴 — 안테나가 덜 물릴 수 있다(4mm 이상 권장)`);
  if (P.SMA_WALL > P.WALL) warn('SMA 자리 벽이 벽 두께보다 두꺼움 — 자리파기 효과 없음');
  if (P.BAT_PORT_W && Math.abs(P.BAT_PORT_Y) + P.BAT_PORT_W / 2 > L.IY / 2) err('충전구가 벽 밖으로 벗어남');
  if (P.BAT_PORT_W && P.BAT_PORT_H > P.BAT_T + P.BAT_GAP) warn('충전구 높이가 배터리 층보다 큼');
  if (P.BOSS_PILOT_DEPTH > L.IH - L.ZB) warn('보스 나사 구멍이 보스 바닥을 뚫음');
  if (P.PIN_LEN > C6L.T) warn('레고 핀이 C6L 두께(8mm)보다 김');
  W.push(['info', '배터리 치수는 가정값(신용카드 크기 보조배터리) — 실물로 바꿀 것']);
  W.push(['info', 'C6L Grove 신호 핀은 G4·G5 둘 — 키 3개 중 하나는 다른 입력이 필요']);
  return W;
}

// ---- CSG 트리 ----
const box = (x0, y0, z0, x1, y1, z1) => ({ t: 'box', p: [x0, y0, z0, x1, y1, z1] });
const cyl = (a, b, r1, r2 = r1) => ({ t: 'cyl', a, b, r1, r2 });
const add = (...c) => ({ t: 'add', c }), sub = (...c) => ({ t: 'sub', c }), and = (...c) => ({ t: 'and', c });
const rbox = (x0, y0, z0, x1, y1, z1, r) => add(box(x0 + r, y0, z0, x1 - r, y1, z1), box(x0, y0 + r, z0, x1, y1 - r, z1),
  ...[x0 + r, x1 - r].flatMap(x => [y0 + r, y1 - r].map(y => cyl([x, y, z0], [x, y, z1], r))));

export function model(P) {
  const L = layout(P), warn = check(P, L);
  const { IX, IY, IH, ZB } = L, W = P.WALL, r = P.BOSS_D / 2, ri = Math.max(P.R_OUT - W, 0.3);

  // 보스: 원기둥+45° 원뿔(출력 시 받침 없이)을 벽 쪽으로 밀어 겹쳐 벽에 붙이고, 안쪽 공간으로 잘라낸다
  const bosses = L.boss.map(([bx, by]) => {
    const dx = bx < IX / 2 ? -r : r, dy = by < r + 0.01 ? -r : by > IY - r - 0.01 ? r : 0;
    const offs = [[0, 0], [dx, 0], ...(dy ? [[0, dy], [dx, dy]] : [])];
    return and(add(...offs.flatMap(([ox, oy]) => {
      const x = bx + ox, y = by + oy;
      return [cyl([x, y, ZB + r], [x, y, IH], r), cyl([x, y, ZB], [x, y, ZB + r], 0.1, r)];
    })), box(0, 0, 0, IX, IY, IH));
  });
  const cuts = [rbox(0, 0, 0, IX, IY, IH + 1, ri)];
  const baseTools = [
    ...L.boss.map(([x, y]) => cyl([x, y, IH - P.BOSS_PILOT_DEPTH], [x, y, IH + 1], P.PILOT_D / 2)),
    ...L.sma.flatMap(([sy, sz]) => [            // -X 벽: 위가 열린 U 홈 + 바깥 자리파기
      cyl([-W - 1, sy, sz], [1, sy, sz], P.SMA_HOLE_D / 2),
      box(-W - 1, sy - P.SMA_HOLE_D / 2, sz, 1, sy + P.SMA_HOLE_D / 2, IH + 1),
      ...(P.SMA_WALL < W ? [cyl([-W - 1, sy, sz], [-P.SMA_WALL, sy, sz], P.SMA_SPOT_D / 2),
        box(-W - 1, sy - P.SMA_SPOT_D / 2, sz, -P.SMA_WALL, sy + P.SMA_SPOT_D / 2, IH + 1)] : [])]),
    box(L.usb_x - P.USB_W / 2, IY - 1, IH - C6L.T / 2 - P.USB_H / 2, L.usb_x + P.USB_W / 2, IY + W + 1, IH + 1),
  ];
  if (P.BAT_PORT_W) {
    const py = IY / 2 + P.BAT_PORT_Y;
    baseTools.push(box(IX - 1, py - P.BAT_PORT_W / 2, P.BAT_T / 2 - P.BAT_PORT_H / 2, IX + W + 1, py + P.BAT_PORT_W / 2, P.BAT_T / 2 + P.BAT_PORT_H / 2));
  }
  const base = sub(add(sub(rbox(-W, -W, -P.FLOOR, IX + W, IY + W, IH, P.R_OUT), ...cuts), ...bosses), ...baseTools);

  // 뚜껑: 조립 위치(z=IH 위). 출력은 뒤집어서
  const g = L.PCB_GAP, pin = P.PIN_D / 2;
  const lid = sub(add(rbox(-W, -W, IH, IX + W, IY + W, IH + P.LID_T, P.R_OUT),
      ...L.pins.flatMap(([x, y]) => [cyl([x, y, IH - P.PIN_LEN + 0.6], [x, y, IH], pin), cyl([x, y, IH - P.PIN_LEN], [x, y, IH - P.PIN_LEN + 0.6], pin - 0.5, pin)]),
      ...L.stand.map(([x, y]) => cyl([x, y, IH - g], [x, y, IH], P.STANDOFF_D / 2))),
    ...L.stand.map(([x, y]) => cyl([x, y, IH - g - 1], [x, y, IH + P.LID_T - 0.8], P.PILOT_D / 2)),
    ...[L.oled, L.ubtn].map(([x, y, wx, wy]) => box(x - wx / 2, y - wy / 2, IH - 1, x + wx / 2, y + wy / 2, IH + P.LID_T + 1)),
    ...L.keys.map(([x, y]) => cyl([x, y, IH - 1], [x, y, IH + P.LID_T + 1], P.BTN_HOLE_D / 2)),
    ...L.boss.map(([x, y]) => cyl([x, y, IH - 1], [x, y, IH + P.LID_T + 1], P.LID_HOLE_D / 2)));

  // 맞춤 확인용 부품 (출력 안 함)
  const c = L.c6l, p = L.pcb, pz = IH - g - PCB.T;
  const refs = {
    REF_battery: box(P.CLR, P.CLR, 0, P.CLR + P.BAT_L, P.CLR + P.BAT_W, P.BAT_T),
    REF_C6L: add(box(c[0], c[1], IH - C6L.T, c[2], c[3], IH), ...L.sma.map(([sy, sz]) => cyl([c[0], sy, sz], [c[0] - C6L.SMA_LEN, sy, sz], 3.2))),
    REF_buttonPCB: add(box(p[0], p[1], pz, p[2], p[3], pz + PCB.T),
      ...L.keys.map(([x, y]) => box(x - 6, y - 6, pz + PCB.T, x + 6, y + 6, pz + PCB.T + 3.5)),
      ...L.keys.map(([x, y]) => cyl([x, y, pz + PCB.T], [x, y, pz + PCB.T + P.SW_H], 1.75))),
  };
  return { L, warn, bodies: { Base: base, Lid: lid }, refs };
}

// case.json: 파라미터 + 트리. Fusion 스크립트가 이것만 읽는다
export const caseJson = P => { const m = model(P); return { version: 1, params: P, layout: m.L, bodies: m.bodies, refs: m.refs }; };
