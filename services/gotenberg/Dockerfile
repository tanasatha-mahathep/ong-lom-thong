# Gotenberg (Chromium → PDF) + ฟอนต์ Sarabun ให้ใบรับซื้อพิมพ์ไทยได้เหมือนใบจริง
FROM gotenberg/gotenberg:8

USER root
COPY fonts/Sarabun-Regular.ttf fonts/Sarabun-Bold.ttf /usr/share/fonts/truetype/sarabun/
RUN fc-cache -f
USER gotenberg
