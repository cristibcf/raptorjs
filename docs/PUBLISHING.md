# Publicarea librăriilor pe npm

Stack-ul se publică în **6 pachete** (grupate pe categorie), nu câte unul per
modul. Fiecare expune granularitatea internă prin **subpath exports**, deci
consumatorul importă exact ce-i trebuie:

| Pachet | Conține | Subpath-uri |
|---|---|---|
| `raptorjs` | reactivitate + DOM + UI | `raptorjs`, `raptorjs/dom`, `raptorjs/dom/jsx-runtime`, `raptorjs/dom/testing`, `raptorjs/ui`, `raptorjs/ui/*` |
| `@raptor/wire` | protocolul binar | `@raptor/wire`, `/codec`, `/client`, `/server` |
| `@raptor/engine` | compiler + build + server runtime | `@raptor/engine`, `/compiler`, `/bundle`, `/profile`, `/run`, `/forge` (+ 5 bin-uri) |
| `@raptor/runtime` | contracte runtime + launcher | `@raptor/runtime`, `/cli` (bin `raptor-runtime`) |
| `@raptor/host` | contract host + adaptoare | `@raptor/host`, `/web`, `/desktop`, `/mobile`, `/cli`, `/service`, `/device` |
| `@raptor/test` | testare comportamentală | `@raptor/test` |

`@raptor/runtime-native` (Rust) nu se publică pe npm.

## Dev TS-native vs. dist compilat

Dezvoltarea rămâne **TS-native** (Node execută `.ts` direct, iar `exports` din
fiecare `package.json` arată spre `./src/*.ts`). Publicarea trimite spre `dist/`,
fără să atingă workflow-ul de dezvoltare:

- `exports` / `types` rămân spre `./src/*.ts` → `pnpm dev`, testele și
  type-stripping-ul merg neschimbat.
- `publishConfig.exports` / `main` / `types` / `bin` arată spre `./dist/*.js`.
  **pnpm** aplică aceste override-uri doar în manifestul publicat.
- `tsc` (deja în devDependencies, deci **zero dependență de runtime livrată**)
  compilează cu `rewriteRelativeImportExtensions`, care rescrie importurile
  relative `./x.ts` → `./x.js`. Subpath-urile bare (`@raptor/wire/codec`,
  `raptorjs/dom`) rămân neatinse și se rezolvă prin `exports` la consumator.
- `prepack` în fiecare pachet rulează build-ul automat înainte de `pack`/`publish`.
- `pnpm publish` transformă automat `workspace:*` în versiuni reale.

`typescript` e **peerDependency** la `@raptor/engine` (bundler-ul îl folosește ca
transform build-time, nu ca dependență livrată), deci teza „zero dependențe de
runtime" rămâne adevărată — `pnpm stats:check` o verifică.

## Cum publici

```bash
# 1. Autentificare (o singură dată)
npm login

# 2. (opțional) verificare fără upload — cere să fii logat
pnpm -r --filter "./packages/*" run build
npm run prepublish:check

# 3. Publicare a tot ce s-a schimbat, în ordine topologică
pnpm -r --filter "./packages/*" publish --access public
```

`publishConfig.access` e deja `public` în fiecare pachet.

## Versionare

npm refuză să republice o versiune existentă. Bumpuiește înainte de publish:

```bash
pnpm -r --filter "./packages/*" exec npm version patch --no-git-tag-version
```

sau individual cu `npm version patch|minor|major` în folderul pachetului.

## Metadata de repository

`repository` (cu `directory` per pachet), `homepage`, `bugs` și `author` sunt
setate în toate pachetele, legate de <https://github.com/cristibcf/raptorjs>.
Pagina npm a fiecărui pachet linkează astfel direct către folderul lui din
monorepo.
