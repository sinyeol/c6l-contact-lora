// 단일 진실: 파라미터 → 배치(L) → 검사(warn) → CSG 트리(bodies/refs). DOM 없음(node 로도 돈다).
// 브라우저는 manifold 로, Fusion 스크립트(C6LCaseBuild.py)는 TemporaryBRepManager 로 같은 트리를 계산한다.
// 좌표(mm): X=길이(+X 오른쪽), Y=깊이(+Y 뒤), Z=위. 바닥판 윗면(배터리가 놓이는 면)의 앞-왼쪽 안쪽 모서리가 원점.
// 부품 3개: Lid(뚜껑, C6L·버튼 PCB 를 밑에 매단다) / Body(벽 + 가운데 격판, 위 칸 = 전자부, 아래 칸 = 배터리)
//          / Cover(자석 바닥 — 떼어 배터리를 넣고 뺀다). 뚜껑-통은 모서리 기둥의 M3 열삽입 인서트로 볼트 체결.
// 트리 노드: {t:'box',p:[x0,y0,z0,x1,y1,z1]} | {t:'cyl',a,b,r1,r2} | {t:'frustum',c:[x,y],z0,z1,w0:[wx,wy],off} | {t:'torus',c:[x,y,z],R,r,a0} (Z축, a0° 부터 90°) | {t:'rslab',p,R,rt,rb} (둥근 외피)
//          | {t:'add'|'sub'|'and',c:[…]} (sub = c[0] − 나머지). frustum = z0 에서 w0, z1 에서 사방 off 만큼 넓어지는 사각뿔대

// Unit C6L (docs.m5stack.com U202 Model Size: 24×56×8, SMA 포함 62) — 위치는 Grove 끝 기준
export const C6L = { L: 56, W: 24, T: 8, SMA_DX: 7, SMA_LEN: 6, USB: 20.3, LEGO: 12, LEGO_DX: 8, OLED: 34.4, UBTN: 22.3 };
// 3버튼 PCB (첨부 도면 66.04×22.352, 구멍 간격 59.944×16.764). 키 X 는 도면 비례 측정(피치 20.32)
export const PCB = { L: 66.04, W: 22.352, T: 1.6, HX: (66.04 - 59.944) / 2, HY: (22.352 - 16.764) / 2,
  KEYS: [12.70, 33.02, 53.34], KEY_FROM_TOP: 12.5 };
// 패널형 USB-C (JRC-C009, 사진 치수: 플랜지 20×7, 몸통 폭 9). 구멍 간격·두께는 사진 비례 추정
export const USBC = { FL: 20, FH: 7, FT: 1, HOLE_P: 16.5, BODY_L: 5.3, BODY_W: 9, BODY_T: 3.6 };
export const M3_CLEAR = 3.4;
const RIB_R = 1.5;   // 배터리 누름 리브 끝 반지름

