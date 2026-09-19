import argon2 from "argon2";

// Isolates the password hashing library choice (ADR §7: "hashed with
// argon2") behind two small functions, so swapping the algorithm later
// touches only this file.

export function hashPassword(plainTextPassword: string): Promise<string> {
  return argon2.hash(plainTextPassword);
}

export function verifyPassword(hash: string, plainTextPassword: string): Promise<boolean> {
  return argon2.verify(hash, plainTextPassword);
}
