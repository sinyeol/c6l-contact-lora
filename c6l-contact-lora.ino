// M5Stack Unit C6L 접점 LoRa — 한 펌웨어로 송신기(ID 1~25)와 수신기(ID 0)를 겸한다.
// 송신기: 버튼 2개(READY/STANDBY 래치)를 LoRa 로 보낸다(누르면 ACK, 평소 3초 하트비트). 수신기 비콘으로 동기화.
// 수신기: LoRa 로 받아 USB(브라우저 앱)·Wi-Fi AP(C6L-GW, http://192.168.4.1)로 25대 상태를 보여 준다.
// 와이파이 일괄 업데이트: 앱이 USB 로 수신기에 펌웨어를 올리면, 수신기가 송신기를 한 대씩 불러 AP 의 /fw.bin 으로 업데이트.
// ID 는 본체 버튼으로 정한다: 2초 길게 = 설정 모드, 짧게 = +1(25 다음 GW), 다시 2초 길게 = 저장 후 재부팅.
#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPUpdate.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <RadioLib.h>
#include <U8g2lib.h>
#include "page.h"
#include "proto.h"
#if __has_include("secrets.h")
#include "secrets.h"  // 현장용 AP 비밀번호(C6L_AP_PASS) — git 에 올리지 않는다(.gitignore). 수신기·송신기 모두 같은 값으로 빌드
#endif

// ---- 펌웨어 버전 — 올릴 때마다 1 씩. 하트비트에 실려 앱에 보이고, 앱은 .bin 안의 표식(FW_MARK)으로 버전을 읽는다 ----
#define FW_VERSION 12
#define XSTR(x) STR(x)
#define STR(x) #x
const char FW_MARK[] = "C6LFW-VER=" XSTR(FW_VERSION) ";";

// ---- 설정 ----
// 국내 920MHz 대역(KR920)만 쓴다 — 아래 static_assert 가 대역·채널·출력을 벗어나면 빌드를 막는다(실행 중 바꾸는 명령은 없음)
//  채널 920.9~923.3MHz, 200kHz 간격 / EIRP 920.9~921.9MHz 10dBm, 922.1~923.3MHz 14dBm
//  LBT: 송신 전 5ms 이상 들어 -65dBm 이하일 때만, 송신 4초 이내, 송신 뒤 50ms 이상 쉼 (krTransmit)
constexpr uint32_t FREQ_HZ = 922100000;
constexpr int8_t TX_DBM = 10;            // 모듈 출력
constexpr int8_t ANT_GAIN_DBI = 3;       // 동봉 안테나 3dBi — 다른 안테나로 바꾸면 이 값을 고친다
constexpr int8_t KR_MAX_EIRP = FREQ_HZ <= 921900000 ? 10 : 14;
static_assert(FREQ_HZ >= 920900000 && FREQ_HZ <= 923300000 && (FREQ_HZ - 920900000) % 200000 == 0,
              "국내 KR920 채널(920.9~923.3MHz, 200kHz 간격)만 쓸 수 있습니다");
static_assert(TX_DBM + ANT_GAIN_DBI <= KR_MAX_EIRP, "국내 EIRP 상한을 넘습니다 (TX_DBM 또는 안테나 이득을 낮추세요)");
constexpr uint8_t N_NODES = 25;
// 2026-11-09 사용자: 꺼짐 판정 35초는 길다 → 8초. 하트비트는 ACK 없이(누를 때만 ACK), 송신기 동기화는 수신기 비콘으로
constexpr uint32_t HEARTBEAT_MS = 3000;   // +0~0.5초 지터. 25대 × (패킷 36ms + LBT 6ms) / 3.25초 ≈ 채널 32%
constexpr uint32_t BEACON_MS = 3000;      // 수신기 비콘(+0~0.3초) — 각 송신기가 수신기에 들어간 자기 상태를 확인. 약 1.3%
constexpr uint32_t OFFLINE_MS = 8000;     // 하트비트 2번 반 놓치면 꺼짐 — page.h 의 OFF(초)와 같은 값
constexpr uint32_t LINK_LOST_MS = 8000;   // 송신기: 비콘·ACK 를 이만큼 못 받으면 link -- · READY 지움
constexpr uint32_t ACK_WAIT_MS = 300;
const char *AP_SSID = "C6L-GW";
#ifndef C6L_AP_PASS
#define C6L_AP_PASS "c6l-12345"          // 공개 저장소의 기본값 — 현장에서는 secrets.h 로 바꾼다(8자 이상)
#endif
const char *AP_PASS = C6L_AP_PASS;