// [그룹, 키, 라벨, min, max, step, 단위, 기본값, (선택지 [[값, 라벨]…] — 있으면 셀렉트)]
export const DEFS = [
  ['케이스', 'WALL', '벽 두께', 1.6, 4, 0.1, 'mm', 2.4],
  ['케이스', 'LID_T', '뚜껑 두께', 2, 5, 0.1, 'mm', 3],
  ['케이스', 'DIV_T', '가운데 격판 두께', 1.2, 4, 0.1, 'mm', 2],
  ['케이스', 'FLOOR', '바닥판 두께', 1.2, 5, 0.1, 'mm', 2],
  ['케이스', 'R_OUT', '세로 모서리 R', 0.5, 20, 0.5, 'mm', 7],
  ['케이스', 'TOP_R', '윗면 테두리 R (그립, 세로 R 보다 작게)', 0, 10, 0.5, 'mm', 3.5],
  ['케이스', 'BOT_R', '아랫면 테두리 R (그립, 세로 R 보다 작게)', 0, 10, 0.5, 'mm', 3.5],
  ['케이스', 'CLR', '부품 여유(한 면)', 0, 2, 0.1, 'mm', 0.5],
  ['배터리·바닥', 'BAT_L', '배터리 길이', 40, 140, 0.5, 'mm', 99],
  ['배터리·바닥', 'BAT_W', '배터리 폭', 30, 100, 0.5, 'mm', 65],
  ['배터리·바닥', 'BAT_T', '배터리 두께', 3, 30, 0.5, 'mm', 12],
  ['배터리·바닥', 'BAT_GAP', '배터리 위 틈', 0, 5, 0.5, 'mm', 1],
  ['배터리·바닥', 'CABLE_BAY', '+X 쪽 케이블 자리', 0, 40, 0.5, 'mm', 16],
  ['배터리·바닥', 'EXTRA_Y', '안쪽 깊이 추가(Y, PCB 세로 배치용)', 0, 40, 0.5, 'mm', 0],
  ['배터리·바닥', 'SEAM_H', '바닥 벽 높이 (낮을수록 배터리를 통이 잡는다, 최대 = 격판 밑까지)', 0, 40, 0.5, 'mm', 4],
  ['배터리·바닥', 'RIB_PRESS', '배터리 누름 리브 조임 (0 = 없음)', 0, 1, 0.05, 'mm', 0.3],
  ['배터리·바닥', 'COL_D', '모서리 기둥 지름', 7, 14, 0.5, 'mm', 9.5],
  ['배터리·바닥', 'MAG_D', '자석 지름', 3, 10, 0.5, 'mm', 6],
  ['배터리·바닥', 'MAG_T', '자석 두께', 1, 5, 0.5, 'mm', 3],
  ['배터리·바닥', 'NOTCH_R', '손가락 홈 반지름', 3, 12, 0.5, 'mm', 7],
  ['C6L', 'C6L_Y', '위치 Y (중심, 드래그)', 0, 120, 0.5, 'mm', 44.5],
  ['C6L', 'OLED_WX', 'OLED 창 X(길이 방향)', 8, 16, 0.5, 'mm', 11],
  ['C6L', 'OLED_WY', 'OLED 창 Y', 10, 20, 0.5, 'mm', 15],
  ['C6L', 'MASK_T', 'OLED 둘레 두께', 0.6, 3, 0.1, 'mm', 1],
  ['C6L', 'MASK_SLOPE', 'OLED 마스크 경사(수평 기준)', 20, 80, 1, '°', 45],
  ['C6L', 'UBTN_D', 'C6L 버튼 구멍(드라이버)', 2, 6, 0.5, 'mm', 3],
  ['C6L', 'SMA_FROM_FRONT', 'SMA 중심 ~ 앞면(OLED)', 2, 6, 0.1, 'mm', 5],
  ['C6L', 'SMA_HOLE_D', 'SMA 홈 지름', 6.4, 8, 0.1, 'mm', 6.8],
  ['C6L', 'ANT_D', '안테나 지름(바깥 파기)', 6, 14, 0.5, 'mm', 10],
  ['C6L', 'SMA_WALL', '안테나 자리 벽 두께', 0.6, 3, 0.1, 'mm', 1],
  ['C6L', 'PIN_D', '레고 핀 지름(구멍 Ø5, 출력 공차에 맞춰)', 4.4, 5.2, 0.05, 'mm', 4.9],
  ['C6L', 'PIN_LEN', '레고 핀 길이', 2, 8, 0.5, 'mm', 6],
  ['C6L', 'GROVE_CLR', 'Grove 플러그 자리', 0, 25, 1, 'mm', 10],
  ['C6L', 'C6L_PRESS', '누름 받침 눌림량(뚜껑 닫으면 C6L 을 누름)', 0, 1.5, 0.05, 'mm', 0.3],
  ['C6L', 'C6L_PAD_D', '누름 받침 지름', 3, 10, 0.5, 'mm', 6],
  ['버튼 PCB', 'PCB_CX', '위치 X (중심, 드래그)', 0, 200, 0.5, 'mm', 62.5],
  ['버튼 PCB', 'PCB_CY', '위치 Y (중심, 드래그)', 0, 120, 0.5, 'mm', 12],
  ['버튼 PCB', 'PCB_ROT', '회전', 0, 270, 90, '', 0, [[0, '0° (헤더 뒤)'], [90, '90°'], [180, '180° (헤더 앞)'], [270, '270°']]],
  ['버튼 PCB', 'MID_KEY', '가운데 버튼 구멍', 0, 1, 1, '', 0, [[0, '없음 (KEY1·KEY3 만)'], [1, '있음']]],
  ['버튼 PCB', 'SW_H', '택트 스위치 높이(PCB~스템 끝)', 4, 15, 0.1, 'mm', 7.3],
  ['버튼 PCB', 'BTN_HOLE_D', '뚜껑 버튼 구멍', 3, 14, 0.5, 'mm', 8],
  ['버튼 PCB', 'BTN_PROUD', '스템이 뚜껑 위로 나옴', -2, 4, 0.1, 'mm', 0.5],
  ['버튼 PCB', 'UNDER_PCB', 'PCB 밑 리드 여유', 0, 6, 0.5, 'mm', 2.5],
  ['버튼 PCB', 'STANDOFF_D', 'PCB 기둥 지름(인서트)', 6, 10, 0.5, 'mm', 8],
  ['USB-C 전원', 'USB_MODE', '배터리 → C6L 전원 경로', 0, 2, 1, '', 0, [[0, '격판에 패널형 USB-C 커넥터'], [2, '격판 구멍 — 배터리 케이블을 C6L 에 바로'], [1, '없음']]],
  ['USB-C 전원', 'USBC_CX', '위치 X (중심, 드래그)', 0, 200, 0.5, 'mm', 117.5],
  ['USB-C 전원', 'USBC_CY', '위치 Y (중심, 드래그)', 0, 120, 0.5, 'mm', 33],
  ['USB-C 전원', 'USBC_ROT', '방향', 0, 90, 90, '', 90, [[0, '길게 X'], [90, '길게 Y']]],
  ['USB-C 전원', 'USBC_SLOT_W', '커넥터: 격판 구멍 길이(몸통 9)', 9, 12, 0.1, 'mm', 9.6],
  ['USB-C 전원', 'USBC_SLOT_T', '커넥터: 격판 구멍 폭(몸통 두께)', 3, 6, 0.1, 'mm', 4.2],
  ['USB-C 전원', 'CBL_L', '케이블 구멍 길이(플러그 통과)', 8, 80, 0.5, 'mm', 14],
  ['USB-C 전원', 'CBL_W', '케이블 구멍 폭', 4, 50, 0.5, 'mm', 8],
  ['USB-C 전원', 'PLUG_L', 'C6L USB-C 옆 플러그 자리(ㄱ자 기준)', 5, 40, 0.5, 'mm', 12],
  ['인서트·볼트', 'INS3_HOLE', 'M3 인서트 구멍 지름', 3.6, 5, 0.05, 'mm', 4],
  ['인서트·볼트', 'INS3_L', 'M3 인서트 길이', 3, 8, 0.1, 'mm', 5.7],
  ['인서트·볼트', 'INS3S_L', 'PCB 기둥용 짧은 M3 인서트 길이', 2.5, 6, 0.1, 'mm', 4],
  ['인서트·볼트', 'INS2_HOLE', 'M2 인서트 구멍 지름', 2.6, 4, 0.05, 'mm', 3.2],
  ['인서트·볼트', 'INS2_L', 'M2 인서트 길이', 2, 5, 0.1, 'mm', 3],
  ['인서트·볼트', 'LID_CB_D', '뚜껑 볼트 머리 자리 지름', 5, 8, 0.1, 'mm', 6.2],
  ['인서트·볼트', 'LID_CB_H', '뚜껑 볼트 머리 자리 깊이', 0, 3, 0.1, 'mm', 1.5],
];
export const defaults = () => Object.fromEntries(DEFS.map(d => [d[1], d[7]]));

