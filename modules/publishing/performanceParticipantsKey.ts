import { createHash } from "crypto";

// Phase 6J-10F — a fingerprint of a Performance's participants, used to detect that the ORIGINAL Performance changed
// between the moment a draft cloned it (copy-on-write) and the moment the draft is published. Pure; order-insensitive;
// sensitive to every participant, to a performer's role, and to nothing else (Programme, Venue, date, slug and
// instruments are not part of what promotion writes, so they are not part of the guard).

export interface ParticipantSet {
  performers: ReadonlyArray<{ artistId: string; role: string | null }>;
  choirIds: readonly string[];
  conductorIds: readonly string[];
}

export function performanceParticipantsKey(set: ParticipantSet): string {
  const canonical = JSON.stringify({
    performers: set.performers.map((p) => [p.artistId, p.role ?? ""]).sort((a, b) => (a[0] + "\u0000" + a[1]).localeCompare(b[0] + "\u0000" + b[1])),
    choirs: [...set.choirIds].sort(),
    conductors: [...set.conductorIds].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}