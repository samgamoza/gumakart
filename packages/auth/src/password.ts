import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "qwertyuiop", "iloveyou", "abc12345", "11111111", "00000000",
  "admin123", "welcome1", "letmein1", "passw0rd", "p@ssw0rd", "guma1234", "gumakart",
]);

/** Sign-up rule: 8+ characters with at least one letter and one number, not a well-known password. */
export function validatePasswordStrength(password: string): { ok: true } | { ok: false; reason: string } {
  if (password.length < 8) {
    return { ok: false, reason: "Password must be at least 8 characters." };
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, reason: "Use at least one letter and one number in your password." };
  }
  if (/^(.)\1+$/.test(password) || COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, reason: "That password is too easy to guess. Try a longer phrase." };
  }
  return { ok: true };
}
