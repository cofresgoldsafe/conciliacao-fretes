import sys
import json
import re
import pdfplumber

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def to_float(val_str):
    try:
        return float(str(val_str).replace('.', '').replace(',', '.'))
    except:
        return 0.0

def parse_rodonaves_pdf(pdf_path):
    cte_items = []
    fatura_header = {
        "transportadora": "RODONAVES TRANSPORTES E ENCOMENDAS LTDA",
        "cnpjTransportadora": "44.914.992/0001-38",
        "pagador": "",
        "pagadorCnpj": "",
        "empresaKey": "OACO",
        "empresaCodigo": "16",
        "numeroFatura": "",
        "dataEmissao": "",
        "dataVencimento": "",
        "valorTotal": 0.0,
        "qtdFretes": 0
    }
    
    full_text = ""
    col_map = {}

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            full_text += text + "\n"
            
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    row_clean = [str(c).strip() for c in row if c is not None and str(c).strip() != '']
                    if not row_clean:
                        continue

                    lower_cells = [c.lower() for c in row_clean]

                    # 1. Identificar Linha de Cabeçalho da Tabela
                    if any('doc origin' in c for c in lower_cells) or any('nº frete' in c or 'n° frete' in c or 'num frete' in c for c in lower_cells):
                        for idx, cell in enumerate(row_clean):
                            c_low = cell.lower()
                            if 'doc origin' in c_low or c_low == 'nf':
                                col_map['doc_orig'] = idx
                            elif 'frete' in c_low:
                                col_map['num_frete'] = idx
                            elif 'une' in c_low:
                                col_map['une'] = idx
                            elif 'emiss' in c_low and 'data' in c_low:
                                col_map['data_emissao'] = idx
                            elif 'valor cobrado' in c_low:
                                col_map['valor_cobrado'] = idx
                            elif 'valor' in c_low and 'valor_orcado' not in col_map:
                                col_map['valor_orcado'] = idx
                            elif 'cliente' in c_low:
                                col_map['cliente'] = idx
                            elif 'doc' in c_low and 'doc' not in col_map:
                                col_map['doc'] = idx
                        continue

                    # 2. Identificar Linhas de Conhecimento (CT-e)
                    if len(row_clean) >= 4 and row_clean[0].upper() == 'CT-E':
                        doc = row_clean[0]
                        num_frete = row_clean[col_map.get('num_frete', 1)] if col_map.get('num_frete', 1) < len(row_clean) else row_clean[1]

                        # Extração do Documento Originário (NF)
                        doc_orig_raw = ""
                        if 'doc_orig' in col_map and col_map['doc_orig'] < len(row_clean):
                            doc_orig_raw = row_clean[col_map['doc_orig']]
                        else:
                            # Heurística de fallback: buscar elemento com formato de NF descartando UnE, datas e valores
                            for idx in range(2, len(row_clean)):
                                cell = row_clean[idx]
                                if re.match(r'^\d{2}/\d{2}/\d{4}$', cell):
                                    continue
                                if re.match(r'^\d{1,3}(?:\.\d{3})*,\d{2}$', cell):
                                    continue
                                # Buscar NF com volume "(QTD)" ou formato com 5+ dígitos (descartando UnE de 3 dígitos)
                                if re.search(r'\b\d{5,}\b', cell) or re.search(r'\d+\s*\(\d+\)', cell) or 'NF' in cell.upper():
                                    doc_orig_raw = cell
                                    break
                            if not doc_orig_raw and len(row_clean) >= 5:
                                # Layout padrão Rodonaves: coluna 4 é Doc originário
                                doc_orig_raw = row_clean[4]

                        clean_nf_match = re.search(r'(\d+)', doc_orig_raw)
                        if clean_nf_match:
                            clean_nf = clean_nf_match.group(1).zfill(9)
                        else:
                            clean_nf = doc_orig_raw

                        orc_idx = col_map.get('valor_orcado', 5)
                        cob_idx = col_map.get('valor_cobrado', 6)
                        val_orcado = row_clean[orc_idx] if orc_idx < len(row_clean) else "0,00"
                        val_cobrado = row_clean[cob_idx] if cob_idx < len(row_clean) else val_orcado

                        cli_idx = col_map.get('cliente', 8)
                        cliente = row_clean[cli_idx] if cli_idx < len(row_clean) else (row_clean[-2] if len(row_clean) > 2 else "")

                        cte_items.append({
                            "id": len(cte_items) + 1,
                            "doc": doc,
                            "numFrete": num_frete,
                            "docOriginarioRaw": doc_orig_raw,
                            "docOriginario": clean_nf,
                            "valorOrcadoStr": val_orcado,
                            "valorOrcado": to_float(val_orcado),
                            "valorCobradoStr": val_cobrado,
                            "valorCobrado": to_float(val_cobrado),
                            "cliente": cliente,
                            "dataVencimento": "",
                            "status": "Pendente"
                        })

    # Validação Estrita de Padrão e Assinatura Rodonaves
    text_upper = full_text.upper()
    is_rodonaves = bool(re.search(r'\bRODONAVES\b', text_upper) or "44.914.992" in full_text or re.search(r'\bRTE\b', text_upper))
    
    if not is_rodonaves or len(cte_items) == 0:
        return {
            "success": False,
            "isWrongFormat": True,
            "message": "Esta tela é específica para faturas da transportadora Rodonaves. O arquivo enviado não corresponde ao padrão da Rodonaves."
        }

    # Extração Dinâmica do Pagador no PDF
    pagador_match = re.search(r'Pagador\s*[\n\r]*\s*([^\n\r]+)', full_text, re.IGNORECASE)
    if pagador_match:
        fatura_header["pagador"] = pagador_match.group(1).strip()

    # Identificação Automática da Empresa (OACO = 16, GSI = 15, METAL PLENO = 14)
    if "METAL PLENO" in text_upper:
        fatura_header["empresaKey"] = "METAL_PLENO"
        fatura_header["empresaCodigo"] = "14"
        fatura_header["pagador"] = "METAL PLENO EQUIPAMENTOS DE ACO LTDA"
        fatura_header["pagadorCnpj"] = "09.117.848/0001-08"
    elif "GSI" in text_upper or "BW EQUIPAMENTOS" in text_upper:
        fatura_header["empresaKey"] = "GSI"
        fatura_header["empresaCodigo"] = "15"
        fatura_header["pagador"] = "GSI BW EQUIPAMENTOS DE ACO COFRES E ARMARIOS LTDA"
        fatura_header["pagadorCnpj"] = "04.839.813/0001-44"
    else:
        fatura_header["empresaKey"] = "OACO"
        fatura_header["empresaCodigo"] = "16"
        fatura_header["pagador"] = "OACO PRODUTOS DE ACO LTDA"
        fatura_header["pagadorCnpj"] = "61.237.790/0001-18"

    # CNPJ Pagador dinâmico se encontrado no PDF diferente do CNPJ Rodonaves
    for cnpj in re.findall(r'(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})', full_text):
        if "44.914.992" not in cnpj:
            fatura_header["pagadorCnpj"] = cnpj
            break

    # Header parsing refinements
    fat_match = re.search(r'Fatura\s*[\n\r]+\s*(\d{8,}-\d{2})', full_text, re.IGNORECASE) or re.search(r'(\d{8,}-\d{2})', full_text)
    if fat_match:
        fatura_header["numeroFatura"] = fat_match.group(1)

    emissao_match = re.search(r'Emitida em[^\d]*(\d{2}/\d{2}/\d{4})', full_text, re.IGNORECASE) or re.search(r'(\d{2}/\d{2}/\d{4})\s*às', full_text)
    if emissao_match:
        fatura_header["dataEmissao"] = emissao_match.group(1)

    venc_match = (
        re.search(r'Data de vencimento[^\n\r]*[\n\r]+[^\n\r]*?(\d{2}/\d{2}/\d{4})', full_text, re.IGNORECASE)
        or re.search(r'Vencimento\s*[\n\r]+\s*(\d{2}/\d{2}/\d{4})', full_text, re.IGNORECASE)
        or re.search(r'Data de vencimento\s*[\n\r]*\s*(\d{2}/\d{2}/\d{4})', full_text, re.IGNORECASE)
    )
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
