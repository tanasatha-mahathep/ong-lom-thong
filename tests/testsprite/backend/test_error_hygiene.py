"""error body ต้องไม่มี stack trace / path ภายใน / ข้อความจาก DB — ทุกคำขอที่ตั้งใจให้ผิดต้องไม่ทำให้เซิร์ฟเวอร์ 5xx

ยั่วด้วย: ไม่มี session · origin อื่น · JSON เสีย · Content-Type ผิด · multipart เสีย · %-encoding เสีย · path ไม่มีอยู่ · method แปลก
ปลอดภัยกับ environment ที่ใช้ร่วม: ทุกคำขอถูกปฏิเสธก่อนถึงตรรกะธุรกิจ · ไม่แตะ /api/auth/sign-in/*
มาตรฐาน: OWASP ASVS 5.0 V16.5 (ข้อความ error ทั่วไป ไม่มี stack trace) · V13.4 (ไม่เปิดเผยข้อมูลภายใน) · CWE-209
"""

import os
import re
import secrets
from urllib.parse import urlsplit

import requests

BASE_URL = os.environ.get("ONG_BASE_URL", "").rstrip("/")
TIMEOUT = 20
HEADERS = {"User-Agent": "ong-probe/1 (read-only; tests/testsprite)", "Accept": "application/json"}

# body อาจเป็น JSON ที่ escape บรรทัดใหม่เป็น \\n — ตรวจทั้งสองแบบ
LEAKS = {
    "V8 stack frame": re.compile(r"(?:\n|\\n)\s*at \S+"),
    "file:line": re.compile(r"\.(?:ts|tsx|js|mjs|cjs|py):\d+"),
    "node_modules": re.compile(r"node_modules"),
    "node internals": re.compile(r"node:internal"),
    "Python traceback": re.compile(r"Traceback \(most recent call last\)"),
    "server path": re.compile(r"(?:file://|^|[\s\"'(])/(?:app|repo|home|Users|usr|opt|private|var|tmp|srv)/"),
    "errno": re.compile(r"\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EADDRINUSE)\b"),
    "Postgres error": re.compile(r"SQLSTATE|syntax error at or near|violates \w+ constraint|relation \"\w+\""),
    "library error class": re.compile(
        r"\b(?:PostgresError|DrizzleError|DrizzleQueryError|ZodError|TypeError|ReferenceError)\b"
    ),
    "stack field": re.compile(r"\"stack\"\s*:"),
}


def url(path):
    assert BASE_URL.startswith(("https://", "http://")), "ตั้ง ONG_BASE_URL เป็น URL ของ environment ที่จะทดสอบก่อน"
    return BASE_URL + path


def own_origin():
    parts = urlsplit(url("/"))
    return f"{parts.scheme}://{parts.netloc}"


def raw(method, path, headers=None, data=None):
    with requests.Session() as session:
        prepared = session.prepare_request(
            requests.Request(method, url("/"), headers={**HEADERS, **(headers or {})}, data=data)
        )
        prepared.url = url(path)
        return session.send(prepared, timeout=TIMEOUT, allow_redirects=False)


def provocations():
    same = {"Origin": own_origin()}
    json_type = {"Content-Type": "application/json"}
    return [
        ("GET", "/api/me", {}, None),
        ("GET", "/api/customers?page=abc", {}, None),
        ("GET", "/api/customers/%ZZ", {}, None),
        ("GET", "/api/customers/%E0%B8/photo", {}, None),
        ("POST", "/api/me/branch", {"Origin": "https://evil.example", **json_type}, b"{}"),
        ("POST", "/api/me/branch", {**same, **json_type}, b'{"branch_id":'),
        ("POST", "/api/gold-price/quote", {**same, **json_type}, b"\xff\xfe not json"),
        ("POST", "/api/customers", {**same, "Content-Type": "multipart/form-data; boundary=x"}, b"--x\r\nbroken"),
        ("PUT", "/api/gold-price/today", {**same, "Content-Type": "text/plain"}, b"67850"),
        ("POST", "/api/buy/quote", {**same, **json_type}, b'{"lines": [{"weight_g": 1e999}]'),
        ("POST", "/api/buy", {**same, **json_type}, b"[" * 5000),
        ("GET", "/api/buy?date_from=2026-02-30&page=0", {}, None),
        ("GET", "/api/buy/%E0%B8", {}, None),
        ("POST", f"/api/probe-{secrets.token_hex(4)}", {**same, **json_type}, b"{}"),
        ("PROPFIND", "/api/healthz", same, None),
        ("GET", f"/api/auth/probe-{secrets.token_hex(4)}", {}, None),
    ]


def test_error_bodies_do_not_leak_internals():
    for method, path, headers, body in provocations():
        res = raw(method, path, headers, body)
        what = f"{method} {path}"
        assert res.status_code < 500, f"{what}: เซิร์ฟเวอร์ล้ม {res.status_code} — {res.text[:200]!r}"
        for name, pattern in LEAKS.items():
            assert not pattern.search(res.text), f"{what}: body มี {name} — {res.text[:300]!r}"
        for header in ("X-Powered-By", "X-Debug", "X-Error", "X-Stack"):
            assert header not in res.headers, f"{what}: มี header {header}: {res.headers[header]!r}"


# TestSprite รันไฟล์นี้จากบนลงล่างและไม่ collect แบบ pytest — ต้องเรียกเทสต์เองท้ายไฟล์ (ไม่งั้นผ่านแบบว่างเปล่า)
# pytest ของเรา: conftest.py ตั้ง ONG_PROBE_RUNNER=pytest แล้วให้ pytest เป็นคนเรียกแทน
if os.environ.get("ONG_PROBE_RUNNER") != "pytest":
    for test in (test_error_bodies_do_not_leak_internals,):
        test()
        print(f"PASS {test.__name__}")
