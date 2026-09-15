import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { handleUserMessage } from '../rag/agent';
import axios from 'axios';

const router = Router();

router.get('/', (req: Request, res: Response): void => {
  const mode = req.query ? req.query['hub.mode'] : undefined;
  const token = req.query ? req.query['hub.verify_token'] : undefined;
  const challenge = req.query ? req.query['hub.challenge'] : undefined;

  if (mode === 'subscribe' && typeof token === 'string' && env.VERIFY_TOKEN && token === env.VERIFY_TOKEN) {
    res.status(200).send(challenge ?? '');
    return;
  }

  res.sendStatus(403);
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const body = req.body;

  if (!body || typeof body !== 'object' || body.object !== 'whatsapp_business_account') {
    res.sendStatus(404);
    return;
  }

  res.status(200).send('EVENT_RECEIVED');

  if (!Array.isArray(body.entry)) {
    return;
  }

  for (const entry of body.entry) {
    if (!entry || !Array.isArray(entry.changes)) {
      continue;
    }

    for (const change of entry.changes) {
      if (!change || change.field !== 'messages' || !change.value) {
        continue;
      }

      const messages = change.value.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        continue;
      }

      for (const message of messages) {
        if (!message || message.type !== 'text' || !message.text || typeof message.text.body !== 'string') {
          continue;
        }

        const from = message.from;
        const text = message.text.body;

        if (!from || typeof from !== 'string' || text.trim().length === 0) {
          continue;
        }

        try {
          const answer = await handleUserMessage(from, text);

          if (env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN) {
            await axios.post(
              `https://graph.facebook.com/v21.0/${env.WA_PHONE_NUMBER_ID}/messages`,
              {
                messaging_product: 'whatsapp',
                to: from,
                type: 'text',
                text: { body: answer },
              },
              {
                headers: {
                  Authorization: `Bearer ${env.WA_ACCESS_TOKEN}`,
                },
                timeout: 10000,
              }
            );
          }
        } catch (error) {
          console.error('[WhatsApp] Erro ao processar mensagem do webhook:', error);
        }
      }
    }
  }
});

export default router;
