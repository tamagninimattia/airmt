// Motore di calcolo di un anno: consuntivo, budget concatenato, budget calcolati, quadratura, imprevisti.
// Funzioni pure: ricevono i dati dell'anno già caricati e restituiscono serie di 12 mesi
// (indice 0 = gennaio), arrotondate a 2 decimali.
//
// data = {
//   year, target,
//   accounts, causali,                      // come nelle tabelle
//   openings: { account_id: importo },      // saldi iniziali naturali (un debito è positivo)
//   entries: [{ entry_date, causale_id, debit_account_id, credit_account_id, amount }],
//   budgetAccounts: [{ month, account_id, amount }],
//   budgetCausali:  [{ month, causale_id, amount }],
//   adjustments:    [{ month, causale_id, amount }],   // righe Var +/-
//   months: [{ month, closed }]
// }
// Budget calcolati (mai inseriti a mano): imprevisti, giroconto e addebito carta, rimborsi MT.
import { round2 } from '../format.js';
import { netWorth } from './balances.js';
import { channelAlert } from '../journal-model.js';

export const zeros = () => new Array(12).fill(0);
const sum = (s) => round2(s.reduce((t, v) => t + v, 0));
const get = (map, key) => map.get(key) ?? zeros();

function add(map, key, m, value) {
  if (!map.has(key)) map.set(key, zeros());
  map.get(key)[m] += value;
}

function roundAll(map) {
  for (const [k, s] of map) map.set(k, s.map(round2));
  return map;
}

// Movimenti sui conti: totali Dare e Avere per conto, e dettaglio per conto e causale
// (le righe delle schede conto). post() salta il lato senza conto.
function ledger() {
  const dare = new Map();
  const avere = new Map();
  const moves = new Map();   // conto -> causale -> { dare: [12], avere: [12] }
  const detail = (account, causale, side, m, v) => {
    if (!moves.has(account)) moves.set(account, new Map());
    const byCausale = moves.get(account);
    if (!byCausale.has(causale)) byCausale.set(causale, { dare: zeros(), avere: zeros() });
    byCausale.get(causale)[side][m] += v;
  };
  return {
    dare, avere, moves,
    post(debit, credit, causale, m, v) {
      if (debit) { add(dare, debit, m, v); detail(debit, causale, 'dare', m, v); }
      if (credit) { add(avere, credit, m, v); detail(credit, causale, 'avere', m, v); }
    },
    finish() {
      roundAll(dare);
      roundAll(avere);
      for (const byCausale of moves.values()) {
        for (const s of byCausale.values()) { s.dare = s.dare.map(round2); s.avere = s.avere.map(round2); }
      }
    }
  };
}

// Somma mese per mese le serie delle chiavi indicate
function total(map, keys) {
  const out = zeros();
  for (const k of keys) get(map, k).forEach((v, m) => { out[m] += v; });
  return out.map(round2);
}

export function computeYear(data) {
  const actual = computeActual(data);
  const budget = computeBudget(data);
  return { actual, budget, summary: budgetSummary(data, budget) };
}

// ---------------------------------------------------------------------
// Parti comuni a consuntivo e budget
// ---------------------------------------------------------------------

// Saldi di fine mese concatenati dal saldo iniziale: attivi + Dare − Avere, passivi + Avere − Dare
function closingBalances(accounts, openings, dare, avere) {
  const closing = new Map();
  for (const a of accounts) {
    if (a.type !== 'patrimoniale') continue;
    const sign = a.side === 'passivo' ? -1 : 1;
    const d = get(dare, a.id);
    const c = get(avere, a.id);
    let balance = Number(openings[a.id] || 0);
    closing.set(a.id, d.map((_, m) => (balance = round2(balance + sign * (d[m] - c[m])))));
  }
  return closing;
}

// Posizione patrimoniale a fine mese e quadratura:
// posizione − (patrimonio iniziale + ricavi − costi progressivi), deve fare sempre 0
function position(accounts, openings, closing, ricavi, costi) {
  const initial = netWorth(accounts, openings).patrimonio;
  const posizione = [];
  const quadratura = [];
  let result = 0;
  for (let m = 0; m < 12; m++) {
    const at = new Map([...closing].map(([id, s]) => [id, s[m]]));
    posizione.push(netWorth(accounts, at).patrimonio);
    result += ricavi[m] - costi[m];
    quadratura.push(round2(posizione[m] - initial - result));
  }
  return { initial, posizione, quadratura };
}

