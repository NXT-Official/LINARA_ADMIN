// Fails if a server-only secret reached the files the browser downloads (S-11).
// Run after a build: `bun run test:bundle`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".output/public";
if (!existsSync(ROOT)) {
  console.error(`${ROOT} not found: run the build first.`);
  process.exit(1);
}

// Names that must never appear in browser code, plus the real key values from
// .env when there is one (read here, never printed).
const needles = ["SUPABASE_SERVICE_ROLE_KEY", "sb_secret_", "service_role", "HCAPTCHA_SECRET"];
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(SUPABASE_SERVICE_ROLE_KEY|HCAPTCHA_SECRET)\s*=\s*(.+?)\s*$/);
    // Skip hCaptcha's public test secret: it isn't a secret.
    if (m && m[2] && !/^0x0+$/.test(m[2])) needles.push(m[2].replace(/^["']|["']$/g, ""));
  }
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|mjs|html|json|map)$/.test(name)) yield path;
  }
}

const leaks = [];
for (const file of files(ROOT)) {
  const text = readFileSync(file, "utf8");
  if (needles.some((n) => text.includes(n))) leaks.push(file);
}

if (leaks.length) {
  console.error(`Server secrets found in browser assets:\n  ${leaks.join("\n  ")}`);
  process.exit(1);
}
console.log("no server secrets in browser assets");
