// Due grafici SVG semplici, senza librerie: linee (andamento nel tempo) e barre orizzontali
// (budget contro consuntivo per categoria). Colori dalla palette validata (blu/arancio:
// ΔE daltonici 24,7, contrasto ≥ 3:1 sul bianco); il budget è anche tratteggiato nel grafico
// a linee, così le serie si distinguono senza il colore. Legenda sempre presente, tooltip al passaggio.
import { h } from './ui.js';
import { fmtAmount, MONTHS } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
const SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

// Come h() di ui.js, per gli elementi SVG
function s(tag, attrs, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Importo intero con separatore delle migliaia, per assi ed etichette
const whole = (v) => fmtAmount(Math.round(v)).replace(/,00$/, '');

// Tre o quattro valori "tondi" che coprono [min, max]
function niceTicks(min, max, count = 4) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((k) => k >= raw);
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

function legend(items) {
  return h('ul', { class: 'legend' }, items.map((i) => h('li', null,
    h('span', { class: 'swatch ' + i.cls, 'aria-hidden': 'true' }), i.label)));
}

// Riquadro informativo che segue il puntatore dentro la figura
function tooltip(figure) {
  const tip = h('div', { class: 'chart-tip', role: 'status', hidden: true });
  figure.append(tip);
  return {
    show(html, x, y) {
      tip.replaceChildren(...html.filter(Boolean));
      tip.hidden = false;
      const box = figure.getBoundingClientRect();
      const left = Math.min(Math.max(x - box.left + 12, 0), box.width - tip.offsetWidth);
      tip.style.left = left + 'px';
      tip.style.top = Math.max(y - box.top - tip.offsetHeight - 10, 0) + 'px';
    },
    hide() { tip.hidden = true; }
  };
}

// Disegna l'SVG alla larghezza reale del riquadro (così il testo resta a 12px e non si
// rimpicciolisce) e lo ridisegna quando la larghezza cambia
function responsive(figure, draw) {
  const plot = h('div', { class: 'plot' });
  figure.append(plot);
  let width = 0;
  const redraw = (w) => {
    w = Math.max(280, Math.round(w));
    if (w === width) return;
    width = w;
    plot.replaceChildren(draw(w));
  };
  redraw(560);
  if (window.ResizeObserver) new ResizeObserver(([e]) => redraw(e.contentRect.width)).observe(plot);
}

/**
 * Andamento mensile di due serie (budget e consuntivo) con un punto d'arrivo.
 * budget, actual: 12 valori (actual può avere null nei mesi futuri); goal: { value, label }
 */
export function lineChart({ title, budget, actual, goal, caption }) {
  const values = [...budget, ...actual.filter((v) => v != null), goal?.value].filter((v) => v != null);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const y0 = ticks[0];
  const y1 = ticks.at(-1);
  const lastActual = actual.reduce((last, v, m) => (v != null ? m : last), -1);

  const figure = h('figure', { class: 'chart-box' },
    h('figcaption', null, h('strong', null, title), caption && h('span', { class: 'hint' }, caption)),
    legend([{ cls: 'actual', label: 'Consuntivo' }, { cls: 'budget dashed', label: 'Budget' },
            goal && { cls: 'goal', label: goal.label }].filter(Boolean)));
  const tip = tooltip(figure);

  responsive(figure, (W) => {
    const H = 240, L = 58, R = 16, T = 16, B = 28;
    const x = (m) => L + (m * (W - L - R)) / 11;
    const y = (v) => T + ((y1 - v) * (H - T - B)) / (y1 - y0 || 1);
    const path = (series) => series.map((v, m) => (v == null ? null : `${x(m)},${y(v)}`))
      .filter(Boolean).map((p, i) => (i ? 'L' : 'M') + p).join(' ');
    const band = (W - L - R) / 11;
    const every = band < 34 ? 2 : 1;   // sul telefono un mese sì e uno no

    const cross = s('line', { y1: T, y2: H - B, class: 'crosshair', visibility: 'hidden' });
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
                           'aria-label': `${title}: budget a dicembre ${whole(budget[11])} €` +
                             (lastActual >= 0 ? `, consuntivo a ${MONTHS[lastActual]} ${whole(actual[lastActual])} €` : '') +
                             (goal ? `, ${goal.label} ${whole(goal.value)} €` : '') },
      // griglia e assi, recessivi
      ticks.map((t) => s('g', null,
        s('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: 'grid-line' }),
        s('text', { x: L - 8, y: y(t) + 4, class: 'axis', 'text-anchor': 'end' }, whole(t)))),
      SHORT.map((label, m) => (m % every ? null
        : s('text', { x: x(m), y: H - 8, class: 'axis', 'text-anchor': 'middle' }, label))),
      // serie
      s('path', { d: path(budget), class: 'line budget' }),
      lastActual >= 0 && s('path', { d: path(actual), class: 'line actual' }),
      lastActual >= 0 && s('circle', { cx: x(lastActual), cy: y(actual[lastActual]), r: 5, class: 'dot actual' }),
      // traguardo a dicembre: etichetta sopra o sotto, dove non tocca la linea del budget
      goal && s('g', { class: 'goal' },
        s('line', { x1: x(11) - 10, x2: x(11) + 6, y1: y(goal.value), y2: y(goal.value) }),
        s('text', { x: x(11) - 14, y: y(goal.value) + (goal.value >= budget[10] ? -8 : 18), 'text-anchor': 'end' },
          `${goal.label} ${whole(goal.value)}`)),
      cross);

    // zone di passaggio per mese, più larghe dei segni
    SHORT.forEach((_, m) => {
      const hit = s('rect', { x: x(m) - band / 2, y: T, width: band, height: H - T - B, class: 'hit' });
      hit.addEventListener('pointerenter', (ev) => {
        cross.setAttribute('x1', x(m));
        cross.setAttribute('x2', x(m));
        cross.setAttribute('visibility', 'visible');
        tip.show([h('strong', null, MONTHS[m]),
          h('div', null, h('span', { class: 'swatch budget dashed' }), 'Budget ', fmtAmount(budget[m]), ' €'),
          actual[m] != null && h('div', null, h('span', { class: 'swatch actual' }), 'Consuntivo ', fmtAmount(actual[m]), ' €')],
          ev.clientX, ev.clientY);
      });
      hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hide(); });
      svg.append(hit);
    });
    return svg;
  });
  return figure;
}

