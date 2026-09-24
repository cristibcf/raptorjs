# RaptorRuntime — host nativ

Binarul `raptor-runtime`, scris în Rust. Aici se atinge criteriul §3 etapa 1 din
roadmap: **pornește fără Node.js instalat**.

## Ce rulează acum

| Comandă | Fără motor (implicit) | Cu `--features quickjs` |
|---|---|---|
| `doctor` | nativ | nativ |
| `init`, `pack`, `explain` | nativ | nativ |
| `run` | cod 3: „nu în acest milestone" | **execută modulul** |
| `test`, `trace` | cod 3 | cod 3 |

## Build

```bash
cargo build --release --features full
```

| Feature | Ce adaugă | Binar |
|---|---|---|
| (implicit) | `doctor`, `init`, `pack`, `explain`, HTTP — **zero dependențe** | 964 KB |
| `quickjs` | evaluare de module JavaScript | 2.1 MB |
| `typescript` | eliminarea tipurilor, prin oxc | — |
| `full` | ambele — runtime-ul care poate lua locul lui `node` | 4.4 MB |

Build-ul implicit nu are **nicio** dependență externă (`cargo tree` arată doar cele
două crate-uri locale): cerința §12 de revizuire de licență și vulnerabilități
pentru fiecare dependență nativă se trece în modul cel mai ieftin. Motorul și
stripper-ul sunt singurele excepții, și sunt opt-in.

## Verificare: chiar rulează fără Node?

```bash
cargo build --release --features quickjs
./target/release/raptor-runtime run --cwd ../../examples/native-hello
```

Într-un mediu fără Node instalat (verificat în WSL Ubuntu, `which node` gol):

```
aplicatia a rulat in 13.7ms
  proiect    native-hello@0.1.0
  motor      quickjs
  exporturi  default, izolat, motorChiarRuleaza, rezultat, runtime
```

`--json` arată exporturile citite din modul — dovada că a fost **evaluat**, nu
doar parsat:

```json
{
  "rezultat": "suma(1+2+3+4+5) = 15",
  "runtime": "raptor:observe",
  "motorChiarRuleaza": true
}
```

## De ce QuickJS înaintea lui V8

Spec-ul §13 cere V8 „printr-un adaptor îngust", și acela rămâne ținta. Dar
adaptorul (`engine.rs`) există tocmai ca motorul să poată fi schimbat fără să
atingă nimic din aplicații. QuickJS se compilează din sursa C în ~60s și dă un
binar de 2.1 MB, deci dovedește independența de Node **acum**; V8 intră mai
târziu prin aceeași ușă.

Izolatul trăiește pe **firul lui** și primește comenzi pe un canal. Nu e un
ocol: `rquickjs::Runtime` nu se poate partaja între fire, iar `EngineAdapter`
cere `Send + Sync`. Soluția nu e un `unsafe impl` — e arhitectura corectă, un
izolat chiar aparține unui singur fir.

## Modulele `raptor:` sunt funcții native

`HostModule` poartă acum constante **și funcții**: fiecare apel din JavaScript
ajunge înapoi în Rust, trece prin **capability broker** și abia apoi atinge discul
sau mediul. Aici modelul de securitate încetează să fie o declarație:

| Modul | Stare |
|---|---|
| `observe` | `log`, `metric` — fără capabilitate (telemetria proprie nu e acces la exterior) |
| `files` | `readText`, `write`, `exists`, `list` — fiecare prin broker |
| `process` | `args`, `platform`, `env` (prin `env.read`) |
| `kv` | `get`, `set`, `delete`, `keys` |
| `capabilities` | `check`, `diagnostics` — aplicația întreabă fără să încerce |
| `net` | `fetch`, `allows` — prin `net.connect`; HTTP/1.1 propriu, fără TLS |
| `serve` | `listen`, `next`, `respond`, `status`, `close` — server HTTP real |
| `tasks` | raportează cinstit că nu este implementat |

Rulat pe `examples/native-hello`, cu `files.read` declarat doar pentru `./src`:

```json
{
  "octetiCititi": 1449,
  "fisiereInSrc": ["main.js"],
  "refuzInAfaraDomeniului": "raptor:capability/denied",
  "potCiti": true,
  "potScrie": false
}
```

Urma de audit a brokerului, din aceeași rulare:

