import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

export function id(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function token(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function sixDigits(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) {
    // Spend the same time as a real check so a missing account is not observable.
    scryptSync(password, "x", 32, { N: 16384, r: 8, p: 1 });
    return false;
  }
  const [alg, salt, key] = stored.split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const want = Buffer.from(key, "base64url");
  const got = scryptSync(password, Buffer.from(salt, "base64url"), want.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(want, got);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
