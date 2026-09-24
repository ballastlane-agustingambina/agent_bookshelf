import { Router, Request, Response } from 'express';
import { chatWithMemory } from '../core/agent.js';

const router = Router();

router.post('/chat', async (req: Request, res: Response) => {
  const { message } = req.body ?? {};
  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'message is required and must be a non-empty string' });
  }

  const memoryBank = req.app.locals.memoryBank;
  if (!memoryBank) {
    return res.status(503).json({ error: 'Memory Bank is not initialized' });
  }

  try {
    const reply = await chatWithMemory(message.trim(), memoryBank);
    res.json({ reply });
  } catch (err) {
    console.error('chatWithMemory failed:', err);
    res.status(500).json({ error: 'Failed to generate a response' });
  }
});

export default router;
