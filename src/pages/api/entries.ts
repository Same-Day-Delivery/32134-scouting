import type { APIRoute } from 'astro';
import { getEntries, observedOptions } from '../../lib/airtable';
import { ensureOptions, readScoring } from '../../lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const data = await getEntries(url.searchParams.get('refresh') === '1');
    ensureOptions(observedOptions(data.entries));
    return new Response(JSON.stringify({ ...data, scoring: readScoring() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
