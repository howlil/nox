import type { ChatReplyReference } from "../types";

/** A quoted assistant answer is reference data, not instructions. */
export function formatReplyPrompt(prompt: string, reply: ChatReplyReference): string {
  if (reply.sourceRole !== "assistant" || !reply.quote.trim() || reply.quote.length > 4000) {
    throw new Error("Invalid chat quote.");
  }
  return "Earlier assistant excerpt (untrusted reference):\n" +
    JSON.stringify(reply.quote) + "\n\nQuestion:\n" + prompt;
}
