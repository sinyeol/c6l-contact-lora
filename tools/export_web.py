#!/usr/bin/env python3
"""page.h 의 PAGE 문자열을 web/index.html 로 꺼낸다 (USB 앱 배포용 사본). page.h 를 고친 뒤 실행."""
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "page.h").read_text(encoding="utf-8")
m = re.search(r'R"html\((.*)\)html"', src, re.S)
assert m, "page.h 에서 R\"html(...)html\" 를 찾지 못함"
html = m.group(1)
assert html.startswith("<!doctype html>") and html.rstrip().endswith("</html>"), "PAGE 가 완전한 HTML 이 아님"
out = root / "web" / "index.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")
print(f"{out.relative_to(root)} ({len(html)} bytes)")
