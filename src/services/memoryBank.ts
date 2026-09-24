import { QdrantClient } from '@qdrant/js-client-rest';
import ollama from 'ollama';
import { randomUUID } from 'crypto';

export default class MemoryBank {
  private client: QdrantClient;
  private collection: string;
  private embedModel: string;

  constructor() {
    this.client = new QdrantClient({ url: 'http://localhost:6333' });
    this.collection = 'toy_project_memory';
    this.embedModel = 'nomic-embed-text';
  }

  async init(): Promise<void> {
    const { collections } = await this.client.getCollections();
    const exists = collections.some(c => c.name === this.collection);

    if (!exists) {
      await this.client.createCollection(this.collection, {
        vectors: { size: 768, distance: 'Cosine' }
      });
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await ollama.embeddings({
      model: this.embedModel,
      prompt: text
    });
    return response.embedding;
  }

  async remember(text: string): Promise<void> {
    const vector = await this.embed(text);
    await this.client.upsert(this.collection, {
      points: [{
        id: randomUUID(),
        vector: vector,
        payload: { content: text }
      }]
    });
  }

  async recall(query: string, topK: number = 3): Promise<string[]> {
    const queryVector = await this.embed(query);

    // 1. Change 'search' to 'query'
    const results = await this.client.query(this.collection, {
      // 2. Change 'vector' to 'query' inside the payload
      query: queryVector,
      limit: topK,
      with_payload: true
    });

    // 3. The new API wraps hits in a 'points' array
    return results.points.map(hit => hit.payload?.content as string);
  }
}