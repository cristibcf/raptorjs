/**
 * The shared state of the todo list. A todo is a "todo:ID" object; their order
 * lives separately, in the "order" collection. The server never sends the whole
 * list: each mutation produces operations (APPEND / PATCH / REMOVE) that go out
 * to all subscribers.
 *
 * This file knows nothing about the transport - it is used identically over
 * WebSocket (src/server.ts) or over loopback (in tests).
 */
import { raptorServer, type RaptorServer } from "@raptorstack/wire/server";

export const TODO_QUERY = "todos";

/**
 * What the query exposes. "order" is an exact match, "todo:" ends with a
 * delimiter so it catches all children - see store.matches().
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
    // Reject empty text on the server: the client is not the only line of defense.
    authorize: ({ input }) => typeof (input as { text?: unknown }).text === "string",
    run: ({ input, store }) => {
      const text = String((input as { text: string }).text).trim();
      if (!text) throw new Error("empty text");
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
      if (!todo) throw new Error(`nonexistent todo: ${id}`);
      // PATCH on a single field: only "done" goes on the wire, not the whole object.
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
