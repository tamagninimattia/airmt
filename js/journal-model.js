// Regole del Giornale: funzioni pure, senza DOM né Supabase.
import { MONTHS } from './format.js';

const pad = (n) => String(n).padStart(2, '0');

// Primo giorno del mese e primo giorno del mese dopo (per i filtri sulle date)
export function monthBounds(year, month) {
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  return { from: `${year}-${pad(month)}-01`, to: `${next[0]}-${pad(next[1])}-01` };
}

export function shiftMonth({ year, month }, delta) {
  const i = year * 12 + (month - 1) + delta;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

// "2027-03" -> { year: 2027, month: 3 }; null se non valido
export function parseMonthParam(p) {
  const m = /^(\d{4})-(\d{2})$/.exec(p || '');
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return { year: +m[1], month: +m[2] };
}

export const monthParam = ({ year, month }) => `${year}-${pad(month)}`;

// Mese da mostrare se non indicato: quello di oggi se l'anno esiste, altrimenti il primo
// mese non chiuso dell'anno più recente (o dicembre se sono tutti chiusi).
export function defaultMonth(years, months, todayIso) {
  if (!years.length) return null;
  const ty = +todayIso.slice(0, 4);
  if (years.some((y) => y.year === ty)) return { year: ty, month: +todayIso.slice(5, 7) };
  const year = Math.max(...years.map((y) => y.year));
  const closed = new Set(months.filter((m) => m.year === year && m.closed).map((m) => m.month));
  let month = 1;
  while (month < 12 && closed.has(month)) month++;
  return { year, month };
}

// Data proposta nel form: oggi se si sta guardando il mese di oggi, altrimenti il primo del mese
export function defaultDate(view, todayIso) {
  return todayIso.startsWith(monthParam(view)) ? todayIso : monthBounds(view.year, view.month).from;
}

// La causale chiede un conto economico? (ricavo -> Avere, costo -> Dare)
export const needsEconomic = (causale) => causale?.kind === 'ricavo' || causale?.kind === 'costo';

// Alert di canale: stessa regola della vista entries_enriched
export function channelAlert(causale, account) {
  return Boolean(causale && account && needsEconomic(causale)
    && account.kind === causale.kind
    && account.standard_causale_id
    && account.standard_causale_id !== causale.id);
}

export function alertText(account, standardCode, isoDate) {
  const month = MONTHS[+isoDate.slice(5, 7) - 1];
  return `Fuori canale: il canale standard di «${account.name}» è ${standardCode}. ` +
         `Ricorda le Var +/- di ${month} nel Budget.`;
}

export function validateEntry({ causale, account, date, amount }, yearNumbers) {
  const errors = [];
  if (!causale) errors.push('Scegli la causale.');
  if (needsEconomic(causale)) {
    if (!account) errors.push('Scegli il conto economico.');
    else if (account.type !== 'economico' || account.kind !== causale.kind) {
      errors.push(`Con una causale di ${causale.kind} il conto deve essere un ${causale.kind}.`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) errors.push('Inserisci la data.');
  else if (!yearNumbers.includes(+date.slice(0, 4))) {
    errors.push(`L'anno ${date.slice(0, 4)} non esiste ancora: crealo dalle Chiusure dell'anno prima, oppure correggi la data.`);
  }
  if (Number.isNaN(amount)) errors.push('Scrivi l\'importo come 12,50 (al massimo 2 decimali).');
  else if (!(amount > 0)) errors.push('L\'importo deve essere maggiore di zero.');
  return errors;
}

// Record per la tabella entries: il lato fisso viene dalla causale (lo ricontrolla il trigger).
// provisional: movimento provvisorio, visibile nel Giornale ma escluso da tutti i calcoli.
export function buildEntry(causale, accountId, date, amount, note, provisional = false) {
  return {
    entry_date: date,
    causale_id: causale.id,
    debit_account_id:  causale.kind === 'costo'  ? accountId : causale.debit_account_id,
    credit_account_id: causale.kind === 'ricavo' ? accountId : causale.credit_account_id,
    amount,
    note: (note || '').trim() || null,
    provisional: Boolean(provisional)
  };
}

// Movimenti provvisori arrivati a maturazione: data uguale o precedente a oggi, dal più vecchio
export function maturedProvisional(entries, todayIso) {
  return entries.filter((e) => e.provisional && e.entry_date <= todayIso)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date));
}

// Preferiti: la causale è obbligatoria; conto economico e importo sono facoltativi
// (per le spese variabili si salva solo lo schema). amount: null se il campo è vuoto.
export function validateFavorite({ name, causale, account, amount }) {
  const errors = [];
  if (!(name || '').trim()) errors.push('Dai un nome al preferito.');
  if (!causale) errors.push('Scegli almeno la causale prima di salvare il preferito.');
  if (causale && account && (!needsEconomic(causale) || account.kind !== causale.kind)) {
    errors.push(`Con una causale di ${causale.kind} il conto deve essere un ${causale.kind}.`);
  }
  if (Number.isNaN(amount)) errors.push('Scrivi l\'importo come 12,50 (al massimo 2 decimali), oppure lascialo vuoto.');
  else if (amount != null && !(amount > 0)) errors.push('L\'importo deve essere maggiore di zero, oppure vuoto.');
  return errors;
}

export function buildFavorite(name, causale, accountId, amount, note) {
  return {
    name: name.trim(),
    causale_id: causale.id,
    economic_account_id: needsEconomic(causale) ? accountId || null : null,
    amount: amount ?? null,
    note: (note || '').trim() || null
  };
}

// Nome proposto per un nuovo preferito: il conto economico, altrimenti la descrizione della causale
export const favoriteName = (causale, account) => account?.name ?? causale?.description ?? '';