const economics = (accounts, kind) => accounts.filter((a) => a.type === 'economico' && a.kind === kind);

// ---------------------------------------------------------------------
// Consuntivo: si concatena con il consuntivo (saldo finale reale = iniziale del mese dopo)
// ---------------------------------------------------------------------

export function computeActual({ year, accounts, openings, entries }) {
  const book = ledger();
  const causali = new Map();   // importi registrati per causale (Progr. delle righe del Budget)
  for (const e of entries) {
    if (+e.entry_date.slice(0, 4) !== year) continue;
    const m = +e.entry_date.slice(5, 7) - 1;
    const amount = Number(e.amount);
    book.post(e.debit_account_id, e.credit_account_id, e.causale_id, m, amount);
    add(causali, e.causale_id, m, amount);
  }
  book.finish();
  roundAll(causali);
  const { dare, avere, moves } = book;

  // conti economici: ricavi Avere − Dare, costi Dare − Avere
  const econ = new Map();
  for (const a of accounts) {
    if (a.type !== 'economico') continue;
    const d = get(dare, a.id);
    const c = get(avere, a.id);
    econ.set(a.id, d.map((_, m) => round2(a.kind === 'ricavo' ? c[m] - d[m] : d[m] - c[m])));
  }

  const ricavi = total(econ, economics(accounts, 'ricavo').map((a) => a.id));
  const costi = total(econ, economics(accounts, 'costo').map((a) => a.id));
  const closing = closingBalances(accounts, openings, dare, avere);
  return { dare, avere, moves, causali, econ, ricavi, costi, closing,
           ...position(accounts, openings, closing, ricavi, costi) };
}

// ---------------------------------------------------------------------
// Budget: si concatena con il budget
// ---------------------------------------------------------------------

export function computeBudget({ accounts, causali, openings, budgetAccounts, budgetCausali, adjustments,
                                 target = 0, months = [] }) {
  const byId = new Map(causali.map((c) => [c.id, c]));

  // voci economiche: budget inserito a mano, tranne gli imprevisti (calcolati, eventuali righe salvate ignorate)
  const contingency = accounts.find((a) => a.type === 'economico' && a.is_contingency);
  const econ = new Map(accounts.filter((a) => a.type === 'economico').map((a) => [a.id, zeros()]));
  for (const r of budgetAccounts) if (r.account_id !== contingency?.id) add(econ, r.account_id, r.month - 1, Number(r.amount));
  roundAll(econ);
  if (contingency) econ.set(contingency.id, contingencyPlan(econ, accounts, target, months).plan);

  const vars = new Map();
  for (const r of adjustments) add(vars, r.causale_id, r.month - 1, Number(r.amount));
  roundAll(vars);

  // budget per canale (righe "di cui"): voci con quel canale standard + Var +/-
  const channels = new Map();
  for (const c of causali) if (c.kind !== 'finanziaria') channels.set(c.id, [...get(vars, c.id)]);
  for (const a of accounts) {
    const s = a.type === 'economico' && channels.get(a.standard_causale_id);
    if (s) get(econ, a.id).forEach((v, m) => { s[m] += v; });
  }
  roundAll(channels);

  // causali finanziarie: manuali, tranne quelle con budget_rule (calcolate qui sotto). Per queste una riga
  // salvata in budget_causali è un valore scritto a mano che vale al posto del calcolato in quel mese
  // (overrides: causale -> 12 valori, null dove vale il calcolato)
  const fin = new Map(causali.filter((c) => c.kind === 'finanziaria').map((c) => [c.id, zeros()]));
  const overrides = new Map();
  for (const r of budgetCausali) {
    const c = byId.get(r.causale_id);
    if (c?.kind !== 'finanziaria') continue;
    if (!c.budget_rule) add(fin, c.id, r.month - 1, Number(r.amount));
    else {
      if (!overrides.has(c.id)) overrides.set(c.id, new Array(12).fill(null));
      overrides.get(c.id)[r.month - 1] = round2(Number(r.amount));
    }
  }
  roundAll(fin);
  applyRules(causali, openings, channels, fin, overrides);

  // movimenti di budget sui conti patrimoniali
  // (per ricavi e costi solo il lato del canale: il conto economico non ha saldo)
  const book = ledger();
  for (const c of causali) {
    const series = c.kind === 'finanziaria' ? get(fin, c.id) : get(channels, c.id);
    const debit = c.kind === 'costo' ? null : c.debit_account_id;
    const credit = c.kind === 'ricavo' ? null : c.credit_account_id;
    series.forEach((v, m) => { if (v) book.post(debit, credit, c.id, m, v); });
  }
  book.finish();
  const { dare, avere, moves } = book;

  const ricavi = total(econ, economics(accounts, 'ricavo').map((a) => a.id));
  const costi = total(econ, economics(accounts, 'costo').map((a) => a.id));
  const closing = closingBalances(accounts, openings, dare, avere);

  return {
    econ, channels, adjustments: vars, causali: fin, overrides, moves, closing, ricavi, costi,
    // "Verifica Variazioni": la somma di tutte le Var del mese deve fare 0
    varCheck: total(vars, [...vars.keys()]),
    // voci con budget ma senza canale standard: non muovono nessun conto e rompono la quadratura
    unassigned: accounts.filter((a) => a.type === 'economico' && !channels.has(a.standard_causale_id)
                                       && get(econ, a.id).some((v) => v !== 0)),
    ...position(accounts, openings, closing, ricavi, costi)
  };
}

