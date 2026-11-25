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

const routes = { dashboard, giornale: journal, budget, partitario: accounts, patrimonio: position,
                 chiusure: closing, apertura: opening, avvio: setup, impostazioni: settings };
let session = null;

// Senza piano dei conti si parte dall'Avvio; altrimenti dalla Dashboard sugli schermi larghi
// e dal Giornale sul telefono
async function defaultRoute() {
  const n = await countRows('accounts');
  if (!n) return 'avvio';
  return window.matchMedia('(min-width: 900px)').matches ? 'dashboard' : 'giornale';
}

// Logo animato del menu laterale (loop continuo: l'ultimo fotogramma si raccorda con il primo).
// Parte solo dove il menu è una colonna fissa (sul telefono il logo grande non si vede e il video
// non si scarica) e mai con "riduci movimento": lì resta il poster, che è il primo fotogramma.
function setupLogoVideo() {
  const v = $('logo-video');
  if (!v) return;
  const wide = window.matchMedia('(min-width: 56.01rem)');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');

  const sync = () => {
    if (wide.matches && !still.matches) {
      v.preload = 'auto';
      v.play().catch(() => {});   // se il browser blocca l'avvio resta il poster
    } else {
      v.pause();
    }
  };
  wide.addEventListener('change', sync);
  still.addEventListener('change', sync);
  sync();
}

// Sul telefono il menu laterale è un pannello che il pulsante ☰ apre e chiude
function setMenu(open) {
  document.body.classList.toggle('menu-open', open);
  $('menu-btn').setAttribute('aria-expanded', String(open));
}

async function route() {
  clearMsg();
  const view = $('view');
  $('side').hidden = !session;
  document.body.classList.toggle('auth', Boolean(session));   // con l'accesso compare il menu laterale
  $('menu-btn').hidden = !session;
  setMenu(false);
  if (!session) {
    login.render(view);
    return;
  }
  $('who').textContent = session.user.email;

  // #/vista/parametri?chiave=valore: la parte dopo ? arriva alla vista come query
  const [path, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, ...params] = path.split('/');
  const query = new URLSearchParams(qs);
  // indirizzo vecchio delle schede conto: si passa al Partitario con gli stessi parametri
  if (name === 'schede') {
    location.replace(['#/partitario', ...params].join('/'));
    return;
  }
  try {
    if (!routes[name]) {
      location.replace('#/' + await defaultRoute()); // fa scattare di nuovo route()
      return;
    }
    // Voce del menu da evidenziare: le Impostazioni hanno una voce per scheda (senza scheda è la prima);
    // l'Apertura anno non è nel menu, ci si arriva dalle Chiusure, che restano evidenziate
    const navName = name === 'impostazioni' ? 'impostazioni/' + (params[0] || 'patrimoniali')
      : name === 'apertura' ? 'chiusure' : name;
    for (const a of document.querySelectorAll('#nav a[data-route]')) {
      if (a.dataset.route === navName) {
        a.setAttribute('aria-current', 'page');
        $('menu-label').textContent = a.textContent.trim();
      }
      else a.removeAttribute('aria-current');
    }
    await routes[name].render(view, { session, params, query });
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
  setupLogoVideo();
  $('menu-btn').addEventListener('click', () => setMenu($('menu-btn').getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') setMenu(false); });
  $('side').addEventListener('click', (ev) => { if (ev.target.closest('a')) setMenu(false); });

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
