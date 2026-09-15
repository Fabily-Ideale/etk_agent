import { Router, Request, Response } from 'express';
import { handleUserMessage } from '../rag/agent';
import { validate_api_key } from '../security/auth';
import { create_ip_rate_limiter, create_phone_rate_limiter } from '../security/rate_limiter';
import { env } from '../config/env';

const router = Router();

const ip_limiter = create_ip_rate_limiter(
  env.RATE_LIMIT_IP_MAX_REQUESTS,
  env.RATE_LIMIT_IP_WINDOW_MS
);

const phone_limiter = create_phone_rate_limiter(
  env.RATE_LIMIT_PHONE_MAX_REQUESTS,
  env.RATE_LIMIT_PHONE_WINDOW_MS
);

router.post(
  '/chat',
  validate_api_key,
  ip_limiter,
  phone_limiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, text } = req.body;

      if (!from || !text) {
        res.status(400).json({ error: 'Faltam os campos "from" (numero de telefone) e "text" (mensagem).' });
        return;
      }

      const answer = await handleUserMessage(from, text);

      res.json({
        from,
        reply: answer,
      });
    } catch (error) {
      console.error('Erro na rota /chat:', error);
      res.status(500).json({ error: 'Erro interno ao processar a mensagem.' });
    }
  }
);

export default router;
