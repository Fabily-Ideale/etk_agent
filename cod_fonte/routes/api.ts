import { Router, Request, Response } from 'express';
import { handle_user_message } from '../rag/agent';

const router = Router();

router.post('/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, text } = req.body;
    
    if (!from || !text) {
      res.status(400).json({ error: 'Faltam os campos "from" (número de telefone) e "text" (mensagem).' });
      return;
    }

    const answer = await handle_user_message(from, text);
    
    res.json({
      from,
      reply: answer
    });
  } catch (error) {
    console.error('Erro na rota /chat:', error);
    res.status(500).json({ error: 'Erro interno ao processar a mensagem.' });
  }
});

export default router;
