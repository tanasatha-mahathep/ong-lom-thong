"""path ที่ไม่มีใต้ /api ต้องได้ 404 {"error": "not found"} (สัญญา error ของ API · spec §5) ไม่ใช่หน้า SPA 200

known failure F1 (ดู testsprite.json): index.ts เสิร์ฟ SPA ที่ app.get("/*") และ api.notFound() ของ sub-app ไม่ถูกเรียก
(Hono เรียก notFound ของ app บนสุดเท่านั้น) → GET /api/<ไม่มี> ได้ 200 text/html · POST ได้ 404 text/plain
ผล: client/monitor แยก "endpoint หาย" ไม่ออก — พิมพ์ path ผิดได้ 200 · cache/CDN อาจเก็บหน้า HTML ไว้ใต้ /api
มาตรฐาน: OWASP ASVS 5.0 V4.1 (Content-Type ตรงกับเนื้อหา) · RFC 9110 §15.5.5 (404)
"""

import os
import secrets
from urllib.parse import urlsplit

import requests

BASE_URL = os.environ.get("ONG_BASE_URL", "").rstrip("/")
TIMEOUT = 20
HEADERS = {"User-Agent": "ong-probe/1 (read-only; tests/testsprite)", "Accept": "application/json"}
NOT_FOUND = {"error": "not found"}


def url(path):
    assert BASE_URL.startswith(("https://", "http://")), "ตั้ง ONG_BASE_URL เป็น URL ของ environment ที่จะทดสอบก่อน"
    return BASE_URL + path


def own_origin():
    parts = urlsplit(url("/"))
    return f"{parts.scheme}://{parts.netloc}"


def expect_json_404(res, what):
    assert res.status_code == 404, f"{what}: ได้ {res.status_code} ควรได้ 404 — {res.text[:120]!r}"
    content_type = res.headers.get("Content-Type", "")
    assert content_type.startswith("application/json"), f"{what}: Content-Type {content_type!r} ควรเป็น JSON"
    assert res.json() == NOT_FOUND, f"{what}: body {res.text[:120]!r} ควรเป็น {NOT_FOUND}"


def test_unknown_api_get_is_json_404():
    for path in (f"/api/probe-{secrets.token_hex(4)}", f"/api/customers/{secrets.token_hex(4)}/nope", "/api/"):
        res = requests.get(url(path), headers=HEADERS, timeout=TIMEOUT, allow_redirects=False)
        expect_json_404(res, f"GET {path}")


def test_unknown_api_post_is_json_404():
    path = f"/api/probe-{secrets.token_hex(4)}"
    headers = {**HEADERS, "Origin": own_origin()}
    res = requests.post(url(path), headers=headers, json={}, timeout=TIMEOUT, allow_redirects=False)
    expect_json_404(res, f"POST {path}")


# TestSprite รันไฟล์นี้จากบนลงล่างและไม่ collect แบบ pytest — ต้องเรียกเทสต์เองท้ายไฟล์ (ไม่งั้นผ่านแบบว่างเปล่า)
# pytest ของเรา: conftest.py ตั้ง ONG_PROBE_RUNNER=pytest แล้วให้ pytest เป็นคนเรียกแทน
if os.environ.get("ONG_PROBE_RUNNER") != "pytest":
    for test in (
        test_unknown_api_get_is_json_404,
        test_unknown_api_post_is_json_404,
    ):
        test()
        print(f"PASS {test.__name__}")
