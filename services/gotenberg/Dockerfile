# Gotenberg (Chromium → PDF) + ฟอนต์ Sarabun ให้ใบรับซื้อพิมพ์ไทยได้เหมือนใบจริง
# ปักเวอร์ชันเต็ม — dependabot เสนออัปเดต minor/patch · major ต้องเทียบ PDF กับใบจริงก่อน
FROM gotenberg/gotenberg:8.37.0@sha256:f29984bd1e226bf1b93ba90af06000afa8b315853e99d27b9aaa41b93f15c769

USER root
# Gotenberg 8.37.0 (ล่าสุด ณ 29 ก.ย. 2026) มากับ Chromium 152 — Debian security ออก Chromium 154 + perl · glib แล้ว
# (Trivy: CRITICAL 26 → ดู docs/proposals/railway-deploy-attested-image.md) · upgrade จาก trixie-security ตอน build
# ถอดบรรทัดนี้ได้เมื่อ upstream ออก release ที่มี Chromium ใหม่กว่า · ผ่าน pdf e2e + เทสต์ Gotenberg ของ apps/api แล้วเท่านั้น
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get -y upgrade --no-install-recommends \
  && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY fonts/Sarabun-Regular.ttf fonts/Sarabun-Bold.ttf /usr/share/fonts/truetype/sarabun/
RUN fc-cache -f
USER gotenberg

# --api-port-from-env ไม่มีค่าสำรอง — ตั้ง 3000 ไว้ให้ Railway/compose override ได้
ENV PORT=3000

# - พอร์ตจาก $PORT
# - basic auth: GOTENBERG_API_BASIC_AUTH_USERNAME / _PASSWORD (ไม่ตั้ง = start ไม่ขึ้น) · /health ไม่ต้อง auth
# - ใช้แค่ route chromium/convert/html — ปิด route libreoffice · pdfengines · downloadFrom · webhook
# - ไม่มีการโหลดจากเครือข่าย: HTML และ asset (ฟอนต์ · รูปบัตร) ส่งมาเป็นไฟล์ในฟอร์ม → Chromium ห้ามต่อทั้ง IP ภายในและภายนอก
#   (กัน SSRF ถ้า HTML มีลิงก์หลุดมา) · file:// นอก /tmp ถูก deny-list ค่าเริ่มต้นกันอยู่แล้ว
# - ปิด JavaScript — เทมเพลตใบรับซื้อเป็น HTML/CSS ล้วน
CMD ["gotenberg", "--api-port-from-env=PORT", "--api-enable-basic-auth", \
  "--libreoffice-disable-routes", "--pdfengines-disable-routes", "--api-disable-download-from", "--webhook-disable", \
  "--chromium-deny-private-ips", "--chromium-deny-public-ips", "--chromium-disable-javascript"]
