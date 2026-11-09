// M5Stack Unit C6L 접점 LoRa — 한 펌웨어로 송신기(ID 1~25)와 수신기(ID 0)를 겸한다.
// 송신기: Grove G4/G5 접점 2개를 읽어 바뀔 때마다(+30초마다) LoRa 로 보내고 ACK 를 받을 때까지 재전송.
// 수신기: LoRa 로 받아 ACK 하고, Wi-Fi AP(C6L-GW) 의 http://192.168.4.1 에 태블릿용 상태 페이지를 띄운다.
// ID 는 본체 버튼으로 정한다: 2초 길게 = 설정 모드, 짧게 = +1(25 다음 GW), 다시 2초 길게 = 저장 후 재부팅.
#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WebServer.h>
#include <RadioLib.h>
#include <U8g2lib.h>
#include "page.h"
#include "proto.h"

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
const char *AP_PASS = "c6l-12345";       // 8자 이상

// ---- 핀 (Meshtastic variants/esp32c6/m5stack_unitc6l 기준) ----
constexpr int PIN_IN1 = 4, PIN_IN2 = 5;  // Grove: 흰=G4, 노랑=G5, 검정=GND (빨강 5V 는 쓰지 않음)
constexpr int LORA_SCK = 20, LORA_MISO = 22, LORA_MOSI = 21, LORA_CS = 23, LORA_DIO1 = 7, LORA_BUSY = 19;
constexpr int OLED_CS = 6, OLED_DC = 18, OLED_RST = 15;  // SSD1306 64x48, LoRa 와 SPI 공유
constexpr int I2C_SDA = 10, I2C_SCL = 8;
constexpr uint8_t PI4IO = 0x43;          // IO 확장칩: P0 버튼, P5 LNA_EN, P6 ANT_SW, P7 SX_NRST

// 패킷: STATE(누름, ACK 요청) / HB(하트비트, ACK 없음) = MAGIC 타입 id seq bits cnt1 cnt2
//       ACK = MAGIC T_ACK id seq bits(수신기가 저장한 상태) / BEACON = MAGIC T_BEACON + 25대 × 2비트(proto.h)
constexpr uint8_t MAGIC = 0xC6, T_STATE = 1, T_ACK = 2, T_HB = 3, T_BEACON = 4;
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

bool nodePacket(const uint8_t *b, size_t len, uint8_t wantSeq) {  // 비콘이면 동기화, 내 ACK 면 true
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
  uint8_t p[7] = {MAGIC, T_STATE, myId, ++seq, bits(), ins[0].count, ins[1].count};
  if (krTransmit(p, sizeof p, 1) != RADIOLIB_ERR_NONE) return false;  // 채널이 차 있으면 이번 시도는 접고 물러난다
  radio.startReceive();
  for (uint32_t t0 = millis(); millis() - t0 < ACK_WAIT_MS;) {
    pollInputs();
    if (radioIrq && readNodePacket(seq)) return true;
  }
  return false;  // 수신 모드는 그대로(비콘을 계속 듣는다)
}

void sendHeartbeat() {  // ACK 없음 — 수신기의 꺼짐 판정용
  uint8_t p[7] = {MAGIC, T_HB, myId, ++seq, bits(), ins[0].count, ins[1].count};
  krTransmit(p, sizeof p, 3);
  radio.startReceive();
}

