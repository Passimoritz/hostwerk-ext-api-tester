## 1.5.0

- Like a real API tool: collections on the left, request on top and answer below share the window height – every area scrolls on its own, the page stays put / Wie ein echtes API-Werkzeug: Sammlungen links, Anfrage oben und Antwort unten teilen sich die Fensterhöhe – jede Fläche scrollt für sich, die Seite bleibt stehen

## 1.4.0

- Lives where it belongs: Projects → API tester – no own sidebar entry any more (Hostwerk 3.0+); the full page stays under Extensions → Open and can be pinned in the sidebar settings. / Steckt jetzt dort, wo sie hingehört: Projekte → API-Tester – kein eigener Seitenleisten-Eintrag mehr (Hostwerk 3.0+); die ganze Seite bleibt unter Erweiterungen → Öffnen und lässt sich in den Seitenleisten-Einstellungen anheften.

## 1.3.0

- Secrets are no longer in plain text: secret variables are sealed on disk and masked on the page, the history keeps no Authorization/Cookie/token values. / Geheimnisse nicht mehr im Klartext: geheime Variablen versiegelt gespeichert und auf der Seite verdeckt, der Verlauf behält keine Authorization-/Cookie-/Token-Werte.
- Switch “Follow redirects” and an own time limit per request; running requests can be cancelled. / Schalter „Weiterleitungen folgen“ und eigenes Zeitlimit je Anfrage; laufende Anfragen lassen sich abbrechen.
- A click in the history without a collection now creates the collection “From the history”. / Ein Klick im Verlauf ohne Sammlung legt jetzt die Sammlung „Aus dem Verlauf“ an.
- Environments (local, staging, live) with a switch – the README’s promise now holds. / Umgebungen (lokal, Staging, live) mit Umschalter – das Versprechen der README stimmt jetzt.
- Checks per request and “Run collection”, also every day as a Hostwerk task (secret run link). / Prüfungen je Anfrage und „Sammlung ausführen“, auch täglich als Hostwerk-Aufgabe (geheimer Lauf-Link).
- Import from Postman and Insomnia, export for Postman; folders instead of name prefixes (OpenAPI tags become folders). / Import aus Postman und Insomnia, Export für Postman; Ordner statt Namenspräfix (OpenAPI-Tags werden Ordner).
- Forms with files (multipart) and cookies per collection. / Formulare mit Dateien (multipart) und Cookies je Sammlung.
- “Measure this request” (Profiler) and “Check page” (Page check) with one click. / „Diese Anfrage messen“ (Leistungs-Messung) und „Seite prüfen“ (Seiten-Check) mit einem Klick.
- Error state with “Try again”, design scale, place in the sidebar under “Develop”, allowExtensions; release package contains everything except the repository tooling. / Fehlerzustand mit „Erneut versuchen“, Design-Skala, Platz in der Seitenleiste unter „Entwickeln“, allowExtensions; Release-Paket enthält alles außer dem Repo-Werkzeug.

## 1.2.0

- Other extensions can add requests (service `apiTester`), e.g. the webhook inbox: received calls land in the collection "Webhook inbox", ready to change and send again. / Andere Erweiterungen können Anfragen ablegen (Dienst `apiTester`), z. B. das Webhook-Postfach: empfangene Aufrufe landen in der Sammlung „Webhook-Postfach“ – zum Ändern und erneut Senden.

## 1.1.0

- Import OpenAPI 3 / Swagger 2 (JSON or YAML, address or pasted): every operation becomes a request, path parameters become variables, bodies are built from examples and schemas, tokens and API keys become variables. / OpenAPI 3 und Swagger 2 importieren (JSON oder YAML, Adresse oder eingefügt): jede Anfrage landet in einer neuen Sammlung, Pfad-Parameter werden Variablen, Bodys entstehen aus Beispielen und Schemas, Token und API-Schlüssel werden Variablen.

## 1.0.0

- First release. / Erste Fassung.
