# `@devkit/flags` — advanced usage

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/bruhanda/devkit-flags/tree/main/examples/sandbox/advanced-usage)

A realistic multi-feature scenario:

- typed `attributes` flowing into rules and contexts
- reusable `segments` referenced via `$segment`
- multivariate rollout (A/B/C with weights)
- per-environment defaults
- a JSON file source layered over the schema defaults
- an `onEvaluation` observability hook recording each evaluation
- `getDetail` surfacing reason / bucket / rule id

```bash
npm install
npm start
```
