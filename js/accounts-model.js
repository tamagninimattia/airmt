// Schede conto e situazione patrimoniale: funzioni pure, dai dati dell'anno e dai risultati del motore.
// Le schede non hanno tabella: le righe vengono dalle causali che muovono il conto e dai movimenti.
import { round2 } from './format.js';
import { zeros } from './engine/year.js';
import { GROUPS, sortByOrder } from './settings-model.js';

const nonzero = (s) => Boolean(s?.some((v) => v !== 0));
const sumSeries = (list) => list.reduce((out, s) => out.map((v, m) => round2(v + s[m])), zeros());

// Variazioni + e − di un conto: per gli attivi entrano in Dare, per i passivi in Avere;
// per i conti economici il + è il lato naturale (ricavi in Avere, costi in Dare) e il − sono gli storni
export function sides(account) {
  if (account.type === 'economico') {
    return account.kind === 'ricavo'
      ? { plus: 'avere', minus: 'dare', plusLabel: 'Ricavi', minusLabel: 'Storni' }
      : { plus: 'dare', minus: 'avere', plusLabel: 'Costi', minusLabel: 'Storni' };
  }
  return account.side === 'passivo'
    ? { plus: 'avere', minus: 'dare', plusLabel: 'Incrementi', minusLabel: 'Decrementi' }
    : { plus: 'dare', minus: 'avere', plusLabel: 'Entrate', minusLabel: 'Uscite' };
}

// Scostamento dei saldi: più attivo o meno passivo del previsto è favorevole
export const balanceKind = (account) => (account.side === 'passivo' ? 'costo' : 'ricavo');

// Lato su cui una causale muove il conto, secondo i suoi conti fissi (null se non lo muove)
export function causaleSide(causale, accountId) {
  if (causale.kind !== 'costo' && causale.debit_account_id === accountId) return 'dare';
  if (causale.kind !== 'ricavo' && causale.credit_account_id === accountId) return 'avere';
  return null;
}

// Saldo iniziale di ogni mese: gennaio dal saldo di apertura, poi il finale del mese prima
export const openingSeries = (opening, closing) => [opening, ...closing.slice(0, 11)];

/**
 * Righe della scheda di un conto patrimoniale (stesso formato di readGrid in grid.js):
 * saldo iniziale, variazioni + per causale, variazioni − per causale, saldo finale.
 */
export function cardRows(data, { actual, budget }, accountId, { showZero = false } = {}) {
  const account = data.accounts.find((a) => a.id === accountId);
  const s = sides(account);
  const kind = balanceKind(account);
  const opening = Number(data.openings[accountId] || 0);
  const bMoves = budget.moves.get(accountId) ?? new Map();
  const aMoves = actual.moves.get(accountId) ?? new Map();
  const causali = sortByOrder(data.causali, 'code');

  function section(side, label) {
    const lines = [];
    for (const c of causali) {
      const b = bMoves.get(c.id)?.[side] ?? zeros();
      const a = aMoves.get(c.id)?.[side] ?? zeros();
      const structural = causaleSide(c, accountId) === side;
      if (!(nonzero(b) || nonzero(a) || (structural && showZero))) continue;
      lines.push({ key: `${side}-${c.id}`, type: 'line', label: c.description, kind: 'finanziaria',
                   budget: b, actual: a, total: 'sum', inactive: !c.active,
                   calc: Boolean(c.budget_rule) });
    }
    return [
      { key: 'sub-' + side, type: 'sub', label },
      ...lines,
      { key: 'tot-' + side, type: 'total', label: 'Totale ' + label.toLowerCase(), kind: 'finanziaria', total: 'sum',
        budget: sumSeries(lines.map((l) => l.budget)), actual: sumSeries(lines.map((l) => l.actual)) }
    ];
  }

  const bClosing = budget.closing.get(accountId);
  const aClosing = actual.closing.get(accountId);
  const rows = [
    { key: 'opening', type: 'total', label: 'Saldo iniziale', kind, total: 'first', negRed: true,
      budget: openingSeries(opening, bClosing), actual: openingSeries(opening, aClosing) },
    ...section(s.plus, s.plusLabel),
    ...section(s.minus, s.minusLabel),
    { key: 'closing', type: 'total', label: 'Saldo finale', kind, total: 'last', negRed: true,
      budget: bClosing, actual: aClosing }
  ];

  // "Saldo per controllo": saldo reale di banca inserito nelle Chiusure, nella colonna Progr.
  const recs = (data.reconciliations ?? []).filter((r) => r.account_id === accountId);
  if (recs.length) {
    const real = new Array(12).fill(null);
    for (const r of recs) real[r.month - 1] = r.actual_balance;
    rows.push(
      { key: 'control', type: 'total', label: 'Saldo per controllo (reale)', total: 'none', negRed: true,
        budget: null, actual: real },
      { key: 'control-diff', type: 'check', label: 'Differenza reale − calcolato', total: 'none',
        budget: null, actual: real.map((v, m) => (v == null ? null : round2(v - aClosing[m]))) });
  }
  return rows;
}

/**
 * Movimenti reali di un conto in tutto l'anno, con il saldo progressivo
 * (per i conti economici parte da 0: è il totale progressivo dell'anno).
 * Ogni riga: { id, date, label, note, plus, minus, balance, provisional }
 */