```
files.read  src          -> PERMIS
files.read  main.js      -> PERMIS
files.read  package.json -> REFUZAT
files.write nou.txt      -> REFUZAT
```

Fișierul refuzat **există pe disc** — deci dacă refuzul n-ar funcționa, citirea ar
reuși. Erorile Raptor traversează granița ca excepții JavaScript cu același cod,
deci aplicația poate deosebi „nu ai voie" de „nu am putut".

## TypeScript rulat nativ

`.ts` și `.tsx` trec prin **oxc** — același lanț de unelte folosit deja de
`integrations/rolldown` pe latura JavaScript — înainte să ajungă la motor.
Pipeline: parser → semantic → transformer → codegen.

De ce nu un stripper cu expresii regulate: `a < b > c` este o comparație,
`f<T>(c)` este un apel generic, iar diferența se vede doar cu un parser adevărat.
Există un test exact pentru cazul ăsta.

Verificat pe un `.ts` real, cu interfețe, alias-uri, generice (`primul<T>`),
`!` și `as` — într-un mediu fără Node **și fără `tsc`**:

```
motor    quickjs, cu TypeScript
aplicatia a rulat in 24.7ms
```

Ce **nu** face: nu verifică tipuri și nu coboără sintaxa modernă. Verificarea de
tipuri rămâne a lui `tsc` la dezvoltare — runtime-ul execută, nu judecă.

O diferență față de Node merită știută: Node acceptă doar **sintaxă erasabilă**
(fără `enum`, `namespace`, parameter properties). oxc le transformă pe toate, deci
binarul nativ acceptă un superset. Cod care merge aici poate să nu meargă sub
`node --experimental-strip-types`.

## Un server Raptor, nativ

Criteriul §3 etapa 3 — *„Exemplu de server Raptor rulează pe runtime nativ"*.
[`examples/native-server`](../../examples/native-server) este TypeScript curat,
rulat de binar, fără Node și fără `tsc`. Cereri `curl` reale:

```
{"status":"ok","note":0}                    <- 200
{"salvate":1}                               <- 201
[{"text":"prima nota"},{"text":"a doua"}]   <- 200
{"eroare":"campul 'text' este obligatoriu"} <- 400
```

**Bucla de acceptare aparține aplicației**, și asta e o consecință directă a
motorului sincron — nu putem ține o funcție JavaScript ca handler și să o chemăm
din alt fir fără o buclă de evenimente:

```ts
const server = serve.listen({ port: 8787 });
const cerere = serve.next({ timeoutMs: 5000 });   // null = nicio cerere
if (cerere) serve.respond(cerere.id, { status: 200, body: "salut" });
```

Forma `serve({ fetch })` din runtime-ul TypeScript ajunge odată cu bucla de
evenimente; contractul de acolo nu se schimbă, se adaugă peste acesta.

Firul de acceptare trăiește lângă izolat, nu în el: o conexiune așteaptă răspunsul
aplicației și primește 504 dacă acesta nu vine în 30s, în loc să atârne.

### Limitele stack-ului HTTP

Scris peste `std::net`, fără dependențe. Ce **nu** are, și spune explicit:

- **TLS.** `https://` trece de verificarea de capabilitate (destinația e corectă)
  și eșuează apoi limpede. Un client care ar coborî tăcut la `http://` ar fi o
  gaură de securitate, nu o comoditate.
- **`transfer-encoding: chunked`** — refuzat, nu tăiat pe tăcute.
- HTTP/2, keep-alive, corpuri peste 8 MB.

## Ce lipsește

1. **Buclă de evenimente și promisiuni** — ar aduce `fetch` asincron și
   `serve({ fetch })`.
2. **TLS**, pentru `https`.
3. **`tasks`** — fabrica de task-uri există nativ, dar nu e încă legată la izolat.
4. **`test` și `trace`** așteaptă punctele de mai sus.

## Notă de mediu (Windows)

Pe această mașină `rustc.exe` este blocat la încărcarea DLL-ului
(`0xC0E90002`) de Smart App Control + Bitdefender; `cargo.exe` pornește, `rustc`
nu. Build-ul s-a făcut în **WSL2 Ubuntu**, unde toolchain-ul e curat. Vezi
secțiunea din `docs/NATIVE-HOSTS.md`.