export function layout(P) {
  const BAY = Math.max(P.COL_D, P.CABLE_BAY), W = P.WALL;
  const L = { BAY, IX: P.COL_D + 2 * P.CLR + P.BAT_L + BAY, IY: P.BAT_W + 2 * P.CLR + P.EXTRA_Y };
  const { IX, IY } = L;
  L.bat = [P.COL_D + P.CLR, P.CLR, P.COL_D + P.CLR + P.BAT_L, P.CLR + P.BAT_W];
  L.ZD0 = P.BAT_T + P.BAT_GAP;                          // 격판 밑면
  L.ZD1 = L.ZD0 + P.DIV_T;                              // 격판 윗면 = 전자부 바닥
  L.PCB_GAP = P.SW_H - P.LID_T - P.BTN_PROUD;          // 뚜껑 밑면 ~ PCB 윗면
  L.IH = L.ZD1 + Math.max(C6L.T, L.PCB_GAP + PCB.T + P.UNDER_PCB) + 0.5;
  L.ZS = Math.min(Math.max(P.SEAM_H, 0), L.ZD0);        // 바닥-통 이음 높이
  const cr = P.COL_D / 2;
  L.cols = [[cr, cr], [IX - cr, cr], [IX - cr, IY - cr], [cr, IY - cr]];
  // 배터리 +X 멈춤턱 2개(앞·뒤 벽 쪽, 가운데는 케이블 길), -X 는 모서리 기둥이 막는다
  const sx = L.bat[2] + P.CLR, sl = Math.min(12, IY / 3);
  L.stops = [[sx, -1, sx + 2, sl], [sx, IY - sl, sx + 2, IY + 1]];   // 벽 속으로 1mm 겹쳐 한 덩어리로
  // 배터리 누름 리브(앞·뒤 벽 각 2개): 끝이 배터리 면을 RIB_PRESS 만큼 파고드는 세로 기둥 중심 [x, y, 벽 y]
  L.ribs = P.RIB_PRESS > 0 ? [0.25, 0.75].flatMap(f => [
    [L.bat[0] + P.BAT_L * f, L.bat[1] + P.RIB_PRESS - RIB_R, -1],
    [L.bat[0] + P.BAT_L * f, L.bat[3] - P.RIB_PRESS + RIB_R, IY + 1]]) : [];
  // C6L: SMA 끝을 -X 벽에 붙인다(안테나를 조이면 벽을 사이에 두고 C6L 이 당겨져 고정), Y 는 드래그
  const cx0 = 0, cy = P.C6L_Y, cy0 = cy - C6L.W / 2, gx = cx0 + C6L.L;
  Object.assign(L, { c6l: [cx0, cy0, gx, cy0 + C6L.W], grove_x: gx,
    sma: [-1, 1].map(s => [cy + s * C6L.SMA_DX, L.IH - P.SMA_FROM_FRONT]),
    pins: [-1, 1].map(s => [gx - C6L.LEGO, cy + s * C6L.LEGO_DX]),
    oled: [gx - C6L.OLED, cy], ubtn: [gx - C6L.UBTN, cy],
    // 격판 누름 받침: 뒷면 나사(가운데 줄)·레고 구멍을 피해 네 군데
    c6lPads: [cx0 + 10, gx - 24].flatMap(x => [-1, 1].map(s => [x, cy + s * 7])) });
  L.maskOff = Math.max(P.LID_T - P.MASK_T, 0) / Math.tan(P.MASK_SLOPE * Math.PI / 180);
  // 버튼 PCB: 0° = 헤더 쪽이 뒤(+Y). PCB 로컬(u = 길이, v = 폭, v 큰 쪽 = 헤더)을 중심 기준으로 회전
  const a = P.PCB_ROT * Math.PI / 180, ca = Math.round(Math.cos(a)), sa = Math.round(Math.sin(a)), pc = [P.PCB_CX, P.PCB_CY];
  const tr = (u, v) => [pc[0] + (u - PCB.L / 2) * ca - (v - PCB.W / 2) * sa, pc[1] + (u - PCB.L / 2) * sa + (v - PCB.W / 2) * ca];
  const hx = (ca ? PCB.L : PCB.W) / 2, hy = (ca ? PCB.W : PCB.L) / 2;
  L.pcb = [pc[0] - hx, pc[1] - hy, pc[0] + hx, pc[1] + hy];
  L.keysAll = PCB.KEYS.map(k => tr(k, PCB.W - PCB.KEY_FROM_TOP));
  L.keys = L.keysAll.filter((_, i) => i !== 1 || P.MID_KEY);
  L.stand = [PCB.HX, PCB.L - PCB.HX].flatMap(u => [PCB.HY, PCB.W - PCB.HY].map(v => tr(u, v)));
  L.pcbHdr = tr(PCB.L / 2, PCB.W - 1.6);              // 헤더 위치(표시용)
  // USB-C: 격판 밑(배터리 쪽)에 플랜지, 몸통이 격판을 지나 위로
  const ax = P.USBC_ROT ? [0, 1] : [1, 0], c = [P.USBC_CX, P.USBC_CY];
  const r2 = (a, b) => P.USBC_ROT ? [c[0] - b / 2, c[1] - a / 2, c[0] + b / 2, c[1] + a / 2] : [c[0] - a / 2, c[1] - b / 2, c[0] + a / 2, c[1] + b / 2];
  L.usbc = { mode: P.USB_MODE, c, flange: r2(USBC.FL, USBC.FH), slot: r2(P.USBC_SLOT_W, P.USBC_SLOT_T), body: r2(USBC.BODY_W, USBC.BODY_T),
    cable: r2(P.CBL_L, P.CBL_W), long: P.USBC_ROT ? 'y' : 'x',
    holes: [-1, 1].map(s => [c[0] + s * ax[0] * USBC.HOLE_P / 2, c[1] + s * ax[1] * USBC.HOLE_P / 2]) };
  // C6L 자체 USB-C: +Y 쪽 긴 면, Grove 끝에서 20.3. 케이블 구멍 방식이면 그 옆에 플러그 자리가 필요
  L.c6lUsb = [gx - C6L.USB, cy0 + C6L.W];
  L.plug = [L.c6lUsb[0] - 6, cy0 + C6L.W, L.c6lUsb[0] + 6, cy0 + C6L.W + P.PLUG_L];
  L.outer = [IX + 2 * W, IY + 2 * W, L.IH + P.LID_T + P.FLOOR];
  L.rT = Math.min(P.TOP_R, P.R_OUT - 0.5); L.rB = Math.min(P.BOT_R, P.R_OUT - 0.5);   // 필렛(Fusion)·토러스(manifold) 모두 세로 R 보다 작아야 한다
  // 볼트 길이: 체결 두께 + 인서트 길이 − 0.5 이하의 표준 길이
  const std = n => [3, 4, 5, 6, 8, 10, 12, 16].filter(v => v <= n).pop() ?? 3;
  L.bolts = { lid: std(P.LID_T - P.LID_CB_H + P.INS3_L - 0.5), pcb: std(PCB.T + P.INS3S_L - 0.5), usbc: std(USBC.FT + P.INS2_L - 0.3) };
  return L;
}

