// Shared types for the HTMLRadar tracker.
// Public types are exported via window.HTMLRadar (see api.ts).

export interface Geo {
  country?: string;
  city?: string;
  deviceType?: string;
  os?: string;
  browser?: string;
}

export interface TrackerConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  shareSlug: string;

  // If set, the proxy already collected the viewer's email (e.g. allow-list
  // shares enforce gate server-side). The tracker skips its Shadow DOM gate.
  email?: string;

  // Populated by the proxy from Cloudflare's request.cf + parsed UA.
  geo?: Geo;

  sections: {
    selector: string;
    boundaryOffsetPx: number;
    minDwellMs: number;
  };

  session: {
    heartbeatMs: number;
    maxSessionMinutes: number;
  };

  gate: {
    enabled: boolean;
    brand: {
      accentColor: string;
      backgroundColor: string;
    };
    copy: {
      heading: string;
      subhead: string;
      buttonLabel: string;
      placeholder: string;
      privacyNote: string;
    };
  };

  privacy: {
    mode: 'anonymous' | 'email-gated';
  };

  hooks: {
    onSessionStart?: (info: SessionInfo) => void;
    onSectionEnter?: (info: SectionInfo) => void;
    onSectionRead?: (info: SectionInfo) => void;
    beforeFlush?: (payload: FlushPayload) => FlushPayload | false;
    onFlushError?: (err: Error) => void;
  };

  debug: boolean;
}

export interface SessionInfo {
  sessionId: string;
  documentId: string;
  documentVersion: number;
}

export interface SectionInfo {
  id: string;
  title: string;
  depth: number;
  ordinal: number;
  timeSeconds: number;
}

export interface FlushPayload {
  sessionId: string;
  token: string;
  activeSeconds: number;
  maxScrollDepth: number;
  sections: Array<{
    section_id: string;
    section_title: string;
    depth: number;
    ordinal: number;
    time_seconds: number;
  }>;
}
