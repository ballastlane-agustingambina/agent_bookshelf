import express, { Request, Response, NextFunction } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db/index.js';
import booksRouter from './routes/books.js';
import shelvesRouter from './routes/shelves.js';
import reviewsRouter from './routes/reviews.js';
import apiRouter from './routes/api.js';
import chatRouter from './routes/chat.js';
import chatViewRouter from './routes/chatView.js';

// 1. Import the MemoryBank service
import MemoryBank from './services/memoryBank.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'public')));

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

app.use('/', booksRouter);
app.use('/shelves', shelvesRouter);
app.use('/reviews', reviewsRouter);
app.use('/chat', chatViewRouter);
app.use('/api', apiRouter);
app.use('/api', chatRouter);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 2. Convert startServer to an async function
export async function startServer(dbPath?: string) {
  initDb(dbPath);

  // 3. Initialize the Memory Bank and attach it to the Express app
  try {
    const bank = new MemoryBank();
    await bank.init();
    app.locals.memoryBank = bank; 
    console.log('Memory Bank initialized via Qdrant.');
  } catch (error) {
    console.error('Failed to initialize Memory Bank:', error);
  }

  app.listen(PORT, () => {
    console.log(`Bookshelf running at http://localhost:${PORT}`);
  });
}

const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('server.ts');

if (isMainModule) {
  // 4. Catch any top-level initialization errors
  startServer().catch(console.error);
}

export default app;