// Budget calcolati dall'app (causali con budget_rule):
//   mt_rimborso    gennaio = saldo iniziale del credito verso MT; poi anticipi del mese prima
//   card_giroconto costi su carta − ricavi su carta del mese (budget per canale, Var comprese)
//   card_addebito  gennaio = saldo iniziale della carta da addebitare; poi giroconto del mese prima
// In ogni mese un valore scritto a mano (overrides) prende il posto del calcolato; le regole che
// dipendono da un'altra (l'addebito dal giroconto) usano il valore finale, scritto o calcolato.
function applyRules(causali, openings, channels, fin, overrides = new Map()) {
  const opening = (id) => Number(openings[id] || 0);
  const rule = (r) => causali.find((c) => c.budget_rule === r);
  const set = (c, series) => {
    const o = overrides.get(c.id);
    fin.set(c.id, series.map((v, m) => (o && o[m] != null ? o[m] : v)));
  };

  const mt = rule('mt_rimborso');
  if (mt) {
    // anticipi = causali finanziarie che caricano il credito verso MT
    const anticipi = total(fin, causali
      .filter((c) => c.kind === 'finanziaria' && c.id !== mt.id && c.debit_account_id === mt.credit_account_id)
      .map((c) => c.id));
    set(mt, anticipi.map((_, m) => (m === 0 ? opening(mt.credit_account_id) : anticipi[m - 1])));
  }

  const giro = rule('card_giroconto');
  if (giro) {
    const card = giro.debit_account_id;
    const costs = total(channels, causali.filter((c) => c.kind === 'costo' && c.credit_account_id === card).map((c) => c.id));
    const revenues = total(channels, causali.filter((c) => c.kind === 'ricavo' && c.debit_account_id === card).map((c) => c.id));
    set(giro, costs.map((v, m) => round2(v - revenues[m])));
  }

  const addebito = rule('card_addebito');
  if (addebito) {
    const g = giro ? fin.get(giro.id) : zeros();
    set(addebito, g.map((_, m) => (m === 0 ? opening(addebito.debit_account_id) : g[m - 1])));
  }
}

// ---------------------------------------------------------------------
// Riepilogo annuale, imprevisti, scostamenti, Var suggerite
// ---------------------------------------------------------------------

