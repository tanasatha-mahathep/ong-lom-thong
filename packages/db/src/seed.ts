import { createDb } from "./index";
import { seedReferenceData } from "./seedData";

await seedReferenceData(createDb());
console.log("seeded: 3 branches · 4 metals · gold price setting");
process.exit(0);
