import { Router, Request, Response } from 'express';
import { enqueue_conversation_message } from './conversation_queue';
import {
  is_conversation_in_human_handoff,
  resume_conversation_bot,
  send_chatwoot_message,
} from './chatwoot_client';
import { log_standard_event } from '../logging/logger';

export const unsupported_media_message =
  'Nosso assistente virtual suporta apenas mensagens de texto. Por favor, envie sua duvida ou solicitacao por escrito em texto.';

const media_notification_cooldowns = new Map<string, number>();
const media_cooldown_window_ms = 5000;

export function clear_media_notification_cooldowns(): void {
  media_notification_cooldowns.clear();
}

export function is_unsupported_media_message(body: Record<string, any>): boolean {
  if (Array.isArray(body.attachments) && body.attachments.length > 0) {
    return true;
  }

  if (
    typeof body.content_type === 'string' &&
    body.content_type.trim().length > 0 &&
    body.content_type.trim().toLowerCase() !== 'text'
  ) {
    return true;
  }

  const text = typeof body.content === 'string' ? body.content.trim() : '';
  if (text.length === 0) {
    return true;
  }

  return false;
}

function purge_expired_media_cooldowns(now: number): void {
  for (const [key, timestamp] of media_notification_cooldowns.entries()) {
    if (now - timestamp >= media_cooldown_window_ms) {
      media_notification_cooldowns.delete(key);
    }
  }
}

const router = Router();

async function process_chatwoot_webhook(req: Request, res: Response): Promise<void> {
  const body = req.body;

  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'corpo_invalido' });
    return;
  }

  res.status(200).json({ status: 'received' });

  if (body.event !== 'message_created') {
    return;
  }

  if (body.message_type !== 'incoming') {
    return;
  }

  if (body.private === true) {
    return;
  }

  const conversation_id = body.conversation?.id;
  const account_id = body.account?.id;

  if (!conversation_id || !account_id) {
    return;
  }

  const conversation_status = body.conversation?.status;
  const assignee_id = body.conversation?.assignee_id ?? body.conversation?.assignee?.id;

  if (conversation_status === 'pending' || conversation_status === 'bot') {
    void resume_conversation_bot(account_id, conversation_id);
  }

  const is_open = conversation_status === 'open';
  const has_human_assignee = (assignee_id !== undefined && assignee_id !== null && assignee_id !== 0) || Boolean(body.conversation?.assignee);
  const is_session_handed_off = is_conversation_in_human_handoff(account_id, conversation_id);

  if (is_open || has_human_assignee || is_session_handed_off) {
    return;
  }

  const sender_phone = body.sender?.phone_number;
  const sender_name = body.sender?.name;
  const sender_identifier = typeof sender_phone === 'string' && sender_phone.trim().length > 0
    ? sender_phone.trim()
    : typeof sender_name === 'string' && sender_name.trim().length > 0
    ? sender_name.trim()
    : `chatwoot_${conversation_id}`;

  if (is_unsupported_media_message(body)) {
    const cooldown_key = `${account_id}_${conversation_id}`;
    const now = Date.now();
    purge_expired_media_cooldowns(now);
    const last_notified = media_notification_cooldowns.get(cooldown_key) || 0;

    if (now - last_notified >= media_cooldown_window_ms) {
      media_notification_cooldowns.set(cooldown_key, now);
      await send_chatwoot_message(account_id, conversation_id, unsupported_media_message);
      log_standard_event(sender_identifier, 'response_sent', {
        status: 'unsupported_media_rejected',
      });
    }

    return;
  }

  const text = typeof body.content === 'string' ? body.content.trim() : '';

  enqueue_conversation_message({
    account_id,
    conversation_id,
    sender_identifier,
    text,
  });
}

router.get('/', (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok' });
});

router.post('/', process_chatwoot_webhook);
router.post('/chatwoot', process_chatwoot_webhook);

export default router;
