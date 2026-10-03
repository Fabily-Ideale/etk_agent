import axios from 'axios';
import { env } from '../config/env';
import { log_error_event, log_standard_event } from '../logging/logger';

export interface chatwoot_handoff_params {
  account_id: number | string;
  conversation_id: number | string;
  reason?: string;
  assignee_id?: number;
  team_id?: number;
}

export interface handoff_session_entry {
  account_id: number | string;
  conversation_id: number | string;
  handed_off_at: number;
  reason?: string;
}

export type chatwoot_handoff_handler = (params: chatwoot_handoff_params) => Promise<boolean>;

const handoff_sessions = new Map<string, handoff_session_entry>();

function get_session_key(account_id: number | string, conversation_id: number | string): string {
  return `${account_id}_${conversation_id}`;
}

export function pause_conversation_for_human(
  account_id: number | string,
  conversation_id: number | string,
  reason?: string
): void {
  const key = get_session_key(account_id, conversation_id);
  handoff_sessions.set(key, {
    account_id,
    conversation_id,
    handed_off_at: Date.now(),
    reason,
  });
}

export function resume_conversation_bot(
  account_id: number | string,
  conversation_id: number | string
): void {
  const key = get_session_key(account_id, conversation_id);
  handoff_sessions.delete(key);
}

export function is_conversation_in_human_handoff(
  account_id: number | string,
  conversation_id: number | string
): boolean {
  const key = get_session_key(account_id, conversation_id);
  return handoff_sessions.has(key);
}

export function clear_all_handoff_sessions(): void {
  handoff_sessions.clear();
}

export function get_active_handoff_count(): number {
  return handoff_sessions.size;
}

export async function toggle_chatwoot_conversation_status(
  account_id: number | string,
  conversation_id: number | string,
  status: 'open' | 'pending' | 'resolved'
): Promise<boolean> {
  if (!env.CHATWOOT_API_TOKEN) {
    return false;
  }

  const url = `${env.CHATWOOT_BASE_URL}/api/v1/accounts/${account_id}/conversations/${conversation_id}/toggle_status`;

  try {
    await axios.post(
      url,
      { status },
      {
        headers: {
          api_access_token: env.CHATWOOT_API_TOKEN,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );
    return true;
  } catch (error) {
    log_error_event(
      'CHATWOOT_TOGGLE_STATUS_ERROR',
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined,
      { account_id, conversation_id, status }
    );
    return false;
  }
}

export async function assign_chatwoot_conversation(
  account_id: number | string,
  conversation_id: number | string,
  assignee_id?: number,
  team_id?: number
): Promise<boolean> {
  if (!env.CHATWOOT_API_TOKEN) {
    return false;
  }

  const target_assignee = assignee_id ?? env.CHATWOOT_ASSIGNEE_ID;
  const target_team = team_id ?? env.CHATWOOT_TEAM_ID;

  if (!target_assignee && !target_team) {
    return true;
  }

  const url = `${env.CHATWOOT_BASE_URL}/api/v1/accounts/${account_id}/conversations/${conversation_id}/assignments`;
  const payload: Record<string, number> = {};

  if (target_assignee) {
    payload.assignee_id = target_assignee;
  }

  if (target_team) {
    payload.team_id = target_team;
  }

  try {
    await axios.post(url, payload, {
      headers: {
        api_access_token: env.CHATWOOT_API_TOKEN,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });
    return true;
  } catch (error) {
    log_error_event(
      'CHATWOOT_ASSIGN_ERROR',
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined,
      { account_id, conversation_id, target_assignee, target_team }
    );
    return false;
  }
}

export async function add_chatwoot_conversation_labels(
  account_id: number | string,
  conversation_id: number | string,
  labels: string[]
): Promise<boolean> {
  if (!env.CHATWOOT_API_TOKEN || labels.length === 0) {
    return false;
  }

  const url = `${env.CHATWOOT_BASE_URL}/api/v1/accounts/${account_id}/conversations/${conversation_id}/labels`;

  try {
    await axios.post(
      url,
      { labels },
      {
        headers: {
          api_access_token: env.CHATWOOT_API_TOKEN,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );
    return true;
  } catch (error) {
    log_error_event(
      'CHATWOOT_LABELS_ERROR',
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined,
      { account_id, conversation_id, labels }
    );
    return false;
  }
}

async function default_execute_chatwoot_handoff(
  params: chatwoot_handoff_params
): Promise<boolean> {
  const { account_id, conversation_id, reason, assignee_id, team_id } = params;

  pause_conversation_for_human(account_id, conversation_id, reason);

  log_standard_event(String(conversation_id), 'response_sent', {
    status: 'handoff_triggered',
  });

  const status_updated = await toggle_chatwoot_conversation_status(
    account_id,
    conversation_id,
    'open'
  );

  await assign_chatwoot_conversation(account_id, conversation_id, assignee_id, team_id);
  await add_chatwoot_conversation_labels(account_id, conversation_id, ['atendimento_humano']);

  return status_updated;
}

let active_handoff_handler: chatwoot_handoff_handler = default_execute_chatwoot_handoff;

export function set_chatwoot_handoff_handler(
  custom_handler: chatwoot_handoff_handler | null
): void {
  active_handoff_handler = custom_handler || default_execute_chatwoot_handoff;
}

export async function execute_chatwoot_handoff(
  params: chatwoot_handoff_params
): Promise<boolean> {
  pause_conversation_for_human(params.account_id, params.conversation_id, params.reason);
  return active_handoff_handler(params);
}

export type chatwoot_message_sender = (
  account_id: number | string,
  conversation_id: number | string,
  content: string
) => Promise<boolean>;

async function default_send_chatwoot_message(
  account_id: number | string,
  conversation_id: number | string,
  content: string
): Promise<boolean> {
  if (!env.CHATWOOT_API_TOKEN) {
    return false;
  }

  const url = `${env.CHATWOOT_BASE_URL}/api/v1/accounts/${account_id}/conversations/${conversation_id}/messages`;

  try {
    await axios.post(
      url,
      {
        content,
        message_type: 'outgoing',
      },
      {
        headers: {
          api_access_token: env.CHATWOOT_API_TOKEN,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    return true;
  } catch (error) {
    log_error_event(
      'CHATWOOT_SEND_MESSAGE_ERROR',
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined,
      { account_id, conversation_id }
    );
    return false;
  }
}

let active_chatwoot_message_sender: chatwoot_message_sender = default_send_chatwoot_message;

export function set_chatwoot_message_sender(
  custom_sender: chatwoot_message_sender | null
): void {
  active_chatwoot_message_sender = custom_sender || default_send_chatwoot_message;
}

export async function send_chatwoot_message(
  account_id: number | string,
  conversation_id: number | string,
  content: string
): Promise<boolean> {
  return active_chatwoot_message_sender(account_id, conversation_id, content);
}
