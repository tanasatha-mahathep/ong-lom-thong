---
name: pr-review
description: รีวิว PR ของ repo ร้านทองก่อน merge — ตรวจกฎ CLAUDE.md (เงิน decimal สูตรเดียว ปัดเศษ สาขา fail-closed PDF immutable Siam ID มาสก์เลขบัตร secrets) และรันเทสต์บน branch ของ PR ใช้เมื่อได้รับ PR ให้รีวิว
---

# pr-review

## ขั้นตอน

1. `gh pr view <n>` + `gh pr diff <n>` · อ่านสเปกส่วนที่เกี่ยวข้องใน `../Work_2026-09-27/05-spec-vite-tanstack.md`
2. ตรวจใน worktree ของ branch นั้น (ถ้าได้รับ path) หรือสร้างใหม่นอก checkout หลัก: `git worktree add <path> origin/<branch>` → `pnpm install --frozen-lockfile` → `make check`
3. ไล่เช็กลิสต์ · หา failure scenario จริง (input → ผลผิด) ก่อนรายงาน · ไม่รายงานเรื่อง style ที่ lint จับได้

## เช็กลิสต์ (ต้องชี้ไฟล์:บรรทัด)

1. เงิน/น้ำหนักเป็น decimal.js / `numeric` · API ส่ง string · ไม่มี `Number()`/`parseFloat`/float กับเงิน
2. สูตรเงินอยู่ใน `@ong/core` ที่เดียว — quote กับ save เรียกฟังก์ชันเดียวกัน · web ไม่คำนวณเงิน
3. ปัดเศษ: เงิน HALF_UP 2 · น้ำหนัก 3 · ทองรูปพรรณ HALF_UP 0 · ต้นทุน/กรัม FLOOR
4. สาขา fail-closed ทุก query · ไม่มีสิทธิ์ = ว่าง/404 · มีเทสต์ scoping ทุก endpoint ใหม่
5. ไฟล์/PDF: ไม่มีโค้ดลบ · ไม่เขียนทับ · ไม่มี public URL · `no-store`
6. Siam ID 11 ช่องลำดับถูก · วันที่เป็น text input
7. เลขบัตรมาสก์ทุกที่ยกเว้นหน้าลูกค้าเดี่ยว/PDF · audit ไม่มีเลขเต็ม
8. ไม่มี secrets / `.env` / ข้อมูลลูกค้าจริง · ไม่ log ข้อมูลส่วนบุคคล
9. ทรานแซกชันและ race: เลขที่เอกสาร · idempotency · unique violation · ยอดชำระ = ยอดบิล
10. commit: Conventional Commits ภาษาอังกฤษ แยกเรื่อง · migration ใหม่ไม่แก้ของเก่า

## รายงาน

- findings เรียงตามความรุนแรง: **blocker** / **should-fix** / **nit** — แต่ละข้อ: ไฟล์:บรรทัด · ปัญหา · สถานการณ์ที่พัง · วิธีแก้ที่เสนอ
- ผล `make check` (ผ่าน/ไม่ผ่าน + ข้อความ error)
- ห้าม push · merge · แก้โค้ดใน PR เอง เว้นแต่ถูกสั่ง
