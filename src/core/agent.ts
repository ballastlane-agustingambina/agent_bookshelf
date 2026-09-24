import ollama from 'ollama';
import MemoryBank from '../services/memoryBank';

export async function chatWithMemory(
  userInput: string, 
  memoryBank: MemoryBank, 
  model: string = 'qwen3.8:27b'
): Promise<string> {
  // 1. Retrieve past context
  const pastMemories = await memoryBank.recall(userInput);
  const contextBlock = pastMemories.join('\n');
  
  // 2. Build the augmented prompt
  const systemPrompt = `You are a helpful AI assistant with a memory bank. ` +
                       `Use these past memories to provide context if relevant:\n${contextBlock}`;
  
  // 3. Generate response via Ollama
  const response = await ollama.chat({
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userInput }
    ]
  });
  
  const reply = response.message.content;
  
  // 4. Store the new interaction for the future
  await memoryBank.remember(`User: ${userInput} | AI: ${reply}`);
  
  return reply;
}