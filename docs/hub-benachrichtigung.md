# Hub-Benachrichtigung: Content Suite → boutique.OS

Ziel: Wenn Kund:innen in der Content Suite (contentsuite.ad.boutique) Feedback geben, bekommt die zuständige Person bei ad.boutique (z. B. Lenny) eine Glocke im Hub, gern auch als Push.

Die Content Suite sendet bereits (Code in `api/_notify.js`), sie ist nur noch nicht eingeschaltet. Im Hub fehlt die Gegenstelle.

## Was die Content Suite schickt

`POST <HUB_WEBHOOK_URL>` mit JSON:

```json
{
  "event": "contentsuite.feedback",
  "project": "ksg26",
  "projectTitle": "KSG 2026 Aftermovie-Kürzung",
  "client": "Kommunalkredit",
  "actors": ["Andrea Rois"],
  "summary": { "must": 3, "maybe": 1, "cut": 2, "comments": 2, "changes": 8 },
  "text": "Andrea Rois gibt Feedback in der Content Suite: KSG 2026 Aftermovie-Kürzung (3× Muss rein, 1× Optional, 2× Raus, 2 Kommentare)",
  "link": "https://contentsuite.ad.boutique/ksg26",
  "recipients": ["lennart@ad.boutique"],
  "dedupeKey": "contentsuite:ksg26:996985",
  "sentAt": "2026-11-13T12:43:06.730Z"
}
```

Header:
- `X-Contentsuite-Timestamp`: Unix-Sekunden
- `X-Contentsuite-Signature`: `sha256=` + HMAC-SHA256 (hex) über `<timestamp>.<roher Body>` mit dem gemeinsamen Geheimnis

Verhalten:
- Nur Änderungen von Kund:innen lösen aus, nicht die des ad.boutique-Teams.
- Gebündelt: höchstens eine Meldung je Projekt alle 30 Minuten (`NOTIFY_WINDOW_MIN`).
- `recipients` enthält nur Adressen `@ad.boutique` (in `projects/<id>/project.json`, Feld `notify`).
- Timeout 3 Sekunden. Antwortet der Hub nicht mit 2xx, versucht es die nächste Änderung erneut.

## Was im Hub gebraucht wird (Vorschlag)

1. **Route** `POST /api/contentsuite` ohne Login (Middleware-Ausnahme nur für genau diese Adresse, wie bei `/api/leads/[key]`).
2. **Prüfung:** Signatur in konstanter Zeit gegen `CONTENTSUITE_WEBHOOK_SECRET` (Env im Hub), Zeitstempel höchstens 5 Minuten alt, Body höchstens 16 KB, Bremse je IP.
3. **Empfänger:** je Adresse aus `recipients` das aktive interne Profil (Rolle owner/team/contractor, nie client) suchen; Unbekannte still überspringen.
4. **Glocke:** mit dem Server-Schlüssel `notify_suggest(profile, <kategorie>, text, link, null, dedupeKey)`, danach `kickPush()`.
5. **Mitteilungs-Typ** nach Hub-Regel (0148/0150/0156): Zeile in `notify_types` (z. B. `contentsuite_feedback`, Bereich Video/Design, standardmäßig an), Regel in `_notify_kind`, Test, Englisch, Eintrag in `docs/Mitteilungen_Uebersicht.md`.
6. **Link:** der Glocken-Link ist eine externe Adresse (`https://contentsuite.ad.boutique/...`), sollte im neuen Tab öffnen. Falls die Glocke nur interne Links kann, bitte so anpassen oder den Link in den Text schreiben.
7. **Antwort:** `200 {"ok":true,"delivered":<anzahl>}`; bei falscher Signatur `401`.

Optional später: Eintrag in den Kunden-Verlauf (Kunde über `client` oder eine feste Zuordnung Projekt → Kunden-ID).

## Einschalten (nach dem Hub-Deploy)

In Vercel beim Projekt **contentsuite** (Production), danach Redeploy:
- `HUB_WEBHOOK_URL` = `https://app.ad.boutique/api/contentsuite`
- `HUB_WEBHOOK_SECRET` = derselbe Wert wie `CONTENTSUITE_WEBHOOK_SECRET` im Hub

Prüfen: `https://contentsuite.ad.boutique/api/health` zeigt dann `"hubBenachrichtigung": "eingerichtet"`.
