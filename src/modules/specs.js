const f = (key, label, kind = 'text') => ({ key, label, kind });
export const TEMPLATES = {
  'WLAN': ['Netzwerkname', ['Passwort', true], 'Verschlüsselung'], 'Seriennummer': ['Gerät', 'Seriennummer'],
  'Vertrag': ['Anbieter', 'Vertragsnummer', 'Laufzeit bis'], 'Mitgliedschaft': ['Organisation', 'Mitgliedsnummer'],
  'Softwarelizenz': ['Software', ['Lizenzschlüssel', true], 'Gültig bis'], 'Gerät': ['Gerätename', 'Modell', 'Seriennummer'],
  'Adresse': ['Name', 'Straße', 'PLZ und Ort'], 'Sonstiges': [],
};
export const passwordSpec = { type: 'password', route: 'passwoerter', label: 'Passwort', title: 'Passwörter', newLabel: 'Neues Passwort', lead: 'Zugangsdaten verschlüsselt speichern.',
  fields: [f('title', 'Titel'), f('website', 'Webseite', 'url'), f('username', 'Benutzername'), f('password', 'Passwort', 'secret'), f('pin', 'PIN', 'secret'), f('email', 'E-Mail-Adresse'), f('description', 'Beschreibung', 'textarea')],
  custom: true, generator: true, summary: (i) => i.username || i.website || i.email || '' };
export const noteSpec = { type: 'note', route: 'notizen', label: 'Notiz', title: 'Notizen', newLabel: 'Neue Notiz', lead: 'Private Notizen, verschlüsselt gespeichert.',
  fields: [f('title', 'Titel'), f('content', 'Inhalt', 'textarea')], custom: false, summary: (i) => (i.content || '').replace(/\s+/g, ' ').slice(0, 80) };
export const personalSpec = { type: 'personal', route: 'persoenlich', label: 'Persönliche Daten', title: 'Persönliche Daten', newLabel: 'Neuer Eintrag', lead: 'WLAN, Seriennummern, Verträge, Lizenzen und eigene Felder.',
  fields: [f('title', 'Titel'), f('description', 'Notizen', 'textarea')], custom: true, templates: TEMPLATES,
  summary: (i) => (i.custom || []).filter((c) => !c.secret && c.value).slice(0, 2).map((c) => c.value).join(' · ') };
export const SPECS = { password: passwordSpec, note: noteSpec, personal: personalSpec };
