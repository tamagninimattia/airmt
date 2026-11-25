// Avvio dell'app: sessione, navigazione a hash (#/vista/parametri) e viste
import { sb, configured, countRows } from './db.js';
import { $, h, say, clearMsg } from './ui.js';
import * as login from './views/login.js';
import * as setup from './views/setup.js';
import * as settings from './views/settings.js';
import * as opening from './views/opening.js';
import * as journal from './views/journal.js';
import * as budget from './views/budget.js';
import * as accounts from './views/accounts.js';
import * as position from './views/position.js';
import * as dashboard from './views/dashboard.js';
import * as closing from './views/closing.js';

const routes = { dashboard, giornale: journal, budget, schede: accounts, patrimonio: position, chiusure: closing, apertura: opening, avvio: setup, impostazioni: settings };
let session = null;

// Senza piano dei conti si parte dall'Avvio; altrimenti dalla Dashboard sugli schermi larghi
// e dal Giornale sul telefono
async function defaultRoute() {
  const n = await countRows('accounts');
  if (!n) return 'avvio';
  return window.matchMedia('(min-width: 900px)').matches ? 'dashboard' : 'giornale';
}

// Menu compatto sui telefoni: il pulsante apre e chiude l'elenco delle sezioni
function setMenu(open) {
  document.querySelector('header.top').classList.toggle('open', open);
  $('menu-btn').setAttribute('aria-expanded', String(open));
}

async function route() {
  clearMsg();
  const view = $('view');
  $('nav').hidden = !session;
  $('menu-btn').hidden = !session;
  setMenu(false);
  if (!session) {
    login.render(view);
    return;
  }
  $('who').textContent = session.user.email;

  const [name, ...params] = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (!routes[name]) {
      location.replace('#/' + await defaultRoute()); // fa scattare di nuovo route()
      return;
    }
    for (const a of document.querySelectorAll('#nav a[data-route]')) {
      if (a.dataset.route === name) {
        a.setAttribute('aria-current', 'page');
        $('menu-label').textContent = a.textContent;
      }
      else a.removeAttribute('aria-current');
    }
    await routes[name].render(view, { session, params });
  } catch (e) {
    view.replaceChildren();
    say('Non riesco a leggere i dati: ' + e.message + '. Controlla di aver eseguito lo script SQL.', true);
  }
}

if (!configured) {
  $('view').replaceChildren(h('p', { class: 'narrow' },
    'Mancano i dati del progetto. Apri ', h('code', null, 'index.html'), ', inserisci in ',
    h('code', null, 'APP_CONFIG'), ' l\'URL e la chiave anon di Project Settings → API e ricarica la pagina. ',
    'Usa solo la chiave pubblica (anon), mai la ', h('code', null, 'service_role'), '.'));
} else {
  window.addEventListener('hashchange', route);
  $('menu-btn').addEventListener('click', () => setMenu($('menu-btn').getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') setMenu(false); });
  $('nav').addEventListener('click', (ev) => { if (ev.target.closest('a')) setMenu(false); });

  $('btn-logout').addEventListener('click', async () => {
    const { error } = await sb.auth.signOut();
    if (error) say('Uscita non riuscita: ' + error.message + '.', true);
  });

  // Ridisegna solo quando cambia l'utente: i rinnovi del token non devono cancellare i form aperti
  sb.auth.onAuthStateChange((event, s) => {
    const changed = (s?.user?.id ?? null) !== (session?.user?.id ?? null);
    session = s;
    if (changed || event === 'INITIAL_SESSION') setTimeout(route, 0);
  });
}
