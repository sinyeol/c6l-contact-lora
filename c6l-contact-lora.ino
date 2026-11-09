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

// ---- 설정 ----
constexpr uint32_t FREQ_HZ = 922100000;  // KR920 대역(920.9~923.3MHz) 안
constexpr int8_t TX_DBM = 10;            // 안테나 3dBi 포함 EIRP 13dBm — 국내 규정 상한(14dBm) 안쪽
constexpr uint8_t N_NODES = 25;
constexpr uint32_t HEARTBEAT_MS = 30000;
constexpr uint32_t OFFLINE_MS = 75000;   // page.h 의 OFF 와 같은 값
constexpr uint32_t ACK_WAIT_MS = 300;
const char *AP_SSID = "C6L-GW";
const char *AP_PASS = "c6l-12345";       // 8자 이상

// ---- 핀 (Meshtastic variants/esp32c6/m5stack_unitc6l 기준) ----
constexpr int PIN_IN1 = 4, PIN_IN2 = 5;  // Grove: 흰=G4, 노랑=G5, 검정=GND (빨강 5V 는 쓰지 않음)
constexpr int LORA_SCK = 20, LORA_MISO = 22, LORA_MOSI = 21, LORA_CS = 23, LORA_DIO1 = 7, LORA_BUSY = 19;
constexpr int OLED_CS = 6, OLED_DC = 18, OLED_RST = 15;  // SSD1306 64x48, LoRa 와 SPI 공유
constexpr int I2C_SDA = 10, I2C_SCL = 8;
constexpr uint8_t PI4IO = 0x43;          // IO 확장칩: P0 버튼, P5 LNA_EN, P6 ANT_SW, P7 SX_NRST

// 패킷: STATE = MAGIC T_STATE id seq bits cnt1 cnt2 / ACK = MAGIC T_ACK id seq
constexpr uint8_t MAGIC = 0xC6, T_STATE = 1, T_ACK = 2;

SX1262 radio = new Module(LORA_CS, LORA_DIO1, RADIOLIB_NC, LORA_BUSY);  // NRST 는 확장칩 P7
U8G2_SSD1306_64X48_ER_F_4W_HW_SPI oled(U8G2_R0, OLED_CS, OLED_DC, OLED_RST);
Preferences prefs;
WebServer web(80);

volatile bool radioIrq = false;
void IRAM_ATTR onRadioIrq() { radioIrq = true; }

uint8_t myId = 255;                      // 255 = 미설정, 0 = 수신기, 1~25 = 송신기
bool radioOk = false;

// ---- IO 확장칩 PI4IOE5V6408 ----
void ioWrite(uint8_t reg, uint8_t v) {
  Wire.beginTransmission(PI4IO);
  Wire.write(reg);
  Wire.write(v);
  Wire.endTransmission();
}
uint8_t ioRead(uint8_t reg) {
  Wire.beginTransmission(PI4IO);
  Wire.write(reg);
  Wire.endTransmission();
  Wire.requestFrom(PI4IO, (uint8_t)1);
  return Wire.read();
}
void ioInit() {  // Meshtastic c6l_init() 과 같은 레지스터 순서, 인터럽트 설정만 뺌
  ioWrite(0x01, 0xFF); delay(10); ioRead(0x01);  // 칩 리셋
  ioWrite(0x03, 0b11100000);  // P5~P7 출력
  ioWrite(0x07, 0b00011100);  // P2~P4 하이임피던스
  ioWrite(0x0D, 0b11100011);  // 풀업 선택
  ioWrite(0x0B, 0b11100011);  // 풀업 사용(P0 버튼 포함)
  ioWrite(0x05, 0b00000000);  // SX1262 리셋 유지
  delay(100);
  ioWrite(0x05, 0b11100000);  // 리셋 해제 + ANT_SW + LNA_EN
  delay(10);
}
bool buttonDown() { return !(ioRead(0x0F) & 0x01); }

// ---- 접점 입력 (닫힘 = LOW, 30ms 디바운스, 닫힐 때마다 카운트) ----
struct Input { uint8_t pin; bool raw, stable; uint32_t since; uint8_t count; };
Input ins[2] = {{PIN_IN1}, {PIN_IN2}};
bool dirty = false;

void pollInputs() {
  uint32_t now = millis();
  for (auto &in : ins) {
    bool closed = digitalRead(in.pin) == LOW;
    if (closed != in.raw) { in.raw = closed; in.since = now; }
    else if (closed != in.stable && now - in.since >= 30) {
      in.stable = closed;
      dirty = true;
      if (closed) in.count++;  // 짧은 클릭이 전송 중에 열렸다 닫혀도 카운트로 남는다(255 다음 0)
    }
  }
}
uint8_t bits() { return (ins[0].stable ? 1 : 0) | (ins[1].stable ? 2 : 0); }

// ---- 송신기 ----
uint8_t seq = 0, fails = 0;
uint32_t lastOk = 0, nextTry = 0;
bool pending = true, linkOk = false;

