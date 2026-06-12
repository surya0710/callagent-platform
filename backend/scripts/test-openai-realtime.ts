#!/usr/bin/env ts-node
/**
 * Standalone OpenAI Realtime connectivity test (no Smartflo).
 *
 * Usage:
 *   npm run openai:realtime:test
 */

import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { WebSocket } from 'ws';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const model =
  process.env.OPENAI_REALTIME_MODEL?.trim() ??
  'gpt-4o-realtime-preview-2024-12-17';
const apiKey = process.env.OPENAI_API_KEY?.trim()?.replace(/[^\x20-\x7E]+/g, '');

async function main(): Promise<void> {
  if (!apiKey) {
    console.error('OPENAI_API_KEY is missing or invalid in backend/.env');
    process.exit(1);
  }

  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
  console.log('Connecting to', url);
  console.log('API key prefix:', `${apiKey.slice(0, 8)}...`);

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  const events: string[] = [];

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(String(data)) as { type?: string; error?: unknown };
      events.push(event.type ?? 'unknown');
      console.log('[openai ←]', event.type, event.error ? JSON.stringify(event.error) : '');

      if (event.type === 'session.created') {
        ws.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              modalities: ['text', 'audio'],
              instructions: 'Say hello briefly.',
              voice: 'alloy',
              input_audio_format: 'pcm16',
              output_audio_format: 'pcm16',
              turn_detection: null,
            },
          }),
        );
        console.log('[openai →] session.update');
      }

      if (event.type === 'session.updated') {
        ws.send(
          JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'Say hello in one short sentence.' }],
            },
          }),
        );
        ws.send(JSON.stringify({ type: 'response.create' }));
        console.log('[openai →] conversation.item.create + response.create');
      }

      if (event.type === 'response.audio.delta' || event.type === 'response.output_audio.delta') {
        console.log('[openai ←] audio delta received');
      }

      if (event.type === 'response.done') {
        console.log('SUCCESS: OpenAI Realtime roundtrip OK');
        ws.close();
      }

      if (event.type === 'error') {
        console.error('OpenAI error:', JSON.stringify(event.error ?? event, null, 2));
        ws.close();
        process.exit(1);
      }
    } catch (error) {
      console.error('Failed to parse message', error);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
    process.exit(1);
  });

  ws.on('close', (code, reason) => {
    console.log('WebSocket closed', code, reason.toString());
    console.log('Events seen:', events.join(', ') || '(none)');
    process.exit(events.includes('response.done') ? 0 : 1);
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      console.log('WebSocket open');
      resolve();
    });
    ws.once('error', reject);
  });

  setTimeout(() => {
    console.error('TIMEOUT: no response.done within 30s');
    console.log('Events seen:', events.join(', ') || '(none)');
    ws.close();
    process.exit(1);
  }, 30000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
