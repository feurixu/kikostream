import { useMemo, useState } from 'react';
import {
  Check,
  Download,
  Film,
  Pencil,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { RecordingItem } from '../types';
import { formatBytes, formatDuration, formatRelativeDate } from '../utils/format';

interface RecordingsArchiveProps {
  recordings: RecordingItem[];
  isLoading: boolean;
  onPlay: (item: RecordingItem) => void;
  onRename: (id: string, newTitle: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

type FormatFilter = 'all' | 'mp4' | 'm4a';

export function RecordingsArchive({
  recordings,
  isLoading,
  onPlay,
  onRename,
  onDelete,
}: RecordingsArchiveProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return recordings.filter((item) => {
      if (formatFilter !== 'all' && item.format !== formatFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.channel.toLowerCase().includes(q) ||
        item.qualityLabel.toLowerCase().includes(q)
      );
    });
  }, [recordings, searchQuery, formatFilter]);

  const handleSaveRename = async (id: string) => {
    const trimmed = editDraft.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    setBusyId(id);
    try {
      await onRename(id, trimmed);
      setEditingId(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async (id: string) => {
    setBusyId(id);
    try {
      await onDelete(id);
      setConfirmDeleteId(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section id="archive" className="bg-[#111723] border border-white/[0.08] rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-lg font-semibold text-white">
            Saved Recordings
          </h2>
          <span className="text-xs font-mono text-slate-400">
            {recordings.length} {recordings.length === 1 ? 'file' : 'files'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter recordings..."
              className="pl-8 pr-3 py-1.5 text-xs bg-[#0A0E16] border border-white/[0.1] rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-400 w-52"
            />
          </div>

          <div className="flex items-center gap-1 p-0.5 bg-[#0A0E16] border border-white/[0.08] rounded-lg">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'mp4', label: 'MP4 Video' },
                { id: 'm4a', label: 'M4A Audio' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFormatFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  formatFilter === tab.id
                    ? 'bg-white/[0.12] text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="p-6 space-y-3">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-11 rounded-lg bg-white/[0.04] animate-pulse"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-14 text-center flex flex-col items-center">
          <div className="w-11 h-11 rounded-xl border border-white/[0.1] bg-white/[0.03] flex items-center justify-center mb-3.5">
            <Film className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-200 mb-1">
            {recordings.length === 0
              ? 'No recordings saved yet'
              : 'No matching recordings found'}
          </p>
          <p className="text-xs text-slate-400 max-w-md">
            {recordings.length === 0
              ? 'Recorded streams are encoded to FastStart MP4 and listed here for instant playback and download.'
              : 'Try clearing your search filter or switching format tabs.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] text-[11px] font-medium text-slate-400 bg-[#0D121C]">
                <th className="py-2.5 pl-6 pr-4">Recording</th>
                <th className="py-2.5 px-4">Resolution</th>
                <th className="py-2.5 px-4 text-right">Duration</th>
                <th className="py-2.5 px-4 text-right">Size</th>
                <th className="py-2.5 px-4">Saved</th>
                <th className="py-2.5 pl-4 pr-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-sm">
              {filtered.map((item) => {
                const isEditing = editingId === item.id;
                const isConfirmingDelete = confirmDeleteId === item.id;
                const isBusy = busyId === item.id;

                return (
                  <tr
                    key={item.id}
                    className="hover:bg-white/[0.025] transition-colors h-12"
                  >
                    <td className="py-2.5 pl-6 pr-4 max-w-sm">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(item.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            autoFocus
                            className="px-2.5 py-1 text-xs bg-[#0A0E16] border border-slate-500 rounded text-white w-full focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleSaveRename(item.id)}
                            aria-label="Save title"
                            className="p-1.5 text-emerald-400 hover:bg-white/10 rounded cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            aria-label="Cancel rename"
                            className="p-1.5 text-slate-400 hover:bg-white/10 rounded cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="min-w-0">
                          <div className="font-medium text-slate-100 truncate">
                            {item.title}
                          </div>
                          <div className="text-xs text-slate-400 flex items-center gap-1.5 truncate">
                            <span>{item.channel}</span>
                            <span aria-hidden="true">·</span>
                            <span>{item.sourceType === 'direct' ? 'Direct Stream' : 'Tab Capture'}</span>
                          </div>
                        </div>
                      )}
                    </td>

                    <td className="py-2.5 px-4 whitespace-nowrap font-mono text-xs text-slate-200">
                      {item.width > 0 && item.height > 0
                        ? `${item.width}×${item.height}${item.fps ? ` · ${item.fps}fps` : ''}`
                        : item.qualityLabel}
                    </td>

                    <td className="py-2.5 px-4 whitespace-nowrap text-right font-mono text-xs text-slate-200 tabular-nums">
                      {formatDuration(item.durationSeconds)}
                    </td>

                    <td className="py-2.5 px-4 whitespace-nowrap text-right font-mono text-xs text-slate-200 tabular-nums">
                      {formatBytes(item.sizeBytes)}
                    </td>

                    <td className="py-2.5 px-4 whitespace-nowrap text-xs text-slate-400">
                      {formatRelativeDate(item.createdAt)}
                    </td>

                    <td className="py-2.5 pl-4 pr-6 whitespace-nowrap text-right">
                      {isConfirmingDelete ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleConfirmDelete(item.id)}
                            className="px-2.5 py-1 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded transition-colors cursor-pointer"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2.5 py-1 text-xs font-medium bg-white/[0.08] hover:bg-white/[0.14] text-slate-200 rounded transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onPlay(item)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white/[0.07] hover:bg-white/[0.14] text-slate-100 rounded-md transition-colors cursor-pointer"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Play</span>
                          </button>
                          <a
                            href={`/api/recordings/${item.id}/download`}
                            download
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded-md transition-colors"
                          >
                            <Download className="w-3 h-3" />
                            <span>Download {item.format.toUpperCase()}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(item.id);
                              setEditDraft(item.title);
                            }}
                            aria-label="Rename recording"
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-md transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(item.id)}
                            aria-label="Delete recording"
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-white/[0.08] rounded-md transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
