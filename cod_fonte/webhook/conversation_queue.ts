import axios from 'axios';
import { env } from '../config/env';
import { handleUserMessage } from '../rag/agent';
import { log_error_event } from '../logging/logger';

export interface conversation_message_payload {
  account_id: number | string;
  conversation_id: number | string;
  sender_identifier: string;
  text: string;
}

export interface conversation_queue_entry {
  account_id: number | string;
  conversation_id: number | string;
  sender_identifier: string;
  buffered_messages: string[];
  is_processing: boolean;
  debounce_timer: NodeJS.Timeout | null;
  last_activity_timestamp: number;
}

export type message_processor = (
  account_id: number | string,
  conversation_id: number | string,
  sender_identifier: string,
  text: string
) => Promise<void>;

const conversation_queues = new Map<string, conversation_queue_entry>();

async function default_send_chatwoot_message(
  account_id: number | string,
  conversation_id: number | string,
  content: string
): Promise<void> {
  if (!env.CHATWOOT_API_TOKEN) {
    return;
  }

  const url = `${env.CHATWOOT_BASE_URL}/api/v1/accounts/${account_id}/conversations/${conversation_id}/messages`;

  await axios.post(
    url,
    {
      content,
      message_type: 'outgoing',
    },
    {
      headers: {
        api_access_token: env.CHATWOOT_API_TOKEN,
      },
      timeout: 10000,
    }
  );
}

async function default_message_processor(
  account_id: number | string,
  conversation_id: number | string,
  sender_identifier: string,
  text: string
): Promise<void> {
  const answer = await handleUserMessage(sender_identifier, text);
  await default_send_chatwoot_message(account_id, conversation_id, answer);
}

let active_message_processor: message_processor = default_message_processor;

export function set_message_processor(custom_processor: message_processor | null): void {
  active_message_processor = custom_processor || default_message_processor;
}

export function get_queue_entry(
  account_id: number | string,
  conversation_id: number | string
): conversation_queue_entry | undefined {
  const key = `${account_id}_${conversation_id}`;
  return conversation_queues.get(key);
}

export function get_active_queue_count(): number {
  return conversation_queues.size;
}

export function clear_all_queues(): void {
  for (const entry of conversation_queues.values()) {
    if (entry.debounce_timer) {
      clearTimeout(entry.debounce_timer);
      entry.debounce_timer = null;
    }
  }
  conversation_queues.clear();
}

async function process_queue(key: string): Promise<void> {
  const entry = conversation_queues.get(key);
  if (!entry) {
    return;
  }

  if (entry.is_processing) {
    return;
  }

  entry.is_processing = true;

  try {
    while (entry.buffered_messages.length > 0) {
      const messages_to_process = [...entry.buffered_messages];
      entry.buffered_messages = [];

      const combined_text = messages_to_process.join('\n');
      if (combined_text.trim().length === 0) {
        continue;
      }

      try {
        await active_message_processor(
          entry.account_id,
          entry.conversation_id,
          entry.sender_identifier,
          combined_text
        );
      } catch (error) {
        log_error_event(
          'CONVERSATION_QUEUE_PROCESSING_ERROR',
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error.stack : undefined,
          {
            conversation_key: key,
            account_id: entry.account_id,
            conversation_id: entry.conversation_id,
            sender_identifier: entry.sender_identifier,
            message_count: messages_to_process.length,
          }
        );
      }
    }
  } finally {
    entry.is_processing = false;
    if (entry.buffered_messages.length > 0) {
      void process_queue(key);
    } else if (!entry.debounce_timer) {
      conversation_queues.delete(key);
    }
  }
}

export function enqueue_conversation_message(payload: conversation_message_payload): void {
  const key = `${payload.account_id}_${payload.conversation_id}`;
  let entry = conversation_queues.get(key);

  if (!entry) {
    entry = {
      account_id: payload.account_id,
      conversation_id: payload.conversation_id,
      sender_identifier: payload.sender_identifier,
      buffered_messages: [],
      is_processing: false,
      debounce_timer: null,
      last_activity_timestamp: Date.now(),
    };
    conversation_queues.set(key, entry);
  }

  entry.buffered_messages.push(payload.text);
  entry.sender_identifier = payload.sender_identifier;
  entry.last_activity_timestamp = Date.now();

  if (entry.is_processing) {
    return;
  }

  if (entry.debounce_timer) {
    clearTimeout(entry.debounce_timer);
  }

  const delay_ms = env.QUEUE_DEBOUNCE_MS > 0 ? env.QUEUE_DEBOUNCE_MS : 0;

  if (delay_ms === 0) {
    void process_queue(key);
    return;
  }

  entry.debounce_timer = setTimeout(() => {
    const active_entry = conversation_queues.get(key);
    if (active_entry) {
      active_entry.debounce_timer = null;
      void process_queue(key);
    }
  }, delay_ms);
}
