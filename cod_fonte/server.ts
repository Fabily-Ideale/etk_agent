import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import apiRoutes from './routes/api';
import webhookRoutes from './webhook/controller';

const app = express();

app.use(cors());
app.use(express.json());

// Rotas da API (Teste via Postman)
app.use('/api', apiRoutes);

// Rotas do Webhook (Meta/WhatsApp)
app.use('/webhook', webhookRoutes);

app.listen(env.PORT, () => {
  console.log(`Servidor rodando na porta ${env.PORT}`);
});
