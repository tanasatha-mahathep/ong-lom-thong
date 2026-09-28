"""ต้อง login — ทุก route ข้อมูลใต้ /api ตอบ 401 {"error": "unauthorized"} เมื่อไม่มี session ที่ถูกต้อง

ครอบคลุม: ไม่มี cookie · cookie ปลอม (ทั้งชื่อปกติและ __Secure-) · Bearer token (ไม่มีช่องทาง auth อื่นนอกจาก cookie)
และคำขอเขียนจาก origin เดียวกันที่ผ่าน CSRF guard แล้วต้องหยุดที่ auth — body ตั้งใจให้ผิดรูป ต่อให้ auth ถดถอยก็เขียนอะไรไม่ได้
ไม่ยิง /api/auth/sign-in/* เลย (rate limit ของ better-auth เป็น bucket ร่วม — ยิงแล้วอาจล็อกการ login ของพนักงาน)
มาตรฐาน: OWASP ASVS 5.0 V8 (authorization ที่ฝั่งเซิร์ฟเวอร์) · OWASP API Security Top 10 2023 API2 Broken Authentication
"""

import os
import secrets
import uuid
from urllib.parse import urlsplit

import requests

BASE_URL = os.environ.get("ONG_BASE_URL", "").rstrip("/")
TIMEOUT = 20
HEADERS = {"User-Agent": "ong-probe/1 (read-only; tests/testsprite)", "Accept": "application/json"}
UNAUTHORIZED = {"error": "unauthorized"}


def url(path):
    assert BASE_URL.startswith(("https://", "http://")), "ตั้ง ONG_BASE_URL เป็น URL ของ environment ที่จะทดสอบก่อน"
    return BASE_URL + path


def own_origin():
    parts = urlsplit(url("/"))
    return f"{parts.scheme}://{parts.netloc}"


def protected_reads():
    some_id = uuid.uuid4()
    return [
        "/api/me",
        "/api/metals",
        "/api/gold-price/today",
        "/api/customers",
        "/api/customers?q=%E0%B8%97%E0%B8%94%E0%B8%AA%E0%B8%AD%E0%B8%9A",
        f"/api/customers/{some_id}",
        f"/api/customers/{some_id}/photo",
    ]


def expect_401(res, what):
    assert res.status_code == 401, f"{what}: ได้ {res.status_code} ควรได้ 401 — {res.text[:200]!r}"
    assert res.json() == UNAUTHORIZED, f"{what}: body {res.text[:200]!r} ควรเป็น {UNAUTHORIZED}"
    assert "Set-Cookie" not in res.headers, f"{what}: 401 ไม่ควรออก cookie ({res.headers.get('Set-Cookie')!r})"


def test_reads_without_session_are_401():
    for path in protected_reads():
        res = requests.get(url(path), headers=HEADERS, timeout=TIMEOUT, allow_redirects=False)
        expect_401(res, f"GET {path}")


def test_forged_session_cookies_are_401():
    token = f"{secrets.token_urlsafe(24)}.{secrets.token_urlsafe(32)}"
    for name in ("better-auth.session_token", "__Secure-better-auth.session_token"):
        for path in ("/api/me", "/api/customers"):
            headers = {**HEADERS, "Cookie": f"{name}={token}"}
            res = requests.get(url(path), headers=headers, timeout=TIMEOUT, allow_redirects=False)
            expect_401(res, f"GET {path} + cookie ปลอม {name}")


def test_bearer_token_is_not_accepted():
    headers = {**HEADERS, "Authorization": f"Bearer {secrets.token_urlsafe(32)}"}
    for path in ("/api/me", "/api/customers"):
        res = requests.get(url(path), headers=headers, timeout=TIMEOUT, allow_redirects=False)
        expect_401(res, f"GET {path} + Bearer")


def test_same_origin_writes_without_session_are_401():
    some_id = uuid.uuid4()
    headers = {**HEADERS, "Origin": own_origin()}
    writes = [
        ("POST", "/api/me/branch"),
        ("POST", "/api/gold-price/quote"),
        ("PUT", "/api/gold-price/today"),
        ("POST", "/api/customers"),
        ("PUT", f"/api/customers/{some_id}"),
    ]
    for method, path in writes:
        res = requests.request(method, url(path), headers=headers, json={}, timeout=TIMEOUT, allow_redirects=False)
        expect_401(res, f"{method} {path} (origin เดียวกัน · ไม่มี session)")


# TestSprite รันไฟล์นี้จากบนลงล่างและไม่ collect แบบ pytest — ต้องเรียกเทสต์เองท้ายไฟล์ (ไม่งั้นผ่านแบบว่างเปล่า)
# pytest ของเรา: conftest.py ตั้ง ONG_PROBE_RUNNER=pytest แล้วให้ pytest เป็นคนเรียกแทน
if os.environ.get("ONG_PROBE_RUNNER") != "pytest":
    for test in (
        test_reads_without_session_are_401,
        test_forged_session_cookies_are_401,
        test_bearer_token_is_not_accepted,
        test_same_origin_writes_without_session_are_401,
    ):
        test()
        print(f"PASS {test.__name__}")
