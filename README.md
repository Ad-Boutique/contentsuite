# Content Suite

Kunden-Feedback-Tool von Ad Boutique, live unter **https://contentsuite.ad.boutique**.

Jedes Projekt hat einen eigenen Link (`/projektname`) und einen eigenen Zugangscode. Kund:innen melden sich mit Name und Code an. Danach können sie Passagen eines Videos anhand des Transkripts markieren („Muss rein“, „Optional“, „Raus“), kommentieren, umsortieren und als groben Zusammenschnitt abspielen. Alle Angemeldeten sehen dieselbe Auswahl, Änderungen erscheinen bei den anderen nach wenigen Sekunden.

Für den Schnitt gibt es einen Export für DaVinci Resolve:
- **Marker-EDL**: farbige Marker mit Kommentar auf der Timeline der Langversion (grün = Muss rein, gelb = Optional, rot = Raus, blau = nur Kommentar).
- **Auswahl-EDL**: Schnittliste der Auswahl in der gewünschten Reihenfolge.
- CSV und Text für Mail und Ablage.

## Aktuelle Projekte

| Link | Kunde | Inhalt |
|---|---|---|
| `/ksg26` | Kommunalkredit | KSG 2026 Aftermovie, Auswahl für die Kurzversion |

## Aufbau

```
api/            Serverfunktionen (Vercel): Login, Projektdaten, Markierungen
projects/<id>/  project.json: Titel, Video-Pfad, Timecode-Start, Transkript-Passagen
public/app.html Oberfläche (eine Datei, keine Abhängigkeiten)
public/media/   Vorschau-Videos und Vorschaubilder (Ordnername mit Zufallsanteil)
scripts/        Lokaler Testserver
```

- Zugangscodes und Sitzungsschlüssel liegen nur in den Umgebungsvariablen, nie im Repo.
- Projektdaten und Transkript gibt der Server nur nach erfolgreichem Login heraus.
- Die Vorschau-Videos liegen unter einem nicht erratbaren Pfad, den die Seite erst nach dem Login kennt.
- Login-Versuche sind begrenzt (10 pro 15 Minuten und IP).
- Die Seiten sind für Suchmaschinen gesperrt (`noindex`, `robots.txt`).

## Einrichtung auf Vercel (einmalig)

1. **Projekt anlegen**: Vercel > Add New > Project > dieses Repo importieren. Framework: „Other“, keine Build-Einstellungen nötig.
2. **Datenbank verbinden**: Im Vercel-Projekt > Storage > Create Database > **Upstash for Redis** (Marketplace, Free-Plan reicht) > mit dem Projekt verbinden. Das setzt die Variablen `KV_REST_API_URL` und `KV_REST_API_TOKEN` automatisch.
3. **Umgebungsvariablen** (Settings > Environment Variables, für Production):
   - `SESSION_SECRET`: langer Zufallswert (mindestens 24 Zeichen)
   - `ACCESS_CODES`: `ksg26=DER-ZUGANGSCODE` (mehrere Projekte mit Komma trennen: `ksg26=CODE-1,projekt2=CODE-2`)
4. **Neu deployen** (Deployments > Redeploy), damit die Variablen greifen.
5. **Domain**: Settings > Domains > `contentsuite.ad.boutique` hinzufügen. Beim DNS-Anbieter von ad.boutique einen CNAME-Eintrag setzen: `contentsuite` → `cname.vercel-dns.com`.

## Neues Projekt hinzufügen

1. Ordner `projects/<id>/project.json` anlegen (Vorlage: `projects/ksg26/project.json`). `id` nur Kleinbuchstaben, Ziffern, Bindestrich.
2. Vorschau-Video (H.264, 720p) und Vorschaubild-Raster nach `public/media/<id>-<zufall>/` legen und die Pfade in `project.json` eintragen.
3. In Vercel `ACCESS_CODES` um `<id>=NEUER-CODE` ergänzen und neu deployen.
4. Link `https://contentsuite.ad.boutique/<id>` und Code getrennt an die Kund:innen schicken.

## Lokal testen

```bash
SESSION_SECRET=lokaler-test-schluessel-123456 ACCESS_CODES="ksg26=TEST-1234" node scripts/devserver.mjs
```

Dann http://localhost:3000/ksg26 öffnen. Der Testserver ersetzt Redis durch einen Speicher im Arbeitsspeicher.

## Daten auslesen

Die Markierungen liegen in Redis unter `cs:<id>:marks` (Hash, eine Passage pro Feld), dazu `cs:<id>:settings`, `cs:<id>:general` und ein Verlauf aller Änderungen in `cs:<id>:log` (die letzten 2.000).
