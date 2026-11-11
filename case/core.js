// 단일 진실: 파라미터 → 배치(L) → 검사(warn) → CSG 트리(bodies/refs). DOM 없음(node 로도 돈다).
// 브라우저는 manifold 로, Fusion 스크립트(C6LCaseBuild.py)는 TemporaryBRepManager 로 같은 트리를 계산한다.
// 좌표(mm): X=길이(+X 오른쪽), Y=깊이(+Y 뒤), Z=위. 바닥판 윗면(배터리가 놓이는 면)의 앞-왼쪽 안쪽 모서리가 원점.
// 부품: Lid(뚜껑, C6L·버튼 PCB 를 밑에 매단다) / Body(벽, 위 칸 = 전자부, 아래 칸 = 배터리) / Shelf(가운데 격판, 따로 출력해 통 기둥 턱에 얹음)
//          / Cover(자석 바닥 — 떼어 배터리를 넣고 뺀다) / Keys(버튼 캡, BTN_CAP 일 때). 뚜껑-통은 모서리 기둥의 M3 열삽입 인서트로 볼트 체결.
// 트리 노드: {t:'box',p:[x0,y0,z0,x1,y1,z1]} | {t:'cyl',a,b,r1,r2} | {t:'frustum',c:[x,y],z0,z1,w0:[wx,wy],off} | {t:'torus',c:[x,y,z],R,r,a0} (Z축, a0° 부터 90°) | {t:'rslab',p,R,rt,rb} (둥근 외피)
//          | {t:'add'|'sub'|'and',c:[…]} (sub = c[0] − 나머지). frustum = z0 에서 w0, z1 에서 사방 off 만큼 넓어지는 사각뿔대

// Unit C6L (docs.m5stack.com U202 Model Size: 24×56×8, SMA 포함 62) — 위치는 Grove 끝 기준
export const C6L = { L: 56, W: 24, T: 8, SMA_DX: 7, SMA_LEN: 6, USB: 20.3, LEGO: 12, LEGO_DX: 8, OLED: 34.4, UBTN: 22.3 };
// 3버튼 PCB (첨부 도면 66.04×22.352, 구멍 간격 59.944×16.764). 키 X 는 도면 비례 측정(피치 20.32)
export const PCB = { L: 66.04, W: 22.352, T: 1.6, HX: (66.04 - 59.944) / 2, HY: (22.352 - 16.764) / 2,
  KEYS: [12.70, 33.02, 53.34], KEY_FROM_TOP: 12.5 };