/**
 * Barre orizzontali budget contro consuntivo per categoria, con lo scostamento a destra.
 * items: [{ label, budget, actual, variance }] — variance < 0 = sfavorevole
 */
export function barChart({ title, items, caption }) {
  const max = Math.max(1, ...items.flatMap((i) => [i.budget, i.actual]));
  const figure = h('figure', { class: 'chart-box' },
    h('figcaption', null, h('strong', null, title), caption && h('span', { class: 'hint' }, caption)),
    legend([{ cls: 'actual', label: 'Consuntivo' }, { cls: 'budget', label: 'Budget' }]));
  const tip = tooltip(figure);

  responsive(figure, (W) => {
    const L = W < 420 ? 112 : 150, R = 72, ROW = 38, BAR = 12, GAP = 2, T = 6;
    const H = T + items.length * ROW;
    const len = (v) => (Math.max(0, v) * (W - L - R)) / max;
    // barra con l'estremità dei dati arrotondata (4px) e la base squadrata
    const bar = (yTop, v, cls) => {
      const w = len(v);
      if (w <= 0) return null;
      const r = Math.min(4, w, BAR / 2);
      return s('path', { class: 'bar ' + cls,
        d: `M${L},${yTop} H${L + w - r} Q${L + w},${yTop} ${L + w},${yTop + r} V${yTop + BAR - r} Q${L + w},${yTop + BAR} ${L + w - r},${yTop + BAR} H${L} Z` });
    };
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
      'aria-label': title + ': ' + items.map((i) => `${i.label} budget ${whole(i.budget)}, consuntivo ${whole(i.actual)}`).join('; ') },
      s('line', { x1: L, x2: L, y1: 0, y2: H, class: 'baseline' }));

    items.forEach((i, k) => {
      const top = T + k * ROW;
      const over = i.variance < 0;
      const row = s('g', { class: 'bar-row' },
        s('text', { x: L - 8, y: top + BAR + 4, class: 'label', 'text-anchor': 'end' }, i.label),
        bar(top, i.budget, 'budget'),
        bar(top + BAR + GAP, i.actual, 'actual'),
        i.variance !== 0 && s('text', { x: W - 4, y: top + BAR + 4, 'text-anchor': 'end', class: 'delta' + (over ? ' over' : '') },
          (over ? '▲ ' : '+') + whole(i.variance)),
        s('rect', { x: 0, y: top - 4, width: W, height: ROW - 2, class: 'hit' }));
      row.addEventListener('pointerenter', (ev) => tip.show([
        h('strong', null, i.label),
        h('div', null, h('span', { class: 'swatch budget' }), 'Budget ', fmtAmount(i.budget), ' €'),
        h('div', null, h('span', { class: 'swatch actual' }), 'Consuntivo ', fmtAmount(i.actual), ' €'),
        h('div', null, over ? 'Sforato di ' + fmtAmount(-i.variance) + ' €'
          : i.variance > 0 ? 'Risparmio ' + fmtAmount(i.variance) + ' €' : 'In linea con il budget')],
        ev.clientX, ev.clientY));
      row.addEventListener('pointerleave', () => tip.hide());
      svg.append(row);
    });
    return svg;
  });
  return figure;
}
