import type { APIRoute } from 'astro';
import { readScoring, resetScoring, setCategorySettings, setOptionPoints } from '../../lib/db';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = () => json({ scoring: readScoring() });

export const POST: APIRoute = async ({ request }) => {
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  try {
    if (payload?.reset) {
      resetScoring();
      return json({ scoring: readScoring() });
    }

    for (const u of payload?.options ?? []) {
      if (typeof u?.category !== 'string' || typeof u?.option !== 'string') {
        return json({ error: 'Each option update needs a category and an option' }, 400);
      }
      const points = Number(u.points);
      if (!Number.isFinite(points)) return json({ error: `Bad points for ${u.option}` }, 400);
      setOptionPoints(u.category, u.option, points);
    }

    for (const u of payload?.categories ?? []) {
      if (typeof u?.category !== 'string') return json({ error: 'Category update needs a name' }, 400);
      const weight = Number(u.weight ?? 1);
      if (!Number.isFinite(weight)) return json({ error: `Bad weight for ${u.category}` }, 400);
      setCategorySettings(u.category, weight, u.enabled !== false);
    }

    return json({ scoring: readScoring() });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
};
