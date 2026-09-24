/**
 * Starea partajata a listei de todo-uri. Un todo e un obiect "todo:ID"; ordinea
 * lor traieste separat, in colectia "order". Serverul nu trimite niciodata lista
 * intreaga: fiecare mutatie produce operatii (APPEND / PATCH / REMOVE) care
 * pleaca la toti abonatii.
 *
 * Fisierul asta nu stie nimic despre transport - se foloseste identic peste
 * WebSocket (src/server.ts) sau peste loopback (in teste).
 */
import { raptorServer, type RaptorServer } from "@raptor/server";

export const TODO_QUERY = "todos";

/**
 * Ce expune query-ul. "order" e potrivire exacta, "todo:" se termina cu
 * delimitator deci prinde toti copiii - vezi store.matches().
 */
export const TODO_PREFIXES = ["order", "todo:"];

export interface Todo {
  text: string;
  done: boolean;
}

export function buildTodoApp(): RaptorServer {
  const app = raptorServer({ build: "todo-realtime-0.1.0" });
  let counter = 0;

  app.query(TODO_QUERY, { select: () => TODO_PREFIXES });

  app.mutation("add", {
    // Refuzam textul gol pe server: clientul nu e singura aparare.
    authorize: ({ input }) => typeof (input as { text?: unknown }).text === "string",
    run: ({ input, store }) => {
      const text = String((input as { text: string }).text).trim();
      if (!text) throw new Error("text gol");
      const id = ++counter;
      store.setField(`todo:${id}`, "text", text);
      store.setField(`todo:${id}`, "done", false);
      store.append("order", id);
      return { id };
    },
  });

  app.mutation("toggle", {
    run: ({ input, store }) => {
      const { id } = input as { id: number };
      const todo = store.doc.get(`todo:${id}`) as Todo | undefined;
      if (!todo) throw new Error(`todo inexistent: ${id}`);
      // PATCH pe un singur camp: pe fir pleaca doar "done", nu tot obiectul.
      store.patch(`todo:${id}`, { done: !todo.done });
      return { id, done: !todo.done };
    },
  });

  app.mutation("remove", {
    run: ({ input, store }) => {
      const { id } = input as { id: number };
      const ids = (store.doc.get("order") as number[] | undefined) ?? [];
      const index = ids.indexOf(id);
      if (index < 0) return { id, removed: false };
      store.remove("order", index);
      return { id, removed: true };
    },
  });

  return app;
}
