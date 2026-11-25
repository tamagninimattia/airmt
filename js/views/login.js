// Accesso con email e password (le registrazioni nuove sono disattivate su Supabase)
import { sb } from '../db.js';
import { h, busy } from '../ui.js';

export function render(root) {
  const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true });
  const password = h('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { type: 'submit' }, 'Accedi');

  const form = h('form', { class: 'narrow' },
    h('h1', null, 'Accedi'),
    h('p', { class: 'lede' }, 'Usa le credenziali del tuo utente Supabase.'),
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'Password'), password),
    submit);

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(submit, 'Accesso', async () => {
      const { error } = await sb.auth.signInWithPassword({
        email: email.value.trim(),
        password: password.value
      });
      if (error) throw error;
      // la vista successiva arriva da onAuthStateChange in app.js
    });
  });

  root.replaceChildren(form);
  email.focus();
}
