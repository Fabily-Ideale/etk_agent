import express, { Request, Response } from 'express';
import cors from 'cors';
import { env } from './config/env';
import webhook_routes from './webhook/controller';

const app = express();

app.set('trust proxy', true);
app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok', service: 'etk_agent' });
});

app.use('/webhook', webhook_routes);

app.listen(env.PORT, () => {
  console.log(`Servidor rodando na porta ${env.PORT}`);
});

export default app;
