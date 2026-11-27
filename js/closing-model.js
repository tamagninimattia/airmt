// Chiusura del mese e dell'anno, riconciliazione con il saldo reale di banca. Funzioni pure.
// Chiudere un mese imposta solo months.closed: non blocca nulla, si può riaprire e il budget
// non viene riscritto (lo allinea Mattia prima di chiudere). Questi controlli lo aiutano a farlo.
import { round2 } from './format.js';
import { sortByOrder, GROUPS } from './settings-model.js';

const nonzero = (s) => Boolean(s?.some((v) => v !== 0));

/**
 * Riconciliazione di un mese: per ogni conto patrimoniale il saldo calcolato (consuntivo a fine mese)
 * e quello reale inserito. status: 'ok' (coincidono), 'diff' (diversi), 'missing' (saldo reale non inserito)
 */
export function reconciliationRows(data, actual, month) {
  const recs = new Map(data.reconciliations.filter((r) => r.month === month).map((r) => [r.account_id, r]));
  const accounts = sortByOrder(data.accounts.filter((a) => a.type === 'patrimoniale'));
  return GROUPS.flatMap((g) => accounts
    .filter((a) => a.grp === g.value)
    .filter((a) => a.active || recs.has(a.id) || nonzero(actual.closing.get(a.id)) || Number(data.openings[a.id] || 0) !== 0)
    .map((a) => {
      const calculated = actual.closing.get(a.id)[month - 1];
      const r = recs.get(a.id);
      const real = r ? r.actual_balance : null;
      const diff = real == null ? null : round2(real - calculated);
      return { account: a, group: g.label, calculated, real, diff, note: r?.note ?? '',
               status: real == null ? 'missing' : diff === 0 ? 'ok' : 'diff' };
    }));
}

/**
 * Controlli prima di chiudere un mese (indice 1–12). Nessuno blocca la chiusura.
 *   budgetDiffs  voci e causali finanziarie con budget diverso dal consuntivo nel mese
 *                (imprevisti esclusi: alla chiusura vanno a 0 da soli)
 *   varToAlign   Var del mese da allineare con gli Alert del Giornale
 *   quadratura   quadratura del consuntivo a fine mese
 *   reconciled   conti con saldo reale inserito, e quelli che non coincidono
 */
export function monthChecks(data, { actual, budget }, month, alignItems = []) {
  const m = month - 1;
  const budgetDiffs = [];
  for (const a of sortByOrder(data.accounts.filter((x) => x.type === 'economico' && !x.is_contingency))) {
    const b = budget.econ.get(a.id)?.[m] ?? 0;
    const ac = actual.econ.get(a.id)?.[m] ?? 0;
    if (round2(b - ac) !== 0) {
      budgetDiffs.push({ label: a.name, kind: a.kind, budget: b, actual: ac, diff: round2(ac - b),
                         edit: { table: 'budget_accounts', id: a.id } });
    }
  }
  for (const c of sortByOrder(data.causali.filter((x) => x.kind === 'finanziaria'), 'code')) {
    const b = budget.causali.get(c.id)?.[m] ?? 0;
    const ac = actual.causali.get(c.id)?.[m] ?? 0;
    if (round2(b - ac) !== 0) {
      budgetDiffs.push({ label: c.description, code: c.code, kind: 'finanziaria', budget: b, actual: ac,
                         diff: round2(ac - b), calculated: Boolean(c.budget_rule),
                         edit: { table: 'budget_causali', id: c.id } });
    }
  }
  const recs = reconciliationRows(data, actual, month);
  return {
    budgetDiffs,
    varToAlign: alignItems.filter((x) => x.month === month),
    quadratura: actual.quadratura[m],
    reconciled: recs.filter((r) => r.status !== 'missing').length,
    mismatched: recs.filter((r) => r.status === 'diff'),
    accounts: recs.length
  };
}

// "Allinea tutto il budget del mese al consuntivo": righe da salvare per tabella, dalle differenze
// di monthChecks, comprese le causali calcolate: per loro la riga salvata vale al posto del calcolato.
export function alignMonthRows(budgetDiffs, userId, year, month) {
  const out = { budget_accounts: [], budget_causali: [] };
  for (const d of budgetDiffs) {
    if (!d.edit) continue;
    const key = d.edit.table === 'budget_accounts' ? 'account_id' : 'causale_id';
    out[d.edit.table].push({ user_id: userId, year, month, [key]: d.edit.id, amount: d.actual });
  }
  return out;
}

// L'anno si può chiudere quando tutti i 12 mesi sono chiusi
export function yearClosable(months) {
  const closed = new Set(months.filter((m) => m.closed).map((m) => m.month));
  const open = [];
  for (let m = 1; m <= 12; m++) if (!closed.has(m)) open.push(m);
  return { closable: open.length === 0, open };
}

/**
 * Saldi iniziali dell'anno dopo: i saldi finali reali di dicembre di questo anno.
 * nextOpenings: { account_id: importo } già salvati per l'anno dopo (se esiste).
 * Restituisce le righe con le differenze, da aggiornare finché l'anno dopo è in bozza.
 */
export function nextYearOpenings(data, actual, nextOpenings = {}) {
  return sortByOrder(data.accounts.filter((a) => a.type === 'patrimoniale')).map((a) => {
    const closing = actual.closing.get(a.id)[11];
    const saved = nextOpenings[a.id] ?? null;
    return { account: a, closing, saved, differs: saved == null ? closing !== 0 : round2(saved - closing) !== 0 };
  });
}
