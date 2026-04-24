import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const httpsEnabled = env.VITE_HTTPS === 'true';
  const keyPath = env.VITE_SSL_KEY_PATH;
  const certPath = env.VITE_SSL_CERT_PATH;

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: true,
      ...(httpsEnabled && keyPath && certPath
        ? {
            https: {
              key: fs.readFileSync(path.resolve(__dirname, keyPath)),
              cert: fs.readFileSync(path.resolve(__dirname, certPath)),
            },
          }
        : {}),
    },
  };
});