// ---- 핀 (Meshtastic variants/esp32c6/m5stack_unitc6l 기준) ----
constexpr int PIN_IN1 = 4, PIN_IN2 = 5;  // Grove: 흰=G4, 노랑=G5, 검정=GND (빨강 5V 는 쓰지 않음)
constexpr int LORA_SCK = 20, LORA_MISO = 22, LORA_MOSI = 21, LORA_CS = 23, LORA_DIO1 = 7, LORA_BUSY = 19;
constexpr int OLED_CS = 6, OLED_DC = 18, OLED_RST = 15;  // SSD1306 64x48, LoRa 와 SPI 공유
constexpr int I2C_SDA = 10, I2C_SCL = 8;
constexpr uint8_t PI4IO = 0x43;          // IO 확장칩: P0 버튼, P5 LNA_EN, P6 ANT_SW, P7 SX_NRST

// 패킷: STATE(누름, ACK 요청) / HB(하트비트, ACK 없음) = MAGIC 타입 id seq bits cnt1 cnt2 ver (v1.1 이하는 ver 없이 7바이트)
//       ACK = MAGIC T_ACK id seq bits(수신기가 저장한 상태) / BEACON = MAGIC T_BEACON + 25대 × 2비트(proto.h)
//       OTA = MAGIC T_OTA id 목표버전 — 그 송신기만 와이파이 업데이트 시작
constexpr uint8_t MAGIC = 0xC6, T_STATE = 1, T_ACK = 2, T_HB = 3, T_BEACON = 4, T_OTA = 5;
static_assert(N_NODES == BEACON_NODES, "비콘 칸 수와 송신기 수가 같아야 합니다");

SX1262 radio = new Module(LORA_CS, LORA_DIO1, RADIOLIB_NC, LORA_BUSY);  // NRST 는 확장칩 P7
U8G2_SSD1306_64X48_ER_F_4W_HW_SPI oled(U8G2_R2, OLED_CS, OLED_DC, OLED_RST);  // R2 = 180° (2026-11-09 사용자: R0 은 뒤집혀 보임)
Preferences prefs;
WebServer web(80);

volatile bool radioIrq = false;
void IRAM_ATTR onRadioIrq() { radioIrq = true; }

uint8_t myId = 255;                      // 255 = 미설정, 0 = 수신기, 1~25 = 송신기
bool radioOk = false;
int radioErr = 0;                        // 마지막 초기화 결과 (RadioLib 코드)

// ---- IO 확장칩 PI4IOE5V6408 ----
uint8_t ioWrite(uint8_t reg, uint8_t v) {  // 0 = 성공 (Wire.endTransmission 결과)
  Wire.beginTransmission(PI4IO);
  Wire.write(reg);
  Wire.write(v);
  return Wire.endTransmission();
}
uint8_t ioRead(uint8_t reg) {
  Wire.beginTransmission(PI4IO);
  Wire.write(reg);
  Wire.endTransmission();
  Wire.requestFrom(PI4IO, (uint8_t)1);
  return Wire.read();
}
int ioInit() {  // Meshtastic c6l_init() 과 같은 레지스터 순서, 인터럽트 설정만 뺌. 실패한 I2C 쓰기 수를 돌려준다
  int bad = ioWrite(0x01, 0xFF) != 0; delay(10); ioRead(0x01);  // 칩 리셋
  bad += ioWrite(0x03, 0b11100000) != 0;  // P5~P7 출력
  bad += ioWrite(0x07, 0b00011100) != 0;  // P2~P4 하이임피던스
  bad += ioWrite(0x0D, 0b11100011) != 0;  // 풀업 선택
  bad += ioWrite(0x0B, 0b11100011) != 0;  // 풀업 사용(P0 버튼 포함)
  bad += ioWrite(0x05, 0b00000000) != 0;  // SX1262 리셋 유지
  delay(100);
  bad += ioWrite(0x05, 0b11100000) != 0;  // 리셋 해제 + ANT_SW + LNA_EN
  delay(10);
  return bad;
}
bool buttonDown() { return !(ioRead(0x0F) & 0x01); }

// ---- 접점 입력 (닫힘 = LOW, 30ms 디바운스, 닫힐 때마다 카운트) ----
struct Input { uint8_t pin; bool raw, stable; uint32_t since; uint8_t count; };
Input ins[2] = {{PIN_IN1}, {PIN_IN2}};
bool dirty = false;
bool ready = false;  // 전원 켜면 STANDBY. 접점1 누르면 READY, 접점2 누르면 STANDBY 로 바뀌어 유지(래치)

