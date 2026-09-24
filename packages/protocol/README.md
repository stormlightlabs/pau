# Pau protocol

This package contains the TypeScript wire types generated from `pau-core`. Edit
the Rust types, then regenerate the checked output from the repository root:

```sh
pnpm generate:protocol
```

CI runs `pnpm check:generated` and fails when the checked output is stale.
