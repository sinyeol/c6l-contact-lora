# C6L 버튼 케이스 — 설계툴(case/index.html)이 저장한 c6l-case.json 의 CSG 트리를 Fusion B-rep 으로 만든다.
# 형상 규칙은 전부 case/core.js 에 있고, 여기서는 box/cyl/frustum/torus/rslab/add/sub/and 만 해석한다.
# Fusion: Shift+S → C6LCaseBuild 실행 → 새 문서에 Lid·Body·Cover·Keys(+REF_ 부품), out/ 에 STL(조립 자세).
# json: 이 폴더와 ~/Downloads 의 c6l-case*.json(브라우저가 붙이는 " (1)" 포함) 중 가장 최근 것.
import os, json, math, glob

HERE = os.path.dirname(os.path.abspath(__file__))
SEARCH = [os.path.join(HERE, 'c6l-case*.json'), os.path.expanduser('~/Downloads/c6l-case*.json')]


def find_json():
    found = [p for pat in SEARCH for p in glob.glob(pat)]
    if not found:
        raise FileNotFoundError('c6l-case.json 없음: ' + ', '.join(SEARCH))
    return max(found, key=os.path.getmtime)


def build(case):
    import adsk.core, adsk.fusion
    app = adsk.core.Application.get()
    tbm = adsk.fusion.TemporaryBRepManager.get()
    BT = adsk.fusion.BooleanTypes
    P = lambda v: adsk.core.Point3D.create(v[0] / 10, v[1] / 10, v[2] / 10)   # mm → cm

    def ev(n):
        t = n['t']
        if t == 'box':
            x0, y0, z0, x1, y1, z1 = n['p']
            return tbm.createBox(adsk.core.OrientedBoundingBox3D.create(
                P(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)),
                adsk.core.Vector3D.create(1, 0, 0), adsk.core.Vector3D.create(0, 1, 0),
                abs(x1 - x0) / 10, abs(y1 - y0) / 10, abs(z1 - z0) / 10))
        if t == 'cyl':
            return tbm.createCylinderOrCone(P(n['a']), n['r1'] / 10, P(n['b']), n['r2'] / 10)
        if t == 'frustum':
            return frustum(n)
        if t == 'rslab':
            return rslab(n)
        if t == 'torus':
            return tbm.createTorus(P(n['c']), adsk.core.Vector3D.create(0, 0, 1), n['R'] / 10, n['r'] / 10)
        if t not in ('add', 'sub', 'and'):   # 설계툴이 새 형상을 쓰는데 맥의 스크립트가 옛 버전일 때
            raise RuntimeError("모르는 형상 '%s' — 이 스크립트가 case.json 보다 오래됐다. "
                               "case/README.md 의 맥 설치 명령으로 C6LCaseBuild 를 다시 받을 것" % t)
        kids = [ev(c) for c in n['c']]
        kind ={'add': BT.UnionBooleanType, 'sub': BT.DifferenceBooleanType, 'and': BT.IntersectionBooleanType}[t]
        out = kids[0]
        for k in kids[1:]:
            tbm.booleanOperation(out, k, kind)
        return out

    app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    design = adsk.fusion.Design.cast(app.activeProduct)
    design.designType = adsk.fusion.DesignTypes.DirectDesignType
    root = design.rootComponent

    # 사각뿔대: TemporaryBRepManager 에 없어서 z0 평면 스케치 사각형을 테이퍼 압출한 뒤 임시 바디로 복사하고 지운다.
    # 테이퍼 부호는 Fusion 버전마다 헷갈리므로 윗면 크기로 확인해 반대면 다시 만든다.
    def frustum(n):
        cx, cy = n['c']
        (wx, wy), h, off = n['w0'], n['z1'] - n['z0'], n['off']
        pi = root.constructionPlanes.createInput()
        pi.setByOffset(root.xYConstructionPlane, adsk.core.ValueInput.createByReal(n['z0'] / 10))
        plane = root.constructionPlanes.add(pi)
        sk = root.sketches.add(plane)
        sk.sketchCurves.sketchLines.addTwoPointRectangle(
            adsk.core.Point3D.create((cx - wx / 2) / 10, (cy - wy / 2) / 10, 0),
            adsk.core.Point3D.create((cx + wx / 2) / 10, (cy + wy / 2) / 10, 0))
        ang = math.atan2(off, h)
        for sign in (-1, 1):
            ei = root.features.extrudeFeatures.createInput(sk.profiles.item(0), adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
            ei.setOneSideExtent(adsk.fusion.DistanceExtentDefinition.create(adsk.core.ValueInput.createByReal(h / 10)),
                                adsk.fusion.ExtentDirections.PositiveExtentDirection, adsk.core.ValueInput.createByReal(sign * ang))
            f = root.features.extrudeFeatures.add(ei)
            b = f.bodies.item(0)
            bb = b.boundingBox
            temp = tbm.copy(b)
            b.deleteMe()
            if (bb.maxPoint.x - bb.minPoint.x) * 10 > wx + off:   # 위로 갈수록 넓어지면 맞는 부호
                break
        sk.deleteMe()
        plane.deleteMe()
        return temp

    # 둥근 외피: 세로 모서리 R 인 둥근 상자를 만든 뒤 윗면·아랫면 테두리에 필렛 기능을 건다.
    # (원기둥+토러스를 이어 붙이면 테두리 R = 세로 R/2 에서 토러스가 퇴화해 Fusion 합치기가 깨진다 — 2026-11-10 사용자 화면)
    # 세 부품이 같은 외피를 잘라 쓰므로 한 번만 만들고 복사해 준다.
    slab_cache = {}

    def rslab(n):
        key = json.dumps(n, sort_keys=True)
        if key not in slab_cache:
            x0, y0, z0, x1, y1, z1 = n['p']
            R = n['R']
            body = tbm.createBox(adsk.core.OrientedBoundingBox3D.create(
                P(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), adsk.core.Vector3D.create(1, 0, 0), adsk.core.Vector3D.create(0, 1, 0),
                (x1 - x0 - 2 * R) / 10, (y1 - y0) / 10, (z1 - z0) / 10))
            parts = [tbm.createBox(adsk.core.OrientedBoundingBox3D.create(
                P(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), adsk.core.Vector3D.create(1, 0, 0), adsk.core.Vector3D.create(0, 1, 0),
                (x1 - x0) / 10, (y1 - y0 - 2 * R) / 10, (z1 - z0) / 10))]
            parts += [tbm.createCylinderOrCone(P((x, y, z0)), R / 10, P((x, y, z1)), R / 10) for x in (x0 + R, x1 - R) for y in (y0 + R, y1 - R)]
            for b in parts:
                tbm.booleanOperation(body, b, BT.UnionBooleanType)
            env = root.bRepBodies.add(body)
            env.name = '_env'
            for r, zf in ((n['rt'], z1), (n['rb'], z0)):
                if r <= 0:
                    continue
                env = root.bRepBodies.itemByName('_env')
                # 합치기 결과 윗면이 여러 조각일 수 있어, 그 조각들의 바깥 둘레 모서리만 고른다
                tops = [f for f in env.faces if isinstance(f.geometry, adsk.core.Plane)
                        and abs(abs(f.geometry.normal.z) - 1) < 1e-6 and abs(f.pointOnFace.z * 10 - zf) < 1e-3]
                ids = {f.tempId for f in tops}
                edges, seen = adsk.core.ObjectCollection.create(), set()
                for f in tops:
                    for e in f.edges:
                        if e.tempId not in seen and not all(g.tempId in ids for g in e.faces):
                            seen.add(e.tempId)
                            edges.add(e)
                fi = root.features.filletFeatures.createInput()
                rad = adsk.core.ValueInput.createByReal(r / 10)
                try:
                    fi.edgeSetInputs.addConstantRadiusEdgeSet(edges, rad, True)
                except AttributeError:      # 옛 API
                    fi.addConstantRadiusEdgeSet(edges, rad, True)
                root.features.filletFeatures.add(fi)
            env = root.bRepBodies.itemByName('_env')
            slab_cache[key] = tbm.copy(env)
            env.deleteMe()
        return tbm.copy(slab_cache[key])

    bodies = {}
    for name, node in list(case['bodies'].items()) + list(case['refs'].items()):
        b = root.bRepBodies.add(ev(node))
        b.name = name
        bodies[name] = b
        if name.startswith('REF'):
            try:
                b.opacity = 0.35
            except Exception:
                pass

    out = os.path.join(HERE, 'out')
    os.makedirs(out, exist_ok=True)
    em = design.exportManager
    for name in case['bodies']:
        o = em.createSTLExportOptions(bodies[name], os.path.join(out, 'c6l_case_%s.stl' % name.lower()))
        o.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementHigh
        em.execute(o)
    app.activeViewport.fit()
    lines = []
    for name in case['bodies']:
        bb = bodies[name].boundingBox
        lines.append('%s  %.1f×%.1f×%.1f mm  %.1f cm³' % (
            name, (bb.maxPoint.x - bb.minPoint.x) * 10, (bb.maxPoint.y - bb.minPoint.y) * 10,
            (bb.maxPoint.z - bb.minPoint.z) * 10, bodies[name].volume))
    print('\n'.join(lines))
    return out, lines


def run(_context):
    import adsk.core, traceback
    ui = adsk.core.Application.get().userInterface
    try:
        path = find_json()
        with open(path, encoding='utf-8') as f:
            out, lines = build(json.load(f))
        if not os.environ.get('C6LCASE_SILENT'):
            ui.messageBox('C6L 케이스 생성 완료\n읽은 파일: %s\nSTL: %s\n\n%s' % (path, out, '\n'.join(lines)))
    except Exception:
        msg = traceback.format_exc()
        print(msg)
        if not os.environ.get('C6LCASE_SILENT'):
            ui.messageBox(msg)
