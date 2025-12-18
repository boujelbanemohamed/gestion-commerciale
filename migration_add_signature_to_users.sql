ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS signature_text TEXT,
  ADD COLUMN IF NOT EXISTS signature_file_path VARCHAR(500),
  ADD COLUMN IF NOT EXISTS signature_link TEXT;

