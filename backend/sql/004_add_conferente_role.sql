DO $$ BEGIN
  ALTER TYPE role_type ADD VALUE 'conferente';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
