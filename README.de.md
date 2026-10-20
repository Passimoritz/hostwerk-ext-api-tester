![API-Tester](banner.svg)

# API-Tester

Anfragen an deine Projekte bauen, senden und speichern – wie Postman, nur direkt in Hostwerk: Sammlungen, Variablen wie {{base}}, curl einfügen und kopieren, Antworten übersichtlich mit Zeit und Größe.

[English](README.md) · Eine offizielle [Hostwerk](https://github.com/Passimoritz/hostwerk-public) Erweiterung (SDK 2.7, native Erweiterung)

![Screenshot](docs/screenshot.de.png)

## Was sie kann

- Jede Methode, Kopfzeilen und Inhalt (JSON, Formular, Text)
- Sammlungen mit Variablen ({{base}}, {{token}}) – ein Schalter für lokal und live
- curl-Befehl einfügen, jede Anfrage als curl kopieren
- OpenAPI 3 / Swagger 2 importieren (JSON oder YAML, per Adresse oder eingefügt) – fertige Sammlung mit allen Anfragen, Variablen für Pfad-Parameter, Token und API-Schlüssel
- Adresse deiner Webserver, virtuellen Hosts und Apps mit einem Klick wählen
- Antwort mit Status, Zeit, Größe, Kopfzeilen und lesbarem JSON; Verlauf der letzten 50

## Installieren

In Hostwerk: **Erweiterungen → Entdecken** und „Installieren“ klicken.

Native Erweiterungen laufen als Teil von Hostwerk (eigener Server- und Oberflächen-Teil). Deshalb installiert Hostwerk sie nur aus dem offiziellen Katalog (mit Prüfsumme) oder im Entwickler-Modus.

## Daten

`data/api-tester` – Sammlungen und Verlauf. Beim Entfernen der Erweiterung bleiben sie erhalten.

## Entwickeln

```bash
node --test tests/*.test.js          # Tests
node build-native.js .               # Oberfläche bauen (sdk/build-native.js aus hostwerk-public)
node check.js . --strict             # dieselbe Prüfung wie der Katalog (sdk/check.js)
```

Oberfläche in `ui/src`, Server-Teil in `server/`. Texte im Code sind Englisch, Deutsch steht in `locales/de.json`.

## Lizenz

MIT
