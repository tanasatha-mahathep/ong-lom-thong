import { createDb, seedReferenceData } from "@ong/db";

// ข้อมูลอ้างอิง (สาขา · โลหะ · ค่าตั้งราคาทอง) — รันซ้ำได้ · ใช้กับ staging ผ่าน preDeployCommand
await seedReferenceData(createDb());
console.log("seeded reference data");
process.exit(0);
