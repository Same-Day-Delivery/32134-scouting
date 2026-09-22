import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, ensureSeedAdmin, resolveSession } from './lib/auth';
import { describeOriginMismatch, isCrossSiteWrite } from './lib/origin';

// Everything else — the dashboard, the admin page and both API routes —
// requires a session.
const PUBLIC_PATHS = new Set(['/login', '/favicon.svg']);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Stands in for Astro's security.checkOrigin, which the config turns off
  // because it cannot see past a TLS-terminating proxy. Logged when it fires:
  // the usual cause is a proxy whose forwarded headers need a look.
  if (isCrossSiteWrite(context.request, context.url)) {
    console.warn(
      `[csrf] refused ${context.request.method} ${pathname} — ${describeOriginMismatch(context.request, context.url)}`,
    );
    return new Response('Cross-site form submissions are forbidden', { status: 403 });
  }

  // The very first request to a fresh database has to have somebody to log in
  // as, so the seed runs before anything is gated.
  ensureSeedAdmin();

  const user = resolveSession(context.cookies.get(SESSION_COOKIE)?.value);
  context.locals.user = user;

  if (!user && !PUBLIC_PATHS.has(pathname)) {
    // An API caller gets a status it can act on; a browser gets the login form,
    // with where it was headed so the redirect after login lands there.
    if (pathname.startsWith('/api/')) {
      return json({ error: 'Not authenticated' }, 401);
    }
    const next_ = pathname + context.url.search;
    return context.redirect(`/login?next=${encodeURIComponent(next_)}`, 302);
  }

  // Account management is admins only. A signed-in non-admin gets 404 rather
  // than 403, so the page does not advertise itself to people who cannot use it.
  if (user && !user.isAdmin && pathname.startsWith('/admin')) {
    if (pathname.startsWith('/api/')) return json({ error: 'Admins only' }, 403);
    return new Response('Not found', { status: 404 });
  }

  return next();
});

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
