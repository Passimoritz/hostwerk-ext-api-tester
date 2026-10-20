![API tester](banner.svg)

# API tester

Build, send and save requests to your projects – like Postman, right inside Hostwerk: collections, variables like {{base}}, paste and copy curl, clear responses with time and size.

[Deutsch](README.de.md) · An official [Hostwerk](https://github.com/Passimoritz/hostwerk-public) extension (SDK 2.7, native extension)

![Screenshot](docs/screenshot.png)

## What it does

- Any method, headers and body (JSON, form, text)
- Collections with variables ({{base}}, {{token}}) – one switch for local and live
- Paste a curl command, copy any request as curl
- Import OpenAPI 3 / Swagger 2 (JSON or YAML, by address or pasted) – a ready collection with every request, variables for path parameters, tokens and API keys
- Pick the address of your web servers, virtual hosts and apps with one click
- Response with status, time, size, headers and pretty JSON; history of the last 50

## Install

In Hostwerk: **Extensions → Discover** and click “Install”.

Native extensions run as part of Hostwerk (own server and interface part). That is why Hostwerk only installs them from the official catalogue (with checksum) or in developer mode.

## Data

`data/api-tester` – collections and history. Removing the extension keeps them.

## Develop

```bash
node --test tests/*.test.js          # tests
node build-native.js .               # build the interface (sdk/build-native.js from hostwerk-public)
node check.js . --strict             # same check as the catalogue (sdk/check.js)
```

Interface source in `ui/src`, server part in `server/`. Texts in the code are English, German is in `locales/de.json`.

## License

MIT
