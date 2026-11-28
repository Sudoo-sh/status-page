# Contributing

This repository runs the Sudoo.sh uptime monitor and status page with Upptime. Most files are written by Upptime's
workflows; only a few are edited by hand.

## Before you change anything

- Do not edit `history/`, `api/`, `graphs/` or the generated part of `README.md`: Upptime rewrites them.
- Do not change `.github/workflows/` by hand: Upptime's "Update Template CI" manages them.
- A push to **any branch** that changes `assets/**` deploys that branch to the live site (Static Site CI). Change
  `assets/` only on purpose, after review.
- A commit that should not start the workflows says `[skip ci]` in its message.
- Sign off each commit (`git commit -s`).

## Working on status-ui

`status-ui/` needs Node 18 or newer and no dependencies.

```bash
node --test status-ui/test/logic.test.mjs
node status-ui/build.mjs --out /tmp/preview --data fixture --fixture sample
python3 -m http.server -d /tmp/preview 8080
```

## Documentation rule

Every change keeps the code documented. A change is not finished until:

- Every source file starts with a header comment: what the file is for and how it fits in.
- Every exported function and every function that is not obvious has a JSDoc comment (`/** ... */`): what it does,
  its inputs (`@param`), what it gives back (`@returns`), the errors it throws (`@throws`) and its side effects
  (files written, requests sent, storage used).
- Every setting in `status-ui/src/config.js` says what it changes and why it has its value.
- Comments explain why, not what the next line does. Plain English, short sentences.
