// 비콘 비트 묶기 호스트 시험:  g++ -std=c++17 -I. tools/test_proto.cpp -o /tmp/test_proto && /tmp/test_proto
#include <cassert>
#include <cstdio>
#include <cstring>
#include "proto.h"

int main() {
  static_assert(BEACON_BYTES == 7, "25대 × 2비트 = 7바이트");
  uint8_t m[BEACON_BYTES];
  for (int pattern = 0; pattern < 4; pattern++) {
    memset(m, pattern & 1 ? 0xFF : 0x00, sizeof m);  // 덮어쓰기가 이웃 칸을 건드리지 않는지 양쪽 바탕에서
    for (int id = 1; id <= BEACON_NODES; id++) beaconSet(m, id, (id + pattern) % 3);
    for (int id = 1; id <= BEACON_NODES; id++) assert(beaconGet(m, id) == (id + pattern) % 3);
  }
  memset(m, 0, sizeof m);
  beaconSet(m, 25, 2);
  for (int id = 1; id < 25; id++) assert(beaconGet(m, id) == 0);  // 마지막 칸만 바뀜
  assert(beaconGet(m, 25) == 2 && m[6] == 0x02);
  beaconSet(m, 25, 0);
  assert(m[6] == 0);
  puts("proto ok");
  return 0;
}
