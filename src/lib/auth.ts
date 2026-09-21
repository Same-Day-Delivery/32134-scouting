import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'scouting_session';

// A week: long enough that scouts at a competition are not re-typing the
// password between matches, short enough that a forgotten phone expires.
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

// `astro dev` exposes .env through import.meta.env, but reading it that way
// would bake the password into dist/ at build time and freeze it there. Read
// process.env instead — compose passes .env in through env_file — and load the
// file ourselves when it is only on disk, as it is during local development.
if (!process.env.AUTH_PASSWORD) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env on disk: the environment is expected to carry the values.
  }
}

const env = (key: string) => {
  const raw = process.env[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};

const USERNAME = env('AUTH_USERNAME') ?? 'scout';
const PASSWORD = env('AUTH_PASSWORD');

// Without a fixed secret every restart invalidates the cookies it signed, so
// a deployment that cares about staying logged in sets AUTH_SECRET itself.
const SECRET = env('AUTH_SECRET') ?? randomBytes(32).toString('hex');

if (!PASSWORD) {
  console.warn(
    '[auth] AUTH_PASSWORD is not set — every request will be refused. Add it to .env.',
  );
} else if (!env('AUTH_SECRET')) {
  console.warn(
    '[auth] AUTH_SECRET is not set — a random one was generated, so restarting logs everyone out.',
  );
}

/** Compares without leaking, through timing, how much of the input matched. */
const constantTimeEqual = (a: string, b: string) => {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, so hash first: the digests
  // are always the same length and differ whenever the inputs do.
  const digest = (buf: Buffer) => createHmac('sha256', SECRET).update(buf).digest();
  return timingSafeEqual(digest(left), digest(right));
};

export const checkCredentials = (username: string, password: string) => {
  if (!PASSWORD) return false;
  // Both halves always run, so a wrong username costs the same as a wrong password.
  const userOk = constantTimeEqual(username, USERNAME);
  const passOk = constantTimeEqual(password, PASSWORD);
  return userOk && passOk;
};

const sign = (payload: string) => createHmac('sha256', SECRET).update(payload).digest('base64url');

/** A token is `<expiry>.<signature>`; the signature is what makes it unforgeable. */
export const createSessionToken = () => {
  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
};

export const isValidSessionToken = (token: string | undefined) => {
  if (!token) return false;
  const cut = token.lastIndexOf('.');
  if (cut < 1) return false;

  const payload = token.slice(0, cut);
  const signature = token.slice(cut + 1);
  if (!constantTimeEqual(signature, sign(payload))) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
};

/** Secure is conditional: the tailnet serves HTTPS, but `astro dev` is plain HTTP. */
export const sessionCookieOptions = (url: URL) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: url.protocol === 'https:',
  path: '/',
  maxAge: SESSION_MAX_AGE,
});