// 패널형 USB-C (JRC-C009, 사진 치수: 플랜지 20×7, 몸통 폭 9). 구멍 간격·두께는 사진 비례 추정
export const USBC = { FL: 20, FH: 7, FT: 1, HOLE_P: 16.5, BODY_L: 5.3, BODY_W: 9, BODY_T: 3.6 };
const USBW_RIB = 6, USBW_RIB_T = 3;   // 세운 받침벽 뒷면 양끝 리브(길이·두께) — 플러그를 꽂을 때 미는 힘을 받는다
export const M3_CLEAR = 3.4;
const RIB_R = 1.5;   // 배터리 누름 리브 끝 반지름
const SEAT_W = 1.2;   // 끼움형 바닥판 평면 받침: 통 기둥이 벽을 따라 이 폭으로 z=0 까지 내려와 바닥판 귀퉁이 윗면을 받는다
const SHELF_SH = 1.2;   // 격판 받침 턱: 통 기둥이 격판 위에서 이만큼 가늘어진다
const C6L_HEAD_D = 8;   // C6L 고정 볼트 머리·와셔(M3 Ø7) 자리 — 격판에 뚫는 구멍 지름
const ANT_HUB = 12;  // 휩 안테나 나사·꺾임 마디 길이(사진 비례)

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
  ['케이스', 'JOINT', '뚜껑·바닥 결합', 0, 1, 1, '', 1, [[1, '끼움형 — 통 구멍에 판을 끼움(옆면 이음선 없음)'], [0, '적층형 — 높이로 나눠 쌓음(옆면에 이음선)']]],
  ['케이스', 'FIT', '뚜껑·바닥 끼움 틈(한 면, 끼움형)', 0, 1, 0.05, 'mm', 0.2],
  ['케이스', 'PLATE_R', '끼움 판 귀퉁이 R (평면, 통 구멍도 같게, 끼움형)', 0.5, 20, 0.1, 'mm', 4.6],
  ['케이스', 'EDGE_R', '끼움 판 둘레 테두리 R (바깥면, 끼움형)', 0, 3, 0.1, 'mm', 1],
  ['배터리·바닥', 'BAT_L', '배터리 길이', 40, 140, 0.5, 'mm', 99],
  ['배터리·바닥', 'BAT_W', '배터리 폭', 30, 100, 0.5, 'mm', 65],
  ['배터리·바닥', 'BAT_T', '배터리 두께', 3, 30, 0.5, 'mm', 12],
  ['배터리·바닥', 'BAT_GAP', '배터리 위 틈', 0, 5, 0.5, 'mm', 1],
  ['배터리·바닥', 'CABLE_BAY', '+X 쪽 케이블 자리', 0, 40, 0.5, 'mm', 16],
  ['배터리·바닥', 'EXTRA_Y', '안쪽 깊이 추가(Y, PCB 세로 배치용)', 0, 40, 0.5, 'mm', 0],
  ['배터리·바닥', 'COVER_FIX', '바닥 고정', 0, 1, 1, '', 0, [[0, '자석 — 모서리 기둥 자석으로 붙임'], [1, '볼트 — 바닥에서 통 기둥 관통, 뚜껑 인서트에 체결']]],
  ['배터리·바닥', 'SEAM_H', '바닥 높이 (끼움형: 바닥 기둥, 적층형: 바닥 벽 · 최대 = 격판 밑)', 0, 40, 0.5, 'mm', 7.5],
  ['배터리·바닥', 'RIB_PRESS', '배터리 누름 리브 조임 (0 = 없음)', 0, 1, 0.05, 'mm', 0.3],
  ['배터리·바닥', 'COL_D', '모서리 기둥 지름', 7, 14, 0.5, 'mm', 9.5],
  ['배터리·바닥', 'MAG_D', '자석 지름', 3, 10, 0.5, 'mm', 6],
  ['배터리·바닥', 'MAG_T', '자석 두께', 1, 5, 0.5, 'mm', 3],
  ['배터리·바닥', 'NOTCH_R', '손가락 구멍·홈 반지름 (끼움형: 바닥판 반달 구멍, 적층형: 이음선 홈)', 3, 15, 0.5, 'mm', 7],
  ['배터리·바닥', 'PULL_X', '손가락 구멍 위치 X (반달 곧은 변 중심, 드래그)', 0, 200, 0.5, 'mm', 62.75],
  ['배터리·바닥', 'PULL_Y', '손가락 구멍 위치 Y', 0, 120, 0.5, 'mm', 10],
  ['배터리·바닥', 'PULL_DIR', '손가락 구멍 둥근 쪽', 0, 270, 90, '', 270, [[270, '앞 (−Y)'], [90, '뒤 (+Y)'], [180, '−X'], [0, '+X']]],
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
  ['C6L', 'ANT_LORA_L', 'LoRa 안테나 길이 (앞 −Y 쪽 SMA, 부속 868MHz)', 30, 250, 1, 'mm', 108],
  ['C6L', 'ANT_WIFI_L', 'Wi-Fi 안테나 길이 (뒤 +Y 쪽 SMA, 부속 2.4GHz)', 30, 250, 1, 'mm', 84],
  ['C6L', 'ANT_FOLD', '안테나 꺾음', 0, 90, 45, '', 90, [[90, '90° 위로 세움'], [45, '45° 위로'], [0, '곧게 옆으로']]],
  ['C6L', 'PIN_D', '레고 핀 지름(구멍 Ø5, 출력 공차에 맞춰)', 4.4, 5.2, 0.05, 'mm', 4.9],
  ['C6L', 'PIN_LEN', '레고 핀 길이', 2, 8, 0.5, 'mm', 6],
  ['C6L', 'PIN_TAP', '레고 핀 탭 구멍 (C6L 밑에서 레고 구멍으로 볼트, 셀프탭: M3 2.5 · M2.5 2.1, 0 = 없음)', 0, 3, 0.05, 'mm', 2.5],
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
  ['버튼 PCB', 'BTN_CAP', '버튼', 0, 1, 1, '', 1, [[1, '출력 버튼 캡 — 스템에 끼우고 뚜껑 밑 홈의 턱에 걸림'], [0, '없음 — 스위치 스템이 구멍으로 나옴']]],
  ['버튼 PCB', 'CAP_PROUD', '캡이 뚜껑 위로 나옴', 0, 4, 0.1, 'mm', 1],
  ['버튼 PCB', 'CAP_TOP_T', '캡 윗면 두께(스템 끝 ~ 캡 윗면)', 0.6, 3, 0.1, 'mm', 1],
  ['버튼 PCB', 'CAP_FL_T', '캡 턱 두께 (= 뚜껑 밑 홈 깊이)', 0.6, 2, 0.1, 'mm', 1],
  ['버튼 PCB', 'CAP_FL_W', '캡 턱 폭 (구멍 밖으로)', 0.8, 4, 0.1, 'mm', 1.5],
  ['버튼 PCB', 'CAP_CLR', '캡 둘레 틈', 0.1, 0.6, 0.05, 'mm', 0.25],
  ['버튼 PCB', 'STEM_D', '스위치 스템 지름 (캡 구멍 +0.3)', 2, 5, 0.1, 'mm', 3.5],
  ['버튼 PCB', 'UNDER_PCB', 'PCB 밑 리드 여유', 0, 6, 0.5, 'mm', 2.5],
  ['버튼 PCB', 'STANDOFF_D', 'PCB 기둥 지름(인서트)', 6, 10, 0.5, 'mm', 8],
  ['USB-C 전원', 'USB_MODE', '배터리 → C6L 전원 경로', 0, 3, 1, '', 3, [[3, '격판 위에 세운 USB-C(90°) — 배터리 케이블이 구멍으로 올라와 꽂음'], [0, '격판에 패널형 USB-C 커넥터(밑에서 꽂음)'], [2, '격판 구멍 — 배터리 케이블을 C6L 에 바로'], [1, '없음']]],
  ['USB-C 전원', 'USBC_CX', '위치 X (중심, 세움: 케이블 구멍 중심, 드래그)', 0, 200, 0.5, 'mm', 117.5],
  ['USB-C 전원', 'USBC_CY', '위치 Y (중심, 드래그)', 0, 120, 0.5, 'mm', 36],
  ['USB-C 전원', 'USBC_ROT', '방향', 0, 90, 90, '', 90, [[0, '길게 X (세움: 플러그 +Y 로 꽂음)'], [90, '길게 Y (세움: 플러그 +X 로 꽂음)']]],
  ['USB-C 전원', 'USBW_CX', '세움: 받침벽 위치 X (커넥터 면 중심, 드래그)', 0, 200, 0.5, 'mm', 99.5],
  ['USB-C 전원', 'USBW_CY', '세움: 받침벽 위치 Y', 0, 120, 0.5, 'mm', 36],
  ['USB-C 전원', 'USBW_T', '세움: 받침벽 두께', 3, 10, 0.5, 'mm', 5],
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
  ['인서트·볼트', 'LID_CB_D', '볼트 머리 자리 지름 (자석: 뚜껑 윗면, 볼트: 바닥 밑면)', 5, 8, 0.1, 'mm', 6.2],
  ['인서트·볼트', 'LID_CB_H', '볼트 머리 자리 깊이', 0, 3, 0.1, 'mm', 1.5],
];
export const defaults = () => Object.fromEntries(DEFS.map(d => [d[1], d[7]]));

