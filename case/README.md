# C6L 버튼 케이스 설계툴

Unit C6L + 카드형 배터리 + 3버튼 PCB(66.04×22.352)를 담는 3D 프린트 케이스. 슬라이더로 치수를 바꾸면 3D·평면·단면·경고가 바로 바뀌고, STL 을 브라우저에서 바로 받는다. Fusion 에서도 같은 형상을 B-rep 으로 만들 수 있다.

- 열기: `case/` 를 정적 서버로 연다(ES 모듈·WASM 이라 `file://` 로는 안 열림).

```bash
python3 -m http.server 8817 -d case
```

  → http://127.0.0.1:8817/
- 구조: 아래층 = 배터리(바닥에 눕힘), 위층 = 뚜껑 밑에 매단 C6L(뒤 줄, OLED 창·사용자 버튼 창) + 버튼 PCB(앞 줄, 기둥 4개). 뚜껑은 M3 셀프태핑 4개.
- 벽 구멍: -X 벽 SMA 홈 2개(위가 열림, 바깥 자리파기), 뒤 벽 USB-C, +X 벽 배터리 충전구.

## 파일

| 경로 | 내용 |
|---|---|
| `core.js` | 단일 진실: 파라미터(`DEFS`) → 배치 → 경고 → CSG 트리(box/cyl/add/sub/and) |
| `csg.js` | 트리 → manifold-3d 3.5.4 메시, 바이너리 STL |
| `app.js`, `index.html`, `style.css` | 화면(플라이트 케이스 설계 앱과 같은 틀, three.js) |
| `check.mjs` | `node case/check.mjs` — 기본값 오류 0, Base·Lid 부피, 슬라이더 양 끝 계산, `C6LCaseBuild/c6l-case.json` 갱신 |
| `C6LCaseBuild/` | Fusion 스크립트. `c6l-case.json`(이 폴더 또는 ~/Downloads 중 최근 것)의 트리를 TemporaryBRepManager 로 계산 |

## Fusion

1. 툴에서 **case.json 저장** → `c6l-case.json` (다운로드 폴더면 그대로 둬도 된다).
2. `C6LCaseBuild/` 폴더를 맥 `~/Library/Application Support/Autodesk/Autodesk Fusion 360/API/Scripts/` 에 복사.
3. Fusion **Shift+S** → `C6LCaseBuild` 실행 → 새 문서에 Base·Lid·REF_ 부품, `out/` 에 STL.

## 치수 출처·가정

- C6L: docs.m5stack.com U202 Model Size(24×56×8, SMA 간격 14, Ø5 레고 구멍 16 간격·끝에서 12). OLED·버튼·USB 위치는 도면 비례 측정.
- 버튼 PCB: 첨부 도면(구멍 간격 59.944×16.764). 키 X 는 비례 측정(피치 20.32).
- **가정값:** 배터리 88×56×9(신용카드 크기 보조배터리), 택트 스위치 12×12×7.3, SMA 중심 = 앞면에서 5mm. 실물로 확인해 바꿀 것.
- Fusion 실행은 아직 검증하지 않았다(2026-11-09, Fusion MCP 미연결).
