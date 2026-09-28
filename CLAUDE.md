# CLAUDE.md — สำหรับ AI agent ที่ทำงานต่อใน repo นี้

ระบบซื้อเข้าหน้าร้าน + สมาชิก ของร้านทอง "โอเอ็นจี หลอมทอง" — **production จริง** ตัวเลขทุกตัวคือเงินและเอกสารภาษี

## อ่านก่อนเขียน

- สเปก: `../Work_2026-09-27/05-spec-vite-tanstack.md` (routes · โมเดล · API · กฎ R1–R15 · PDF · deploy)
- ผลสำรวจระบบเดิม PHP: `../Work_2026-09-27/01–04` — ทุกกฎมีที่มาจากระบบเดิมหรือใบจริง **ไม่เดา**
- reference จาก Django รุ่นก่อน (ไม่ใช้ Python แล้ว แต่สูตร/เทมเพลตพิมพ์พิสูจน์กับใบจริงแล้ว): `../Work_2026-09-27/reference-django/`

## กฎที่ห้ามละเมิด

1. **เงินและน้ำหนักเป็น `decimal.js` / `numeric` เท่านั้น — ห้าม `number`/`float8`** · API ส่งเป็น string
2. **คำนวณฝั่งเซิร์ฟเวอร์** — `quoteBuy()` ใน `packages/core` ตัวเดียวใช้ทั้ง preview และ save ห้ามมีสูตรที่สอง
3. ปัดเศษ: เงิน HALF_UP 2 · น้ำหนัก 3 · ราคาทองรูปพรรณ HALF_UP 0 · ต้นทุน/กรัม (โหมดประเมิน) FLOOR
4. **สาขา fail-closed** — ไม่มีสิทธิ์ = ว่าง/404 ไม่ใช่ข้อมูลทุกสาขา · ทุก endpoint ต้องมีเทสต์ scoping
5. **PDF ใบรับซื้อ immutable** (A4) — ไม่มีโค้ดลบ · ยกเลิก = ไฟล์ใหม่ · สำเนาบัตรแยกไฟล์ สิทธิ์แคบกว่า
6. **ลำดับช่องฟอร์มลูกค้า 11 ช่องตาม Siam ID** ห้ามสลับ · ช่องวันที่เป็น `<input type="text">` ห้าม date picker
7. เลขบัตรประชาชนมาสก์ทุกที่ยกเว้นหน้าลูกค้าเดี่ยวและ PDF · ไม่มี public URL ของไฟล์
8. ห้าม commit `.env` · ห้ามเอาข้อมูลลูกค้าจริงขึ้น staging

## คำสั่ง

`pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm format:check` — ต้องเขียวทั้งหมดก่อน commit (CI รันชุดเดียวกัน)
`pnpm dev` · `pnpm db:generate` หลังแก้ schema · plpgsql อยู่ `packages/db/sql/functions.sql`

## Commit

- **Conventional Commits ภาษาอังกฤษเท่านั้น** (header + body) — commitlint (husky `commit-msg`) ปฏิเสธข้อความผิดรูป · semantic-release ออกเวอร์ชันจาก type
- `feat` = minor · `fix`/`perf` = patch · `BREAKING CHANGE:` = major · `chore` `ci` `docs` `style` `test` `build` `refactor` ไม่ออกเวอร์ชัน
- scope: `core` `db` `api` `web` `gotenberg` `deps` `release` (หรือไม่ใส่) · subject ขึ้นต้นตัวพิมพ์เล็ก รูปคำสั่ง (`add …` ไม่ใช่ `Added …`) · บรรทัด body ≤ 100 ตัวอักษร
- แยก commit ตามเรื่อง · ห้าม `--no-verify` · ห้ามแก้ `version` ใน package.json เอง
- `CHANGELOG.md` semantic-release เขียนเอง — ห้ามแก้มือ · dependency อัปเดตผ่าน Renovate (PR ไป `dev`) ไม่ต้องไล่อัปเองถ้าไม่จำเป็น
- branch: `dev` → `testing` → `staging` → `main` · **ห้าม push ตรงทุก branch** — feature branch → PR เข้า `dev` → CI ผ่าน → `gh pr merge --rebase --delete-branch` · promote ทีละขั้น: PR promotion (`testing ← dev`) แล้ว `git push origin dev:testing` (fast-forward · ห้ามกด merge ปุ่มใน PR promotion) ห้ามข้ามขั้น · หลัง release CI ดึง `staging`/`testing`/`dev` ตาม `main` ให้เอง
- **ห้ามเปิด "Automatically delete head branches"** ใน GitHub settings — PR promotion มี head เป็น `dev`/`testing` พอปิดเป็น merged GitHub จะลบ branch นั้นทิ้ง (เกิดแล้ว 28 ก.ย. — กู้จาก SHA เดิม)
