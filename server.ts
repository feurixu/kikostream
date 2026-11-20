import express from 'express';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = process.cwd();
const RECORDINGS_DIR = path.join(ROOT_DIR, 'recordings');
const TEMP_DIR = path.join(RECORDINGS_DIR, '.tmp');
const INDEX_FILE = path.join(RECORDINGS_DIR, 'index.json');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const YT_DLP_PATH = path.join(BIN_DIR, 'yt-dlp');
const COOKIES_PATH = path.join(RECORDINGS_DIR, '.youtube-cookies.txt');

fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync(BIN_DIR, { recursive: true });

type CaptureQuality = '1080p' | '720p' | '480p' | 'audio';

interface RecordingItem {
  id: string;
  title: string;
  channel: string;
  videoId?: string;
  sourceType: 'tab' | 'direct';
  qualityLabel: string;
  format: 'mp4' | 'm4a';
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  sizeBytes: number;
  codec: string;
  filename: string;
  createdAt: string;
}

interface InternalJob {
  id: string;
  videoId: string;
  title: string;
  channel: string;
  quality: CaptureQuality;
  status: 'starting' | 'recording' | 'finalizing' | 'completed' | 'error';
  startedAt: number;
  tempPath: string;
  outputExt: 'mp4' | 'm4a';
  lastLog: string;
  errorMessage?: string;
  recordingId?: string;
  process?: ChildProcess;
  stopRequested?: boolean;
}

const activeJobs = new Map<string, InternalJob>();

