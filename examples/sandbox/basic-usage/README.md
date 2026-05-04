# `@devkit/flags` — basic usage

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/bruhanda/devkit-flags/tree/main/examples/sandbox/basic-usage)

Minimal one-file example: declare a typed flag schema, evaluate boolean / string / number flags, and demonstrate consistent-hash percentage rollouts.

```bash
npm install
npm start
```

The script prints type-narrowed reads, the share of a 1 000-subject sample that lands inside a 25% rollout, and the diagnostic detail surfaced by `getDetail`.
