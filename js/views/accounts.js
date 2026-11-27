// Partitario (schede conto): per ogni conto, patrimoniale o economico, i movimenti reali di tutto l'anno con il
// saldo progressivo; per i conti patrimoniali sotto c'è il riepilogo mese per mese (saldo iniziale, variazioni
// per causale e saldo finale, con Budget, Progr. e Scost.).
import { h, noYear } from '../ui.js';
import { loadYear, yearList, pickYear, loadProvisional } from '../data.js';
import { computeActual, computeBudget } from '../engine/year.js';
import { currentMonth } from '../budget-model.js';
import { cardRows, accountLedger, sides } from '../accounts-model.js';
import { GROUPS, sortByOrder } from '../settings-model.js';
import { loadExpanded, saveExpanded, readGrid } from '../grid.js';
import { MONTHS, fmtAmount, fmtDay, isoDate, round2 } from '../format.js';
import { monthParam } from '../journal-model.js';

let S = null;

export async function render(root, { params }) {
  const years = await yearList();
  if (!years.length) return noYear(root, 'Partitario');
  const year = pickYear(years, params[0], +isoDate().slice(0, 4));
  // i movimenti provvisori non sono nei dati dell'anno: si leggono a parte, solo per mostrarli
  const [data, provisional] = await Promise.all([loadYear(year), loadProvisional(year)]);
  const patrimonial = sortByOrder(data.accounts.filter((a) => a.type === 'patrimoniale'));
  const economic = sortByOrder(data.accounts.filter((a) => a.type === 'economico'));
  const accounts = [...patrimonial, ...economic];
  const id = decodeURIComponent(params[1] || '');
  const account = accounts.find((a) => a.id === id) ?? patrimonial.find((a) => a.active) ?? accounts[0];
  if (!account) {
    root.replaceChildren(h('p', null, 'Non ci sono conti: aggiungili nelle ', h('a', { href: '#/impostazioni' }, 'Impostazioni'), '.'));
    return;
  }
  const cur = currentMonth(data.months);
  S = {
    root, years, data, accounts, account, cur,
    result: { actual: computeActual(data), budget: computeBudget(data) },
    expanded: loadExpanded(year, cur),
    showZero: false,
    provisional,
    showProv: loadShowProv()
  };
  draw();
}

// La scelta "mostra i provvisori" si ricorda nel browser
function loadShowProv() {
  try { return localStorage.getItem('partitario.provvisori') === '1'; } catch { return false; }
}
function saveShowProv(on) {
  try { localStorage.setItem('partitario.provvisori', on ? '1' : '0'); } catch { /* ignorato */ }
}

const href = (year, account) => '#/partitario/' + year + '/' + encodeURIComponent(account.id);
const label = (a) => a.name + (a.active ? '' : ' (disattivato)');
const yearSum = (s) => round2((s ?? []).reduce((t, v) => t + v, 0));

