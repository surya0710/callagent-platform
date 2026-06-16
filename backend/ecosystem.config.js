const path = require('path');
const { config } = require('dotenv');

config({ path: path.join(__dirname, '.env') });

const sharedEnv = {
  ...process.env,
  NODE_ENV: 'production',
};

module.exports = {
  apps: [
    {
      name: 'ai-voice-api',
      script: 'dist/main.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 5000,
      env: sharedEnv,
    },
    {
      name: 'ai-voice-worker',
      script: 'dist/worker.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 5000,
      env: sharedEnv,
    },
  ],
};
