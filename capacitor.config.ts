import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.singingpractice',
  appName: 'Singing Practice',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  // The YouTube helper on the PC is plain http on the LAN.
  android: { allowMixedContent: true },
};

export default config;
