/**
 * Railway Infrastructure as Code — project "Ong Lom Thong" (region Singapore)
 * ใช้แทน railway.json (Config as Code ถูก deprecate · หยุดอ่าน 2026-12-01)
 *
 * Railway ไม่อ่านไฟล์นี้ตอน deploy — ต้องสั่ง `pnpm railway:plan` / `pnpm railway:apply` เอง
 * วิธีใช้ครั้งแรกและตั้งค่าลับ: .railway/README.md
 */
import { bucket, defineRailway, github, postgres, preserve, project, ref, service } from "railway/iac";

const REPO = "tanasatha-mahathep/ong-lom-thong";
/** Southeast Asia Metal (Singapore) — ใช้กับ service และ database */
const REGION = "asia-southeast1-eqsg3a";
/** gotenberg ฟังพอร์ตนี้ (Railway ฉีด PORT=8080 ทับ ENV ใน image ถ้าไม่ตั้งเป็น service variable) */
const GOTENBERG_PORT = "3000";
/** ชื่อ service ตามที่ตั้งใน dashboard — IaC ผูกด้วยชื่อ: เปลี่ยนชื่อใน dashboard แล้วต้องแก้ตรงนี้ด้วย ไม่งั้น apply จะสร้างใหม่แล้วลบตัวเดิม */
const APP_SERVICE = "Office";
const PDF_SERVICE = "PDF (Gotenberg)";
const BUCKET = "Media";
/**
 * หัวใบรับซื้อ — ข้อมูลกิจการที่พิมพ์บนใบทุกใบ (ไม่ใช่ค่าลับ) · ค่าจากหน้า "ข้อมูลบริษัท" ของระบบเดิม
 * ใช้ค่าเดียวกันทุก environment · แอปตรวจรูปแบบตอน start (เลขผู้เสียภาษี 13 หลัก + หลักตรวจสอบ)
 * ไม่มีโทรสาร → ไม่ประกาศ COMPANY_FAX (ใบพิมพ์ "-")
 */
const COMPANY = {
  COMPANY_NAME: "โอเอ็นจี หลอมทอง",
  COMPANY_ADDRESS: "156/7 ถนนพังงา ตำบลตลาดใหญ่ อำเภอเมืองภูเก็ต จังหวัดภูเก็ต 83000",
  COMPANY_TEL: "0654249514",
  COMPANY_TAX_ID: "3839900461751",
};
/**
 * Railway environment → git branch ที่ deploy (flow: dev → testing → staging → main)
 * สร้าง environment บน Railway เฉพาะที่ต้องใช้ — มีในตารางนี้ไม่ได้แปลว่าถูกสร้าง
 */
const BRANCH_BY_ENVIRONMENT: Record<string, string> = {
  dev: "dev",
  testing: "testing",
  staging: "staging",
  production: "main",
};

/**
 * ค่าลับ: อ่านจาก shell เฉพาะตอน apply ครั้งแรกหรือตอนหมุนคีย์ แล้ว seal ไว้ใน Railway
 * ไม่มีค่าใน shell → preserve() = คงค่าเดิม · ไม่มีค่าลับใน git
 * ใช้ชื่อ RAILWAY_SET_* ที่แอปไม่อ่าน — .env ของเครื่อง dev (direnv) จึงหลุดไปทับค่าจริงไม่ได้
 */
function secret(name: string) {
  const key = `RAILWAY_SET_${name}`;
  const value = process.env[key];
  if (!value) return preserve();
  if (value.length < 32 || /change-me/i.test(value)) {
    throw new Error(`${key} ต้องเป็นค่าสุ่มยาว ≥ 32 ตัวอักษร เช่น openssl rand -hex 32`);
  }
  return { value, isSealed: true };
}

