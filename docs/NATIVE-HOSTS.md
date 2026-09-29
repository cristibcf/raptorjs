# Host-uri: desktop, mobile, browser, serviciu, terminal și plachetă

Ghid pentru stratul „Host" din roadmap (§4, §6, §8): ce există acum, ce
contract respectă și unde se oprește implementarea curentă.

Roadmap-ul numește „host nativ" doar desktopul și mobilul. Celelalte două ținte
au și ele un host, doar că altfel: pentru `web`, §4 spune explicit că **host-ul este
browserul**; pentru `server`, host-ul este **supervizorul de proces** care
deschide sockeții, aduce configurația și cere oprirea — exact rândul „Servicii
platformă" din etapa 3 (§3); pentru `cli`, host-ul este **terminalul**, care
dă argumentele, fluxurile de ieșire, Ctrl-C și codul de ieșire; iar pentru
`embedded`, **firmware-ul plachetei**, care dă pini, magistrale și somn — și care,
singurul dintre toate, nu are încredere în aplicație. Același contract e implementat
și acolo ([`@raptor/host/web`](../packages/web-host)), cu o precizare care nu
trebuie pierdută: în browser puntea dă **portabilitate, nu izolare** — pagina și
host-ul sunt același izolat, iar granița reală rămâne sandbox-ul de origine al
browserului. Pe desktop și pe mobil, unde puntea traversează un proces, refuzul
host-ului chiar este o graniță de securitate.

## Ce există și ce nu

| Parte | Stare | Unde |
|---|---|---|
| Matricea de capabilități (§6) | **Implementată**, transcrisă ca date și testată rând cu rând | [`@raptor/host`](../packages/host) |
| Manifestul graniței native `raptor.host.json` | **Implementat**: parser cu diagnostice cumulate, round-trip stabil | `packages/host/src/manifest.ts` |
| Puntea JS ↔ host (protocol, transport, lifecycle) | **Implementată**, cu host de referință în proces | `packages/host/src/{protocol,bridge,host-server}.ts` |
| Adaptor desktop (ferestre, meniuri, deep links, notificări, stocare, update) | **Implementat ca host de referință** | [`@raptor/host/desktop`](../packages/desktop) |
| Adaptor mobile (navigare, stocare securizată, lifecycle, deep links, module opționale) | **Implementat ca host de referință** | [`@raptor/host/mobile`](../packages/mobile) |
| Adaptor browser (History API, localStorage, Notification, Geolocation) | **Implementat**; portabilitate, nu izolare | [`@raptor/host/web`](../packages/web-host) |
| Adaptor de serviciu (sockeți, configurație, sănătate, drenare) | **Implementat**, cu server `node:http` real | [`@raptor/host/service`](../packages/service-host) |
| Adaptor de terminal (argv, fluxuri, TTY, confirmări, cod de ieșire) | **Implementat**, cu binar rulabil | [`@raptor/host/cli`](../packages/cli-host) |
| Adaptor de plachetă (pini, magistrale, somn, watchdog, OTA) | **Implementat**, cu placă simulată | [`@raptor/host/device`](../packages/device-host) |
| Împachetare + workflow de instalatoare | **Plan generat**, determinist, din care iese CI-ul | `packages/*/src/packaging.ts`, `@raptor/engine/forge` |
| **Binarul nativ în Rust** — `doctor`/`init`/`pack` și **`run` cu motor QuickJS** | **Rulează fără Node** | [`packages/runtime-native`](../packages/runtime-native) |
| Stripping TypeScript nativ, module `raptor:` ca funcții, WebView-urile native | **Nu există** | — |
| **Comanda `raptor-package`** care construiește efectiv instalatoarele | **Nu există** | — |

## Binarul nativ chiar rulează

Criteriul §3 etapa 1 — *„pornește fără Node.js instalat”* — **este atins** pentru
`run`. Într-un mediu fără Node (WSL Ubuntu, `which node` gol):

```
aplicatia a rulat in 13.7ms
  proiect    native-hello@0.1.0
  motor      quickjs
  exporturi  default, izolat, motorChiarRuleaza, rezultat, runtime
```

Exporturile citite din modul (`rezultat: "suma(1+2+3+4+5) = 15"`) dovedesc că
modulul a fost **evaluat**, nu doar parsat. Detalii și limite în
[`packages/runtime-native/README.md`](../packages/runtime-native/README.md).

Modulele `raptor:` sunt funcții native care trec prin capability broker, iar
TypeScript-ul se elimină cu oxc înainte de motor — deci `.ts` rulează nativ, fără
Node și fără `tsc`.

