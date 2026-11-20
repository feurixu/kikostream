import {
  AlertCircle,
  Download,
  ExternalLink,
  Monitor,
  Pause,
  Play,
  Server,
  Square,
} from 'lucide-react';
import type {
  CaptureMode,
  CaptureQuality,
  DirectRecordJob,
  StreamInspectResult,
} from '../types';
import { formatBytes, formatDuration } from '../utils/format';

interface RecordingDeckProps {
  mode: CaptureMode;
  onModeChange: (mode: CaptureMode) => void;
  quality: CaptureQuality;
  onQualityChange: (q: CaptureQuality) => void;
  streamInfo: StreamInspectResult | null;
  fromStart: boolean;
  onFromStartChange: (val: boolean) => void;
  displayCaptureRestricted: boolean;
  standaloneUrl: string;
  // Browser Tab Capture state
  isTabCapturing: boolean;
  isTabPaused: boolean;
  tabElapsedSeconds: number;
  tabRecordedBytes: number;
  tabResolution: { width: number; height: number } | null;
  isUploadingMp4: boolean;
  rawFallbackUrl: string | null;
  onStartTabCapture: () => void;
  onToggleTabPause: () => void;
  onStopTabCapture: () => void;
  // Direct Server Stream state
  directJob: DirectRecordJob | null;
  onStartDirectRecord: () => void;
  onStopDirectRecord: () => void;
  // Errors & shortcuts
  errorMsg: string | null;
  requiresCookiesError: boolean;
  onOpenCookies: () => void;
}

const QUALITY_OPTIONS: Array<{ id: CaptureQuality; label: string }> = [
  { id: '1080p', label: '1080p FHD' },
  { id: '720p', label: '720p HD' },
  { id: '480p', label: '480p SD' },
  { id: 'audio', label: 'Audio M4A' },
];

