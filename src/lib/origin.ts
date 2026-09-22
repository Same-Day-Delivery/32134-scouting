/**
 * What the browser actually asked for, as opposed to what the container sees.
 *
 * The node adapter derives the request's protocol from its own socket
 * (`req.socket.encrypted`), so behind a proxy that terminates TLS the site
 * believes it is being served over plain HTTP. That breaks two things: Astro's
 * built-in origin check compares the browser's `https://…` Origin against its
 * own `http://…` and refuses every form post, and session cookies lose their
 * `Secure` flag. Both are fixed by reading the forwarded headers instead.
 *
 * Trusting those headers is safe here because compose binds the port to
 * loopback, so only the proxy in front can reach it. SITE_HOST overrides them
 * for a proxy that rewrites Host without announcing it.
 */

const firstValue = (header: string | null): string | null => {
  const first = header?.split(',')[0]?.trim();
  return first ? first : null;
};

/** The host:port the browser used — the proxy's front door, not ours. */
export function externalHost(request: Request, url: URL): string {
  return (
    process.env.SITE_HOST ??
    firstValue(request.headers.get('x-forwarded-host')) ??
    url.host
  );
}

/** True when the browser's connection was HTTPS, whatever ours was. */
export function isHttps(request: Request, url: URL): boolean {
  const proto = firstValue(request.headers.get('x-forwarded-proto'));
  if (proto) return proto.toLowerCase() === 'https';
  return url.protocol === 'https:';
}

/* --------------------------------------------------------------- CSRF ---- */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The content types a cross-origin page can post without the browser asking
// our permission first. Anything else (JSON, say) is already protected.
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

/**
 * Replaces Astro's `security.checkOrigin`, which is disabled in the config
 * because it cannot see past the proxy. Same rules, but it compares hosts
 * rather than whole origins, so terminating TLS upstream is not a mismatch.
 */
export function isCrossSiteWrite(request: Request, url: URL): boolean {
  if (SAFE_METHODS.has(request.method)) return false;

  const contentType = request.headers.get('content-type')?.toLowerCase();
  if (contentType && !FORM_TYPES.some((t) => contentType.includes(t))) return false;

  const origin = request.headers.get('origin');
  // No Origin on a form post means a browser too old to send one, or a client
  // that is not a browser at all; neither gets to post.
  if (!origin) return true;

  try {
    return new URL(origin).host !== externalHost(request, url);
  } catch {
    return true;
  }
}

/** Why a request was refused, for the server log. */
export function describeOriginMismatch(request: Request, url: URL): string {
  return [
    `origin=${request.headers.get('origin') ?? '(none)'}`,
    `expected-host=${externalHost(request, url)}`,
    `host-header=${url.host}`,
    `x-forwarded-host=${request.headers.get('x-forwarded-host') ?? '(none)'}`,
    `x-forwarded-proto=${request.headers.get('x-forwarded-proto') ?? '(none)'}`,
  ].join(' ');
}
