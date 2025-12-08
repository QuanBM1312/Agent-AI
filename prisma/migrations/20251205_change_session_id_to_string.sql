-- Migration: Change session_id from UUID to TEXT
-- This allows using custom session IDs like "session-7x8422shbf46"

BEGIN;

-- Step 1: Drop foreign key constraint
ALTER TABLE chat_messages DROP CONSTRAINT chat_messages_session_id_fkey;

-- Step 2: Change chat_sessions.id from UUID to TEXT
ALTER TABLE chat_sessions 
  ALTER COLUMN id TYPE TEXT,
  ALTER COLUMN id DROP DEFAULT;

-- Step 3: Change chat_messages.session_id from UUID to TEXT
ALTER TABLE chat_messages 
  ALTER COLUMN session_id TYPE TEXT;

-- Step 4: Re-add foreign key constraint
ALTER TABLE chat_messages 
  ADD CONSTRAINT chat_messages_session_id_fkey 
  FOREIGN KEY (session_id) 
  REFERENCES chat_sessions(id) 
  ON DELETE CASCADE;

COMMIT;
