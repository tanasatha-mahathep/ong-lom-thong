"""liveness — /healthz (Railway healthcheck) และ /api/healthz (ผ่าน middleware ของ /api)

ไม่ต้อง login · ตอบ JSON {ok, time} เท่านั้น — endpoint สาธารณะห้ามเปิดเผย version/env/DB (OWASP ASVS 5.0 V13.4)
อ่านอย่างเดียว · ไม่มีค่าลับ · รันได้ทั้ง pytest (ONG_BASE_URL=... pytest) และรันเป็นสคริปต์ (python test_health.py)
"""

import os
import re

import requests

BASE_URL = os.environ.get("ONG_BASE_URL", "").rstrip("/")
TIMEOUT = 20
HEADERS = {"User-Agent": "ong-probe/1 (read-only; tests/testsprite)", "Accept": "application/json"}
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$")


def url(path):
    assert BASE_URL.startswith(("https://", "http://")), "ตั้ง ONG_BASE_URL เป็น URL ของ environment ที่จะทดสอบก่อน"
    return BASE_URL + path


def check_health(path):
    res = requests.get(url(path), headers=HEADERS, timeout=TIMEOUT, allow_redirects=False)
    assert res.status_code == 200, f"GET {path}: ได้ {res.status_code} ควรได้ 200 — {res.text[:200]!r}"
    content_type = res.headers.get("Content-Type", "")
    assert content_type.startswith("application/json"), f"GET {path}: Content-Type {content_type!r} ควรเป็น JSON"
    body = res.json()
    # allow-list: เพิ่ม field ใหม่ต้องตั้งใจ (แก้เทสต์นี้พร้อมเหตุผล) — กันเผลอส่ง version/env/สถานะ DB ออก endpoint สาธารณะ
    assert sorted(body) == ["ok", "time"], f"GET {path}: field {sorted(body)} ควรมีแค่ ['ok', 'time']"
    assert body["ok"] is True, f"GET {path}: ok = {body['ok']!r}"
    assert isinstance(body["time"], str) and ISO_UTC.match(body["time"]), (
        f"GET {path}: time {body['time']!r} ไม่ใช่ ISO-8601 UTC"
    )


def test_root_healthz():
    check_health("/healthz")


def test_api_healthz():
    check_health("/api/healthz")


# TestSprite รันไฟล์นี้จากบนลงล่างและไม่ collect แบบ pytest — ต้องเรียกเทสต์เองท้ายไฟล์ (ไม่งั้นผ่านแบบว่างเปล่า)
# pytest ของเรา: conftest.py ตั้ง ONG_PROBE_RUNNER=pytest แล้วให้ pytest เป็นคนเรียกแทน
if os.environ.get("ONG_PROBE_RUNNER") != "pytest":
    for test in (
        test_root_healthz,
        test_api_healthz,
    ):
        test()
        print(f"PASS {test.__name__}")