export function layout(P) {
  const BAY = Math.max(P.COL_D, P.CABLE_BAY), W = P.WALL;
  const L = { BAY, IX: P.COL_D + 2 * P.CLR + P.BAT_L + BAY, IY: P.BAT_W + 2 * P.CLR + P.EXTRA_Y };
  const { IX, IY } = L;
  L.bat = [P.COL_D + P.CLR, P.CLR, P.COL_D + P.CLR + P.BAT_L, P.CLR + P.BAT_W];
  L.ZD0 = P.BAT_T + P.BAT_GAP;                          // 격판 밑면
  L.ZD1 = L.ZD0 + P.DIV_T;                              // 격판 윗면 = 전자부 바닥
  L.PCB_GAP = P.SW_H - P.LID_T - (P.BTN_CAP ? P.CAP_PROUD - P.CAP_TOP_T : P.BTN_PROUD);   // 뚜껑 밑면 ~ PCB 윗면 (캡: 스템 끝 = 캡 윗면 − CAP_TOP_T)
  // 버튼 캡: 머리(구멍 − 틈) + 턱(뚜껑 밑 홈 안, 밑면 = 뚜껑 밑면) + 밑에서 스템 구멍
  L.cap = P.BTN_CAP ? { r: P.BTN_HOLE_D / 2 - P.CAP_CLR, rf: P.BTN_HOLE_D / 2 + P.CAP_FL_W, rr: P.BTN_HOLE_D / 2 + P.CAP_FL_W + P.CAP_CLR, rs: P.STEM_D / 2 + 0.15 } : null;
  L.IH = L.ZD1 + Math.max(C6L.T, L.PCB_GAP + PCB.T + P.UNDER_PCB) + 0.5;
  L.ZS = Math.min(Math.max(P.SEAM_H, 0), L.ZD0);        // 바닥-통 이음 높이
  L.zCone = L.ZS - P.COL_D / 2 * Math.SQRT2;            // 끼움형 통 기둥 밑 45° 원뿔 꼭짓점(안쪽 모서리) — 기둥 중심에서 바닥 기둥과 닿는 높이가 ZS
  const cr = P.COL_D / 2;
  L.cols = [[cr, cr], [IX - cr, cr], [IX - cr, IY - cr], [cr, IY - cr]];
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
  // 세움(3): 뚜껑 밑에 매단 받침벽(f = 커넥터 면 중심)에 커넥터를 90° 로 세운다(뚜껑과 함께 열린다). 케이블 구멍(c)은 따로 위치를 잡고, 플랜지 면은 구멍 쪽을 본다
  if (P.USB_MODE === 3) {
    const f = [P.USBW_CX, P.USBW_CY], d0 = P.USBC_ROT ? [1, 0] : [0, 1], sg = Math.sign((c[0] - f[0]) * d0[0] + (c[1] - f[1]) * d0[1]) || 1;
    const d = d0.map(v => v * sg), bt = P.USBW_T, h = USBC.FL / 2 + 1;
    // 커넥터 면(f)에서 플러그 쪽으로 a~b, 옆으로 ±h 인 평면 사각형
    const sp = (a, b, h) => { const q = [[a, -h], [b, h]].map(([s, t]) => [f[0] + d[0] * s + ax[0] * t, f[1] + d[1] * s + ax[1] * t]);
      return [Math.min(q[0][0], q[1][0]), Math.min(q[0][1], q[1][1]), Math.max(q[0][0], q[1][0]), Math.max(q[0][1], q[1][1])]; };
    const zc = (L.ZD1 + L.IH) / 2, at = (s, t) => [f[0] + d[0] * s + ax[0] * t, f[1] + d[1] * s + ax[1] * t, zc];
    const back = -USBC.FT - bt, ribs = [-1, 1].map(k => { const r = sp(back - USBW_RIB, back + 0.1, USBW_RIB_T / 2), o = k * (h - USBW_RIB_T / 2);
      return [r[0] + ax[0] * o, r[1] + ax[1] * o, r[2] + ax[0] * o, r[3] + ax[1] * o]; });
    L.usbc.stand = { f, d, zc, z0: L.ZD1 + 0.5, flange: sp(-USBC.FT, 0, USBC.FL / 2),
      bracket: sp(back, -USBC.FT, h), ribs, foot: sp(back - USBW_RIB, -USBC.FT, h), body: sp(-USBC.FT - USBC.BODY_L, -USBC.FT, USBC.BODY_W / 2),
      slot: sp(back - 1, 0.1, P.USBC_SLOT_W / 2),
      ins: [-1, 1].map(k => [at(-USBC.FT + 0.1, k * USBC.HOLE_P / 2), at(-USBC.FT - P.INS2_L - 0.3, k * USBC.HOLE_P / 2)]) };
  }
  // C6L 자체 USB-C: +Y 쪽 긴 면, Grove 끝에서 20.3. 케이블 구멍 방식이면 그 옆에 플러그 자리가 필요
  L.c6lUsb = [gx - C6L.USB, cy0 + C6L.W];
  L.plug = [L.c6lUsb[0] - 6, cy0 + C6L.W, L.c6lUsb[0] + 6, cy0 + C6L.W + P.PLUG_L];
  L.outer = [IX + 2 * W, IY + 2 * W, L.IH + P.LID_T + P.FLOOR];
  L.rT = Math.min(P.TOP_R, P.R_OUT - 0.5); L.rB = Math.min(P.BOT_R, P.R_OUT - 0.5);
  // 끼움 판: 통 구멍 귀퉁이 rP, 판 귀퉁이 rP − FIT, 둘레 테두리 R 은 판 귀퉁이 R·판 두께보다 0.5 작게(뚜껑 eL, 바닥 eC)
  L.rP = Math.min(P.PLATE_R, Math.min(L.IX, L.IY) / 2 - 1);
  L.ri = P.JOINT === 1 ? L.rP : Math.max(P.R_OUT - P.WALL, 0.3);   // 안쪽 공간 귀퉁이 R — 끼움형은 판·통 구멍·기둥 바깥 귀퉁이가 모두 같은 R
  const rpp = Math.max(L.rP - P.FIT, 0.3);
  // 끼움형 바닥판 반달 손가락 구멍: c = 곧은 변 중심, v = 둥근 쪽 방향. 곧은 변에 손끝을 걸어 당긴다. box = 반달을 감싸는 평면 사각형
  { const c = [P.PULL_X, P.PULL_Y], r = P.NOTCH_R, v = [Math.round(Math.cos(P.PULL_DIR * Math.PI / 180)), Math.round(Math.sin(P.PULL_DIR * Math.PI / 180))];
    const lo = i => v[i] > 0 ? c[i] : c[i] - r, hi = i => v[i] < 0 ? c[i] : c[i] + r;
    L.pull = { c, r, v, box: [lo(0), lo(1), hi(0), hi(1)] }; }
  L.eL = Math.max(Math.min(P.EDGE_R, rpp - 0.5, P.LID_T - 0.5), 0); L.eC = Math.max(Math.min(P.EDGE_R, rpp - 0.5, P.FLOOR - 0.5), 0);   // 필렛(Fusion)·토러스(manifold) 모두 세로 R 보다 작아야 한다
  // 볼트 길이: 체결 두께 + 인서트 길이 − 0.5 이하의 표준 길이
  const std = n => [3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40].filter(v => v <= n).pop() ?? 3;
  // 바닥 볼트 고정: 뚜껑 밑에 기둥(lidBoss)을 내려 인서트를 박고(윗면 1mm 남김), 통 기둥은 그만큼 낮춘다. 볼트는 바닥 밑 머리 자리에서 관통
  L.lidBoss = P.COVER_FIX === 1 ? Math.max(P.INS3_L + 1.5 - P.LID_T, 1) : 0;
  L.coverBoltN = L.IH - L.lidBoss + P.INS3_L - 0.5 - (-P.FLOOR + P.LID_CB_H);   // 머리 자리 바닥 ~ 인서트 끝 0.5 전
  L.bolts = { cover: std(L.coverBoltN), lid: std(P.LID_T - P.LID_CB_H + P.INS3_L - 0.5), pcb: std(PCB.T + P.INS3S_L - 0.5), c6l: std(0.5 + C6L.T + P.LID_T - 1 - 0.5), usbc: std(USBC.FT + P.INS2_L - 0.3) };
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
  if (u.mode === 3) parts.push(['케이블 구멍', u.cable], ['세운 USB-C 받침벽', u.stand.foot]);
  for (const [n, r] of parts) {
    if (!inside(r, L)) err(`${n} 가 안쪽을 벗어남`);
    if (cols.some(c => overlap(c, r))) err(`${n} 가 모서리 기둥과 겹침`);
  }
  if (overlap(c6lZone, L.pcb)) err('C6L 과 버튼 PCB 가 겹침');
  for (const p of L.c6lPads) for (const r of [u.mode === 0 ? u.flange : null, u.mode >= 2 ? u.cable : null, u.stand?.foot].filter(Boolean))
    if (overlap(sq(p, P.C6L_PAD_D), r)) { warn('C6L 누름 받침이 격판 USB-C 자리와 겹침 — 그 받침은 빠진다'); break; }
  if (u.mode === 0) {
    for (const r of [c6lZone, L.pcb]) if (overlap(r, u.body)) warn('USB-C 커넥터 몸통이 C6L/PCB 밑에 있음 — 높이·배선 확인');
    if (overlap(u.flange, L.bat)) err('USB-C 커넥터가 배터리 위에 있음 — 아래에서 케이블을 꽂을 자리가 없다. 케이블 자리(+X) 쪽으로');
  }
  if (u.mode === 2) {
    if (overlap(u.cable, L.bat)) warn('케이블 구멍이 배터리 위에 있음 — 배터리 위 틈으로 케이블이 지나가야 한다');
    if (!inside(L.plug, L) || cols.some(c => overlap(c, L.plug)) || overlap(L.plug, L.pcb))
      err(`C6L USB-C 옆(+Y) 플러그 자리 ${P.PLUG_L}mm 가 막힘 — C6L 을 앞(−Y)으로 옮기거나 PCB 를 비킬 것`);
  }
  if (u.mode === 3) {
    const st = u.stand, foot = [st.foot];
    if (L.IH - L.ZD1 < USBC.FH + 1) err(`전자부 높이 ${(L.IH - L.ZD1).toFixed(1)}mm 가 세운 USB-C 플랜지(${USBC.FH}) + 1 보다 낮음`);
    if (foot.some(r => overlap(r, c6lZone) || overlap(r, L.pcb) || L.stand.some(s => overlap(sq(s, P.STANDOFF_D), r))))
      err('세운 USB-C 받침벽이 C6L/버튼 PCB 와 겹침 — 받침벽 위치(드래그)를 바꿀 것');
    if (overlap(u.cable, L.bat)) warn('케이블 구멍이 배터리 위에 있음 — 배터리 위 틈으로 케이블이 지나가야 한다. 케이블 자리(+X) 쪽으로');
    const c = u.c, ahead = (c[0] - st.f[0]) * st.d[0] + (c[1] - st.f[1]) * st.d[1], side = Math.abs((c[0] - st.f[0]) * st.d[1] - (c[1] - st.f[1]) * st.d[0]);
    if (ahead < (P.USBC_ROT ? P.CBL_W : P.CBL_L) / 2 + 10) warn(`케이블 구멍이 커넥터 면에서 ${ahead.toFixed(1)}mm — 플러그(약 15~20)가 누울 자리가 부족할 수 있다`);
    if (side > USBC.FL / 2) warn(`케이블 구멍이 커넥터 정면에서 옆으로 ${side.toFixed(1)}mm 벗어남`);
    if (P.USBW_T < P.INS2_L + 1) err(`받침벽 두께 ${P.USBW_T}mm 가 M2 인서트(${P.INS2_L}) + 1 보다 얇음`);
    info(`세운 USB-C(뚜껑 밑): 커넥터가 뚜껑과 함께 열린다 — 배터리 케이블 플러그를 구멍(${P.CBL_L}×${P.CBL_W})으로 올려 꽂은 뒤 뚜껑을 닫으므로 케이블이 뚜껑을 들 만큼 길어야 한다. 받침벽 뒤 양끝 리브가 미는 힘을 받는다`);
  }
  if (P.JOINT === 1 && P.COVER_FIX !== 1) {
    const b = L.pull.box, m = P.FIT + 1;
    if (b[0] < m || b[1] < m || b[2] > L.IX - m || b[3] > L.IY - m) err('바닥 손가락 구멍이 바닥판 가장자리를 벗어남 — 위치·크기를 바꿀 것');
    else if (cols.some(c => overlap(c, b))) err('바닥 손가락 구멍이 모서리 자석 기둥과 겹침');
  }
  if (u.mode === 1) info('배터리 → C6L 전원 경로 없음(격판에 구멍 없음)');
  const kr = L.cap ? L.cap.rr : P.BTN_HOLE_D / 2;
  for (const k of L.keys) for (const s of L.stand)
    if (Math.hypot(k[0] - s[0], k[1] - s[1]) <= kr + P.STANDOFF_D / 2) { err(L.cap ? '버튼 캡 턱 홈이 PCB 기둥과 겹침' : '버튼 구멍이 PCB 기둥과 겹침'); break; }
  if (L.cap) {
    const ks = L.keys;
    if (ks.some((k, i) => i && Math.hypot(k[0] - ks[i - 1][0], k[1] - ks[i - 1][1]) < 2 * L.cap.rr + 0.8)) err('버튼 캡 턱끼리 닿음 — 구멍이나 턱 폭을 줄일 것');
    if (L.cap.r - L.cap.rs < 0.8) err(`버튼 캡 벽이 얇음(${(L.cap.r - L.cap.rs).toFixed(1)}mm) — 구멍을 키우거나 스템 지름 확인`);
    if (P.LID_T - P.CAP_FL_T < 1) err('뚜껑 밑 캡 홈이 너무 깊음 — 구멍 둘레 뚜껑이 1mm 보다 얇다');
    if (L.PCB_GAP >= 3.5 && L.PCB_GAP - 3.5 < 0.4) warn(`캡 턱 밑 ~ 스위치 몸통 ${(L.PCB_GAP - 3.5).toFixed(1)}mm — 누를 거리가 모자랄 수 있음(캡 돌출을 줄이거나 윗면을 두껍게)`);
  }
  const mx = P.OLED_WX / 2 + L.maskOff;
  if (Math.abs(L.oled[0] - L.ubtn[0]) < mx + P.UBTN_D / 2 + 0.8) warn('OLED 마스크 경사가 C6L 버튼 구멍에 닿음');
  if (2 * C6L.SMA_DX <= P.ANT_D) err('안테나 자리 두 개가 서로 겹침');
  if (L.sma[0][1] + P.ANT_D / 2 > L.IH) info('안테나 자리가 벽 윗선까지 올라감 — 벽 위가 살짝 파인다(뚜껑이 덮음)');
  const thread = C6L.SMA_LEN - P.SMA_WALL;
  if (thread < 4) warn(`SMA 나사가 벽 밖으로 ${thread.toFixed(1)}mm 만 나옴(4mm 이상 권장)`);
  if (P.SMA_WALL >= P.WALL) warn('안테나 자리 벽이 벽 두께 이상 — 파기 효과 없음');
  const colH = L.IH - L.ZS;
  if (P.COVER_FIX === 1) {
    const grip = P.INS3_L - 0.5 - (L.coverBoltN - L.bolts.cover);
    if (grip < 3) warn(`바닥 볼트 M3×${L.bolts.cover} 가 뚜껑 인서트에 ${grip.toFixed(1)}mm 만 물림(3 이상 권장) — 머리 자리 깊이·길이 확인`);
    if (P.LID_CB_H > P.FLOOR + L.ZS - 1) err('바닥 볼트 머리 자리가 바닥 기둥보다 깊음 — 머리 자리 깊이를 줄이거나 바닥 높이를 늘릴 것');
    if (P.COL_D < Math.max(P.INS3_HOLE, P.LID_CB_D) + 2.4) warn('모서리 기둥 벽이 1.2mm 미만 — 인서트·볼트 머리 자리 주변이 약하다');
    info(`바닥 볼트 고정: 바닥 밑에서 M3×${L.bolts.cover} 4개가 통 기둥 → 격판 귀퉁이 기둥을 지나 뚜껑 밑 기둥 인서트에 체결 — 뚜껑·격판·통·바닥을 한 번에 조인다(손가락 구멍 없음 — 볼트를 풀고 뒤집으면 바닥이 빠진다)`);
  } else {
    if (P.INS3_L + 0.5 + P.MAG_T + 0.2 > colH - 1) err(`모서리 기둥(통 쪽 ${colH.toFixed(1)}mm)에 인서트와 자석 자리가 겹침`);
    if (P.COL_D < Math.max(P.INS3_HOLE, P.MAG_D) + 2.4) warn('모서리 기둥 벽이 1.2mm 미만 — 인서트·자석 자리 주변이 약하다');
    if (L.ZS + P.FLOOR < P.MAG_T + 0.2 + 0.6) err('바닥 자석 자리가 바닥판을 뚫음 — 바닥 자석 기둥 높이나 바닥판 두께를 늘릴 것');
  }
  if (L.PCB_GAP + P.LID_T - 0.8 < P.INS3S_L + 0.5) err('PCB 기둥+뚜껑이 짧은 M3 인서트보다 짧음 — 인서트 길이·스위치 높이 확인');
  if (P.STANDOFF_D < P.INS3_HOLE + 2.4) warn('PCB 기둥 벽이 1.2mm 미만');
  if (P.PIN_LEN > C6L.T) warn('레고 핀이 C6L 두께(8mm)보다 김');
  if (P.PIN_TAP) {
    if (P.PIN_D - 1 - P.PIN_TAP < 1.2) err(`레고 핀 탭 구멍 벽이 ${((P.PIN_D - P.PIN_TAP) / 2).toFixed(2)}mm — 끝 모따기에서 0.6mm 미만, 탭 구멍을 줄일 것`);
    if (L.IH - C6L.T - L.ZD0 < 2.85) warn(`C6L 밑 ~ 격판 밑 ${(L.IH - C6L.T - L.ZD0).toFixed(1)}mm — 볼트 머리·와셔(약 2.9)가 배터리에 닿을 수 있음`);
  }
  info('ST003 모듈: 사진상 헤더 핀·POWER LED 가 위로 솟아 있어 뚜껑에 닿는다 — 핀을 빼고 선을 직접 납땜, LED 는 눕힐 것');
  info('ST003 모듈: 사진상 둥근 캡(약 Ø11.5)이 끼워져 있다 — 캡을 쓰면 버튼 구멍 Ø12.5, 스위치 높이는 PCB~캡 끝 실측값으로');
  if (P.JOINT === 1) {
    const g0 = P.R_OUT - P.WALL, tc = L.rP < g0 ? P.R_OUT - ((g0 - L.rP) * Math.SQRT2 + L.rP) : P.WALL;
    const cr = P.COL_D / 2, m = Math.max(P.INS3_HOLE, P.MAG_D, P.LID_CB_D) / 2 + 1.2;
    if (L.rP > cr && L.rP - (L.rP - cr) * Math.SQRT2 < m) err(`끼움 판 귀퉁이 R ${L.rP.toFixed(1)} 이 모서리 기둥의 인서트·자석·볼트 자리를 깎음 — 귀퉁이 R 을 줄이거나 기둥 지름을 키울 것`);
    if (tc < 1.2) warn(`끼움 판 귀퉁이 R 이 작아 통 구멍 귀퉁이 벽이 ${tc.toFixed(1)}mm — 1.2 이상 권장(귀퉁이 R 을 키울 것)`);
    if (P.EDGE_R > Math.min(L.eL, L.eC)) info(`끼움 판 둘레 테두리 R 은 뚜껑 ${L.eL.toFixed(1)}·바닥 ${L.eC.toFixed(1)}mm 까지(판 두께·귀퉁이 R − 0.5)`);
  }
  if (P.TOP_R > L.rT || P.BOT_R > L.rB) info(`테두리 R 은 세로 모서리 R − 0.5(${P.R_OUT - 0.5}mm)까지 — 그 값으로 맞춤. 더 둥글게 하려면 세로 R 을 키울 것`);
  // 둥근 테두리가 안쪽 공간 모서리에 가장 가까운 곳의 벽 두께
  const rim = (r, t) => r > W2 && r > t ? r - Math.hypot(r - W2, r - t) : Math.min(W2, t);
  const W2 = P.WALL, tTop = rim(L.rT, P.LID_T), tBot = rim(L.rB, P.FLOOR);
  if (tTop < 1.2) warn(`윗면 테두리 R 때문에 통 윗모서리 벽이 ${tTop.toFixed(1)}mm — 1.2 이상 권장`);
  if (tBot < 1.2) warn(`아랫면 테두리 R 때문에 바닥 아랫모서리 벽이 ${tBot.toFixed(1)}mm — 1.2 이상 권장`);
  // 뚜껑 볼트 머리 자리가 윗면 평평한 곳에 있는지(바깥 모서리 기준 거리 a,b)
  const a = W2 + P.COL_D / 2, R = P.R_OUT;
  const rEdge = P.COVER_FIX === 1 ? L.rB : L.rT, flat = a < R ? (R - rEdge) - Math.hypot(R - a, R - a) : a - rEdge;
  if (flat < P.LID_CB_D / 2 + 0.2) warn(`${P.COVER_FIX === 1 ? '바닥' : '뚜껑'} 볼트 머리 자리가 둥근 테두리에 걸림 — ${P.COVER_FIX === 1 ? '아랫면' : '윗면'} R 을 줄이거나 기둥을 키울 것`);
  if (P.SEAM_H > L.ZD0) info(`바닥 기둥은 격판 밑(${L.ZD0}mm)까지만 — 그 값으로 맞춤`);
  if (P.JOINT === 1) {
    const need = (P.COL_D / 2 + P.FIT) * Math.SQRT2;
    if (L.ZS < need) err(`바닥 기둥이 낮아 통 기둥 밑 45° 경사가 바닥판까지 내려옴 — 바닥 높이 ${need.toFixed(1)}mm 이상`);
    else if (L.ZD0 - L.zCone < P.COL_D / 2 * (Math.SQRT2 + 1)) warn('격판 받침 턱 일부가 통 기둥 밑 경사에 걸림 — 바닥 높이를 낮추거나 배터리 칸을 높일 것');
  }
  if (P.COVER_FIX !== 1 && P.COL_D / 2 - SHELF_SH - P.INS3_HOLE / 2 < 1.2) err('격판 위 통 기둥(받침 턱만큼 가늘어짐)의 인서트 벽이 1.2mm 보다 얇음 — 모서리 기둥 지름을 키울 것');
  info(`격판은 따로 출력(판을 아래로) — ${P.COVER_FIX === 1 ? '통 기둥 윗면' : '통 기둥 턱'}${L.ribs.length ? '·누름 리브' : ''} 위에 얹고 ${P.COVER_FIX === 1 ? '귀퉁이 기둥을 관통하는 바닥 볼트로 조인다' : '뚜껑을 닫으면 C6L 누름 받침으로 눌린다'}. 통·뚜껑(뒤집어)·바닥·격판 모두 서포트 없이`);
  if (P.JOINT !== 1 && L.ribs.length && L.ZD0 - L.ZS <= 3) info('바닥 벽이 높아 통에 배터리 누름 리브 자리가 없음 — 리브를 넣으려면 바닥 높이를 낮출 것');
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
  return and(add(...parts), box(x0, y0, z0, x1, y1, z1));   // 테두리 R 이 판 두께의 절반보다 크면 모서리 원기둥이 반대쪽 면 밖으로 나간다
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
  const { IX, IY, IH, ZD0, ZD1, ZS } = L, W = P.WALL, ri = L.ri, cr = P.COL_D / 2, top = IH + P.LID_T;
  // 바깥 외피 하나(세로 R + 윗면·아랫면 테두리 R)를 세 부품이 나눠 곡면이 이어진다.
  // 끼움형(J): 옆면은 통이 전부 갖고 뚜껑·바닥은 통 윗·아랫구멍에 끼우는 판 → 옆면에 이음선 없음. 적층형: 높이(ZS, IH)로 잘라 쌓는다
  const J = P.JOINT === 1, zb = J ? 0 : ZS;   // zb: 통 배터리 칸 벽 밑
  const env = { t: 'rslab', p: [-W, -W, -P.FLOOR, IX + W, IY + W, top], R: P.R_OUT, rt: L.rT, rb: L.rB };
  const slab = (z0, z1) => and(env, box(-W - 1, -W - 1, z0, IX + W + 1, IY + W + 1, z1));
  const cav = (z0, z1) => rbox(0, 0, z0, IX, IY, z1, ri);
  const plug = (z0, z1) => rbox(P.FIT, P.FIT, z0, IX - P.FIT, IY - P.FIT, z1, Math.max(ri - P.FIT, 0.3));   // 안쪽 공간 − 틈(통 안 기둥 자르기용)
  // 끼움 판(귀퉁이 rP − FIT, 바깥면 둘레 테두리 rt/rb)과 통 구멍(귀퉁이 rP)
  const plate = (z0, z1, rt, rb) => ({ t: 'rslab', p: [P.FIT, P.FIT, z0, IX - P.FIT, IY - P.FIT, z1], R: Math.max(L.rP - P.FIT, 0.3), rt, rb });
  const hole = (z0, z1) => rbox(0, 0, z0, IX, IY, z1, L.rP);
  const inset = (d, z0, z1) => rbox(d, d, z0, IX - d, IY - d, z1, Math.max(ri - d, 0.3));   // 안쪽 공간을 d 만큼 줄인 것
  // 모서리 기둥: 원기둥을 벽 쪽으로 밀어 겹쳐 벽과 한 덩어리로, 안쪽 공간으로 잘라낸다
  // clip: 통 기둥은 안쪽 공간보다 0.05 크게 잘라 벽과 살짝 겹친다(곡면이 딱 맞닿으면 부피 0 조각이 떨어져 나온다), 바닥 기둥은 끼우는 판 윤곽으로
  const column = ([x, y], z0, z1, clip = rbox(-0.05, -0.05, z0, IX + 0.05, IY + 0.05, z1, ri + 0.05), r = cr) => {
    const dx = x < IX / 2 ? -cr : cr, dy = y < IY / 2 ? -cr : cr;
    return and(add(...[[0, 0], [dx, 0], [0, dy], [dx, dy]].map(([ox, oy]) => vcyl([x + ox, y + oy], z0, z1, r))), clip);
  };
  // 끼움형 통 기둥 밑: 안쪽 모서리에 꼭짓점을 둔 45° 원뿔 안만 남겨 벽에서 비스듬히 자라 나온다(서포트 없음). 바닥 기둥은 같은 원뿔을 FIT 만큼 내려 파낸다
  const corner = ([x, y]) => [x < IX / 2 ? 0 : IX, y < IY / 2 ? 0 : IY];
  const cone = (c, z0, z1) => { const [qx, qy] = corner(c); return cyl([qx, qy, z0 + 0.05], [qx, qy, z1], 0.05, z1 - z0); };
  // 원뿔 면(기둥 중심, 높이 ZS)에 수직인 자석 자리: 법선 n = 통 → 바닥 쪽
  const tiltMag = (c, intoBody) => {
    const [qx, qy] = corner(c), n = [Math.sign(c[0] - qx) / 2, Math.sign(c[1] - qy) / 2, -Math.SQRT1_2], k = intoBody ? -1 : 1;
    const p0 = [c[0], c[1], ZS], deep = P.MAG_T + 0.2 + (intoBody ? 0 : P.FIT);
    return cyl(p0.map((v, i) => v - k * n[i]), p0.map((v, i) => v + k * deep * n[i]), P.MAG_D / 2 + 0.1);
  };
  const magnet = (c, zFace, up) => vcyl(c, up ? zFace - 1 : zFace - P.MAG_T - 0.2, up ? zFace + P.MAG_T + 0.2 : zFace + 1, P.MAG_D / 2 + 0.1);
  // 바닥 고정: 자석 = 통·바닥 기둥 맞닿는 면에 자석 자리, 볼트 = 관통 구멍 + 바닥 밑 머리 자리(통 기둥 윗부분 lidBoss 는 뚜껑이 갖는다)
  const B = P.COVER_FIX === 1, colTop = IH - L.lidBoss;
  const coverFix = c => B ? [vcyl(c, -P.FLOOR - 1, ZS + 2, M3_CLEAR / 2), vcyl(c, -P.FLOOR - 1, -P.FLOOR + P.LID_CB_H, P.LID_CB_D / 2)] : [J ? tiltMag(c, false) : magnet(c, ZS, false)];

  // Body: 벽(끼움형: 바닥~윗면, 적층형: ZS~IH) + 기둥(위 = M3 인서트·뚜껑 받침, 아래 = 자석, 격판 높이에서 SHELF_SH 만큼 가늘어져 격판 받침 턱) + 누름 리브
  const u = L.usbc, st = u.stand, usbHoles = u.mode === 0 ? [u.flange] : u.mode === 2 ? [u.cable] : u.mode === 3 ? [u.cable, st.foot] : [];
  const smaRecess = ([sy, sz]) => cyl([-W - 1, sy, sz], [-P.SMA_WALL, sy, sz], P.ANT_D / 2);
  const body = sub(
    add(J ? sub(slab(-P.FLOOR - 1, top + 1), cav(-0.5, IH + 0.5), hole(-P.FLOOR - 2, 0), hole(IH, top + 2)) : sub(slab(ZS, IH), cav(ZS - 1, IH + 1)),
      ...L.cols.flatMap(c => [...(ZS < ZD0 ? J ? [and(column(c, L.zCone, ZD0), cone(c, L.zCone, ZD0 + 1)), sub(column(c, 0, ZD0), inset(SEAT_W, -1, ZD0 + 1))] : [column(c, ZS, ZD0)] : []),
        ...(B ? [] : [column(c, Math.max(ZD0 - 0.2, ZS), colTop, undefined, cr - SHELF_SH)])]),
      // 누름 리브: 아래 2mm 는 가늘게(조임 0) 시작해 배터리가 걸리지 않고 들어간다. 벽까지 판으로 이어 한 덩어리로
      ...(ZD0 - zb > 3 ? L.ribs.flatMap(([x, y, wy]) => [
        cyl([x, y, zb], [x, y, zb + 2], RIB_R - P.RIB_PRESS, RIB_R), vcyl([x, y], zb + 2, ZD0, RIB_R),
        box(x - RIB_R, Math.min(y, wy), zb, x + RIB_R, Math.max(y, wy), ZD0)]) : [])),
    ...L.cols.flatMap(c => B ? [vcyl(c, Math.min(ZS, L.zCone) - 1, IH + 1, M3_CLEAR / 2)] : [vcyl(c, IH - P.INS3_L - 0.5, IH + 1, P.INS3_HOLE / 2), J ? tiltMag(c, true) : magnet(c, ZS, true)]),
    ...L.sma.flatMap(([sy, sz]) => [            // -X 벽: 위가 열린 SMA 홈(끼움형: 뚜껑 혀가 윗부분을 메움) + 바깥에서 안테나 지름만큼 파서 벽을 얇게
      cyl([-W - 1, sy, sz], [1, sy, sz], P.SMA_HOLE_D / 2),
      box(-W - 1, sy - P.SMA_HOLE_D / 2, sz, 1, sy + P.SMA_HOLE_D / 2, (J ? top : IH) + 1),
      ...(P.SMA_WALL < W ? [smaRecess([sy, sz])] : [])]));

  // Shelf: 따로 출력하는 격판(판을 아래로). 통 기둥 턱·누름 리브 윗면(ZD0)에 얹는다. 자석: 뚜껑을 닫으면 C6L 이 누름 받침을 눌러 고정
  // 볼트: 격판 위 기둥(뚜껑 밑 기둥까지)을 격판이 갖고 귀퉁이가 통 기둥 윗면에 얹혀, 바닥 볼트가 바닥·통·격판·뚜껑을 함께 조인다
  const shelf = sub(add(plug(ZD0, ZD1), ...(B ? L.cols.map(c => column(c, ZD1 - 0.1, colTop, plug(ZD1 - 0.1, colTop), cr - SHELF_SH)) : []),
      ...L.c6lPads.filter(p => !usbHoles.some(r => overlap(sq(p, P.C6L_PAD_D), r))).map(p => vcyl(p, ZD1 - 0.1, IH - C6L.T + P.C6L_PRESS, P.C6L_PAD_D / 2)),
      ...(u.mode === 0 ? u.holes.map(h => vcyl(h, ZD1 - 0.1, ZD0 + P.INS2_L + 1.2, P.INS2_HOLE / 2 + 1.6)) : [])),
    ...L.cols.map(c => B ? vcyl(c, ZD0 - 1, colTop + 1, M3_CLEAR / 2) : column(c, ZD0 - 1, ZD1 + 1, undefined, cr - SHELF_SH + P.FIT)),
    ...(u.mode === 0 ? [rect(u.slot, ZD0 - 1, ZD1 + 1), ...u.holes.map(h => vcyl(h, ZD0 - 1, ZD0 + P.INS2_L + 0.3, P.INS2_HOLE / 2))] : []),
    ...(u.mode >= 2 ? [stadium(u.cable, ZD0 - 1, ZD1 + 1)] : []),
    ...(P.PIN_TAP ? L.pins.map(p => vcyl(p, ZD0 - 1, ZD1 + 1, C6L_HEAD_D / 2)) : []));   // C6L 밑 볼트 머리 자리(C6L 밑 틈이 1mm 뿐이라 격판을 뚫는다)

  let cover;
  if (J) {
    // 반달 손가락 구멍(위치·크기·둥근 쪽 조절): 바깥 모서리를 0.8 깎는다 → 곧은 변에 손끝을 걸어 바닥을 당긴다(옆으로 튀어나온 혀는 부러져서 없앰)
    const { c: [px, py], r, v } = L.pull, e = r + 3, half = box(v[0] > 0 ? px : px - e, v[1] > 0 ? py : py - e, -P.FLOOR - 2, v[0] < 0 ? px : px + e, v[1] < 0 ? py : py + e, 2);
    const pull = B ? [] : [and(add(vcyl([px, py], -P.FLOOR - 1, 1, r), cyl([px, py, -P.FLOOR - 1], [px, py, -P.FLOOR + 0.8], r + 1.8, r)), half)];   // 반달 + 바깥 모서리 0.8 모따기
    // Cover: 통 아랫구멍에 끼우는 판 + 모서리 자석 기둥(0~ZS, 통 기둥 밑면과 자석끼리 붙음)
    cover = sub(add(and(env, plate(-P.FLOOR, 0, 0, L.eC)), ...(ZS > 0.5 ? L.cols.map(c => {
      const z1 = Math.min(ZS + 1.5, ZD0 - 0.5);   // 원뿔 자리 바깥 테두리는 얇아지므로 ZS + 1.5 에서 자른다
      // 높이는 평면 받침(벽 쪽 SEAT_W 띠)이 정하고, 원뿔 면은 FIT 만큼 띄워 닿지 않는다(45° 면은 출력 오차가 높이로 √2 배)
      return sub(column(c, -0.5, z1, inset(SEAT_W + P.FIT, -0.5, z1)), cone(c, L.zCone - P.FIT * Math.SQRT2, z1 + 1));
    }) : [])),
      ...L.cols.flatMap(coverFix), ...pull);
  } else {
    // 손가락 홈(바깥에서만, 안쪽 0.8 남김)은 이음선의 높은 쪽 부품에 — 바닥이 낮으면 통에 파서 바닥 벽 윗모서리를 손끝으로 당긴다
    const notch = cyl([IX / 2, -W - 1, ZS], [IX / 2, -0.8, ZS], P.NOTCH_R), notchInBody = ZS + P.FLOOR < ZD0 - ZS;
    if (notchInBody && !B) body.c.push(notch);
    // Cover: 바닥판 + 벽(ZS) + 기둥 자석 자리
    cover = sub(ZS > 0.5
      ? add(sub(slab(-P.FLOOR - 1, ZS), cav(0, ZS + 1)), ...L.cols.map(c => column(c, -0.5, ZS)))
      : slab(-P.FLOOR - 1, ZS), ...L.cols.flatMap(coverFix), ...(notchInBody || B ? [] : [notch]));
  }

  // Lid: 조립 위치(z=IH 위). 출력은 뒤집어서
  const g = L.PCB_GAP, pin = P.PIN_D / 2;
  // 끼움형: 통 윗구멍에 끼우는 판(통 기둥 윗면에 얹혀 볼트로 고정) + SMA 홈 윗부분을 메우는 혀. 적층형: 통 위 외피 전체
  const tabs = L.sma.map(([sy]) => box(-W - 1, sy - P.SMA_HOLE_D / 2 + P.FIT, IH, P.FIT + 0.5, sy + P.SMA_HOLE_D / 2 - P.FIT, top + 1));
  const lid = sub(add(J ? and(env, add(plate(IH, top, L.eL, 0), ...tabs)) : slab(IH, top + 1),
      ...L.pins.flatMap(([x, y]) => [cyl([x, y, IH - P.PIN_LEN + 0.6], [x, y, IH], pin), cyl([x, y, IH - P.PIN_LEN], [x, y, IH - P.PIN_LEN + 0.6], pin - 0.5, pin)]),
      and(add(...L.stand.map(s => vcyl(s, IH - g, IH + 0.5, P.STANDOFF_D / 2))), plug(IH - g - 1, IH + 0.5)),   // 벽 쪽은 끼우는 판 윤곽으로 잘라 통에 닿지 않게
      ...(u.mode === 3 ? [and(add(...[st.bracket, ...st.ribs].map(r => rect(r, st.z0, IH + 0.5))), plug(st.z0 - 1, IH + 0.5))] : []),
      ...(B ? L.cols.map(c => column(c, colTop, IH + 0.5, plug(colTop - 1, IH + 0.5))) : [])),   // 세운 USB-C 받침벽(뚜껑 밑), 볼트 고정: 뚜껑 밑 인서트 기둥
    ...L.stand.map(s => vcyl(s, IH - g - 1, IH - g + P.INS3S_L + 0.5, P.INS3_HOLE / 2)),
    ...(P.PIN_TAP ? L.pins.map(p => vcyl(p, IH - P.PIN_LEN - 1, top - 1, P.PIN_TAP / 2)) : []),   // 레고 핀 탭: 윗면 1mm 남김
    box(L.oled[0] - P.OLED_WX / 2, L.oled[1] - P.OLED_WY / 2, IH - 1, L.oled[0] + P.OLED_WX / 2, L.oled[1] + P.OLED_WY / 2, top + 1),
    // OLED 마스크: 창 둘레는 MASK_T, 바깥으로 경사져 올라가 뚜껑 두께로
    ...(P.MASK_T < P.LID_T ? [{ t: 'frustum', c: L.oled, z0: IH + P.MASK_T, z1: top + 0.5, w0: [P.OLED_WX, P.OLED_WY],
      off: (top + 0.5 - IH - P.MASK_T) / Math.tan(P.MASK_SLOPE * Math.PI / 180) }] : []),
    vcyl(L.ubtn, IH - 1, top + 1, P.UBTN_D / 2),
    ...L.keys.map(k => vcyl(k, IH - 1, top + 1, P.BTN_HOLE_D / 2)),
    ...(L.cap ? L.keys.map(k => vcyl(k, IH - 1, IH + P.CAP_FL_T, L.cap.rr)) : []),
    ...L.cols.flatMap(c => B ? [vcyl(c, colTop - 1, top - 1, P.INS3_HOLE / 2)] : [vcyl(c, IH - 1, top + 1, M3_CLEAR / 2), vcyl(c, top - P.LID_CB_H, top + 1, P.LID_CB_D / 2)]),
    ...(P.SMA_WALL < W ? L.sma.map(smaRecess) : []),
    ...(u.mode === 3 ? [rect(st.slot, st.zc - P.USBC_SLOT_T / 2, st.zc + P.USBC_SLOT_T / 2), ...st.ins.map(([a, b]) => cyl(a, b, P.INS2_HOLE / 2))] : []));

  // 맞춤 확인용 부품 (출력 안 함)
  const c = L.c6l, p = L.pcb, pz = IH - g - PCB.T;
  const refs = {
    REF_battery: rect(L.bat, 0, P.BAT_T),
    REF_C6L: add(box(c[0], c[1], IH - C6L.T, c[2], c[3], IH), ...L.sma.map(([sy, sz]) => cyl([c[0], sy, sz], [c[0] - C6L.SMA_LEN, sy, sz], 3.2))),
    REF_buttonPCB: add(rect(p, pz, pz + PCB.T),
      ...L.keysAll.map(([x, y]) => box(x - 6, y - 6, pz + PCB.T, x + 6, y + 6, pz + PCB.T + 3.5)),
      ...L.keysAll.map(k => vcyl(k, pz + PCB.T, pz + PCB.T + P.SW_H, P.STEM_D / 2))),
  };
  // 부속 RP-SMA 휩 안테나(docs: Wi-Fi 84·LoRa 108mm, 사진상 OLED 를 위로 두면 LoRa 가 −Y 쪽): 벽 파기 바닥에서 마디, 거기서 ANT_FOLD 만큼 위로 꺾임
  const fa = P.ANT_FOLD * Math.PI / 180, dir = [-Math.cos(fa), 0, Math.sin(fa)];
  const ant = ([sy, sz], len) => {
    const h0 = [-P.SMA_WALL, sy, sz], h1 = [-P.SMA_WALL - ANT_HUB, sy, sz];
    return add(cyl(h0, h1, P.ANT_D / 2 - 0.3), cyl(h1, h1.map((v, i) => v + dir[i] * (len - ANT_HUB)), 3.5, 2.5));
  };
  refs.REF_antLoRa = ant(L.sma[0], P.ANT_LORA_L);
  refs.REF_antWiFi = ant(L.sma[1], P.ANT_WIFI_L);
  if (u.mode === 3) refs.REF_usbc = add(rect(st.flange, st.zc - USBC.FH / 2, st.zc + USBC.FH / 2), rect(st.body, st.zc - USBC.BODY_T / 2, st.zc + USBC.BODY_T / 2));
  if (u.mode === 0) refs.REF_usbc = add(rect(u.flange, ZD0 - USBC.FT, ZD0), rect(u.body, ZD0, ZD0 - USBC.FT + USBC.BODY_L));
  const bodies = { Lid: lid, Body: body, Shelf: shelf, Cover: cover };
  if (L.cap) { const { r, rf, rs } = L.cap;
    bodies.Keys = add(...L.keys.map(k => sub(add(vcyl(k, IH, IH + P.CAP_FL_T, rf), vcyl(k, IH, top + P.CAP_PROUD, r)), vcyl(k, IH - 1, top + P.CAP_PROUD - P.CAP_TOP_T, rs)))); }
  return { L, warn, bodies, refs };
}

// case.json: 파라미터 + 트리. Fusion 스크립트가 이것만 읽는다
export const caseJson = P => { const m = model(P); return { version: 2, params: P, layout: m.L, bodies: m.bodies, refs: m.refs }; };
