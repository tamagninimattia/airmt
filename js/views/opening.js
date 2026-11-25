// Apertura dell'anno: saldi iniziali dei conti patrimoniali e stato dell'anno (bozza / attivo)
import { sb, rows } from '../db.js';
import { h, say, clearMsg, confirmBox, busy } from '../ui.js';
import { GROUPS } from '../settings-model.js';
import { netWorth } from '../engine/balances.js';
import { fmtAmount, fmtEuro, parseAmount } from '../format.js';

const STATUS = { bozza: 'in bozza', attivo: 'attivo', chiuso: 'chiuso' };

export async function render(root, { session, params }) {
  const years = await rows(sb.from('years').select('year, status').order('year'));
  if (!years.length) {
    root.replaceChildren(h('div', { class: 'narrow' },
      h('h1', null, 'Apertura anno'),
      h('p', null, 'Non hai ancora creato nessun anno. ', h('a', { href: '#/avvio' }, 'Crealo dall\'Avvio'), '.')));
    return;
  }
  const chosen = years.find((y) => y.year === +params[0])
    ?? years.filter((y) => y.status === 'bozza').at(-1) ?? years.at(-1);
  const year = chosen.year;

  const [accounts, openings] = await Promise.all([
    rows(sb.from('accounts').select('*').eq('type', 'patrimoniale').order('sort_order')),
    rows(sb.from('opening_balances').select('account_id, amount').eq('year', year))
  ]);

  const saved = new Map(openings.map((o) => [o.account_id, Number(o.amount)]));
  const current = new Map(accounts.map((a) => [a.id, saved.get(a.id) ?? 0]));
  const editable = chosen.status === 'bozza';
  const inputs = new Map();

  const totals = { attivo: h('dd'), passivo: h('dd'), patrimonio: h('dd', { class: 'strong' }) };
  const save = h('button', { type: 'submit', disabled: true }, 'Salva saldi iniziali');
  const statusBtn = h('button', { type: 'button', class: 'quiet' });
  const statusHint = h('span', { class: 'hint', hidden: true }, 'Salva i saldi prima di attivare l\'anno.');

  // modifiche non ancora salvate: conti senza riga o con importo diverso
  const changed = () => accounts.filter((a) => !saved.has(a.id) || saved.get(a.id) !== current.get(a.id));

  function refresh() {
    const t = netWorth(accounts, current);
    totals.attivo.textContent = fmtEuro(t.attivo);
    totals.passivo.textContent = fmtEuro(t.passivo);
    totals.patrimonio.textContent = fmtEuro(t.patrimonio);
    const invalid = [...inputs.values()].some((i) => i.getAttribute('aria-invalid') === 'true');
    const dirty = changed().some((a) => saved.has(a.id) || current.get(a.id) !== 0);
    save.disabled = invalid || !dirty;
    statusBtn.disabled = editable && dirty;
    statusHint.hidden = !statusBtn.disabled;
  }

  function amountCell(a) {
    const value = current.get(a.id);
    if (!editable) return h('td', { class: 'num' + (value < 0 ? ' neg' : '') }, fmtAmount(value));
    const input = h('input', { class: 'amount', inputmode: 'decimal', autocomplete: 'off',
                               value: fmtAmount(value), 'aria-label': 'Saldo iniziale ' + a.name });
    input.addEventListener('input', () => {
      const n = parseAmount(input.value || '0');
      input.setAttribute('aria-invalid', String(Number.isNaN(n)));
      if (!Number.isNaN(n)) current.set(a.id, n);
      refresh();
    });
    input.addEventListener('blur', () => {
      if (input.getAttribute('aria-invalid') !== 'true') input.value = fmtAmount(current.get(a.id));
    });
    inputs.set(a.id, input);
    return h('td', { class: 'num' }, input);
  }

  const groups = GROUPS.map((g) => {
    const items = accounts.filter((a) => a.grp === g.value);
    return items.length ? [
      h('tr', { class: 'group-row' }, h('th', { colspan: 2, scope: 'colgroup' }, g.label + ' · ' + g.side)),
      items.map((a) => h('tr', { class: a.active ? null : 'inactive' },
        h('td', null, a.name), amountCell(a)))
    ] : null;
  });

  const form = h('form', { class: 'opening' },
    h('div', { class: 'table-wrap' },
      h('table', { class: 'list' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Conto'), h('th', { scope: 'col', class: 'num' }, 'Saldo al 1/1/' + year))),
        h('tbody', null, groups))),
    h('dl', { class: 'totals' },
      h('dt', null, 'Totale attivo'), totals.attivo,
      h('dt', null, 'Totale passivo'), totals.passivo,
      h('dt', null, 'Patrimonio iniziale'), totals.patrimonio),
    editable && h('div', { class: 'actions' }, save));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    // le righe mancanti (conti aggiunti dopo la creazione dell'anno) si creano qui
    const upserts = changed().map((a) => ({
      user_id: session.user.id, year, account_id: a.id, amount: current.get(a.id)
    }));
    busy(save, 'Salvataggio dei saldi', async () => {
      await rows(sb.from('opening_balances').upsert(upserts, { onConflict: 'user_id,year,account_id' }));
      for (const u of upserts) saved.set(u.account_id, u.amount);
      say('Saldi iniziali salvati.');
    }).then(refresh);
  });

  // bozza <-> attivo; un anno chiuso si gestirà con la chiusura dell'anno
  const next = { bozza: 'attivo', attivo: 'bozza' }[chosen.status];
  statusBtn.textContent = next === 'attivo' ? 'Attiva anno' : 'Riporta in bozza';
  statusBtn.addEventListener('click', async () => {
    const ok = await confirmBox(next === 'attivo'
      ? { title: 'Attivare il ' + year + '?',
          lines: ['I saldi iniziali non saranno più modificabili.', 'Se serve, potrai riportare l\'anno in bozza.'],
          ok: 'Attiva anno' }
      : { title: 'Riportare il ' + year + ' in bozza?',
          lines: ['I saldi iniziali torneranno modificabili. Le registrazioni e il budget non cambiano.'],
          ok: 'Riporta in bozza' });
    if (!ok) return;
    busy(statusBtn, 'Cambio di stato dell\'anno', async () => {
      await rows(sb.from('years').update({ status: next }).eq('year', year));
      await render(root, { session, params: [String(year)] });
      say(next === 'attivo' ? 'Anno ' + year + ' attivato.' : 'Anno ' + year + ' riportato in bozza.');
    });
  });

  clearMsg();
  root.replaceChildren(h('div', { class: 'narrow' },
    h('h1', null, 'Apertura anno'),
    years.length > 1 && h('nav', { class: 'tabs', 'aria-label': 'Anni' },
      years.map((y) => h('a', { href: '#/apertura/' + y.year, 'aria-current': y.year === year ? 'page' : null }, y.year))),
    h('p', { class: 'lede' },
      'Anno ' + year + ' ' + STATUS[chosen.status] + '. ',
      editable
        ? 'I saldi sono naturali: un debito si scrive positivo. Quando sono giusti, attiva l\'anno.'
        : 'I saldi iniziali sono bloccati. Per correggerli riporta l\'anno in bozza.'),
    form,
    next && h('div', { class: 'actions status' }, statusBtn, statusHint)));
  refresh();
}
