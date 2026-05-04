# `@devkit/flags` — Express integration

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/bruhanda/devkit-flags/tree/main/examples/sandbox/with-express)

Registers `expressFlags(flags)` as global middleware so route handlers can call `req.flag(key)` and `req.flags`. Layers an env-var source on top of the schema defaults — set `FLAG_NEW_CHECKOUT=true` or `FLAG_API_VERSION=v2` to flip values without redeploying.

```bash
npm install
npm start
```

The script spins up a short-lived `node:http` server, fires a few sample requests with cookie-based subjects, prints the responses, and exits.
