// Health Hub · food-sync
// The iPhone Shortcut posts today's food totals (read from Apple Health, where Fuel8 writes them) here.
// It proves who it is with a personal sync key made in the app (Settings → Food); only the key's hash is stored.
// Deployed with verify_jwt = false because the Shortcut has no Supabase login; the sync key is the check.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { parsePayload, sha256hex } from './parse.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
function adminKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    return String(keys.default || Object.values(keys)[0] || '');
  } catch (_) { return ''; }
}
const db = createClient(SUPABASE_URL, adminKey(), { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type, x-sync-key, authorization, apikey',
};
function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function nice(d: string) { const x = new Date(d + 'T00:00:00Z'); return DOW[x.getUTCDay()] + ' ' + x.getUTCDate() + ' ' + MON[x.getUTCMonth()]; }

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = (req.headers.get('content-type') || '').toLowerCase();
  if (type.includes('multipart/form-data')) {
    const f = await req.formData(); const o: Record<string, unknown> = {};
    f.forEach((v, k) => { o[k] = typeof v === 'string' ? v : ''; });
    return o;
  }
  const text = await req.text();
  if (text.length > 65536) throw new Error('too big');
  if (!text.trim()) return {};
  try { const j = JSON.parse(text); return j && typeof j === 'object' ? j : {}; }
  catch (_) { return Object.fromEntries(new URLSearchParams(text)); }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET') return reply(200, { ok: true, message: 'Health Hub food sync is running. The iPhone Shortcut sends a POST here.' });
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'Use POST.' });

  let body: Record<string, unknown>;
  try { body = await readBody(req); } catch (_) { return reply(400, { ok: false, error: 'The request body could not be read.' }); }

  const p = parsePayload(body, req.headers);
  if (!p.key) return reply(401, { ok: false, error: 'Missing sync key. Add a "key" field with the key from Health Hub → Settings → Food.' });
  if (!/^hh_[A-Za-z0-9_-]{20,100}$/.test(p.key)) return reply(401, { ok: false, error: 'That doesn’t look like a Health Hub sync key.' });

  const hash = await sha256hex(p.key);
  const found = await db.from('sync_keys').select('user_id').eq('key_hash', hash).maybeSingle();
  if (found.error) { console.error('key lookup failed', found.error.message); return reply(500, { ok: false, error: 'Health Hub couldn’t check the key just now. Try again.' }); }
  if (!found.data) return reply(401, { ok: false, error: 'That sync key isn’t recognised. Make a new one in Health Hub → Settings → Food and paste it into the Shortcut.' });
  const userId = found.data.user_id as string;

  if (!p.days.length) {
    // e.g. nothing logged in Fuel8 yet today: not an error worth interrupting the person for
    return reply(200, { ok: true, saved: [], message: p.errors[0] || 'Nothing to save.', errors: p.errors });
  }

  const now = new Date().toISOString();
  const rows = p.days.map((d) => ({ user_id: userId, date: d.date, kcal: d.kcal, protein_g: d.protein_g, carbs_g: d.carbs_g, fat_g: d.fat_g, source: 'fuel8', updated_at: now }));
  const up = await db.from('food_days').upsert(rows, { onConflict: 'user_id,date' });
  if (up.error) { console.error('save failed', up.error.message); return reply(500, { ok: false, error: 'Health Hub couldn’t save that just now. It will try again next time.' }); }
  await db.from('sync_keys').update({ last_used_at: now }).eq('user_id', userId);

  const d0 = p.days[p.days.length - 1];
  const bits = [d0.kcal != null ? Math.round(d0.kcal).toLocaleString('en-GB') + ' kcal' : '', d0.protein_g != null ? Math.round(d0.protein_g) + ' g protein' : ''].filter(Boolean);
  return reply(200, {
    ok: true,
    saved: p.days.map(({ notes: _n, ...d }) => d),
    notes: p.days.flatMap((d) => d.notes.map((n: string) => d.date + ': ' + n)),
    errors: p.errors,
    message: 'Saved ' + (bits.join(' and ') || 'food') + ' for ' + nice(d0.date) + (p.days.length > 1 ? ' (+' + (p.days.length - 1) + ' more day' + (p.days.length > 2 ? 's' : '') + ')' : '') + '.',
  });
});