// provisional: movimenti provvisori da mostrare (in lilla) tra quelli reali; non muovono il saldo
// progressivo né il saldo finale, che restano quelli del consuntivo (balance = null).
export function accountLedger(data, accountId, { provisional = [] } = {}) {
  const account = data.accounts.find((a) => a.id === accountId);
  const s = sides(account);
  const name = (id) => data.accounts.find((a) => a.id === id)?.name ?? '–';
  let balance = account.type === 'economico' ? 0 : Number(data.openings[accountId] || 0);
  const start = balance;

  const mine = (e) => e.entry_date.startsWith(String(data.year))
    && (e.debit_account_id === accountId || e.credit_account_id === accountId);
  const lines = [...data.entries.filter(mine), ...provisional.filter(mine).map((e) => ({ ...e, provisional: true }))]
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
    .map((e) => {
      const side = e.debit_account_id === accountId ? 'dare' : 'avere';
      const other = side === 'dare' ? e.credit_account_id : e.debit_account_id;
      const amount = Number(e.amount);
      const plus = side === s.plus ? amount : 0;
      const minus = side === s.minus ? amount : 0;
      if (!e.provisional) balance = round2(balance + plus - minus);
      return { id: e.id, date: e.entry_date, label: name(other), note: e.note || '',
               plus, minus, balance: e.provisional ? null : balance, provisional: Boolean(e.provisional) };
    });
  return { start, lines, end: balance };
}

/**
 * Situazione patrimoniale: saldi di fine mese per gruppo, totali, posizione e quadratura.
 * hrefFor(account) dà il collegamento alla scheda del conto.
 */
export function positionRows(data, { actual, budget }, { hrefFor = () => null } = {}) {
  const rows = [];
  const accounts = sortByOrder(data.accounts.filter((a) => a.type === 'patrimoniale'));
  const totals = { attivo: { budget: [], actual: [] }, passivo: { budget: [], actual: [] } };

  for (const g of GROUPS) {
    const items = accounts.filter((a) => a.grp === g.value);
    const visible = items.filter((a) => a.active || nonzero(budget.closing.get(a.id)) || nonzero(actual.closing.get(a.id))
                                        || Number(data.openings[a.id] || 0) !== 0);
    if (!visible.length) continue;
    rows.push({ key: 'head-' + g.value, type: 'head', label: g.label });
    for (const a of visible) {
      rows.push({ key: 'acc-' + a.id, type: 'line', label: a.name, href: hrefFor(a), kind: balanceKind(a),
                  budget: budget.closing.get(a.id), actual: actual.closing.get(a.id), total: 'last',
                  negRed: true, inactive: !a.active });
    }
    // i totali di gruppo contano tutti i conti, anche quelli nascosti perché a zero
    const b = sumSeries(items.map((a) => budget.closing.get(a.id)));
    const ac = sumSeries(items.map((a) => actual.closing.get(a.id)));
    totals[g.side].budget.push(b);
    totals[g.side].actual.push(ac);
    rows.push({ key: 'tot-' + g.value, type: 'total', label: 'Totale ' + g.label.toLowerCase(),
                kind: g.side === 'passivo' ? 'costo' : 'ricavo', budget: b, actual: ac, total: 'last' });
  }

  const cumulative = (r) => { let t = 0; return r.ricavi.map((v, m) => (t = round2(t + v - r.costi[m]))); };
  const constant = (v) => new Array(12).fill(v);
  const bResult = cumulative(budget);
  const aResult = cumulative(actual);

  rows.push(
    { key: 'head-tot', type: 'head', label: 'Posizione patrimoniale' },
    { key: 'attivo', type: 'total', label: 'Totale attivo', kind: 'ricavo', total: 'last',
      budget: sumSeries(totals.attivo.budget), actual: sumSeries(totals.attivo.actual) },
    { key: 'passivo', type: 'total', label: 'Totale passivo', kind: 'costo', total: 'last',
      budget: sumSeries(totals.passivo.budget), actual: sumSeries(totals.passivo.actual) },
    { key: 'posizione', type: 'total', label: 'Posizione patrimoniale', kind: 'ricavo', total: 'last', negRed: true,
      budget: budget.posizione, actual: actual.posizione },
    { key: 'head-quad', type: 'head', label: 'Quadratura' },
    { key: 'iniziale', type: 'line', label: 'Patrimonio iniziale', total: 'first',
      budget: constant(budget.initial), actual: constant(actual.initial) },
    { key: 'risultato', type: 'line', label: 'Risultato progressivo (ricavi − costi)', kind: 'ricavo', total: 'last',
      budget: bResult, actual: aResult },
    { key: 'progressivo', type: 'total', label: 'Patrimonio progressivo', kind: 'ricavo', total: 'last',
      budget: bResult.map((v) => round2(budget.initial + v)), actual: aResult.map((v) => round2(actual.initial + v)) },
    { key: 'quadratura', type: 'check', label: 'Quadratura (posizione − patrimonio progressivo)', total: 'none',
      budget: budget.quadratura, actual: actual.quadratura }
  );
  return rows;
}
