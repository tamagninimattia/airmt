// Anno 2027 nel formato del motore, costruito dai dati di seed_default_chart e seed_2027.sql.
// Gli id sono i nomi dei conti e i codici delle causali, così i test si leggono facilmente.
import * as D from './chart-2027.js';

export function chart() {
  const accounts = [];
  const causali = [];
  for (const [name, side, grp, ord] of D.PATRIMONIALI) {
    accounts.push({ id: name, name, type: 'patrimoniale', side, grp, kind: null,
                    is_contingency: false, standard_causale_id: null, sort_order: ord, active: true });
  }
  for (const [code, description, dare, avere, grp, rule, ord] of D.CAUSALI_FINANZIARIE) {
    causali.push({ id: code, code, description, kind: 'finanziaria', debit_account_id: dare,
                   credit_account_id: avere, grp, budget_rule: rule, sort_order: ord, active: true });
  }
  for (const [prefix, label, other, chanIsDebit, grp, ord] of D.PER_CANALE_TIPI) {
    for (const [sfx, chLabel, channel, chOrd] of D.PER_CANALE_CANALI) {
      causali.push({ id: prefix + sfx, code: prefix + sfx, description: label + ' via ' + chLabel,
                     kind: 'finanziaria', debit_account_id: chanIsDebit ? channel : other,
                     credit_account_id: chanIsDebit ? other : channel, grp, budget_rule: null,
                     sort_order: ord * 10 + chOrd, active: true });
    }
  }
  for (const [code, description, kind, channel, ord] of D.CAUSALI_RICAVO_COSTO) {
    causali.push({ id: code, code, description, kind,
                   debit_account_id: kind === 'ricavo' ? channel : null,
                   credit_account_id: kind === 'costo' ? channel : null,
                   grp: kind === 'ricavo' ? 'Ricavi' : 'Costi', budget_rule: null, sort_order: ord, active: true });
  }
  for (const [name, kind, section, contingency, std, ord] of D.ECONOMICI) {
    accounts.push({ id: name, name, type: 'economico', kind, side: null, grp: null, budget_section: section,
                    is_contingency: contingency, standard_causale_id: std, sort_order: ord, active: true });
  }
  return { accounts, causali };
}

const monthly = (list, key) => list.flatMap(([id, amounts]) =>
  amounts.map((amount, i) => ({ month: i + 1, [key]: id, amount })));

export function year2027({ entries = [], adjustments = [], months = [], reconciliations = [] } = {}) {
  return {
    year: 2027,
    target: D.TARGET,
    ...chart(),
    openings: Object.fromEntries(D.SALDI_INIZIALI),
    entries,
    budgetAccounts: monthly(D.BUDGET_CONTI, 'account_id'),
    budgetCausali: monthly(D.BUDGET_CAUSALI, 'causale_id'),
    adjustments,
    months,
    reconciliations
  };
}

// I due movimenti del foglio "Prova Giornale" dell'Excel (entrambi fuori canale)
export const PROVA_GIORNALE = [
  { entry_date: '2027-01-01', causale_id: 'COSPOR', debit_account_id: 'Apple Music',
    credit_account_id: 'Portafoglio', amount: 9.99 },
  { entry_date: '2027-01-01', causale_id: 'RICPOR', debit_account_id: 'Portafoglio',
    credit_account_id: 'Emolumenti mensili', amount: 10000 }
];
