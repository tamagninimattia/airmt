// Carica da Supabase i dati di un anno nel formato che si aspetta il motore (js/engine/year.js)
import { sb, rows, rowsAll } from './db.js';

export async function loadYear(year) {
  const byYear = (table, cols) => rowsAll(() => sb.from(table).select(cols).eq('year', year)
    .order('month').order(cols.split(', ')[1]));
  const [yearRow, accounts, causali, openings, entries, budgetAccounts, budgetCausali, adjustments, months,
         reconciliations] =
    await Promise.all([
      rows(sb.from('years').select('year, status, target').eq('year', year).maybeSingle()),
      rows(sb.from('accounts').select('*')),
      rows(sb.from('causali').select('*')),
      rows(sb.from('opening_balances').select('account_id, amount').eq('year', year)),
      rowsAll(() => sb.from('entries')
        .select('id, entry_date, causale_id, debit_account_id, credit_account_id, amount, note')
        .gte('entry_date', `${year}-01-01`).lt('entry_date', `${year + 1}-01-01`)
        .order('entry_date').order('id')),
      byYear('budget_accounts', 'month, account_id, amount'),
      byYear('budget_causali', 'month, causale_id, amount'),
      byYear('channel_adjustments', 'month, causale_id, amount'),
      rows(sb.from('months').select('month, closed, closed_at').eq('year', year).order('month')),
      rows(sb.from('reconciliations').select('month, account_id, actual_balance, note').eq('year', year))
    ]);
  if (!yearRow) throw new Error(`l'anno ${year} non esiste: crealo dall'Avvio`);

  return {
    year,
    status: yearRow.status,
    target: Number(yearRow.target),
    accounts,
    causali,
    openings: Object.fromEntries(openings.map((o) => [o.account_id, Number(o.amount)])),
    entries,
    budgetAccounts,
    budgetCausali,
    adjustments,
    months,
    // saldi reali di banca ("Saldo per controllo") per conto e mese
    reconciliations: reconciliations.map((r) => ({ ...r, actual_balance: Number(r.actual_balance) }))
  };
}

// Anni creati, in ordine
export async function yearList() {
  return (await rows(sb.from('years').select('year').order('year'))).map((y) => y.year);
}

// Anno da aprire: quello indicato se esiste, altrimenti quello di oggi, altrimenti il più recente
export function pickYear(years, param, todayYear) {
  if (years.includes(+param)) return +param;
  return years.includes(todayYear) ? todayYear : years.at(-1);
}
