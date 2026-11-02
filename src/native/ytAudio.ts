import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Bridge to android/…/YtAudioPlugin.java: yt-dlp + ffmpeg running on the device itself. */
export interface YtAudioPlugin {
  download(options: { url: string }): Promise<{ path: string; title: string; ext: string; bytes: number }>;
  cancel(): Promise<{ cancelled: boolean }>;
  update(): Promise<{ status: string; version: string | null }>;
  version(): Promise<{ ready: boolean; error: string | null; version: string | null }>;
  addListener(eventName: 'progress', listener: (ev: { percent: number; eta: number; line: string }) => void): Promise<PluginListenerHandle>;
}

export const YtAudio = registerPlugin<YtAudioPlugin>('YtAudio');

/** True inside the Android app, where the native plugin exists. Browsers use the PC helper instead. */
export function hasNativeYt(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('YtAudio');
}

/** Turn a native file path into a URL the WebView may fetch. */
export function nativeFileUrl(path: string): string {
  return Capacitor.convertFileSrc(path);
}
