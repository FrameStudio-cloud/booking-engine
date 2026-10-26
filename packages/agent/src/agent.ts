import { createGroq, groq } from "@ai-sdk/groq";
import { generateText, isStepCount } from "ai";
import { buildInstructions } from "./prompt";
import { createTools } from "./tools";
import type { AgentPort, AgentResult, ChatMessage } from "./types";

export const DEFAULT_MODEL = "openai/gpt-oss-120b";

export interface RunAgentOptions {
  model?: string;
  apiKey?: string;
  maxSteps?: number;
}

/**
 * One turn of the conversation. Stateless: pass the history, get a reply.
 * Persistence lives in the caller.
 */
export async function runAgent(
  port: AgentPort,
  history: ChatMessage[],
  options: RunAgentOptions = {},
): Promise<AgentResult> {
  if (history.length === 0) {
    throw new Error("runAgent needs at least one message");
  }

  const { tools, state } = createTools(port);
  const provider = options.apiKey ? createGroq({ apiKey: options.apiKey }) : groq;

  const { text } = await generateText({
    model: provider(options.model ?? DEFAULT_MODEL),
    instructions: buildInstructions(port),
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    tools,
    stopWhen: isStepCount(options.maxSteps ?? 6),
    temperature: 0.3,
  });

  return {
    text:
      text.trim() ||
      "Sorry — I didn't catch that. Could you say it another way?",
    escalated: state.escalated,
    bookingId: state.bookingId,
    toolCalls: state.calls,
  };
}
