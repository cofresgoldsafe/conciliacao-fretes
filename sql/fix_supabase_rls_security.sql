-- ============================================================================
-- SCRIPT DE HARDENING E REMEDIAÇÃO DE SEGURANÇA NO SUPABASE (POSTGRESQL)
-- Projeto: contato@goldsafe.com.br's Project (kxcfqjupakdaqshnhxlx)
-- ============================================================================
-- Objetivo:
-- 1. Habilitar Row-Level Security (RLS) em TODAS as tabelas do schema public (Check 0013: rls_disabled_in_public)
-- 2. Proteger colunas sensíveis (senhas, hashes, tokens 2FA, dados cadastrais/crédito) (Check 0008: sensitive_columns_exposed)
-- 3. Revogar permissões das roles 'anon' e 'authenticated' no PostgREST, mantendo acesso exclusivo para o backend via 'service_role' / 'postgres'
-- 4. Garantir que futuras tabelas criadas no schema public não herdem privilégios anônimos
-- ============================================================================

-- 1. Habilita RLS e FORCE RLS dinamicamente em todas as tabelas públicas existentes
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
    ) LOOP
        -- Habilita RLS
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
        
        -- Força RLS mesmo para donos de tabelas não-superusuários
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', r.tablename);
        
        -- Cria ou atualiza política de acesso irrestrito exclusivo para o backend (service_role e superuser postgres)
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'public' 
              AND tablename = r.tablename 
              AND policyname = 'Acesso exclusivo backend'
        ) THEN
            EXECUTE format('CREATE POLICY "Acesso exclusivo backend" ON public.%I TO service_role USING (true) WITH CHECK (true);', r.tablename);
        END IF;
    END LOOP;
END $$;

-- 2. Revogação estrita de privilégios públicos e anônimos no schema public
-- Isso bloqueia requisições externas via PostgREST / HTTP API com a chave anon
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;

-- 3. Configuração de privilégios padrão para futuras tabelas criadas no schema public
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated;

-- 4. Confirmação do status de segurança de todas as tabelas públicas
SELECT 
    n.nspname AS schemaname,
    c.relname AS tablename,
    c.relrowsecurity AS rls_ativo,
    c.relforcerowsecurity AS force_rls_ativo
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relkind = 'r'
ORDER BY c.relname ASC;

