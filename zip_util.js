/**
 * zip_util.js — Gerador de arquivos ZIP nativo em Node.js (Zero Dependências)
 * Em conformidade com o padrão PKZIP e codificação UTF-8
 */

const zlib = require('zlib');

// Tabela de Lookup CRC32 pré-calculada (Polinômio standard IEEE 802.3)
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function calcularCrc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  }
  return ((crc ^ -1) >>> 0);
}

/**
 * Cria um buffer ZIP com os arquivos fornecidos
 * @param {Array<{name: string, content: string|Buffer}>} arquivos 
 * @returns {Buffer} Buffer binário do arquivo .zip
 */
function criarZipBuffer(arquivos = []) {
  const localHeaders = [];
  const centralDirs = [];
  let offset = 0;

  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

  for (const arq of arquivos) {
    const nomeLimpo = (arq.name || 'arquivo.txt').replace(/\\/g, '/');
    const nomeBuf = Buffer.from(nomeLimpo, 'utf8');
    const rawBuf = Buffer.isBuffer(arq.content) ? arq.content : Buffer.from(arq.content || '', 'utf8');
    const crc = calcularCrc32(rawBuf);
    const compressed = zlib.deflateRawSync(rawBuf);

    // 1. Local File Header (30 bytes + nome + dados comprimidos)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Assinatura Local Header
    localHeader.writeUInt16LE(20, 4);         // Versão mínima (2.0)
    localHeader.writeUInt16LE(0x0800, 6);     // Flags (bit 11 = UTF-8)
    localHeader.writeUInt16LE(8, 8);          // Método de Compressão (8 = Deflate)
    localHeader.writeUInt16LE(dosTime, 10);   // Hora DOS
    localHeader.writeUInt16LE(dosDate, 12);   // Data DOS
    localHeader.writeUInt32LE(crc, 14);       // CRC-32
    localHeader.writeUInt32LE(compressed.length, 18); // Tamanho comprimido
    localHeader.writeUInt32LE(rawBuf.length, 22);     // Tamanho descomprimido
    localHeader.writeUInt16LE(nomeBuf.length, 26);   // Tamanho do nome do arquivo
    localHeader.writeUInt16LE(0, 28);                 // Tamanho do campo extra

    const localChunk = Buffer.concat([localHeader, nomeBuf, compressed]);
    localHeaders.push(localChunk);

    // 2. Central Directory Header (46 bytes + nome)
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);   // Assinatura Central Directory
    cdHeader.writeUInt16LE(20, 4);           // Versão criada por
    cdHeader.writeUInt16LE(20, 6);           // Versão necessária
    cdHeader.writeUInt16LE(0x0800, 8);       // Flags (bit 11 = UTF-8)
    cdHeader.writeUInt16LE(8, 10);           // Deflate
    cdHeader.writeUInt16LE(dosTime, 12);
    cdHeader.writeUInt16LE(dosDate, 14);
    cdHeader.writeUInt32LE(crc, 16);
    cdHeader.writeUInt32LE(compressed.length, 20);
    cdHeader.writeUInt32LE(rawBuf.length, 24);
    cdHeader.writeUInt16LE(nomeBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30);           // Campo extra
    cdHeader.writeUInt16LE(0, 32);           // Comentário
    cdHeader.writeUInt16LE(0, 34);           // Disco inicial
    cdHeader.writeUInt16LE(0, 36);           // Atributos internos
    cdHeader.writeUInt32LE(0, 38);           // Atributos externos
    cdHeader.writeUInt32LE(offset, 42);      // Offset do Local Header

    centralDirs.push(Buffer.concat([cdHeader, nomeBuf]));
    offset += localChunk.length;
  }

  const localBuffer = Buffer.concat(localHeaders);
  const cdBuffer = Buffer.concat(centralDirs);

  // 3. End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);         // Assinatura EOCD
  eocd.writeUInt16LE(0, 4);                  // Número do disco
  eocd.writeUInt16LE(0, 6);                  // Disco com início do CD
  eocd.writeUInt16LE(arquivos.length, 8);    // Entradas no disco
  eocd.writeUInt16LE(arquivos.length, 10);   // Total de entradas
  eocd.writeUInt32LE(cdBuffer.length, 12);   // Tamanho do CD
  eocd.writeUInt32LE(localBuffer.length, 16);// Offset do início do CD
  eocd.writeUInt16LE(0, 20);                 // Tamanho do comentário

  return Buffer.concat([localBuffer, cdBuffer, eocd]);
}

module.exports = {
  calcularCrc32,
  criarZipBuffer
};
