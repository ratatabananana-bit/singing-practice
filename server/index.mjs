// Local helper for "Load from YouTube": runs yt-dlp + ffmpeg on this machine and
// hands the app an audio file. Start with `npm run server` (listens on 5174).
// The app (dev server or phone on the LAN) calls GET /api/yt?url=<youtube url>.
//
// Needs `yt-dlp` and `ffmpeg` on PATH. Downloading YouTube audio may be against
// YouTube's terms of service; this is for your own practice use.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 5174);
const YTDLP = process.env.YTDLP || 'yt-dlp';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `exit ${code}`))));
  });
}

async function fetchAudio(url) {
  const dir = mkdtempSync(join(tmpdir(), 'sing-yt-'));
  try {
    // Title first (cheap), then audio as MP3: every browser and the Android WebView decode it
    // (some m4a variants such as HE-AAC fail in decodeAudioData).
    const title = (await run(YTDLP, ['--no-playlist', '--print', '%(title)s', url])).trim();
    await run(YTDLP, [
      '--no-playlist',
      '-f',
      'bestaudio/best',
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '2',
      '--postprocessor-args',
      'ffmpeg:-ar 44100 -ac 2',
      '-o',
      join(dir, 'audio.%(ext)s'),
      url,
    ]);
    const file = readdirSync(dir).find((f) => f.startsWith('audio.'));
    if (!file) throw new Error('yt-dlp produced no file');
    const ext = file.split('.').pop();
    const mime = ext === 'm4a' ? 'audio/mp4' : ext === 'mp3' ? 'audio/mpeg' : ext === 'webm' ? 'audio/webm' : ext === 'opus' ? 'audio/ogg' : 'application/octet-stream';
    return { title, ext, mime, data: readFileSync(join(dir, file)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-Title, X-Ext');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/api/health') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
  if (u.pathname !== '/api/yt') return res.writeHead(404).end('not found');
  const url = u.searchParams.get('url') || '';
  if (!/^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(url)) return res.writeHead(400).end('not a YouTube url');
  try {
    console.log('fetch', url);
    const a = await fetchAudio(url);
    res.writeHead(200, {
      'Content-Type': a.mime,
      'Content-Length': a.data.length,
      'X-Title': encodeURIComponent(a.title),
      'X-Ext': a.ext,
    });
    res.end(a.data);
    console.log('done', a.title, a.data.length, 'bytes');
  } catch (e) {
    console.error('failed', e.message);
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(e.message);
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`yt helper listening on http://0.0.0.0:${PORT}  (uses ${YTDLP} + ffmpeg)`));
