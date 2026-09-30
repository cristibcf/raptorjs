// A Raptor HTTP server, run by the native binary - no Node, no tsc.
//
// Covers the "Platform services" row of stage 3 of the roadmap.
//
// The accept loop belongs to the app, because the engine is still synchronous:
// request the next request, respond, repeat. The `serve({ fetch })` form from the
// TypeScript runtime arrives together with the event loop - the contract there
// does not change, it is added on top of this one.
import serve from "raptor:serve";
import observe from "raptor:observe";
import kv from "raptor:kv";

interface Nota {
  readonly text: string;
}

type Raspuns = { readonly status: number; readonly body: string };

/** The port is fixed, so the script that tests the server knows where to knock. */
const PORT = 8787;

/** The loop is bounded, so the demo ends on its own. */
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
      return { status: 400, body: JSON.stringify({ eroare: "invalid JSON body" }) };
    }
    if (typeof text !== "string" || text.trim() === "") {
      return { status: 400, body: JSON.stringify({ eroare: "the 'text' field is required" }) };
    }
    const urmatoarele: Nota[] = [...note, { text: text.trim() }];
    kv.set("note", JSON.stringify(urmatoarele));
    return { status: 201, body: JSON.stringify({ salvate: urmatoarele.length }) };
  }

  return { status: 404, body: JSON.stringify({ eroare: `no route for ${metoda} ${cale}` }) };
}

kv.set("note", JSON.stringify([] as Nota[]));

const server = serve.listen({ port: PORT });
observe.log("info", "server.pornit", { port: server.port });

let servite = 0;
while (servite < DE_SERVIT) {
  const cerere = serve.next({ timeoutMs: 5000 });
  // `null` means "no request within the requested window" - not an error.
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