export default defineRailway((ctx) => {
  // fail closed: ไม่รู้จักชื่อ environment (เช่น รันใน railway run/shell ที่ส่ง RAILWAY_ENVIRONMENT_ID มา) = หยุด ไม่เดา
  const environment = ctx.environment;
  const branch =
    environment && Object.hasOwn(BRANCH_BY_ENVIRONMENT, environment) ? BRANCH_BY_ENVIRONMENT[environment] : undefined;
  if (!environment || !branch) {
    throw new Error(
      `unknown Railway environment "${String(environment)}" — link ด้วย railway link --environment ${Object.keys(BRANCH_BY_ENVIRONMENT).join("|")} และอย่ารันใน railway run/shell`,
    );
  }
  const production = environment === "production";
  // deploy จาก branch ของ environment นั้น — รอ GitHub Actions ผ่านก่อน (checkSuites)
  const source = { branch, checkSuites: true };
  const oneReplicaInRegion = { [REGION]: 1 };
  // ไม่ประกาศค่าที่เป็น default ของ Railway (restartPolicyType ON_FAILURE · builder ของ Dockerfile ที่ root)
  // Railway เก็บค่า default เป็น null → ถ้าประกาศ plan จะเห็น diff ค้างตลอด และจับ drift จริงไม่ได้
  const restartOnFailure = { restartPolicyMaxRetries: 5 };
  // preDeployTimeoutSeconds ยังไม่มีใน type ของ SDK แต่ engine ของ CLI รู้จัก — ไม่ประกาศ = apply จะล้างเป็น null
  // (ไม่มีเวลาจำกัด) · migration มี lock_timeout 10 วินาทีกันค้างอีกชั้น
  const apiDeploy = { ...restartOnFailure, preDeployTimeoutSeconds: 300 };

  const db = postgres("Postgres", { region: REGION });

  // private เสมอ (Railway bucket ไม่มี public) — สำเนา off-site รายคืนไป R2/B2 เป็นภาคบังคับ (spec §11)
  const files = bucket(BUCKET, { region: "sin" });

  const gotenberg = service(PDF_SERVICE, {
    source: github(REPO, { ...source, rootDirectory: "services/gotenberg" }),
    build: { watchPatterns: ["/services/gotenberg/**"] }, // Dockerfile ที่ root ของ services/gotenberg
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: oneReplicaInRegion,
    deploy: restartOnFailure,
    // ไม่มี public domain — api เรียกผ่าน private network เท่านั้น
    env: {
      PORT: GOTENBERG_PORT,
      GOTENBERG_API_BASIC_AUTH_USERNAME: "ong",
      GOTENBERG_API_BASIC_AUTH_PASSWORD: secret("GOTENBERG_PASSWORD"),
    },
  });

  const api = service(APP_SERVICE, {
    // build context = root ของ repo (Dockerfile build ทั้ง web และ api)
    source: github(REPO, source),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "apps/api/Dockerfile",
      watchPatterns: [
        "/apps/api/**",
        "/apps/web/**",
        "/packages/**",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
        "/tsconfig.base.json",
      ],
    },
    // migrate ทุก deploy · ที่ไม่ใช่ production ใส่ข้อมูลอ้างอิงด้วย (รันซ้ำได้) · production seed เองเมื่อได้รหัสสาขาจริง
    preDeploy: production ? "node dist/migrate.js" : '/bin/sh -c "node dist/migrate.js && node dist/seed.js"',
    healthcheck: "/healthz",
    healthcheckTimeout: 120,
    replicas: oneReplicaInRegion,
    deploy: apiDeploy,
    env: {
      DATABASE_URL: db.env.DATABASE_URL,

      // ชื่อที่มีช่องว่าง/วงเล็บต้องครอบด้วย " ใน reference (รูปแบบเดียวกับที่ Railway เก็บ) · DNS ภายในยังเป็น gotenberg.railway.internal
      GOTENBERG_URL: `http://\${{"${PDF_SERVICE}".RAILWAY_PRIVATE_DOMAIN}}:${GOTENBERG_PORT}`,
      GOTENBERG_USERNAME: "ong",
      GOTENBERG_PASSWORD: secret("GOTENBERG_PASSWORD"),

      // Railway bucket ใช้ virtual-hosted style → forcePathStyle = false
      S3_ENDPOINT: ref(files, "ENDPOINT"),
      S3_REGION: ref(files, "REGION"),
      S3_BUCKET: ref(files, "BUCKET"),
      S3_ACCESS_KEY: ref(files, "ACCESS_KEY_ID"),
      S3_SECRET_KEY: ref(files, "SECRET_ACCESS_KEY"),
      S3_FORCE_PATH_STYLE: "false",

      BETTER_AUTH_SECRET: secret("BETTER_AUTH_SECRET"),
      // domain *.up.railway.app สร้างด้วย `railway domain -s api` (IaC ไม่จัดการ generated domain)
      BETTER_AUTH_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",

      ...COMPANY,
    },
  });

  return project("Ong Lom Thong", { resources: [db, files, gotenberg, api] });
});
