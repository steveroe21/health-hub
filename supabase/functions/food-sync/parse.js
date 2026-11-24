// Turns whatever the iPhone Shortcut sends into clean daily food totals.
// Plain JavaScript so the Edge Function (Deno) and the local tests (Node) share it.
//
// Accepted body (JSON or form fields), all optional except a key:
//   { key, date, kcal|calories|energy, protein, carbs|carbohydrates, fat|total_fat, unit, tz }
//   or { key, days:[{ date, kcal, protein, carbs, fat }, …] }
// Numbers can arrive as numbers or text such as "1,850", "1 850 kcal" or "152,5".
// Dates can be ISO ("2026-11-24", "2026-11-24T21:05:00+04:00") or what Shortcuts
// writes by default ("24 Nov 2026 at 21:05", "Nov 24, 2026", "24/11/2026").

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };
const KJ_PER_KCAL = 4.184;
export const LIMITS = { kcal: 20000, macro: 2000, days: 62, pastDays: 400 };

function pad(n) { return (n < 10 ? '0' : '') + n; }
function ymd(y, m, d) {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;               // 31 Feb etc.
  return y + '-' + pad(m) + '-' + pad(d);
}
function dayNum(s) { const p = s.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5); }

// today's date (YYYY-MM-DD) in a time zone, e.g. Asia/Dubai
export function todayIn(tz, now) {
  const at = now ? new Date(now) : new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const get = t => +parts.find(p => p.type === t).value;
    return ymd(get('year'), get('month'), get('day'));
  } catch (e) {
    return todayIn('Asia/Dubai', now);
  }
}

// every reading of the text as a date (day/month order can be ambiguous)
function dateCandidates(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return [];
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);                       // ISO, keeps the phone's local date
  if (m) return [ymd(+m[1], +m[2], +m[3])].filter(Boolean);
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s);
  if (m) return [ymd(+m[1], +m[2], +m[3])].filter(Boolean);
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s);             // 24/11/2026 or 11/24/2026
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    return [ymd(y, +m[2], +m[1]), ymd(y, +m[1], +m[2])].filter(Boolean);
  }
  const month = w => MONTHS[w.slice(0, 4).toLowerCase()] || MONTHS[w.slice(0, 3).toLowerCase()];
  m = /^(?:[a-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})/i.exec(s);   // (Tue,) 24 Nov 2026
  if (m && month(m[2])) return [ymd(+m[3], month(m[2]), +m[1])].filter(Boolean);
  m = /^(?:[a-z]+,?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i.exec(s);   // (Tuesday,) November 24, 2026
  if (m && month(m[1])) return [ymd(+m[3], month(m[1]), +m[2])].filter(Boolean);
  return [];
}

// pick the reading closest to "today" (the Shortcut normally sends today's date)
export function parseDate(s, today) {
  const t = String(s == null ? '' : s).trim().toLowerCase();
  if (t === 'today') return today;
  if (t === 'yesterday') return dateCandidates(today).length ? shift(today, -1) : null;
  const c = dateCandidates(s);
  if (!c.length) return null;
  const tn = dayNum(today);
  c.sort((a, b) => Math.abs(dayNum(a) - tn) - Math.abs(dayNum(b) - tn));
  return c[0];
}
function shift(d, n) { const x = new Date((dayNum(d) + n) * 864e5); return ymd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); }

// "1,850.5 kcal" -> { value:1850.5, unit:'kcal' }
export function parseAmount(v) {
  if (v == null || v === '') return { value: null, unit: null };
  if (typeof v === 'number') return { value: isFinite(v) ? v : null, unit: null };
  if (typeof v === 'object' && v !== null && 'value' in v) { const r = parseAmount(v.value); return { value: r.value, unit: r.unit || (v.unit ? String(v.unit) : null) }; }
  let s = String(v).trim();
  const um = /(kj|kcal|cal|g)\s*$/i.exec(s);
  const unit = um ? um[1].toLowerCase() : null;
  s = s.replace(/[^\d.,\-]/g, '');
  if (!s || !/\d/.test(s)) return { value: null, unit };
  if (s.indexOf('.') >= 0 && s.indexOf(',') >= 0) s = s.replace(/,/g, '');           // 1,850.5
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');                        // 152,5
  else s = s.replace(/,/g, '');                                                        // 1,850
  const n = parseFloat(s);
  return { value: isFinite(n) ? n : null, unit };
}