void pollInputs() {
  uint32_t now = millis();
  for (auto &in : ins) {
    bool closed = digitalRead(in.pin) == LOW;
    if (closed != in.raw) { in.raw = closed; in.since = now; }
    else if (closed != in.stable && now - in.since >= 30) {
      in.stable = closed;
      if (closed) {  // 누를 때만: 상태 전환 + 횟수(255 다음 0). 뗄 때는 보낼 것이 없다
        in.count++;
        ready = &in == &ins[0];
        dirty = true;
      }
    }
  }
}
uint8_t bits() { return ready ? 1 : 2; }  // 1 = READY, 2 = STANDBY (수신기·앱이 이 비트를 그대로 표시)

// ---- 국내 LBT 송신: 직전 송신 뒤 50ms 쉼 → 5ms 이상 들어 -65dBm 이하면 송신 (송신기·수신기 공통) ----
constexpr int ERR_CHANNEL_BUSY = -1000;
uint32_t lastTxEndMs = 0;
bool channelClear() {
  radio.startReceive();
  delayMicroseconds(500);  // 수신 모드 진입
  for (uint32_t t0 = micros(); micros() - t0 < 5500;)
    if (radio.getRSSI(false) > -65.0f) return false;  // 순간 RSSI
  return true;
}
int krTransmit(const uint8_t *buf, size_t len, int tries) {
  for (int i = 0; i < tries; i++) {
    while (millis() - lastTxEndMs < 50) { pollInputs(); delay(1); }
    if (channelClear()) {
      int st = radio.transmit(buf, len);  // 7바이트 ≈ 36ms (4초 제한과 거리가 멂)
      lastTxEndMs = millis();
      radioIrq = false;  // 송신 완료도 DIO1 을 울린다
      return st;
    }
    delay(random(5, 20));
  }
  radioIrq = false;
  return ERR_CHANNEL_BUSY;
}

// ---- 송신기 ----
uint8_t seq = 0, fails = 0;
uint8_t syncedBits = 0;  // 수신기가 ACK·비콘으로 되돌려 준 내 상태 — OLED 는 이 값만 보여 준다(0 = 아직/끊김)
uint32_t nextTry = 0, nextHb = 0, lastHeardMs = 0;
bool pending = true, linkOk = false;
uint8_t otaTarget = 0;   // 수신기가 업데이트하라고 부른 목표 버전 (0 = 없음)

bool nodePacket(const uint8_t *b, size_t len, uint8_t wantSeq) {  // 비콘이면 동기화, 내 ACK 면 true
  if (len == 4 && b[0] == MAGIC && b[1] == T_OTA && b[2] == myId) {
    if (b[3] != FW_VERSION) otaTarget = b[3];  // 이미 그 버전이면 무시 (수신기는 하트비트의 버전을 보고 완료로 친다)
    return false;
  }
  if (len == 2 + BEACON_BYTES && b[0] == MAGIC && b[1] == T_BEACON) {
    syncedBits = beaconGet(b + 2, myId);  // 0 = 수신기가 나를 꺼짐으로 봄
    linkOk = syncedBits != 0;
    lastHeardMs = millis();
    return false;
  }
  if (len == 5 && b[0] == MAGIC && b[1] == T_ACK && b[2] == myId && b[3] == wantSeq) {
    syncedBits = b[4];
    linkOk = true;
    lastHeardMs = millis();
    return true;
  }
  return false;  // 다른 송신기의 패킷 등
}
bool readNodePacket(uint8_t wantSeq) {  // radioIrq 가 선 뒤에 부른다. 끝나면 다시 수신 모드
  radioIrq = false;
  uint8_t b[2 + BEACON_BYTES];
  size_t len = radio.getPacketLength();  // readData 보다 먼저 불러야 한다
  bool mine = radio.readData(b, sizeof b) == RADIOLIB_ERR_NONE && nodePacket(b, len, wantSeq);
  radio.startReceive();
  return mine;
}

bool sendOnce() {  // 누름: ACK 를 받아야 성공
  uint8_t p[8] = {MAGIC, T_STATE, myId, ++seq, bits(), ins[0].count, ins[1].count, FW_VERSION};
  if (krTransmit(p, sizeof p, 1) != RADIOLIB_ERR_NONE) return false;  // 채널이 차 있으면 이번 시도는 접고 물러난다
  radio.startReceive();
  for (uint32_t t0 = millis(); millis() - t0 < ACK_WAIT_MS;) {
    pollInputs();
    if (radioIrq && readNodePacket(seq)) return true;
  }
  return false;  // 수신 모드는 그대로(비콘을 계속 듣는다)
}

