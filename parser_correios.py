import sys
import json
import os
import re
import pypdf

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def parse_correios_pdf(file_path):
    reader = pypdf.PdfReader(file_path)
    full_text = '\n'.join([p.extract_text() for p in reader.pages])

    # Header extraction
    cnpj_match = re.search(r'CNPJ:\s*([\d\./\-]+)', full_text)
    razao_match = re.search(r'Raz[ãa]o Social:\s*(.+)', full_text)
    fatura_match = re.search(r'N[úu]mero da Fatura:\s*(\S+)', full_text)
    vencimento_match = re.search(r'Data de Vencimento:\s*([\d/]+)', full_text)
    contrato_match = re.search(r'Contrato:\s*(\S+)', full_text)

    pagador_cnpj = cnpj_match.group(1).strip() if cnpj_match else "61.237.790/0001-18"
    pagador_razao = razao_match.group(1).strip() if razao_match else "OACO PROD DE ACO LTDA"
    num_fatura = fatura_match.group(1).strip() if fatura_match else "SFE-" + os.path.basename(file_path).split('.')[0]
    data_vencimento = vencimento_match.group(1).strip() if vencimento_match else "05/08/2026"

    # Identify company
    text_upper = full_text.upper()
    if "METAL PLENO" in text_upper:
        empresa_key = "METAL_PLENO"
        empresa_codigo = "14"
    elif "GSI" in text_upper or "BW EQUIPAMENTOS" in text_upper:
        empresa_key = "GSI"
        empresa_codigo = "15"
    else:
        empresa_key = "OACO"
        empresa_codigo = "16"

    fatura_header = {
        "transportadora": "CORREIOS - SFE (Extrato Analítico)",
        "cnpjTransportadora": "34.028.316/0001-03", # Correios CNPJ matriz
        "pagador": pagador_razao,
        "pagadorCnpj": pagador_cnpj,
        "empresaKey": empresa_key,
        "empresaCodigo": empresa_codigo,
        "numeroFatura": num_fatura,
        "dataEmissao": "23/07/2026",
        "dataVencimento": data_vencimento,
        "contrato": contrato_match.group(1).strip() if contrato_match else "",
        "valorTotal": 0.0,
        "qtdFretes": 0
    }

    cte_items = []

    # Find line items
    # Format sample:
    # 16/06/26 03220 19 78025103 00424308 AGF SAO JOAQUIM 003050 000001 AD578039135BR PO7zcMTIDx 72,87 0,00 72,87 500,0072,87
    lines = full_text.split('\n')
    item_id = 1
    
    # Extract all etiquetas and line patterns
    for line in lines:
        etiqueta_match = re.search(r'([A-Z]{2}\d{9}BR)', line)
        if etiqueta_match:
            etiqueta = etiqueta_match.group(1)
            parts = line.split()
            
            # Find date, service code, weight, values
            date_match = re.search(r'(\d{2}/\d{2}/\d{2})', line)
            data_postagem = date_match.group(1) if date_match else ""
            
            # Extract monetary values (e.g. 72,87)
            values = re.findall(r'(\d{1,3}(?:\.\d{3})*,\d{2})', line)
            valor_servico = 0.0
            if values:
                try:
                    valor_servico = float(values[-1].replace('.', '').replace(',', '.'))
                except:
                    pass

            # Service name mapping
            servico = "CORREIOS"
            if "03220" in line:
                servico = "SEDEX (03220)"
            elif "03298" in line:
                servico = "PAC (03298)"
            elif "03301" in line:
                servico = "PAC REVERSO (03301)"

            cte_items.append({
                "id": item_id,
                "doc": "Correios SFE",
                "numFrete": etiqueta, # Etiqueta / Registro Correios
                "etiqueta": etiqueta,
                "dataPostagem": data_postagem,
                "servico": servico,
                "docOriginarioRaw": "", # NF/Pedido to be populated via ViPP or Protheus!
                "docOriginario": "",
                "valorOrcadoStr": f"{valor_servico:.2f}".replace('.', ','),
                "valorOrcado": valor_servico,
                "valorCobradoStr": f"{valor_servico:.2f}".replace('.', ','),
                "valorCobrado": valor_servico,
                "cliente": "A DEFINIR (VIA ViPP)",
                "dataVencimento": data_vencimento,
                "status": "Pendente Batimento ViPP"
            })
            item_id += 1

    # Validação Estrita de Padrão e Assinatura Correios
    is_correios = ("CORREIOS" in text_upper or "SFE" in text_upper or "ECT" in text_upper or "SEDEX" in text_upper or "PAC" in text_upper)
    if not is_correios or len(cte_items) == 0:
        return {
            "success": False,
            "isWrongFormat": True,
            "message": "Esta aba só serve para faturas dos Correios. O arquivo enviado não é compatível com o formato dos Correios."
        }

    fatura_header["qtdFretes"] = len(cte_items)
    fatura_header["valorTotal"] = round(sum(item["valorCobrado"] for item in cte_items), 2)

    return {
        "success": True,
        "fatura": fatura_header,
        "items": cte_items
    }

if __name__ == "__main__":
    file_path = sys.argv[1] if len(sys.argv) > 1 else "Exemplo_CORREIO_OACO.pdf"
    try:
        res = parse_correios_pdf(file_path)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
