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
 * The model occasionally degenerates into punctuation runs ("Good ......").
 * That is not a reply a customer should ever receive.
 */
export function isDegenerate(text: string): boolean {
  if (!/[a-z]/i.test(text)) return true;
  if (/\.{4,}/.test(text)) return true;

  const letters = (text.match(/[a-z]/gi) ?? []).length;
  return letters / text.length < 0.4;
}

export const FALLBACK_REPLY = "Sorry — I didn't catch that. Could you say it another way?";

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

  const trimmed = text.trim();

  return {
    text: trimmed.length === 0 || isDegenerate(trimmed) ? FALLBACK_REPLY : trimmed,
    escalated: state.escalated,
    bookingId: state.bookingId,
    toolCalls: state.calls,
  };
}