`net` și `serve` sunt și ele native: un server Raptor scris în TypeScript rulează
pe binar și răspunde la `curl` — criteriul §3 etapa 3.

Ce rămâne: bucla de evenimente (pentru `fetch` asincron și `serve({ fetch })`),
TLS, `tasks` legat la izolat, și WebView-urile din adaptoarele desktop/mobile.

## Cele două manifeste

Un proiect nativ are două fișiere, nu unul, pentru că descriu lucruri diferite:

- **`raptor.runtime.json`** — ce are voie *aplicația* (punct de intrare, politică,
  fișiere, rețea, subprocese). Îl citește RaptorRuntime.
- **`raptor.host.json`** — ce îi cere aplicația *sistemului de operare*: țintă,
  identitate de bundle, fereastră, scheme de deep link, canal de actualizări,
  identitate de semnare, module native opționale. Îl citește adaptorul.

Se compun: capabilitatea `process.spawn` din manifestul de host spune *dacă*
aplicația poate porni procese; lista `capabilities["process.spawn"]` din
manifestul de runtime spune *care* comenzi. Fără amândouă, apelul e refuzat.

```bash
pnpm raptor:create "Notes Desk" --target desktop --bundle-id com.exemplu.notite
```

generează ambele fișiere, plus `hosts/desktop/` (granița + descriptorul de
împachetare) și `.github/workflows/installers.yml`.

## Matricea de capabilități (§6)

| Capabilitate | Desktop | Mobile | Web | Server | CLI | Embedded |
|---|---|---|---|---|---|---|
| `app.storage` | da | da | da | da | da | da |
| `net.connect` | da | da | da | da | da | opțional |
| `window.manage` | da | **nu** | opțional | **nu** | **nu** | **nu** |
| `device.camera`, `device.location` | opțional | opțional | opțional | **nu** | **nu** | **nu** |
| `process.spawn` | opțional | **nu** | **nu** | opțional | opțional | **nu** |
| `device.notifications`, `device.files` | opțional | opțional | opțional | **nu** | **nu** | **nu** |
| `net.listen` | **nu** | **nu** | **nu** | opțional | opțional | opțional |
| `service.config` | **nu** | **nu** | **nu** | opțional | **nu** | **nu** |
| `tty.interact` | **nu** | **nu** | **nu** | **nu** | opțional | **nu** |
| `hw.gpio`, `hw.bus`, `power.sleep` | **nu** | **nu** | **nu** | **nu** | **nu** | opțional |

Politica fiecărui rând se schimbă cu ținta — `app.storage` înseamnă directorul
aplicației pe desktop, originea paginii pe web, directorul de config pe CLI și o
partiție de NVS pe plachetă; codul le ține în `policies`, nu în comentarii.

Coloanele Desktop și Mobile sunt transcrierea tabelului §6. Coloanele Web,
Server, CLI și Embedded, plus ultimele patru rânduri, sunt **derivate** — marcate
ca atare în cod (`NATIVE_TARGETS`, `source: "derived"`, `policies`), ca să nu fie
citite ca spec.

Trei reguli care nu se negociază:

1. **`unavailable` nu se poate declara.** Un `raptor.host.json` de mobil care cere
   `process.spawn` e invalid — nu „acceptat și ignorat".
2. **`optional` cere declarare explicită.** Camera nedeclarată nu există.
3. **Verificarea se face de două ori.** Puntea din JS refuză devreme, ca mesajul
   să fie bun; host-ul refuză din nou, pentru că el e granița reală — puntea
   rulează în același izolat cu aplicația și poate fi ocolită.

## Puntea

Protocol JSON pe linie, cu patru tipuri de cadre: `call`, `result`, `failure`,
`event`. Cererile sunt corelate prin id, deci apelurile concurente nu-și încurcă
răspunsurile; evenimentele (lifecycle, deep links, comenzi de meniu) curg
dinspre host fără cerere.

```ts
import { createBridge, createMemoryChannel } from "@raptor/host";
import { createDesktopHost } from "@raptor/host/desktop";

const channel = createMemoryChannel();          // în producție: stdio / mesajele WebView-ului
const host = createDesktopHost({ manifest, transport: channel.host });
const bridge = createBridge({ target: "desktop", capabilities: manifest.capabilities, transport: channel.app });

await bridge.call("window.open", { title: "Aplicație" });
bridge.on("deeplink.received", (payload) => console.log(payload.url));
```

Aplicația primește **doar** obiectul `bridge` — niciodată transportul. Un modul
opțional lipsă nu e o eroare fatală: `bridge.allows("notify.show")` spune dinainte
dacă funcția există pe instalarea curentă.

