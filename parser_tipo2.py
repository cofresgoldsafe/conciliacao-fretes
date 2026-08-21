import sys
import json
import os
import re

def parse_tipo2_file(file_path):
    cte_items = []
    fatura_header = {
        "transportadora": "VIPP VISUALSET / CORREIOS / LOGÍSTICA TIPO 2",
        "cnpjTransportadora": "61.237.790/0001-18",
        "pagador": "OACO PRODUTOS DE ACO LTDA",
        "pagadorCnpj": "61.237.790/0001-18",
        "empresaKey": "OACO",
        "empresaCodigo": "16",
        "numeroFatura": "VIPP-" + os.path.basename(file_path).split('.')[0],
        "dataEmissao": "12/08/2026",
        "dataVencimento": "28/08/2026",
        "valorTotal": 0.0,
        "qtdFretes": 0
    }

    ext = os.path.splitext(file_path)[1].lower()
    full_text = ""

    if ext in ['.csv', '.txt']:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
            full_text = "".join(lines)
            
        for i, line in enumerate(lines):
            parts = [p.strip(' "\'\t\r\n') for p in re.split(r'[;,\t|]', line)]
            if len(parts) >= 4:
                num_frete = parts[0]
                doc_orig = parts[1] if len(parts) > 1 else ""
                val_str = parts[2] if len(parts) > 2 else "0.00"
                cliente = parts[3] if len(parts) > 3 else "CLIENTE TIPO 2"
                
                def to_float(val):
                    try:
                        return float(str(val).replace('R$', '').replace('.', '').replace(',', '.').strip())
                    except:
                        return 0.0
                
                if num_frete and num_frete.upper() != 'DOC':
                    cte_items.append({
                        "id": len(cte_items) + 1,
                        "doc": "CT-e/VIPP",
                        "numFrete": num_frete,
                        "docOriginarioRaw": doc_orig,
                        "docOriginario": doc_orig,
                        "valorOrcadoStr": val_str,
                        "valorOrcado": to_float(val_str),
                        "valorCobradoStr": val_str,
                        "valorCobrado": to_float(val_str),
                        "cliente": cliente,
                        "dataVencimento": "28/08/2026",
                        "status": "Pendente"
                    })

    # Identificação Automática da Empresa (OACO = 16, GSI = 15, METAL PLENO = 14)
    text_upper = full_text.upper()
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

    if len(cte_items) == 0:
        return {
            "success": False,
            "isWrongFormat": True,
            "message": "O arquivo CSV/TXT do ViPP não contém registros válidos de postagem ou está em formato incompatível."
        }

    fatura_header["qtdFretes"] = len(cte_items)
    fatura_header["valorTotal"] = round(sum(item["valorCobrado"] for item in cte_items), 2)

    return {
        "success": True,
        "fatura": fatura_header,
        "items": cte_items
    }

if __name__ == "__main__":
    file_path = sys.argv[1] if len(sys.argv) > 1 else "vipp-novo-visualset.txt"
    try:
        res = parse_tipo2_file(file_path)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
