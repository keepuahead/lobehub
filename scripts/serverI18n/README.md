# Server translation bundles

`bun run i18n:server` generates ignored resources under
`src/libs/i18n/server/generated/` (the stable type declaration is committed so a
fresh checkout can type-check before its first build). Next and standalone Hono builds run this step
before bundling; their development servers regenerate when source or locale files
change. CI generates fresh resources before tests. Generated resources are not
translation sources: edit `packages/locales/src/default/` and the locale JSON files.

Use `getServerTranslations(namespace, locale)` from `@/libs/i18n/serverTranslation`.
It returns `t`, which falls back to the key, and `find`, which returns `undefined`
when neither the requested language nor English has a value. Both interpolate
parameters and use English as the language fallback. The async `translation`
wrapper remains available for existing callers.

The extractor follows runtime imports from Next entry points and the standalone
Hono entry, including workspace packages and re-exports. Type-only imports and
client boundaries are excluded. Pass translators using `ServerTranslate<N>` so
their namespace remains visible to the compiler.

- Literal keys and finite unions retain exactly their matching keys.
- Templates such as `response.${code}` retain every key matching that pattern.
- An unrestricted string requires a file/namespace allowlist entry in
  `generate.ts`, with a reason. The runtime error-code lookup is registered there.
- Opaque keys, erased translator types, unresolved local imports, and direct
  imports of unprojected translations fail generation.

`report.json` records selected namespaces, call sites, patterns, and dependency
edges. English is taken from the default TypeScript catalog; missing translated
keys fall back at runtime.

Run extractor tests with
`bunx vitest run --config scripts/serverI18n/vitest.config.ts`.
After a Next build, `bun run i18n:server:audit` checks seven backend route traces
for raw dictionaries and a 250 MiB local byte budget (the byte budget is skipped
for Docker). Source maps, when present, also detect embedded raw dictionaries.
Local NFT sizes do not replace verification of the final Vercel deployment bundle.
