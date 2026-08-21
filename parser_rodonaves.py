import sys
import json
import re
import pdfplumber

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def parse_rodonaves_pdf(pdf_path):
    cte_items = []
    fatura_header = {
        "transportadora": "RODONAVES TRANSPORTES E ENCOMENDAS LTDA",
        "cnpjTransportadora": "44.914.992/0001-38",
        "pagador": "OACO PRODUTOS DE ACO LTDA",
        "pagadorCnpj": "61.237.790/0001-18",
        "empresaKey": "OACO",
        "empresaCodigo": "16",
        "numeroFatura": "13851138-26",
        "dataEmissao": "15/07/2026",
        "dataVencimento": "31/07/2026",
        "valorTotal": 527.31,
        "qtdFretes": 0
    }
    
    with pdfplumber.open(pdf_path) as pdf:
        full_text = ""
        for page in pdf.pages:
            text = page.extract_text() or ""
            full_text += text + "\n"
            
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    row_clean = [str(c).strip() for c in row if c is not None and str(c).strip() != '']
                    
                    if len(row_clean) >= 6 and row_clean[0].upper() == 'CT-E':
                        doc = row_clean[0]
                        num_frete = row_clean[1]
                        
                        doc_orig = ""
                        for item in row_clean[2:]:
                            if re.search(r'\d{6,}', item):
                                doc_orig = item
                                break
                        
                        clean_nf_match = re.search(r'(\d+)', doc_orig)
                        if clean_nf_match:
                            clean_nf = clean_nf_match.group(1).zfill(9)
                        else:
                            clean_nf = doc_orig
                        
                        val_orcado = row_clean[5] if len(row_clean) > 5 else "0,00"
                        val_cobrado = row_clean[6] if len(row_clean) > 6 else val_orcado
                        cliente = row_clean[8] if len(row_clean) > 8 else (row_clean[-2] if len(row_clean) > 2 else "")
                        
                        def to_float(val_str):
                            try:
                                return float(val_str.replace('.', '').replace(',', '.'))
                            except:
                                return 0.0
                        
                        cte_items.append({
                            "id": len(cte_items) + 1,
                            "doc": doc,
                            "numFrete": num_frete,
                            "docOriginarioRaw": doc_orig,
                            "docOriginario": clean_nf,
                            "valorOrcadoStr": val_orcado,
                            "valorOrcado": to_float(val_orcado),
                            "valorCobradoStr": val_cobrado,
                            "valorCobrado": to_float(val_cobrado),
                            "cliente": cliente,
                            "dataVencimento": "31/07/2026",
                            "status": "Pendente"
                        })

    # Validação Estrita de Padrão e Assinatura Rodonaves
    text_upper = full_text.upper()
    is_rodonaves = ("RODONAVES" in text_upper or "44.914.992" in full_text or "RTE" in text_upper)
    
    if not is_rodonaves or len(cte_items) == 0:
        return {
            "success": False,
            "isWrongFormat": True,
            "message": "Esta tela é específica para faturas da transportadora Rodonaves. O arquivo enviado não corresponde ao padrão esperado."
        }

    # Extração Dinâmica do Pagador no PDF
    pagador_match = re.search(r'Pagador\s*[\n\r]*\s*([^\n\r]+)', full_text, re.IGNORECASE)
    if pagador_match:
        fatura_header["pagador"] = pagador_match.group(1).strip()

    cnpj_pagador_match = re.search(r'(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})', full_text)
    if cnpj_pagador_match:
        # Se for diferente do CNPJ da Rodonaves, é o CNPJ do Pagador
        found_cnpj = cnpj_pagador_match.group(1)
        if "44.914.992" not in found_cnpj:
            fatura_header["pagadorCnpj"] = found_cnpj

    # Identificação Automática da Empresa (OACO = 16, GSI = 15, METAL PLENO = 14)
    if "METAL PLENO" in text_upper:
        fatura_header["empresaKey"] = "METAL_PLENO"
        fatura_header["empresaCodigo"] = "14"
        fatura_header["pagador"] = "METAL PLENO EQUIPAMENTOS DE ACO LTDA"
    elif "GSI" in text_upper or "BW EQUIPAMENTOS" in text_upper:
        fatura_header["empresaKey"] = "GSI"
        fatura_header["empresaCodigo"] = "15"
        fatura_header["pagador"] = "GSI BW EQUIPAMENTOS DE ACO COFRES E ARMARIOS LTDA"
    else:
        fatura_header["empresaKey"] = "OACO"
        fatura_header["empresaCodigo"] = "16"

    # Header parsing refinements
    fat_match = re.search(r'(\d{8,}-\d{2})', full_text)
    if fat_match:
        fatura_header["numeroFatura"] = fat_match.group(1)

    emissao_match = re.search(r'(\d{2}/\d{2}/\d{4})\s*às', full_text)
    if emissao_match:
        fatura_header["dataEmissao"] = emissao_match.group(1)

    venc_match = re.search(r'Data de vencimento\s*[\n\r]*\s*(\d{2}/\d{2}/\d{4})', full_text, re.IGNORECASE)
    if venc_match:
        fatura_header["dataVencimento"] = venc_match.group(1)
        for item in cte_items:
            item["dataVencimento"] = fatura_header["dataVencimento"]

    fatura_header["qtdFretes"] = len(cte_items)
    fatura_header["valorTotal"] = round(sum(item["valorCobrado"] for item in cte_items), 2)

    return {
        "success": True,
        "fatura": fatura_header,
        "items": cte_items
    }

if __name__ == "__main__":
    pdf_file = sys.argv[1] if len(sys.argv) > 1 else "Exemplo_FAT_13851138-26_15072026_V1.pdf"
    try:
        res = parse_rodonaves_pdf(pdf_file)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