export function budgetSummary({ accounts, target, months = [] }, budget) {
  const yearOf = (list) => round2(list.reduce((t, a) => t + sum(get(budget.econ, a.id)), 0));
  const costs = economics(accounts, 'costo');
  const ricavi = yearOf(economics(accounts, 'ricavo'));
  const costiEsclusi = yearOf(costs.filter((a) => !a.is_contingency));
  const imprevisti = yearOf(costs.filter((a) => a.is_contingency));
  const lordo = round2(ricavi - costiEsclusi);
  const t = Number(target || 0);
  const spendibile = round2(lordo - t);
  const openMonths = 12 - months.filter((m) => m.closed).length;
  return {
    ricavi, costiEsclusi, lordo, target: t, spendibile,
    // quota dei mesi non chiusi (l'ultimo può differire di qualche centesimo)
    quotaMensile: openMonths ? round2(spendibile / openMonths) : 0,
    openMonths,
    targetRaggiungibile: spendibile >= 0,
    imprevisti,
    costiConImprevisti: round2(costiEsclusi + imprevisti),
    netto: round2(ricavi - costiEsclusi - imprevisti)
  };
}

// Imprevisti ("Spese indivise non preventivate"): voce residuale, sempre calcolata.
// Totale annuo = ricavi − costi esclusi imprevisti − target (tutto a budget).
// I mesi chiusi valgono 0: lì budget e Progr. coincidono e gli imprevisti non hanno movimenti reali.
// Il residuo si divide in parti uguali sui mesi non chiusi (resto dell'arrotondamento sull'ultimo)
// e si ricalcola a ogni modifica del budget. Se è negativo resta negativo: il target non è raggiungibile.
export function contingencyPlan(econ, accounts, target, months = []) {
  const yearOf = (list) => list.reduce((t, a) => t + sum(get(econ, a.id)), 0);
  const residual = round2(yearOf(economics(accounts, 'ricavo'))
    - yearOf(economics(accounts, 'costo').filter((a) => !a.is_contingency)) - Number(target || 0));
  const closed = new Set(months.filter((m) => m.closed).map((m) => m.month - 1));
  return { residual, plan: spreadTotal(zeros(), residual, closed), openMonths: 12 - closed.size };
}

// Ripartisce un totale annuo: i mesi bloccati (indici 0–11) tengono il loro valore,
// gli altri ricevono la quota arrotondata e l'ultimo di loro il resto, così il totale torna esatto.
export function spreadTotal(current, total, locked = new Set()) {
  const open = current.map((_, m) => m).filter((m) => !locked.has(m));
  if (!open.length) return [...current];
  const available = round2(total - sum(current.filter((_, m) => locked.has(m))));
  const quota = round2(available / open.length);
  const plan = current.map((v, m) => (locked.has(m) ? v : quota));
  plan[open.at(-1)] = round2(available - quota * (open.length - 1));
  return plan;
}

// Scostamento positivo = favorevole: ricavi Progr. − Budget; costi e causali finanziarie Budget − Progr.
export function variance(kind, budget, actual) {
  return round2(kind === 'ricavo' ? actual - budget : budget - actual);
}

// Var +/- suggerite dagli Alert del Giornale (come suggest_channel_adjustments in SQL):
// l'importo si sposta dal canale standard della voce al canale realmente usato.
export function suggestAdjustments({ year, accounts, causali, entries }) {
  const account = new Map(accounts.map((a) => [a.id, a]));
  const causale = new Map(causali.map((c) => [c.id, c]));
  const out = new Map();
  for (const e of entries) {
    if (+e.entry_date.slice(0, 4) !== year) continue;
    const c = causale.get(e.causale_id);
    const a = account.get(c?.kind === 'ricavo' ? e.credit_account_id : e.debit_account_id);
    if (!channelAlert(c, a)) continue;
    const m = +e.entry_date.slice(5, 7) - 1;
    add(out, c.id, m, Number(e.amount));
    add(out, a.standard_causale_id, m, -Number(e.amount));
  }
  return roundAll(out);
}

// Var ancora da allineare: mese e canale dove la Var salvata differisce da quella suggerita
export function adjustmentsToAlign(suggested, saved) {
  const out = [];
  for (const id of new Set([...suggested.keys(), ...saved.keys()])) {
    const s = get(suggested, id);
    const v = get(saved, id);
    for (let m = 0; m < 12; m++) {
      if (round2(s[m]) !== round2(v[m])) out.push({ month: m + 1, causale_id: id, suggested: s[m], saved: v[m] });
    }
  }
  return out.sort((a, b) => a.month - b.month);
}
