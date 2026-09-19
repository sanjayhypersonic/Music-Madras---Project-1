# modules/auth — later-phase scope

Structural placeholder. Phase 1 deliberately does not add Auth.js/NextAuth or any authentication screens, per the Phase 1 guardrails. The `StudioUser` table exists in `prisma/schema.prisma` now (with `StudioRole`/`StudioUserStatus` enums) only as the foreign-key target `createdById`/`updatedById` columns need — see the schema file's header comment and `docs/phase-1-foundation.md` for why.

Not yet in the schema (added alongside the phase that implements them, per ADR §7): `Session`, `Account`, `Invitation`, `PasswordResetToken`. The full account lifecycle (Founder seeding, invitations, activation, reset, disablement, RBAC policy function) is documented in ADR §7 and will be implemented then, not guessed at now.
