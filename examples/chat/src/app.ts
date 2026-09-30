/**
 * Chat server: messages are "message:ID" objects, their order lives in the
 * "messages" collection. Operations: APPEND on send, PATCH on status (sent ->
 * delivered -> read), REMOVE on delete (whitepaper 26.2, Appendix A.3).
 */
import { raptorServer, type RaptorServer } from "@raptor/wire/server";

export const CHAT_QUERY = "chat";
export const CHAT_PREFIXES = ["messages", "message:"];

export function buildChatApp(): RaptorServer {
  const app = raptorServer({ build: "chat-0.1.0" });
  let counter = 0;

  app.query(CHAT_QUERY, { select: () => CHAT_PREFIXES });

  app.mutation("send", {
    run: ({ input, store }) => {
      const { from, text } = input as { from: string; text: string };
      const id = ++counter;
      store.setField(`message:${id}`, "from", from);
      store.setField(`message:${id}`, "text", text);
      store.setField(`message:${id}`, "status", "sent");
      store.append("messages", id);
      return { id };
    },
  });

  app.mutation("setStatus", {
    run: ({ input, store }) => {
      const { id, status } = input as { id: number; status: string };
      store.patch(`message:${id}`, { status });
      return { id, status };
    },
  });

  app.mutation("deleteMessage", {
    run: ({ input, store }) => {
      const { id } = input as { id: number };
      const ids = (store.doc.get("messages") as number[] | undefined) ?? [];
      const index = ids.indexOf(id);
      if (index >= 0) store.remove("messages", index);
      return { id, removed: index >= 0 };
    },
  });

  return app;
}
