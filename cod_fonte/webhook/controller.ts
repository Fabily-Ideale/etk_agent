import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { handleUserMessage } from '../rag/agent';
import axios from 'axios';

const router = Router();

// GET: Meta webhook verification
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
    console.log('WEBHOOK_VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// POST: Handle incoming WhatsApp events
router.post('/', async (req: Request, res: Response) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    res.status(200).send('EVENT_RECEIVED'); // Ack immediately

    for (const entry of body.entry) {
      const changes = entry.changes[0];
      if (changes.field === 'messages') {
        const message = changes.value.messages?.[0];
        
        if (message && message.type === 'text') {
          const from = message.from; // Phone number
          const text = message.text.body;

          console.log(`[WhatsApp] Mensagem recebida de ${from}: ${text}`);
          
          try {
            // Chama a lógica do RAG
            const answer = await handleUserMessage(from, text);
            
            // Envia a resposta de volta se as credenciais existirem
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
                  }
                }
              );
            } else {
              console.warn('[WhatsApp] WA_PHONE_NUMBER_ID ou WA_ACCESS_TOKEN ausentes. Resposta não enviada via API da Meta, apenas processada no DB.');
            }
          } catch (error) {
            console.error('[WhatsApp] Erro ao processar mensagem do webhook:', error);
          }
        }
      }
    }
  } else {
    res.sendStatus(404);
  }
});

export default router;
