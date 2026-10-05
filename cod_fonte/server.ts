import express, { Request, Response } from 'express';
import cors from 'cors';
import { env } from './config/env';
import webhook_routes from './webhook/controller';
import { hydrate_handoff_sessions } from './webhook/chatwoot_client';
import { recover_pending_queues } from './webhook/conversation_queue';

const app = express();

app.set('trust proxy', true);
app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok', service: 'etk_agent' });
});

app.use('/webhook', webhook_routes);

async function start_server(): Promise<void> {
  await hydrate_handoff_sessions();
  await recover_pending_queues();

  app.listen(env.PORT, () => {
    console.log(`Servidor rodando na porta ${env.PORT}`);
  });
}

void start_server();

export default app;
