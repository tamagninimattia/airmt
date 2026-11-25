// Aiuti per il DOM condivisi dalle viste.

export const $ = (id) => document.getElementById(id);

// Crea un elemento: h('button', { class: 'quiet', onclick: fn }, 'Salva').
// I figli si aggiungono prima degli attributi, così value funziona anche sui select.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'checked' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return el;
}

export function say(text, isError) {
  const el = $('msg');
  el.textContent = text;
  el.className = 'show' + (isError ? ' error' : '');
}

export function clearMsg() { $('msg').className = ''; }

// Disattiva il pulsante finché fn non termina; gli errori finiscono nel messaggio
export async function busy(button, label, fn) {
  button.disabled = true;
  clearMsg();
  try {
    await fn();
  } catch (e) {
    say(label + ' non riuscito: ' + e.message + '.', true);
  } finally {
    button.disabled = false;
  }
}

// Dialogo di conferma; restituisce true se l'utente conferma
export function confirmBox({ title, lines = [], ok = 'Conferma', danger = false }) {
  return new Promise((resolve) => {
    // finish rimuove subito il dialogo; l'evento close copre la chiusura con Esc
    const finish = (result) => { dlg.close(); dlg.remove(); resolve(result); };
    const dlg = h('dialog', { class: 'sheet small' },
      h('h2', null, title),
      lines.map((t) => h('p', null, t)),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: danger ? 'danger' : null, onclick: () => finish(true) }, ok),
        h('button', { type: 'button', class: 'quiet', onclick: () => finish(false) }, 'Annulla')));
    dlg.addEventListener('close', () => finish(false));
    document.body.append(dlg);
    dlg.showModal();
  });
}

// Pagina vuota quando non esiste ancora nessun anno
export function noYear(root, title) {
  root.replaceChildren(h('div', { class: 'narrow' }, h('h1', null, title),
    h('p', null, 'Non hai ancora creato nessun anno. ', h('a', { href: '#/avvio' }, 'Crea il primo anno'), '.')));
}
