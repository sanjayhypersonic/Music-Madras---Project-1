// One-time Founder account bootstrap (ADR §7.1): there is no public
// registration route anywhere in this application, so the very first
// account has to be created out-of-band. This script does that — it is
// meant to be run once, by whoever operates the real database, using
// FOUNDER_EMAIL/FOUNDER_NAME environment variables (never hardcoded
// values). It generates a random temporary password, prints it to the
// console exactly once, and stores only its hash.
//
// This cannot run against a real database in this environment — no
// database has been provisioned (see docs/phase-1-foundation.md). It is
// included now so the mechanism exists and is documented; it is exercised
// for real once a Neon (or other) Postgres connection is configured.

import { randomBytes } from "crypto";
import { prisma } from "../modules/db/client";
import { hashPassword } from "../modules/auth/passwordHashing";

async function main() {
  const email = process.env.FOUNDER_EMAIL;
  const name = process.env.FOUNDER_NAME;

  if (!email || !name) {
    console.error("Set FOUNDER_EMAIL and FOUNDER_NAME environment variables before running this script.");
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.studioUser.findUnique({ where: { email } });
  if (existing) {
    console.error(`A Studio user with email ${email} already exists (role: ${existing.role}, status: ${existing.status}). Not creating another.`);
    process.exitCode = 1;
    return;
  }

  const temporaryPassword = randomBytes(18).toString("base64url");
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.studioUser.create({
    data: {
      email,
      name,
      role: "FOUNDER",
      status: "ACTIVE",
      passwordHash,
    },
  });

  console.log(`Founder account created: ${email}`);
  console.log(`Temporary password (shown once, store it securely): ${temporaryPassword}`);
  console.log("Sign in and change this password immediately.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
