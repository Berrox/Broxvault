import { el } from '../ui/dom.js';
import { generatePassword, entropyBits } from './generator.js';
import { strengthText } from '../core/strength.js';
export function generatorPanel({ useLabel, onUse }) {
  const o = { length: 20, lower: true, upper: true, digits: true, symbols: true };
  const out = el('output', { class: 'gen-out', 'aria-live': 'polite' }), info = el('p', { class: 'hint' }); let cur = '';
  const run = () => {
    try { cur = generatePassword(o); const b = entropyBits(o); out.textContent = cur; info.textContent = 'Geschätzt ca. ' + Math.round(b) + ' Bit · ' + strengthText(b); }
    catch (e) { cur = ''; out.textContent = ''; info.textContent = e.message; }
  };
  const chk = (key, label) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: o[key], onchange: (e) => { o[key] = e.target.checked; run(); } }), el('span', {}, label));
  const len = el('input', { type: 'number', min: '8', max: '128', value: '20', 'aria-label': 'Passwortlänge', onchange: (e) => { o.length = Math.min(128, Math.max(8, parseInt(e.target.value, 10) || 20)); e.target.value = String(o.length); run(); } });
  const panel = el('div', { class: 'card gen field' }, el('div', { class: 'row2' }, el('label', {}, 'Länge'), len),
    chk('upper', 'Großbuchstaben'), chk('lower', 'Kleinbuchstaben'), chk('digits', 'Zahlen'), chk('symbols', 'Sonderzeichen'),
    out, info, el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', onclick: run }, 'Neu erzeugen'),
      el('button', { type: 'button', class: 'btn primary', onclick: () => { if (cur) onUse(cur); } }, useLabel)));
  run(); return panel;
}
