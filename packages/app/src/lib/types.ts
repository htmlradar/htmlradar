// Row-level types for the tables we touch from the app. Imported by
// server components, server actions, and analytics views to keep the
// shape definition in one place.

export type Tier = 'free' | 'pro';

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  tier: Tier;
  created_at: string;
  pro_since: string | null;
  pro_until: string | null;
}

export interface Document {
  id: string;
  owner_id: string;
  title: string;
  source_type: 'upload' | 'url';
  source_url: string | null;
  current_version: number;
  r2_key: string | null;
  retention_days: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DocumentShare {
  id: string;
  document_id: string;
  owner_id: string;
  slug: string;
  recipient_label: string | null;
  require_email: boolean;
  require_password: boolean;
  password_hash: string | null;
  allowed_email_domains: string[] | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface Viewer {
  id: string;
  share_id: string;
  email: string | null;
  fingerprint: string | null;
  first_seen: string;
  last_seen: string;
  visit_count: number;
  country_code: string | null;
  city: string | null;
  device_type: string | null;
  os: string | null;
  browser: string | null;
}

export interface Session {
  id: string;
  share_id: string;
  viewer_id: string;
  document_version: number;
  started_at: string;
  last_heartbeat_at: string;
  active_time_seconds: number;
  max_scroll_depth: number;
  bounced: boolean;
}

export interface SectionEvent {
  id: string;
  session_id: string;
  section_id: string;
  section_title: string | null;
  depth: number | null;
  ordinal: number | null;
  time_seconds: number;
  entered_at: string;
}
