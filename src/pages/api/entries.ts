import type { APIRoute } from 'astro';
import { loadDashboard } from '../../lib/load';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    return new Response(JSON.stringify(await loadDashboard()), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
