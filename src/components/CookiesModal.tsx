import { useState, type ChangeEvent } from 'react';
import { Trash2, Upload, X } from 'lucide-react';

interface CookiesModalProps {
  isOpen: boolean;
  hasCookies: boolean;
  onClose: () => void;
  onSaved: (configured: boolean) => void;
}

export function CookiesModal({
  isOpen,
  hasCookies,
  onClose,
  onSaved,
}: CookiesModalProps) {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setContent(reader.result);
        setError(null);
      }
    };
    reader.readAsText(file);
  };

  const handleSave = async () => {
    setError(null);
    if (!content.trim()) {
      setError('Paste or upload your Netscape-format cookies.txt content.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save cookies.');
        return;
      }
      onSaved(true);
      setContent('');
      onClose();
    } catch {
      setError('Network error saving cookies.');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await fetch('/api/cookies', { method: 'DELETE' });
      onSaved(false);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#111723] border border-white/[0.12] rounded-xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-white">
              YouTube Cookies (Optional)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Only required for Direct Server Stream mode when YouTube requests verification.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-slate-300">
              Current status:{' '}
              <span className={hasCookies ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
                {hasCookies ? 'Cookies file active on server' : 'Not configured'}
              </span>
            </span>

            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.1] text-slate-100 rounded-lg cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>Upload cookies.txt</span>
              <input
                type="file"
                accept=".txt,text/plain"
                onChange={handleFileUpload}
                className="sr-only"
              />
            </label>
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={7}
            placeholder="# Netscape HTTP Cookie File&#10;.youtube.com&#9;TRUE&#9;/&#9;TRUE&#9;..."
            className="w-full p-3 text-xs font-mono bg-[#0A0E16] border border-white/[0.1] rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-400"
          />

          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-white/[0.08] flex items-center justify-between gap-3">
          {hasCookies ? (
            <button
              type="button"
              disabled={saving}
              onClick={handleClear}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Remove Cookies</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Cookies'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
