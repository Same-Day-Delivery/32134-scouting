import type { APIContext } from 'astro';

/**
 * `tailscale serve` terminates TLS and proxies onward, so the socket address
 * is always the proxy. The forwarded header is the real client — trusted here
 * because nothing but that proxy can reach the port compose binds.
 */
export function clientIp(context: APIContext): string | null {
  const forwarded = context.request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  try {
    return context.clientAddress || null;
  } catch {
    // The adapter cannot always supply one; the log tolerates a blank.
    return null;
  }
}

export const userAgent = (context: APIContext): string | null =>
  context.request.headers.get('user-agent');
