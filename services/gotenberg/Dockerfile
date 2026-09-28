# Gotenberg (Chromium → PDF) + ฟอนต์ Sarabun ให้ใบรับซื้อพิมพ์ไทยได้เหมือนใบจริง
# ปักเวอร์ชันเต็ม — dependabot เสนออัปเดต minor/patch · major ต้องเทียบ PDF กับใบจริงก่อน
FROM gotenberg/gotenberg:8.37.0@sha256:f29984bd1e226bf1b93ba90af06000afa8b315853e99d27b9aaa41b93f15c769

USER root
COPY fonts/Sarabun-Regular.ttf fonts/Sarabun-Bold.ttf /usr/share/fonts/truetype/sarabun/
RUN fc-cache -f
USER gotenberg

# --api-port-from-env ไม่มีค่าสำรอง — ตั้ง 3000 ไว้ให้ Railway/compose override ได้
ENV PORT=3000

# - พอร์ตจาก $PORT
# - basic auth: GOTENBERG_API_BASIC_AUTH_USERNAME / _PASSWORD (ไม่ตั้ง = start ไม่ขึ้น) · /health ไม่ต้อง auth
# - ใช้แค่ route chromium — ปิด route libreoffice
CMD ["gotenberg", "--api-port-from-env=PORT", "--api-enable-basic-auth", "--libreoffice-disable-routes"]
