import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.singingpractice',
  appName: 'Singing Practice',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  // The YouTube helper on the PC is plain http on the LAN.
  // allowMixedContent: the (browser-only) YouTube helper is plain http on the LAN.
  // webContentsDebuggingEnabled: lets chrome://inspect / CDP over adb read the app's IndexedDB and
  // console for on-device debugging (personal app; turn off before any public release).
  android: { allowMixedContent: true, webContentsDebuggingEnabled: true },
};

export default config;
