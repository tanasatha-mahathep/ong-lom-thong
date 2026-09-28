"""baseline ของ header ป้องกันฝั่ง browser — known failure F2 (ดู testsprite.json): แอปยังไม่ตั้ง header เหล่านี้เลย

ผ่านเมื่อ api ตั้ง header ครบ (เช่น hono/secure-headers) แล้วให้ถอด F2 ออกจาก testsprite.json เพื่อ sync ขึ้น TestSprite
HSTS ตรวจเฉพาะ URL https (ในเครื่องเป็น http = ข้าม)
มาตรฐาน: OWASP ASVS 5.0 V3.4 · OWASP Secure Headers Project · MDN HTTP Observatory
"""

import os
import re

import requests

BASE_URL = os.environ.get("ONG_BASE_URL", "").rstrip("/")
TIMEOUT = 20
HEADERS = {"User-Agent": "ong-probe/1 (read-only; tests/testsprite)"}
PRIVATE_REFERRER = {"no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"}


class NotApplicable(Exception):
    """เทสต์นี้ไม่เกี่ยวกับ environment นี้"""


def skip(reason):
    if os.environ.get("ONG_PROBE_RUNNER") == "pytest":
        import pytest  # noqa: PLC0415 — โหลดเฉพาะใต้ pytest ของเรา · รันเดี่ยว/บน TestSprite ไม่ต้องใช้

        pytest.skip(reason)
    raise NotApplicable(reason)


def url(path):
    assert BASE_URL.startswith(("https://", "http://")), "ตั้ง ONG_BASE_URL เป็น URL ของ environment ที่จะทดสอบก่อน"
    return BASE_URL + path


def get(path, accept):
    return requests.get(url(path), headers={**HEADERS, "Accept": accept}, timeout=TIMEOUT, allow_redirects=False)


def test_nosniff_everywhere():
    for path, accept in (("/", "text/html"), ("/api/healthz", "application/json"), ("/api/me", "application/json")):
        value = get(path, accept).headers.get("X-Content-Type-Options", "")
        assert value.lower() == "nosniff", f"GET {path}: X-Content-Type-Options = {value!r} ควรเป็น nosniff"


def test_html_cannot_be_framed():
    headers = get("/", "text/html").headers
    frame_options = headers.get("X-Frame-Options", "").upper()
    csp = headers.get("Content-Security-Policy", "")
    assert frame_options in ("DENY", "SAMEORIGIN") or "frame-ancestors" in csp, (
        f"GET /: ไม่มี X-Frame-Options/CSP frame-ancestors (clickjacking) — XFO={frame_options!r} CSP={csp!r}"
    )


def test_html_has_content_security_policy():
    csp = get("/", "text/html").headers.get("Content-Security-Policy", "")
    assert "default-src" in csp or "script-src" in csp, f"GET /: Content-Security-Policy = {csp!r}"


def test_referrer_policy_is_private():
    value = get("/", "text/html").headers.get("Referrer-Policy", "").lower()
    policies = {p.strip() for p in value.split(",") if p.strip()}
    assert policies & PRIVATE_REFERRER, f"GET /: Referrer-Policy = {value!r}"


def test_hsts_on_https():
    if not BASE_URL.startswith("https://"):
        skip("HSTS ตรวจเฉพาะ https")
    value = get("/", "text/html").headers.get("Strict-Transport-Security", "")
    max_age = re.search(r"max-age=\"?(\d+)", value, re.IGNORECASE)
    assert max_age and int(max_age.group(1)) >= 31536000, f"GET /: Strict-Transport-Security = {value!r} (ต้อง ≥ 1 ปี)"


# TestSprite รันไฟล์นี้จากบนลงล่างและไม่ collect แบบ pytest — ต้องเรียกเทสต์เองท้ายไฟล์ (ไม่งั้นผ่านแบบว่างเปล่า)
# pytest ของเรา: conftest.py ตั้ง ONG_PROBE_RUNNER=pytest แล้วให้ pytest เป็นคนเรียกแทน
if os.environ.get("ONG_PROBE_RUNNER") != "pytest":
    for test in (
        test_nosniff_everywhere,
        test_html_cannot_be_framed,
        test_html_has_content_security_policy,
        test_referrer_policy_is_private,
        test_hsts_on_https,
    ):
        try:
            test()
            print(f"PASS {test.__name__}")
        except NotApplicable as reason:
            print(f"SKIP {test.__name__}: {reason}")