function pick(o, names) { for (const n of names) if (o[n] != null && o[n] !== '') return o[n]; return null; }
function round1(n) { return Math.round(n * 10) / 10; }

// one day's numbers -> { date, kcal, protein_g, carbs_g, fat_g, notes[] } or { error }
export function cleanDay(raw, ctx) {
  const notes = [];
  const date = raw.date != null && raw.date !== '' ? parseDate(raw.date, ctx.today) : ctx.today;
  if (!date) return { error: 'Couldn’t read the date "' + String(raw.date).slice(0, 40) + '". Send it as 2026-11-24, or leave it out to use today.' };
  const dn = dayNum(date), tn = dayNum(ctx.today);
  if (dn > tn + 1) return { error: 'The date ' + date + ' is in the future.' };
  if (dn < tn - LIMITS.pastDays) return { error: 'The date ' + date + ' is more than ' + LIMITS.pastDays + ' days ago.' };

  const e = parseAmount(pick(raw, ['kcal', 'calories', 'energy', 'dietary_energy', 'dietaryEnergy']));
  let kcal = e.value;
  const unit = String(raw.unit || raw.energy_unit || e.unit || '').toLowerCase();
  if (kcal != null) {
    if (unit === 'kj') { kcal = kcal / KJ_PER_KCAL; notes.push('converted from kJ'); }
    else if (!unit && kcal > 9000) { kcal = kcal / KJ_PER_KCAL; notes.push('looked like kJ, converted'); }
  }
  const out = { date, kcal: null, protein_g: null, carbs_g: null, fat_g: null, notes };
  const set = (field, val, max, label) => {
    if (val == null) return;
    if (val < 0 || val > max) { notes.push(label + ' ignored (' + val + ' is out of range)'); return; }
    out[field] = round1(val);
  };
  set('kcal', kcal, LIMITS.kcal, 'Calories');
  set('protein_g', parseAmount(pick(raw, ['protein', 'protein_g'])).value, LIMITS.macro, 'Protein');
  set('carbs_g', parseAmount(pick(raw, ['carbs', 'carbohydrates', 'carbs_g'])).value, LIMITS.macro, 'Carbs');
  set('fat_g', parseAmount(pick(raw, ['fat', 'total_fat', 'fat_g'])).value, LIMITS.macro, 'Fat');
  return out;
}

// whole request body -> { key, days:[…], errors:[…] }
export function parsePayload(body, headers, now) {
  body = body && typeof body === 'object' ? body : {};
  const h = k => (headers && (typeof headers.get === 'function' ? headers.get(k) : headers[k])) || '';
  let key = String(body.key || body.sync_key || h('x-sync-key') || '').trim();
  if (!key) { const a = String(h('authorization')); if (/^bearer\s+hh_/i.test(a)) key = a.replace(/^bearer\s+/i, '').trim(); }
  const today = todayIn(body.tz ? String(body.tz) : 'Asia/Dubai', now);
  const list = Array.isArray(body.days) ? body.days.slice(0, LIMITS.days) : [body];
  const days = [], errors = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const d = cleanDay(raw, { today });
    if (d.error) { errors.push(d.error); continue; }
    if (d.kcal == null && d.protein_g == null && d.carbs_g == null && d.fat_g == null) { errors.push('No calories or macros for ' + d.date + '.'); continue; }
    const i = days.findIndex(x => x.date === d.date);
    if (i >= 0) days[i] = d; else days.push(d);
  }
  return { key, days, errors, today };
}

// SHA-256 hex, same as the app computes when it makes the key
export async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
