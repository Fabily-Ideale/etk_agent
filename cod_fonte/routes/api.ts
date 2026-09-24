import { Router, Request, Response } from 'express';
import { handleUserMessage } from '../rag/agent';
import { create_ip_rate_limiter, create_phone_rate_limiter } from '../security/rate_limiter';
import { env } from '../config/env';
import { log_error_event } from '../logging/logger';

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
  ip_limiter,
  phone_limiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body || typeof req.body !== 'object') {
        res.status(400).json({ error: 'Corpo da requisicao invalido ou ausente.' });
        return;
      }

      const raw_from = req.body.from;
      const raw_text = req.body.text;

      const normalized_from = typeof raw_from === 'number'
        ? String(raw_from).trim()
        : typeof raw_from === 'string'
        ? raw_from.trim()
        : '';

      const normalized_text = typeof raw_text === 'string'
        ? raw_text.trim()
        : '';

      if (normalized_from.length === 0 || normalized_text.length === 0) {
        res.status(400).json({
          error: 'Campos obrigatorios invalidos ou ausentes: "from" (numero de telefone) e "text" (mensagem).',
        });
        return;
      }

      const answer = await handleUserMessage(normalized_from, normalized_text);

      res.json({
        from: normalized_from,
        reply: answer,
      });
    } catch (error) {
      log_error_event(
        'API_CHAT_ROUTE_ERROR',
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined,
        { ip: req.ip, from: req.body?.from }
      );
      res.status(500).json({ error: 'Erro interno ao processar a mensagem.' });
    }
  }
);

export default router;