const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const sq = (c, d) => [c[0] - d / 2, c[1] - d / 2, c[0] + d / 2, c[1] + d / 2];
const inside = (r, L) => r[0] >= 0 && r[1] >= 0 && r[2] <= L.IX && r[3] <= L.IY;

export function check(P, L) {
  const W = [], err = m => W.push(['error', m]), warn = m => W.push(['warn', m]), info = m => W.push(['info', m]);
  if (L.PCB_GAP < 3.5) err(`PCB 가 뚜껑에 너무 붙음(${L.PCB_GAP.toFixed(1)}mm) — 스위치 몸통이 뚜껑에 닿는다. 스위치 높이·돌출을 확인`);
  const c6lZone = [L.c6l[0], L.c6l[1], L.grove_x + P.GROVE_CLR, L.c6l[3]];
  const cols = L.cols.map(c => sq(c, P.COL_D));
  const u = L.usbc, parts = [['C6L(+Grove)', c6lZone], ['버튼 PCB', L.pcb]];
  if (u.mode === 0) parts.push(['USB-C 커넥터', u.flange]);
  if (u.mode === 2) parts.push(['케이블 구멍', u.cable]);
  for (const [n, r] of parts) {
    if (!inside(r, L)) err(`${n} 가 안쪽을 벗어남`);
    if (cols.some(c => overlap(c, r))) err(`${n} 가 모서리 기둥과 겹침`);
  }
  if (overlap(c6lZone, L.pcb)) err('C6L 과 버튼 PCB 가 겹침');
  for (const p of L.c6lPads) for (const r of [u.mode === 0 ? u.flange : null, u.mode === 2 ? u.cable : null].filter(Boolean))
    if (overlap(sq(p, P.C6L_PAD_D), r)) { warn('C6L 누름 받침이 격판 USB-C 자리와 겹침 — 그 받침은 빠진다'); break; }
  if (u.mode === 0) {
    for (const r of [c6lZone, L.pcb]) if (overlap(r, u.body)) warn('USB-C 커넥터 몸통이 C6L/PCB 밑에 있음 — 높이·배선 확인');
    if (L.stops.some(r => overlap(r, u.flange))) warn('USB-C 커넥터 플랜지가 배터리 멈춤턱과 겹침 — 커넥터를 옮길 것');
    if (overlap(u.flange, L.bat)) err('USB-C 커넥터가 배터리 위에 있음 — 아래에서 케이블을 꽂을 자리가 없다. 케이블 자리(+X) 쪽으로');
  }
  if (u.mode === 2) {
    if (overlap(u.cable, L.bat)) warn('케이블 구멍이 배터리 위에 있음 — 배터리 위 틈으로 케이블이 지나가야 한다');
    if (!inside(L.plug, L) || cols.some(c => overlap(c, L.plug)) || overlap(L.plug, L.pcb))
      err(`C6L USB-C 옆(+Y) 플러그 자리 ${P.PLUG_L}mm 가 막힘 — C6L 을 앞(−Y)으로 옮기거나 PCB 를 비킬 것`);
  }
  if (u.mode === 1) info('배터리 → C6L 전원 경로 없음(격판에 구멍 없음)');
  for (const k of L.keys) for (const s of L.stand)
    if (Math.hypot(k[0] - s[0], k[1] - s[1]) <= (P.BTN_HOLE_D + P.STANDOFF_D) / 2) { err('버튼 구멍이 PCB 기둥과 겹침'); break; }
  const mx = P.OLED_WX / 2 + L.maskOff;
  if (Math.abs(L.oled[0] - L.ubtn[0]) < mx + P.UBTN_D / 2 + 0.8) warn('OLED 마스크 경사가 C6L 버튼 구멍에 닿음');
  if (2 * C6L.SMA_DX <= P.ANT_D) err('안테나 자리 두 개가 서로 겹침');
  if (L.sma[0][1] + P.ANT_D / 2 > L.IH) info('안테나 자리가 벽 윗선까지 올라감 — 벽 위가 살짝 파인다(뚜껑이 덮음)');
  const thread = C6L.SMA_LEN - P.SMA_WALL;
  if (thread < 4) warn(`SMA 나사가 벽 밖으로 ${thread.toFixed(1)}mm 만 나옴(4mm 이상 권장)`);
  if (P.SMA_WALL >= P.WALL) warn('안테나 자리 벽이 벽 두께 이상 — 파기 효과 없음');
  const colH = L.IH - L.ZS;
  if (P.INS3_L + 0.5 + P.MAG_T + 0.2 > colH - 1) err(`모서리 기둥(통 쪽 ${colH.toFixed(1)}mm)에 인서트와 자석 자리가 겹침`);
  if (P.COL_D < Math.max(P.INS3_HOLE, P.MAG_D) + 2.4) warn('모서리 기둥 벽이 1.2mm 미만 — 인서트·자석 자리 주변이 약하다');
  if (L.ZS < P.MAG_T + 0.2 + 0.6 && P.FLOOR < P.MAG_T + 0.8) err('평판 바닥이 자석보다 얇음 — 바닥판 두께를 늘리거나 바닥 벽을 세울 것');
  if (L.PCB_GAP + P.LID_T - 0.8 < P.INS3S_L + 0.5) err('PCB 기둥+뚜껑이 짧은 M3 인서트보다 짧음 — 인서트 길이·스위치 높이 확인');
  if (P.STANDOFF_D < P.INS3_HOLE + 2.4) warn('PCB 기둥 벽이 1.2mm 미만');
  if (P.PIN_LEN > C6L.T) warn('레고 핀이 C6L 두께(8mm)보다 김');
  info('ST003 모듈: 사진상 헤더 핀·POWER LED 가 위로 솟아 있어 뚜껑에 닿는다 — 핀을 빼고 선을 직접 납땜, LED 는 눕힐 것');
  info('ST003 모듈: 사진상 둥근 캡(약 Ø11.5)이 끼워져 있다 — 캡을 쓰면 버튼 구멍 Ø12.5, 스위치 높이는 PCB~캡 끝 실측값으로');
  if (P.TOP_R > L.rT || P.BOT_R > L.rB) info(`테두리 R 은 세로 모서리 R − 0.5(${P.R_OUT - 0.5}mm)까지 — 그 값으로 맞춤. 더 둥글게 하려면 세로 R 을 키울 것`);
  // 둥근 테두리가 안쪽 공간 모서리에 가장 가까운 곳의 벽 두께
  const rim = (r, t) => r > W2 && r > t ? r - Math.hypot(r - W2, r - t) : Math.min(W2, t);
  const W2 = P.WALL, tTop = rim(L.rT, P.LID_T), tBot = rim(L.rB, P.FLOOR);
  if (tTop < 1.2) warn(`윗면 테두리 R 때문에 통 윗모서리 벽이 ${tTop.toFixed(1)}mm — 1.2 이상 권장`);
  if (tBot < 1.2) warn(`아랫면 테두리 R 때문에 바닥 아랫모서리 벽이 ${tBot.toFixed(1)}mm — 1.2 이상 권장`);
  // 뚜껑 볼트 머리 자리가 윗면 평평한 곳에 있는지(바깥 모서리 기준 거리 a,b)
  const a = W2 + P.COL_D / 2, R = P.R_OUT, flat = a < R ? (R - L.rT) - Math.hypot(R - a, R - a) : a - L.rT;
  if (flat < P.LID_CB_D / 2 + 0.2) warn('뚜껑 볼트 머리 자리가 둥근 테두리에 걸림 — 윗면 R 을 줄이거나 기둥을 키울 것');
  if (L.ribs.length && L.ZD0 - L.ZS <= 3) info('바닥 벽이 높아 통에 배터리 누름 리브 자리가 없음 — 리브를 넣으려면 바닥 벽 높이를 낮출 것');
  if (P.SEAM_H > L.ZD0) info(`바닥 벽 높이는 격판 밑(${L.ZD0}mm)까지만 — 그 값으로 맞춤`);
  if (L.ZS < L.ZD0) info('통이 격판 밑으로 내려와 배터리를 벽·멈춤턱으로 잡는다 — 통은 격판이 공중에 뜨므로 배터리 칸에 서포트가 필요하다(바닥 벽 높이를 최대로 하면 서포트 없이 출력되지만 배터리는 바닥이 잡는다)');
  return W;
}

