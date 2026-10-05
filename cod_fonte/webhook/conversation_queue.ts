import axios from 'axios';
import { env } from '../config/env';
import { handleUserMessage } from '../rag/agent';
import { log_error_event } from '../logging/logger';
import { memory_rate_limiter } from '../security/rate_limiter';
import { is_conversation_in_human_handoff, send_chatwoot_message } from './chatwoot_client';
import { session_store, prisma_session_store } from '../persistence/session_store';
import { rate_limit_store, prisma_rate_limit_store } from '../persistence/rate_limit_store';

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

export type typing_status_sender = (
  account_id: number | string,
  conversation_id: number | string,
  status: 'on' | 'off'
) => Promise<void>;

export type chatwoot_message_sender = (
  account_id: number | string,
  conversation_id: number | string,
  content: string
) => Promise<void>;

export type queue_rate_limiter = rate_limit_store | memory_rate_limiter;

const max_buffered_messages_per_conversation = 20;
const conversation_queues = new Map<string, conversation_queue_entry>();

const default_session_store: session_store = new prisma_session_store();
let active_session_store: session_store = default_session_store;

const default_rate_limiter: queue_rate_limiter = new prisma_rate_limit_store();
let active_rate_limiter: queue_rate_limiter = default_rate_limiter;

async function default_send_chatwoot_message(
  account_id: number | string,
  conversation_id: number | string,
  content: string
): Promise<void> {
  await send_chatwoot_message(account_id, conversation_id, content);
}

let active_message_sender: chatwoot_message_sender = default_send_chatwoot_message;

async function default_message_processor(
  account_id: number | string,
  conversation_id: number | string,
  sender_identifier: string,
  text: string
): Promise<void> {
  const answer = await handleUserMessage(sender_identifier, text, {
    account_id,
    conversation_id,
  });
  await active_message_sender(account_id, conversation_id, answer);
}

async function default_send_chatwoot_typing_status(
  account_id: number | string,
  conversation_id: number | string,
  status: 'on' | 'off'
): Promise<void> {
  if (!env.CHATWOOT_API_TOKEN) {
    return;
  }

  const url = `${env.CHATWOOT_BASE_URL}/api/v1/accounts/${account_id}/conversations/${conversation_id}/toggle_typing_status`;

  try {
    await axios.post(
      url,
      {
        typing_status: status,
      },
      {
        headers: {
          api_access_token: env.CHATWOOT_API_TOKEN,
        },
        timeout: 4000,
      }
    );
  } catch {
    return;
  }
}

let active_message_processor: message_processor = default_message_processor;
let active_typing_sender: typing_status_sender = default_send_chatwoot_typing_status;
let custom_debounce_ms: number | null = null;
let custom_rate_limit_max: number | null = null;
let custom_rate_limit_window_ms: number | null = null;

export function set_session_store(custom_store: session_store | null): void {
  active_session_store = custom_store || default_session_store;
}

export function set_message_processor(custom_processor: message_processor | null): void {
  active_message_processor = custom_processor || default_message_processor;
}

export function set_typing_status_sender(custom_sender: typing_status_sender | null): void {
  active_typing_sender = custom_sender || default_send_chatwoot_typing_status;
}

export function set_chatwoot_message_sender(custom_sender: chatwoot_message_sender | null): void {
  active_message_sender = custom_sender || default_send_chatwoot_message;
}

export function set_queue_rate_limiter(custom_limiter: queue_rate_limiter | null): void {
  active_rate_limiter = custom_limiter || default_rate_limiter;
}

export function set_queue_rate_limit_policy(max_requests: number | null, window_ms: number | null): void {
  custom_rate_limit_max = max_requests;
  custom_rate_limit_window_ms = window_ms;
}

export function set_queue_debounce_ms(override_ms: number | null): void {
  custom_debounce_ms = override_ms;
}

function get_effective_debounce_ms(): number {
  if (custom_debounce_ms !== null) {
    return custom_debounce_ms > 0 ? custom_debounce_ms : 0;
  }
  return env.QUEUE_DEBOUNCE_MS > 0 ? env.QUEUE_DEBOUNCE_MS : 0;
}

function get_effective_rate_limit_policy(): { max_requests: number; window_ms: number } {
  const max_requests = custom_rate_limit_max !== null && custom_rate_limit_max > 0
    ? custom_rate_limit_max
    : (env.RATE_LIMIT_PHONE_MAX_REQUESTS > 0 ? env.RATE_LIMIT_PHONE_MAX_REQUESTS : 10);

  const window_ms = custom_rate_limit_window_ms !== null && custom_rate_limit_window_ms > 0
    ? custom_rate_limit_window_ms
    : (env.RATE_LIMIT_PHONE_WINDOW_MS > 0 ? env.RATE_LIMIT_PHONE_WINDOW_MS : 60000);

  return { max_requests, window_ms };
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
  void active_rate_limiter.reset();
}