bool sendOnce() {
  if (radio.scanChannel() != RADIOLIB_CHANNEL_FREE) return false;  // 누가 송신 중이면 양보(LBT)
  uint8_t p[7] = {MAGIC, T_STATE, myId, ++seq, bits(), ins[0].count, ins[1].count};
  if (radio.transmit(p, sizeof p) != RADIOLIB_ERR_NONE) return false;
  radioIrq = false;  // CAD·송신 완료도 DIO1 을 울린다
  radio.startReceive();
  for (uint32_t t0 = millis(); millis() - t0 < ACK_WAIT_MS;) {
    pollInputs();
    if (!radioIrq) continue;
    radioIrq = false;
    uint8_t a[4];
    if (radio.readData(a, sizeof a) == RADIOLIB_ERR_NONE && a[0] == MAGIC && a[1] == T_ACK && a[2] == myId && a[3] == seq) {
      radio.standby();
      return true;
    }
    radio.startReceive();  // 다른 노드 패킷이면 계속 기다린다
  }
  radio.standby();
  return false;
}

void nodeLoop() {
  pollInputs();
  uint32_t now = millis();
  if (dirty) { dirty = false; pending = true; fails = 0; nextTry = now; }
  if (now - lastOk >= HEARTBEAT_MS) pending = true;
  if (!pending || (int32_t)(now - nextTry) < 0) return;
  if (sendOnce()) {
    pending = false; fails = 0; linkOk = true; lastOk = millis();
  } else {
    fails++;
    if (fails >= 8) linkOk = false;
    // 짧게 몇 번 다시 보내고, 계속 안 되면(수신기 꺼짐 등) 5~10초 간격으로 물러나 채널을 비운다
    nextTry = millis() + (fails < 8 ? random(50, 250) * fails : random(5000, 10000));
  }
}

// ---- 수신기 ----
struct Node { bool seen; uint32_t seenMs; uint8_t bits, c1, c2; int16_t rssi; };
Node nodes[N_NODES + 1];

void gwLoop() {
  web.handleClient();
  if (!radioIrq) return;
  radioIrq = false;
  uint8_t p[7];
  size_t len = radio.getPacketLength();
  if (radio.readData(p, sizeof p) == RADIOLIB_ERR_NONE && len == sizeof p &&
      p[0] == MAGIC && p[1] == T_STATE && p[2] >= 1 && p[2] <= N_NODES) {
    nodes[p[2]] = {true, millis(), p[4], p[5], p[6], (int16_t)radio.getRSSI()};
    uint8_t ack[4] = {MAGIC, T_ACK, p[2], p[3]};
    radio.transmit(ack, sizeof ack);
    radioIrq = false;  // 송신 완료 인터럽트 무시
  }
  radio.startReceive();
}

void handleState() {  // [null | {a:경과초, b:비트, c1, c2, r:RSSI}] × 25
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
  web.send(200, "application/json", s);
}

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

// ---- OLED ----
void draw() {
  char l1[12], l2[16], l3[16];
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
    snprintf(l2, sizeof l2, "1:%s 2:%s", ins[0].stable ? "ON" : "--", ins[1].stable ? "ON" : "--");
    strcpy(l3, !radioOk ? "LoRa ERR" : linkOk ? "link OK" : "link --");
  }
  oled.clearBuffer();
  oled.setFont(u8g2_font_9x15_tr);
  oled.drawStr(0, 14, l1);
  oled.setFont(u8g2_font_5x8_tr);
  oled.drawStr(0, 30, l2);
  oled.drawStr(0, 42, l3);
  oled.sendBuffer();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_IN1, INPUT_PULLUP);
  pinMode(PIN_IN2, INPUT_PULLUP);
  for (auto &in : ins) in.raw = in.stable = digitalRead(in.pin) == LOW;  // 부팅 때 닫혀 있던 건 클릭으로 세지 않음

  Wire.begin(I2C_SDA, I2C_SCL);
  ioInit();
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
  int st = radio.begin(cfg);
  if (st == RADIOLIB_ERR_NONE) st = radio.setDio2AsRfSwitch(true);  // RF 스위치 CTRL = DIO2
  radioOk = st == RADIOLIB_ERR_NONE;
  radio.setDio1Action(onRadioIrq);
  Serial.printf("c6l-contact-lora id=%u radio=%d\n", myId, st);

  if (myId == 0) {
    WiFi.softAP(AP_SSID, AP_PASS);
    web.on("/", [] { web.send(200, "text/html; charset=utf-8", PAGE); });
    web.on("/s", handleState);
    web.begin();
    radio.startReceive();
  }
}

void loop() {
  handleButton();
  if (radioOk && myId == 0) gwLoop();
  else if (radioOk && myId >= 1 && myId <= N_NODES) nodeLoop();
  static uint32_t lastDraw = 0;
  if (millis() - lastDraw >= 250) { lastDraw = millis(); draw(); }
  delay(1);  // 단일 코어 C6: idle 태스크와 Wi-Fi 에 양보
}
