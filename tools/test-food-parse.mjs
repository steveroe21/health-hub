// Unit tests for the food-sync parser (what the iPhone Shortcut sends → clean daily totals)
import { parsePayload, parseAmount, parseDate, todayIn, sha256hex } from '../supabase/functions/food-sync/parse.js';
let fails = 0; const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); };
const NOW = new Date('2026-11-24T10:30:00Z');            // 14:30 in Dubai
const KEY = 'hh_' + 'a'.repeat(43);

ok('today in Dubai', todayIn('Asia/Dubai', NOW) === '2026-11-24');
ok('today in Dubai just after midnight', todayIn('Asia/Dubai', new Date('2026-11-24T20:30:00Z')) === '2026-11-25');
ok('bad time zone falls back to Dubai', todayIn('Not/AZone', NOW) === '2026-11-24');

const T = '2026-11-24';
const dates = {
  '2026-11-24': T, '2026-11-24T21:05:00+04:00': T, '24 Nov 2026 at 21:05': T, '24 November 2026': T, 'Tue, 24 Nov 2026': T,
  'Nov 24, 2026 at 9:05 PM': T, 'November 24, 2026': T, 'Tuesday, November 24, 2026': T, '24/11/2026, 21:05': T, '11/24/2026': T,
  '24.11.2026': T, '23/11/2026': '2026-11-23', '05/11/2026': '2026-11-05', 'today': T, 'yesterday': '2026-11-23', '2026/11/24': T
};
for (const [s, want] of Object.entries(dates)) { const got = parseDate(s, T); ok('date "' + s + '"', got === want, got); }
ok('ambiguous 11/12 picks the reading nearest today', parseDate('11/12/2026', T) === '2026-11-12', parseDate('11/12/2026', T));
ok('nonsense date', parseDate('soon', T) === null);
ok('31 Feb rejected', parseDate('31/02/2026', T) === null);

const amts = [[1850, 1850], ['1850', 1850], ['1,850', 1850], ['1,850.5', 1850.5], ['152,5', 152.5], ['1 850 kcal', 1850], ['160 g', 160], ['', null], [null, null], ['abc', null], [{ value: '7740', unit: 'kJ' }, 7740]];
for (const [v, want] of amts) ok('amount ' + JSON.stringify(v), parseAmount(v).value === want, parseAmount(v));
ok('unit read from text', parseAmount('7740 kJ').unit === 'kj');

let p = parsePayload({ key: KEY, kcal: 1850.44, protein: '160.2', carbs: 180, fat: '62' }, {}, NOW);
ok('basic payload: key', p.key === KEY);
ok('basic payload: today in Dubai', p.days.length === 1 && p.days[0].date === T, p.days[0]);
ok('basic payload: numbers rounded to 0.1', p.days[0].kcal === 1850.4 && p.days[0].protein_g === 160.2 && p.days[0].carbs_g === 180 && p.days[0].fat_g === 62, p.days[0]);

p = parsePayload({ key: KEY, date: '24 Nov 2026 at 23:50', kcal: '' , protein: '' }, {}, NOW);
ok('nothing logged yet → no rows, a gentle message', p.days.length === 0 && /No calories/.test(p.errors[0]), p.errors);

p = parsePayload({ key: KEY, kcal: 9600 }, {}, NOW);
ok('9600 with no unit treated as kJ', p.days[0].kcal === 2294.5 && p.days[0].notes.length === 1, p.days[0]);
p = parsePayload({ key: KEY, kcal: 7740 }, {}, NOW);
ok('7740 with no unit left as kcal (ambiguous; app flags it)', p.days[0].kcal === 7740, p.days[0]);
p = parsePayload({ key: KEY, kcal: 7740, unit: 'kcal' }, {}, NOW);
ok('7740 kcal kept when unit says kcal', p.days[0].kcal === 7740);
p = parsePayload({ key: KEY, kcal: 2000, unit: 'kJ' }, {}, NOW);
ok('explicit kJ converted', p.days[0].kcal === 478, p.days[0].kcal);
p = parsePayload({ key: KEY, kcal: 1800, protein: 5000 }, {}, NOW);
ok('impossible protein dropped, calories kept', p.days[0].protein_g === null && p.days[0].kcal === 1800 && /Protein ignored/.test(p.days[0].notes[0]), p.days[0]);
p = parsePayload({ key: KEY, kcal: 1800, date: '2026-12-25' }, {}, NOW);
ok('future date refused', p.days.length === 0 && /future/.test(p.errors[0]), p.errors);
p = parsePayload({ key: KEY, kcal: 1800, date: '2024-01-01' }, {}, NOW);
ok('very old date refused', p.days.length === 0 && /days ago/.test(p.errors[0]), p.errors);
p = parsePayload({ kcal: 1800 }, { 'x-sync-key': KEY }, NOW);
ok('key from x-sync-key header', p.key === KEY);
p = parsePayload({ kcal: 1800 }, new Headers({ authorization: 'Bearer ' + KEY }), NOW);
ok('key from Authorization: Bearer', p.key === KEY);
p = parsePayload({ key: KEY, days: [{ date: '2026-11-22', kcal: 2100, protein: 150 }, { date: '2026-11-23', kcal: 1700 }, { date: '2026-11-23', kcal: 1750 }, { date: 'x' }] }, {}, NOW);
ok('several days: later duplicate wins, bad one reported', p.days.length === 2 && p.days[1].kcal === 1750 && p.errors.length === 1, p);
p = parsePayload({ key: KEY, calories: '2,050', total_fat: 70, carbohydrates: 210 }, {}, NOW);
ok('alternative field names', p.days[0].kcal === 2050 && p.days[0].fat_g === 70 && p.days[0].carbs_g === 210, p.days[0]);
p = parsePayload({ key: KEY, kcal: 1800, tz: 'Europe/Dublin' }, {}, new Date('2026-11-24T21:30:00Z'));
ok('tz: Dublin evening is still the 24th', p.days[0].date === T, p.days[0].date);
p = parsePayload('nonsense', {}, NOW);
ok('junk body → no key, no rows', p.key === '' && p.days.length === 0);

ok('sha256 matches a known value', (await sha256hex('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
