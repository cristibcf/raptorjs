// Un server HTTP Raptor, rulat de binarul nativ - fara Node, fara tsc.
//
// Acopera randul "Servicii platforma" din etapa 3 a roadmap-ului.
//
// Bucla de acceptare este a aplicatiei, pentru ca motorul este inca sincron:
// cere urmatoarea cerere, raspunde, repeta. Forma `serve({ fetch })` din
// runtime-ul TypeScript ajunge odata cu bucla de evenimente - contractul de
// acolo nu se schimba, se adauga peste acesta.
import serve from "raptor:serve";
import observe from "raptor:observe";
import kv from "raptor:kv";

interface Nota {
  readonly text: string;
}

type Raspuns = { readonly status: number; readonly body: string };

/** Portul este fix, ca scriptul care testeaza serverul sa stie unde sa bata. */
const PORT = 8787;

/** Bucla este marginita, ca demo-ul sa se termine singur. */
const DE_SERVIT = 5;

function citesteNote(): Nota[] {
  return JSON.parse(kv.get("note") ?? "[]") as Nota[];
}

function ruteaza(metoda: string, cale: string, corp: string): Raspuns {
  const note = citesteNote();

  if (metoda === "GET" && cale === "/health") {
    return { status: 200, body: JSON.stringify({ status: "ok", note: note.length }) };
  }
  if (metoda === "GET" && cale === "/note") {
    return { status: 200, body: JSON.stringify(note) };
  }
  if (metoda === "POST" && cale === "/note") {
    let text: unknown;
    try {
      text = (JSON.parse(corp || "{}") as { text?: unknown }).text;
    } catch {
      return { status: 400, body: JSON.stringify({ eroare: "corp JSON invalid" }) };
    }
    if (typeof text !== "string" || text.trim() === "") {
      return { status: 400, body: JSON.stringify({ eroare: "campul 'text' este obligatoriu" }) };
    }
    const urmatoarele: Nota[] = [...note, { text: text.trim() }];
    kv.set("note", JSON.stringify(urmatoarele));
    return { status: 201, body: JSON.stringify({ salvate: urmatoarele.length }) };
  }

  return { status: 404, body: JSON.stringify({ eroare: `nicio ruta pentru ${metoda} ${cale}` }) };
}

kv.set("note", JSON.stringify([] as Nota[]));

const server = serve.listen({ port: PORT });
observe.log("info", "server.pornit", { port: server.port });

let servite = 0;
while (servite < DE_SERVIT) {
  const cerere = serve.next({ timeoutMs: 5000 });
  // `null` inseamna "nicio cerere in fereastra ceruta" - nu o eroare.
  if (cerere === null) break;

  const cale = cerere.target.split("?")[0] ?? "/";
  const raspuns = ruteaza(cerere.method, cale, cerere.body);
  serve.respond(cerere.id, {
    status: raspuns.status,
    headers: { "content-type": "application/json" },
    body: raspuns.body,
  });
  servite += 1;
}

serve.close();
observe.log("info", "server.oprit", { servite });

export const port: number = server.port;
export const cereriServite: number = servite;
export const noteFinale: number = citesteNote().length;
