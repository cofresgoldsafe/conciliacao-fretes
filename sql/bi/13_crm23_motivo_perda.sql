-- ============================================================================
-- MIGRATION 13: MOTIVO DE PERDA ESTRUTURADO NO CRM (CRM-23)
-- ============================================================================
-- Data: 14/11/2026
-- Objetivo: Adicionar coluna motivo_perda_cod em crm_deals com CHECK constraint
-- para 7 motivos padronizados e índice parcial para deals perdidos.
-- ============================================================================

ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS motivo_perda_cod VARCHAR(40);
DO $$ BEGIN
  ALTER TABLE crm_deals ADD CONSTRAINT crm_deals_motivo_perda_cod_check CHECK (
    motivo_perda_cod IS NULL OR motivo_perda_cod IN (
      'preco','prazo_entrega','produto_nao_atende','compra_cancelada',
      'sem_resposta','credito_negado','transferido_outro_vendedor'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_crm_deals_motivo_perda_cod ON crm_deals (motivo_perda_cod) WHERE estagio = 'perdido';
