/**
 * ============================================================================
 * MÓDULO CRM-20: PROPOSTA COMERCIAL EM PDF POR EMPRESA EMISSORA
 * ============================================================================
 * Responsável por:
 * - Cadastro e cache das 3 empresas emitentes (14 Metal Pleno, 15 GSI Brasil, 16 OAÇO / Cofres Gold Safe)
 * - Montagem de snapshot comercial imutável (com omissão estrita de descontos/tabela)
 * - Geração de PDF vetorial A4 em memória via pdfmake (prévia e revisão numerada)
 * - Envio por e-mail com anexo PDF, cópia (CC) e Reply-To do vendedor (Mailjet v3.1 / SMTP)
 * - Link público (/p/:token) com contagem de abertura anti-bot e deduplicação
 * - Job diário de lembrete de propostas vencendo em 2 dias
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PdfPrinter = require('pdfmake');
const vfsFonts = require('pdfmake/build/vfs_fonts');
const { getPool, isPostgresConnected, safeQuery, getUsers } = require('./postgres_db');
const crmVendedores = require('./crm_vendedores');
const mailer = require('./mailer');

const LOGOS_DIR = path.resolve(__dirname, 'public', 'logos');

// Cache em memória de empresas emitentes (TTL 5 minutos)
const EMPRESAS_CACHE_TTL_MS = 5 * 60 * 1000;
let empresasCache = {
  items: null,
  loadedAt: 0
};

// Rate limit em memória de envio de e-mail por usuário (máx. 20/hora)
const EMAIL_RATE_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_RATE_MAX = 20;
const emailRateMap = new Map(); // username -> number[] (timestamps)

// Deduplicação em memória de abertura de link público por IP+token (10 min)
const ABERTURA_DEDUP_WINDOW_MS = 10 * 60 * 1000;
const aberturaDedupMap = new Map(); // `${token}:${ip}` -> timestamp

// Stub opcional para testes automatizados (Cenário 14)
let sendPropostaEmailStub = null;

function setSendPropostaEmailStub(fn) {
  sendPropostaEmailStub = typeof fn === 'function' ? fn : null;
}

// Regex de User-Agents de robôs e scanners de link corporativos (Seção 5.2)
const BOT_UA_REGEX = /bot|crawler|spider|preview|facebookexternalhit|WhatsApp|TelegramBot|Slackbot|SafeLinks|Proofpoint|Mimecast|Barracuda|urldefense/i;

// Regex único do token público (32 bytes aleatórios em base64url = 43 caracteres)
const TOKEN_PUBLICO_REGEX = /^[A-Za-z0-9_-]{43}$/;

// Regex estrito de cor hexadecimal #RRGGBB
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

const DEFAULT_BLOCOS_OPCIONAIS = {
  mostrar_ncm: false,
  mostrar_peso: false
};

// Fontes Roboto carregadas do vfs_fonts do pdfmake em memória
const rawVfs = vfsFonts && vfsFonts.pdfMake && vfsFonts.pdfMake.vfs ? vfsFonts.pdfMake.vfs : vfsFonts;
const PDF_FONTS = {
  Roboto: {
    normal: Buffer.from(rawVfs['Roboto-Regular.ttf'], 'base64'),
    bold: Buffer.from(rawVfs['Roboto-Medium.ttf'], 'base64'),
    italics: Buffer.from(rawVfs['Roboto-Italic.ttf'], 'base64'),
    bolditalics: Buffer.from(rawVfs['Roboto-MediumItalic.ttf'], 'base64')
  }
};

function getCrmEngine() {
  return require('./crm_engine');
}

function createHttpError(status, code, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

const PG_CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EPIPE',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006'
]);

function isPgConnectionError(err) {
  if (!err) return false;
  const code = String(err.code || err.errno || '').trim().toUpperCase();
  if (code && (PG_CONNECTION_ERROR_CODES.has(code) || code.startsWith('08'))) {
    return true;
  }
  const msg = String(err.message || '');
  return /ECONNREFUSED|ETIMEDOUT|ECONNRESET|Connection terminated|terminating connection|server closed the connection|connect ECONN|Client has encountered a connection error|cannot execute .* in a read-only transaction/i.test(msg);
}

function rethrowAs503IfConnectionError(err) {
  if (isPgConnectionError(err)) {
    throw createHttpError(
      503,
      'PROPOSTAS_INDISPONIVEIS',
      'Propostas indisponíveis no momento. O restante do CRM continua funcionando.'
    );
  }
  throw err;
}

function requireDbConnected() {
  if (!getPool()) {
    throw createHttpError(
      503,
      'PROPOSTAS_INDISPONIVEIS',
      'Propostas indisponíveis no momento. O restante do CRM continua funcionando.'
    );
  }
}

async function runPropostasQuery(text, params = []) {
  requireDbConnected();
  try {
    return await safeQuery(text, params);
  } catch (err) {
    rethrowAs503IfConnectionError(err);
  }
}

/**
 * Resolve o código da empresa emitente ('14', '15' ou '16') a partir de faturado_por
 */
function resolverCodigoEmpresa(faturadoPor) {
  const raw = String(faturadoPor || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw === '14' || raw.startsWith('14 ') || raw.startsWith('14-') || raw.includes('METAL PLENO')) return '14';
  if (raw === '15' || raw.startsWith('15 ') || raw.startsWith('15-') || raw.includes('GSI')) return '15';
  if (raw === '16' || raw.startsWith('16 ') || raw.startsWith('16-') || raw.includes('O AÇO') || raw.includes('O ACO') || raw.includes('OAÇO') || raw.includes('OACO')) return '16';
  return '';
}

/**
 * Formata CNPJ (14 dígitos) ou CPF (11 dígitos)
 */
