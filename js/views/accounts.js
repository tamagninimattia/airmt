// Partitario (schede conto): per ogni conto patrimoniale, saldo iniziale, variazioni per causale e saldo finale
// mese per mese (Budget, Progr., Scost.), più i movimenti reali di un mese con il saldo progressivo.
import { h, noYear } from '../ui.js';
import { loadYear, yearList, pickYear, loadProvisional } from '../data.js';
import { computeActual, computeBudget } from '../engine/year.js';
import { currentMonth } from '../budget-model.js';
import { cardRows, accountLedger, sides } from '../accounts-model.js';
import { GROUPS, sortByOrder } from '../settings-model.js';
import { loadExpanded, saveExpanded, readGrid } from '../grid.js';
import { MONTHS, fmtAmount, fmtDay, isoDate } from '../format.js';
import { monthParam } from '../journal-model.js';

let S = null;

export async function render(root, { params }) {
  const years = await yearList();
  if (!years.length) return noYear(root, 'Partitario');
  const year = pickYear(years, params[0], +isoDate().slice(0, 4));
  // i movimenti provvisori non sono nei dati dell'anno: si leggono a parte, solo per mostrarli
  const [data, provisional] = await Promise.all([loadYear(year), loadProvisional(year)]);
  const accounts = sortByOrder(data.accounts.filter((a) => a.type === 'patrimoniale'));
  const id = decodeURIComponent(params[1] || '');
  const account = accounts.find((a) => a.id === id) ?? accounts.find((a) => a.active) ?? accounts[0];
  if (!account) {
    root.replaceChildren(h('p', null, 'Non ci sono conti patrimoniali: aggiungili nelle ', h('a', { href: '#/impostazioni' }, 'Impostazioni'), '.'));
    return;
  }
  const cur = currentMonth(data.months);
  S = {
    root, years, data, accounts, account, cur,
    result: { actual: computeActual(data), budget: computeBudget(data) },
    expanded: loadExpanded(year, cur),
    showZero: false,
    month: cur,
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

function draw() {
  const { data, account, result } = S;
  const closed = new Set(data.months.filter((m) => m.closed).map((m) => m.month - 1));
  const wrap = S.root.querySelector('.grid-wrap');
  const scroll = wrap ? [wrap.scrollLeft, wrap.scrollTop] : null;

  const picker = h('select', { id: 'card-account', 'aria-label': 'Conto' },
    GROUPS.map((g) => {
      const items = S.accounts.filter((a) => a.grp === g.value);
      return items.length ? h('optgroup', { label: g.label },
        items.map((a) => h('option', { value: a.id, selected: a.id === account.id }, a.name + (a.active ? '' : ' (disattivato)')))) : null;
    }));
  picker.addEventListener('change', () => { location.hash = href(data.year, { id: picker.value }); });

  const showZero = h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: S.showZero });
  showZero.addEventListener('change', () => { S.showZero = showZero.checked; draw(); });
  // interruttore dei provvisori: vale per i movimenti del mese qui sotto
  const count = S.provisional.filter((e) => e.debit_account_id === account.id || e.credit_account_id === account.id).length;
  const prov = h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: S.showProv });
  prov.addEventListener('change', () => { S.showProv = prov.checked; saveShowProv(prov.checked); draw(); });

  const rows = cardRows(data, result, account.id, { showZero: S.showZero });
  const grid = readGrid({ rows, expanded: S.expanded, cur: S.cur, closed, label: account.name,
    onToggle: (m) => {
      if (S.expanded.has(m)) S.expanded.delete(m); else S.expanded.add(m);
      saveExpanded(data.year, S.expanded);
      draw();
    } });

  const m = S.cur - 1;
  const closing = result.actual.closing.get(account.id)[m];
  const planned = result.budget.closing.get(account.id)[m];

  S.root.replaceChildren(h('div', { class: 'budget' },
    h('div', { class: 'budget-head' },
      h('h1', null, 'Partitario ' + data.year),
      S.years.length > 1 && h('nav', { class: 'tabs', 'aria-label': 'Anni' },
        S.years.map((y) => h('a', { href: href(y, account), 'aria-current': y === data.year ? 'page' : null }, y))),
      picker,
      h('div', { class: 'head-checks' },
        h('label', { class: 'check' }, showZero, ' Mostra anche le causali senza movimenti'),
        h('label', { class: 'check' }, prov, ` Mostra i movimenti provvisori (${count} nell'anno)`))),
    h('ul', { class: 'checks' },
      h('li', { class: closing < 0 ? 'warn' : 'ok' },
        `Saldo a fine ${MONTHS[m]}: ${fmtAmount(closing)} € (budget ${fmtAmount(planned)} €)`),
      h('li', { class: 'ok' }, account.side === 'passivo' ? 'Conto passivo: un debito è positivo.' : 'Conto attivo.')),
    h('div', { class: 'grid-wrap' }, grid),
    ledgerSection()));

  if (scroll) {
    const w = S.root.querySelector('.grid-wrap');
    w.scrollLeft = scroll[0];
    w.scrollTop = scroll[1];
  }
}

