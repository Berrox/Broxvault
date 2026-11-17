import { el, icon } from './dom.js';
import { logo } from './sections.js';
import { estimateBits, strengthText } from '../core/strength.js';
import { openBackup, verifyBackup, inspectStructure } from '../backup/reader.js';
import { applyBackup, sessionTarget } from '../backup/restore.js';
import { WrongBackupPasswordError } from '../backup/format.js';
import { withBusy } from '../pwa/busy.js';
import { isIOS, isStandalone } from '../pwa/install.js';
import { createVault, unlock, WrongPasswordError, WeakPasswordError, MIN_PASSWORD_LENGTH } from '../core/keys/vault.js';

const paint = () => new Promise((r) => setTimeout(r, 60)); // Statusmeldung zeichnen, bevor die Schlüsselableitung rechnet
const brand = () => el('div', { class: 'brand' }, icon(logo), el('span', {}, 'BROX VAULT'));
const card = (...kids) => el('div', { class: 'gate' }, el('div', { class: 'card gate-card' }, brand(), ...kids));

function pwField(label, id, autocomplete) {
  const input = el('input', { id, type: 'password', autocomplete, autocapitalize: 'off', spellcheck: 'false' });
  const toggle = el('button', { type: 'button', class: 'btn small', 'aria-label': 'Passwort anzeigen oder verbergen', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; } }, 'Anzeigen');
  toggle.addEventListener('click', () => { toggle.textContent = input.type === 'password' ? 'Anzeigen' : 'Verbergen'; });
  return { input, node: el('div', { class: 'field' }, el('label', { for: id }, label), el('div', { class: 'pw' }, input, toggle)) };
}
const strength = (p) => strengthText(estimateBits(p));

export function showFatal(root) {
  root.replaceChildren(card(el('h1', {}, 'Tresor kann nicht geöffnet werden'),
    el('p', { class: 'lead' }, 'Die lokale Datenbank ließ sich nicht lesen. Es wurde nichts gelöscht und nichts neu angelegt. Schließe andere Tabs von BROX VAULT, lade die Seite neu und melde dich, falls das Problem bleibt, bevor du etwas an den Browserdaten änderst.')));
}

export function showUnlock(root, store, onDone) {
  const pw = pwField('Master-Passwort', 'pw', 'current-password');
  const msg = el('p', { class: 'msg', role: 'alert' });
  const go = el('button', { type: 'button', class: 'btn primary' }, 'Entsperren');
  const submit = async () => {
    if (!pw.input.value) return;
    go.disabled = true; msg.textContent = 'Schlüssel wird abgeleitet … das kann einige Sekunden dauern.'; await paint();
    try { await unlock(pw.input.value, store); pw.input.value = ''; onDone(); }
    catch (e) { msg.textContent = e instanceof WrongPasswordError ? e.message : 'Entsperren fehlgeschlagen.'; go.disabled = false; }
  };
  go.addEventListener('click', submit);
  pw.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  root.replaceChildren(card(el('h1', {}, 'Tresor entsperren'), pw.node, msg, go));
  pw.input.focus();
}

