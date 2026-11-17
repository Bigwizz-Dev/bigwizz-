-- Bigwizz: disable all direct buyer/seller messaging.
-- Preserve records for audit/history, but block client roles from reading or writing them.
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.conversations FROM anon, authenticated;
REVOKE ALL ON TABLE public.conversation_participants FROM anon, authenticated;
REVOKE ALL ON TABLE public.messages FROM anon, authenticated;

DROP POLICY IF EXISTS "Messaging disabled for clients" ON public.conversations;
CREATE POLICY "Messaging disabled for clients" ON public.conversations
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "Messaging disabled for clients" ON public.conversation_participants;
CREATE POLICY "Messaging disabled for clients" ON public.conversation_participants
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "Messaging disabled for clients" ON public.messages;
CREATE POLICY "Messaging disabled for clients" ON public.messages
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);