import type { APIRoute } from 'astro';
import { SESSION_COOKIE, sessionCookieOptions } from '../lib/auth';

export const prerender = false;

// POST only: a GET would let any image or link tag log someone out.
export const POST: APIRoute = ({ cookies, url, redirect }) => {
  cookies.delete(SESSION_COOKIE, { ...sessionCookieOptions(url), maxAge: undefined });
  return redirect('/login', 303);
};
