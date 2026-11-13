/**
 * @file anonymousUser.ts
 * @description The display name of the one shared user every request runs as
 * when sign-in is turned off (`AUTH_DISABLED=true`). A development checkout
 * keeps the familiar "Dev User"; a production build shows a neutral label, so
 * a demo instance does not present a developer placeholder in its top bar.
 * @feature config
 */

/** Longest display name accepted from the environment. */
const MAX_NAME_LENGTH = 60;

/**
 * `ANONYMOUS_USER_NAME` when set, otherwise "Demo user" under
 * `NODE_ENV=production` and "Dev User" everywhere else. Read per call, so
 * tests and a restarted server see the current environment.
 */
export function anonymousUserName(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ANONYMOUS_USER_NAME?.trim();
  if (configured) return configured.slice(0, MAX_NAME_LENGTH);
  return env.NODE_ENV === 'production' ? 'Demo user' : 'Dev User';
}
