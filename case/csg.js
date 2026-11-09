// core.js 의 CSG 트리 → manifold 메시, 그리고 바이너리 STL. 브라우저·node(check.mjs) 공용.
import Module from './vendor/manifold.js';

let wasm;
export async function initCsg() {
  if (!wasm) {
    wasm = await Module();
    wasm.setup();
    wasm.setMinCircularAngle(4); wasm.setMinCircularEdgeLength(0.4);   // 원 분할: 작은 구멍도 매끈하게
  }
  return wasm;
}

// 트리 평가. 중간 결과는 바로 delete(WASM 힙)
function evalNode(n) {
  const { Manifold } = wasm;
  if (n.t === 'box') {
    const [x0, y0, z0, x1, y1, z1] = n.p;
    return Manifold.cube([Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)]).translate([Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)]);
  }
  if (n.t === 'cyl') {
    const d = n.b.map((v, i) => v - n.a[i]), h = Math.hypot(...d);
    const pitch = Math.acos(d[2] / h) * 180 / Math.PI, yaw = Math.atan2(d[1], d[0]) * 180 / Math.PI;
    const c = Manifold.cylinder(h, n.r1, n.r2), rt = c.rotate([0, pitch, yaw]);   // +Z 축 → a→b
    c.delete();
    const out = rt.translate(n.a); rt.delete();
    return out;
  }
  if (n.t === 'frustum') {
    const [wx, wy] = n.w0, cs = wasm.CrossSection.square([wx, wy], true);
    const m = cs.extrude(n.z1 - n.z0, 0, 0, [(wx + 2 * n.off) / wx, (wy + 2 * n.off) / wy]);
    cs.delete();
    const out = m.translate([n.c[0], n.c[1], n.z0]); m.delete();
    return out;
  }
  if (n.t === 'torus') {     // 원(반지름 r)을 x=R 에 두고 a0° 부터 90° 만 회전(바깥 모서리 1/4 이면 충분)
    const c0 = wasm.CrossSection.circle(n.r), c1 = c0.translate([n.R, 0]), m = c1.revolve(0, 90), mr = m.rotate([0, 0, n.a0 ?? 0]);
    c0.delete(); c1.delete(); m.delete();
    const out = mr.translate(n.c); mr.delete();
    return out;
  }
  const kids = n.c.map(evalNode);
  let out;
  if (n.t === 'add') out = Manifold.union(kids);
  else if (n.t === 'and') out = Manifold.intersection(kids);
  else { const tools = Manifold.union(kids.slice(1)); out = kids[0].subtract(tools); tools.delete(); }
  kids.forEach(k => k.delete());
  return out;
}

// → { pos: Float32Array(xyz…), idx: Uint32Array, volume, genus }
export function meshOf(node) {
  const m = evalNode(node), mesh = m.getMesh();
  const np = mesh.numProp, pos = new Float32Array(mesh.vertProperties.length / np * 3);
  for (let i = 0, j = 0; i < mesh.vertProperties.length; i += np) { pos[j++] = mesh.vertProperties[i]; pos[j++] = mesh.vertProperties[i + 1]; pos[j++] = mesh.vertProperties[i + 2]; }
  const out = { pos, idx: Uint32Array.from(mesh.triVerts), volume: m.volume(), genus: m.genus() };
  m.delete();
  return out;
}

// 바이너리 STL. map(x,y,z) 로 출력 자세를 바꾼다
export function stl(mesh, map = (x, y, z) => [x, y, z]) {
  const { pos, idx } = mesh, n = idx.length / 3, buf = new DataView(new ArrayBuffer(84 + n * 50));
  buf.setUint32(80, n, true);
  const P = i => map(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  let zmin = Infinity;
  for (let i = 0; i < pos.length / 3; i++) zmin = Math.min(zmin, P(i)[2]);
  for (let t = 0, o = 84; t < n; t++, o += 50) {
    const [a, b, c] = [0, 1, 2].map(k => P(idx[t * 3 + k]));
    const u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
    const nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...nn) || 1;
    [...nn.map(v => v / l), ...a, ...b, ...c].forEach((v, i) => buf.setFloat32(o + i * 4, i >= 3 && i % 3 === 2 ? v - zmin : v, true));   // 바닥을 z=0 으로
  }
  return buf.buffer;
}
