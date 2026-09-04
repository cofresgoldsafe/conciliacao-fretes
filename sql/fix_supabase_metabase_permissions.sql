-- ============================================================================
-- SCRIPT DE LIBERAÇÃO DE PERMISSÕES E RLS PARA METABASE BI NO SUPABASE
-- Plataforma de Apoio GSI (Gemini-Cli) -> Metabase (bi-gsi.onrender.com)
-- ============================================================================
-- Objetivo:
-- 1. Permitir que o Metabase (que conecta como role 'postgres') consulte todas
--    as tabelas analíticas e views sem ser bloqueado pelo Row-Level Security (RLS).
-- 2. Manter 100% o bloqueio de segurança contra acessos anônimos ('anon' e 'authenticated'
--    da API pública PostgREST continuam bloqueados, resolvendo os alertas de segurança do Supabase).
-- 3. Atualizar as políticas de RLS para incluir as roles 'service_role' E 'postgres'.
-- ============================================================================

-- 1. Garante permissões de schema e objetos para as roles de backend/Metabase
GRANT USAGE ON SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, service_role;

-- 2. Atualiza políticas de RLS em TODAS as tabelas do schema public
-- Garante que 'service_role' (PostgREST/Edge Functions) e 'postgres' (Metabase/Pooler)
-- tenham acesso irrestrito para leitura e gravação
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
    ) LOOP
        -- Assegura RLS e FORCE RLS ativo (satisfazendo os alertas de segurança)
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', r.tablename);
        
        -- Remove política antiga restrita
        IF EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'public' 
              AND tablename = r.tablename 
              AND policyname = 'Acesso exclusivo backend'
        ) THEN
            EXECUTE format('DROP POLICY "Acesso exclusivo backend" ON public.%I;', r.tablename);
        END IF;

        -- Cria política com acesso pleno para o backend e o Metabase
        EXECUTE format('CREATE POLICY "Acesso exclusivo backend" ON public.%I TO service_role, postgres USING (true) WITH CHECK (true);', r.tablename);
    END LOOP;
END $$;

-- 3. Mantém bloqueio estrito contra requisições anônimas e públicas
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated;

-- 4. Garante permissão de leitura em todas as Views analíticas do BI
DO $$
DECLARE
    v RECORD;
BEGIN
    FOR v IN (
        SELECT table_name 
        FROM information_schema.views 
        WHERE table_schema = 'public'
    ) LOOP
        EXECUTE format('GRANT SELECT ON public.%I TO postgres, service_role;', v.table_name);
    END LOOP;
END $$;

-- 5. Consulta de conferência do status de RLS e políticas
SELECT 
    p.schemaname,
    p.tablename,
    p.policyname,
    p.roles,
    p.cmd
FROM pg_policies p
WHERE p.schemaname = 'public'
ORDER BY p.tablename ASC;
