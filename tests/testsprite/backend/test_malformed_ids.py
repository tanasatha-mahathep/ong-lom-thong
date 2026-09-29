"""id สุ่ม/ผิดรูปใน path ของลูกค้าและใบรับซื้อ — ต้องไม่ทำให้เซิร์ฟเวอร์ล้ม (5xx) และต้องไม่บอกใบ้อะไรก่อน login

ไม่มี session: ทุก id (สุ่ม · nil · ไม่ใช่ UUID · SQL · path traversal · NUL · ยาวมาก · ภาษาไทย · %-encoding เสีย · CRLF)
ต้องได้ 401 เหมือนกันทุกตัว (auth ก่อน lookup = ไม่มี oracle ว่า id ไหนมีอยู่/รูปแบบไหนถูก) และไม่ฉีด header ได้
กรณี login แล้ว (id ผิดรูป/ไม่มี = 404 ไม่ใช่ 500) ต้องใช้บัญชีทดสอบ — ระยะ 2 ดู README
มาตรฐาน: OWASP API Security Top 10 2023 API1 (BOLA — ไม่เปิดเผยการมีอยู่) · OWASP ASVS 5.0 V16.5 (error handling)
"""

import os
import uuid

import requests

BASE_URL = os.environ.get("ONG_BASE_URL", "").rstrip("/")
TIMEOUT = 20
HEADERS = {"User-Agent": "ong-probe/1 (read-only; tests/testsprite)", "Accept": "application/json"}
UNAUTHORIZED = {"error": "unauthorized"}

# ส่งตามตัวอักษร (ไม่ให้ requests encode ซ้ำ) — %ZZ กับ %E0%B8 คือ percent-encoding ที่เสียโดยตั้งใจ
RAW_IDS = [
    str(uuid.uuid4()),
    "00000000-0000-0000-0000-000000000000",
    "not-a-uuid",
    "%27%20OR%201%3D1--",
    "..%2F..%2F..%2Fetc%2Fpasswd",
    "%00",
    "a" * 2000,
    "%E0%B8%97%E0%B8%94%E0%B8%AA%E0%B8%AD%E0%B8%9A",
    "%ZZ",
    "%E0%B8",
    "%0d%0aSet-Cookie:%20probe=1",
    "1;DROP%20TABLE%20customer",
]


def url(path):
    assert BASE_URL.startswith(("https://", "http://")), "ตั้ง ONG_BASE_URL เป็น URL ของ environment ที่จะทดสอบก่อน"
    return BASE_URL + path


def raw_get(path):
    """GET โดยคง path ตามตัวอักษร — requests ปกติจะแก้ %ZZ เป็น %25ZZ ทำให้ไม่ได้ทดสอบจริง"""
    with requests.Session() as session:
        prepared = session.prepare_request(requests.Request("GET", url("/"), headers=HEADERS))
        prepared.url = url(path)
        return session.send(prepared, timeout=TIMEOUT, allow_redirects=False)


def test_malformed_ids_are_uniform_401():
    for raw_id in RAW_IDS:
        for path in (f"/api/customers/{raw_id}", f"/api/customers/{raw_id}/photo", f"/api/buy/{raw_id}"):
            res = raw_get(path)
            what = f"GET {path[:80]}"
            assert res.status_code < 500, f"{what}: เซิร์ฟเวอร์ล้ม {res.status_code} — {res.text[:200]!r}"
            assert res.status_code == 401, f"{what}: ได้ {res.status_code} ควรได้ 401 — {res.text[:200]!r}"
            assert res.json() == UNAUTHORIZED, f"{what}: body {res.text[:200]!r} ควรเป็น {UNAUTHORIZED}"
            assert "Set-Cookie" not in res.headers, f"{what}: มี Set-Cookie หลุดมา (header injection?)"


def test_malformed_query_params_are_401_not_5xx():
    queries = ("page=abc", "page=-1", "page=99999999999999999999", "q=%ZZ", "q=%00", "q=" + "x" * 3000)
    buy_only = ("date_from=2026-13-45", "date_to=%ZZ", "metal=" + "x" * 200, "branch_id=%00")
    for path, query in [("/api/customers", q) for q in queries] + [("/api/buy", q) for q in queries + buy_only]:
        res = raw_get(f"{path}?{query}")
        what = f"GET {path}?{query[:40]}"
        assert res.status_code == 401, f"{what}: ได้ {res.status_code} ควรได้ 401 — {res.text[:200]!r}"


# TestSprite รันไฟล์นี้จากบนลงล่างและไม่ collect แบบ pytest — ต้องเรียกเทสต์เองท้ายไฟล์ (ไม่งั้นผ่านแบบว่างเปล่า)
# pytest ของเรา: conftest.py ตั้ง ONG_PROBE_RUNNER=pytest แล้วให้ pytest เป็นคนเรียกแทน
if os.environ.get("ONG_PROBE_RUNNER") != "pytest":
    for test in (
        test_malformed_ids_are_uniform_401,
        test_malformed_query_params_are_401_not_5xx,
    ):
        test()
        print(f"PASS {test.__name__}")
