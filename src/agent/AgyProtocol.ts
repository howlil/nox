import { parseAgyUsage } from "./token-usage";
import type {
  AgentFailure,
  AgentFailureCode,
  AgentStreamEvent,
} from "../types";

export interface AgyProtocolState {
  conversationId?: string;
  sawText: boolean;
}

export interface AgyParsedLine {
  events: AgentStreamEvent[];
  state: AgyProtocolState;
  terminal: boolean;
}

export function encodeAgyUserMessage(prompt: string): string {
  return JSON.stringify({
    event: "user",
    message: {
      content: prompt,
    },
  }) + "\n";
}

function failure(
  message: string,
  code: AgentFailureCode = "process-failed",
): AgentFailure {
  return {
    code,
    message:
      code === "permission-required"
        ? "The agent runtime requires approval before it can continue."
        : code === "protocol-invalid"
          ? "The agent runtime returned an invalid response."
          : "The agent runtime could not complete the request.",
    diagnostic: message,
  };
}

function classifyFailure(message: string): AgentFailureCode {
  const normalized = message.toLowerCase();
  if (normalized.includes("permission") || normalized.includes("approval")) {
    return "permission-required";
  }
  if (normalized.includes("json") || normalized.includes("protocol")) {
    return "protocol-invalid";
  }
  return "process-failed";
}

export function parseAgyLine(
  line: string,
  previous: AgyProtocolState,
): AgyParsedLine {
  let obj: Record<string, unknown>;

  try {
    obj = JSON.parse(line);
  } catch {
    return {
      events: [],
      state: previous,
      terminal: false,
    };
  }

  const event = obj["event"] as string | undefined;

  if (event === "init") {
    const conversationId =
      (obj["conversation_id"] as string | undefined) ||
      ((obj["init"] as Record<string, unknown> | undefined)?.[
        "conversation_id"
      ] as string | undefined);

    return {
      events: [],
      state: {
        ...previous,
        conversationId: conversationId ?? previous.conversationId,
      },
      terminal: false,
    };
  }

  if (event === "step_update") {
    const update = obj["step_update"] as
      | Record<string, unknown>
      | undefined;
    const delta = update?.["text_delta"];

    if (typeof delta !== "string" || delta.length === 0) {
      return { events: [], state: previous, terminal: false };
    }

    return {
      events: [{ type: "text", content: delta }],
      state: { ...previous, sawText: true },
      terminal: false,
    };
  }

  if (event === "text") {
    const text = obj["text"];
    if (typeof text !== "string" || text.length === 0) {
      return { events: [], state: previous, terminal: false };
    }

    return {
      events: [{ type: "text", content: text }],
      state: { ...previous, sawText: true },
      terminal: false,
    };
  }

  if (event === "error") {
    const message = String(
      obj["error"] ?? "Unknown agent runtime error",
    );
    return {
      events: [
        {
          type: "failed",
          failure: failure(message, classifyFailure(message)),
        },
      ],
      state: previous,
      terminal: true,
    };
  }

  if (event !== "result") {
    return { events: [], state: previous, terminal: false };
  }

  const result = obj["result"] as Record<string, unknown> | undefined;
  const status = String(result?.["status"] ?? "").toUpperCase();
  const conversationId =
    (result?.["conversation_id"] as string | undefined) ||
    previous.conversationId;

  if (!status) {
    return {
      events: [
        {
          type: "failed",
          failure: failure(
            "AGY result is missing a terminal status.",
            "protocol-invalid",
          ),
        },
      ],
      state: { ...previous, conversationId },
      terminal: true,
    };
  }

  if (status === "CANCELED" || status === "CANCELLED" || status === "INTERRUPTED") {
    return {
      events: [{ type: "cancelled" }],
      state: { ...previous, conversationId },
      terminal: true,
    };
  }

  if (status && status !== "SUCCESS") {
    const message = String(
      result?.["error"] ??
        `AGY finished with status ${status} without an error message.`,
    );
    return {
      events: [
        {
          type: "failed",
          failure: failure(message, classifyFailure(message)),
        },
      ],
      state: { ...previous, conversationId },
      terminal: true,
    };
  }

  const events: AgentStreamEvent[] = [];
  const response = result?.["response"];
  let sawText = previous.sawText;

  if (!sawText && typeof response === "string" && response.length > 0) {
    events.push({ type: "text", content: response });
    sawText = true;
  }

  const usage = parseAgyUsage(result);
  if (usage) events.push({
    type: "usage", usage,
    conversationId,
    cumulative: true,
    turnCount: typeof result?.["num_turns"] === "number" ? result["num_turns"] : undefined,
    model: typeof result?.["model"] === "string" ? result["model"] : undefined,
  });

  events.push({
    type: "completed",
    conversationId,
  });

  return {
    events,
    state: {
      conversationId,
      sawText,
    },
    terminal: true,
  };
}
