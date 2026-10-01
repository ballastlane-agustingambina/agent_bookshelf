import { Router, Request, Response } from 'express';
import { chatWithMemory } from '../core/agent.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.render('chat/index');
});

router.post('/messages', async (req: Request, res: Response) => {
  const { message } = req.body ?? {};
  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).send('<p class="error">Message is required</p>');
  }

  const memoryBank = req.app.locals.memoryBank;
  if (!memoryBank) {
    return res.status(503).send('<p class="error">Memory Bank is not initialized</p>');
  }

  try {
    const reply = await chatWithMemory(message.trim(), memoryBank);
    res.render('chat/message-pair', { message: message.trim(), reply });
  } catch (err) {
    console.error('chatWithMemory failed:', err);
    res.status(500).send('<p class="error">Failed to generate a response</p>');
  }
});

export default router;
