export type CaptureQuality = '1080p' | '720p' | '480p' | 'audio';

export type CaptureMode = 'tab' | 'direct';

export interface StreamInspectResult {
  videoId: string;
  canonicalUrl: string;
  title: string;
  channel: string;
  channelUrl?: string;
  isLive: boolean;
  thumbnailUrl: string;
  directCaptureAvailable: boolean;
  requiresCookies: boolean;
  availableHeights: number[];
  inspectNote?: string;
}

export interface RecordingItem {
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

export interface DirectRecordJob {
  id: string;
  videoId: string;
  title: string;
  channel: string;
  quality: CaptureQuality;
  status: 'starting' | 'recording' | 'finalizing' | 'completed' | 'error';
  startedAt: number;
  elapsedSeconds: number;
  sizeBytes: number;
  lastLog: string;
  errorMessage?: string;
  recordingId?: string;
}
