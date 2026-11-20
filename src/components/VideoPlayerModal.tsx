import { Download, X } from 'lucide-react';
import type { RecordingItem } from '../types';
import { formatBytes, formatDuration } from '../utils/format';

interface VideoPlayerModalProps {
  recording: RecordingItem | null;
  onClose: () => void;
}

export function VideoPlayerModal({ recording, onClose }: VideoPlayerModalProps) {
  if (!recording) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-[#111723] border border-white/[0.12] rounded-xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold text-white truncate">
              {recording.title}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
              <span>{recording.channel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">
                {recording.width > 0 ? `${recording.width}×${recording.height}` : recording.qualityLabel}
              </span>
              {recording.fps > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{recording.fps} fps</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-mono">{recording.codec}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{formatDuration(recording.durationSeconds)}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{formatBytes(recording.sizeBytes)}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`/api/recordings/${recording.id}/download`}
              download
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download {recording.format.toUpperCase()}</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close player"
              className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="bg-black aspect-video flex items-center justify-center">
          {recording.format === 'm4a' ? (
            <div className="p-8 w-full max-w-md text-center space-y-4">
              <p className="text-sm text-slate-300">Audio Archive ({recording.codec})</p>
              <audio
                src={`/api/recordings/${recording.id}/stream`}
                controls
                autoPlay
                className="w-full"
              />
            </div>
          ) : (
            <video
              src={`/api/recordings/${recording.id}/stream`}
              controls
              autoPlay
              playsInline
              className="w-full h-full object-contain"
            />
          )}
        </div>
      </div>
    </div>
  );
}
