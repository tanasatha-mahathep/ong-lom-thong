# สำรองข้อมูลรายคืน (Railway cron) — pg_dump 18 + rclone · สคริปต์: backup.sh · วิธีใช้: .railway/README.md
# ปักเวอร์ชันเต็ม + digest — Renovate เสนออัปเดต
# pg_dump ต้องรุ่นเดียวกับหรือใหม่กว่า server (Railway postgres-ssl:18) — ขยับ major ของ Postgres ต้องขยับ image นี้ด้วย
# rclone จาก image ทางการ: binary static (Go, ไม่ลิงก์ libc) คัดลอกข้าม image ได้ ไม่ต้อง apk add
FROM rclone/rclone:1.75.1@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5 AS rclone

FROM postgres:18.6-alpine3.24@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873

COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
COPY lib.sh backup.sh /opt/backup/

# ไม่ใช้ docker-entrypoint.sh ของ postgres (ไม่ได้เปิด server) · ไฟล์ชั่วคราวอยู่ใน /tmp · ไม่ต้องใช้ root
USER postgres
ENTRYPOINT ["/bin/bash", "/opt/backup/backup.sh"]