void nodeLoop() {
  pollInputs();
  if (radioIrq) readNodePacket(0);  // 비콘
  uint32_t now = millis();
  if (linkOk && now - lastHeardMs > LINK_LOST_MS) {  // 수신기와 못 맞추면 READY 를 띄우지 않는다
    linkOk = false; syncedBits = 0;
    Serial.println("link lost (비콘·ACK 없음)");
  }
  if (dirty) { dirty = false; pending = true; fails = 0; nextTry = now; }
  if (pending && (int32_t)(now - nextTry) >= 0) {
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
struct Node { bool seen; uint32_t seenMs; uint8_t bits, c1, c2; int16_t rssi; };
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

void gwLoop() {
  web.handleClient();
  static uint32_t lastPush = 0, nextBeacon = 0;
  if (millis() - lastPush >= 1000) { lastPush = millis(); pushState(); }  // 경과 시간·끊김 갱신용
  if ((int32_t)(millis() - nextBeacon) >= 0) { sendBeacon(); nextBeacon = millis() + BEACON_MS + random(0, 300); }
  if (!radioIrq) return;
  radioIrq = false;
  uint8_t p[7];
  size_t len = radio.getPacketLength();
  if (radio.readData(p, sizeof p) == RADIOLIB_ERR_NONE && len == sizeof p && p[0] == MAGIC &&
      (p[1] == T_STATE || p[1] == T_HB) && p[2] >= 1 && p[2] <= N_NODES) {
    Node &n = nodes[p[2]];
    bool changed = !n.seen || millis() - n.seenMs >= OFFLINE_MS || n.bits != p[4];
    n = {true, millis(), p[4], p[5], p[6], (int16_t)radio.getRSSI()};
    if (p[1] == T_STATE) {
      uint8_t ack[5] = {MAGIC, T_ACK, p[2], p[3], n.bits};  // 저장한 상태를 되돌려 줘 송신기가 동기화를 확인
      krTransmit(ack, sizeof ack, 4);  // 쉼·LBT 지키며 최대 ~130ms 안에 (송신기 ACK 대기 300ms)
    }
    if (p[1] == T_STATE || changed)  // 하트비트는 바뀐 것만 기록 (25대면 초당 8개)
      Serial.printf("rx id=%u %s seq=%u bits=%u c=%u/%u rssi=%d\n", p[2], p[1] == T_STATE ? "st" : "hb", p[3], p[4], p[5], p[6], n.rssi);
    if (changed) { pushState(); lastPush = millis(); }  // 바뀐 상태를 USB 앱에 바로
  }
  radio.startReceive();
}

String stateJson() {  // [null | {a:경과초, b:비트, c1, c2, r:RSSI}] × 25 — 웹 /s 와 USB "S " 줄이 같이 쓴다
  String s = "[";
  char buf[64];
  uint32_t now = millis();
  for (int i = 1; i <= N_NODES; i++) {
    const Node &n = nodes[i];
    if (i > 1) s += ',';
    if (!n.seen) { s += "null"; continue; }
    snprintf(buf, sizeof buf, "{\"a\":%lu,\"b\":%u,\"c1\":%u,\"c2\":%u,\"r\":%d}",
             (unsigned long)((now - n.seenMs) / 1000), n.bits, n.c1, n.c2, n.rssi);
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

// ---- 시리얼 "id N" (0~25, 0=GW) — 굽고 나서 콘솔로 ID 를 정할 때 ----
void handleSerial() {
  static char buf[12];
  static uint8_t n = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') { if (n < sizeof buf - 1) buf[n++] = c; continue; }
    buf[n] = 0; n = 0;
    char *end = nullptr;
    long v = strncmp(buf, "id ", 3) == 0 ? strtol(buf + 3, &end, 10) : -1;
    if (v < 0 || v > N_NODES || end == buf + 3 || *end) {  // 그 밖의 줄: 현재 상태
      if (buf[0]) Serial.printf("id=%u radio=%d link=%s | usage: id 0..25 (0=GW)\n", myId, radioErr, linkOk ? "ok" : "--");
      continue;
    }
    prefs.putUChar("id", v);
    Serial.printf("id=%ld saved, restarting\n", v);
    delay(50);
    ESP.restart();
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
  Serial.printf("c6l-contact-lora id=%u radio=%d\n", myId, radioErr);

  if (myId == 0) {
    WiFi.softAP(AP_SSID, AP_PASS);
    web.on("/", [] { web.send(200, "text/html; charset=utf-8", PAGE); });
    web.on("/s", handleState);
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
