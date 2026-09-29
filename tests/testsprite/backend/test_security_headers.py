"""security headers ที่สังเกตได้ — พิมพ์ header ของหน้า HTML · JSON · 401 ลง log ทุกครั้ง (หลักฐานสำหรับรีวิว)

assert เฉพาะสิ่งที่ต้องไม่ถดถอย: ไม่บอกชื่อ/เวอร์ชันซอฟต์แวร์ (X-Powered-By · Server มีเลขเวอร์ชัน) · cookie ต้อง HttpOnly+SameSite
(+Secure บน https) · JSON ต้องประกาศ Content-Type ถูก · ไม่มี CORS wildcard
header ป้องกันฝั่ง browser (nosniff · frame-ancestors · CSP · Referrer-Policy · COOP · no-store · HSTS)
ตรวจละเอียดที่ test_security_headers_baseline.py
มาตรฐาน: OWASP ASVS 5.0 V3.3 (cookie) · V3.4 (security headers) · V13.4 (version disclosure)
· OWASP Secure Headers Project
"""

import functools
import os
import re

import requests

BASE_URL = os.environ.get("ONG_BASE_URL", "").rstrip("/")
TIMEOUT = 20
HEADERS = {"User-Agent": "ong-probe/1 (read-only; tests/testsprite)"}
OBSERVED = (
    "Content-Type",
    "Cache-Control",
    "Strict-Transport-Security",
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
    "Access-Control-Allow-Origin",
    "Server",
    "X-Powered-By",
    "Set-Cookie",
)
VERSION = re.compile(r"\d+\.\d+")


def url(path):
    assert BASE_URL.startswith(("https://", "http://")), "ตั้ง ONG_BASE_URL เป็น URL ของ environment ที่จะทดสอบก่อน"
    return BASE_URL + path


@functools.lru_cache(maxsize=1)
def fetch_samples():
    """ยิงครั้งเดียวต่อรอบ — ทุกเทสต์ในไฟล์ใช้ผลชุดเดียวกัน"""
    samples = {}
    for label, path, accept in (
        ("html /", "/", "text/html"),
        ("json /api/healthz", "/api/healthz", "application/json"),
        ("401 /api/me", "/api/me", "application/json"),
    ):
        res = requests.get(url(path), headers={**HEADERS, "Accept": accept}, timeout=TIMEOUT, allow_redirects=False)
        samples[label] = res
        observed = {name: res.headers.get(name) for name in OBSERVED if name in res.headers}
        print(f"[observed] {label} {res.status_code} {observed}")
    return samples


def test_no_software_version_disclosure():
    for label, res in fetch_samples().items():
        assert "X-Powered-By" not in res.headers, f"{label}: X-Powered-By = {res.headers['X-Powered-By']!r}"
        server = res.headers.get("Server", "")
        assert not VERSION.search(server), f"{label}: Server = {server!r} บอกเวอร์ชัน"


def test_json_responses_declare_json():
    for label, res in fetch_samples().items():
        if label.startswith(("json", "401")):
            content_type = res.headers.get("Content-Type", "")
            assert content_type.startswith("application/json"), f"{label}: Content-Type {content_type!r}"


def test_no_cors_wildcard():
    for label, res in fetch_samples().items():
        assert res.headers.get("Access-Control-Allow-Origin") != "*", f"{label}: Access-Control-Allow-Origin = *"


def test_cookies_if_any_are_hardened():
    https = BASE_URL.startswith("https://")
    for label, res in fetch_samples().items():
        for cookie in res.raw.headers.getlist("Set-Cookie"):
            flags = cookie.lower()
            name = cookie.split("=", 1)[0]
            assert "httponly" in flags, f"{label}: cookie {name} ไม่มี HttpOnly"
            assert "samesite=" in flags, f"{label}: cookie {name} ไม่มี SameSite"
            if https:
                assert "secure" in flags, f"{label}: cookie {name} ไม่มี Secure บน https"


# TestSprite รันไฟล์นี้จากบนลงล่างและไม่ collect แบบ pytest — ต้องเรียกเทสต์เองท้ายไฟล์ (ไม่งั้นผ่านแบบว่างเปล่า)
# pytest ของเรา: conftest.py ตั้ง ONG_PROBE_RUNNER=pytest แล้วให้ pytest เป็นคนเรียกแทน
if os.environ.get("ONG_PROBE_RUNNER") != "pytest":
    for test in (
        test_no_software_version_disclosure,
        test_json_responses_declare_json,
        test_no_cors_wildcard,
        test_cookies_if_any_are_hardened,
    ):
        test()
        print(f"PASS {test.__name__}")
