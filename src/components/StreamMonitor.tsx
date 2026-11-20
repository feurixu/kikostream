import { useEffect, useRef, useState } from 'react';
import { ExternalLink, MonitorPlay, Radio, Tv, Volume2 } from 'lucide-react';
import type { CaptureQuality, StreamInspectResult } from '../types';

interface StreamMonitorProps {
  streamInfo: StreamInspectResult | null;
  isTabCapturing: boolean;
  captureStream: MediaStream | null;
  captureResolution: { width: number; height: number } | null;
  selectedQuality: CaptureQuality;
}

type MonitorView = 'player' | 'poster' | 'capture';

export function StreamMonitor({
  streamInfo,
  isTabCapturing,
  captureStream,
  captureResolution,
  selectedQuality,
}: StreamMonitorProps) {
  const [view, setView] = useState<MonitorView>('player');
  const [posterError, setPosterError] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setPosterError(false);
    if (streamInfo && !isTabCapturing) {
      setView('player');
    }
  }, [streamInfo, isTabCapturing]);

  useEffect(() => {
    if (isTabCapturing && captureStream) {
      setView('capture');
    } else if (!isTabCapturing && view === 'capture') {
      setView(streamInfo ? 'player' : 'poster');
    }
  }, [isTabCapturing, captureStream, streamInfo, view]);

  useEffect(() => {
    const videoEl = previewVideoRef.current;
    if (!videoEl) return;
    if (captureStream && view === 'capture') {
      videoEl.srcObject = captureStream;
      videoEl.play().catch(() => {});
    } else {
      videoEl.srcObject = null;
    }
  }, [captureStream, view]);

  useEffect(() => {
    if (!captureStream || !isTabCapturing) {
      setAudioLevel(0);
      return;
    }
    const audioTracks = captureStream.getAudioTracks();
    if (audioTracks.length === 0) {
      setAudioLevel(0);
      return;
    }

    let rafId = 0;
    let ctx: AudioContext | null = null;

    try {
      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(new MediaStream([audioTracks[0]]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
        }
        const avg = sum / data.length;
        setAudioLevel(Math.min(100, Math.round((avg / 140) * 100)));
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    } catch {
      setAudioLevel(0);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (ctx) ctx.close().catch(() => {});
    };
  }, [captureStream, isTabCapturing]);

  const qualityText =
    selectedQuality === '1080p'
      ? '1920×1080 FHD'
      : selectedQuality === '720p'
      ? '1280×720 HD'
      : selectedQuality === '480p'
      ? '854×480 SD'
      : 'AAC Audio';

  return (
    <div className="bg-[#111723] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col h-full">
      <div className="px-5 py-3.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Tv className="w-4 h-4 text-slate-400 shrink-0" />
          <h2 className="font-display text-sm font-semibold text-slate-100 truncate">
            Stream Monitor
          </h2>
          {isTabCapturing && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 whitespace-nowrap shrink-0">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              Capturing Live
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {(streamInfo || isTabCapturing) && (
            <div className="flex items-center gap-1 p-0.5 bg-[#0A0E16] border border-white/[0.08] rounded-lg">
              {streamInfo && (
                <>
                  <button
                    type="button"
                    onClick={() => setView('player')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      view === 'player'
                        ? 'bg-white/[0.12] text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    YouTube Player
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('poster')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      view === 'poster'
                        ? 'bg-white/[0.12] text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Thumbnail
                  </button>
                </>
              )}
              {isTabCapturing && (
                <button
                  type="button"
                  onClick={() => setView('capture')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    view === 'capture'
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Capture Feed
                </button>
              )}
            </div>
          )}

          {streamInfo && (
            <a
              href={streamInfo.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              <span>Open Tab</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      <div className="relative aspect-video bg-[#070A10] w-full flex items-center justify-center overflow-hidden">
        {isTabCapturing && view === 'capture' ? (
          <div className="relative w-full h-full">
            <video
              ref={previewVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain bg-black"
            />
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-4 px-3.5 py-2 bg-black/75 backdrop-blur-sm border border-white/10 rounded-lg">
              <div className="flex items-center gap-2.5 text-xs text-slate-200 font-mono">
                <Volume2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div className="w-28 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-75"
                    style={{ width: `${audioLevel}%` }}
                  />
                </div>
                <span className="text-slate-400">
                  {captureStream && captureStream.getAudioTracks().length > 0
                    ? 'Audio Active'
                    : 'No Audio Track'}
                </span>
              </div>
              <div className="font-mono text-xs text-slate-200">
                {captureResolution
                  ? `${captureResolution.width}×${captureResolution.height}`
                  : qualityText}
              </div>
            </div>
          </div>
        ) : streamInfo && view === 'player' ? (
          <iframe
            key={streamInfo.videoId}
            src={`https://www.youtube-nocookie.com/embed/${streamInfo.videoId}?rel=0&modestbranding=1`}
            title={streamInfo.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="w-full h-full border-0"
          />
        ) : streamInfo && view === 'poster' ? (
          !posterError ? (
            <img
              src={streamInfo.thumbnailUrl}
              alt={streamInfo.title}
              referrerPolicy="no-referrer"
              onError={() => setPosterError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-[#070A10] p-8 text-center">
              <MonitorPlay className="w-10 h-10 text-slate-500 mb-3" />
              <p className="text-sm font-medium text-slate-300 max-w-md">{streamInfo.title}</p>
            </div>
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center relative">
            <div
              className="absolute inset-0 opacity-20 pointer-events-none"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(148,163,184,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.12) 1px, transparent 1px)',
                backgroundSize: '48px 48px',
              }}
            />
            <div className="relative z-10 max-w-md flex flex-col items-center">
              <div className="w-12 h-12 rounded-xl border border-white/[0.12] bg-white/[0.03] flex items-center justify-center mb-4">
                <Radio className="w-5 h-5 text-slate-300" />
              </div>
              <p className="font-display text-base font-semibold text-slate-100 mb-1.5">
                Ready for Full HD Stream Capture
              </p>
              <p className="text-sm text-slate-400 leading-relaxed">
                Paste any YouTube Live or video URL above to preview it here, or click Start 1080p
                Capture in the Recording Deck to record any open YouTube browser tab directly.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-3.5 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        {streamInfo ? (
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="font-medium text-slate-200 truncate max-w-md">{streamInfo.title}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{streamInfo.channel}</span>
            <span aria-hidden="true">·</span>
            <span className={streamInfo.isLive ? 'text-rose-400 font-medium' : 'text-slate-400'}>
              {streamInfo.isLive ? 'Live Stream' : 'YouTube Video'}
            </span>
          </div>
        ) : (
          <span>No stream loaded · Browser Tab Capture works with any active YouTube tab</span>
        )}
        <span className="font-mono text-slate-300 shrink-0">{qualityText}</span>
      </div>
    </div>
  );
}
