import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, ExternalLink, Link2, Loader2 } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { StreamMonitor } from './components/StreamMonitor';
import { RecordingDeck } from './components/RecordingDeck';
import { RecordingsArchive } from './components/RecordingsArchive';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { CookiesModal } from './components/CookiesModal';
import type {
  CaptureMode,
  CaptureQuality,
  DirectRecordJob,
  RecordingItem,
  StreamInspectResult,
} from './types';

const SAMPLE_STREAMS = [
  {
    label: 'Al Jazeera English Live',
    url: 'https://www.youtube.com/@AlJazeeraEnglish/live',
  },
  {
    label: 'Sky News Live',
    url: 'https://www.youtube.com/@SkyNews/live',
  },
];

function detectDisplayCaptureRestricted(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    return true;
  }
  const doc = document as Document & {
    featurePolicy?: { allowsFeature: (f: string) => boolean };
    permissionsPolicy?: { allowsFeature: (f: string) => boolean };
  };
  const policy = doc.permissionsPolicy || doc.featurePolicy;
  if (policy && typeof policy.allowsFeature === 'function') {
    return !policy.allowsFeature('display-capture');
  }
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export default function App() {
  const [urlInput, setUrlInput] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [streamInfo, setStreamInfo] = useState<StreamInspectResult | null>(null);

  const [displayCaptureRestricted, setDisplayCaptureRestricted] = useState<boolean>(() =>
    detectDisplayCaptureRestricted(),
  );
  const [mode, setMode] = useState<CaptureMode>('tab');
  const [quality, setQuality] = useState<CaptureQuality>('1080p');
  const [fromStart, setFromStart] = useState(false);

  const [hasCookies, setHasCookies] = useState(false);
  const [cookiesModalOpen, setCookiesModalOpen] = useState(false);

  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(true);
  const [activePlayerItem, setActivePlayerItem] = useState<RecordingItem | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [requiresCookiesError, setRequiresCookiesError] = useState(false);
  const [iframeBlockedHint, setIframeBlockedHint] = useState(false);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Browser Tab Capture state
  const [isTabCapturing, setIsTabCapturing] = useState(false);
  const [isTabPaused, setIsTabPaused] = useState(false);
  const [tabElapsedSeconds, setTabElapsedSeconds] = useState(0);
  const [tabRecordedBytes, setTabRecordedBytes] = useState(0);
  const [tabResolution, setTabResolution] = useState<{ width: number; height: number } | null>(null);
  const [captureStream, setCaptureStream] = useState<MediaStream | null>(null);
  const [isUploadingMp4, setIsUploadingMp4] = useState(false);
  const [rawFallbackUrl, setRawFallbackUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const tabTimerRef = useRef<number | null>(null);
  const tabPausedRef = useRef(false);
  const tabElapsedRef = useRef(0);

  // Direct Server Stream state
  const [directJob, setDirectJob] = useState<DirectRecordJob | null>(null);

  const fetchRecordings = useCallback(async () => {
    try {
      const res = await fetch('/api/recordings');
      if (res.ok) {
        const data = (await res.json()) as { recordings: RecordingItem[] };
        setRecordings(data.recordings || []);
      }
    } finally {
      setLoadingRecordings(false);
    }
  }, []);

  useEffect(() => {
    setDisplayCaptureRestricted(detectDisplayCaptureRestricted());
    fetchRecordings();
    fetch('/api/cookies/status')
      .then((r) => r.json())
      .then((d: { configured?: boolean }) => setHasCookies(Boolean(d.configured)))
      .catch(() => {});

    const params = new URLSearchParams(window.location.search);
    const paramUrl = params.get('url');
    const paramQuality = params.get('quality') as CaptureQuality | null;
    if (paramQuality && ['1080p', '720p', '480p', 'audio'].includes(paramQuality)) {
      setQuality(paramQuality);
    }
    if (paramUrl) {
      setUrlInput(paramUrl);
      inspectUrl(paramUrl);
    }

    const handleFocusSync = () => {
      fetchRecordings();
    };
    const handleVisibilitySync = () => {
      if (document.visibilityState === 'visible') {
        fetchRecordings();
      }
    };
    window.addEventListener('focus', handleFocusSync);
    document.addEventListener('visibilitychange', handleVisibilitySync);
    return () => {
      window.removeEventListener('focus', handleFocusSync);
      document.removeEventListener('visibilitychange', handleVisibilitySync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRecordings]);

  useEffect(() => {
    if (!directJob) return;
    if (
      directJob.status !== 'starting' &&
      directJob.status !== 'recording' &&
      directJob.status !== 'finalizing'
    ) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/direct-record/status/${directJob.id}`);
        if (!res.ok) return;
        const updated = (await res.json()) as DirectRecordJob;
        setDirectJob(updated);

        if (updated.status === 'completed') {
          await fetchRecordings();
          setSuccessNotice(`Saved "${updated.title}" to your recordings archive.`);
        } else if (updated.status === 'error') {
          const msg = updated.errorMessage || 'Direct stream recording failed.';
          setErrorMsg(msg);
          if (/sign in|bot|cookies/i.test(msg)) {
            setRequiresCookiesError(true);
          }
        }
      } catch {
        // ignore transient poll error
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [directJob, fetchRecordings]);

  const inspectUrl = async (targetUrl: string) => {
    const clean = targetUrl.trim();
    if (!clean) {
      setErrorMsg('Enter a YouTube stream or video URL first.');
      return;
    }

    setInspecting(true);
    setErrorMsg(null);
    setRequiresCookiesError(false);
    setSuccessNotice(null);

    try {
      const res = await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: clean }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Could not load that YouTube stream.');
        return;
      }
      const info = data as StreamInspectResult;
      setStreamInfo(info);
      if (info.directCaptureAvailable && mode === 'tab') {
        // Keep current user mode, or inform if direct requires cookies
      }
      if (mode === 'direct' && !info.directCaptureAvailable && info.requiresCookies) {
        setErrorMsg(info.inspectNote || 'YouTube requested verification for direct server capture.');
        setRequiresCookiesError(true);
      }
    } catch {
      setErrorMsg('Network error inspecting the YouTube URL.');
    } finally {
      setInspecting(false);
    }
  };

  const handleInspectSubmit = (e: FormEvent) => {
    e.preventDefault();
    inspectUrl(urlInput);
  };

  const cleanupTabCapture = useCallback(() => {
    if (tabTimerRef.current !== null) {
      window.clearInterval(tabTimerRef.current);
      tabTimerRef.current = null;
    }
    if (captureStreamRef.current) {
      captureStreamRef.current.getTracks().forEach((t) => t.stop());
      captureStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setCaptureStream(null);
    setIsTabCapturing(false);
    setIsTabPaused(false);
    tabPausedRef.current = false;
  }, []);

  const uploadRecordedBlob = useCallback(
    async (blob: Blob, durationSec: number) => {
      setIsUploadingMp4(true);
      setErrorMsg(null);
      const fallbackObjectUrl = URL.createObjectURL(blob);
      setRawFallbackUrl(fallbackObjectUrl);

      const title = streamInfo?.title
        ? `${streamInfo.title}`
        : `Stream Capture ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const channel = streamInfo?.channel || 'Browser Tab Capture';

      try {
        const res = await fetch('/api/recordings/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-title': encodeURIComponent(title),
            'x-channel': encodeURIComponent(channel),
            ...(streamInfo?.videoId ? { 'x-video-id': streamInfo.videoId } : {}),
            'x-quality': quality,
            'x-duration': String(durationSec),
            'x-mime-type': blob.type || 'video/webm',
          },
          body: blob,
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'MP4 encoding failed.');
        }

        const saved = data as RecordingItem;
        setRecordings((prev) => [saved, ...prev]);
        setSuccessNotice(
          `Saved "${saved.title}" (${saved.width > 0 ? `${saved.width}×${saved.height}` : saved.qualityLabel}) ready for MP4 download.`,
        );
        URL.revokeObjectURL(fallbackObjectUrl);
        setRawFallbackUrl(null);
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? `${err.message} You can still use Save Raw Capture below.`
            : 'MP4 conversion failed.',
        );
      } finally {
        setIsUploadingMp4(false);
      }
    },
    [quality, streamInfo],
  );

  const handleStartTabCapture = async () => {
    setErrorMsg(null);
    setRequiresCookiesError(false);
    setIframeBlockedHint(false);
    setSuccessNotice(null);

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      setErrorMsg(
        'Screen/Tab capture API is unavailable in this browser context. Open StreamVault in a dedicated browser tab or use Direct Stream mode.',
      );
      setIframeBlockedHint(true);
      return;
    }

    const constraintsByQuality: Record<
      CaptureQuality,
      { width: number; height: number; fps: number; bps: number }
    > = {
      '1080p': { width: 1920, height: 1080, fps: 60, bps: 10_000_000 },
      '720p': { width: 1280, height: 720, fps: 60, bps: 5_000_000 },
      '480p': { width: 854, height: 480, fps: 30, bps: 2_500_000 },
      audio: { width: 1280, height: 720, fps: 15, bps: 500_000 },
    };
    const cfg = constraintsByQuality[quality];

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: cfg.width },
          height: { ideal: cfg.height },
          frameRate: { ideal: cfg.fps },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const videoTrack = displayStream.getVideoTracks()[0];
      const settings = videoTrack?.getSettings();
      if (settings?.width && settings?.height) {
        setTabResolution({ width: settings.width, height: settings.height });
      } else {
        setTabResolution({ width: cfg.width, height: cfg.height });
      }

      const streamForRecorder =
        quality === 'audio' && displayStream.getAudioTracks().length > 0
          ? new MediaStream(displayStream.getAudioTracks())
          : displayStream;

      const mimeCandidates =
        quality === 'audio'
          ? ['audio/webm;codecs=opus', 'audio/webm', 'video/webm']
          : [
              'video/webm;codecs=vp9,opus',
              'video/webm;codecs=h264,opus',
              'video/webm;codecs=vp8,opus',
              'video/mp4',
              'video/webm',
            ];

      const chosenMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));
      const recorderOptions: MediaRecorderOptions = {
        ...(chosenMime ? { mimeType: chosenMime } : {}),
        ...(quality === 'audio'
          ? { audioBitsPerSecond: 192_000 }
          : { videoBitsPerSecond: cfg.bps, audioBitsPerSecond: 192_000 }),
      };

      const recorder = new MediaRecorder(streamForRecorder, recorderOptions);
      recordedChunksRef.current = [];
      tabElapsedRef.current = 0;
      setTabElapsedSeconds(0);
      setTabRecordedBytes(0);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
          setTabRecordedBytes((prev) => prev + ev.data.size);
        }
      };

      recorder.onstop = () => {
        const finalDuration = tabElapsedRef.current;
        const mimeType = recorder.mimeType || chosenMime || 'video/webm';
        const fullBlob = new Blob(recordedChunksRef.current, { type: mimeType });
        cleanupTabCapture();
        if (fullBlob.size > 1024) {
          uploadRecordedBlob(fullBlob, finalDuration);
        }
      };

      if (videoTrack) {
        videoTrack.onended = () => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
        };
      }

      captureStreamRef.current = displayStream;
      mediaRecorderRef.current = recorder;
      setCaptureStream(displayStream);
      setIsTabCapturing(true);
      setIsTabPaused(false);
      tabPausedRef.current = false;

      recorder.start(1000);
      tabTimerRef.current = window.setInterval(() => {
        if (!tabPausedRef.current) {
          tabElapsedRef.current += 1;
          setTabElapsedSeconds(tabElapsedRef.current);
        }
      }, 1000);
    } catch (err) {
      const domErr = err as { name?: string; message?: string };
      if (domErr?.name === 'NotAllowedError') {
        if (/permissions policy|display-capture/i.test(domErr.message || '')) {
          setErrorMsg(
            'Browser tab capture is restricted inside this embedded preview iframe. Open StreamVault in a standalone browser tab to capture 1080p FHD.',
          );
          setIframeBlockedHint(true);
        }
        return;
      }
      setErrorMsg(domErr?.message || 'Unable to start browser tab capture.');
    }
  };

  const handleToggleTabPause = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      tabPausedRef.current = true;
      setIsTabPaused(true);
    } else if (rec.state === 'paused') {
      rec.resume();
      tabPausedRef.current = false;
      setIsTabPaused(false);
    }
  };

  const handleStopTabCapture = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop();
    } else {
      cleanupTabCapture();
    }
  };

  const handleStartDirectRecord = async () => {
    if (!streamInfo) return;
    setErrorMsg(null);
    setRequiresCookiesError(false);
    setSuccessNotice(null);

    try {
      const res = await fetch('/api/direct-record/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: streamInfo.canonicalUrl,
          videoId: streamInfo.videoId,
          title: streamInfo.title,
          channel: streamInfo.channel,
          quality,
          fromStart,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Could not start server recording.');
        return;
      }
      setDirectJob(data as DirectRecordJob);
    } catch {
      setErrorMsg('Network error starting server recording.');
    }
  };

  const handleStopDirectRecord = async () => {
    if (!directJob) return;
    try {
      await fetch(`/api/direct-record/stop/${directJob.id}`, { method: 'POST' });
    } catch {
      setErrorMsg('Failed to signal server stop.');
    }
  };

  const handleRenameRecording = async (id: string, newTitle: string) => {
    const res = await fetch(`/api/recordings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    if (res.ok) {
      const updated = (await res.json()) as RecordingItem;
      setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)));
    }
  };

  const handleDeleteRecording = async (id: string) => {
    const res = await fetch(`/api/recordings/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setRecordings((prev) => prev.filter((r) => r.id !== id));
      if (activePlayerItem?.id === id) {
        setActivePlayerItem(null);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      <TopBar
        hasCookies={hasCookies}
        onOpenCookies={() => setCookiesModalOpen(true)}
      />

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8 space-y-8">
        <section id="capture" className="space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white [text-wrap:balance]">
                Record YouTube Streams in Full HD 1080p
              </h1>
              <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
                Load any live broadcast or video URL, capture in 1080p60 with stereo audio, and
                download FastStart MP4 files directly from your archive.
              </p>
            </div>
          </div>

          <div className="bg-[#111723] border border-white/[0.08] rounded-xl p-4 sm:p-5 space-y-3">
            <form onSubmit={handleInspectSubmit} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Link2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=... or https://www.youtube.com/@Channel/live"
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#0A0E16] border border-white/[0.1] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-slate-400"
                />
              </div>
              <button
                type="submit"
                disabled={inspecting}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold bg-white text-slate-950 hover:bg-slate-200 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {inspecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading Stream...</span>
                  </>
                ) : (
                  <span>Load Stream</span>
                )}
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span>Quick load:</span>
              {SAMPLE_STREAMS.map((sample) => (
                <button
                  key={sample.url}
                  type="button"
                  onClick={() => {
                    setUrlInput(sample.url);
                    inspectUrl(sample.url);
                  }}
                  className="text-slate-300 hover:text-white underline underline-offset-4 decoration-slate-600 hover:decoration-slate-300 transition-colors cursor-pointer"
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>

          {successNotice && (
            <div className="px-4 py-3 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-200 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{successNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setSuccessNotice(null)}
                className="text-emerald-300 hover:text-white text-xs font-medium cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {iframeBlockedHint && (
            <div className="px-4 py-3 rounded-lg bg-amber-950/40 border border-amber-500/30 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-4">
              <span>
                Tab capture requires top-level browser permissions when embedded in a restricted
                iframe. Open StreamVault in a standalone tab for full 1080p capture.
              </span>
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-400 text-slate-950 font-semibold rounded-md hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0"
              >
                <span>Open in New Tab</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <div className="lg:col-span-8">
              <StreamMonitor
                streamInfo={streamInfo}
                isTabCapturing={isTabCapturing}
                captureStream={captureStream}
                captureResolution={tabResolution}
                selectedQuality={quality}
              />
            </div>
            <div className="lg:col-span-4">
              <RecordingDeck
                mode={mode}
                onModeChange={(next) => {
                  setMode(next);
                  setErrorMsg(null);
                  setRequiresCookiesError(false);
                }}
                quality={quality}
                onQualityChange={setQuality}
                streamInfo={streamInfo}
                fromStart={fromStart}
                onFromStartChange={setFromStart}
                displayCaptureRestricted={displayCaptureRestricted}
                standaloneUrl={(() => {
                  const target = new URL(window.location.origin + window.location.pathname);
                  const activeStreamUrl = streamInfo?.canonicalUrl || urlInput.trim();
                  if (activeStreamUrl) target.searchParams.set('url', activeStreamUrl);
                  target.searchParams.set('quality', quality);
                  return target.toString();
                })()}
                isTabCapturing={isTabCapturing}
                isTabPaused={isTabPaused}
                tabElapsedSeconds={tabElapsedSeconds}
                tabRecordedBytes={tabRecordedBytes}
                tabResolution={tabResolution}
                isUploadingMp4={isUploadingMp4}
                rawFallbackUrl={rawFallbackUrl}
                onStartTabCapture={handleStartTabCapture}
                onToggleTabPause={handleToggleTabPause}
                onStopTabCapture={handleStopTabCapture}
                directJob={directJob}
                onStartDirectRecord={handleStartDirectRecord}
                onStopDirectRecord={handleStopDirectRecord}
                errorMsg={errorMsg}
                requiresCookiesError={requiresCookiesError}
                onOpenCookies={() => setCookiesModalOpen(true)}
              />
            </div>
          </div>
        </section>

        <RecordingsArchive
          recordings={recordings}
          isLoading={loadingRecordings}
          onPlay={(item) => setActivePlayerItem(item)}
          onRename={handleRenameRecording}
          onDelete={handleDeleteRecording}
        />

        <section
          id="workflow"
          className="border-t border-white/[0.08] pt-8 grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          <div>
            <h3 className="font-display text-sm font-semibold text-white mb-1.5">
              01. Load Any YouTube Stream
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Paste a standard watch link, live handle URL, or short link to resolve stream title,
              channel metadata, and live status in the monitor.
            </p>
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-white mb-1.5">
              02. Capture in 1080p60 FHD
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Use Browser Tab Capture for zero-cookie 1080p60 recording of any open YouTube tab, or
              Direct Stream capture with yt-dlp and FFmpeg.
            </p>
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-white mb-1.5">
              03. Play &amp; Download MP4
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Every stopped capture is remuxed with FFmpeg FastStart into a seekable H.264/AAC MP4
              file ready for immediate preview and download.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.08] py-5 px-6 text-xs text-slate-500">
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <span>StreamVault · Full HD Stream Recording Studio</span>
          <span>Use only for streams you are authorized to record and archive.</span>
        </div>
      </footer>

      <VideoPlayerModal
        recording={activePlayerItem}
        onClose={() => setActivePlayerItem(null)}
      />

      <CookiesModal
        isOpen={cookiesModalOpen}
        hasCookies={hasCookies}
        onClose={() => setCookiesModalOpen(false)}
        onSaved={(configured) => {
          setHasCookies(configured);
          setRequiresCookiesError(false);
          if (configured && streamInfo) {
            inspectUrl(streamInfo.canonicalUrl);
          }
        }}
      />
    </div>
  );
}
