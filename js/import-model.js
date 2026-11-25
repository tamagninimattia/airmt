// Importazione del Giornale da Excel: funzioni pure, senza DOM né Supabase.
// Tracciato (primo foglio del file .xlsx, o file .csv): Data | Da | A | Importo | Note | Causale
// Le celle arrivano come testo (CSV) o come date e numeri (Excel): le funzioni accettano entrambi.
//   Da = da dove escono i soldi, A = dove vanno. Costo: Da = canale, A = voce di costo.
//   Ricavo: Da = voce di ricavo, A = canale. Tra due conti patrimoniali: Da = partenza, A = arrivo.
//   Note e Causale (codice, solo per scegliere tra due causali possibili) sono facoltative.
import { parseAmount, round2 } from './format.js';

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const pad = (n) => String(n).padStart(2, '0');

// Celle di ogni riga: tabulazioni (incolla da Excel) o, in mancanza, punto e virgola (CSV)
export function splitRows(text) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : ';';
  return lines.map((l, i) => ({ line: i + 1, cells: l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1')) }))
    .filter((r) => r.cells.some((c) => c !== ''));
}

// Fogli Excel: righe di celle -> { line, cells } (vuote saltate), come splitRows
export function sheetRows(table) {
  return table.map((cells, i) => ({ line: i + 1, cells: (cells || []).map((c) => (typeof c === 'string' ? c.trim() : c ?? '')) }))
    .filter((r) => r.cells.some((c) => c !== ''));
}

// "03/01/2026", "3/1/2026", "03-01-2026", "2026-01-03", una data di Excel -> "2026-01-03"; null se non valida
export function parseDate(text) {
  if (text instanceof Date) {
    return Number.isNaN(text.getTime()) ? null : `${text.getFullYear()}-${pad(text.getMonth() + 1)}-${pad(text.getDate())}`;
  }
  if (typeof text === 'number') {
    // numero di serie di Excel (giorni dal 30/12/1899)
    const dt = new Date(Math.round((text - 25569) * 86400000));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  const s = String(text ?? '').trim();
  let y, m, d;
  let x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (x) [d, m, y] = [+x[1], +x[2], +x[3]];
  else if ((x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Importo positivo; accetta anche più di 2 decimali (Excel) arrotondando
export function parseImportAmount(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? round2(text) : NaN;
  const v = parseAmount(text);
  if (!Number.isNaN(v)) return v;
  const s = String(text ?? '').replace(/[\s€]/g, '');
  if (/^\d+[.,]\d{3,}$/.test(s) && !/^\d{1,3}\.\d{3}$/.test(s)) return round2(Number(s.replace(',', '.')));
  return NaN;
}

// Nomi dei conti che non corrispondono a nessun conto (né abbinamento già scelto), in ordine di comparsa
export function unknownNames(rows, accounts, mapping = {}) {
  const known = new Set(accounts.map((a) => norm(a.name)));
  const out = [];
  for (const r of rows) {
    if (isHeader(r.cells)) continue;
    for (const name of [r.cells[1], r.cells[2]]) {
      const n = norm(name);
      if (n && !known.has(n) && !mapping[n] && !out.some((x) => norm(x) === n)) out.push(String(name).trim().replace(/\s+/g, ' '));
    }
  }
  return out;
}

function isHeader(cells) {
  return !parseDate(cells[0]) && /data/i.test(String(cells[0] ?? ''));
}

/**
 * Trova la causale per una coppia di conti. Restituisce { causale, account } (account = la voce
 * economica, se c'è) oppure { error }. code: codice causale facoltativo, per scegliere tra più causali.
 */
export function matchCausale(from, to, causali, code) {
  if (!from || !to) return { error: 'Conto mancante.' };
  if (from.id === to.id) return { error: 'Da e A sono lo stesso conto.' };
  let kind, list, account = null;
  if (from.type === 'patrimoniale' && to.type === 'economico') {
    if (to.kind !== 'costo') return { error: `«${to.name}» è un ricavo: va nella colonna Da.` };
    kind = 'costo'; account = to;
    list = causali.filter((c) => c.kind === 'costo' && c.credit_account_id === from.id);
  } else if (from.type === 'economico' && to.type === 'patrimoniale') {
    if (from.kind !== 'ricavo') return { error: `«${from.name}» è un costo: va nella colonna A.` };
    kind = 'ricavo'; account = from;
    list = causali.filter((c) => c.kind === 'ricavo' && c.debit_account_id === to.id);
  } else if (from.type === 'patrimoniale' && to.type === 'patrimoniale') {
    kind = 'finanziaria';
    list = causali.filter((c) => c.kind === 'finanziaria' && c.debit_account_id === to.id && c.credit_account_id === from.id);
  } else {
    return { error: 'Da e A sono due voci economiche: uno dei due deve essere un conto patrimoniale.' };
  }
  if (code) {
    const c = list.find((x) => x.code === code.trim().toUpperCase());
    return c ? { causale: c, account } : { error: `La causale ${code} non collega «${from.name}» e «${to.name}».` };
  }
  if (!list.length) {
    const what = kind === 'costo' ? `di costo pagata da «${from.name}»` : kind === 'ricavo' ? `di ricavo incassata su «${to.name}»`
      : `da «${from.name}» a «${to.name}»`;
    return { error: `Non esiste una causale ${what}: creala dalle Impostazioni (pulsante Causali del conto).` };
  }
  // tra più causali possibili vale il canale standard della voce, altrimenti la si indica nella colonna Causale
  const std = account && list.find((c) => c.id === account.standard_causale_id);
  if (list.length === 1 || std) return { causale: std ?? list[0], account };
  return { error: `Più causali possibili (${list.map((c) => c.code).join(', ')}): scrivi quella giusta nella colonna Causale.` };
}

/**
 * Righe del file ({ line, cells } da sheetRows o splitRows) -> registrazioni da importare.
 * mapping: { nome scritto (minuscolo) -> id del conto } scelto nell'anteprima.
 * years: anni esistenti. Restituisce { rows: [{ line, date, fromName, toName, amount, note, causale, account, rec, error }] }
 */
export function parseImport(table, { accounts, causali, years, mapping = {} }) {
  const byName = new Map(accounts.map((a) => [norm(a.name), a]));
  const find = (name) => {
    const n = norm(name);
    return byName.get(n) ?? accounts.find((a) => a.id === mapping[n]) ?? null;
  };
  const rows = [];
  for (const { line, cells } of table) {
    if (isHeader(cells)) continue;
    const [d, f = '', t = '', amt = '', n = '', c = ''] = cells;
    const fromName = String(f).trim();
    const toName = String(t).trim();
    const code = String(c).trim();
    const r = { line, date: parseDate(d), fromName, toName, amount: parseImportAmount(amt), note: String(n).trim(), error: null };
    const from = find(fromName);
    const to = find(toName);
    if (!r.date) r.error = `Data non valida: «${d}» (scrivila come 03/01/2026).`;
    else if (!years.includes(+r.date.slice(0, 4))) r.error = `L'anno ${r.date.slice(0, 4)} non esiste: crealo dalle Chiusure.`;
    else if (!fromName || !toName) r.error = 'Mancano Da o A.';
    else if (!from || !to) r.error = `Conto sconosciuto: «${!from ? fromName : toName}». Abbinalo qui sopra.`;
    else if (Number.isNaN(r.amount)) r.error = `Importo non valido: «${amt}».`;
    else if (!(r.amount > 0)) r.error = 'L\'importo deve essere maggiore di zero.';
    if (!r.error) {
      const m = matchCausale(from, to, causali, code);
      if (m.error) r.error = m.error;
      else {
        r.causale = m.causale;
        r.account = m.account;
        r.rec = {
          entry_date: r.date, causale_id: m.causale.id, amount: r.amount, note: r.note || null, provisional: false,
          debit_account_id: m.causale.kind === 'costo' ? m.account.id : m.causale.debit_account_id,
          credit_account_id: m.causale.kind === 'ricavo' ? m.account.id : m.causale.credit_account_id
        };
      }
    }
    rows.push(r);
  }
  return { rows };
}

// Chiave per riconoscere i possibili doppioni: stessa data, conti e importo
export const dupKey = (e) => [e.entry_date, e.debit_account_id, e.credit_account_id, round2(Number(e.amount))].join('|');

// Riepilogo per mese delle righe valide: numero, ricavi, costi, movimenti tra conti
export function monthSummary(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!r.rec) continue;
    const k = r.date.slice(0, 7);
    if (!out.has(k)) out.set(k, { month: k, count: 0, ricavi: 0, costi: 0, finanziarie: 0 });
    const s = out.get(k);
    s.count++;
    const key = r.causale.kind === 'ricavo' ? 'ricavi' : r.causale.kind === 'costo' ? 'costi' : 'finanziarie';
    s[key] = round2(s[key] + r.amount);
  }
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month));
}
