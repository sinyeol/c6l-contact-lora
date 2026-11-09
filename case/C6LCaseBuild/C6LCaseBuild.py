# C6L 버튼 케이스 — 설계툴(case/index.html)이 저장한 c6l-case.json 의 CSG 트리를 Fusion B-rep 으로 만든다.
# 형상 규칙은 전부 case/core.js 에 있고, 여기서는 box/cyl/frustum/add/sub/and 만 해석한다.
# Fusion: Shift+S → C6LCaseBuild 실행 → 새 문서에 Lid·Body·Cover(+REF_ 부품), out/ 에 STL(조립 자세).
# json 찾는 순서: 이 폴더의 c6l-case.json → ~/Downloads/c6l-case.json 중 더 최근 것.
import os, json, math

HERE = os.path.dirname(os.path.abspath(__file__))
SEARCH = [os.path.join(HERE, 'c6l-case.json'), os.path.expanduser('~/Downloads/c6l-case.json')]


def find_json():
    found = [p for p in SEARCH if os.path.exists(p)]
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
        kids = [ev(c) for c in n['c']]
        kind = {'add': BT.UnionBooleanType, 'sub': BT.DifferenceBooleanType, 'and': BT.IntersectionBooleanType}[t]
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
    for name in case['bodies']:
        bb = bodies[name].boundingBox
        print('%s  %.1f×%.1f×%.1f mm  volume=%.1f cm3  faces=%d' % (
            name, (bb.maxPoint.x - bb.minPoint.x) * 10, (bb.maxPoint.y - bb.minPoint.y) * 10,
            (bb.maxPoint.z - bb.minPoint.z) * 10, bodies[name].volume, bodies[name].faces.count))
    return out


def run(_context):
    import adsk.core, traceback
    ui = adsk.core.Application.get().userInterface
    try:
        path = find_json()
        with open(path, encoding='utf-8') as f:
            out = build(json.load(f))
        if not os.environ.get('C6LCASE_SILENT'):
            ui.messageBox('C6L 케이스 생성 완료\n읽은 파일: %s\nSTL: %s' % (path, out))
    except Exception:
        msg = traceback.format_exc()
        print(msg)
        if not os.environ.get('C6LCASE_SILENT'):
            ui.messageBox(msg)
