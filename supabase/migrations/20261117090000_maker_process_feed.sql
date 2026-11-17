-- Bigwizz Maker & Process Feed
-- Extends existing community tables; keeps the current moderation workflow.

ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS caption text,
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.listings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS author_avatar_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_posts_media_type_check'
      AND conrelid = 'public.community_posts'::regclass
  ) THEN
    ALTER TABLE public.community_posts
      ADD CONSTRAINT community_posts_media_type_check
      CHECK (media_type IS NULL OR media_type IN ('image','video'));
  END IF;
END $$;

UPDATE public.community_posts
SET caption = COALESCE(caption, body)
WHERE caption IS NULL;

CREATE INDEX IF NOT EXISTS idx_community_posts_feed
  ON public.community_posts (created_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_community_posts_product
  ON public.community_posts (product_id)
  WHERE product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.community_post_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_post_likes_post_user_unique UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_post_likes_post
  ON public.community_post_likes(post_id);

ALTER TABLE public.community_post_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read published post likes" ON public.community_post_likes;
CREATE POLICY "Public can read published post likes"
  ON public.community_post_likes FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.community_posts p
    WHERE p.id = post_id AND p.status = 'published'
  ));

DROP POLICY IF EXISTS "Users can like published posts" ON public.community_post_likes;
CREATE POLICY "Users can like published posts"
  ON public.community_post_likes FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.community_posts p
      WHERE p.id = post_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS "Users can remove their likes" ON public.community_post_likes;
CREATE POLICY "Users can remove their likes"
  ON public.community_post_likes FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT ON public.community_post_likes TO anon, authenticated;
GRANT INSERT, DELETE ON public.community_post_likes TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'community-media','community-media',true,52428800,
  ARRAY['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 52428800,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Community media is publicly viewable" ON storage.objects;
CREATE POLICY "Community media is publicly viewable"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'community-media');

DROP POLICY IF EXISTS "Users upload their own community media" ON storage.objects;
DROP POLICY IF EXISTS "Sellers upload their own community media" ON storage.objects;
CREATE POLICY "Sellers upload their own community media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'community-media'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'seller')
  );

DROP POLICY IF EXISTS "Users delete their own community media" ON storage.objects;
DROP POLICY IF EXISTS "Sellers delete their own community media" ON storage.objects;
CREATE POLICY "Sellers delete their own community media"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'community-media'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'seller')
  );
