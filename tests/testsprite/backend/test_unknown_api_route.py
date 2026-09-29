"""path ที่ไม่มีใต้ /api ต้องได้ 404 {"error": "not found"} (สัญญา error ของ API · spec §5) ทุก method — ไม่ใช่หน้า SPA 200

กันถดถอยของ F1 (แก้ใน PR #61): เดิม GET /api/<ไม่มี> ได้ index.html 200 เพราะ notFound ของ sub-app ไม่ถูกเรียก
path ย่อยที่ไม่มีใต้ route ที่ต้อง login (customers · buy · reports · me · metals) ต้องหยุดที่ 401 ก่อน —
ไม่ login = ไม่รู้ว่า path ไหนมีอยู่ (auth ก่อน routing ไม่มี oracle)
ปลอดภัยกับ environment ที่ใช้ร่วม: คำขอเขียนไปที่ path ที่ไม่มีอยู่จริงเท่านั้น
มาตรฐาน: OWASP ASVS 5.0 V4.1 (Content-Type ตรงกับเนื้อหา) · RFC 9110 §15.5.5 (404) · OWASP API Security Top 10 2023 API8
"""

import os
import secrets
from urllib.parse import urlsplit

import requests

BASE_URL = os.environ.get("ONG_BASE_URL", "").rstrip("/")
TIMEOUT = 20
HEADERS = {"User-Agent": "ong-probe/1 (read-only; tests/testsprite)", "Accept": "application/json"}
NOT_FOUND = {"error": "not found"}
UNAUTHORIZED = {"error": "unauthorized"}


def url(path):
    assert BASE_URL.startswith(("https://", "http://")), "ตั้ง ONG_BASE_URL เป็น URL ของ environment ที่จะทดสอบก่อน"
    return BASE_URL + path


def own_origin():
    parts = urlsplit(url("/"))
    return f"{parts.scheme}://{parts.netloc}"


def expect_json(res, status, body, what):
    assert res.status_code == status, f"{what}: ได้ {res.status_code} ควรได้ {status} — {res.text[:120]!r}"
    content_type = res.headers.get("Content-Type", "")
    assert content_type.startswith("application/json"), f"{what}: Content-Type {content_type!r} ควรเป็น JSON"
    assert res.json() == body, f"{what}: body {res.text[:120]!r} ควรเป็น {body}"


def test_unknown_api_paths_are_json_404():
    probe = f"probe-{secrets.token_hex(4)}"
    for path in (f"/api/{probe}", f"/api/{probe}/deeper", "/api/", "/api"):
        res = requests.get(url(path), headers=HEADERS, timeout=TIMEOUT, allow_redirects=False)
        expect_json(res, 404, NOT_FOUND, f"GET {path}")


def test_unknown_api_path_is_json_404_for_every_method():
    path = f"/api/probe-{secrets.token_hex(4)}"
    headers = {**HEADERS, "Origin": own_origin()}
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        res = requests.request(method, url(path), headers=headers, json={}, timeout=TIMEOUT, allow_redirects=False)
        expect_json(res, 404, NOT_FOUND, f"{method} {path} (origin เดียวกัน)")


def test_unknown_subpaths_of_protected_routes_stop_at_auth():
    some = secrets.token_hex(4)
    for path in (f"/api/customers/{some}/nope", f"/api/buy/{some}/nope", f"/api/reports/{some}", f"/api/me/{some}"):
        res = requests.get(url(path), headers=HEADERS, timeout=TIMEOUT, allow_redirects=False)
        expect_json(res, 401, UNAUTHORIZED, f"GET {path}")


# TestSprite รันไฟล์นี้จากบนลงล่างและไม่ collect แบบ pytest — ต้องเรียกเทสต์เองท้ายไฟล์ (ไม่งั้นผ่านแบบว่างเปล่า)
# pytest ของเรา: conftest.py ตั้ง ONG_PROBE_RUNNER=pytest แล้วให้ pytest เป็นคนเรียกแทน
if os.environ.get("ONG_PROBE_RUNNER") != "pytest":
    for test in (
        test_unknown_api_paths_are_json_404,
        test_unknown_api_path_is_json_404_for_every_method,
        test_unknown_subpaths_of_protected_routes_stop_at_auth,
    ):
        test()
        print(f"PASS {test.__name__}")
