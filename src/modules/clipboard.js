import { onLockChange } from '../core/keys/session.js';
// Best Effort: Der Browser erlaubt kein sicheres „nur meinen Eintrag löschen“. Nach Ablauf wird die Zwischenablage geleert.
let timer = null;
const wipe = () => { clearTimeout(timer); timer = null; navigator.clipboard.writeText('').catch(() => {}); };
export async function copySecret(text, seconds) {
  await navigator.clipboard.writeText(text);
  clearTimeout(timer); timer = seconds > 0 ? setTimeout(wipe, seconds * 1000) : null;
}
onLockChange((unlocked) => { if (!unlocked && timer) wipe(); });