void sendHeartbeat() {  // ACK 없음 — 수신기의 꺼짐 판정용
  uint8_t p[8] = {MAGIC, T_HB, myId, ++seq, bits(), ins[0].count, ins[1].count, FW_VERSION};
  krTransmit(p, sizeof p, 3);
  radio.startReceive();
}

// ---- 송신기 와이파이 업데이트: 수신기 AP(C6L-GW)에 붙어 /fw.bin 을 받아 설치하고 재부팅 ----
void otaScreen(const char *l3) {
  char l1[12];
  snprintf(l1, sizeof l1, "ID %02u", myId);
  oled.clearBuffer();
  oled.setFont(u8g2_font_9x15_tr);
  oled.drawStr(0, 14, l1);
  oled.drawStr(0, 31, "UPDATE");
  oled.setFont(u8g2_font_5x8_tr);
  oled.drawStr(0, 45, l3);
  oled.sendBuffer();
}
void doOta() {
  uint8_t target = otaTarget;
  otaTarget = 0;
  Serial.printf("ota start v%u -> v%u\n", FW_VERSION, target);
  radio.standby();  // 업데이트 동안 LoRa 는 쉰다 — 수신기는 8초 뒤 꺼짐으로 보고, 새 버전 하트비트가 오면 완료로 친다
  otaScreen("wifi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(AP_SSID, AP_PASS);
  for (uint32_t t0 = millis(); WiFi.status() != WL_CONNECTED && millis() - t0 < 20000;) delay(100);
  if (WiFi.status() == WL_CONNECTED) {
    otaScreen("download");
    httpUpdate.onProgress([](int cur, int total) {
      static int lastStep = -1;
      int pct = total > 0 ? (int)((int64_t)cur * 100 / total) : 0;
      if (pct / 10 == lastStep) return;
      lastStep = pct / 10;
      char s[12];
      snprintf(s, sizeof s, "%d%%", pct);
      otaScreen(s);
    });
    httpUpdate.rebootOnUpdate(true);
    WiFiClient client;
    t_httpUpdate_return r = httpUpdate.update(client, "http://192.168.4.1/fw.bin");  // 성공하면 여기서 재부팅
    Serial.printf("ota fail %d %s\n", (int)r, httpUpdate.getLastErrorString().c_str());
  } else {
    Serial.println("ota fail wifi");
  }
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  radio.startReceive();  // 실패하면 하던 일로 — 수신기는 버전이 그대로인 걸 보고 다시 부르거나 실패로 기록
  lastHeardMs = millis();
}

void nodeLoop() {
  pollInputs();
  if (radioIrq) readNodePacket(0);  // 비콘·업데이트 명령
  if (otaTarget) { doOta(); return; }
  uint32_t now = millis();
  if (linkOk && now - lastHeardMs > LINK_LOST_MS) {  // 수신기와 못 맞추면 READY 를 띄우지 않는다
    linkOk = false; syncedBits = 0;
    Serial.println("link lost (비콘·ACK 없음)");
  }
  if (dirty) { dirty = false; pending = true; fails = 0; nextTry = now; }
  if (pending) {  // 누름 재시도 중에는 하트비트를 끼워 넣지 않는다 (재시도가 상태를 싣고 있음)
    if ((int32_t)(now - nextTry) < 0) return;
    if (sendOnce()) {
      pending = false; fails = 0;
      nextHb = millis() + HEARTBEAT_MS + random(0, 500);
      Serial.printf("tx ok seq=%u bits=%u synced=%u c=%u/%u\n", seq, bits(), syncedBits, ins[0].count, ins[1].count);
    } else if (++fails >= 7) {
      pending = false;  // 지금 상태는 다음 하트비트(3초 안)가 실어 보낸다
      Serial.println("press ACK 7회 실패 — 하트비트로 전달");
    } else {
      nextTry = millis() + random(50, 250) * fails;
    }
    return;
  }
  if ((int32_t)(now - nextHb) >= 0) {
    sendHeartbeat();
    nextHb = millis() + HEARTBEAT_MS + random(0, 500);  // 지터: 여러 대가 같은 박자로 겹치지 않게
  }
}

// ---- 수신기 ----
struct Node { bool seen; uint32_t seenMs; uint8_t bits, c1, c2; int16_t rssi; uint8_t ver; };  // ver 0 = v1.1 이하(업데이트 기능 없음)
Node nodes[N_NODES + 1];

String stateJson();
void pushState() { Serial.printf("S %s\n", stateJson().c_str()); }  // USB 앱(Web Serial)용 상태 한 줄

void sendBeacon() {  // 살아 있는 송신기들의 상태를 2비트씩 — 송신기는 자기 칸을 보고 동기화·링크를 판단
  uint8_t b[2 + BEACON_BYTES] = {MAGIC, T_BEACON};
  uint32_t now = millis();
  for (uint8_t i = 1; i <= N_NODES; i++)
    if (nodes[i].seen && now - nodes[i].seenMs < OFFLINE_MS) beaconSet(b + 2, i, nodes[i].bits);
  krTransmit(b, sizeof b, 3);
  radio.startReceive();
}

// ---- 수신기: USB 로 받은 펌웨어를 쓰지 않는 쪽 OTA 영역에 보관(부팅 대상은 그대로) → 송신기에 /fw.bin 으로 내준다 ----
// 업로드는 USB 로만 받는다 — 와이파이 쪽에서는 내려받기만 된다
const esp_partition_t *fwPart = nullptr;
esp_ota_handle_t fwOta = 0;
uint32_t fwSize = 0, fwGot = 0, fwLastMs = 0;  // fwSize > 0 && !fwRecv = 보관본 있음
uint8_t fwVer = 0;
bool fwRecv = false;                            // USB 로 받는 중 — 그동안 시리얼로 오는 바이트는 전부 펌웨어

void fwBegin(uint32_t size, uint8_t ver) {
  fwPart = esp_ota_get_next_update_partition(nullptr);
  fwSize = 0;
  if (!fwPart || size < 1024 || size > fwPart->size || !ver) { Serial.println("fw err size"); return; }
  esp_err_t e = esp_ota_begin(fwPart, size, &fwOta);  // 그 크기만큼 지운다(수 초)
  if (e != ESP_OK) { Serial.printf("fw err begin %d\n", e); return; }
  fwSize = size; fwGot = 0; fwVer = ver; fwRecv = true; fwLastMs = millis();
  Serial.println("fw ready");
}
void fwFeed() {  // 앱은 1KB 마다 "fw ack <받은 양>" 을 기다렸다가 다음 조각을 보낸다
  static uint8_t buf[1024];
  while (fwRecv && Serial.available()) {
    size_t n = sizeof buf, av = Serial.available();
    if (av < n) n = av;
    if (fwSize - fwGot < n) n = fwSize - fwGot;
    n = Serial.read(buf, n);
    if (!n) break;
    if (esp_ota_write(fwOta, buf, n) != ESP_OK) { esp_ota_abort(fwOta); fwRecv = false; fwSize = 0; Serial.println("fw err write"); return; }
    fwGot += n;
    fwLastMs = millis();
    if (fwGot % 1024 == 0 || fwGot == fwSize) Serial.printf("fw ack %lu\n", (unsigned long)fwGot);
    if (fwGot == fwSize) {
      fwRecv = false;
      esp_err_t e = esp_ota_end(fwOta);  // 이미지 검사(체크섬·SHA256)
      if (e != ESP_OK) { fwSize = 0; Serial.printf("fw err verify %d\n", e); return; }
      prefs.putUInt("fwsize", fwSize); prefs.putUChar("fwver", fwVer); prefs.putUInt("fwaddr", fwPart->address);
      Serial.printf("fw ok %lu ver=%u\n", (unsigned long)fwSize, fwVer);
    }
  }
  if (fwRecv && millis() - fwLastMs > 5000) { esp_ota_abort(fwOta); fwRecv = false; fwSize = 0; Serial.println("fw err timeout"); }
}
void fwLoadSaved() {  // 재부팅 뒤에도 보관본을 쓴다 (그 사이 그 영역으로 부팅했으면 버림)
  fwPart = esp_ota_get_next_update_partition(nullptr);
  if (fwPart && prefs.getUInt("fwaddr", 0) == fwPart->address) { fwSize = prefs.getUInt("fwsize", 0); fwVer = prefs.getUChar("fwver", 0); }
}
void handleFw() {  // GET /fw.bin — 송신기의 httpUpdate 가 받아 간다 (보내는 동안 LoRa 처리는 잠깐 멈춤)
  if (!fwSize || fwRecv) { web.send(404, "text/plain", "no firmware"); return; }
  web.setContentLength(fwSize);
  web.send(200, "application/octet-stream", "");
  WiFiClient c = web.client();
  static uint8_t buf[2048];
  for (uint32_t off = 0; off < fwSize && c.connected();) {
    uint32_t n = fwSize - off < sizeof buf ? fwSize - off : sizeof buf;
    if (esp_partition_read(fwPart, off, buf, n) != ESP_OK || c.write(buf, n) != n) break;
    off += n;
  }
}

// ---- 수신기: 송신기를 한 대씩 돌아가며 업데이트 ("U <id> cmd|ok|fail …" / "U done" 을 앱에 알림) ----
struct { bool active, wasLive; uint8_t ids[N_NODES], n, i; uint32_t stepMs, cmdMs; } upd;

void updNext(const char *result) {
  Serial.printf("U %u %s\n", upd.ids[upd.i], result);
  upd.i++; upd.stepMs = millis(); upd.cmdMs = 0; upd.wasLive = false;
  if (upd.i >= upd.n) { upd.active = false; Serial.println("U done"); }
}
void updStart(char *arg) {  // "all" 또는 "5,18,…"
  if (!fwSize || fwRecv) { Serial.println("U err no-firmware"); return; }
  upd.n = 0;
  uint32_t now = millis();
  if (!strcmp(arg, "all")) {
    for (uint8_t i = 1; i <= N_NODES; i++)
      if (nodes[i].seen && now - nodes[i].seenMs < OFFLINE_MS && nodes[i].ver != fwVer) upd.ids[upd.n++] = i;
  } else {
    for (char *t = strtok(arg, ", "); t && upd.n < N_NODES; t = strtok(nullptr, ", ")) {
      long v = strtol(t, nullptr, 10);
      if (v >= 1 && v <= N_NODES) upd.ids[upd.n++] = v;
    }
  }
  upd.i = 0; upd.stepMs = now; upd.cmdMs = 0; upd.wasLive = false; upd.active = upd.n > 0;
  Serial.printf("U start %u v%u\n", upd.n, fwVer);
  if (!upd.active) Serial.println("U done");
}
void updTick() {
  if (!upd.active) return;
  uint8_t id = upd.ids[upd.i];
  const Node &n = nodes[id];
  uint32_t now = millis();
  bool live = n.seen && now - n.seenMs < OFFLINE_MS;
  if (live) upd.wasLive = true;
  if (live && n.ver == fwVer) { updNext("ok"); return; }
  if (live && n.ver == 0) { updNext("fail usb-needed"); return; }               // v1.1 이하 — USB 로 한 번 구워야 함
  if (!upd.wasLive && now - upd.stepMs > 20000) { updNext("fail offline"); return; }
  if (now - upd.stepMs > 150000) { updNext("fail timeout"); return; }
  if (live && now - upd.cmdMs > 5000) {  // 아직 업데이트를 시작하지 않았으면 5초마다 다시 부른다
    uint8_t c[4] = {MAGIC, T_OTA, id, fwVer};
    krTransmit(c, sizeof c, 3);
    radio.startReceive();
    upd.cmdMs = now;
    Serial.printf("U %u cmd\n", id);
  }
}

void gwLoop() {
  web.handleClient();
  updTick();
  static uint32_t lastPush = 0, nextBeacon = 0;
  if (millis() - lastPush >= 1000) { lastPush = millis(); pushState(); }  // 경과 시간·끊김 갱신용
  if ((int32_t)(millis() - nextBeacon) >= 0) { sendBeacon(); nextBeacon = millis() + BEACON_MS + random(0, 300); }
  if (!radioIrq) return;
  radioIrq = false;
  uint8_t p[8];
  size_t len = radio.getPacketLength();
  if (radio.readData(p, sizeof p) == RADIOLIB_ERR_NONE && (len == 7 || len == 8) && p[0] == MAGIC &&
      (p[1] == T_STATE || p[1] == T_HB) && p[2] >= 1 && p[2] <= N_NODES) {
    uint8_t ver = len == 8 ? p[7] : 0;
    Node &n = nodes[p[2]];
    bool changed = !n.seen || millis() - n.seenMs >= OFFLINE_MS || n.bits != p[4] || n.ver != ver;
    n = {true, millis(), p[4], p[5], p[6], (int16_t)radio.getRSSI(), ver};
    if (p[1] == T_STATE) {
      uint8_t ack[5] = {MAGIC, T_ACK, p[2], p[3], n.bits};  // 저장한 상태를 되돌려 줘 송신기가 동기화를 확인
      krTransmit(ack, sizeof ack, 4);  // 쉼·LBT 지키며 최대 ~130ms 안에 (송신기 ACK 대기 300ms)
    }
    if (p[1] == T_STATE || changed)  // 하트비트는 바뀐 것만 기록 (25대면 초당 8개)
      Serial.printf("rx id=%u %s seq=%u bits=%u c=%u/%u v=%u rssi=%d\n", p[2], p[1] == T_STATE ? "st" : "hb", p[3], p[4], p[5], p[6], ver, n.rssi);
    if (changed) { pushState(); lastPush = millis(); }  // 바뀐 상태를 USB 앱에 바로
  }
  radio.startReceive();
}

String stateJson() {  // [null | {a:경과초, b:비트, c1, c2, r:RSSI, v:버전}] × 25 — 웹 /s 와 USB "S " 줄이 같이 쓴다
  String s = "[";
  char buf[80];
  uint32_t now = millis();
  for (int i = 1; i <= N_NODES; i++) {
    const Node &n = nodes[i];
    if (i > 1) s += ',';
    if (!n.seen) { s += "null"; continue; }
    snprintf(buf, sizeof buf, "{\"a\":%lu,\"b\":%u,\"c1\":%u,\"c2\":%u,\"r\":%d,\"v\":%u}",
             (unsigned long)((now - n.seenMs) / 1000), n.bits, n.c1, n.c2, n.rssi, n.ver);
    s += buf;
  }
  s += ']';
  return s;
}
void handleState() { web.send(200, "application/json", stateJson()); }

// ---- 버튼으로 ID 설정 ----
bool editing = false, btnPrev = false, holdFired = false;
uint8_t editId = 1;
uint32_t btnSince = 0, editLast = 0;

void handleButton() {
  static uint32_t lastPoll = 0;
  uint32_t now = millis();
  if (now - lastPoll < 20) return;
  lastPoll = now;
  bool down = buttonDown();
  if (down && !btnPrev) { btnSince = now; holdFired = false; }
  if (down && !holdFired && now - btnSince >= 2000) {
    holdFired = true;
    editLast = now;
    if (!editing) { editing = true; editId = myId > N_NODES ? 1 : myId; }
    else { prefs.putUChar("id", editId); delay(50); ESP.restart(); }
  }
  if (!down && btnPrev && !holdFired && editing) { editId = (editId + 1) % (N_NODES + 1); editLast = now; }
  if (editing && now - editLast > 20000) editing = false;  // 20초 손 안 대면 저장 없이 나감
  btnPrev = down;
}

// ---- 시리얼 명령 (115200) ----
//  id N            ID 저장 후 재부팅 (0 = 수신기, 1~25 = 송신기)
//  fw <크기> <버전>  (수신기) 뒤따르는 바이너리를 보관 — 앱이 1KB 마다 ack 를 기다린다
//  upd all|5,18    (수신기) 송신기를 한 대씩 와이파이로 업데이트, upd stop = 멈춤
//  fw apply        (수신기) 보관본으로 수신기 자신을 업데이트(재부팅)
//  그 밖의 줄       상태 한 줄
void command(char *s) {
  char *end = nullptr;
  if (!strncmp(s, "id ", 3)) {
    long v = strtol(s + 3, &end, 10);
    if (end != s + 3 && !*end && v >= 0 && v <= N_NODES) {
      prefs.putUChar("id", v);
      Serial.printf("id=%ld saved, restarting\n", v);
      delay(50);
      ESP.restart();
    }
  } else if (myId == 0 && !strcmp(s, "fw apply")) {
    if (!fwSize || fwRecv || esp_ota_set_boot_partition(fwPart) != ESP_OK) { Serial.println("fw err no-firmware"); return; }
    Serial.printf("fw applying v%u, restarting\n", fwVer);
    delay(100);
    ESP.restart();
  } else if (myId == 0 && !strncmp(s, "fw ", 3)) {
    unsigned long size = strtoul(s + 3, &end, 10);
    unsigned long ver = strtoul(end, nullptr, 10);
    fwBegin(size, ver);
    return;
  } else if (myId == 0 && !strncmp(s, "upd ", 4)) {
    if (!strcmp(s + 4, "stop")) { upd.active = false; Serial.println("U done"); }
    else updStart(s + 4);
    return;
  }
  Serial.printf("id=%u radio=%d link=%s fw=%u store=%u/%lu | id N, fw, upd, fw apply\n",
                myId, radioErr, linkOk ? "ok" : "--", FW_VERSION, fwVer, (unsigned long)fwSize);
}
void handleSerial() {
  if (fwRecv) { fwFeed(); return; }
  static char buf[96];
  static uint8_t n = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') { if (n < sizeof buf - 1) buf[n++] = c; continue; }
    buf[n] = 0; n = 0;
    if (!buf[0]) continue;
    command(buf);
    if (fwRecv) return;  // "fw" 다음부터는 바이너리 (앱은 줄 끝에 \n 하나만 보낸다)
  }
}

