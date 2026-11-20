import { KeyRound } from 'lucide-react';

interface TopBarProps {
  hasCookies: boolean;
  onOpenCookies: () => void;
}

export function TopBar({ hasCookies, onOpenCookies }: TopBarProps) {
  return (
    <header className="border-b border-white/[0.08] bg-[#0B0F17]/95 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        <a
          href="#capture"
          className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded-sm"
        >
          StreamVault
        </a>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
          <a
            href="#capture"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 border-b border-transparent hover:border-slate-500"
          >
            Capture Studio
          </a>
          <a
            href="#archive"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 border-b border-transparent hover:border-slate-500"
          >
            Saved Recordings
          </a>
          <a
            href="#workflow"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 border-b border-transparent hover:border-slate-500"
          >
            How It Works
          </a>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenCookies}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-100 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5 text-slate-300" />
            <span>{hasCookies ? 'Cookies Configured' : 'YouTube Cookies'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
