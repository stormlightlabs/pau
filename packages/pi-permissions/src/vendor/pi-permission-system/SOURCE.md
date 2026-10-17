# Vendored pi-permission-system files

This directory holds unmodified files from `@gotgenes/pi-permission-system`.
Pau uses its bash analysis, path normalization, wildcard matching, and bash
session-pattern suggestion. The files keep upstream's directory layout,
headers, and MIT license in `LICENSE`.

- Repository: `https://github.com/gotgenes/pi-packages`
- Package: `packages/pi-permission-system`
- Release: `40.3.0`
- Commit: `fefa477b3b96c8ec23db223349dadbd183a1796a`

The release tag `pi-permission-system-v40.3.0` points to `90e2e21d`. The
recorded commit is one later and changes only a retrospective note outside
these files.

Do not edit these files. Send a fix upstream, then refresh the copy:

```sh
node scripts/vendor.ts --sync <pi-packages checkout> <commit> <release>
node scripts/vendor.ts --verify --upstream <pi-packages checkout>
pnpm test
```

The vendored modules import each other through `#src/*` and their tests
through `#test/*`. `tsconfig.json` and `vitest.config.ts` map those aliases
here. The only type the copy needs from outside it, upstream's Zod-inferred
configuration types, comes from `src/vendor-types`, so Zod is not a
dependency. `docs/configuration.md` is copied only because a vendored test
checks the reader roster it publishes.

## Files

