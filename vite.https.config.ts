// HTTPS dev server for testing on a phone over the LAN (getUserMedia needs a secure origin).
// Run: npm run dev:https  → open https://<this PC's IP>:5173 on the phone and accept the certificate warning.
import { mergeConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import base from './vite.config';

export default mergeConfig(base, { plugins: [basicSsl()] });
