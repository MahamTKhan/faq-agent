// Tables are created automatically on first use. Safe to run repeatedly.
// The advisory lock stops two cold-starting servers from racing each other.
export const SCHEMA_SQL = `
SELECT pg_advisory_xact_lock(7428301);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_name text NOT NULL DEFAULT '',
  slug text NOT NULL UNIQUE,
  access_code text NOT NULL DEFAULT '',
  welcome_message text NOT NULL DEFAULT '',
  starter_questions text NOT NULL DEFAULT '',
  notify_email text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'document',
  source_name text NOT NULL DEFAULT '',
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_project_idx ON documents(project_id);

CREATE TABLE IF NOT EXISTS chunks (
  id bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position int NOT NULL,
  content text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin(tsv);
CREATE INDEX IF NOT EXISTS chunks_project_idx ON chunks(project_id);
CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks(document_id);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  visitor_name text NOT NULL DEFAULT '',
  visitor_email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_project_idx ON conversations(project_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  status text NOT NULL DEFAULT '',
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  question text NOT NULL,
  bot_reply text NOT NULL DEFAULT '',
  suggested_reply text NOT NULL DEFAULT '',
  admin_note text NOT NULL DEFAULT '',
  final_reply text NOT NULL DEFAULT '',
  visitor_email text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz
);
CREATE INDEX IF NOT EXISTS questions_project_idx ON questions(project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_hits (
  key text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_hits_idx ON rate_hits(key, at);

-- v2: forwarding addresses, shared knowledge, tracker, generated documents
ALTER TABLE projects ADD COLUMN IF NOT EXISTS inbound_key text;
UPDATE projects SET inbound_key = substr(md5(random()::text || id::text), 1, 10) WHERE inbound_key IS NULL;
ALTER TABLE projects ALTER COLUMN inbound_key SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 10);
CREATE UNIQUE INDEX IF NOT EXISTS projects_inbound_key_idx ON projects(inbound_key);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS documents_shared_idx ON documents(shared) WHERE shared;

CREATE TABLE IF NOT EXISTS action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  owner text NOT NULL DEFAULT 'client',
  owner_name text NOT NULL DEFAULT '',
  due_date date,
  status text NOT NULL DEFAULT 'open',
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  source_quote text NOT NULL DEFAULT '',
  done_hint text NOT NULL DEFAULT '',
  origin text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);
CREATE INDEX IF NOT EXISTS action_items_project_idx ON action_items(project_id, status);

CREATE TABLE IF NOT EXISTS generated_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generated_docs_project_idx ON generated_docs(project_id, updated_at DESC);
`;