| File | SHA-256 |
|---|---|
| `LICENSE` | `220a81ab89687aa207c1b9257a7f3636c8c78b5c1092b7563ad662950d21dd00` |
| `docs/configuration.md` | `3d6304093906d84c719691b922fd7f33a50ecc4baeb30e1591113ba1f408306f` |
| `src/access-intent/access-path.ts` | `c03c50e28d350af2e886dcc2195bfdb79faf3ec84f83a9db6a611a95fb5757cd` |
| `src/access-intent/bash/async-cache.ts` | `bd91405f203929c58fdbcdfc3e3c38717b8fe52b35d75ab0b3a19e5163179d99` |
| `src/access-intent/bash/awk-invocation.ts` | `fe98fb219338166ff29fc062df78d30639e7f890d3192ea192ec803b05020ed8` |
| `src/access-intent/bash/bash-arity.ts` | `0b2623320af05c19eb07a9d9fc46414204d8d8582da51ad26002ab1d1c529aa6` |
| `src/access-intent/bash/bash-path-resolver.ts` | `94bedd7a92528738a16471c42b3c2ae7834203155f76d2a3a65578dc5d17dad2` |
| `src/access-intent/bash/command-effects.ts` | `b00c762e905e5cc2144735a90e966d65481b0dc28e3f307b46cf6baea2146879` |
| `src/access-intent/bash/command-enumeration.ts` | `b5104f5d90a93af406c280965ebb811bae2f085fded416a798dc268cc68344b5` |
| `src/access-intent/bash/declared-command-effects.ts` | `52abffdb2a3b20ac5aa4cd9d3d3db74405da961dd3b4e01579e7cc8acb9f22d8` |
| `src/access-intent/bash/heredoc-free-lines.ts` | `3b1df7d854e63dfb5878fe8d13fab0133c0b3769d75472fec7c8e63f1983b326` |
| `src/access-intent/bash/heredoc-tails.ts` | `7f939fe85920a9924059c09c008260825c61968944707edfb6773d3df9d9ca45` |
| `src/access-intent/bash/msys-bash-tokens.ts` | `18872fd2ac45630a29d3573eb643eceb825b056bf0f1bced80d6a5fe4b40aff1` |
| `src/access-intent/bash/nested-execution.ts` | `ce2d66a8c5b1715874f02ac2f5a2cdc6e28192be0b8cf1b85d25315f06200232` |
| `src/access-intent/bash/node-text.ts` | `59aa3ae31353cd9b5980ed202646398c88e0fba6a39eef4b6d052483cac9fbb7` |
| `src/access-intent/bash/option-guards.ts` | `ffb8d5b649edc6c7c52504a16f65a930788adfa27690360792774cb3f7076b6c` |
| `src/access-intent/bash/parse-health.ts` | `aa03118704363fa01d9d910be2997db23c475335e7aace7f19ff269d76f99402` |
| `src/access-intent/bash/parse-view.ts` | `b7f828943f3a18cf327e5e6e505ddaa3fea6deabb3464936404beb6c4bd48ea2` |
| `src/access-intent/bash/parser.ts` | `46a48cd5c8df5abeed4158f6cd2dfa36da9b5dda78f60a197e5387735e4535aa` |
| `src/access-intent/bash/program.ts` | `e59bf5ce42c6cc2ac4f9f3208fcbfdfaedc82f0546191aabf9423230a4fa6fd5` |
| `src/access-intent/bash/redirect-analysis.ts` | `2d825bc0378eacb66f2a8c12cc14eea1f5497122ec252500271b0822dcaa5e12` |
| `src/access-intent/bash/redirect-arguments.ts` | `b54229c6c8c9ee4b575c02a1561e013c5a8a958d58db67e771ba655bd61069b5` |
| `src/access-intent/bash/sed-invocation.ts` | `993c69580892a7171a9060f7f9134de7198a12430c0d8bf41dea265d055bd718` |
| `src/access-intent/bash/shell-variable-expansion.ts` | `b21badd77d738af39f1d983b5b84daac4634afa09cd2f6865816e76eacddb347` |
| `src/access-intent/bash/token-classification.ts` | `8e98a23be8d968ccf4012693201f4ea382a80bdf97bcedcc93e4c050751038a5` |
| `src/access-intent/bash/token-collection.ts` | `1439611f1a44bfe436e38074a6239bee635e7b77687abb312c2df3de08fcb5c0` |
| `src/access-intent/bash/unresolved-salvage.ts` | `08fbef81ff3a040df3241e69d762873ca386f739792aab4c33eb4f16c4d43a25` |
| `src/access-intent/bash/wrapper-analysis.ts` | `a3619c8b22bca8896bc5b0e11d52156b060e4ec45a2520f163254822cf72c1a6` |
| `src/access-intent/effect.ts` | `2b93e59abd8215b9ceb550499727afc4a77a98a734bae7a7550e6e2588ad2b02` |
| `src/access-intent/path-normalization.ts` | `07ab301b9c83019184c4c19e1220f730721153b59c134a7b2a4c78d8363cc3ff` |
| `src/access-intent/path-surfaces.ts` | `3ecf0dac3983a23333c2604a9b556d4c8728790e09791623bfee83479a019175` |
| `src/access-intent/tool-kind.ts` | `d571d8a248b3b1e6f3002cb172d53ac9f3b489d09c3e6b7ef8b11126c8b1775b` |
| `src/config/command-effects-config.ts` | `5d5f2d54d62ddc178e1420204566c294a0394c3be0714527faf233b338b1e24e` |
| `src/path/approval-pattern.ts` | `95df0aa70f0255e857746d81a3b3976cb6f7b6c36ce0a7e347005e2f74785c36` |
| `src/path/canonicalize-path.ts` | `76244ce4a7c4e2b656c6e2c5d5a33377d98076ac50180938a4212a54ec24170b` |
| `src/path/expand-home.ts` | `b5e8bb861e6b21f99892f8badce9b2cae6e9bc403e005accab62e880f08b478c` |
| `src/path/native-tool-target.ts` | `5582a41d9a0de207d435835211aaadb5a579584525f8057ae3131bb51a5dcac4` |
| `src/path/path-containment.ts` | `d334500dc3e06dc65d533ee4b3c8d243c6eee114ef5422eaed4b07c3f4ebb719` |
| `src/path/path-flavor.ts` | `721f530b7a3888da205ea8a37b464744c7178b72ebab6c88bc3479e29f4f46cb` |
| `src/path/path-normalizer.ts` | `d22c006f9ae5c91925b4a27fdae51abc2e7cb882e9b37900651d5cac6c41f846` |
| `src/path/pi-infrastructure-read.ts` | `b6ee107e986d5527273776a6c1200f9865972d049893b051d0188176c26de1a5` |
| `src/path/safe-system-paths.ts` | `767933eabdcb43f262ccd50186b271bf6f320195b01928e1b3b9b3caff08f0ee` |
| `src/policy/rule.ts` | `68dd08229cfb7dba42b6597197412345a2e3bc7ff176af53a23efb30cfe7384e` |
| `src/policy/wildcard-matcher.ts` | `250b7d3c8d47d480e7cd3e89a71a981467a8ba845b89c97d1b6cbe8f09f8bbd1` |
| `src/presentation/pattern-suggest.ts` | `65c78afa7e92480cc374154a8357f48f1ad8fc8485362944175ddee8be1d4fb3` |
| `src/session/approval-grant.ts` | `2abfffcf82ef8e6254e7e937526618a9f135754b6328f1ec54b2ae0524dbb7b8` |
| `src/types.ts` | `5aa7ac48dac6b9a00b9c630fa9dba11278f091f775375b09176009f6f71b0d11` |
| `src/value-guards.ts` | `c34f96c0d00d51a8d6f4e7cd60990f200f4dade65e8e52c7d875a630e9d317cb` |
| `test/access-intent/access-path.test.ts` | `81f5510d65cfabcd305623dfee6ecf42a4c30f5a72186fe76cea049f6261ba8d` |
| `test/access-intent/bash/async-cache.test.ts` | `d076298011c5497b4fb2c82bc4e1c6b82fbcfcd4a6f154751bb5d8709e29fdf8` |
| `test/access-intent/bash/awk-invocation.test.ts` | `729cc90be00fd1097708898038707deca9d9c9250905ba5a209cae0cc3a3505c` |
| `test/access-intent/bash/bash-arity.test.ts` | `cc75911cabe054661c3eb5727ecd8454cb1879a7494c8fbffb6b81f476dd7a49` |
| `test/access-intent/bash/bash-path-resolver.test.ts` | `a1500f3d4f7c09441e2acd0086f6cc6e7dfacadd89a5e390f5e41c46e7f5bcbf` |
| `test/access-intent/bash/command-effects.test.ts` | `e566e67630d34b4f320ebd140e2c194c4a298e4822a485e82132365ed1674a17` |
| `test/access-intent/bash/command-enumeration.test.ts` | `ba811782ee6c44f8bdc47c65f1ef632b853b63d3cb9e2e2c85baf73bbc65e941` |
| `test/access-intent/bash/declared-command-effects.test.ts` | `8cd55b57d46dced1f8cccc7c7387df4c12f77f09b197f5300035abb5c8b48b8d` |
| `test/access-intent/bash/heredoc-free-lines.test.ts` | `9c4dd779b4fac185b2a0f9e0d3e265440ee5b86131d0d9fd7d79e99fbe1f2494` |
| `test/access-intent/bash/heredoc-tails.test.ts` | `97cf531444283ad9b6772c358a29b4d5c7709bb0261845d1c859759af9af81bd` |
| `test/access-intent/bash/msys-bash-tokens.test.ts` | `9aac02912a703b58a75c0a38d6231650b6e0765b2aa3cdd9f56a31b044238f04` |
| `test/access-intent/bash/nested-execution.test.ts` | `6212cb2e5b34c10566898712f41bd1b7252231e2c6d63dfe28d524b12e9726f2` |
| `test/access-intent/bash/node-text.test.ts` | `9dbd517f680f0ece3c982c31511c2ff29c8625a0da8eff41315af27dee144e9f` |
| `test/access-intent/bash/parse-health.test.ts` | `2da4f519307fb2b28f8d72bd742c77388a16732d88c94409859cd1e82792d904` |
| `test/access-intent/bash/parser.test.ts` | `8a7c3fa052f6ee648e183ebc6b4ee70dd419fdc2c409655f4c9234c32c43c315` |
| `test/access-intent/bash/program-declared-effects.test.ts` | `039ac8af20b15cd8e2ef1dc05f7cf2c05dc0b3f478b165b1a0e1f08e72e9d21c` |
| `test/access-intent/bash/program-external-accesses.test.ts` | `a35ac15f84db5ef548af2c77664c7c4c4227601e5d0c55d2fa0b6218b3b2a9ee` |
| `test/access-intent/bash/program-parse-sync.test.ts` | `4899ee3fccd5a227c5b4996ed0f7def20f17ac91280bbdf0ecfe9d34655c664b` |
| `test/access-intent/bash/program.test.ts` | `832b2288fef76201a3ee0109ddaf6e918e5e858acc6a4fe5729e9c8097322ca6` |
| `test/access-intent/bash/redirect-analysis.test.ts` | `769a5e6d9176a716f0d7ce89838d445b5440248d702d946d1ad130326d0360bf` |
| `test/access-intent/bash/redirect-arguments.test.ts` | `ebbb9159c7e94085b2f53de7a12d12348b5a6c87692162510b2fd11ff68c23f0` |
| `test/access-intent/bash/sed-invocation.test.ts` | `a8b102dd296980615b69499d977469a678ca44ddf502cc5a12eae3ee21c0cee1` |
| `test/access-intent/bash/shell-variable-expansion.test.ts` | `6e177f8595663021581155761b97df8437b8232d11417a4d0f793f1897d2091b` |
| `test/access-intent/bash/token-classification.test.ts` | `ec2edd81795d34fc55c5b174b66dcb2e30504ffa78c90601623e4908631fe50b` |
| `test/access-intent/bash/token-collection.test.ts` | `dfe03357b1c1bd6890b5726ff52a5bdb18b0581fe1f819a89950fc91bfc549ca` |
| `test/access-intent/bash/unresolved-salvage.test.ts` | `74f72457194e4c43838c032e62907ae906b8ba4915cd27ad2be290231a8b76c2` |
| `test/access-intent/bash/wrapper-analysis.test.ts` | `1d137a3ee3f24a0d5c4b353d87ab1d8bc1ae8727f8620ab6961ea7d4e5ffe74e` |
| `test/access-intent/effect.test.ts` | `fb2a984bd0bbb0a75b1786260df00e16a6b658b0485d1653fe3855f0770743b5` |
| `test/access-intent/path-normalization.test.ts` | `c317a0ac3ba67190e42b1f0c8aa79a3c42cd5d027d8fb499b644ab9be5485472` |
| `test/access-intent/path-surfaces.test.ts` | `90e3036ab9e33cde5fc2a4b2c802aac672b3734fd5a5438e240f39ac2a17490b` |
| `test/access-intent/tool-kind.test.ts` | `e8c5aca9e1f44aedb82717436677ee67a30be264a607ca94bb300ab65c1b0242` |
| `test/helpers/arg-words.ts` | `b51904ca5744d3a21379e139c637406df4bf477b5ea7b14d4995fbf469e459bd` |
| `test/helpers/bash-parse-tree.ts` | `0e2387f2e78a143616c9c652c34ba7197a2b5c3a2c0c7b8c7946f6ad7477b917` |
| `test/helpers/fake-ts-node.ts` | `1cd388abb053f58c03e390f6b0063a7a3cb9a54d1c775fb163dfc2fe2c70874b` |
| `test/helpers/tmp-fixture.ts` | `cb509697f1e0427f1e256835b571184bce52dd310c3a1d3f4a7d5a596056be8a` |
| `test/path/canonicalize-path.test.ts` | `1a6f2ee2de730499cc5bdee4db19086c5f3e3f4d51437a0c4ec68214a2210cde` |
| `test/path/expand-home.test.ts` | `f8e0d6c78b1ae91ab3d01493aed7bcbe33f1e9c9c9ec37dc30f2fd4c705fc98a` |
| `test/path/path-containment.test.ts` | `8ee436b5ee59eca0afbfb06d58da27df5a68b6d6004e7b33c02e69b862ec7934` |
| `test/path/path-normalizer.test.ts` | `6feeb8c6164242c69b8f6114d46147b71012c2ddf6d862301c2905879dd2db16` |
| `test/path/safe-system-paths.test.ts` | `601c5a13a6d52f0d1ce140e691c3805783d257bf49966ba26e893c14337d0973` |
| `test/policy/rule.test.ts` | `ce17512a5745c9b9e80fa685e20903d03a0c32642b3b2ab5e6d3c7bb48574d8e` |
| `test/policy/wildcard-matcher.test.ts` | `eefd63d026496a0138bca505ce3d6a81ed2500cc4e00cace2a1946d1691fceab` |
| `test/presentation/pattern-suggest.test.ts` | `30846db6657ed2fb432f84f7344d6b78b36105de6783bcff2be3a49babdde37f` |
| `test/session/approval-grant.test.ts` | `156b92e4fcdb31026f4cd6c0a3d24b8c4b84a9485f0604750b9150b5ebf57d13` |
| `test/types.test.ts` | `8c14aa3e3ab6dda55d6dd119494f79d1373801ae9cdfbf94b88efd97cc976dba` |
| `test/value-guards.test.ts` | `a588bded917daaffc265a90b40f67f7d963d2755f35737a374a809cee001833e` |
