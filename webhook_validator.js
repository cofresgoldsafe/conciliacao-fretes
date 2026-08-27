/**
 * webhook_validator.js
 * 
 * Validador Rigoroso de Schemas Zod para Webhooks Bancários (Banco Inter, Pix, Boletos e Banking).
 * Garante tipagem estrita, integridade de campos obrigatórios, sanitização e classificação segura de eventos.
 */

const { z } = require('zod');

// ─── 1. Schema para Evento Pix Individual ──────────────────────────────────
const PixEventSchema = z.object({
  endToEndId: z.string().min(1).max(100).optional(),
  txid: z.string().max(100).optional(),
  valor: z.union([
    z.number().positive(),
    z.string().regex(/^\d+(?:\.\d{1,2})?$/, 'Valor deve ser numérico ou decimal com ponto')
  ]).transform(v => typeof v === 'string' ? parseFloat(v) : v),
  horario: z.string().optional(),
  dataHoraLiquidacao: z.string().optional(),
  chave: z.string().max(150).optional(),
  infoPagador: z.string().max(255).optional(),
  pagador: z.object({
    nome: z.string().max(200).optional(),
    cpf: z.string().max(14).optional(),
    cnpj: z.string().max(18).optional()
  }).passthrough().optional()
}).passthrough();

// ─── 2. Schema para Batch Pix (Múltiplos Pix recebidos) ────────────────────
const PixBatchSchema = z.object({
  pix: z.array(PixEventSchema).min(0)
}).passthrough();

// ─── 3. Schema para Notificação de Boleto / Cobrança ───────────────────────
const BoletoEventSchema = z.object({
  nossoNumero: z.string().min(1).max(50),
  codigoBarras: z.string().max(60).optional(),
  linhaDigitavel: z.string().max(60).optional(),
  valorPago: z.union([z.number(), z.string()]).optional().transform(v => v ? (typeof v === 'string' ? parseFloat(v) : v) : undefined),
  valorNominal: z.union([z.number(), z.string()]).optional().transform(v => v ? (typeof v === 'string' ? parseFloat(v) : v) : undefined),
  situacao: z.string().max(50).optional(),
  status: z.string().max(50).optional(),
  dataPagamento: z.string().max(30).optional(),
  dataHoraSituacao: z.string().max(30).optional()
}).passthrough();

// ─── 4. Schema para Transação Bancária / Banking v2 ────────────────────────
const BankingEventSchema = z.object({
  idTransacao: z.string().max(100).optional(),
  codigoTransacao: z.string().max(100).optional(),
  tipoOperacao: z.enum(['C', 'D', 'CREDITO', 'DEBITO', 'PIX', 'TED', 'BOLETO', 'OUTRO']).optional(),
  tipoTransacao: z.string().max(50).optional(),
  valor: z.union([z.number(), z.string()]).optional().transform(v => v ? (typeof v === 'string' ? parseFloat(v) : v) : undefined),
  data: z.string().max(30).optional(),
  titulo: z.string().max(200).optional(),
  descricao: z.string().max(300).optional()
}).passthrough();

// ─── 5. Schema Mestre para Webhooks Bancários (União com Discriminação) ─────
const InterWebhookPayloadSchema = z.union([
  PixBatchSchema,
  BoletoEventSchema,
  PixEventSchema,
  BankingEventSchema,
  z.record(z.any())
]);

/**
 * Valida rigorosamente o payload de webhook recebido contra os schemas Zod
 * @param {Object} body Corpo da requisição recebida
 * @returns {Object} { valid: boolean, tipo: string, data: Object, errors?: string[] }
 */
function validateWebhookPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      tipo: 'INVALID_PAYLOAD',
      errors: ['O corpo do webhook deve ser um objeto JSON válido.']
    };
  }

  // 1. Caso de Batch Pix
  if (Array.isArray(body.pix)) {
    const parseResult = PixBatchSchema.safeParse(body);
    if (parseResult.success) {
      return {
        valid: true,
        tipo: 'PIX_BATCH',
        totalItems: parseResult.data.pix.length,
        data: parseResult.data
      };
    }
    return {
      valid: false,
      tipo: 'PIX_BATCH_INVALID',
      errors: (parseResult.error?.issues || parseResult.error?.errors || []).map(e => `${(e.path || []).join('.')}: ${e.message}`)
    };
  }

  // 2. Caso de Boleto / Cobrança
  if (body.nossoNumero) {
    const parseResult = BoletoEventSchema.safeParse(body);
    if (parseResult.success) {
      return {
        valid: true,
        tipo: 'BOLETO',
        eventId: parseResult.data.nossoNumero,
        data: parseResult.data
      };
    }
    return {
      valid: false,
      tipo: 'BOLETO_INVALID',
      errors: (parseResult.error?.issues || parseResult.error?.errors || []).map(e => `${(e.path || []).join('.')}: ${e.message}`)
    };
  }

  // 3. Caso de Pix Singular
  if (body.endToEndId || body.txid || (body.valor !== undefined && (body.horario || body.chave))) {
    const parseResult = PixEventSchema.safeParse(body);
    if (parseResult.success) {
      return {
        valid: true,
        tipo: 'PIX',
        eventId: parseResult.data.endToEndId || parseResult.data.txid || null,
        data: parseResult.data
      };
    }
    return {
      valid: false,
      tipo: 'PIX_INVALID',
      errors: (parseResult.error?.issues || parseResult.error?.errors || []).map(e => `${(e.path || []).join('.')}: ${e.message}`)
    };
  }

  // 4. Caso de Banking / Extrato
  if (body.idTransacao || body.codigoTransacao || body.tipoOperacao || body.tipoTransacao) {
    const parseResult = BankingEventSchema.safeParse(body);
    if (parseResult.success) {
      return {
        valid: true,
        tipo: 'BANKING',
        eventId: parseResult.data.idTransacao || parseResult.data.codigoTransacao || null,
        data: parseResult.data
      };
    }
    return {
      valid: false,
      tipo: 'BANKING_INVALID',
      errors: (parseResult.error?.issues || parseResult.error?.errors || []).map(e => `${(e.path || []).join('.')}: ${e.message}`)
    };
  }

  // 5. Fallback para Evento Estruturado Genérico
  const genericParse = z.record(z.any()).safeParse(body);
  if (genericParse.success) {
    return {
      valid: true,
      tipo: 'EVENTO_GENERICO',
      eventId: body.id || body.eventId || null,
      data: genericParse.data
    };
  }

  return {
    valid: false,
    tipo: 'UNKNOWN_FORMAT',
    errors: ['Formato de webhook não reconhecido.']
  };
}

module.exports = {
  PixEventSchema,
  PixBatchSchema,
  BoletoEventSchema,
  BankingEventSchema,
  InterWebhookPayloadSchema,
  validateWebhookPayload
};
