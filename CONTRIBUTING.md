# Contributing

Use Node 20.3 or later (CI verifies the 20.3 floor and Node 22).

```sh
npm ci
npm ci --prefix examples
npm run verify
```

Behavior changes need focused tests. Changes to network, bridge, DEX, or feed
configuration must cite a primary source and should include live verification
evidence. Never silently update an address from an untrusted event or token
list.

Do not commit credentials, generated `dist/`, or `node_modules/`. Release
publishing and version tags remain maintainer actions.