export function RecordingDeck({
  mode,
  onModeChange,
  quality,
  onQualityChange,
  streamInfo,
  fromStart,
  onFromStartChange,
  displayCaptureRestricted,
  standaloneUrl,
  isTabCapturing,
  isTabPaused,
  tabElapsedSeconds,
  tabRecordedBytes,
  tabResolution,
  isUploadingMp4,
  rawFallbackUrl,
  onStartTabCapture,
  onToggleTabPause,
  onStopTabCapture,
  directJob,
  onStartDirectRecord,
  onStopDirectRecord,
  errorMsg,
  requiresCookiesError,
  onOpenCookies,
}: RecordingDeckProps) {
  const isDirectActive =
    directJob !== null &&
    (directJob.status === 'starting' ||
      directJob.status === 'recording' ||
      directJob.status === 'finalizing');

  const isAnyRecording = isTabCapturing || isDirectActive;

  const activeElapsed =
    mode === 'tab'
      ? tabElapsedSeconds
      : directJob?.elapsedSeconds || 0;

  const activeBytes =
    mode === 'tab'
      ? tabRecordedBytes
      : directJob?.sizeBytes || 0;

  const statusText = (() => {
    if (isUploadingMp4) return 'Encoding MP4';
    if (mode === 'tab') {
      if (isTabCapturing) return isTabPaused ? 'Paused' : 'Recording';
      return 'Standby';
    }
    if (directJob) {
      if (directJob.status === 'starting') return 'Connecting';
      if (directJob.status === 'recording') return 'Recording';
      if (directJob.status === 'finalizing') return 'Finalizing MP4';
      if (directJob.status === 'error') return 'Error';
    }
    return 'Standby';
  })();

  const resolutionDisplay =
    mode === 'tab' && tabResolution
      ? `${tabResolution.width}×${tabResolution.height}`
      : quality === '1080p'
      ? '1920×1080'
      : quality === '720p'
      ? '1280×720'
      : quality === '480p'
      ? '854×480'
      : 'AAC 192k';

  return (
    <div className="bg-[#111723] border border-white/[0.08] rounded-xl p-6 flex flex-col justify-between gap-6 h-full">
      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-display text-base font-semibold text-white">
              Recording Deck
            </h2>
            <span
              className={`text-xs font-medium ${
                statusText === 'Recording'
                  ? 'text-rose-400'
                  : statusText === 'Encoding MP4' || statusText === 'Finalizing MP4'
                  ? 'text-amber-400'
                  : statusText === 'Error'
                  ? 'text-rose-400'
                  : 'text-slate-400'
              }`}
            >
              {statusText}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 bg-[#0A0E16] border border-white/[0.08] rounded-lg">
            <button
              type="button"
              disabled={isAnyRecording || isUploadingMp4}
              onClick={() => onModeChange('tab')}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                mode === 'tab'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Tab Capture</span>
            </button>
            <button
              type="button"
              disabled={isAnyRecording || isUploadingMp4}
              onClick={() => onModeChange('direct')}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                mode === 'direct'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>Direct Stream</span>
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Target Resolution</span>
            <span className="font-mono text-slate-300">
              {quality === 'audio' ? 'M4A Container' : 'MP4 FastStart'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-1.5">
            {QUALITY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={isAnyRecording || isUploadingMp4}
                onClick={() => onQualityChange(opt.id)}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  quality === opt.id
                    ? 'bg-rose-600/15 border-rose-500/60 text-white'
                    : 'bg-[#0A0E16] border-white/[0.08] text-slate-400 hover:text-slate-200 hover:border-white/[0.15]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="py-5 border-y border-white/[0.08]">
          <div className="text-xs text-slate-400 mb-1">Elapsed Timecode</div>
          <div className="font-mono text-4xl font-semibold tracking-tight text-white tabular-nums">
            {formatDuration(activeElapsed)}
          </div>

          <div className="grid grid-cols-3 gap-4 mt-5 pt-4 border-t border-white/[0.06]">
            <div>
              <div className="text-[11px] text-slate-400">Captured Size</div>
              <div className="font-mono text-sm font-medium text-slate-100 mt-0.5 tabular-nums">
                {formatBytes(activeBytes)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">Resolution</div>
              <div className="font-mono text-sm font-medium text-slate-100 mt-0.5 tabular-nums">
                {resolutionDisplay}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">Format</div>
              <div className="font-mono text-sm font-medium text-slate-100 mt-0.5">
                {quality === 'audio' ? 'M4A' : 'MP4'}
              </div>
            </div>
          </div>
        </div>

        {mode === 'direct' && (
          <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={fromStart}
              disabled={isAnyRecording}
              onChange={(e) => onFromStartChange(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-[#0A0E16] accent-rose-600"
            />
            <span>Capture live stream from start (when DVR is enabled)</span>
          </label>
        )}

        {directJob && isDirectActive && (
          <p className="text-xs font-mono text-slate-400 truncate" title={directJob.lastLog}>
            {directJob.lastLog}
          </p>
        )}

        {errorMsg && (
          <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200 space-y-2.5">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{errorMsg}</p>
            </div>
            {requiresCookiesError && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onModeChange('tab')}
                  className="px-3 py-1.5 text-xs font-medium bg-white text-slate-950 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Use Tab Capture (No Cookies)
                </button>
                <button
                  type="button"
                  onClick={onOpenCookies}
                  className="px-3 py-1.5 text-xs font-medium bg-white/10 text-white rounded-md hover:bg-white/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Add Cookies
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {mode === 'tab' ? (
          isUploadingMp4 ? (
            <div className="space-y-2.5">
              <button
                type="button"
                disabled
                className="w-full py-3 px-4 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-200 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <span>Encoding 1080p FHD MP4...</span>
              </button>
              {rawFallbackUrl && (
                <a
                  href={rawFallbackUrl}
                  download={`streamvault_raw_${Date.now()}.webm`}
                  className="w-full py-2 px-4 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-slate-200 text-xs font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Save Raw Capture Now</span>
                </a>
              )}
            </div>
          ) : !isTabCapturing ? (
            displayCaptureRestricted ? (
              <div className="space-y-3">
                <a
                  href={standaloneUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <span>Open Standalone Tab for 1080p Capture</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Embedded preview iframes block browser screen capture. Launching the standalone tab
                  enables 1080p60 tab capture and syncs your saved MP4 back here automatically.
                </p>
                <button
                  type="button"
                  onClick={() => onModeChange('direct')}
                  className="w-full py-2 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                >
                  Or Switch to Direct Stream (Server Capture)
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={onStartTabCapture}
                  className="w-full py-3 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-white" />
                  <span>Start {quality === '1080p' ? '1080p FHD' : quality.toUpperCase()} Capture</span>
                </button>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Select this StreamVault tab or any open YouTube tab and enable Share Tab Audio for
                  full 1080p capture.
                </p>
              </div>
            )
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onToggleTabPause}
                className="py-3 px-4 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {isTabPaused ? (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Resume</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-4 h-4" />
                    <span>Pause</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onStopTabCapture}
                className="py-3 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop & Save</span>
              </button>
            </div>
          )
        ) : !isDirectActive ? (
          <div className="space-y-2.5">
            <button
              type="button"
              disabled={!streamInfo}
              onClick={onStartDirectRecord}
              className="w-full py-3 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:bg-white/[0.06] disabled:text-slate-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-current" />
              <span>
                {streamInfo
                  ? `Record Stream (${quality === '1080p' ? '1080p FHD' : quality.toUpperCase()})`
                  : 'Load YouTube URL First'}
              </span>
            </button>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Captures the YouTube HLS/DASH stream directly on the server using yt-dlp and FFmpeg.
            </p>
          </div>
        ) : (
          <button
            type="button"
            disabled={directJob?.status === 'finalizing'}
            onClick={onStopDirectRecord}
            className="w-full py-3 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>
              {directJob?.status === 'finalizing' ? 'Finalizing MP4...' : 'Stop & Finalize MP4'}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
