# RaptorRuntime - contractele de host

Implementarea specificatiei *RaptorRuntime Product and Architecture Specification*
pentru **milestone-ul 0 (architecture spike)**, plus fundatia milestone-ului 1.

Pachetul nu porneste nimic de la sine si nu are dependente. Expune contractele pe
care le consuma launcher-ul `@raptor/runtime/cli` si, mai tarziu, host-ul nativ.

## Ce contine

| Componenta (spec §5) | Modul | Stare |
| --- | --- | --- |
| Launcher | `@raptor/runtime/cli` | `run`, `test`, `init`, `pack`, `doctor`, `trace` |
| Engine adapter | `src/engine-adapter.ts` | adaptor de bootstrap, cu izolare per izolat |
| Module graph | `src/graph.ts` | graf static pentru `doctor` si `pack` |
| Capability broker | `src/capabilities.ts` | granular, revocabil, delegare explicita |
| Task fabric | `src/tasks.ts` | anulare, deadline-uri, cote, drenare |
| Platform services | `src/modules/` | `files`, `net`, `process`, `kv`, `serve` |
| Telemetry core | `src/observe.ts` | loguri, span-uri, metrici; export OTLP |

Spatiul de nume `raptor:` (spec §6) este expus ca module reale, cu tipuri in
[`src/raptor-modules.d.ts`](src/raptor-modules.d.ts) - deci `import { readText }
from "raptor:files"` se verifica in `tsc`, fara declaratii scrise de mana.

## Modelul de securitate (spec §7)

Implicit totul este refuzat, cu doua exceptii adnotate in trace (`clock.real`,
`crypto.random`) si un singur domeniu implicit: citirea in radacina proiectului.
`policy: "production"` - sau `--policy production` - trece brokerul in **regim
strict**, unde nici acel domeniu implicit nu mai exista.

```json
{
  "capabilities": {
    "files.read": ["./src", "./assets"],
    "files.write": ["./.raptor", "./dist"],
    "net.connect": ["api.example.com:443", "*.intern.example.com:*"],
    "env.read": ["DATABASE_URL", "RAPTOR_*"],
    "process.spawn": ["git"]
  }
}
```

Delegarea catre un izolat copil transmite **doar** subsetul cerut explicit;
nimic nu se mosteneste ambiental, iar o capability revocata nu poate fi reinviata
prin delegare.

## Ce nu este inca implementat

Spec-ul §13 recomanda Rust + V8 pentru host-ul nativ. Acesta este pasul urmator,
nu ce livreaza pachetul de fata. Concret, raman deschise:

- **Host nativ si binar autonom** (§5, §10). Adaptorul de bootstrap ruleaza pe
  motorul deja prezent pe masina de dezvoltare. Criteriul "porneste fara Node.js
  instalat" este criteriul de iesire al milestone-ului 0 si nu este atins aici.
- **Puntea npm** (§8). `pack` refuza explicit proiectele cu pachete externe, in
  loc sa le ambaleze partial.
- **Confirmarea interactiva** a accesului nedeclarat (§7). Politica `prompt` se
  comporta ca `deny` pana cand host-ul nativ are canal propriu de prompt.
- **Distributie semnata** (§10): instalatoare, canale de update, provenienta.

## Comenzi

```bash
pnpm runtime doctor           # mediu, proiect, capabilitati, graf static
pnpm runtime -- --help        # suprafata completa de comenzi
pnpm spike                    # ruleaza spike-ul de arhitectura (spec §14)
pnpm spike:checks             # lista de acceptanta, prin `raptor-runtime test`
pnpm test:runtime             # suitele de contract ale celor doua pachete
```

## Integrarea cu depozitul (spec §9)

Aditiva, fara schimbari in pachetele existente: binarul se numeste
`raptor-runtime`, nu `raptor`, iar `@raptor/engine/run`, `@raptor/engine/bundle` si
`@raptor/engine` isi pastreaza comenzile si caile de import. Redenumirea vine
doar dupa auditul de compatibilitate (§2, §13).
