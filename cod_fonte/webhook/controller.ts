import { Router, Request, Response } from 'express';
import { enqueue_conversation_message } from './conversation_queue';

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

  const text = typeof body.content === 'string' ? body.content.trim() : '';
  if (text.length === 0) {
    return;
  }

  const conversation_id = body.conversation?.id;
  const account_id = body.account?.id;

  if (!conversation_id || !account_id) {
    return;
  }

  const sender_phone = body.sender?.phone_number;
  const sender_name = body.sender?.name;
  const sender_identifier = typeof sender_phone === 'string' && sender_phone.trim().length > 0
    ? sender_phone.trim()
    : typeof sender_name === 'string' && sender_name.trim().length > 0
    ? sender_name.trim()
    : `chatwoot_${conversation_id}`;

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
