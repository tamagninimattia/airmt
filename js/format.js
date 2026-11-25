// Formati italiani per importi e date: funzioni pure.

export const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// 1234.5 -> "1.234,50"; -3 -> "−3,00"
export function fmtAmount(n) {
  const v = round2(Number(n) || 0);
  const [int, dec] = Math.abs(v).toFixed(2).split('.');
  return (v < 0 ? '−' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec;
}

export const fmtEuro = (n) => fmtAmount(n) + ' €';

// Importo scritto a mano -> numero con 2 decimali, NaN se non valido.
// Accetta "12,50", "1.234,56", "12.5", "1.234" (il punto con 3 cifre dopo vale come migliaia), "-3".
export function parseAmount(text) {
  let s = String(text ?? '').replace(/[\s€]/g, '').replace('−', '-');
  if (!s) return NaN;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return round2(Number(s));
}

// Data locale in formato ISO (aaaa-mm-gg), senza passare da UTC
export function isoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// "2027-01-15" -> "15/01"
export const fmtDay = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

export const monthLabel = (year, month) => MONTHS[month - 1] + ' ' + year;
