"""ตัวรันของเราเอง (pytest) — ไฟล์นี้ไม่ถูก sync ขึ้น TestSprite (sync เฉพาะไฟล์ใน testsprite.json)

- ไม่มี ONG_BASE_URL = หยุดทันที (ไม่เดาเป้าหมาย)
- known failure ใน testsprite.json → xfail(strict=True): ยังพัง = xfail · แก้แล้วผ่าน = XPASS(strict) → fail
  เพื่อเตือนให้ถอด known_failure ออกจาก manifest แล้ว sync เทสต์นั้นขึ้น TestSprite
"""

import json
import os
from pathlib import Path

import pytest

# ไฟล์เทสต์เช็คตัวนี้ก่อนเรียกเทสต์ของตัวเองที่ท้ายไฟล์ (แบบ TestSprite) — ใต้ pytest ให้ pytest เรียกแทน ไม่รันซ้ำตอน import
os.environ["ONG_PROBE_RUNNER"] = "pytest"

MANIFEST = json.loads((Path(__file__).resolve().parent.parent / "testsprite.json").read_text(encoding="utf-8"))
KNOWN_FAILURES = {
    (Path(entry["file"]).name, test): f"{entry['known_failure']['id']}: {entry['known_failure']['title']}"
    for entry in MANIFEST["tests"]
    if "known_failure" in entry
    for test in entry["known_failure"]["tests"]
}


def pytest_configure(config):
    base_url = os.environ.get("ONG_BASE_URL", "")
    if not base_url.startswith(("https://", "http://")):
        raise pytest.UsageError("ตั้ง ONG_BASE_URL เป็น URL ของ environment ที่จะทดสอบ (เช่น http://localhost:28787)")


def pytest_report_header(config):
    return f"ONG_BASE_URL = {os.environ.get('ONG_BASE_URL')}"


def pytest_collection_modifyitems(config, items):
    for item in items:
        reason = KNOWN_FAILURES.get((item.path.name, item.name))
        if reason:
            item.add_marker(pytest.mark.xfail(reason=reason, strict=True))