// ---- CSG 트리 ----
const box = (x0, y0, z0, x1, y1, z1) => ({ t: 'box', p: [x0, y0, z0, x1, y1, z1] });
const cyl = (a, b, r1, r2 = r1) => ({ t: 'cyl', a, b, r1, r2 });
const add = (...c) => ({ t: 'add', c }), sub = (...c) => ({ t: 'sub', c }), and = (...c) => ({ t: 'and', c });
const rbox = (x0, y0, z0, x1, y1, z1, r) => add(box(x0 + r, y0, z0, x1 - r, y1, z1), box(x0, y0 + r, z0, x1, y1 - r, z1),
  ...[x0 + r, x1 - r].flatMap(x => [y0 + r, y1 - r].map(y => cyl([x, y, z0], [x, y, z1], r))));
const vcyl = ([x, y], z0, z1, r) => cyl([x, y, z0], [x, y, z1], r);
// rslab 노드 = 세로 모서리 R + 윗면 테두리 rt + 아랫면 테두리 rb 인 판(rt, rb < R). manifold 용 전개:
// 곧은 테두리 = 눕힌 원기둥, 모서리 = 1/4 토러스. Fusion 은 이 전개를 쓰지 않고 둥근 상자에 필렛 기능을 건다
export function expandRslab({ p: [x0, y0, z0, x1, y1, z1], R, rt, rb }) {
  const parts = [rbox(x0, y0, z0 + rb, x1, y1, z1 - rt, R)];
  for (const [r, zc, zf] of [[rt, z1 - rt, z1], [rb, z0 + rb, z0]]) {
    if (r <= 0) continue;
    parts.push(rbox(x0 + r, y0 + r, Math.min(zc, zf), x1 - r, y1 - r, Math.max(zc, zf), R - r),
      ...[y0 + r, y1 - r].map(y => cyl([x0 + R, y, zc], [x1 - R, y, zc], r)),
      ...[x0 + r, x1 - r].map(x => cyl([x, y0 + R, zc], [x, y1 - R, zc], r)),
      ...[[x1 - R, y1 - R, 0], [x0 + R, y1 - R, 90], [x0 + R, y0 + R, 180], [x1 - R, y0 + R, 270]].map(([x, y, a0]) => ({ t: 'torus', c: [x, y, zc], R: R - r, r, a0 })));
  }
  return add(...parts);
}
const rect = (r, z0, z1) => box(r[0], r[1], z0, r[2], r[3], z1);
// 양끝이 둥근 긴 구멍(짧은 변 지름)
const stadium = (r, z0, z1) => {
  const w = r[2] - r[0], h = r[3] - r[1], rr = Math.min(w, h) / 2, cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
  const [a, b] = w >= h ? [[r[0] + rr, cy], [r[2] - rr, cy]] : [[cx, r[1] + rr], [cx, r[3] - rr]];
  return add(w >= h ? box(a[0], r[1], z0, b[0], r[3], z1) : box(r[0], a[1], z0, r[2], b[1], z1), vcyl(a, z0, z1, rr), vcyl(b, z0, z1, rr));
};

