"""
Step 1: Create Database Schema
================================
Creates the paragraph_embeddings table, pgvector extension,
Row Level Security policies, and the match_paragraphs() function
in your Supabase database.

Usage:
    python scripts/01_create_schema.py

Prerequisites:
    - config.public.json with Supabase URL and anon key
    - config.secret.json with Supabase service key, access token, and project ref
    - Supabase project created
"""

import json
import sys
import time

# Load configuration from both config files
with open('config.public.json', 'r') as f:
    public_config = json.load(f)
with open('config.secret.json', 'r') as f:
    secrets = json.load(f)

SUPABASE_URL = public_config['SUPABASE_URL']
SUPABASE_SERVICE_KEY = secrets['SUPABASE_SERVICE_KEY']
SUPABASE_ACCESS_TOKEN = secrets['SUPABASE_ACCESS_TOKEN']
SUPABASE_PROJECT_REF = secrets['SUPABASE_PROJECT_REF']


def create_schema():
    import requests
    from supabase import create_client

    print("=" * 60)
    print("Creating Database Schema")
    print("=" * 60)

    schema_sql = """
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create paragraph_embeddings table
-- halfvec stores each dimension as a 16-bit float: half the space of
-- vector(1536), with negligible effect on similarity rankings.
CREATE TABLE IF NOT EXISTS paragraph_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    talk_id UUID NOT NULL,
    title TEXT NOT NULL,
    speaker TEXT,
    calling TEXT,
    speaker_group TEXT,  -- 'president', 'fp_twelve', or 'other' (see 03_import_data.py)
    year INTEGER,
    season TEXT,
    url TEXT,
    paragraph_num INTEGER,
    text TEXT NOT NULL,
    embedding halfvec(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add speaker_group to tables created before the speaker filter existed
ALTER TABLE paragraph_embeddings ADD COLUMN IF NOT EXISTS speaker_group TEXT;

-- Create index for talk_id grouping
CREATE INDEX IF NOT EXISTS paragraph_embeddings_talk_id_idx
ON paragraph_embeddings(talk_id);

-- Create HNSW index for vector similarity search. Without it, every
-- match_paragraphs() call scans all rows and can exceed the 8s statement
-- timeout for authenticated users. halfvec_cosine_ops must match the
-- column type and the <=> (cosine distance) operator in match_paragraphs().
CREATE INDEX IF NOT EXISTS paragraph_embeddings_embedding_idx
ON paragraph_embeddings USING hnsw (embedding halfvec_cosine_ops);

-- Enable Row Level Security
ALTER TABLE paragraph_embeddings ENABLE ROW LEVEL SECURITY;

-- RLS policy: authenticated users can read
DROP POLICY IF EXISTS "Allow authenticated users to read" ON paragraph_embeddings;
CREATE POLICY "Allow authenticated users to read"
ON paragraph_embeddings FOR SELECT
TO authenticated
USING (true);

-- ============================================
-- Page Views table (PUBLIC access for RLS demo)
-- ============================================
-- This table intentionally has PUBLIC policies so students can
-- contrast it with paragraph_embeddings (auth-only).

CREATE TABLE IF NOT EXISTS page_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visited_at TIMESTAMPTZ DEFAULT NOW(),
    page_url TEXT,
    user_agent TEXT
);

ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated visitors) can insert page views
DROP POLICY IF EXISTS "Allow public inserts" ON page_views;
CREATE POLICY "Allow public inserts"
ON page_views FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Anyone can read page views (for the counter)
DROP POLICY IF EXISTS "Allow public reads" ON page_views;
CREATE POLICY "Allow public reads"
ON page_views FOR SELECT
TO anon, authenticated
USING (true);

-- Create function for similarity search
-- (dropped first because CREATE OR REPLACE can't change a function's arguments)
DROP FUNCTION IF EXISTS match_paragraphs(halfvec, int);
DROP FUNCTION IF EXISTS match_paragraphs(halfvec, int, text[]);
CREATE OR REPLACE FUNCTION match_paragraphs(
  query_embedding halfvec(1536),
  match_count int DEFAULT 20,
  speaker_groups text[] DEFAULT NULL  -- NULL searches all speakers
)
RETURNS TABLE (
  id uuid,
  talk_id uuid,
  title text,
  speaker text,
  calling text,
  url text,
  text text,
  similarity float
)
LANGUAGE sql STABLE
-- The HNSW index returns its nearest candidates before the WHERE filter runs,
-- so a narrow filter (the President is ~5% of rows) could leave only a few
-- results. Iterative scans keep walking the index until match_count rows pass.
SET hnsw.iterative_scan = strict_order
AS $$
  SELECT
    paragraph_embeddings.id,
    paragraph_embeddings.talk_id,
    paragraph_embeddings.title,
    paragraph_embeddings.speaker,
    paragraph_embeddings.calling,
    paragraph_embeddings.url,
    paragraph_embeddings.text,
    1 - (paragraph_embeddings.embedding <=> query_embedding) as similarity
  FROM paragraph_embeddings
  WHERE speaker_groups IS NULL OR paragraph_embeddings.speaker_group = ANY (speaker_groups)
  ORDER BY paragraph_embeddings.embedding <=> query_embedding
  LIMIT match_count;
$$;
"""

    url = f"https://api.supabase.com/v1/projects/{SUPABASE_PROJECT_REF}/database/query"
    headers = {
        "Authorization": f"Bearer {SUPABASE_ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }

    resp = requests.post(url, headers=headers, json={"query": schema_sql})
    if resp.status_code in (200, 201):
        print("✅ Database schema created successfully!")
    else:
        print(f"❌ Schema creation failed: {resp.status_code}")
        print(resp.text[:500])
        return False

    # Verify table exists via PostgREST
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    for attempt in range(5):
        try:
            result = client.table('paragraph_embeddings').select('id', count='exact').limit(1).execute()
            print(f"✅ Table verified. Current rows: {result.count or 0}")
            return True
        except Exception:
            if attempt < 4:
                print(f"   Waiting for schema cache to refresh... ({attempt + 1}/5)")
                time.sleep(3)
            else:
                print("⚠️  Table created but PostgREST cache hasn't refreshed yet.")
                print("   This is normal — it should be ready by import time.")
                return True


if __name__ == '__main__':
    if not create_schema():
        sys.exit(1)
    print("\n✅ Schema ready! Next: python scripts/02_scrape_data.py")