export async function recover_pending_queues(): Promise<number> {
  try {
    const sessions = await active_session_store.list_sessions_with_pending();
    let scheduled_count = 0;

    for (const session of sessions) {
      if (is_conversation_in_human_handoff(session.account_id, session.conversation_id)) {
        await active_session_store.consume_pending_messages(session.account_id, session.conversation_id);
        continue;
      }

      const key = `${session.account_id}_${session.conversation_id}`;
      let entry = conversation_queues.get(key);

      if (!entry) {
        entry = {
          account_id: session.account_id,
          conversation_id: session.conversation_id,
          sender_identifier: session.sender_identifier,
          buffered_messages: [],
          is_processing: false,
          debounce_timer: null,
          last_activity_timestamp: Date.now(),
        };
        conversation_queues.set(key, entry);
      }

      schedule_queue_execution(key, 0);
      scheduled_count++;
    }

    return scheduled_count;
  } catch (error) {
    log_error_event(
      'CONVERSATION_QUEUE_RECOVERY_ERROR',
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined
    );
    return 0;
  }
}

function schedule_queue_execution(key: string, delay_ms: number): void {
  const entry = conversation_queues.get(key);
  if (!entry) {
    return;
  }

  if (entry.debounce_timer) {
    clearTimeout(entry.debounce_timer);
    entry.debounce_timer = null;
  }

  if (delay_ms <= 0) {
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

async function process_queue(key: string): Promise<void> {
  const entry = conversation_queues.get(key);
  if (!entry) {
    return;
  }

  if (entry.is_processing) {
    return;
  }

  if (is_conversation_in_human_handoff(entry.account_id, entry.conversation_id)) {
    await active_session_store.consume_pending_messages(entry.account_id, entry.conversation_id);
    entry.buffered_messages = [];
    conversation_queues.delete(key);
    return;
  }

  const messages_to_process = entry.buffered_messages.length > 0
    ? [...entry.buffered_messages]
    : await active_session_store.consume_pending_messages(entry.account_id, entry.conversation_id);

  entry.buffered_messages = [];
  void active_session_store.consume_pending_messages(entry.account_id, entry.conversation_id);

  if (messages_to_process.length === 0) {
    if (!entry.debounce_timer) {
      conversation_queues.delete(key);
    }
    return;
  }

  entry.is_processing = true;

  const combined_text = messages_to_process.join('\n');

  try {
    if (combined_text.trim().length > 0) {
      const sanitized_identifier = entry.sender_identifier.replace(/\D/g, '');
      const rate_limit_key = `phone:${sanitized_identifier.length > 0 ? sanitized_identifier : entry.sender_identifier.trim()}`;
      const policy = get_effective_rate_limit_policy();
      const rate_result = await active_rate_limiter.consume(rate_limit_key, policy.max_requests, policy.window_ms);

      if (!rate_result.allowed) {
        log_error_event(
          'CONVERSATION_QUEUE_RATE_LIMIT_EXCEEDED',
          `Limite de mensagens excedido para o remetente ${entry.sender_identifier}`,
          undefined,
          {
            account_id: entry.account_id,
            conversation_id: entry.conversation_id,
            sender_identifier: entry.sender_identifier,
            retry_after_seconds: rate_result.retry_after_seconds,
          }
        );

        const rate_limit_message = 'Limite de mensagens atingido. Por favor, aguarde alguns instantes antes de enviar novas mensagens.';
        await active_message_sender(entry.account_id, entry.conversation_id, rate_limit_message);
        return;
      }

      try {
        await active_typing_sender(entry.account_id, entry.conversation_id, 'on');
      } catch {
      }

      try {
        await active_message_processor(
          entry.account_id,
          entry.conversation_id,
          entry.sender_identifier,
          combined_text
        );
      } finally {
        try {
          await active_typing_sender(entry.account_id, entry.conversation_id, 'off');
        } catch {
        }
      }
    }
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
  } finally {
    entry.is_processing = false;

    if (entry.buffered_messages.length > 0) {
      const delay_ms = get_effective_debounce_ms();
      const elapsed_since_last_message = Date.now() - entry.last_activity_timestamp;
      const remaining_delay = Math.max(0, delay_ms - elapsed_since_last_message);
      schedule_queue_execution(key, remaining_delay);
    } else if (!entry.debounce_timer) {
      conversation_queues.delete(key);
    }
  }
}

export function enqueue_conversation_message(payload: conversation_message_payload): void {
  if (is_conversation_in_human_handoff(payload.account_id, payload.conversation_id)) {
    return;
  }

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

  if (entry.buffered_messages.length < max_buffered_messages_per_conversation) {
    entry.buffered_messages.push(payload.text);
  }

  entry.sender_identifier = payload.sender_identifier;
  entry.last_activity_timestamp = Date.now();

  void active_session_store.append_pending_message(
    payload.account_id,
    payload.conversation_id,
    payload.sender_identifier,
    payload.text,
    max_buffered_messages_per_conversation
  ).catch((error) => {
    log_error_event(
      'PENDING_MESSAGE_PERSISTENCE_ERROR',
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined,
      { account_id: payload.account_id, conversation_id: payload.conversation_id }
    );
  });

  if (entry.is_processing) {
    return;
  }

  const delay_ms = get_effective_debounce_ms();
  schedule_queue_execution(key, delay_ms);
}
