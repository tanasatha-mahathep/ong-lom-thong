"""CSRF — คำขอที่เปลี่ยนสถานะจาก origin อื่น (หรือไม่มี Origin) ต้องได้ 403 {"error": "forbidden origin"} ก่อนถึง auth

มี positive control: origin เดียวกันต้องผ่าน guard ไปหยุดที่ 401 — พิสูจน์ว่า 403 มาจาก Origin ไม่ใช่อย่างอื่น (เช่น WAF)
GET จาก origin อื่นยังได้ (guard ไม่บล็อกเกิน) แต่ต้องไม่มี CORS ที่เปิดให้ origin อื่นอ่านผลพร้อม cookie
ปลอดภัยกับ environment ที่ใช้ร่วม: ทุกคำขอถูกปฏิเสธก่อนถึง handler · body ผิดรูปโดยตั้งใจ · ไม่แตะ /api/auth/sign-in/*
มาตรฐาน: OWASP ASVS 5.0 V3.5 (browser origin separation) · V3.4 (CORS)
· OWASP CSRF Prevention Cheat Sheet (ตรวจ Origin ฝั่งเซิร์ฟเวอร์)
"""

import os
import uuid
from urllib.parse import urlsplit

import requests

BASE_URL = os.environ.get("ONG_BASE_URL", "").rstrip("/")
TIMEOUT = 20
HEADERS = {"User-Agent": "ong-probe/1 (read-only; tests/testsprite)", "Accept": "application/json"}
FORBIDDEN_ORIGIN = {"error": "forbidden origin"}
MISSING = None  # ไม่ส่ง header Origin เลย


def url(path):
    assert BASE_URL.startswith(("https://", "http://")), "ตั้ง ONG_BASE_URL เป็น URL ของ environment ที่จะทดสอบก่อน"
    return BASE_URL + path


def own_origin():
    parts = urlsplit(url("/"))
    return f"{parts.scheme}://{parts.netloc}"


def foreign_origins():
    parts = urlsplit(own_origin())
    other_scheme = "http" if parts.scheme == "https" else "https"
    return [
        "https://evil.example",
        "null",  # sandboxed iframe / file:// / redirect ข้าม origin
        f"{own_origin()}.evil.example",  # ต่อท้ายชื่อโดเมนจริง — ต้องเทียบทั้ง origin ไม่ใช่ prefix
        f"{parts.scheme}://evil.{parts.netloc}",  # subdomain ของโดเมนจริง
        f"{other_scheme}://{parts.netloc}",  # scheme อื่น = origin อื่น
        MISSING,
    ]


def state_changing_requests():
    some_id = uuid.uuid4()
    return [
        ("POST", "/api/me/branch"),
        ("POST", "/api/gold-price/quote"),
        ("PUT", "/api/gold-price/today"),
        ("POST", "/api/customers"),
        ("PUT", f"/api/customers/{some_id}"),
        ("DELETE", f"/api/customers/{some_id}"),
        ("PATCH", "/api/me"),
        ("POST", "/api/auth/sign-out"),
    ]


def send(method, path, origin):
    headers = dict(HEADERS)
    if origin is not MISSING:
        headers["Origin"] = origin
    return requests.request(method, url(path), headers=headers, json={}, timeout=TIMEOUT, allow_redirects=False)


def test_foreign_origin_writes_are_403():
    for method, path in state_changing_requests():
        for origin in foreign_origins():
            res = send(method, path, origin)
            what = f"{method} {path} · Origin {origin!r}"
            assert res.status_code == 403, f"{what}: ได้ {res.status_code} ควรได้ 403 — {res.text[:200]!r}"
            assert res.json() == FORBIDDEN_ORIGIN, f"{what}: body {res.text[:200]!r} ควรเป็น {FORBIDDEN_ORIGIN}"


def test_same_origin_write_passes_the_guard_and_stops_at_auth():
    res = send("POST", "/api/me/branch", own_origin())
    assert res.status_code == 401, (
        f"POST /api/me/branch origin เดียวกัน: ได้ {res.status_code} ควรได้ 401 — {res.text[:200]!r}"
    )


def test_foreign_origin_reads_are_allowed_without_cors():
    headers = {**HEADERS, "Origin": "https://evil.example"}
    res = requests.get(url("/api/healthz"), headers=headers, timeout=TIMEOUT, allow_redirects=False)
    assert res.status_code == 200, f"GET /api/healthz จาก origin อื่น: ได้ {res.status_code} ควรได้ 200"
    check_no_cors(res, "GET /api/healthz")

    preflight = {
        **HEADERS,
        "Origin": "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }
    res = requests.options(url("/api/me/branch"), headers=preflight, timeout=TIMEOUT, allow_redirects=False)
    assert res.status_code < 500, f"OPTIONS /api/me/branch: ได้ {res.status_code}"
    check_no_cors(res, "OPTIONS /api/me/branch (preflight)")


def check_no_cors(res, what):
    # ไม่มี ACAO = browser ไม่ให้ origin อื่นอ่านผล · ACAO = origin ตัวเองก็ไม่เปิดอะไรเพิ่ม · "*" หรือ echo origin อื่น = รั่ว
    allow_origin = res.headers.get("Access-Control-Allow-Origin")
    assert allow_origin in (None, own_origin()), (
        f"{what}: Access-Control-Allow-Origin = {allow_origin!r} (เปิดให้ origin อื่น)"
    )


# TestSprite รันไฟล์นี้จากบนลงล่างและไม่ collect แบบ pytest — ต้องเรียกเทสต์เองท้ายไฟล์ (ไม่งั้นผ่านแบบว่างเปล่า)
# pytest ของเรา: conftest.py ตั้ง ONG_PROBE_RUNNER=pytest แล้วให้ pytest เป็นคนเรียกแทน
if os.environ.get("ONG_PROBE_RUNNER") != "pytest":
    for test in (
        test_foreign_origin_writes_are_403,
        test_same_origin_write_passes_the_guard_and_stops_at_auth,
        test_foreign_origin_reads_are_allowed_without_cors,
    ):
        test()
        print(f"PASS {test.__name__}")