`allows` răspunde însă doar la întrebarea de capabilitate. Ce poate host-ul *chiar*
să facă se află din `bridge.supported()`, care adaugă și ce implementează adaptorul:
`menu.set` trece de capabilitatea `window.manage` și pe web, dar un browser nu are
bară de meniu — o interfață care își desenează singură opțiunile pe `allows` ar
promite ceva inexistent.

Aceeași aplicație, legată pe rând de toate cele șase host-uri:
[`desktop-shell`](../examples/desktop-shell) (`pnpm demo:desktop`),
[`mobile-shell`](../examples/mobile-shell) (`pnpm demo:mobile`),
[`web-shell`](../examples/web-shell) (`pnpm demo:web-host`, sau `pnpm dev:web-shell`
pentru varianta din browser) , [`service-shell`](../examples/service-shell)
(`pnpm demo:service`) , [`cli-shell`](../examples/cli-shell) (`pnpm demo:cli`)
și [`device-shell`](../examples/device-shell) (`pnpm demo:device`).
Rulate una după alta, se vede ce rămâne la fel — aceeași punte, aceleași semnale,
aceeași stare reactivă — și ce se schimbă: cine conduce navigarea, dacă există
suspendare, și ce module lipsesc cu totul.

## Lifecycle

`launching → ready → foreground ⇄ background → suspended → stopped`

Vocabularul e comun, drumurile nu: telefonul suspendă și reia, desktopul de
obicei nu. Sariturile ilegale sunt erori (`raptor:host/lifecycle`), nu stări noi,
ca aplicația să nu ajungă niciodată într-o stare pe care nu a anticipat-o.

Pe mobil, `lifecycle.requestStop` trimite aplicația în fundal și lasă sistemul să
decidă suspendarea — o aplicație de telefon nu se închide singură.

## Navigarea: diferența esențială dintre ținte

Pe **desktop**, aplicația deschide ferestre și navighează — dar numai către
originile din `allowedOrigins` sau către propria unitate ambalată. O navigare în
afara listei e refuzată și starea ferestrei rămâne neschimbată.

Pe **mobil**, navigarea aparține adaptorului. Aplicația nu cere ecrane; primește
`navigation.changed` și reacționează. Motivul e butonul de back al sistemului:
dacă stiva ar fi în JavaScript, adaptorul n-ar putea răspunde corect la un gest
care nu trece prin JavaScript.

A **citi** ruta rămâne permis — `navigation.current` — pentru că altfel aplicația
n-ar ști ce desenează la pornire (adaptorul poate porni pe alt ecran, de exemplu
după un deep link) sau după o reluare din suspendare. Nu există, în schimb, nicio
metodă prin care aplicația să ceară o rută: citirea nu e control.

În **browser**, navigarea e împărțită, și asta e a treia situație distinctă: pagina o
poate conduce (History API, prin `window.navigate`, tot mărginită de
`allowedOrigins`), dar utilizatorul o poate schimba de sub ea cu butonul de back
al browserului. Adaptorul ascultă `popstate` și emite `navigation.changed` — exact
ca pe mobil — deci aplicația scrie o singură dată logica de rută, pentru toate trei.

## Serviciul: sockeți în loc de ferestre

Pe server nu există interfață grafică, deci nici jumătate din matrice. Ce dă
host-ul în schimb sunt trei lucruri, și fiecare e o decizie, nu un detaliu:

1. **Aplicația nu deschide porturi.** Cere un listener *pe nume*
   (`serve.listen { name: "public" }`), iar portul îl știe host-ul din alocarea de
   deployment. Un serviciu care își alege singur portul nu poate fi așezat într-un
   supervizor care i-l dă gata deschis (systemd socket activation, un sidecar).
2. **Oprirea e drenare, nu tăiere.** `foreground` înseamnă „primește trafic";
   SIGTERM trece serviciul în `background` — nu mai intră cereri noi (503 pe ce
   apucă să atingă socketul), se termină cele în zbor — și abia apoi `stopped`.
3. **Sănătatea o declară aplicația**, prin `health.set`. Host-ul nu ghicește dacă
   procesul e gata de trafic. Singura stare pe care aplicația nu și-o poate da
   este `draining`: aceea o pornește semnalul supervizorului.

Cererile traversează puntea ca evenimente `serve.request` și se întorc prin
`serve.respond`, pentru că puntea transportă doar JSON. Pare un ocol față de un
handler apelat direct — și este, în host-ul de referință — dar e exact drumul pe
care îl va face o cerere când host-ul va fi un proces separat.

## Terminalul: întrebarea care nu are cine să o răspundă

Pe `cli`, host-ul dă argumentele, două fluxuri de ieșire, ce știe despre terminal
(lățime, culoare, `NO_COLOR`), Ctrl-C și codul de ieșire. Două reguli:

