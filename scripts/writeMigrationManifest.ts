// Operator/dev script: regenerate modules/config/expectedMigrations.ts from prisma/migrations.
//   npm run migrations:manifest          writes the file
//   npm run migrations:manifest -- --check   exits 1 if the committed file is stale (for CI or a pre-release check); writes nothing
// Touches only that one source file. No database, no network.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import { renderManifest } from "../modules/ops/migrationManifest";

const ROOT = path.resolve(__dirname, "..");
const dir = path.join(ROOT, "prisma", "migrations");
const names = readdirSync(dir).filter((n) => /^\d{14}_/.test(n) && existsSync(path.join(dir, n, "migration.sql")));
const target = path.join(ROOT, "modules", "config", "expectedMigrations.ts");
const wanted = renderManifest(names);

if (process.argv.includes("--check")) {
  const current = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== wanted) {
    console.error("expectedMigrations.ts is STALE. Run `npm run migrations:manifest` and commit the result.");
    process.exit(1);
  }
  console.log(`expectedMigrations.ts is current (${names.length} migrations).`);
} else {
  writeFileSync(target, wanted, "utf8");
  console.log(`Wrote ${names.length} migrations to modules/config/expectedMigrations.ts`);
}