export function showSetup(root, store, onDone, ctx = null) {
  const show = (...kids) => root.replaceChildren(card(...kids));
  const next = (label, fn, cls = 'btn primary') => el('button', { type: 'button', class: cls, onclick: fn }, label);

  // Neues Gerät oder Browser-Reset: Backup prüfen (Stufe 2), erst DANN den Tresor mit neuem Master-Passwort anlegen und einspielen.
  const restore = () => {
    let file = null; const msg = el('p', { class: 'msg', role: 'alert' }), info = el('p', { class: 'hint' });
    const f = el('input', { type: 'file', accept: '.bvx,application/octet-stream', 'aria-label': 'Backup-Datei', onchange: async (e) => { file = e.target.files && e.target.files[0]; info.textContent = ''; msg.textContent = ''; if (!file) return; try { const s = await inspectStructure(file); info.textContent = 'Dateistruktur geprüft: Format ' + s.version + ', ' + s.frames + ' Teile.'; } catch (err) { file = null; msg.textContent = err.message; } } });
    const bp = pwField('Backup-Passwort', 'rp0', 'off'), a = pwField('Neues Master-Passwort', 'rp1', 'new-password'), b = pwField('Neues Master-Passwort wiederholen', 'rp2', 'new-password');
    const go = next('Wiederherstellen', () => withBusy(async () => {
      msg.textContent = '';
      if (!file) { msg.textContent = 'Bitte wähle eine Backup-Datei.'; return; }
      if (a.input.value !== b.input.value) { msg.textContent = 'Die beiden Master-Passwörter stimmen nicht überein.'; return; }
      if ([...a.input.value.normalize('NFKC')].length < MIN_PASSWORD_LENGTH) { msg.textContent = 'Das Master-Passwort muss mindestens ' + MIN_PASSWORD_LENGTH + ' Zeichen lang sein.'; return; }
      go.disabled = true; msg.textContent = 'Backup wird geprüft … das kann einige Sekunden dauern.'; await paint();
      try {
        const v = await verifyBackup(await openBackup(file, bp.input.value)); msg.textContent = 'Tresor wird angelegt und Backup eingespielt …'; await paint();
        try { await createVault(a.input.value, store); } catch (e) { throw new Error(e instanceof WeakPasswordError ? e.message : 'Der Tresor konnte nicht angelegt werden: ' + e.message); }
        try { await applyBackup(sessionTarget(ctx), await openBackup(file, bp.input.value), { policy: 'keep' }); }
        catch (e) { show(el('h1', {}, 'Tresor angelegt, Wiederherstellung unvollständig'), el('p', {}, e.message + ' Dein neuer Tresor existiert. Melde dich an und importiere das Backup unter „Speicher & Backups“ erneut.'), next('Tresor öffnen', onDone)); return; }
        bp.input.value = a.input.value = b.input.value = '';
        show(el('h1', {}, 'Wiederherstellung abgeschlossen'), el('p', {}, v.records + ' Datensätze und ' + v.chunks + ' Datei-Chunks wurden eingespielt.'), el('p', { class: 'hint' }, 'Tipp: Starte unter „Speicher & Backups“ die Integritätsprüfung und erstelle bald ein frisches Backup.'), next('Tresor öffnen', onDone));
      } catch (e) { msg.textContent = e instanceof WrongBackupPasswordError ? e.message : (e.message || 'Wiederherstellung fehlgeschlagen.'); go.disabled = false; }
    }));
    show(el('h1', {}, 'Aus Backup wiederherstellen'), el('div', { class: 'field' }, el('label', {}, 'Backup-Datei (.bvx)'), f), info, bp.node, a.node, b.node, msg, go, next('Zurück', welcome, 'btn'));
  };
  const welcome = () => show(el('h1', {}, 'Willkommen bei BROX VAULT'),
    el('p', { class: 'lead' }, 'Ein privater Tresor für Passwörter, Dokumente, Fotos und Notizen. Er gehört nur dir.'), next('Weiter', local),
    ctx ? next('Aus Backup wiederherstellen (.bvx)', restore, 'btn') : null);
  const local = () => show(el('h1', {}, 'Alles bleibt auf diesem Gerät'),
    el('p', {}, 'Deine Daten werden verschlüsselt in diesem Browser gespeichert. Es gibt kein Konto, keinen Server und keine Cloud.'),
    el('p', {}, 'Es gibt auch keine Passwort-Wiederherstellung. Wer das Master-Passwort nicht kennt, kommt nicht an die Daten, auch wir nicht.'),
    isIOS() && !isStandalone() ? el('p', { class: 'notice' }, 'iPhone-Tipp: Installiere BROX VAULT zuerst über „Teilen“ → „Zum Home-Bildschirm“ und lege den Tresor in der installierten App an. Nach meinem Kenntnisstand sind die Daten von Safari und von der installierten App getrennt, ein Tresor aus dem Safari-Tab ist in der App nicht sichtbar.') : null,
    next('Weiter', password));
  const password = () => {
    const a = pwField('Master-Passwort', 'pw1', 'new-password'), b = pwField('Master-Passwort wiederholen', 'pw2', 'new-password');
    const hint = el('p', { class: 'hint' }, 'Mindestens ' + MIN_PASSWORD_LENGTH + ' Zeichen. Eine lange Passphrase aus mehreren Wörtern ist gut zu merken und schwer zu erraten.');
    const msg = el('p', { class: 'msg', role: 'alert' });
    a.input.addEventListener('input', () => { hint.textContent = a.input.value ? strength(a.input.value) : 'Mindestens ' + MIN_PASSWORD_LENGTH + ' Zeichen.'; });
    const go = next('Tresor erstellen', async () => {
      msg.textContent = '';
      if (a.input.value !== b.input.value) { msg.textContent = 'Die beiden Passwörter stimmen nicht überein.'; return; }
      go.disabled = true; msg.textContent = 'Tresorschlüssel wird erzeugt … das kann einige Sekunden dauern.'; await paint();
      try { await createVault(a.input.value, store); a.input.value = b.input.value = ''; backup(); }
      catch (e) { msg.textContent = e instanceof WeakPasswordError ? e.message : 'Der Tresor konnte nicht erstellt werden. Es wurde nichts gespeichert, was du bestätigen müsstest.'; go.disabled = false; }
    });
    show(el('h1', {}, 'Master-Passwort festlegen'), a.node, b.node, hint, msg, go); a.input.focus();
  };
  const backup = () => {
    const ok = el('input', { type: 'checkbox', id: 'ok' }), go = next('Tresor öffnen', onDone); go.disabled = true;
    ok.addEventListener('change', () => { go.disabled = !ok.checked; });
    show(el('h1', {}, 'Dein Tresor ist erstellt'),
      el('p', {}, 'Wichtig: Wenn der Browser seine Daten löscht, dein Gerät verloren geht oder du das Master-Passwort vergisst, sind die Daten ohne Backup weg. Erstelle deshalb gleich nach den ersten Einträgen ein Backup unter „Speicher & Backups“ und bewahre die Datei außerhalb dieses Geräts auf. Das Backup bekommt ein eigenes Passwort.'),
      el('label', { class: 'check' }, ok, el('span', {}, 'Ich habe verstanden, dass ich meine Daten ohne Master-Passwort und Backup nicht wiederherstellen kann.')), go);
  };
  welcome();
}

export function showReload(root) {
  root.replaceChildren(card(el('h1', {}, 'Bitte Seite neu laden'), el('p', { class: 'lead' }, 'BROX VAULT wurde in einem anderen Tab oder Fenster aktualisiert. Zur Sicherheit wurde dieser Tab gesperrt. Es wurde nichts gelöscht.'),
    el('button', { type: 'button', class: 'btn primary', onclick: () => location.reload() }, 'Neu laden')));
}
