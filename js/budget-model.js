// Righe della griglia del Budget: funzioni pure, dai dati dell'anno e dai risultati del motore.
import { round2 } from './format.js';
import { zeros, adjustmentsToAlign } from './engine/year.js';
import { sortByOrder, groupBy, BUDGET_RULES } from './settings-model.js';

export const CONTINGENCY_CALC = 'Calcolato: ricavi − costi esclusi imprevisti − target, diviso in parti uguali sui mesi non chiusi (0 nei mesi chiusi)';
const ruleLabel = (rule) => BUDGET_RULES.find((r) => r.value === rule)?.label ?? rule;

const nonzero = (s) => Boolean(s?.some((v) => v !== 0));
const get = (map, key) => map.get(key) ?? zeros();
const minus = (a, b) => a.map((v, m) => round2(v - b[m]));

// Mese corrente del Budget: il primo non chiuso, cioè quello dopo l'ultimo chiuso (1–12)
export function currentMonth(months) {
  const closed = new Set(months.filter((m) => m.closed).map((m) => m.month));
  for (let m = 1; m <= 12; m++) if (!closed.has(m)) return m;
  return 12;
}

// Var da allineare per mese (indici 0–11), solo fino al mese corrente: nei mesi futuri
// non ci sono ancora registrazioni e le Var inserite sono pianificazione.
export function alignmentByMonth(suggested, saved, upToMonth) {
  const items = adjustmentsToAlign(suggested, saved).filter((x) => x.month <= upToMonth);
  const counts = zeros();
  for (const x of items) counts[x.month - 1]++;
  return { items, counts };
}

// Nome del canale di una causale di ricavo o costo (il conto fisso)
export function channelName(causale, accounts) {
  const id = causale.kind === 'ricavo' ? causale.debit_account_id : causale.credit_account_id;
  return accounts.find((a) => a.id === id)?.name ?? causale.description;
}

/**
 * Righe della griglia, dall'alto in basso. Ogni riga:
 *   { key, type, label, code?, kind?, budget, actual?, edit?, rule?, total }
 * type: 'head' (titolo di sezione), 'sub' (sottosezione), 'line', 'total', 'var', 'check', 'count'
 * kind: 'ricavo' | 'costo' | 'finanziaria' per lo scostamento (null = niente scostamento)
 * edit: { table, id } se il budget si modifica a mano; calc: spiegazione se è calcolato
 * total: 'sum' (somma dei mesi), 'first' (gennaio), 'last' (dicembre), 'none'
 */
export function buildRows(data, { actual, budget }, { showZero = false, alignCounts = zeros() } = {}) {
  const rows = [];
  // senza «mostra righe a zero» compaiono solo le righe con almeno un valore (budget, Progr. o Var)
  const show = (...series) => showZero || series.some(nonzero);

  // --- conti economici, per sezione del Budget ---
  for (const kind of ['ricavo', 'costo']) {
    const title = kind === 'ricavo' ? 'Ricavi' : 'Costi';
    rows.push({ key: 'head-' + kind, type: 'head', label: title });
    const list = sortByOrder(data.accounts.filter((a) => a.type === 'economico' && a.kind === kind));
    const sections = groupBy(list, (a) => a.budget_section || 'Senza sezione');
    for (const [section, items] of sections) {
      const visible = items.filter((a) => show(get(budget.econ, a.id), get(actual.econ, a.id)));
      if (!visible.length) continue;
      if (sections.size > 1) rows.push({ key: `sub-${kind}-${section}`, type: 'sub', label: section });
      for (const a of visible) {
        rows.push({ key: 'acc-' + a.id, type: 'line', label: a.name, kind, accountId: a.id,
                    budget: get(budget.econ, a.id), actual: get(actual.econ, a.id),
                    edit: a.is_contingency ? null : { table: 'budget_accounts', id: a.id },
                    contingency: a.is_contingency, calc: a.is_contingency ? CONTINGENCY_CALC : null,
                    noChannel: !a.standard_causale_id, inactive: !a.active, total: 'sum' });
      }
    }
    rows.push({ key: 'tot-' + kind, type: 'total', label: 'Totale ' + title.toLowerCase(), kind,
                budget: kind === 'ricavo' ? budget.ricavi : budget.costi,
                actual: kind === 'ricavo' ? actual.ricavi : actual.costi, total: 'sum' });
  }
  rows.push({ key: 'risultato', type: 'total', label: 'Risultato (ricavi − costi)', kind: 'ricavo',
              budget: minus(budget.ricavi, budget.costi), actual: minus(actual.ricavi, actual.costi), total: 'sum' });

  // --- budget per canale e Var +/- ---
  for (const kind of ['ricavo', 'costo']) {
    rows.push({ key: 'head-ch-' + kind, type: 'head', label: kind === 'ricavo' ? 'Ricavi per canale' : 'Costi per canale' });
    for (const c of sortByOrder(data.causali.filter((x) => x.kind === kind), 'code')) {
      const b = get(budget.channels, c.id);
      const a = get(actual.causali, c.id);
      const v = get(budget.adjustments, c.id);
      if (!show(b, a, v)) continue;
      rows.push({ key: 'ch-' + c.id, type: 'line', label: 'di cui ' + channelName(c, data.accounts), code: c.code,
                  kind, budget: b, actual: a, inactive: !c.active, total: 'sum' });
      rows.push({ key: 'var-' + c.id, type: 'var', label: 'Var +/-', code: c.code, budget: v,
                  edit: { table: 'channel_adjustments', id: c.id }, total: 'sum' });
    }
  }
  rows.push({ key: 'var-check', type: 'check', label: 'Verifica Variazioni (deve fare 0)', budget: budget.varCheck, total: 'sum' });
  rows.push({ key: 'var-count', type: 'count', label: 'Var da allineare', budget: alignCounts, total: 'sum' });

  // --- causali finanziarie, per gruppo ---
  rows.push({ key: 'head-fin', type: 'head', label: 'Causali finanziarie' });
  const fin = sortByOrder(data.causali.filter((c) => c.kind === 'finanziaria'), 'code');
  for (const [grp, items] of groupBy(fin, (c) => c.grp || 'Senza gruppo')) {
    const visible = items.filter((c) => show(get(budget.causali, c.id), get(actual.causali, c.id)));
    if (!visible.length) continue;
    rows.push({ key: 'sub-fin-' + grp, type: 'sub', label: grp });
    for (const c of visible) {
      rows.push({ key: 'fin-' + c.id, type: 'line', label: c.description, code: c.code, kind: 'finanziaria',
                  budget: get(budget.causali, c.id), actual: get(actual.causali, c.id),
                  // anche le calcolate si possono scrivere a mano, mese per mese (manual: dove il valore è scritto)
                  edit: { table: 'budget_causali', id: c.id },
                  manual: c.budget_rule ? (budget.overrides?.get(c.id) ?? new Array(12).fill(null)).map((v) => v != null) : null,
                  rule: c.budget_rule || null, calc: c.budget_rule ? ruleLabel(c.budget_rule) : null, inactive: !c.active, total: 'sum' });
    }
  }

  // --- controlli ---
  rows.push({ key: 'head-check', type: 'head', label: 'Controlli' });
  rows.push({ key: 'posizione', type: 'total', label: 'Posizione patrimoniale a fine mese', kind: 'ricavo',
              budget: budget.posizione, actual: actual.posizione, total: 'last' });
  rows.push({ key: 'quadratura', type: 'check', label: 'Quadratura (deve fare 0)',
              budget: budget.quadratura, actual: actual.quadratura, total: 'none' });
  return rows;
}