1. **Fără terminal interactiv, o întrebare este refuzată, nu presupusă.**
   `tty.interact` poate fi declarată în manifest, dar dacă stdin nu e un TTY (CI,
   pipe, cron) apelul tot pică — cu `capability-unavailable`, ca unealta să poată
   răspunde „rulă-mă cu `--yes`" în loc să presupună „da" la o comandă distructivă.
   Este aceeași disciplină pe care o aplică și politica runtime-ului când
   degradează `prompt` la `deny` în lipsa unui terminal.
2. **Ctrl-C este eveniment, nu execuție.** Prima apăsare anunță aplicația
   (`cli.interrupt`), ca să apuce să curețe; a doua oprește cu 130.

Codul de ieșire nu e dat direct procesului: se cere host-ului prin `cli.exit`,
și doar binarul îl pune în `process.exitCode`. Așa, unealta se poate testa în
proces, fără terminal — [`examples/cli-shell`](../examples/cli-shell) are și
teste în proces, și unul care chiar pornește binarul.

## Placheta: host-ul care nu are încredere în aplicație

`embedded` este ținta cea mai depărtată de roadmap — nu apare nicăieri în el, iar
coloana ei este în întregime derivată. Rostul ei nu e să acopere un rând din spec,
ci să încerce modelul acolo unde s-ar putea rupe. Trei lucruri pe care celelalte
cinci ținte nu le cer deloc:

1. **Watchdog.** Pe celelalte ținte, o aplicație blocată rămâne doar blocată.
   Pe o plachetă dintr-un dulap de tablou, asta nu e o opțiune. `watchdog.pet` e
   singura metodă din tot contractul care **nu poate cere capabilitate**: una
   care s-ar putea refuza ar transforma exact mecanismul care salvează produsul
   într-unul opțional. Când fereastra expiră, host-ul resetează — iar un apel
   întârziat de la aplicația dispărută primește un refuz limpede, nu o eroare de
   tranziție.
2. **Periferice per instanță.** Nu „are voie la GPIO", ci „are voie la pinul 2,
   ca ieșire". Capabilitatea deschide ușa, harta de hardware spune care pini și
   ce direcție — același model ca lista de comenzi pentru `process.spawn` pe
   desktop. O scriere pe un pin declarat ca intrare e refuzată *înainte* de
   hardware, pentru că pe o placă reală poate însemna un scurt.
3. **Somn adevărat.** `suspended` nu mai e o metaforă: ceasul aplicației se
   oprește, watchdog-ul nu curge, iar fereastra repornește de la trezire. Altfel
   orice placă care economisește bateria s-ar reseta singură.

Actualizarea are al șaselea model din tot setul: OTA cu **rollback**. Imaginea
nouă pornește neconfirmată, și dacă nu confirmă că a pornit bine, următorul reset
o dă înapoi — altfel un firmware stricat ar transforma produsul în cărămidă.

## Împachetare și CI

`packaging.json` iese din adaptor, nu e scris de mână: pentru fiecare platformă
listează artefactele, arhitecturile, runner-ul de CI și ce **nu poate fi publicat
nesemnat**. Numele artefactelor sunt parte din contract
(`<bundleId>-<versiune>-<platformă>-<arhitectură>.<ext>`), pentru că de ele se
leagă și feed-ul de actualizări, și verificarea semnăturii.

Distincția dintre `required` și `store` e importantă: un `.msi` trebuie semnat de
CI-ul echipei, un `.ipa` e semnat de profilul de provisioning al magazinului.
Workflow-ul generat referă secretele de semnare, dar nu le dă niciodată o valoare
implicită — un build care produce tăcut artefacte nesemnate e mai rău decât unul
care pică.

## Ordinea din roadmap (§8)

1. ✅ Spike-ul RaptorRuntime și contractele lui de test — pe motorul de bootstrap
2. ✅ `raptor.runtime.json` (runtime) și `raptor.host.json` (graniță nativă)
3. ✅ O aplicație RaptorJS rulând prin punte, cu host de referință
4. ✅ Adaptorul desktop cu aplicație demo
5. ✅ RaptorForge cu împachetare, apoi adaptorul mobil
6. ⬜ **Binarul nativ** (Rust + WebView + launcher) și `raptor-package`

Pasul 6 este cel care transformă „host de referință" în „host". Până atunci,
criteriul de ieșire al etapei 1 din §3 — *„pornește fără Node.js instalat"* — nu
este atins și nu trebuie prezentat ca atins: tot ce rulează acum rulează pe
motorul deja prezent pe mașina de dezvoltare.
