// Avvio: caricamento del piano dei conti, creazione dell'anno e riepilogo dei dati presenti
import { sb, rows, countRows } from '../db.js';
import { h, say, busy } from '../ui.js';

function step(n, title, state, ...body) {
  return h('li', { class: 'step ' + state },
    h('span', { class: 'marker', 'aria-hidden': 'true' }, state === 'done' ? '✓' : n),
    h('h2', null, title),
    ...body);
}

export async function render(root) {
  const [pat, eco, cau, open, years] = await Promise.all([
    countRows('accounts', (q) => q.eq('type', 'patrimoniale')),
    countRows('accounts', (q) => q.eq('type', 'economico')),
    countRows('causali'),
    countRows('opening_balances'),
    rows(sb.from('years').select('year, status').order('year'))
  ]);
  const hasChart = pat + eco > 0;
  const rerender = () => render(root);

  const btnSeed = h('button', { type: 'button', disabled: hasChart }, 'Carica piano dei conti');
  btnSeed.addEventListener('click', () =>
    busy(btnSeed, 'Caricamento del piano dei conti', async () => {
      const { data, error } = await sb.rpc('seed_default_chart');
      if (error) throw error;
      await rerender();
      say(data);
    }));

  const year = h('input', { id: 'year', type: 'number', min: 2000, max: 2100, value: 2027 });
  const btnYear = h('button', { type: 'button', disabled: !hasChart }, 'Crea anno');
  btnYear.addEventListener('click', () =>
    busy(btnYear, 'Creazione dell\'anno', async () => {
      const y = parseInt(year.value, 10);
      if (!y) throw new Error('inserisci un anno valido');
      const { data, error } = await sb.rpc('init_year', { p_year: y });
      if (error) throw error;
      await rerender();
      say(data);
    }));

  root.replaceChildren(h('div', { class: 'narrow' },
    h('h1', null, 'Avvio'),
    h('p', { class: 'lede' }, 'Prepara i dati di base. Ogni passo si fa una volta sola.'),
    h('ol', { class: 'steps' },
      step(1, 'Carica il piano dei conti', hasChart ? 'done' : 'current',
        h('p', null, 'Inserisce i conti patrimoniali ed economici e le causali del tuo file Excel.'),
        btnSeed),
      step(2, 'Crea l\'anno', !hasChart ? 'locked' : years.length ? 'done' : 'current',
        h('p', null, 'Prepara i 12 mesi e i saldi iniziali. Se esiste l\'anno precedente, parte dai suoi saldi finali.'),
        h('div', { class: 'row' },
          h('div', { class: 'field', style: 'margin:0' }, h('label', { for: 'year' }, 'Anno'), year),
          btnYear))),
    h('section', { class: 'state', 'aria-labelledby': 'state-title' },
      h('h2', { id: 'state-title' }, 'Dati presenti'),
      h('dl', null,
        h('dt', null, 'Conti patrimoniali'), h('dd', null, pat),
        h('dt', null, 'Conti economici'), h('dd', null, eco),
        h('dt', null, 'Causali'), h('dd', null, cau),
        h('dt', null, 'Anni'), h('dd', null, years.length
          ? years.map((y) => y.year + ' (' + y.status + ')').join(', ')
          : 'nessuno'),
        h('dt', null, 'Saldi iniziali'), h('dd', null, open)))));
}