// Collegamento "+" dal Budget al Giornale per un mese (1–12): righe con budget manuale
// (voci economiche e causali finanziarie, non le calcolate né le Var), solo se al budget
// manca ancora qualcosa. Importo proposto = budget − consuntivo del mese.
export function journalPrefill(row, year, month) {
  if (row.type !== 'line' || !row.edit) return null;
  const missing = round2((row.budget?.[month - 1] ?? 0) - (row.actual?.[month - 1] ?? 0));
  if (!(missing > 0)) return null;
  const key = row.edit.table === 'budget_accounts' ? 'voce' : row.edit.table === 'budget_causali' ? 'causale' : null;
  if (!key) return null;
  const q = new URLSearchParams({ [key]: row.edit.id, importo: missing.toFixed(2) });
  return { amount: missing, href: `#/giornale/${year}-${String(month).padStart(2, '0')}?${q}` };
}

// Pulsante "=": porta il budget del mese (1–12) al consuntivo, anche a zero ("non arriva più nulla").
// Stesse righe del "+"; solo fino al mese corrente (cur), perché nei mesi futuri il consuntivo non c'è ancora.
export function alignToActual(row, month, cur) {
  if (row.type !== 'line' || !row.edit || month > cur) return null;
  const from = row.budget?.[month - 1] ?? 0;
  const to = round2(row.actual?.[month - 1] ?? 0);
  return round2(from - to) !== 0 ? { from, to } : null;
}

// Celle Progr. che cambiano includendo i movimenti provvisori (in lilla nel Budget).
// shown: righe con il consuntivo + provvisori; confirmed: le stesse righe con il solo consuntivo.
// Restituisce key -> 13 booleani (i 12 mesi e il totale anno).
export function provisionalMarks(shown, confirmed) {
  const base = new Map(confirmed.map((r) => [r.key, r]));
  const marks = new Map();
  for (const row of shown) {
    if (!row.actual) continue;
    const c = base.get(row.key) ?? { ...row, actual: zeros() };
    const diff = (a, b) => round2(a ?? 0) !== round2(b ?? 0);
    const m = row.actual.map((v, i) => diff(v, c.actual?.[i]));
    m.push(diff(rowTotal(row, row.actual), rowTotal(c, c.actual)));
    if (m.some(Boolean)) marks.set(row.key, m);
  }
  return marks;
}

export function rowTotal(row, series) {
  if (!series || row.total === 'none') return null;
  if (row.total === 'last') return series[11];
  if (row.total === 'first') return series[0];
  return round2(series.reduce((t, v) => t + v, 0));
}