export function model(P) {
  const L = layout(P), warn = check(P, L);
  const { IX, IY, IH, ZD0, ZD1, ZS } = L, W = P.WALL, ri = Math.max(P.R_OUT - W, 0.3), cr = P.COL_D / 2, top = IH + P.LID_T;
  // 바깥 외피 하나(세로 R + 윗면·아랫면 테두리 R)를 높이로 잘라 세 부품에 나눈다 → 곡면이 부품 사이로 이어진다
  const env = { t: 'rslab', p: [-W, -W, -P.FLOOR, IX + W, IY + W, top], R: P.R_OUT, rt: L.rT, rb: L.rB };
  const slab = (z0, z1) => and(env, box(-W - 1, -W - 1, z0, IX + W + 1, IY + W + 1, z1));
  const cav = (z0, z1) => rbox(0, 0, z0, IX, IY, z1, ri);
  // 모서리 기둥: 원기둥을 벽 쪽으로 밀어 겹쳐 벽과 한 덩어리로, 안쪽 공간으로 잘라낸다
  const column = ([x, y], z0, z1) => {
    const dx = x < IX / 2 ? -cr : cr, dy = y < IY / 2 ? -cr : cr;
    // 안쪽 공간보다 0.05 크게 잘라 벽과 살짝 겹친다 — 곡면이 딱 맞닿으면 부피 0 조각이 떨어져 나온다
    return and(add(...[[0, 0], [dx, 0], [0, dy], [dx, dy]].map(([ox, oy]) => vcyl([x + ox, y + oy], z0, z1, cr))), rbox(-0.05, -0.05, z0, IX + 0.05, IY + 0.05, z1, ri + 0.05));
  };
  const magnet = (c, zFace, up) => vcyl(c, up ? zFace - 1 : zFace - P.MAG_T - 0.2, up ? zFace + P.MAG_T + 0.2 : zFace + 1, P.MAG_D / 2 + 0.1);

  // Body: 벽(ZS~IH) + 격판 + 기둥(위 = M3 인서트, 아래 = 자석) + USB-C 자리
  const u = L.usbc, usbHoles = u.mode === 0 ? [u.flange] : u.mode === 2 ? [u.cable] : [];
  const body = sub(
    add(sub(slab(ZS, IH), cav(ZS - 1, IH + 1)),
      cav(ZD0, ZD1),
      ...L.c6lPads.filter(p => !usbHoles.some(r => overlap(sq(p, P.C6L_PAD_D), r))).map(p => vcyl(p, ZD1 - 0.1, IH - C6L.T + P.C6L_PRESS, P.C6L_PAD_D / 2)),
      ...L.cols.map(c => column(c, ZS, IH)),
      ...(ZS < ZD0 ? L.stops.map(r => rect(r, ZS, ZD0 + 0.5)) : []),
      // 누름 리브: 아래 2mm 는 가늘게(조임 0) 시작해 배터리가 걸리지 않고 들어간다. 벽까지 판으로 이어 한 덩어리로
      ...(ZD0 - ZS > 3 ? L.ribs.flatMap(([x, y, wy]) => [
        cyl([x, y, ZS], [x, y, ZS + 2], RIB_R - P.RIB_PRESS, RIB_R), vcyl([x, y], ZS + 2, ZD0 + 0.5, RIB_R),
        box(x - RIB_R, Math.min(y, wy), ZS, x + RIB_R, Math.max(y, wy), ZD0 + 0.5)]) : []),
      ...(u.mode === 0 ? u.holes.map(h => vcyl(h, ZD1 - 0.1, ZD0 + P.INS2_L + 1.2, P.INS2_HOLE / 2 + 1.6)) : [])),
    ...L.cols.map(c => vcyl(c, IH - P.INS3_L - 0.5, IH + 1, P.INS3_HOLE / 2)),
    ...L.cols.map(c => magnet(c, ZS, true)),
    ...L.sma.flatMap(([sy, sz]) => [            // -X 벽: 위가 열린 SMA 홈 + 바깥에서 안테나 지름만큼 파서 벽을 얇게
      cyl([-W - 1, sy, sz], [1, sy, sz], P.SMA_HOLE_D / 2),
      box(-W - 1, sy - P.SMA_HOLE_D / 2, sz, 1, sy + P.SMA_HOLE_D / 2, IH + 1),
      ...(P.SMA_WALL < W ? [cyl([-W - 1, sy, sz], [-P.SMA_WALL, sy, sz], P.ANT_D / 2)] : [])]),
    ...(u.mode === 0 ? [rect(u.slot, ZD0 - 1, ZD1 + 1), ...u.holes.map(h => vcyl(h, ZD0 - 1, ZD0 + P.INS2_L + 0.3, P.INS2_HOLE / 2))] : []),
    ...(u.mode === 2 ? [stadium(u.cable, ZD0 - 1, ZD1 + 1)] : []));

  // Cover: 바닥판(+벽 ZS 높이) + 기둥 자석 자리. 앞쪽 손가락 홈(바깥에서만, 안쪽 0.8 남김)은 이음선의 높은 쪽 부품에 판다
  // — 바닥이 낮으면 통에 파서 바닥 벽 윗모서리를 손끝으로 당긴다
  const notch = cyl([IX / 2, -W - 1, ZS], [IX / 2, -0.8, ZS], P.NOTCH_R), notchInBody = ZS + P.FLOOR < ZD0 - ZS;
  if (notchInBody) body.c.push(notch);
  const cover = ZS > 0.5
    ? sub(add(sub(slab(-P.FLOOR - 1, ZS), cav(0, ZS + 1)), ...L.cols.map(c => column(c, -0.5, ZS)), ...L.stops.map(r => rect(r, -0.5, ZS))),
      ...L.cols.map(c => magnet(c, ZS, false)), ...(notchInBody ? [] : [notch]))
    : sub(slab(-P.FLOOR - 1, ZS), ...L.cols.map(c => magnet(c, ZS, false)), ...(notchInBody ? [] : [notch]));

  // Lid: 조립 위치(z=IH 위). 출력은 뒤집어서
  const g = L.PCB_GAP, pin = P.PIN_D / 2;
  const lid = sub(add(slab(IH, top + 1),
      ...L.pins.flatMap(([x, y]) => [cyl([x, y, IH - P.PIN_LEN + 0.6], [x, y, IH], pin), cyl([x, y, IH - P.PIN_LEN], [x, y, IH - P.PIN_LEN + 0.6], pin - 0.5, pin)]),
      ...L.stand.map(s => vcyl(s, IH - g, IH, P.STANDOFF_D / 2))),
    ...L.stand.map(s => vcyl(s, IH - g - 1, IH - g + P.INS3S_L + 0.5, P.INS3_HOLE / 2)),
    box(L.oled[0] - P.OLED_WX / 2, L.oled[1] - P.OLED_WY / 2, IH - 1, L.oled[0] + P.OLED_WX / 2, L.oled[1] + P.OLED_WY / 2, top + 1),
    // OLED 마스크: 창 둘레는 MASK_T, 바깥으로 경사져 올라가 뚜껑 두께로
    ...(P.MASK_T < P.LID_T ? [{ t: 'frustum', c: L.oled, z0: IH + P.MASK_T, z1: top + 0.5, w0: [P.OLED_WX, P.OLED_WY],
      off: (top + 0.5 - IH - P.MASK_T) / Math.tan(P.MASK_SLOPE * Math.PI / 180) }] : []),
    vcyl(L.ubtn, IH - 1, top + 1, P.UBTN_D / 2),
    ...L.keys.map(k => vcyl(k, IH - 1, top + 1, P.BTN_HOLE_D / 2)),
    ...L.cols.flatMap(c => [vcyl(c, IH - 1, top + 1, M3_CLEAR / 2), vcyl(c, top - P.LID_CB_H, top + 1, P.LID_CB_D / 2)]));

  // 맞춤 확인용 부품 (출력 안 함)
  const c = L.c6l, p = L.pcb, pz = IH - g - PCB.T;
  const refs = {
    REF_battery: rect(L.bat, 0, P.BAT_T),
    REF_C6L: add(box(c[0], c[1], IH - C6L.T, c[2], c[3], IH), ...L.sma.map(([sy, sz]) => cyl([c[0], sy, sz], [c[0] - C6L.SMA_LEN, sy, sz], 3.2))),
    REF_buttonPCB: add(rect(p, pz, pz + PCB.T),
      ...L.keysAll.map(([x, y]) => box(x - 6, y - 6, pz + PCB.T, x + 6, y + 6, pz + PCB.T + 3.5)),
      ...L.keysAll.map(k => vcyl(k, pz + PCB.T, pz + PCB.T + P.SW_H, 1.75))),
  };
  if (u.mode === 0) refs.REF_usbc = add(rect(u.flange, ZD0 - USBC.FT, ZD0), rect(u.body, ZD0, ZD0 - USBC.FT + USBC.BODY_L));
  return { L, warn, bodies: { Lid: lid, Body: body, Cover: cover }, refs };
}

// case.json: 파라미터 + 트리. Fusion 스크립트가 이것만 읽는다
export const caseJson = P => { const m = model(P); return { version: 2, params: P, layout: m.L, bodies: m.bodies, refs: m.refs }; };