// ---- OLED ----
void draw() {
  char l1[12], l2[16], l3[16];
  bool big2 = false;  // 송신기의 READY 만 큰 글씨 (다른 화면의 둘째 줄은 64px 에 안 들어감)
  if (editing) {
    if (editId == 0) strcpy(l1, "GW"); else snprintf(l1, sizeof l1, "ID %02u", editId);
    strcpy(l2, "SET tap=+1");
    strcpy(l3, "hold=save");
  } else if (myId == 0) {
    int on = 0;
    for (int i = 1; i <= N_NODES; i++) on += nodes[i].seen && millis() - nodes[i].seenMs < OFFLINE_MS;
    strcpy(l1, "GW");
    snprintf(l2, sizeof l2, "on %d/%d", on, N_NODES);
    strcpy(l3, radioOk ? "192.168.4.1" : "LoRa ERR");
  } else if (myId > N_NODES) {
    strcpy(l1, "ID --"); strcpy(l2, "hold 2s"); strcpy(l3, "to set ID");
  } else {
    snprintf(l1, sizeof l1, "ID %02u", myId);
    strcpy(l2, syncedBits == 1 ? "READY" : "");  // 수신기가 READY 로 확인해 준 때만. STANDBY 는 비움
    strcpy(l3, !radioOk ? "LoRa ERR" : linkOk ? "link OK" : "link --");
    big2 = true;
  }
  oled.clearBuffer();
  oled.setFont(u8g2_font_9x15_tr);
  oled.drawStr(0, 14, l1);
  if (big2) oled.drawStr(0, 31, l2);
  oled.setFont(u8g2_font_5x8_tr);
  if (!big2) oled.drawStr(0, 30, l2);
  oled.drawStr(0, big2 ? 45 : 42, l3);
  oled.sendBuffer();
}

