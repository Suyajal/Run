CREATE TABLE IF NOT EXISTS public.record_comment (
  comment_id uuid PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES public.running_record(record_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_user(user_id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS record_comment_record_created_idx
  ON public.record_comment (record_id, created_at, comment_id);
