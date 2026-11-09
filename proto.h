#pragma once
#include <stdint.h>
// 수신기 비콘: 송신기 25대의 상태를 2비트씩(0 = 꺼짐·모름, 1 = READY, 2 = STANDBY) 7바이트에 담는다.
// 펌웨어와 tools/test_proto.cpp(호스트 시험)가 같이 쓴다.
constexpr uint8_t BEACON_NODES = 25;
constexpr uint8_t BEACON_BYTES = (BEACON_NODES * 2 + 7) / 8;  // 7

inline void beaconSet(uint8_t *m, uint8_t id, uint8_t v) {  // id 1~25
  uint8_t i = id - 1, sh = (i % 4) * 2;
  m[i / 4] = (uint8_t)((m[i / 4] & ~(3 << sh)) | ((v & 3) << sh));
}

inline uint8_t beaconGet(const uint8_t *m, uint8_t id) {
  uint8_t i = id - 1;
  return (m[i / 4] >> ((i % 4) * 2)) & 3;
}
