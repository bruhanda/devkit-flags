# `@devkit/flags` — Hono integration

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/bruhanda/devkit-flags/tree/main/examples/sandbox/with-hono)

Mounts `honoFlags(flags)` as middleware so route handlers can call the typed `c.var.flag(key)` helper. Subjects are extracted from `x-user-id` / `x-user-plan` headers; the same code drops straight into Cloudflare Workers, Bun, or Deno because it exercises the app via `app.fetch()` rather than `node:http`.

```bash
npm install
npm start
```
