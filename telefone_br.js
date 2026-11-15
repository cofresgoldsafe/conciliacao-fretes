// Manter igual a Gemini-Whatsapp-Multi360/src/phone.ts

/**
 * Telefones do WhatsApp (Brasil).
 *
 * O WhatsApp identifica alguns celulares brasileiros SEM o nono dígito (ex.: 551187654321 em vez de
 * 5511987654321). Para não duplicar cliente nem perder a resposta, procuramos sempre as duas formas.
 */

/** Só dígitos, com 55 na frente quando o número veio só com DDD. Devolve null se não parecer válido. */
function normalizarTelefoneBR(input) {
  const raw = String(input || '').trim();
  const international = raw.startsWith('+'); // +1 415... não ganha 55 na frente
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  d = d.replace(/^0+/, ''); // 011..., 0xx11...
  if (!international && (d.length === 10 || d.length === 11)) d = '55' + d; // DDD + número
  if (d.startsWith('55')) {
    return d.length === 12 || d.length === 13 ? d : null;
  }
  // Outros países: aceita 8 a 15 dígitos (padrão E.164)
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** As duas formas de um celular brasileiro (com e sem o 9). O primeiro item é o próprio número. */
function variantesTelefoneBR(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return [];
  const out = [d];
  if (d.startsWith('55')) {
    const ddd = d.slice(2, 4);
    const local = d.slice(4);
    if (local.length === 9 && local.startsWith('9')) out.push('55' + ddd + local.slice(1));
    else if (local.length === 8 && /^[6-9]/.test(local)) out.push('55' + ddd + '9' + local);
  }
  return out;
}

module.exports = {
  normalizarTelefoneBR,
  variantesTelefoneBR
};
