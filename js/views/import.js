// Importa da Excel (sotto-scheda di Impostazioni): file da trascinare, anteprima ed elenco delle importazioni
import { sb, rows } from '../db.js';
import { h } from '../ui.js';
import { importCard } from '../import-view.js';

export async function render(root) {
  const [accounts, causali] = await Promise.all([
    rows(sb.from('accounts').select('*')),
    rows(sb.from('causali').select('*'))
  ]);
  root.replaceChildren(h('div', { class: 'import-page' },
    h('h1', null, 'Importa da Excel'),
    // le registrazioni importate si vedono poi nel Giornale: qui non c'è altro da ricaricare
    importCard({ accounts, causali }, async () => {})));
}
