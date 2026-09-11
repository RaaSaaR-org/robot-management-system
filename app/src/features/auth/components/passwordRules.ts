/**
 * @file passwordRules.ts
 * @description The one new-password rule set (register, reset, change) and its hint copy
 * @feature auth
 */

export const PASSWORD_HINT = 'At least 8 characters, with upper- and lowercase letters and a number.';

/** Returns an error sentence, or undefined when the password is acceptable. */
export function validateNewPassword(password: string): string | undefined {
  if (!password) return 'Enter a password.';
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) return 'Add an uppercase letter, a lowercase letter and a number.';
  return undefined;
}
