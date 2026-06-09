import { existsSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';

export function loadEnvBeforeBootstrap(): void {
  const candidates = [
    resolve(__dirname, '../../.env'),
    resolve(__dirname, '../.env'),
    resolve(process.cwd(), '.env'),
  ];

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      config({ path: envPath });
      return;
    }
  }
}