function draw() {
  const { data, account, result } = S;
  const patrimonial = account.type === 'patrimoniale';
  const closed = new Set(data.months.filter((m) => m.closed).map((m) => m.month - 1));
  const wrap = S.root.querySelector('.grid-wrap');
  const scroll = wrap ? [wrap.scrollLeft, wrap.scrollTop] : null;

  const option = (a) => h('option', { value: a.id, selected: a.id === account.id }, label(a));
  const group = (text, items) => (items.length ? h('optgroup', { label: text }, items.map(option)) : null);
  const economic = S.accounts.filter((a) => a.type === 'economico');
  const picker = h('select', { id: 'card-account', 'aria-label': 'Conto' },
    GROUPS.map((g) => group(g.label, S.accounts.filter((a) => a.type === 'patrimoniale' && a.grp === g.value))),
    group('Ricavi', economic.filter((a) => a.kind === 'ricavo')),
    group('Costi', economic.filter((a) => a.kind === 'costo')));
  picker.addEventListener('change', () => { location.hash = href(data.year, { id: picker.value }); });

  const showZero = h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: S.showZero });
  showZero.addEventListener('change', () => { S.showZero = showZero.checked; draw(); });
  // interruttore dei provvisori: vale per i movimenti qui sotto
  const count = S.provisional.filter((e) => e.debit_account_id === account.id || e.credit_account_id === account.id).length;
  const prov = h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: S.showProv });
  prov.addEventListener('change', () => { S.showProv = prov.checked; saveShowProv(prov.checked); draw(); });

  const m = S.cur - 1;
  let summary;
  if (patrimonial) {
    const closing = result.actual.closing.get(account.id)[m];
    const planned = result.budget.closing.get(account.id)[m];
    summary = h('ul', { class: 'checks' },
      h('li', { class: closing < 0 ? 'warn' : 'ok' },
        `Saldo a fine ${MONTHS[m]}: ${fmtAmount(closing)} € (budget ${fmtAmount(planned)} €)`),
      h('li', { class: 'ok' }, account.side === 'passivo' ? 'Conto passivo: un debito è positivo.' : 'Conto attivo.'));
  } else {
    const actual = yearSum(result.actual.econ.get(account.id));
    const planned = yearSum(result.budget.econ.get(account.id));
    summary = h('ul', { class: 'checks' },
      h('li', { class: 'ok' }, `${account.kind === 'ricavo' ? 'Ricavi' : 'Costi'} dell'anno: ${fmtAmount(actual)} € (budget dell'anno ${fmtAmount(planned)} €)`));
  }

  // riepilogo per mese, solo per i conti patrimoniali
  let grid = null;
  if (patrimonial) {
    const rows = cardRows(data, result, account.id, { showZero: S.showZero });
    grid = h('section', { class: 'card-summary', 'aria-labelledby': 'summary-title' },
      h('h2', { id: 'summary-title' }, 'Riepilogo per mese'),
      h('div', { class: 'grid-wrap' }, readGrid({ rows, expanded: S.expanded, cur: S.cur, closed, label: account.name,
        onToggle: (mm) => {
          if (S.expanded.has(mm)) S.expanded.delete(mm); else S.expanded.add(mm);
          saveExpanded(data.year, S.expanded);
          draw();
        } })));
  }

  S.root.replaceChildren(h('div', { class: 'budget' },
    h('div', { class: 'budget-head' },
      h('h1', null, 'Partitario ' + data.year),
      S.years.length > 1 && h('nav', { class: 'tabs', 'aria-label': 'Anni' },
        S.years.map((y) => h('a', { href: href(y, account), 'aria-current': y === data.year ? 'page' : null }, y))),
      picker,
      h('div', { class: 'head-checks' },
        patrimonial && h('label', { class: 'check' }, showZero, ' Mostra anche le causali senza movimenti'),
        h('label', { class: 'check' }, prov, ` Mostra i movimenti provvisori (${count} nell'anno)`))),
    summary,
    ledgerSection(),
    grid));

  if (scroll) {
    const w = S.root.querySelector('.grid-wrap');
    if (w) { w.scrollLeft = scroll[0]; w.scrollTop = scroll[1]; }
  }
}

// Movimenti reali di tutto l'anno, con saldo progressivo (per i conti economici: totale progressivo)
function ledgerSection() {
  const { data, account } = S;
  const s = sides(account);
  const patrimonial = account.type === 'patrimoniale';
  const { start, lines, end } = accountLedger(data, account.id, { provisional: S.showProv ? S.provisional : [] });
  const money = (v) => (v ? fmtAmount(v) : '');
  const bal = (v) => (v == null ? h('td') : h('td', { class: 'num' + (v < 0 ? ' neg' : '') }, fmtAmount(v)));
  // la data apre il Giornale del mese del movimento
  const day = (date) => h('a', { href: '#/giornale/' + monthParam({ year: data.year, month: +date.slice(5, 7) }),
                               title: 'Apri il mese nel Giornale' }, fmtDay(date));

  return h('section', { class: 'ledger', 'aria-labelledby': 'ledger-title' },
    h('div', { class: 'ledger-head' },
      h('h2', { id: 'ledger-title' }, 'Movimenti del ' + data.year)),
    S.showProv && h('p', { class: 'hint' }, 'I provvisori sono in lilla: non contano nei saldi, che restano quelli delle registrazioni confermate.'),
    h('div', { class: 'table-wrap ledger-wrap' },
      h('table', { class: 'list' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Data'), h('th', { scope: 'col' }, 'Contropartita'),
          h('th', { scope: 'col' }, 'Note'), h('th', { scope: 'col', class: 'num' }, s.plusLabel),
          h('th', { scope: 'col', class: 'num' }, s.minusLabel),
          h('th', { scope: 'col', class: 'num' }, patrimonial ? 'Saldo' : 'Progressivo'))),
        h('tbody', null,
          patrimonial && h('tr', { class: 'edge' }, h('td', { colspan: 5 }, 'Saldo iniziale'), bal(start)),
          lines.length
            ? lines.map((l) => h('tr', { class: l.provisional ? 'provisional' : null },
                h('td', null, day(l.date)), h('td', null, l.label),
                h('td', { class: 'muted' }, l.note, l.provisional && h('span', { class: 'badge prov' }, 'provvisorio')),
                h('td', { class: 'num' }, money(l.plus)),
                h('td', { class: 'num' }, money(l.minus)), bal(l.balance)))
            : h('tr', null, h('td', { colspan: 6, class: 'muted' }, 'Nessun movimento in quest\'anno.')),
          h('tr', { class: 'edge' }, h('td', { colspan: 5 }, patrimonial ? 'Saldo finale' : 'Totale dell\'anno'), bal(end))))));
}
