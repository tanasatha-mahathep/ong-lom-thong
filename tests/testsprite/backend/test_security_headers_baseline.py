"""baseline ของ header ป้องกันฝั่ง browser — กันถดถอยของ F2 (แก้ใน PR #61: hono/secure-headers + /api no-store)

nosniff ทุก response · กัน framing (X-Frame-Options/CSP frame-ancestors) · CSP ที่ไม่ยอม inline/eval script ·
Referrer-Policy ที่ไม่ส่ง path ข้ามเว็บ · COOP · /api ไม่ให้ cache (ข้อมูลลูกค้า/บิล) · HSTS ≥ 1 ปี (เฉพาะ https)
มาตรฐาน: OWASP ASVS 5.0 V3.4 · V14.3 (ไม่ cache ข้อมูลอ่อนไหว) · OWASP Secure Headers Project · MDN HTTP Observatory
"""

import os
import re

import requests

BASE_URL = os.environ.get("ONG_BASE_URL", "").rstrip("/")
TIMEOUT = 20
HEADERS = {"User-Agent": "ong-probe/1 (read-only; tests/testsprite)"}
PRIVATE_REFERRER = {"no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"}
SAMPLES = (("/", "text/html"), ("/api/healthz", "application/json"), ("/api/me", "application/json"))


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


def csp_directives(value):
    """ "a b; c d" → {"a": ["b"], "c": ["d"]} (ชื่อ directive ตัวเล็ก)"""
    directives = {}
    for part in value.split(";"):
        tokens = part.split()
        if tokens:
            directives[tokens[0].lower()] = tokens[1:]
    return directives


def test_nosniff_everywhere():
    for path, accept in SAMPLES:
        value = get(path, accept).headers.get("X-Content-Type-Options", "")
        assert value.lower() == "nosniff", f"GET {path}: X-Content-Type-Options = {value!r} ควรเป็น nosniff"


def test_html_cannot_be_framed():
    headers = get("/", "text/html").headers
    frame_options = headers.get("X-Frame-Options", "").upper()
    ancestors = csp_directives(headers.get("Content-Security-Policy", "")).get("frame-ancestors")
    assert frame_options in ("DENY", "SAMEORIGIN") or ancestors, (
        f"GET /: ไม่มี X-Frame-Options/CSP frame-ancestors (clickjacking) — XFO={frame_options!r} ancestors={ancestors!r}"
    )


def test_html_csp_blocks_inline_and_eval_script():
    csp = get("/", "text/html").headers.get("Content-Security-Policy", "")
    directives = csp_directives(csp)
    script = directives.get("script-src", directives.get("default-src"))
    assert script, f"GET /: CSP ไม่มี script-src/default-src — {csp!r}"
    unsafe = {"'unsafe-inline'", "'unsafe-eval'", "*", "data:", "http:", "https:"} & {s.lower() for s in script}
    assert not unsafe, f"GET /: CSP ยอม script จาก {sorted(unsafe)} — {csp!r}"
    assert directives.get("object-src") == ["'none'"], f"GET /: CSP object-src ควรเป็น 'none' — {csp!r}"


def test_referrer_policy_is_private():
    value = get("/", "text/html").headers.get("Referrer-Policy", "").lower()
    policies = {p.strip() for p in value.split(",") if p.strip()}
    assert policies & PRIVATE_REFERRER, f"GET /: Referrer-Policy = {value!r}"


def test_html_isolates_its_browsing_context():
    value = get("/", "text/html").headers.get("Cross-Origin-Opener-Policy", "").lower()
    assert value == "same-origin", f"GET /: Cross-Origin-Opener-Policy = {value!r} ควรเป็น same-origin"


def test_api_responses_are_not_cached():
    for path in ("/api/healthz", "/api/me", "/api/probe-not-cached"):
        value = get(path, "application/json").headers.get("Cache-Control", "").lower()
        assert "no-store" in value, f"GET {path}: Cache-Control = {value!r} ควรมี no-store"


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
        test_html_csp_blocks_inline_and_eval_script,
        test_referrer_policy_is_private,
        test_html_isolates_its_browsing_context,
        test_api_responses_are_not_cached,
        test_hsts_on_https,
    ):
        try:
            test()
            print(f"PASS {test.__name__}")
        except NotApplicable as reason:
            print(f"SKIP {test.__name__}: {reason}")
