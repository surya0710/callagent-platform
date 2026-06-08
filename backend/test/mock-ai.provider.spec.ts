import { MockAiProvider } from '../src/modules/ai/providers/mock-ai.provider';

describe('MockAiProvider', () => {
  const provider = new MockAiProvider();

  it('generates mock text', async () => {
    const result = await provider.generateText({ prompt: 'Hello customer' });
    expect(result.provider).toBe('mock');
    expect(result.text).toContain('[mock]');
  });

  it('summarizes call transcript', async () => {
    const result = await provider.summarizeCall({
      transcript: 'Agent greeted the customer and confirmed interest.',
    });
    expect(result.provider).toBe('mock');
    expect(result.summary).toContain('[mock]');
  });

  it('detects positive sentiment', async () => {
    const result = await provider.analyzeSentiment({
      text: 'That sounds great, thanks!',
    });
    expect(result.label).toBe('positive');
  });
});