// Movimenti reali del mese scelto, con saldo progressivo
function ledgerSection() {
  const { data, account, result } = S;
  const s = sides(account);
  const { start, lines, end } = accountLedger(data, result.actual, account.id, S.month,
    { provisional: S.showProv ? S.provisional : [] });
  const move = (d) => { S.month = Math.min(12, Math.max(1, S.month + d)); draw(); };
  const money = (v) => (v ? fmtAmount(v) : '');
  const bal = (v) => (v == null ? h('td') : h('td', { class: 'num' + (v < 0 ? ' neg' : '') }, fmtAmount(v)));

  return h('section', { class: 'ledger', 'aria-labelledby': 'ledger-title' },
    h('div', { class: 'ledger-head' },
      h('h2', { id: 'ledger-title' }, 'Movimenti di ' + MONTHS[S.month - 1]),
      h('div', { class: 'month-nav' },
        h('button', { type: 'button', class: 'quiet small', disabled: S.month === 1, onclick: () => move(-1), 'aria-label': 'Mese precedente' }, '‹'),
        h('button', { type: 'button', class: 'quiet small', disabled: S.month === 12, onclick: () => move(1), 'aria-label': 'Mese successivo' }, '›')),
      h('a', { href: '#/giornale/' + monthParam({ year: data.year, month: S.month }) }, 'Apri nel Giornale')),
    S.showProv && h('p', { class: 'hint' }, 'I provvisori sono in lilla: non contano nei saldi, che restano quelli delle registrazioni confermate.'),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'list' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Data'), h('th', { scope: 'col' }, 'Causale'), h('th', { scope: 'col' }, 'Contropartita'),
          h('th', { scope: 'col' }, 'Note'), h('th', { scope: 'col', class: 'num' }, s.plusLabel),
          h('th', { scope: 'col', class: 'num' }, s.minusLabel), h('th', { scope: 'col', class: 'num' }, 'Saldo'))),
        h('tbody', null,
          h('tr', { class: 'edge' }, h('td', { colspan: 6 }, 'Saldo iniziale'), bal(start)),
          lines.length
            ? lines.map((l) => h('tr', { class: l.provisional ? 'provisional' : null },
                h('td', null, fmtDay(l.date)), h('td', null, h('code', null, l.code)), h('td', null, l.label),
                h('td', { class: 'muted' }, l.note, l.provisional && h('span', { class: 'badge prov' }, 'provvisorio')),
                h('td', { class: 'num' }, money(l.plus)),
                h('td', { class: 'num' }, money(l.minus)), bal(l.balance)))
            : h('tr', null, h('td', { colspan: 7, class: 'muted' }, 'Nessun movimento in questo mese.')),
          h('tr', { class: 'edge' }, h('td', { colspan: 6 }, 'Saldo finale'), bal(end))))));
}
