# -*- coding: utf-8 -*-
"""
scripts/converter_certificado_pfx.py
Utilitário para converter certificados PFX legados (RC2-40/3DES) para:
1. PFX Moderno com criptografia AES-256 (compatível 100% com OpenSSL 3 / Render)
2. Certificado e Chave Privada em formato PEM (sem criptografia de transporte)
3. Arquivo Base64 pronto para atualizar no Render (NFSE_CERT_GSI_PFX_BASE64)

Uso:
  python scripts/converter_certificado_pfx.py <caminho_do_pfx> <senha>
"""

import sys
import os
import base64
from cryptography.hazmat.primitives.serialization import (
    pkcs12,
    Encoding,
    PrivateFormat,
    NoEncryption,
    BestAvailableEncryption
)

def main():
    if len(sys.argv) < 3:
        print("Uso: python scripts/converter_certificado_pfx.py <caminho_do_pfx> <senha>")
        sys.exit(1)

    pfx_path = sys.argv[1]
    senha = sys.argv[2]

    if not os.path.exists(pfx_path):
        print(f"❌ Arquivo não encontrado: {pfx_path}")
        sys.exit(1)

    print("🔐 Lendo arquivo PFX...")
    with open(pfx_path, "rb") as f:
        pfx_bytes = f.read()

    try:
        private_key, certificate, additional_certs = pkcs12.load_key_and_certificates(
            pfx_bytes,
            senha.encode("utf-8")
        )
    except Exception as e:
        print(f"❌ Falha ao abrir PFX com a senha fornecida: {e}")
        sys.exit(1)

    print("✅ Certificado e chave privada decodificados com sucesso!")
    print(f"   Titular: {certificate.subject.rfc4514_string()}")
    print(f"   Validade: {certificate.not_valid_before_utc} até {certificate.not_valid_after_utc}")

    # 1. Reexporta em PFX Moderno com AES-256
    novo_pfx = pkcs12.serialize_key_and_certificates(
        name=b"GSI_CERT",
        key=private_key,
        cert=certificate,
        cas=additional_certs,
        encryption_algorithm=BestAvailableEncryption(senha.encode("utf-8"))
    )

    saida_dir = os.path.dirname(pfx_path)
    novo_pfx_path = os.path.join(saida_dir, "gsi_certificado_aes256.pfx")
    with open(novo_pfx_path, "wb") as f:
        f.write(novo_pfx)

    novo_b64 = base64.b64encode(novo_pfx).decode("ascii")
    b64_path = os.path.join(saida_dir, "NFSE_CERT_GSI_PFX_AES256_BASE64.txt")
    with open(b64_path, "w", encoding="utf-8") as f:
        f.write(novo_b64)

    # 2. Exporta Chave Privada e Certificado em PEM
    key_pem = private_key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode("utf-8")
    cert_pem = certificate.public_bytes(Encoding.PEM).decode("utf-8")

    key_path = os.path.join(saida_dir, "gsi_chave_privada.key")
    cert_path = os.path.join(saida_dir, "gsi_certificado.crt")

    with open(key_path, "w", encoding="utf-8") as f:
        f.write(key_pem)
    with open(cert_path, "w", encoding="utf-8") as f:
        f.write(cert_pem)

    print("\n🎉 CONVERSÃO CONCLUÍDA COM SUCESSO!")
    print(f"📁 Novo PFX com AES-256 (Moderno): {novo_pfx_path}")
    print(f"📁 Arquivo Base64 para o Render:   {b64_path} ({len(novo_b64)} caracteres)")
    print(f"📁 Chave Privada PEM:             {key_path}")
    print(f"📁 Certificado X.509 PEM:         {cert_path}")
    print("\n👉 Basta copiar o conteúdo de NFSE_CERT_GSI_PFX_AES256_BASE64.txt e colar na variável NFSE_CERT_GSI_PFX_BASE64 no Render!")

if __name__ == "__main__":
    main()