function loadRecordingsIndex(): RecordingItem[] {
  try {
    if (!fs.existsSync(INDEX_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(INDEX_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter((item: RecordingItem) => {
      if (!item || typeof item.filename !== 'string') return false;
      return fs.existsSync(path.join(RECORDINGS_DIR, item.filename));
    });
    if (valid.length !== parsed.length) {
      saveRecordingsIndex(valid);
    }
    return valid;
  } catch {
    return [];
  }
}

function saveRecordingsIndex(items: RecordingItem[]): void {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(items, null, 2), 'utf8');
}

function addRecordingToIndex(item: RecordingItem): void {
  const existing = loadRecordingsIndex();
  existing.unshift(item);
  saveRecordingsIndex(existing);
}

function sanitizeFilename(input: string): string {
  return input
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 72) || 'stream_recording';
}

function extractYouTubeId(rawUrl: string): string | null {
  try {
    const trimmed = rawUrl.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const seg = parsed.pathname.split('/').filter(Boolean)[0];
      return seg && /^[a-zA-Z0-9_-]{11}$/.test(seg) ? seg : null;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const vParam = parsed.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
        return vParam;
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['live', 'embed', 'shorts', 'v'].includes(parts[0])) {
        if (/^[a-zA-Z0-9_-]{11}$/.test(parts[1])) {
          return parts[1];
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function ensureYtDlp(): Promise<string> {
  if (fs.existsSync(YT_DLP_PATH)) {
    return YT_DLP_PATH;
  }
  const resp = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp');
  if (!resp.ok || !resp.body) {
    throw new Error(`Failed to download yt-dlp (${resp.status})`);
  }
  await pipeline(resp.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(YT_DLP_PATH));
  fs.chmodSync(YT_DLP_PATH, 0o755);
  return YT_DLP_PATH;
}

async function probeMedia(filePath: string): Promise<{
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  codec: string;
}> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    const info = JSON.parse(stdout);
    const videoStream = Array.isArray(info.streams)
      ? info.streams.find((s: { codec_type?: string }) => s.codec_type === 'video')
      : undefined;
    const audioStream = Array.isArray(info.streams)
      ? info.streams.find((s: { codec_type?: string }) => s.codec_type === 'audio')
      : undefined;

    let fps = 0;
    if (videoStream?.avg_frame_rate && videoStream.avg_frame_rate !== '0/0') {
      const [num, den] = String(videoStream.avg_frame_rate).split('/').map(Number);
      if (num && den) {
        fps = Math.round((num / den) * 100) / 100;
      }
    }

    const durationSeconds = Math.max(
      0,
      Math.round(Number(info.format?.duration || videoStream?.duration || 0) * 10) / 10,
    );

    const codecParts: string[] = [];
    if (videoStream?.codec_name) codecParts.push(String(videoStream.codec_name).toUpperCase());
    if (audioStream?.codec_name) codecParts.push(String(audioStream.codec_name).toUpperCase());

    return {
      width: Number(videoStream?.width || 0),
      height: Number(videoStream?.height || 0),
      fps: fps > 0 && fps <= 120 ? Math.round(fps) : 0,
      durationSeconds,
      codec: codecParts.join(' / ') || 'MP4',
    };
  } catch {
    return {
      width: 0,
      height: 0,
      fps: 0,
      durationSeconds: 0,
      codec: 'H264 / AAC',
    };
  }
}

async function inspectYouTubePage(rawUrl: string): Promise<{
  videoId: string;
  canonicalUrl: string;
  title: string;
  channel: string;
  channelUrl?: string;
  isLive: boolean;
}> {
  const normalizedUrl = rawUrl.trim().startsWith('http')
    ? rawUrl.trim()
    : `https://${rawUrl.trim()}`;

  let videoId = extractYouTubeId(normalizedUrl);
  let isLive = false;
  let pageTitle = '';

  try {
    const pageRes = await fetch(normalizedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (pageRes.ok) {
      const html = await pageRes.text();
      if (!videoId) {
        const canonicalMatch = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/);
        const videoIdMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
        videoId = canonicalMatch?.[1] || videoIdMatch?.[1] || null;
      }
      isLive = /"isLive"\s*:\s*true/.test(html) || /"isLiveNow"\s*:\s*true/.test(html);
      const titleMatch = html.match(/<title>(.*?)<\/title>/);
      if (titleMatch?.[1]) {
        pageTitle = titleMatch[1].replace(/\s*-\s*YouTube\s*$/, '').trim();
      }
    }
  } catch {
    // Fallback to oEmbed below if videoId was parsed directly
  }

  if (!videoId) {
    throw new Error('Could not resolve a YouTube video or live stream ID from that URL.');
  }

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  let title = pageTitle || `YouTube Stream (${videoId})`;
  let channel = 'YouTube Creator';
  let channelUrl: string | undefined;

  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`,
    );
    if (oembedRes.ok) {
      const oembed = (await oembedRes.json()) as {
        title?: string;
        author_name?: string;
        author_url?: string;
      };
      if (oembed.title) title = oembed.title;
      if (oembed.author_name) channel = oembed.author_name;
      if (oembed.author_url) channelUrl = oembed.author_url;
    }
  } catch {
    // Ignore oEmbed failure and keep page-derived title
  }

  return {
    videoId,
    canonicalUrl,
    title,
    channel,
    channelUrl,
    isLive,
  };
}

function getYtDlpCookieArgs(): string[] {
  if (fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 20) {
    return ['--cookies', COOKIES_PATH];
  }
  return [];
}

function getYtDlpBaseArgs(): string[] {
  return [
    '--no-warnings',
    '--no-playlist',
    '--js-runtimes', `node:${process.execPath}`,
    ...getYtDlpCookieArgs(),
  ];
}

async function probeYtDlpFormats(canonicalUrl: string): Promise<{
  directCaptureAvailable: boolean;
  requiresCookies: boolean;
  availableHeights: number[];
  inspectNote?: string;
}> {
  try {
    const ytDlp = await ensureYtDlp();
    const args = [
      ...getYtDlpBaseArgs(),
      '--dump-single-json',
      '--skip-download',
      canonicalUrl,
    ];
    const { stdout } = await execFileAsync(ytDlp, args, { timeout: 18000, maxBuffer: 20 * 1024 * 1024 });
    const parsed = JSON.parse(stdout) as { formats?: Array<{ height?: number }> };
    const heightsSet = new Set<number>();
    for (const fmt of parsed.formats || []) {
      if (typeof fmt.height === 'number' && fmt.height >= 144) {
        heightsSet.add(fmt.height);
      }
    }
    const availableHeights = Array.from(heightsSet).sort((a, b) => b - a);
    return {
      directCaptureAvailable: true,
      requiresCookies: false,
      availableHeights,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const botCheck = /Sign in to confirm|not a bot|cookies/i.test(msg);
    return {
      directCaptureAvailable: false,
      requiresCookies: botCheck,
      availableHeights: [1080, 720, 480],
      inspectNote: botCheck
        ? 'YouTube requested sign-in verification from this server IP. Use Browser Tab Capture (no cookies needed) or upload cookies.txt.'
        : 'Direct stream probe unavailable; Browser Tab Capture is ready.',
    };
  }
}

function getFileSizeSafe(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function buildQualityLabel(width: number, height: number, quality: CaptureQuality): string {
  if (quality === 'audio' || height === 0) return 'Audio M4A';
  if (height >= 1080) return '1080p FHD';
  if (height >= 720) return '720p HD';
  if (height >= 480) return '480p SD';
  return `${width}×${height}`;
}

async function finalizeDirectRecording(job: InternalJob): Promise<RecordingItem> {
  job.status = 'finalizing';
  job.lastLog = 'Remuxing captured stream to FastStart MP4...';

  const id = job.recordingId || crypto.randomUUID();
  const safeName = sanitizeFilename(job.title);
  const finalExt = job.outputExt;
  const finalFilename = `${safeName}_${id.slice(0, 8)}.${finalExt}`;
  const finalPath = path.join(RECORDINGS_DIR, finalFilename);

  if (!fs.existsSync(job.tempPath) || fs.statSync(job.tempPath).size < 1024) {
    throw new Error('No video data was written before the recording stopped.');
  }

  try {
    if (finalExt === 'm4a') {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', job.tempPath,
        '-vn',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        finalPath,
      ], { timeout: 120000 });
    } else {
      try {
        await execFileAsync('ffmpeg', [
          '-y',
          '-i', job.tempPath,
          '-c', 'copy',
          '-bsf:a', 'aac_adtstoasc',
          '-movflags', '+faststart',
          finalPath,
        ], { timeout: 120000 });
      } catch {
        await execFileAsync('ffmpeg', [
          '-y',
          '-i', job.tempPath,
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '18',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-movflags', '+faststart',
          finalPath,
        ], { timeout: 300000 });
      }
    }
  } finally {
    try {
      if (fs.existsSync(job.tempPath)) fs.unlinkSync(job.tempPath);
    } catch {
      // Ignore temp cleanup errors
    }
  }

  const stats = fs.statSync(finalPath);
  const probed = await probeMedia(finalPath);

  const item: RecordingItem = {
    id,
    title: job.title,
    channel: job.channel,
    videoId: job.videoId,
    sourceType: 'direct',
    qualityLabel: buildQualityLabel(probed.width, probed.height, job.quality),
    format: finalExt,
    width: probed.width,
    height: probed.height,
    fps: probed.fps,
    durationSeconds: probed.durationSeconds || Math.round((Date.now() - job.startedAt) / 1000),
    sizeBytes: stats.size,
    codec: probed.codec,
    filename: finalFilename,
    createdAt: new Date().toISOString(),
  };

  addRecordingToIndex(item);
  job.status = 'completed';
  job.recordingId = item.id;
  job.lastLog = 'Recording finalized and ready to download.';
  return item;
}

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasCookies: fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 20,
    });
  });

  app.get('/api/cookies/status', (_req, res) => {
    const exists = fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 20;
    res.json({ configured: exists });
  });

  app.post('/api/cookies', (req, res) => {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length < 20) {
      res.status(400).json({ error: 'Please paste a valid Netscape-format cookies.txt export.' });
      return;
    }
    fs.writeFileSync(COOKIES_PATH, content + '\n', 'utf8');
    res.json({ configured: true });
  });

  app.delete('/api/cookies', (_req, res) => {
    if (fs.existsSync(COOKIES_PATH)) {
      fs.unlinkSync(COOKIES_PATH);
    }
    res.json({ configured: false });
  });

  app.post('/api/inspect', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Please enter a YouTube stream or video URL.' });
      return;
    }

    try {
      const baseInfo = await inspectYouTubePage(rawUrl);
      const ytdlpInfo = await probeYtDlpFormats(baseInfo.canonicalUrl);

      res.json({
        ...baseInfo,
        thumbnailUrl: `/api/thumbnail/${baseInfo.videoId}`,
        ...ytdlpInfo,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to inspect that YouTube URL.',
      });
    }
  });

  app.get('/api/thumbnail/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      res.status(400).end();
      return;
    }
    const candidates = [
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    ];
    for (const url of candidates) {
      try {
        const imgRes = await fetch(url);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.send(buf);
          return;
        }
      } catch {
        // try next candidate
      }
    }
    res.status(404).end();
  });

  app.post('/api/direct-record/start', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const quality: CaptureQuality = ['1080p', '720p', '480p', 'audio'].includes(req.body?.quality)
      ? req.body.quality
      : '1080p';
    const title = typeof req.body?.title === 'string' && req.body.title.trim()
      ? req.body.title.trim()
      : 'YouTube Stream Capture';
    const channel = typeof req.body?.channel === 'string' && req.body.channel.trim()
      ? req.body.channel.trim()
      : 'YouTube';
    const videoId = typeof req.body?.videoId === 'string'
      ? req.body.videoId
      : (extractYouTubeId(rawUrl) || '');
    const fromStart = Boolean(req.body?.fromStart);

    if (!rawUrl) {
      res.status(400).json({ error: 'Stream URL is required.' });
      return;
    }

    try {
      const ytDlp = await ensureYtDlp();
      const jobId = crypto.randomUUID();
      const outputExt: 'mp4' | 'm4a' = quality === 'audio' ? 'm4a' : 'mp4';
      const tempExt = quality === 'audio' ? 'aac' : 'ts';
      const tempPath = path.join(TEMP_DIR, `direct_${jobId}.${tempExt}`);

      let formatSelector =
        'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
      if (quality === '720p') {
        formatSelector =
          'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best';
      } else if (quality === '480p') {
        formatSelector =
          'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best';
      } else if (quality === 'audio') {
        formatSelector = 'bestaudio[ext=m4a]/bestaudio/best';
      }

      const job: InternalJob = {
        id: jobId,
        videoId,
        title,
        channel,
        quality,
        status: 'starting',
        startedAt: Date.now(),
        tempPath,
        outputExt,
        lastLog: 'Resolving 1080p stream endpoints...',
      };
      activeJobs.set(jobId, job);

      const handleOutput = (chunk: Buffer) => {
        const text = chunk.toString('utf8').trim();
        if (!text) return;
        const lines = text.split(/[\r\n]+/).filter(Boolean);
        const last = lines[lines.length - 1]?.trim() || '';
        if (last) {
          job.lastLog = last.slice(0, 180);
        }

        if (job.status === 'starting' && (/\[download\]/i.test(last) || /frame=|size=/i.test(last))) {
          job.status = 'recording';
        }
        if (/ERROR:/i.test(text)) {
          job.errorMessage = text.replace(/^ERROR:\s*/i, '').slice(0, 320);
        }
      };

      const startCaptureAsync = async () => {
        try {
          if (fromStart) {
            const args = [
              ...getYtDlpBaseArgs(),
              '--newline',
              '-f', formatSelector,
              ...(quality !== 'audio' ? ['--hls-use-mpegts', '--merge-output-format', 'mkv'] : []),
              '--live-from-start',
              '-o', tempPath,
              rawUrl,
            ];
            const child = spawn(ytDlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            job.process = child;
            child.stdout?.on('data', handleOutput);
            child.stderr?.on('data', handleOutput);
            child.on('close', async (code) => {
              const possiblePaths = [tempPath, `${tempPath}.mkv`, `${tempPath}.mp4`, `${tempPath}.webm`];
              const actualPath = possiblePaths.find((p) => fs.existsSync(p) && fs.statSync(p).size > 1024);
              if (actualPath) job.tempPath = actualPath;
              if (job.stopRequested || (code === 0 && actualPath)) {
                try {
                  await finalizeDirectRecording(job);
                } catch (err) {
                  job.status = 'error';
                  job.errorMessage = err instanceof Error ? err.message : 'Failed to finalize recording.';
                }
              } else {
                job.status = 'error';
                if (!job.errorMessage) job.errorMessage = 'Stream capture stopped before video data was received.';
              }
            });
            return;
          }

          const { stdout: urlOut } = await execFileAsync(
            ytDlp,
            [...getYtDlpBaseArgs(), '-f', formatSelector, '-g', rawUrl],
            { timeout: 20000 },
          );

          if (job.stopRequested) {
            job.status = 'error';
            job.errorMessage = 'Recording stopped before stream started.';
            return;
          }

          const streamUrls = urlOut
            .split(/\r?\n/)
            .map((u) => u.trim())
            .filter((u) => u.startsWith('http'));

          if (streamUrls.length === 0) {
            throw new Error('Could not resolve playable stream URLs from YouTube.');
          }

          const reconnectArgs = [
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
          ];

          let ffArgs: string[];
          if (quality === 'audio') {
            ffArgs = [
              '-y',
              ...reconnectArgs,
              '-i', streamUrls[0],
              '-vn',
              '-c:a', 'aac',
              '-b:a', '192k',
              '-f', 'adts',
              tempPath,
            ];
          } else if (streamUrls.length >= 2) {
            ffArgs = [
              '-y',
              ...reconnectArgs,
              '-i', streamUrls[0],
              ...reconnectArgs,
              '-i', streamUrls[1],
              '-map', '0:v:0',
              '-map', '1:a:0',
              '-c', 'copy',
              '-f', 'mpegts',
              tempPath,
            ];
          } else {
            ffArgs = [
              '-y',
              ...reconnectArgs,
              '-i', streamUrls[0],
              '-c', 'copy',
              '-f', 'mpegts',
              tempPath,
            ];
          }

          job.lastLog = 'Capturing muxed video and audio stream...';
          const child = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
          job.process = child;
          child.stdout?.on('data', handleOutput);
          child.stderr?.on('data', handleOutput);

          child.on('close', async (code) => {
            const hasData = fs.existsSync(tempPath) && fs.statSync(tempPath).size > 1024;
            if ((job.stopRequested || code === 0) && hasData) {
              try {
                await finalizeDirectRecording(job);
              } catch (err) {
                job.status = 'error';
                job.errorMessage = err instanceof Error ? err.message : 'Failed to finalize recording.';
              }
            } else {
              job.status = 'error';
              if (!job.errorMessage) {
                job.errorMessage = 'Stream capture stopped before video data was received.';
              }
            }
          });
        } catch (err) {
          job.status = 'error';
          job.errorMessage = err instanceof Error ? err.message : 'Failed to resolve stream URLs.';
        }
      };

      void startCaptureAsync();

      res.json({
        id: job.id,
        videoId: job.videoId,
        title: job.title,
        channel: job.channel,
        quality: job.quality,
        status: job.status,
        startedAt: job.startedAt,
        elapsedSeconds: 0,
        sizeBytes: 0,
        lastLog: job.lastLog,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to start direct server recording.',
      });
    }
  });

  app.get('/api/direct-record/status/:id', (req, res) => {
    const job = activeJobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Recording job not found.' });
      return;
    }

    const possiblePaths = [job.tempPath, `${job.tempPath}.mkv`, `${job.tempPath}.mp4`, `${job.tempPath}.part`];
    let sizeBytes = 0;
    for (const p of possiblePaths) {
      sizeBytes = Math.max(sizeBytes, getFileSizeSafe(p));
    }
    if (sizeBytes > 2048 && job.status === 'starting') {
      job.status = 'recording';
    }

    res.json({
      id: job.id,
      videoId: job.videoId,
      title: job.title,
      channel: job.channel,
      quality: job.quality,
      status: job.status,
      startedAt: job.startedAt,
      elapsedSeconds: Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000)),
      sizeBytes,
      lastLog: job.lastLog,
      errorMessage: job.errorMessage,
      recordingId: job.recordingId,
    });
  });

  app.post('/api/direct-record/stop/:id', async (req, res) => {
    const job = activeJobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Recording job not found.' });
      return;
    }

    job.stopRequested = true;
    job.status = 'finalizing';
    job.lastLog = 'Stopping stream capture and finalizing MP4...';

    if (job.process && !job.process.killed) {
      try {
        if (job.process.stdin && job.process.stdin.writable) {
          job.process.stdin.write('q\n');
        } else {
          job.process.kill('SIGINT');
        }
      } catch {
        job.process.kill('SIGINT');
      }
      setTimeout(() => {
        if (job.process && !job.process.killed) {
          job.process.kill('SIGINT');
        }
      }, 1500);
      setTimeout(() => {
        if (job.process && !job.process.killed) {
          job.process.kill('SIGTERM');
        }
      }, 4500);
    }

    res.json({ ok: true, status: job.status });
  });

  app.post('/api/recordings/upload', async (req, res) => {
    const id = crypto.randomUUID();
    const rawTitle = req.header('x-title') ? decodeURIComponent(req.header('x-title')!) : 'FHD Stream Recording';
    const rawChannel = req.header('x-channel') ? decodeURIComponent(req.header('x-channel')!) : 'Browser Capture';
    const videoId = req.header('x-video-id') || undefined;
    const qualityHeader = (req.header('x-quality') || '1080p') as CaptureQuality;
    const clientDuration = Number(req.header('x-duration') || 0);
    const mimeHeader = req.header('x-mime-type') || 'video/webm';
    const tempExt = mimeHeader.includes('mp4') ? 'mp4' : 'webm';

    const tempInputPath = path.join(TEMP_DIR, `upload_${id}.${tempExt}`);
    const finalExt: 'mp4' | 'm4a' = qualityHeader === 'audio' ? 'm4a' : 'mp4';
    const safeName = sanitizeFilename(rawTitle);
    const finalFilename = `${safeName}_${id.slice(0, 8)}.${finalExt}`;
    const finalPath = path.join(RECORDINGS_DIR, finalFilename);

    try {
      await pipeline(req, fs.createWriteStream(tempInputPath));

      if (!fs.existsSync(tempInputPath) || fs.statSync(tempInputPath).size < 1024) {
        if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
        res.status(400).json({ error: 'Captured recording was empty.' });
        return;
      }

      if (finalExt === 'm4a') {
        await execFileAsync('ffmpeg', [
          '-y',
          '-i', tempInputPath,
          '-vn',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-movflags', '+faststart',
          finalPath,
        ], { timeout: 180000 });
      } else {
        let scaleFilter = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
        if (qualityHeader === '720p') {
          scaleFilter = "scale='min(1280,iw)':-2,scale=trunc(iw/2)*2:trunc(ih/2)*2";
        } else if (qualityHeader === '480p') {
          scaleFilter = "scale='min(854,iw)':-2,scale=trunc(iw/2)*2:trunc(ih/2)*2";
        } else {
          scaleFilter = "scale='min(1920,iw)':-2,scale=trunc(iw/2)*2:trunc(ih/2)*2";
        }

        await execFileAsync('ffmpeg', [
          '-y',
          '-fflags', '+genpts',
          '-i', tempInputPath,
          '-vf', scaleFilter,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '18',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-movflags', '+faststart',
          finalPath,
        ], { timeout: 300000 });
      }

      try {
        if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
      } catch {
        // ignore cleanup error
      }

      const stats = fs.statSync(finalPath);
      const probed = await probeMedia(finalPath);

      const item: RecordingItem = {
        id,
        title: rawTitle,
        channel: rawChannel,
        videoId,
        sourceType: 'tab',
        qualityLabel: buildQualityLabel(probed.width, probed.height, qualityHeader),
        format: finalExt,
        width: probed.width,
        height: probed.height,
        fps: probed.fps,
        durationSeconds: probed.durationSeconds || clientDuration,
        sizeBytes: stats.size,
        codec: probed.codec,
        filename: finalFilename,
        createdAt: new Date().toISOString(),
      };

      addRecordingToIndex(item);
      res.json(item);
    } catch (err) {
      try {
        if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
      } catch {
        // ignore
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to encode recording to FHD MP4.',
      });
    }
  });

  app.get('/api/recordings', (_req, res) => {
    const items = loadRecordingsIndex();
    res.json({ recordings: items });
  });

  app.patch('/api/recordings/:id', (req, res) => {
    const newTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!newTitle) {
      res.status(400).json({ error: 'Title cannot be empty.' });
      return;
    }
    const items = loadRecordingsIndex();
    const idx = items.findIndex((item) => item.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Recording not found.' });
      return;
    }
    items[idx] = { ...items[idx], title: newTitle.slice(0, 120) };
    saveRecordingsIndex(items);
    res.json(items[idx]);
  });

  app.delete('/api/recordings/:id', (req, res) => {
    const items = loadRecordingsIndex();
    const target = items.find((item) => item.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Recording not found.' });
      return;
    }
    const filePath = path.join(RECORDINGS_DIR, target.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const remaining = items.filter((item) => item.id !== req.params.id);
    saveRecordingsIndex(remaining);
    res.json({ ok: true });
  });

  app.get('/api/recordings/:id/stream', (req, res) => {
    const items = loadRecordingsIndex();
    const target = items.find((item) => item.id === req.params.id);
    if (!target) {
      res.status(404).end();
      return;
    }
    const filePath = path.join(RECORDINGS_DIR, target.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).end();
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const contentType = target.format === 'm4a' ? 'audio/mp4' : 'video/mp4';
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  app.get('/api/recordings/:id/download', (req, res) => {
    const items = loadRecordingsIndex();
    const target = items.find((item) => item.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Recording not found.' });
      return;
    }
    const filePath = path.join(RECORDINGS_DIR, target.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Recording file missing on disk.' });
      return;
    }

    const downloadName = `${sanitizeFilename(target.title)}.${target.format}`;
    res.download(filePath, downloadName);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StreamVault server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start StreamVault server:', err);
  process.exit(1);
});
