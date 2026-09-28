---
name: git-flow
description: ขั้นตอน worktree/branch/commit/PR ของ repo ร้านทอง สำหรับเอเจนต์ที่ทำงานขนานกัน — Conventional Commits ภาษาอังกฤษ แยก commit ตามเรื่อง เปิด PR เข้า dev แต่ไม่ merge เอง ใช้ก่อน commit หรือเปิด PR ทุกครั้ง
---

# git-flow — สำหรับเอเจนต์ที่ทำงานใน worktree

## ที่ทำงาน

- ทำงานเฉพาะใน worktree ที่ได้รับมอบหมาย (เช่น `../ong-lom-thong-wt/<ชื่อ>` ข้าง repo) — ใช้ absolute path เสมอ
- **ห้ามแตะ checkout หลักของ repo** (session อื่นอาจใช้อยู่) · ห้าม `git switch` ใน worktree ของคนอื่น · สร้าง worktree ใหม่ด้วย `git worktree add -b <branch> <path> origin/dev` (worktree อัตโนมัติของ Claude Code เริ่มจาก `main` — ห้ามใช้)
- worktree มี `node_modules` แล้ว · เพิ่ม dependency: `pnpm --filter <pkg> add <dep>@^x` แล้ว commit `pnpm-lock.yaml` ไปกับ commit ที่ใช้ dep นั้น
- Postgres สำหรับเทสต์: container local (`postgres://ong:ong@localhost:5432/postgres`) — เทสต์สร้าง database ใหม่ต่อไฟล์ รันขนานกับเอเจนต์อื่นได้

## ก่อน commit

- `make check` ต้องเขียวทั้งหมด (lint · format:check · typecheck · test · build) — CI รันชุดเดียวกัน
- ห้าม commit `.env` · ไฟล์ตัวอย่าง PDF/รูป · ข้อมูลลูกค้าจริง (ใช้เลขบัตรสมมติที่ checksum ถูก)

## commit

- **Conventional Commits ภาษาอังกฤษเท่านั้น** — commitlint (husky) ปฏิเสธข้อความผิดรูป · ห้าม `--no-verify`
- scope: `core` `db` `api` `web` `gotenberg` `deps` `release` หรือไม่ใส่ · subject ตัวเล็ก รูปคำสั่ง (`add …`) · body บรรทัดละ ≤ 100 ตัวอักษร อธิบาย "ทำไม"
- `feat` = minor · `fix`/`perf` = patch · `docs` `test` `refactor` `chore` ไม่ออกเวอร์ชัน — semantic-release ออกเวอร์ชันจาก type
- แยก commit ตามเรื่อง (core / db / api / web / docs) ให้แต่ละ commit typecheck ผ่านได้เอง
- ห้ามแก้ `version` ใน package.json และ `CHANGELOG.md`
- migration: แก้ `packages/db/src/schema.ts` → `pnpm db:generate` → commit SQL ที่ generate · ห้ามแก้ migration เก่า

## PR

- `git push -u origin HEAD` แล้ว `gh pr create --base dev --title "<type>(<scope>): <summary>" --body-file -` (ภาษาอังกฤษ: What · Why · Tests · Decisions)
- **ห้าม merge · promote · push เข้า `dev` `testing` `staging` `main`** — ผู้ประสานงานรีวิวแล้ว merge แบบ rebase เอง
- dev ขยับระหว่างทำ: `git fetch origin && git rebase origin/dev` · lockfile ชน → เอาของ dev แล้ว `pnpm install` ใหม่ แล้ว commit lockfile
- จบงาน: รายงาน PR URL · สิ่งที่ทำ · สิ่งที่ตัดสินใจเอง (พร้อมเหตุผล) · สิ่งที่ยังไม่ได้ทำ/ความเสี่ยง · ผล `make check`
