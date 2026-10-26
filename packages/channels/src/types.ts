import type {
  Channel as ChannelName,
  ConversationStatus,
  MessageRole,
  OutboundMessage,
} from "@booking/shared";

/** What the model sees. Identical on every channel. */
export interface BotMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * The second seam. Telegram, the widget and (later) WhatsApp all implement
 * this, so the pipeline never learns which chat network it is talking to.
 */
export interface Channel {
  readonly name: ChannelName;
  send(externalId: string, message: OutboundMessage): Promise<void>;
}

/** Normalized inbound message: one shape for every transport. */
export interface InboundEvent {
  tenantId: string;
  channel: ChannelName;
  /** Telegram chat id, widget session id, WhatsApp wa_id. */
  externalId: string;
  text: string;
  customerName?: string | null;
}

export interface ConversationHandle {
  id: string;
  status: ConversationStatus;
}

export interface ConversationStore {
  getOrCreate(event: InboundEvent): Promise<ConversationHandle>;
  append(conversationId: string, role: MessageRole, content: string): Promise<void>;
  history(conversationId: string, limit: number): Promise<BotMessage[]>;
  setStatus(conversationId: string, status: ConversationStatus): Promise<void>;
}

export interface AgentRunner {
  run(history: BotMessage[]): Promise<{ text: string; escalated: boolean }>;
}

export interface PipelineLogger {
  info(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface PipelineDeps {
  store: ConversationStore;
  agent: AgentRunner;
  channel: Channel;
  historyLimit?: number;
  logger?: PipelineLogger;
}
