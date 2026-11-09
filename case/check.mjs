// node case/check.mjs — 기본값 검사 + manifold 로 Base·Lid 실제 계산 + Fusion 용 기본 case.json 갱신
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { DEFS, defaults, model, caseJson } from './core.js';
import { initCsg, meshOf, stl } from './csg.js';

await initCsg();
const P = defaults(), m = model(P);
const errs = m.warn.filter(w => w[0] === 'error');
assert.equal(errs.length, 0, '기본값에 오류: ' + errs.join(' / '));
const [ox, oy, oz] = m.L.outer;
for (const [name, node] of Object.entries(m.bodies)) {
  const me = meshOf(node);
  assert.ok(me.volume > 1000 && me.volume < ox * oy * oz / 2, `${name} 부피 이상 ${me.volume}`);
  assert.ok(stl(me).byteLength === 84 + me.idx.length / 3 * 50);
  console.log(`${name}: ${(me.volume / 1000).toFixed(1)} cm³, 삼각형 ${me.idx.length / 3}, genus ${me.genus}`);
}
// 슬라이더 양 끝에서도 트리 계산이 죽지 않는지
for (const d of DEFS) for (const v of [d[3], d[4]]) meshOf(model({ ...P, [d[1]]: v }).bodies.Base);
console.log(`바깥 ${m.L.outer.map(v => v.toFixed(1)).join('×')} mm, 경고 ${m.warn.length}건 — ok`);
writeFileSync(new URL('./C6LCaseBuild/c6l-case.json', import.meta.url), JSON.stringify(caseJson(P)));