function formatCnpjCpf(val) {
  const clean = String(val || '').replace(/\D/g, '');
  if (clean.length === 14) {
    return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (clean.length === 11) {
    return clean.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return String(val || '').trim();
}

/**
 * Formata número em moeda BRL (ex.: 1.234,56)
 */
function formatMoneyBr(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Retorna data YYYY-MM-DD no fuso America/Sao_Paulo
 */
function getTodaySaoPauloIso(refDate = new Date()) {
  const d = refDate instanceof Date ? refDate : new Date(refDate);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value || '2026';
  const m = parts.find(p => p.type === 'month')?.value || '01';
  const day = parts.find(p => p.type === 'day')?.value || '01';
  return `${y}-${m}-${day}`;
}

/**
 * Soma dias a uma data ISO YYYY-MM-DD e retorna YYYY-MM-DD
 */
function addDaysIso(isoDateStr, days) {
  const [y, m, d] = String(isoDateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().slice(0, 10);
}

/**
 * Formata data YYYY-MM-DD para DD/MM/AAAA
 */
function formatDateBr(isoDateStr) {
  if (!isoDateStr) return '';
  const clean = String(isoDateStr).slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return clean;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Mascara os dois últimos octetos de um IPv4 (ex.: 177.22.33.44 -> 177.22.0.0)
 */
function maskIpAddress(ip) {
  const raw = String(ip || '').trim().replace(/^::ffff:/, '');
  if (!raw) return '0.0.0.0';
  const ipv4Parts = raw.split('.');
  if (ipv4Parts.length === 4) {
    return `${ipv4Parts[0]}.${ipv4Parts[1]}.0.0`;
  }
  const ipv6Parts = raw.split(':');
  if (ipv6Parts.length > 2) {
    return `${ipv6Parts.slice(0, 2).join(':')}::`;
  }
  return '0.0.0.0';
}

/**
 * Valida se o logo_path é seguro e permanece estritamente dentro de public/logos/
 */
function validarLogoPathRelativo(logoPath) {
  if (logoPath === null || logoPath === undefined) {
    return { valid: true, normalized: null, fullPath: null };
  }
  const clean = String(logoPath).trim();
  if (!clean) return { valid: true, normalized: null, fullPath: null };
  if (clean.includes('..') || clean.includes('\\') || !clean.startsWith('logos/')) {
    return { valid: false, normalized: clean, fullPath: null };
  }
  const resolved = path.resolve(__dirname, 'public', clean);
  const prefix = LOGOS_DIR.endsWith(path.sep) ? LOGOS_DIR : LOGOS_DIR + path.sep;
  if (!resolved.startsWith(prefix)) {
    return { valid: false, normalized: clean, fullPath: null };
  }
  return { valid: true, normalized: clean, fullPath: resolved };
}

/**
 * Sanitiza nome fantasia para nome de arquivo de download (sem acentos/espaços)
 */
function sanitizeFilenameSlug(str) {
  return String(str || 'Empresa')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'Empresa';
}

const DDL_CRM_PROPOSTAS_SQL = `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_empresas_emitentes'
      AND column_name = 'inscricao_estadual'
  ) THEN
    DROP TABLE IF EXISTS public.crm_propostas CASCADE;
    DROP TABLE IF EXISTS public.crm_empresas_emitentes CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS crm_empresas_emitentes (
  codigo                VARCHAR(2) PRIMARY KEY,
  razao_social          VARCHAR(200) NOT NULL,
  nome_fantasia         VARCHAR(150) NOT NULL,
  cnpj                  VARCHAR(14) NOT NULL,
  ie                    VARCHAR(20),
  endereco              VARCHAR(300),
  telefone              VARCHAR(30),
  email_contato         VARCHAR(200),
  site                  VARCHAR(150),
  logo_path             VARCHAR(200),
  cor_primaria          VARCHAR(7) NOT NULL DEFAULT '#0b3d91',
  cor_secundaria        VARCHAR(7) NOT NULL DEFAULT '#f59e0b',
  texto_rodape          TEXT,
  texto_email           TEXT,
  dados_bancarios_pix   TEXT,
  validade_padrao_dias  SMALLINT NOT NULL DEFAULT 7 CHECK (validade_padrao_dias BETWEEN 1 AND 60),
  blocos_opcionais      JSONB NOT NULL DEFAULT '{"mostrar_ncm": false, "mostrar_peso": false}'::jsonb,
  ativo                 BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            VARCHAR(100)
);

INSERT INTO crm_empresas_emitentes (codigo, razao_social, nome_fantasia, cnpj, ie, endereco, telefone, logo_path) VALUES
  ('14', 'METAL PLENO EQUIPAMENTOS DE ACO LTDA', 'Metal Pleno', '48758821000118', '145707309111',
         'Rua Maria José, 119 · Bela Vista · São Paulo/SP · 01324-010', '(11) 3141-9000', NULL),
  ('15', 'GSI BW EQUIPAMENTOS DE ACO COFRES E ARMARIOS LTDA', 'GSI Brasil', '14061778000115', 'ISENTO',
         'Rua Maria José, 119 · Bela Vista · São Paulo/SP · 01324-010', '(11) 3141-9000', 'logos/logo-gsi.png'),
  ('16', 'OACO PRODUTOS DE ACO LTDA', 'OAÇO / Cofres Gold Safe', '61237790000118', '535132321110',
         'Rua Maria José, 119 · Bela Vista · São Paulo/SP · 01324-010', '(11) 3141-9000', 'logos/logo-oaco.png')
ON CONFLICT (codigo) DO NOTHING;

-- Corrige a razão social das linhas criadas pela carga inicial do CRM-20 (só se ainda estiverem com o nome antigo)
UPDATE crm_empresas_emitentes SET razao_social = 'METAL PLENO EQUIPAMENTOS DE ACO LTDA', updated_at = NOW(), updated_by = 'correcao_razao_social'
 WHERE codigo = '14' AND razao_social = 'METAL PLENO COMERCIO DE FECHADURAS E FERRAGENS LTDA';
UPDATE crm_empresas_emitentes SET razao_social = 'GSI BW EQUIPAMENTOS DE ACO COFRES E ARMARIOS LTDA', updated_at = NOW(), updated_by = 'correcao_razao_social'
 WHERE codigo = '15' AND razao_social = 'GSI BRASIL PRESTACAO DE SERVICOS LTDA';
UPDATE crm_empresas_emitentes SET razao_social = 'OACO PRODUTOS DE ACO LTDA', updated_at = NOW(), updated_by = 'correcao_razao_social'
 WHERE codigo = '16' AND razao_social = 'OACO INDUSTRIA E COMERCIO DE COFRES LTDA';

CREATE TABLE IF NOT EXISTS crm_propostas (
  id               BIGSERIAL PRIMARY KEY,
  deal_id          VARCHAR(64) NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  revisao          SMALLINT NOT NULL,
  numero           VARCHAR(80) NOT NULL UNIQUE,
  empresa_codigo   VARCHAR(2) NOT NULL REFERENCES crm_empresas_emitentes(codigo),
  cod_vendedor     VARCHAR(20) NOT NULL,
  snapshot         JSONB NOT NULL,
  valor_total      NUMERIC(15,2) NOT NULL,
  validade_ate     DATE NOT NULL,
  pdf              BYTEA NOT NULL,
  pdf_sha256       CHAR(64) NOT NULL,
  token_publico    VARCHAR(64) NOT NULL UNIQUE,
  gerada_por       VARCHAR(100) NOT NULL,
  gerada_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enviada_via      VARCHAR(20)[] NOT NULL DEFAULT '{}',
  enviada_em       TIMESTAMPTZ,
  visualizada_em   TIMESTAMPTZ,
  aberturas        INTEGER NOT NULL DEFAULT 0,
  ultima_abertura_em TIMESTAMPTZ,
  UNIQUE (deal_id, revisao)
);

CREATE INDEX IF NOT EXISTS idx_crm_propostas_deal ON crm_propostas (deal_id, revisao DESC);
CREATE INDEX IF NOT EXISTS idx_crm_propostas_validade ON crm_propostas (validade_ate);

ALTER TABLE crm_empresas_emitentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_empresas_emitentes FORCE ROW LEVEL SECURITY;

ALTER TABLE crm_propostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_propostas FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE crm_empresas_emitentes TO service_role;
    GRANT ALL ON TABLE crm_propostas TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE crm_propostas_id_seq TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT ALL ON TABLE crm_empresas_emitentes TO postgres;
    GRANT ALL ON TABLE crm_propostas TO postgres;
    GRANT USAGE, SELECT ON SEQUENCE crm_propostas_id_seq TO postgres;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE crm_empresas_emitentes FROM anon;
    REVOKE ALL ON TABLE crm_propostas FROM anon;
    REVOKE ALL ON SEQUENCE crm_propostas_id_seq FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE crm_empresas_emitentes FROM authenticated;
    REVOKE ALL ON TABLE crm_propostas FROM authenticated;
    REVOKE ALL ON SEQUENCE crm_propostas_id_seq FROM authenticated;
  END IF;
END $$;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Acesso exclusivo backend crm_empresas_emitentes" ON crm_empresas_emitentes;
  CREATE POLICY "Acesso exclusivo backend crm_empresas_emitentes"
    ON crm_empresas_emitentes
    TO service_role, postgres
    USING (true)
    WITH CHECK (true);

  DROP POLICY IF EXISTS "Acesso exclusivo backend crm_propostas" ON crm_propostas;
  CREATE POLICY "Acesso exclusivo backend crm_propostas"
    ON crm_propostas
    TO service_role, postgres
    USING (true)
    WITH CHECK (true);
END $$;
`;

/**
 * Inicializa as tabelas crm_empresas_emitentes e crm_propostas no PostgreSQL
 */
async function ensureCrmPropostasTables() {
  if (!getPool()) return false;
  try {
    await safeQuery(DDL_CRM_PROPOSTAS_SQL);
    invalidarCacheEmpresas();
    return true;
  } catch (err) {
    console.warn('⚠️ [CRM Propostas] Aviso ao inicializar tabelas de propostas:', err.message);
    return false;
  }
}

function normalizeEmpresaRow(row) {
  if (!row) return null;
  let rawBlocos = {};
  if (row.blocos_opcionais && typeof row.blocos_opcionais === 'object') {
    rawBlocos = row.blocos_opcionais;
  } else if (typeof row.blocos_opcionais === 'string') {
    try {
      rawBlocos = JSON.parse(row.blocos_opcionais);
    } catch {
      rawBlocos = {};
    }
  }
  const blocos = {
    mostrar_ncm: Boolean(rawBlocos.mostrar_ncm),
    mostrar_peso: Boolean(rawBlocos.mostrar_peso)
  };

  return {
    codigo: String(row.codigo || '').trim(),
    razao_social: String(row.razao_social || '').trim(),
    nome_fantasia: String(row.nome_fantasia || '').trim(),
    cnpj: String(row.cnpj || '').replace(/\D/g, ''),
    ie: row.ie !== null && row.ie !== undefined ? String(row.ie).trim() : null,
    endereco: row.endereco !== null && row.endereco !== undefined ? String(row.endereco).trim() : null,
    telefone: row.telefone !== null && row.telefone !== undefined ? String(row.telefone).trim() : null,
    email_contato: row.email_contato !== null && row.email_contato !== undefined ? String(row.email_contato).trim() : null,
    site: row.site !== null && row.site !== undefined ? String(row.site).trim() : null,
    logo_path: row.logo_path ? String(row.logo_path).trim() : null,
    cor_primaria: HEX_COLOR_REGEX.test(String(row.cor_primaria || '')) ? String(row.cor_primaria) : '#0b3d91',
    cor_secundaria: HEX_COLOR_REGEX.test(String(row.cor_secundaria || '')) ? String(row.cor_secundaria) : '#f59e0b',
    texto_rodape: row.texto_rodape !== null && row.texto_rodape !== undefined ? String(row.texto_rodape).trim() : null,
    texto_email: row.texto_email !== null && row.texto_email !== undefined ? String(row.texto_email).trim() : null,
    dados_bancarios_pix: row.dados_bancarios_pix !== null && row.dados_bancarios_pix !== undefined ? String(row.dados_bancarios_pix).trim() : null,
    validade_padrao_dias: Number(row.validade_padrao_dias) || 7,
    blocos_opcionais: blocos,
    ativo: row.ativo !== false,
    updated_at: row.updated_at || null,
    updated_by: row.updated_by || null
  };
}

function invalidarCacheEmpresas() {
  empresasCache = { items: null, loadedAt: 0 };
}

/**
 * Lista empresas emitentes com cache de 5 minutos
 */
async function listarEmpresas({ incluirInativas = false } = {}) {
  requireDbConnected();
  const res = await runPropostasQuery(`SELECT * FROM crm_empresas_emitentes ORDER BY codigo ASC;`);
  empresasCache = {
    items: (res?.rows || []).map(normalizeEmpresaRow),
    loadedAt: Date.now()
  };
  const all = empresasCache.items || [];
  return incluirInativas ? all : all.filter(e => e.ativo !== false);
}

/**
 * Obtém uma empresa emitente por código ('14', '15', '16')
 */
async function obterEmpresa(codigo) {
  const clean = resolverCodigoEmpresa(codigo) || String(codigo || '').trim();
  if (!clean) return null;
  const list = await listarEmpresas({ incluirInativas: true });
  return list.find(e => e.codigo === clean) || null;
}

/**
 * Atualiza os dados de uma empresa emitente (Admin apenas)
 */
async function salvarEmpresa(codigo, dados = {}, usuario = {}) {
  requireDbConnected();
  const cleanCod = String(codigo || '').trim();
  if (!['14', '15', '16'].includes(cleanCod)) {
    throw createHttpError(400, 'EMPRESA_EMITENTE_INVALIDA', 'Código de empresa emitente inválido (use 14, 15 ou 16).');
  }

  if (
    (dados.razao_social !== undefined && !String(dados.razao_social || '').trim()) ||
    (dados.nome_fantasia !== undefined && !String(dados.nome_fantasia || '').trim()) ||
    (dados.cnpj !== undefined && !String(dados.cnpj || '').replace(/\D/g, ''))
  ) {
    throw createHttpError(400, 'DADOS_EMPRESA_INCOMPLETOS', 'Razão Social, Nome Fantasia e CNPJ são obrigatórios.');
  }

  const antes = await obterEmpresa(cleanCod);
  if (!antes) {
    throw createHttpError(404, 'EMPRESA_NOT_FOUND', `Empresa emitente ${cleanCod} não encontrada.`);
  }

  const corPrimaria = dados.cor_primaria !== undefined ? String(dados.cor_primaria).trim() : antes.cor_primaria;
  const corSecundaria = dados.cor_secundaria !== undefined ? String(dados.cor_secundaria).trim() : antes.cor_secundaria;
  if (!HEX_COLOR_REGEX.test(corPrimaria) || !HEX_COLOR_REGEX.test(corSecundaria)) {
    throw createHttpError(400, 'COR_INVALIDA', 'As cores primária e secundária devem estar no formato hexadecimal #RRGGBB.');
  }

  const logoPathRaw = dados.logo_path !== undefined ? dados.logo_path : antes.logo_path;
  const logoCheck = validarLogoPathRelativo(logoPathRaw);
  if (!logoCheck.valid) {
    throw createHttpError(400, 'LOGO_PATH_INVALIDO', 'O caminho do logo deve ficar dentro de logos/ e não pode conter "..".');
  }

  const validadeDias = dados.validade_padrao_dias !== undefined
    ? Number(dados.validade_padrao_dias)
    : antes.validade_padrao_dias;
  if (!Number.isInteger(validadeDias) || validadeDias < 1 || validadeDias > 60) {
    throw createHttpError(400, 'VALIDADE_INVALIDA', 'A validade padrão deve ser um inteiro entre 1 e 60 dias.');
  }

  const rawBlocosIn = (dados.blocos_opcionais && typeof dados.blocos_opcionais === 'object')
    ? dados.blocos_opcionais
    : {};
  const blocos = {
    mostrar_ncm: rawBlocosIn.mostrar_ncm !== undefined ? Boolean(rawBlocosIn.mostrar_ncm) : Boolean(antes.blocos_opcionais?.mostrar_ncm),
    mostrar_peso: rawBlocosIn.mostrar_peso !== undefined ? Boolean(rawBlocosIn.mostrar_peso) : Boolean(antes.blocos_opcionais?.mostrar_peso)
  };

  const razaoSocial = dados.razao_social !== undefined ? String(dados.razao_social).trim() : antes.razao_social;
  const nomeFantasia = dados.nome_fantasia !== undefined ? String(dados.nome_fantasia).trim() : antes.nome_fantasia;
  const cnpj = dados.cnpj !== undefined ? String(dados.cnpj).replace(/\D/g, '') : antes.cnpj;
  if (!razaoSocial || !nomeFantasia || !cnpj) {
    throw createHttpError(400, 'DADOS_EMPRESA_INCOMPLETOS', 'Razão Social, Nome Fantasia e CNPJ são obrigatórios.');
  }

  const ieVal = dados.ie !== undefined ? (dados.ie ? String(dados.ie).trim() : null) : antes.ie;
  const enderecoVal = dados.endereco !== undefined ? (dados.endereco ? String(dados.endereco).trim() : null) : antes.endereco;
  const telefoneVal = dados.telefone !== undefined ? (dados.telefone ? String(dados.telefone).trim() : null) : antes.telefone;
  const emailContatoVal = dados.email_contato !== undefined ? (dados.email_contato ? String(dados.email_contato).trim() : null) : antes.email_contato;
  const siteVal = dados.site !== undefined ? (dados.site ? String(dados.site).trim() : null) : antes.site;
  const textoRodapeVal = dados.texto_rodape !== undefined ? (dados.texto_rodape ? String(dados.texto_rodape).trim() : null) : antes.texto_rodape;
  const textoEmailVal = dados.texto_email !== undefined ? (dados.texto_email ? String(dados.texto_email).trim() : null) : antes.texto_email;
  const dadosBancariosPixVal = dados.dados_bancarios_pix !== undefined
    ? (dados.dados_bancarios_pix ? String(dados.dados_bancarios_pix).trim() : null)
    : antes.dados_bancarios_pix;

  const updatedBy = String(usuario?.username || 'admin').trim();
  const res = await runPropostasQuery(
    `UPDATE crm_empresas_emitentes
     SET razao_social = $2,
         nome_fantasia = $3,
         cnpj = $4,
         ie = $5,
         endereco = $6,
         telefone = $7,
         email_contato = $8,
         site = $9,
         logo_path = $10,
         cor_primaria = $11,
         cor_secundaria = $12,
         texto_rodape = $13,
         texto_email = $14,
         dados_bancarios_pix = $15,
         validade_padrao_dias = $16,
         blocos_opcionais = $17::jsonb,
         ativo = $18,
         updated_at = NOW(),
         updated_by = $19
     WHERE codigo = $1
     RETURNING *;`,
    [
      cleanCod,
      razaoSocial,
      nomeFantasia,
      cnpj,
      ieVal,
      enderecoVal,
      telefoneVal,
      emailContatoVal,
      siteVal,
      logoCheck.normalized,
      corPrimaria,
      corSecundaria,
      textoRodapeVal,
      textoEmailVal,
      dadosBancariosPixVal,
      validadeDias,
      JSON.stringify(blocos),
      dados.ativo !== undefined ? Boolean(dados.ativo) : antes.ativo,
      updatedBy
    ]
  );

  invalidarCacheEmpresas();
  const depois = normalizeEmpresaRow(res?.rows?.[0]);

  try {
    const engine = getCrmEngine();
    if (engine && typeof engine.recordTelemetry === 'function') {
      await engine.recordTelemetry(
        usuario,
        'CRM_EMPRESA_EDITADA',
        `Empresa emitente ${cleanCod} (${depois?.nome_fantasia || ''}) atualizada`,
        { codigo: cleanCod, antes, depois }
      );
    }
  } catch (errTel) {
    console.warn('⚠️ [CRM Propostas] Aviso ao gravar telemetria CRM_EMPRESA_EDITADA:', errTel.message);
  }

  return depois;
}

/**
 * Resolve dados do vendedor responsável pela oportunidade a partir de crm_vendedores
 * (campos reais: cod_vendedor/codigo, nome, email, telefone_whatsapp, assinatura, username_portal),
 * incluindo fallback de e-mail para a tabela users do portal (Ajuste A).
 */
async function resolverDadosVendedorDeal(deal) {
  const cod = (await crmVendedores.resolverCodigoVendedor(deal?.cod_vendedor || deal?.nome_vendedor || '')) ||
              String(deal?.cod_vendedor || '').trim();
  let vend = null;
  if (cod) {
    vend = await crmVendedores.obterVendedorPorCodigo(cod);
  }
  let email = String(vend?.email || '').trim();
  const usernamePortal = String(vend?.username_portal || '').trim().toLowerCase();

  if (!email && usernamePortal) {
    try {
      const portalUsers = await getUsers();
      if (Array.isArray(portalUsers)) {
        const foundUser = portalUsers.find(u => String(u.username || '').trim().toLowerCase() === usernamePortal);
        if (foundUser && foundUser.email) {
          email = String(foundUser.email).trim();
        }
      }
    } catch (err) {
      console.warn('⚠️ [CRM Propostas] Aviso ao consultar e-mail do usuário no portal:', err.message);
    }
  }

  const codigoFinal = String(vend?.codigo || vend?.cod_vendedor || cod || deal?.cod_vendedor || '').trim();
  return {
    codigo: codigoFinal,
    cod_vendedor: codigoFinal,
    nome: String(vend?.nome || deal?.nome_vendedor || '').trim(),
    username_portal: usernamePortal,
    email,
    telefone_whatsapp: String(vend?.telefone_whatsapp || '').trim(),
    assinatura: String(vend?.assinatura || '').trim()
  };
}

/**
 * Monta o snapshot puro da proposta (Seção 3.2 e 4.2 da spec).
 * NUNCA inclui precoTabela, descontoPercent, desconto, frete_embutido, obs_nfe ou observacoes internas,
 * nem textos comerciais inventados.
 */
function montarSnapshot(deal, empresa, vendedor = {}, opcoes = {}) {
  if (!deal) {
    throw createHttpError(404, 'DEAL_NOT_FOUND', 'Oportunidade não encontrada.');
  }

  const estagioNorm = String(deal.estagio || deal.fase || '').trim().toLowerCase();
  const statusNorm = String(deal.status || '').trim().toLowerCase();
  if (estagioNorm === 'perdido' || statusNorm === 'perdido') {
    throw createHttpError(409, 'DEAL_PERDIDO', 'Reabra a oportunidade para emitir proposta');
  }

  const empCod = resolverCodigoEmpresa(empresa?.codigo || deal.faturado_por || deal.custom?.faturadoPor || deal.faturadoPor);
  if (!empresa || !['14', '15', '16'].includes(empCod) || empresa.ativo === false) {
    throw createHttpError(
      400,
      'EMPRESA_EMITENTE_INVALIDA',
      'Selecione Faturado Por (14 - Metal Pleno, 15 - GSI ou 16 - OACO) na oportunidade antes de gerar a proposta.'
    );
  }

  const clienteNome = String(deal.cliente_nome || deal.clienteNome || '').trim();
  const clienteCnpjRaw = String(deal.cliente_cnpj || deal.clienteCnpj || '').trim();
  const clienteCnpjLimpo = clienteCnpjRaw.replace(/\D/g, '');
  if (!clienteNome || !clienteCnpjLimpo) {
    throw createHttpError(
      400,
      'CLIENTE_INCOMPLETO',
      'O cliente da oportunidade precisa ter Razão Social/Nome e CNPJ/CPF preenchidos.'
    );
  }

  const rawValidade = opcoes.validadeDias !== undefined && opcoes.validadeDias !== null && opcoes.validadeDias !== ''
    ? Number(opcoes.validadeDias)
    : Number(empresa.validade_padrao_dias || 7);
  if (!Number.isInteger(rawValidade) || rawValidade < 1 || rawValidade > 60) {
    throw createHttpError(400, 'VALIDADE_INVALIDA', 'A validade da proposta deve ser um número inteiro entre 1 e 60 dias.');
  }

  const rawItens = Array.isArray(deal.itens_cotados)
    ? deal.itens_cotados
    : (Array.isArray(deal.itens) ? deal.itens : []);

  if (rawItens.length === 0) {
    throw createHttpError(
      400,
      'ITENS_INVALIDOS',
      'A oportunidade deve possuir ao menos 1 item cotado com quantidade e preço negociado maiores que zero.',
      { itensInvalidos: [] }
    );
  }

  const itensInvalidos = [];
  rawItens.forEach((item, idx) => {
    const qtd = Number(item?.quantidade ?? item?.qtd ?? 0);
    const hasNegociado = item?.precoNegociado !== undefined && item?.precoNegociado !== null && item?.precoNegociado !== '';
    const precoUnit = hasNegociado
      ? Number(item.precoNegociado)
      : Number(item?.preco_unitario ?? item?.preco_unit ?? 0);

    if (!(qtd > 0) || !(precoUnit > 0)) {
      itensInvalidos.push({
        item: idx + 1,
        codigo: String(item?.codigo || '').trim(),
        descricao: String(item?.descricao || '').trim()
      });
    }
  });

  if (itensInvalidos.length > 0) {
    const listaDesc = itensInvalidos.map(i => i.codigo || `Item #${i.item}`).join(', ');
    throw createHttpError(
      400,
      'ITENS_INVALIDOS',
      `Itens com quantidade ou preço unitário inválido (<= 0): ${listaDesc}.`,
      { itensInvalidos }
    );
  }

  let subtotal = 0;

  // Lista de campos permitidos nos itens (Seção 4.2)
  const itensSnapshot = rawItens.map((item) => {
    const quantidade = Number(item.quantidade ?? item.qtd ?? 0);
    const hasNegociado = item.precoNegociado !== undefined && item.precoNegociado !== null && item.precoNegociado !== '';
    const precoRaw = hasNegociado
      ? Number(item.precoNegociado)
      : Number(item.preco_unitario ?? item.preco_unit ?? 0);
    const preco_unitario = Math.round(precoRaw * 100) / 100;
    const total = Math.round(quantidade * preco_unitario * 100) / 100;
    const peso_kg = Number(item.peso_kg ?? item.pesoLiquido ?? item.peso ?? 0) || 0;

    subtotal = Math.round((subtotal + total) * 100) / 100;

    return {
      codigo: String(item.codigo || '').trim(),
      descricao: String(item.descricao || '').trim(),
      quantidade,
      unidade: String(item.unidade || item.un || 'UN').trim() || 'UN',
      preco_unitario,
      total,
      ncm: String(item.ncm || '').trim(),
      peso_kg
    };
  });

  const frete_cobrado = Math.round(Math.max(0, Number(deal.frete_cobrado ?? deal.freteCobrado ?? 0) || 0) * 100) / 100;
  const total = Math.round((subtotal + frete_cobrado) * 100) / 100;

  const valorDeal = Number(deal.valor_total ?? deal.valor ?? 0) || 0;
  if (valorDeal > 0 && Math.abs(total - valorDeal) > 0.01) {
    console.warn(`⚠️ [CRM Propostas] Divergência de total no deal #${deal.id}: calculado=${total} vs deal.valor_total=${valorDeal}`);
  }

  const dataEmissaoIso = opcoes.dataEmissao && /^\d{4}-\d{2}-\d{2}$/.test(String(opcoes.dataEmissao))
    ? String(opcoes.dataEmissao)
    : getTodaySaoPauloIso();
  const validadeAteIso = addDaysIso(dataEmissaoIso, rawValidade);

  // Contato = deal.custom.contatoNome, depois contatos[0].nome, depois contato_nome
  const contatoCliente = String(
    deal.custom?.contatoNome ||
    (Array.isArray(deal.contatos) && deal.contatos[0]?.nome) ||
    deal.contato_nome ||
    ''
  ).trim();

  // Observações do cliente vêm exclusivamente de opcoes.observacoesCliente (nunca deal.observacoes nem deal.obs_nfe)
  const observacoes_cliente = String(opcoes.observacoesCliente ?? '').trim();

  const rawBlocos = (empresa.blocos_opcionais && typeof empresa.blocos_opcionais === 'object')
    ? empresa.blocos_opcionais
    : {};
  const blocosOpcionais = {
    mostrar_ncm: Boolean(rawBlocos.mostrar_ncm),
    mostrar_peso: Boolean(rawBlocos.mostrar_peso)
  };

  const dealIdStr = String(deal.id).trim();
  const cond_pgto = String(deal.cond_pgto ?? deal.condicaoPgto ?? '').trim();
  const prazo_entrega = String(deal.prazo_entrega ?? deal.prazoEntrega ?? '').trim();
  const tipo_frete = String(deal.tipo_frete ?? deal.tipoFrete ?? '').trim().toUpperCase();
  const transportadora = String(deal.transportadora ?? '').trim();

  return {
    numero: String(opcoes.numero || `${dealIdStr}-R?`),
    deal_id: dealIdStr,
    revisao: opcoes.revisao ? Number(opcoes.revisao) : null,
    emitida_em: opcoes.emitidaEm || new Date().toISOString(),
    data_emissao: dataEmissaoIso,
    validade_dias: rawValidade,
    validade_ate: validadeAteIso,
    empresa: {
      codigo: empCod,
      razao_social: String(empresa.razao_social || '').trim(),
      nome_fantasia: String(empresa.nome_fantasia || '').trim(),
      cnpj: formatCnpjCpf(empresa.cnpj),
      ie: String(empresa.ie || '').trim(),
      endereco: String(empresa.endereco || '').trim(),
      telefone: String(empresa.telefone || '').trim(),
      email_contato: String(empresa.email_contato || '').trim(),
      site: String(empresa.site || '').trim(),
      logo_path: empresa.logo_path ? String(empresa.logo_path).trim() : null,
      cor_primaria: HEX_COLOR_REGEX.test(String(empresa.cor_primaria || '')) ? String(empresa.cor_primaria) : '#0b3d91',
      cor_secundaria: HEX_COLOR_REGEX.test(String(empresa.cor_secundaria || '')) ? String(empresa.cor_secundaria) : '#f59e0b',
      texto_rodape: String(empresa.texto_rodape || '').trim(),
      dados_bancarios_pix: String(empresa.dados_bancarios_pix || '').trim(),
      blocos_opcionais: blocosOpcionais
    },
    cliente: {
      nome: clienteNome,
      cnpj: formatCnpjCpf(clienteCnpjLimpo),
      contato: contatoCliente,
      cidade: String(deal.cliente_cidade || deal.clienteCidade || '').trim(),
      uf: String(deal.cliente_uf || deal.clienteUf || '').trim(),
      email: String(deal.cliente_email || deal.clienteEmail || '').trim(),
      telefone: String(deal.cliente_telefone_fmt || deal.cliente_telefone || deal.clienteTelefone || '').trim()
    },
    itens: itensSnapshot,
    subtotal,
    frete_cobrado,
    total,
    cond_pgto,
    prazo_entrega,
    tipo_frete,
    transportadora,
    observacoes_cliente,
    vendedor: {
      codigo: String(vendedor.codigo || vendedor.cod_vendedor || deal.cod_vendedor || '').trim(),
      nome: String(vendedor.nome || deal.nome_vendedor || '').trim(),
      email: String(vendedor.email || '').trim(),
      telefone_whatsapp: String(vendedor.telefone_whatsapp || '').trim(),
      assinatura: String(vendedor.assinatura || '').trim()
    }
  };
}

/**
 * Carrega imagem de logotipo em data URI base64 de forma resiliente (sem quebrar se ausente)
 */
function carregarLogoDataUrl(logoPath) {
  if (!logoPath) return null;
  const check = validarLogoPathRelativo(logoPath);
  if (!check.valid || !check.fullPath) {
    console.warn(`⚠️ [CRM Propostas] Logo ignorado por caminho inválido: ${logoPath}`);
    return null;
  }
  try {
    if (!fs.existsSync(check.fullPath)) {
      console.warn(`⚠️ [CRM Propostas] Arquivo de logo não encontrado em disco (${check.normalized}). Usando cabeçalho textual.`);
      return null;
    }
    const buf = fs.readFileSync(check.fullPath);
    const ext = path.extname(check.fullPath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (err) {
    console.warn(`⚠️ [CRM Propostas] Falha ao ler logo (${check.normalized}):`, err.message);
    return null;
  }
}

/**
 * Constrói a estrutura de documento do pdfmake (estritamente os 10 blocos da Seção 3.1 da spec)
 */
function montarDocDefinition(snapshot, { previa = false } = {}) {
  const emp = snapshot.empresa || {};
  const cli = snapshot.cliente || {};
  const vend = snapshot.vendedor || {};
  const blocos = emp.blocos_opcionais || DEFAULT_BLOCOS_OPCIONAIS;
  const corPrimaria = HEX_COLOR_REGEX.test(String(emp.cor_primaria || '')) ? emp.cor_primaria : '#0b3d91';
  const corSecundaria = HEX_COLOR_REGEX.test(String(emp.cor_secundaria || '')) ? emp.cor_secundaria : '#f59e0b';

  const dealIdStr = String(snapshot.deal_id || '').trim();
  const numeroExibicao = previa
    ? `${dealIdStr || String(snapshot.numero || '').replace(/-R.*$/, '')}-R? (prévia)`
    : String(snapshot.numero || `${dealIdStr}-R1`);

  const dataEmissaoIso = snapshot.data_emissao || String(snapshot.emitida_em || '').slice(0, 10) || getTodaySaoPauloIso();

  // 1. Cabeçalho: logo (altura máx. 50 pt) à esquerda ou nome fantasia em cor_primaria;
  //    à direita razão social, CNPJ formatado, IE, endereço, telefone, site. Filete em cor_primaria.
  const logoDataUrl = carregarLogoDataUrl(emp.logo_path);
  const leftHeaderStack = [];
  if (logoDataUrl) {
    leftHeaderStack.push({
      image: logoDataUrl,
      fit: [140, 50],
      margin: [0, 0, 0, 2]
    });
  } else {
    leftHeaderStack.push({
      text: emp.nome_fantasia || emp.razao_social || '',
      fontSize: 16,
      bold: true,
      color: corPrimaria
    });
  }

  const rightHeaderStack = [];
  if (emp.razao_social) {
    rightHeaderStack.push({ text: emp.razao_social, fontSize: 9.5, bold: true, color: '#1e293b', alignment: 'right' });
  }
  const cnpjIeParts = [
    emp.cnpj ? `CNPJ: ${formatCnpjCpf(emp.cnpj)}` : '',
    emp.ie ? `IE: ${emp.ie}` : ''
  ].filter(Boolean);
  if (cnpjIeParts.length > 0) {
    rightHeaderStack.push({ text: cnpjIeParts.join(' · '), fontSize: 8.5, color: '#475569', alignment: 'right' });
  }
  if (emp.endereco) {
    rightHeaderStack.push({ text: emp.endereco, fontSize: 8, color: '#475569', alignment: 'right' });
  }
  const telSiteParts = [emp.telefone, emp.site, emp.email_contato].filter(Boolean);
  if (telSiteParts.length > 0) {
    rightHeaderStack.push({ text: telSiteParts.join(' · '), fontSize: 8, color: '#475569', alignment: 'right' });
  }

  const headerBlock = {
    columns: [
      { width: 170, stack: leftHeaderStack },
      { width: '*', stack: rightHeaderStack }
    ],
    columnGap: 12,
    margin: [0, 0, 0, 6]
  };

  const fileteBlock = {
    canvas: [
      { type: 'rect', x: 0, y: 0, w: 515, h: 2, color: corPrimaria }
    ],
    margin: [0, 0, 0, 10]
  };

  // 2. Título: "PROPOSTA COMERCIAL Nº 29001-R2" · data de emissão · "Válida até 20/11/2026"
  const tituloBlock = {
    columns: [
      {
        width: '*',
        text: `PROPOSTA COMERCIAL Nº ${numeroExibicao}`,
        fontSize: 12,
        bold: true,
        color: corPrimaria
      },
      {
        width: 'auto',
        text: `Emissão: ${formatDateBr(dataEmissaoIso)} · Válida até ${formatDateBr(snapshot.validade_ate)}`,
        fontSize: 9,
        bold: true,
        color: '#334155',
        alignment: 'right',
        margin: [0, 2, 0, 0]
      }
    ],
    margin: [0, 0, 0, 10]
  };

  // 3. Cliente: razão social, CNPJ, A/C (contato), cidade/UF, e-mail e telefone do cliente quando houver
  const nomeCliente = cli.nome || cli.razao_social || '';
  const cnpjCliente = cli.cnpj || cli.cnpj_cpf || '';
  const cidadeUfCli = [cli.cidade, cli.uf].filter(Boolean).join('/');

  const clienteLeftLines = [
    { text: [{ text: 'Cliente: ', bold: true }, { text: nomeCliente }], fontSize: 9, margin: [0, 0, 0, 2] },
    { text: [{ text: 'CNPJ/CPF: ', bold: true }, { text: formatCnpjCpf(cnpjCliente) }], fontSize: 8.5, color: '#334155', margin: [0, 0, 0, 2] }
  ];
  if (cli.contato) {
    clienteLeftLines.push({ text: [{ text: 'A/C: ', bold: true }, { text: cli.contato }], fontSize: 8.5, color: '#334155', margin: [0, 0, 0, 2] });
  }

  const clienteRightLines = [];
  if (cidadeUfCli) {
    clienteRightLines.push({ text: [{ text: 'Cidade/UF: ', bold: true }, { text: cidadeUfCli }], fontSize: 8.5, color: '#334155', margin: [0, 0, 0, 2] });
  }
  if (cli.email) {
    clienteRightLines.push({ text: [{ text: 'E-mail: ', bold: true }, { text: cli.email }], fontSize: 8.5, color: '#334155', margin: [0, 0, 0, 2] });
  }
  if (cli.telefone) {
    clienteRightLines.push({ text: [{ text: 'Telefone: ', bold: true }, { text: cli.telefone }], fontSize: 8.5, color: '#334155', margin: [0, 0, 0, 2] });
  }

  const clienteBlock = {
    table: {
      widths: ['*', 200],
      body: [
        [
          { stack: clienteLeftLines, margin: [6, 5, 6, 5] },
          { stack: clienteRightLines, margin: [6, 5, 6, 5] }
        ]
      ]
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#cbd5e1',
      vLineColor: () => '#cbd5e1'
    },
    margin: [0, 0, 0, 10]
  };

  // 4. Itens: tabela com cabeçalho em cor_primaria e linhas zebradas: Código · Descrição · Qtd · UM · Unitário · Total
  //    NCM e Peso só se ligados em blocos_opcionais. headerRows: 1.
  const mostrarNcm = Boolean(blocos.mostrar_ncm);
  const mostrarPeso = Boolean(blocos.mostrar_peso);

  const tableWidths = [55, '*'];
  const headerRow = [
    { text: 'Código', bold: true, fontSize: 8.5, color: '#ffffff', fillColor: corPrimaria, alignment: 'left' },
    { text: 'Descrição', bold: true, fontSize: 8.5, color: '#ffffff', fillColor: corPrimaria, alignment: 'left' }
  ];

  if (mostrarNcm) {
    tableWidths.push(48);
    headerRow.push({ text: 'NCM', bold: true, fontSize: 8.5, color: '#ffffff', fillColor: corPrimaria, alignment: 'center' });
  }
  if (mostrarPeso) {
    tableWidths.push(42);
    headerRow.push({ text: 'Peso (kg)', bold: true, fontSize: 8.5, color: '#ffffff', fillColor: corPrimaria, alignment: 'right' });
  }

  tableWidths.push(34, 28, 70, 74);
  headerRow.push(
    { text: 'Qtd', bold: true, fontSize: 8.5, color: '#ffffff', fillColor: corPrimaria, alignment: 'right' },
    { text: 'UM', bold: true, fontSize: 8.5, color: '#ffffff', fillColor: corPrimaria, alignment: 'center' },
    { text: 'Unitário', bold: true, fontSize: 8.5, color: '#ffffff', fillColor: corPrimaria, alignment: 'right' },
    { text: 'Total', bold: true, fontSize: 8.5, color: '#ffffff', fillColor: corPrimaria, alignment: 'right' }
  );

  const itemRows = (snapshot.itens || []).map((it, idx) => {
    const zebraColor = idx % 2 === 1 ? '#f8fafc' : '#ffffff';
    const row = [
      { text: it.codigo || '-', fontSize: 8.5, alignment: 'left', fillColor: zebraColor },
      { text: it.descricao || '', fontSize: 8.5, alignment: 'left', fillColor: zebraColor }
    ];
    if (mostrarNcm) {
      row.push({ text: it.ncm || '-', fontSize: 8, alignment: 'center', fillColor: zebraColor });
    }
    if (mostrarPeso) {
      row.push({
        text: it.peso_kg ? Number(it.peso_kg).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-',
        fontSize: 8,
        alignment: 'right',
        fillColor: zebraColor
      });
    }
    row.push(
      { text: String(it.quantidade), fontSize: 8.5, alignment: 'right', fillColor: zebraColor },
      { text: it.unidade || 'UN', fontSize: 8, alignment: 'center', fillColor: zebraColor },
      { text: `R$ ${formatMoneyBr(it.preco_unitario)}`, fontSize: 8.5, alignment: 'right', fillColor: zebraColor },
      { text: `R$ ${formatMoneyBr(it.total)}`, fontSize: 8.5, bold: true, alignment: 'right', fillColor: zebraColor }
    );
    return row;
  });

  const itensTableBlock = {
    table: {
      headerRows: 1,
      widths: tableWidths,
      body: [headerRow, ...itemRows]
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#cbd5e1',
      vLineColor: () => '#cbd5e1',
      paddingLeft: () => 5,
      paddingRight: () => 5,
      paddingTop: () => 4,
      paddingBottom: () => 4
    },
    margin: [0, 0, 0, 8]
  };

  // 5. Totais (alinhados à direita): Subtotal dos itens · Frete (só se frete_cobrado > 0) · Total
  const subtotalVal = Number(snapshot.subtotal ?? snapshot.totais?.subtotal ?? 0);
  const freteCobradoVal = Number(snapshot.frete_cobrado ?? snapshot.totais?.frete_cobrado ?? 0);
  const totalVal = Number(snapshot.total ?? snapshot.totais?.total ?? 0);

  const totaisBody = [
    [
      { text: 'Subtotal dos itens:', fontSize: 9, alignment: 'right', color: '#334155', margin: [4, 2, 4, 2] },
      { text: `R$ ${formatMoneyBr(subtotalVal)}`, fontSize: 9, bold: true, alignment: 'right', color: '#1e293b', margin: [4, 2, 4, 2] }
    ]
  ];

  if (freteCobradoVal > 0) {
    totaisBody.push([
      { text: 'Frete:', fontSize: 9, alignment: 'right', color: '#334155', margin: [4, 2, 4, 2] },
      { text: `R$ ${formatMoneyBr(freteCobradoVal)}`, fontSize: 9, bold: true, alignment: 'right', color: '#1e293b', margin: [4, 2, 4, 2] }
    ]);
  }

  totaisBody.push([
    { text: 'Total:', fontSize: 10, bold: true, alignment: 'right', color: '#ffffff', fillColor: corPrimaria, margin: [6, 5, 6, 5] },
    { text: `R$ ${formatMoneyBr(totalVal)}`, fontSize: 10.5, bold: true, alignment: 'right', color: '#ffffff', fillColor: corPrimaria, margin: [6, 5, 6, 5] }
  ]);

  const totaisBlock = {
    columns: [
      { width: '*', text: '' },
      {
        width: 220,
        table: {
          widths: ['*', 95],
          body: totaisBody
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#cbd5e1',
          vLineColor: () => '#cbd5e1'
        }
      }
    ],
    margin: [0, 0, 0, 10]
  };

  // 6. Condições: Condição de pagamento · Prazo de entrega · Frete (CIF/FOB) e Transportadora (só linhas preenchidas)
  const condPgto = String(snapshot.cond_pgto ?? snapshot.condicoes?.cond_pgto ?? '').trim();
  const prazoEntrega = String(snapshot.prazo_entrega ?? snapshot.condicoes?.prazo_entrega ?? '').trim();
  const tipoFrete = String(snapshot.tipo_frete ?? snapshot.condicoes?.tipo_frete ?? '').trim();
  const transportadora = String(snapshot.transportadora ?? snapshot.condicoes?.transportadora ?? '').trim();

  const condicoesLines = [];
  if (condPgto) {
    condicoesLines.push({ text: [{ text: 'Condição de pagamento: ', bold: true }, { text: condPgto }], fontSize: 9, margin: [0, 0, 0, 2] });
  }
  if (prazoEntrega) {
    condicoesLines.push({ text: [{ text: 'Prazo de entrega: ', bold: true }, { text: prazoEntrega }], fontSize: 9, margin: [0, 0, 0, 2] });
  }
  if (tipoFrete) {
    condicoesLines.push({ text: [{ text: 'Frete: ', bold: true }, { text: tipoFrete }], fontSize: 9, margin: [0, 0, 0, 2] });
  }
  if (transportadora) {
    condicoesLines.push({ text: [{ text: 'Transportadora: ', bold: true }, { text: transportadora }], fontSize: 9, margin: [0, 0, 0, 2] });
  }

  const condicoesBlock = condicoesLines.length > 0
    ? {
        unbreakable: true,
        table: {
          dontBreakRows: true,
          widths: ['*'],
          body: [
            [{ text: 'CONDIÇÕES COMERCIAIS', fillColor: '#f1f5f9', color: corPrimaria, bold: true, fontSize: 9, margin: [6, 4, 6, 4] }],
            [{ stack: condicoesLines, margin: [6, 5, 6, 5] }]
          ]
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#cbd5e1',
          vLineColor: () => '#cbd5e1'
        },
        margin: [0, 0, 0, 10]
      }
    : null;

  // 7. Observações (só se observacoesCliente preenchido)
  const obsBlock = snapshot.observacoes_cliente
    ? {
        unbreakable: true,
        table: {
          dontBreakRows: true,
          widths: ['*'],
          body: [
            [{ text: 'OBSERVAÇÕES', fillColor: '#f1f5f9', color: corPrimaria, bold: true, fontSize: 9, margin: [6, 4, 6, 4] }],
            [{ text: snapshot.observacoes_cliente, fontSize: 9, color: '#1e293b', margin: [6, 5, 6, 5] }]
          ]
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#cbd5e1',
          vLineColor: () => '#cbd5e1'
        },
        margin: [0, 0, 0, 10]
      }
    : null;

  // 8. Dados para pagamento (só se dados_bancarios_pix preenchido)
  const dadosPagamentoBlock = emp.dados_bancarios_pix
    ? {
        unbreakable: true,
        table: {
          dontBreakRows: true,
          widths: ['*'],
          body: [
            [{ text: 'DADOS PARA PAGAMENTO', fillColor: '#f1f5f9', color: corPrimaria, bold: true, fontSize: 9, margin: [6, 4, 6, 4] }],
            [{ text: emp.dados_bancarios_pix, fontSize: 8.5, color: '#1e293b', margin: [6, 5, 6, 5] }]
          ]
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#cbd5e1',
          vLineColor: () => '#cbd5e1'
        },
        margin: [0, 0, 0, 10]
      }
    : null;

  // 9. Vendedor: nome, e-mail, WhatsApp, assinatura (sem cargo inventado e sem bloco de aceite do cliente)
  const vendedorLines = [];
  if (vend.nome) {
    vendedorLines.push({ text: vend.nome, fontSize: 9.5, bold: true, color: '#1e293b' });
  }
  if (vend.email) {
    vendedorLines.push({ text: `E-mail: ${vend.email}`, fontSize: 8.5, color: '#334155' });
  }
  if (vend.telefone_whatsapp) {
    vendedorLines.push({ text: `WhatsApp: ${vend.telefone_whatsapp}`, fontSize: 8.5, color: '#334155' });
  }
  if (vend.assinatura) {
    vendedorLines.push({ text: vend.assinatura, fontSize: 8.5, color: '#475569', margin: [0, 2, 0, 0] });
  }

  const vendedorBlock = vendedorLines.length > 0
    ? {
        unbreakable: true,
        stack: [
          { text: 'VENDEDOR RESPONSÁVEL', fontSize: 8.5, bold: true, color: corSecundaria, margin: [0, 0, 0, 2] },
          ...vendedorLines
        ],
        margin: [0, 4, 0, 0]
      }
    : null;

  const content = [
    headerBlock,
    fileteBlock,
    tituloBlock,
    clienteBlock,
    itensTableBlock,
    totaisBlock,
    ...(condicoesBlock ? [condicoesBlock] : []),
    ...(obsBlock ? [obsBlock] : []),
    ...(dadosPagamentoBlock ? [dadosPagamentoBlock] : []),
    ...(vendedorBlock ? [vendedorBlock] : [])
  ];

  const docDefinition = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [40, 40, 40, 40],
    info: {
      title: `Proposta Comercial ${numeroExibicao} - ${emp.nome_fantasia || ''}`,
      author: emp.razao_social || 'Grupo GSI',
      subject: `Proposta Comercial ${numeroExibicao}`
    },
    defaultStyle: {
      font: 'Roboto',
      fontSize: 9,
      color: '#1e293b'
    },
    content,
    // 10. Rodapé em todas as páginas: texto_rodape + "Página X de Y"
    footer: (currentPage, pageCount) => ({
      columns: [
        {
          width: '*',
          text: emp.texto_rodape || '',
          fontSize: 7.5,
          color: '#64748b'
        },
        {
          width: 90,
          text: `Página ${currentPage} de ${pageCount}`,
          fontSize: 7.5,
          color: '#64748b',
          alignment: 'right'
        }
      ],
      margin: [40, 12, 40, 0]
    })
  };

  if (previa) {
    docDefinition.watermark = {
      text: 'PRÉVIA — SEM VALOR',
      color: '#94a3b8',
      opacity: 0.22,
      bold: true,
      italics: false
    };
  }

  return docDefinition;
}

/**
 * Renderiza docDefinition do pdfmake em um Buffer PDF em memória
 */
function gerarPdf(docDefinition) {
  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(PDF_FONTS);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      pdfDoc.on('data', chunk => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', err => reject(err));
      pdfDoc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Verifica se o deal existe e é visível/editável pelo escopo do usuário ({ all: true } ou { all: false, codVendedor, codigosLeitura }).
 * Caso negado ou inexistente, lança 404 DEAL_NOT_FOUND (e grava CRM_DEAL_ACESSO_NEGADO se bloqueado por escopo).
 */
async function carregarDealComEscopo(dealId, scope, { exigirEdicao = false } = {}) {
  requireDbConnected();
  const engine = getCrmEngine();
  const cleanDealId = String(dealId || '').trim();
  const effectiveScope = scope || { all: true };
  // Verifica a disponibilidade do Postgres diretamente (converte erros de conexão do pg em 503)
  await runPropostasQuery('SELECT 1 FROM crm_deals WHERE id = $1 AND ativo = TRUE LIMIT 1;', [cleanDealId]);
  const deal = await engine.obterDealPorId(cleanDealId, effectiveScope);
  if (!deal) {
    throw createHttpError(404, 'DEAL_NOT_FOUND', 'Oportunidade não encontrada.');
  }
  const permitido = exigirEdicao
    ? engine.dealEditavel(deal, effectiveScope)
    : engine.dealVisivel(deal, effectiveScope);

  if (!permitido) {
    if (typeof engine.recordTelemetry === 'function') {
      await engine.recordTelemetry(
        { username: effectiveScope.username || 'desconhecido', role: effectiveScope.role || 'vendedor' },
        'CRM_DEAL_ACESSO_NEGADO',
        `Tentativa de ação em proposta de deal fora do escopo (#${cleanDealId})`,
        { deal_id: cleanDealId, cod_vendedor: effectiveScope.codVendedor || null }
      );
    }
    throw createHttpError(404, 'DEAL_NOT_FOUND', 'Oportunidade não encontrada.');
  }
  return deal;
}

/**
 * Gera PDF de prévia em memória (sem gravar em banco, sem criar revisão, com marca d'água)
 */
async function previaProposta(dealId, opcoes = {}, scope = { all: true }) {
  requireDbConnected();
  const deal = await carregarDealComEscopo(dealId, scope, { exigirEdicao: true });
  const empCod = resolverCodigoEmpresa(deal.faturado_por || deal.custom?.faturadoPor || deal.faturadoPor);
  const empresa = empCod ? await obterEmpresa(empCod) : null;
  const vendedor = await resolverDadosVendedorDeal(deal);

  const snapshot = montarSnapshot(deal, empresa, vendedor, {
    ...opcoes,
    numero: `${String(deal.id)}-R?`
  });
  const docDef = montarDocDefinition(snapshot, { previa: true });
  const pdfBuffer = await gerarPdf(docDef);

  return {
    snapshot,
    pdfBuffer,
    filename: `Previa-Proposta-${String(deal.id)}-${sanitizeFilenameSlug(empresa?.nome_fantasia)}.pdf`
  };
}

/**
 * Gera e persiste uma nova revisão imutável de proposta comercial (Seção 4.1 e Ajuste C)
 */
async function gerarRevisao(dealId, opcoes = {}, usuario = {}, scope = { all: true }) {
  requireDbConnected();
  const engine = getCrmEngine();
  const effectiveScope = scope || { all: true };
  const deal = await carregarDealComEscopo(dealId, effectiveScope, { exigirEdicao: true });
  const dealIdStr = String(deal.id).trim();

  const empCod = resolverCodigoEmpresa(deal.faturado_por || deal.custom?.faturadoPor || deal.faturadoPor);
  const empresa = empCod ? await obterEmpresa(empCod) : null;
  const vendedor = await resolverDadosVendedorDeal(deal);

  // Valida o snapshot antes de abrir transação no banco
  const snapshotBase = montarSnapshot(deal, empresa, vendedor, opcoes);

  const pool = getPool();
  const maxAttempts = 2;
  let lastErr = null;
  let resultRow = null;
  let finalSnapshot = null;
  let pdfBuffer = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let client = null;
    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const lockRes = await client.query(
        'SELECT id, custom, estagio, cod_vendedor FROM crm_deals WHERE id = $1 AND ativo = TRUE FOR UPDATE',
        [dealIdStr]
      );
      if (!lockRes.rows || lockRes.rows.length === 0) {
        throw createHttpError(404, 'DEAL_NOT_FOUND', 'Oportunidade não encontrada.');
      }

      const revRes = await client.query(
        'SELECT COALESCE(MAX(revisao), 0) + 1 AS prox_rev FROM crm_propostas WHERE deal_id = $1',
        [dealIdStr]
      );
      const revisao = Number(revRes.rows[0].prox_rev) || 1;
      const numero = `${dealIdStr}-R${revisao}`;

      finalSnapshot = {
        ...snapshotBase,
        numero,
        revisao
      };

      const docDef = montarDocDefinition(finalSnapshot, { previa: false });
      pdfBuffer = await gerarPdf(docDef);
      const pdfSha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
      const tokenPublico = crypto.randomBytes(32).toString('base64url');
      const geradaPor = String(usuario?.username || effectiveScope?.username || 'sistema').trim();
      const codVendedorGravado = String(vendedor.cod_vendedor || deal.cod_vendedor || lockRes.rows[0].cod_vendedor || '').trim();

      const insertRes = await client.query(
        `INSERT INTO crm_propostas (
           deal_id, revisao, numero, empresa_codigo, cod_vendedor,
           snapshot, valor_total, validade_ate, pdf, pdf_sha256,
           token_publico, gerada_por
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
         RETURNING id, deal_id, revisao, numero, empresa_codigo, cod_vendedor,
                   valor_total, validade_ate, pdf_sha256,
                   octet_length(pdf) AS pdf_tamanho_bytes,
                   token_publico, gerada_por, gerada_em, enviada_via,
                   enviada_em, visualizada_em, aberturas, ultima_abertura_em;`,
        [
          dealIdStr,
          revisao,
          numero,
          empresa.codigo,
          codVendedorGravado,
          JSON.stringify(finalSnapshot),
          finalSnapshot.total,
          finalSnapshot.validade_ate,
          pdfBuffer,
          pdfSha256,
          tokenPublico,
          geradaPor
        ]
      );

      resultRow = insertRes.rows[0];

      const currentCustom = (lockRes.rows[0].custom && typeof lockRes.rows[0].custom === 'object')
        ? lockRes.rows[0].custom
        : {};
      const ultimaProposta = {
        numero,
        revisao,
        empresa_codigo: empresa.codigo,
        empresa_nome: empresa.nome_fantasia,
        valor_total: finalSnapshot.total,
        validade_ate: finalSnapshot.validade_ate,
        enviada_em: null,
        visualizada_em: null,
        aberturas: 0
      };
      const updatedCustom = {
        ...currentCustom,
        ultima_proposta: ultimaProposta
      };

      await client.query(
        `UPDATE crm_deals
         SET custom = $2::jsonb, updated_at = NOW(), updated_by = $3
         WHERE id = $1`,
        [dealIdStr, JSON.stringify(updatedCustom), geradaPor]
      );

      await client.query('COMMIT');
      lastErr = null;
      break;
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {}
      }
      lastErr = err;
      if (err && err.code === '23505' && attempt < maxAttempts) {
        continue;
      }
      rethrowAs503IfConnectionError(err);
    } finally {
      if (client) client.release();
    }
  }

  if (lastErr) rethrowAs503IfConnectionError(lastErr);

  // Pós-COMMIT (Ajuste C): atividade proposta_gerada e mudança de estágio (lead/contato -> proposta)
  try {
    await engine.criarAtividadeDeal(
      dealIdStr,
      {
        tipo: 'proposta_gerada',
        assunto: `Proposta ${resultRow.numero} gerada`,
        descricao: `Revisão R${resultRow.revisao} emitida por ${empresa.nome_fantasia} (${empresa.codigo}).`,
        status: 'concluida',
        data_concluida: new Date().toISOString(),
        custom: {
          proposta_numero: resultRow.numero,
          revisao: Number(resultRow.revisao),
          valor_total: finalSnapshot.total,
          validade_ate: finalSnapshot.validade_ate
        }
      },
      usuario,
      effectiveScope
    );
  } catch (errAtiv) {
    console.warn(`⚠️ [CRM Propostas] Aviso ao criar atividade proposta_gerada para ${resultRow.numero}:`, errAtiv.message);
  }

  try {
    const estagioAtual = String(deal.estagio || '').toLowerCase();
    if (estagioAtual === 'lead' || estagioAtual === 'contato') {
      await engine.atualizarEstagioDeal(
        dealIdStr,
        'proposta',
        usuario,
        `Proposta ${resultRow.numero} gerada`,
        '',
        effectiveScope
      );
    }
  } catch (errStage) {
    console.warn(`⚠️ [CRM Propostas] Aviso ao avançar estágio para proposta (${resultRow.numero}):`, errStage.message);
  }

  try {
    if (typeof engine.recordTelemetry === 'function') {
      await engine.recordTelemetry(
        usuario,
        'CRM_PROPOSTA_GERADA',
        `Proposta ${resultRow.numero} gerada por ${empresa.nome_fantasia} (R$ ${formatMoneyBr(finalSnapshot.total)})`,
        {
          deal_id: dealIdStr,
          cod_vendedor: resultRow.cod_vendedor,
          role: usuario?.role || effectiveScope?.role || 'vendedor',
          numero: resultRow.numero,
          revisao: Number(resultRow.revisao),
          empresa_codigo: empresa.codigo,
          valor_total: finalSnapshot.total,
          validade_ate: finalSnapshot.validade_ate,
          pdf_sha256: resultRow.pdf_sha256
        }
      );
    }
  } catch (errTel) {
    console.warn('⚠️ [CRM Propostas] Aviso ao registrar telemetria CRM_PROPOSTA_GERADA:', errTel.message);
  }

  return {
    id: String(resultRow.id),
    deal_id: String(resultRow.deal_id),
    revisao: Number(resultRow.revisao),
    numero: resultRow.numero,
    empresa_codigo: resultRow.empresa_codigo,
    empresa_nome: empresa.nome_fantasia,
    cod_vendedor: resultRow.cod_vendedor,
    valor_total: parseFloat(resultRow.valor_total) || finalSnapshot.total,
    validade_dias: finalSnapshot.validade_dias,
    validade_ate: String(resultRow.validade_ate instanceof Date ? resultRow.validade_ate.toISOString() : resultRow.validade_ate).slice(0, 10),
    pdf_sha256: resultRow.pdf_sha256,
    pdf_tamanho_bytes: Number(resultRow.pdf_tamanho_bytes) || pdfBuffer.length,
    token_publico: resultRow.token_publico,
    link_publico: `/p/${resultRow.token_publico}`,
    gerada_por: resultRow.gerada_por,
    gerada_em: resultRow.gerada_em,
    created_at: resultRow.gerada_em,
    enviada_via: Array.isArray(resultRow.enviada_via) ? resultRow.enviada_via : [],
    enviada_em: resultRow.enviada_em || null,
    visualizada_em: resultRow.visualizada_em || null,
    ultima_abertura_em: resultRow.ultima_abertura_em || null,
    aberturas: Number(resultRow.aberturas) || 0
  };
}

/**
 * Lista revisões de proposta de um deal SEM trazer a coluna BYTEA pdf (Seção 5.1)
 */
async function listarPropostas(dealId, scope = { all: true }) {
  requireDbConnected();
  const deal = await carregarDealComEscopo(dealId, scope, { exigirEdicao: false });
  const dealIdStr = String(deal.id).trim();

  const res = await runPropostasQuery(
    `SELECT id, deal_id, revisao, numero, empresa_codigo, cod_vendedor,
            valor_total, validade_ate,
            snapshot->'empresa'->>'nome_fantasia' AS empresa_nome,
            (snapshot->>'validade_dias')::int AS validade_dias,
            pdf_sha256, octet_length(pdf) AS pdf_tamanho_bytes, token_publico,
            gerada_por, gerada_em, enviada_via, enviada_em, visualizada_em,
            ultima_abertura_em, aberturas
     FROM crm_propostas
     WHERE deal_id = $1
     ORDER BY revisao DESC;`,
    [dealIdStr]
  );

  return (res?.rows || []).map(row => ({
    id: String(row.id),
    deal_id: String(row.deal_id),
    revisao: Number(row.revisao),
    numero: row.numero,
    empresa_codigo: row.empresa_codigo,
    empresa_nome: row.empresa_nome || '',
    cod_vendedor: row.cod_vendedor || '',
    valor_total: parseFloat(row.valor_total) || 0,
    validade_dias: Number(row.validade_dias) || 7,
    validade_ate: row.validade_ate ? new Date(row.validade_ate).toISOString().slice(0, 10) : null,
    pdf_sha256: row.pdf_sha256,
    pdf_tamanho_bytes: Number(row.pdf_tamanho_bytes) || 0,
    token_publico: row.token_publico,
    link_publico: `/p/${row.token_publico}`,
    gerada_por: row.gerada_por || '',
    gerada_em: row.gerada_em,
    created_at: row.gerada_em,
    enviada_via: Array.isArray(row.enviada_via) ? row.enviada_via : [],
    enviada_em: row.enviada_em || null,
    visualizada_em: row.visualizada_em || null,
    ultima_abertura_em: row.ultima_abertura_em || null,
    aberturas: Number(row.aberturas) || 0
  }));
}

/**
 * Obtém o binário PDF salvo de uma revisão específica (imutável, sem regerar)
 */
async function obterPdf(dealId, revisao, scope = { all: true }, { download = false, usuario = {} } = {}) {
  requireDbConnected();
  const deal = await carregarDealComEscopo(dealId, scope, { exigirEdicao: false });
  const dealIdStr = String(deal.id).trim();

  const revNum = Number(revisao);
  if (!Number.isInteger(revNum) || revNum < 1) {
    throw createHttpError(400, 'REVISAO_INVALIDA', 'Número de revisão inválido.');
  }

  const res = await runPropostasQuery(
    `SELECT id, deal_id, revisao, numero, empresa_codigo, cod_vendedor, snapshot, pdf, pdf_sha256, enviada_via
     FROM crm_propostas
     WHERE deal_id = $1 AND revisao = $2
     LIMIT 1;`,
    [dealIdStr, revNum]
  );

  if (!res?.rows || res.rows.length === 0) {
    throw createHttpError(404, 'PROPOSTA_NOT_FOUND', 'Revisão de proposta não encontrada.');
  }

  const row = res.rows[0];
  const snapshot = typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : (row.snapshot || {});
  const nomeFantasia = snapshot?.empresa?.nome_fantasia || `Empresa-${row.empresa_codigo}`;
  const filename = `Proposta-${row.numero}-${sanitizeFilenameSlug(nomeFantasia)}.pdf`;

  if (download) {
    await runPropostasQuery(
      `UPDATE crm_propostas
       SET enviada_via = CASE
         WHEN NOT ('download' = ANY(enviada_via)) THEN array_append(enviada_via, 'download')
         ELSE enviada_via
       END
       WHERE id = $1;`,
      [row.id]
    );
    try {
      const engine = getCrmEngine();
      if (engine && typeof engine.recordTelemetry === 'function') {
        await engine.recordTelemetry(
          usuario,
          'CRM_PROPOSTA_BAIXADA',
          `Download da proposta ${row.numero} realizado`,
          {
            deal_id: dealIdStr,
            cod_vendedor: row.cod_vendedor || deal.cod_vendedor,
            role: usuario?.role || scope?.role || 'vendedor',
            numero: row.numero,
            revisao: revNum
          }
        );
      }
    } catch {}
  }

  return {
    numero: row.numero,
    revisao: revNum,
    empresa_codigo: row.empresa_codigo,
    pdf: row.pdf,
    pdfBuffer: row.pdf,
    pdf_sha256: row.pdf_sha256,
    filename
  };
}

/**
 * Verifica e contabiliza rate limit de envio de e-mail por usuário (máx. 20/hora)
 */
function checkEmailRateLimit(username) {
  const key = String(username || 'anonimo').trim().toLowerCase();
  const now = Date.now();
  const timestamps = (emailRateMap.get(key) || []).filter(ts => (now - ts) < EMAIL_RATE_WINDOW_MS);
  if (timestamps.length >= EMAIL_RATE_MAX) {
    throw createHttpError(
      429,
      'RATE_LIMIT_EMAIL',
      'Limite de 20 envios de proposta por hora atingido. Aguarde alguns minutos.'
    );
  }
  timestamps.push(now);
  emailRateMap.set(key, timestamps);
}

/**
 * Monta texto padrão de e-mail substituindo variáveis sem mencionar valor ou desconto (Seção 5.3)
 */
function montarCorpoEmailPadrao(template, vars) {
  const base = String(template || '').trim() || (
    'Olá {contato}, segue em anexo a proposta {numero}, válida até {validade}. ' +
    'Também é possível abrir pelo link: {link}. Fico à disposição. {vendedor}'
  );

  const texto = base
    .replace(/\{cliente\}/g, vars.cliente || '')
    .replace(/\{contato\}/g, vars.contato || vars.cliente || '')
    .replace(/\{numero\}/g, vars.numero || '')
    .replace(/\{validade\}/g, vars.validade || '')
    .replace(/\{vendedor\}/g, vars.vendedor || '')
    .replace(/\{link\}/g, vars.link || '');

  if (vars.assinatura && !texto.includes(vars.assinatura)) {
    return `${texto}\n\n${vars.assinatura}`;
  }
  return texto;
}

/**
 * Envia uma revisão existente de proposta por e-mail (Seção 5.3 e Ajuste A)
 */
async function enviarPorEmail(dealId, revisao, dadosEnvio = {}, usuario = {}, scope = { all: true }) {
  requireDbConnected();
  const engine = getCrmEngine();
  const effectiveScope = scope || { all: true };
  const deal = await carregarDealComEscopo(dealId, effectiveScope, { exigirEdicao: true });
  const dealIdStr = String(deal.id).trim();

  const revNum = Number(revisao);
  if (!Number.isInteger(revNum) || revNum < 1) {
    throw createHttpError(400, 'REVISAO_INVALIDA', 'Número de revisão inválido.');
  }

  const propRes = await runPropostasQuery(
    `SELECT id, deal_id, revisao, numero, empresa_codigo, cod_vendedor,
            validade_ate, snapshot, pdf, token_publico, enviada_via, enviada_em
     FROM crm_propostas
     WHERE deal_id = $1 AND revisao = $2
     LIMIT 1;`,
    [dealIdStr, revNum]
  );

  if (!propRes?.rows || propRes.rows.length === 0) {
    throw createHttpError(404, 'PROPOSTA_NOT_FOUND', 'Revisão de proposta não encontrada.');
  }

  const prop = propRes.rows[0];
  const snapshot = typeof prop.snapshot === 'string' ? JSON.parse(prop.snapshot) : (prop.snapshot || {});
  const validadeIso = prop.validade_ate ? new Date(prop.validade_ate).toISOString().slice(0, 10) : snapshot.validade_ate;
  const hojeIso = getTodaySaoPauloIso();

  // Proposta vencida -> 409 PROPOSTA_VENCIDA ("Gere uma nova revisão")
  if (validadeIso && validadeIso < hojeIso) {
    throw createHttpError(409, 'PROPOSTA_VENCIDA', 'Gere uma nova revisão');
  }

  // Ajuste A: E-mail do vendedor via crm_vendedores.email ou fallback em users.email pelo username_portal
  const vendedor = await resolverDadosVendedorDeal(deal);
  if (!vendedor.email || !mailer.isValidEmail(vendedor.email)) {
    throw createHttpError(409, 'VENDEDOR_SEM_EMAIL', 'Cadastre seu e-mail no seu usuário do portal');
  }

  // Valida destinatários (para: 1 a 5 e-mails; cc opcional + cópia para o vendedor)
  const parseList = (str) => String(str || '')
    .split(/[,;]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const paraList = parseList(dadosEnvio.para || deal.cliente_email);
  const ccList = parseList(dadosEnvio.cc);

  if (paraList.length === 0 || paraList.length > 5 || !paraList.every(mailer.isValidEmail)) {
    throw createHttpError(400, 'DESTINATARIO_INVALIDO', 'Informe de 1 a 5 e-mails válidos no campo Para.');
  }
  if (ccList.length > 0 && !ccList.every(mailer.isValidEmail)) {
    throw createHttpError(400, 'CC_INVALIDO', 'Um ou mais e-mails em cópia (CC) são inválidos.');
  }

  // O vendedor recebe cópia (CC) além do Reply-To (Seção 5.3)
  if (!ccList.some(e => e.toLowerCase() === vendedor.email.toLowerCase())) {
    ccList.push(vendedor.email);
  }

  // Rate limit de 20 e-mails/hora por usuário
  checkEmailRateLimit(usuario?.username || effectiveScope?.username || 'sistema');

  const empresa = (await obterEmpresa(prop.empresa_codigo)) || snapshot.empresa || {};
  const nomeFantasia = empresa.nome_fantasia || snapshot?.empresa?.nome_fantasia || 'Grupo GSI';
  const baseUrl = String(process.env.PUBLIC_BASE_URL || 'https://portal.gsicofres.com.br').replace(/\/+$/, '');
  const linkPublico = `${baseUrl}/p/${prop.token_publico}`;

  const assunto = String(dadosEnvio.assunto || '').trim() ||
    `Proposta ${prop.numero} — ${nomeFantasia}`;

  const nomeVendedor = vendedor.nome || snapshot?.vendedor?.nome || deal.nome_vendedor || '';
  const fromName = [nomeVendedor, nomeFantasia].filter(Boolean).join(' · ');

  const mensagemTexto = String(dadosEnvio.mensagem || '').trim() || montarCorpoEmailPadrao(empresa.texto_email, {
    cliente: snapshot?.cliente?.nome || snapshot?.cliente?.razao_social || deal.cliente_nome || '',
    contato: snapshot?.cliente?.contato || snapshot?.cliente?.nome || deal.cliente_nome || '',
    numero: prop.numero,
    validade: formatDateBr(validadeIso),
    vendedor: nomeVendedor,
    assinatura: vendedor.assinatura || '',
    link: linkPublico
  });

  const filename = `Proposta-${prop.numero}-${sanitizeFilenameSlug(nomeFantasia)}.pdf`;
  const pdfBase64 = Buffer.from(prop.pdf).toString('base64');

  const sendFn = sendPropostaEmailStub || mailer.sendPropostaEmail;
  let mailResult;
  try {
    mailResult = await sendFn({
      to: paraList,
      cc: ccList,
      replyTo: vendedor.email,
      fromName,
      subject: assunto,
      text: mensagemTexto,
      attachment: {
        filename,
        contentBase64: pdfBase64,
        contentType: 'application/pdf'
      }
    });
  } catch (errMail) {
    throw createHttpError(502, 'EMAIL_FALHOU', `Falha ao enviar e-mail da proposta: ${errMail.message}`);
  }

  if (!mailResult || mailResult.success === false) {
    throw createHttpError(502, 'EMAIL_FALHOU', mailResult?.error || 'Falha ao enviar e-mail da proposta.');
  }

  const updRes = await runPropostasQuery(
    `UPDATE crm_propostas
     SET enviada_via = CASE
           WHEN NOT ('email' = ANY(enviada_via)) THEN array_append(enviada_via, 'email')
           ELSE enviada_via
         END,
         enviada_em = COALESCE(enviada_em, NOW())
     WHERE id = $1
     RETURNING enviada_via, enviada_em;`,
    [prop.id]
  );

  const enviadaViaFinal = Array.isArray(updRes?.rows?.[0]?.enviada_via)
    ? updRes.rows[0].enviada_via
    : ['email'];
  const enviadaEmFinal = updRes?.rows?.[0]?.enviada_em || new Date().toISOString();
  const enviadaParaStr = paraList.join(', ');

  // Atualiza custom.ultima_proposta.enviada_em no deal se esta for a última revisão
  try {
    const dealCustom = (deal.custom && typeof deal.custom === 'object') ? { ...deal.custom } : {};
    if (dealCustom.ultima_proposta && Number(dealCustom.ultima_proposta.revisao) === revNum) {
      dealCustom.ultima_proposta = {
        ...dealCustom.ultima_proposta,
        enviada_em: dealCustom.ultima_proposta.enviada_em || enviadaEmFinal
      };
      await safeQuery(
        `UPDATE crm_deals SET custom = $2::jsonb, updated_at = NOW() WHERE id = $1;`,
        [dealIdStr, JSON.stringify(dealCustom)]
      );
    }
  } catch (errUpdDeal) {
    console.warn('⚠️ [CRM Propostas] Aviso ao atualizar custom.ultima_proposta.enviada_em:', errUpdDeal.message);
  }

  try {
    await engine.criarAtividadeDeal(
      dealIdStr,
      {
        tipo: 'proposta_enviada',
        assunto: `Proposta ${prop.numero} enviada por e-mail para ${enviadaParaStr}`,
        descricao: `Assunto: ${assunto}${ccList.length > 0 ? ` | CC: ${ccList.join(', ')}` : ''}`,
        status: 'concluida',
        data_concluida: new Date().toISOString(),
        custom: {
          proposta_numero: prop.numero,
          via: 'email',
          para: paraList,
          cc: ccList
        }
      },
      usuario,
      effectiveScope
    );
  } catch (errAtiv) {
    console.warn('⚠️ [CRM Propostas] Aviso ao criar atividade proposta_enviada:', errAtiv.message);
  }

  try {
    if (typeof engine.recordTelemetry === 'function') {
      await engine.recordTelemetry(
        usuario,
        'CRM_PROPOSTA_ENVIADA',
        `Proposta ${prop.numero} enviada por e-mail`,
        {
          deal_id: dealIdStr,
          cod_vendedor: prop.cod_vendedor || deal.cod_vendedor,
          role: usuario?.role || effectiveScope?.role || 'vendedor',
          numero: prop.numero,
          revisao: revNum,
          destinatarios_mascarados: paraList.map(mailer.maskEmail),
          cc_mascarados: ccList.map(mailer.maskEmail)
        }
      );
    }
  } catch {}

  return {
    success: true,
    numero: prop.numero,
    revisao: revNum,
    enviada_via: enviadaViaFinal,
    enviada_para: enviadaParaStr,
    enviada_em: enviadaEmFinal
  };
}

/**
 * Registra abertura pelo link público /p/:token e retorna o PDF salvo (Seção 5.2)
 */
async function registrarAbertura(token, { userAgent = '', ip = '' } = {}) {
  const cleanToken = String(token || '').trim();
  if (!TOKEN_PUBLICO_REGEX.test(cleanToken)) {
    return null;
  }

  requireDbConnected();

  const res = await runPropostasQuery(
    `SELECT id, deal_id, revisao, numero, empresa_codigo, cod_vendedor, snapshot, pdf,
            enviada_via, enviada_em, visualizada_em, ultima_abertura_em, aberturas
     FROM crm_propostas
     WHERE token_publico = $1
     LIMIT 1;`,
    [cleanToken]
  );

  if (!res?.rows || res.rows.length === 0) {
    return null;
  }

  const row = res.rows[0];
  const dealIdStr = String(row.deal_id).trim();
  const snapshot = typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : (row.snapshot || {});
  const nomeFantasia = snapshot?.empresa?.nome_fantasia || `Empresa-${row.empresa_codigo}`;
  const filename = `Proposta-${row.numero}-${sanitizeFilenameSlug(nomeFantasia)}.pdf`;

  const nowMs = Date.now();
  const isBotUa = BOT_UA_REGEX.test(String(userAgent || ''));
  const enviadaEmMs = row.enviada_em ? new Date(row.enviada_em).getTime() : 0;
  const isWithinTwoMinAfterSend = enviadaEmMs > 0 && (nowMs - enviadaEmMs) >= 0 && (nowMs - enviadaEmMs) < (2 * 60 * 1000);

  const cleanIp = String(ip || '').trim() || '0.0.0.0';
  const dedupKey = `${cleanToken}:${cleanIp}`;
  const lastOpenMs = aberturaDedupMap.get(dedupKey) || 0;
  const isDuplicateWithinTenMin = lastOpenMs > 0 && (nowMs - lastOpenMs) < ABERTURA_DEDUP_WINDOW_MS;

  const shouldCount = !isBotUa && !isWithinTwoMinAfterSend && !isDuplicateWithinTenMin;

  if (shouldCount) {
    aberturaDedupMap.set(dedupKey, nowMs);

    const updRes = await runPropostasQuery(
      `UPDATE crm_propostas
       SET aberturas = aberturas + 1,
           ultima_abertura_em = NOW(),
           visualizada_em = COALESCE(visualizada_em, NOW()),
           enviada_via = CASE
             WHEN NOT ('link' = ANY(enviada_via)) THEN array_append(enviada_via, 'link')
             ELSE enviada_via
           END
       WHERE id = $1
       RETURNING aberturas, visualizada_em, ultima_abertura_em;`,
      [row.id]
    );

    const novoAberturas = Number(updRes?.rows?.[0]?.aberturas) || (Number(row.aberturas) + 1);
    const visualizadaEm = updRes?.rows?.[0]?.visualizada_em || new Date().toISOString();

    // Atualiza custom.ultima_proposta no deal
    try {
      const dealRes = await safeQuery(`SELECT custom FROM crm_deals WHERE id = $1 LIMIT 1;`, [dealIdStr]);
      const dealCustom = (dealRes?.rows?.[0]?.custom && typeof dealRes.rows[0].custom === 'object')
        ? { ...dealRes.rows[0].custom }
        : {};
      if (dealCustom.ultima_proposta && Number(dealCustom.ultima_proposta.revisao) === Number(row.revisao)) {
        dealCustom.ultima_proposta = {
          ...dealCustom.ultima_proposta,
          visualizada_em: dealCustom.ultima_proposta.visualizada_em || visualizadaEm,
          aberturas: novoAberturas
        };
        await safeQuery(
          `UPDATE crm_deals SET custom = $2::jsonb WHERE id = $1;`,
          [dealIdStr, JSON.stringify(dealCustom)]
        );
      }
    } catch (errUpd) {
      console.warn('⚠️ [CRM Propostas] Aviso ao sincronizar abertura em crm_deals.custom:', errUpd.message);
    }

    // Na primeira abertura válida (aberturas passa de 0 para 1), cria atividade proposta_visualizada
    if (Number(row.aberturas) === 0 && novoAberturas === 1) {
      try {
        const engine = getCrmEngine();
        await engine.criarAtividadeDeal(
          dealIdStr,
          {
            tipo: 'proposta_visualizada',
            assunto: `Cliente abriu a proposta ${row.numero}`,
            descricao: `Primeira visualização registrada via link público.`,
            status: 'concluida',
            data_concluida: new Date().toISOString(),
            custom: {
              proposta_numero: row.numero,
              revisao: Number(row.revisao)
            }
          },
          { username: 'sistema', name: 'Sistema', role: 'admin' },
          { all: true }
        );
      } catch (errAtiv) {
        console.warn('⚠️ [CRM Propostas] Aviso ao criar atividade proposta_visualizada:', errAtiv.message);
      }
    }

    try {
      const engine = getCrmEngine();
      if (engine && typeof engine.recordTelemetry === 'function') {
        await engine.recordTelemetry(
          { username: 'publico', name: 'Link Público', role: 'publico', ip: maskIpAddress(cleanIp) },
          'CRM_PROPOSTA_ABERTA',
          `Proposta ${row.numero} aberta pelo link público (abertura #${novoAberturas})`,
          {
            deal_id: dealIdStr,
            cod_vendedor: row.cod_vendedor || '',
            role: 'publico',
            numero: row.numero,
            revisao: Number(row.revisao),
            aberturas: novoAberturas,
            ip_mascarado: maskIpAddress(cleanIp)
          }
        );
      }
    } catch {}
  }

  return {
    numero: row.numero,
    revisao: Number(row.revisao),
    pdfBuffer: row.pdf,
    filename,
    contabilizada: shouldCount
  };
}

/**
 * Job diário idempotente: cria atividades pendentes proposta_vencendo para propostas
 * cuja última revisão vence em hoje + 2 dias (Seção 6 da spec)
 */
async function gerarLembretesValidade(hoje = getTodaySaoPauloIso()) {
  requireDbConnected();
  const engine = getCrmEngine();
  const hojeIso = /^\d{4}-\d{2}-\d{2}$/.test(String(hoje || ''))
    ? String(hoje)
    : getTodaySaoPauloIso(hoje);
  const alvoValidadeIso = addDaysIso(hojeIso, 2);

  // Busca a revisão mais nova de cada deal ativo e aberto cuja validade_ate seja exatamente hoje + 2 dias
  const res = await runPropostasQuery(
    `WITH ultimas_revisoes AS (
       SELECT DISTINCT ON (p.deal_id)
              p.id, p.deal_id, p.revisao, p.numero, p.validade_ate,
              d.titulo, d.cliente_nome, d.cod_vendedor, d.nome_vendedor, d.estagio, d.ativo
       FROM crm_propostas p
       INNER JOIN crm_deals d ON d.id = p.deal_id
       WHERE d.ativo = TRUE
         AND LOWER(COALESCE(d.estagio, '')) NOT IN ('ganho', 'perdido')
       ORDER BY p.deal_id, p.revisao DESC
     )
     SELECT *
     FROM ultimas_revisoes
     WHERE validade_ate = $1::date;`,
    [alvoValidadeIso]
  );

  const candidatos = res?.rows || [];
  let criadas = 0;

  for (const cand of candidatos) {
    const dealIdStr = String(cand.deal_id).trim();
    // Idempotência: não cria se já existe atividade proposta_vencendo com o mesmo custom.proposta_numero
    const existRes = await runPropostasQuery(
      `SELECT id FROM crm_atividades
       WHERE deal_id = $1
         AND tipo = 'proposta_vencendo'
         AND custom->>'proposta_numero' = $2
       LIMIT 1;`,
      [dealIdStr, cand.numero]
    );

    if (existRes?.rows && existRes.rows.length > 0) {
      continue;
    }

    const vend = await resolverDadosVendedorDeal({
      cod_vendedor: cand.cod_vendedor,
      nome_vendedor: cand.nome_vendedor
    });

    await engine.criarAtividadeDeal(
      dealIdStr,
      {
        tipo: 'proposta_vencendo',
        assunto: `Proposta ${cand.numero} vence em 2 dias — confirmar ou renovar`,
        descricao: `Lembrete automático de validade da proposta ${cand.numero} (${cand.cliente_nome || cand.titulo || ''}).`,
        status: 'pendente',
        prioridade: 'alta',
        data_agendada: `${hojeIso}T09:00:00-03:00`,
        responsavel_usuario: vend.username_portal || 'sistema',
        responsavel_nome: vend.nome || cand.nome_vendedor || '',
        custom: {
          proposta_numero: cand.numero,
          revisao: Number(cand.revisao),
          validade_ate: alvoValidadeIso
        }
      },
      { username: 'sistema', name: 'Job Validade Propostas', role: 'admin' },
      { all: true }
    );
    criadas++;
  }

  return {
    verificadas: candidatos.length,
    criadas
  };
}

const PROPOSTA_NOT_FOUND_HTML = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Proposta não encontrada</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:28px 36px;text-align:center}h1{margin:0 0 8px;font-size:18px;color:#f8fafc}p{margin:0;font-size:13px;color:#94a3b8}</style></head><body><div class="card"><h1>Proposta não encontrada</h1><p>O link informado é inválido ou não está mais disponível.</p></div></body></html>';

/**
 * Handler Express compartilhado da rota pública GET /p/:token (Seção 5.2)
 */
async function handleLinkPublico(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const result = await registrarAbertura(req.params.token, {
      userAgent: req.headers['user-agent'] || '',
      ip
    });
    if (!result || !result.pdfBuffer) {
      return res.status(404).type('html').send(PROPOSTA_NOT_FOUND_HTML);
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.filename}"`);
    return res.status(200).send(result.pdfBuffer);
  } catch (err) {
    return res.status(404).type('html').send(PROPOSTA_NOT_FOUND_HTML);
  }
}

/**
 * Handler Express compartilhado da rota de cron POST /api/cron/crm-propostas-vencendo (Seção 6)
 */
async function handleCronVencendo(req, res) {
  try {
    const hojeParam = req.body && req.body.hoje ? String(req.body.hoje).trim() : undefined;
    const resultado = await gerarLembretesValidade(hojeParam);
    return res.json({
      success: true,
      verificadas: resultado.verificadas,
      criadas: resultado.criadas
    });
  } catch (err) {
    if (err && err.status === 503) {
      return res.status(503).json({
        success: false,
        code: err.code || 'PROPOSTAS_INDISPONIVEIS',
        message: err.message
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar lembretes de validade de propostas do CRM.'
    });
  }
}

function limparCachesEmMemoriaParaTestes() {
  invalidarCacheEmpresas();
  emailRateMap.clear();
  aberturaDedupMap.clear();
  sendPropostaEmailStub = null;
}

module.exports = {
  BOT_UA_REGEX,
  TOKEN_PUBLICO_REGEX,
  HEX_COLOR_REGEX,
  PROPOSTA_NOT_FOUND_HTML,
  resolverCodigoEmpresa,
  formatCnpjCpf,
  formatMoneyBr,
  formatDateBr,
  getTodaySaoPauloIso,
  addDaysIso,
  maskIpAddress,
  validarLogoPathRelativo,
  sanitizeFilenameSlug,
  ensureCrmPropostasTables,
  invalidarCacheEmpresas,
  listarEmpresas,
  obterEmpresa,
  salvarEmpresa,
  resolverDadosVendedorDeal,
  montarSnapshot,
  montarDocDefinition,
  gerarPdf,
  previaProposta,
  gerarRevisao,
  listarPropostas,
  obterPdf,
  enviarPorEmail,
  registrarAbertura,
  gerarLembretesValidade,
  handleLinkPublico,
  handleCronVencendo,
  setSendPropostaEmailStub,
  limparCachesEmMemoriaParaTestes
};
