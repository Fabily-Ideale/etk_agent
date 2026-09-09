import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import apiRoutes from './routes/api';
import webhookRoutes from './webhook/controller';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', apiRoutes);
app.use('/webhook', webhookRoutes);

app.listen(env.PORT, () => {
  console.log(`Servidor rodando na porta ${env.PORT}`);
});
