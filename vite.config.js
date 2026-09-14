import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHandler } from './server/snapshots-handler.js';
import { localStore } from './server/local-store.js';
export default defineConfig({
  plugins: [react(), {
    name: 'local-snapshots',
    configureServer(server) {
      const handler = createHandler(localStore(process.env.RHM_LOCAL_SNAPSHOTS_DIR || '.local/snapshots'));
      server.middlewares.use((req, res, next) => {
        if (new URL(req.url, 'http://localhost').pathname === '/api/snapshots') return handler(req, res);
        next();
      });
    },
  }],
});
