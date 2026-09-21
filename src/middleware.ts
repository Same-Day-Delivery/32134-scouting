import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, isValidSessionToken } from './lib/auth';

// Everything else — the dashboard and both API routes — requires a session.
const PUBLIC_PATHS = new Set(['/login', '/favicon.svg']);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  const authed = isValidSessionToken(context.cookies.get(SESSION_COOKIE)?.value);
  context.locals.authed = authed;

  if (authed || PUBLIC_PATHS.has(pathname)) return next();

  // An API caller gets a status it can act on; a browser gets the login form,
  // with where it was headed so the redirect after login lands there.
  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const next_ = pathname + context.url.search;
  return context.redirect(`/login?next=${encodeURIComponent(next_)}`, 302);
});