void setup() {
  Serial.setRxBufferSize(4096);  // 펌웨어 업로드 조각(1KB)이 넉넉히 들어가게
  Serial.begin(115200);
  pinMode(PIN_IN1, INPUT_PULLUP);
  pinMode(PIN_IN2, INPUT_PULLUP);
  for (auto &in : ins) in.raw = in.stable = digitalRead(in.pin) == LOW;  // 부팅 때 닫혀 있던 건 클릭으로 세지 않음

  Wire.begin(I2C_SDA, I2C_SCL);
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI);  // OLED·RadioLib 보다 먼저: 둘 다 SPI.begin() 을 다시 부르지만 이미 열려 있으면 무시된다
  oled.begin();

  prefs.begin("c6l");
  myId = prefs.getUChar("id", 255);

  ConfigLoRa_t cfg;  // RadioLib 8: SF7 / BW125k / CR4/5 / private sync / 프리앰블 8
  cfg.frequency = FREQ_HZ;
  cfg.bandwidth = 125000;
  cfg.spreadingFactor = 7;
  cfg.codingRate = 5;
  cfg.power = TX_DBM;
  radio.tcxoVoltage = Voltage3V0;  // 회로도: DIO3 → VDD_OCXO 3.0V. 레귤레이터는 기본값 DC-DC(L2 실장)
  // 2026-11-09 새 모듈 첫 부팅에서 radio=-2(칩 못 찾음)가 한 번 났고 재부팅하자 정상 — 확장칩·SX1262 리셋부터 3번까지 다시 시도한다
  for (int i = 1; i <= 3; i++) {
    int ioBad = ioInit();
    radioErr = radio.begin(cfg);
    if (radioErr == RADIOLIB_ERR_NONE) radioErr = radio.setDio2AsRfSwitch(true);  // RF 스위치 CTRL = DIO2
    if (radioErr == RADIOLIB_ERR_NONE) break;
    Serial.printf("radio init try %d: err=%d i2c_fail=%d\n", i, radioErr, ioBad);
    Wire.end();
    Wire.begin(I2C_SDA, I2C_SCL);
  }
  radioOk = radioErr == RADIOLIB_ERR_NONE;
  radio.setDio1Action(onRadioIrq);
  Serial.printf("c6l-contact-lora id=%u radio=%d %s\n", myId, radioErr, FW_MARK);

  if (myId == 0) {
    fwLoadSaved();
    WiFi.softAP(AP_SSID, AP_PASS);
    web.on("/", [] { web.send(200, "text/html; charset=utf-8", PAGE); });
    web.on("/s", handleState);
    web.on("/fw.bin", handleFw);
    web.begin();
  }
  if (radioOk) radio.startReceive();  // 수신기는 패킷을, 송신기는 비콘을 늘 듣는다
}

void loop() {
  handleButton();
  handleSerial();
  if (radioOk && myId == 0) gwLoop();
  else if (radioOk && myId >= 1 && myId <= N_NODES) nodeLoop();
  static uint32_t lastDraw = 0;
  if (millis() - lastDraw >= 250) { lastDraw = millis(); draw(); }
  delay(1);  // 단일 코어 C6: idle 태스크와 Wi-Fi 에 양보
}
