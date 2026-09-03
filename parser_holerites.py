#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
parser_holerites.py - Extrator Autônomo de Holerites e Recibos de Pagamento
Suporta:
- PDFs da Contabilidade (GSI BW e OAÇO) - Folha Mensal, Adiantamento, 13º, Férias
- Planilhas Excel (.xlsx) para colaboradores sem registro (Adriano Rovaris)
"""

import sys
import os
import io
import re
import json
import zipfile
import xml.etree.ElementTree as ET

# Força UTF-8 para stdout e stderr
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

MESES_NOMES = {
    1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril',
    5: 'Maio', 6: 'Junho', 7: 'Julho', 8: 'Agosto',
    9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro'
}

MESES_MAP = {
    'JANEIRO': 1, 'FEVEREIRO': 2, 'MARCO': 3, 'MARÇO': 3, 'ABRIL': 4,
    'MAIO': 5, 'JUNHO': 6, 'JULHO': 7, 'AGOSTO': 8,
    'SETEMBRO': 9, 'OUTUBRO': 10, 'NOVEMBRO': 11, 'DEZEMBRO': 12
}

def parse_currency(val_str):
    if not val_str:
        return 0.0
    clean = str(val_str).strip().replace('.', '').replace(',', '.')
    try:
        return float(clean)
    except:
        return 0.0

def numero_por_extenso(valor):
    """Converte valor monetário em reais para texto por extenso em português."""
    if not valor or valor <= 0:
        return "Zero reais"
    
    unidades = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
                "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
    dezenas = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
    centenas = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"]
    
    def parte_extenso(n):
        if n == 100:
            return "cem"
        c = n // 100
        d = (n % 100) // 10
        u = n % 10
        partes = []
        if c > 0:
            partes.append(centenas[c])
        du = n % 100
        if du < 20 and du > 0:
            partes.append(unidades[du])
        elif du >= 20:
            partes.append(dezenas[d])
            if u > 0:
                partes.append(unidades[u])
        return " e ".join(partes)

    inteiro = int(valor)
    centavos = int(round((valor - inteiro) * 100))

    if inteiro == 0 and centavos == 0:
        return "Zero reais"

    partes_texto = []
    
    # Milhões
    milhoes = inteiro // 1_000_000
    resto = inteiro % 1_000_000
    if milhoes > 0:
        txt_m = parte_extenso(milhoes)
        partes_texto.append(f"{txt_m} {'milhão' if milhoes == 1 else 'milhões'}")

    # Milhares
    milhares = resto // 1_000
    resto = resto % 1_000
    if milhares > 0:
        txt_k = parte_extenso(milhares)
        if milhares == 1:
            partes_texto.append("mil")
        else:
            partes_texto.append(f"{txt_k} mil")

    # Centenas/Dezenas/Unidades
    if resto > 0:
        partes_texto.append(parte_extenso(resto))

    texto_reais = " e ".join(partes_texto)
    if inteiro == 1:
        texto_reais += " real"
    elif inteiro > 1:
        texto_reais += " reais"

    if centavos > 0:
        txt_cent = parte_extenso(centavos)
        rotulo_cent = "centavo" if centavos == 1 else "centavos"
        if inteiro > 0:
            texto_reais += f" e {txt_cent} {rotulo_cent}"
        else:
            texto_reais = f"{txt_cent} {rotulo_cent}"

    return texto_reais.capitalize()

def parse_accounting_pdf(filepath):
    import pdfplumber
    filename = os.path.basename(filepath)
    results = []
    
    with pdfplumber.open(filepath) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            # Recorta a metade superior da folha (elimina duplicação da via do colaborador/empresa)
            top_half = page.crop((0, 0, page.width, page.height / 2))
            text = top_half.extract_text(layout=True)
            if not text:
                continue
            
            lines = [l for l in text.split('\n') if l.strip()]
            
            empresa = "GSI"
            razao_social = ""
            cnpj = ""
            tipo_recibo = "FOLHA_MENSAL"
            tipo_label = "Folha Mensal"
            competencia = ""
            comp_mes = 0
            comp_ano = 0
            tipo_contrato = "Mensalista"
            
            for l in lines:
                if "GSI BW" in l:
                    empresa = "GSI"
                    razao_social = "GSI BW EQUIPAMENTOS DE ACO COFRES E ARMARIOS LTDA"
                elif "OACO" in l or "OAÇO" in l:
                    empresa = "OACO"
                    razao_social = "OACO PRODUTOS DE ACO LTDA"
                
                cnpj_m = re.search(r'\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}', l)
                if cnpj_m:
                    cnpj = cnpj_m.group(0)
                
                if "Folha Mensal" in l:
                    tipo_recibo = "FOLHA_MENSAL"
                    tipo_label = "Folha Mensal"
                elif "Adiantamento" in l:
                    tipo_recibo = "ADIANTAMENTO"
                    tipo_label = "Adiantamento Salarial"
                elif "13" in l and "Parcela" in l:
                    if "1" in l or "Primeira" in l:
                        tipo_recibo = "13_PRIMEIRA_PARCELA"
                        tipo_label = "13º Salário - 1ª Parcela"
                    else:
                        tipo_recibo = "13_SEGUNDA_PARCELA"
                        tipo_label = "13º Salário - 2ª Parcela"
                elif "Férias" in l or "Ferias" in l:
                    tipo_recibo = "FERIAS"
                    tipo_label = "Recibo de Férias"
                
                comp_m = re.search(r'(Janeiro|Fevereiro|Março|Marco|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s+de\s+(\d{4})', l, re.IGNORECASE)
                if comp_m:
                    m_str = comp_m.group(1).upper()
                    ano_str = comp_m.group(2)
                    comp_mes = MESES_MAP.get(m_str, 0)
                    comp_ano = int(ano_str)
                    competencia = f"{comp_m.group(1).capitalize()} de {ano_str}"
                
                if "Mensalista" in l:
                    tipo_contrato = "Mensalista"
                elif "Horista" in l:
                    tipo_contrato = "Horista"

            # Se não achou empresa na linha, tenta inferir pelo nome do arquivo
            if not razao_social:
                fn_upper = filename.upper()
                if "GSI" in fn_upper:
                    empresa = "GSI"
                    razao_social = "GSI BW EQUIPAMENTOS DE ACO COFRES E ARMARIOS LTDA"
                elif "OACO" in fn_upper or "OAÇO" in fn_upper:
                    empresa = "OACO"
                    razao_social = "OACO PRODUTOS DE ACO LTDA"

            # Dados do Funcionário
            cod_func = ""
            nome_func = ""
            cbo = ""
            cargo = ""
            admissao = ""
            depto = "1"
            filial = "1"
            
            for i, l in enumerate(lines):
                if "Nome do Funcion" in l and "CBO" in l:
                    if i + 1 < len(lines):
                        next_l = lines[i+1].strip()
                        parts = re.split(r'\s{2,}', next_l)
                        if parts:
                            cod_m = re.match(r'^(\d+)\s+(.+)$', parts[0].strip())
                            if cod_m:
                                cod_func = cod_m.group(1)
                                nome_func = cod_m.group(2).strip()
                            else:
                                cod_func = parts[0].strip()
                                if len(parts) > 1:
                                    nome_func = parts[1].strip()
                            for p in parts:
                                if re.match(r'^\d{6}$', p.strip()):
                                    cbo = p.strip()
                    if i + 2 < len(lines):
                        line2 = lines[i+2].strip()
                        adm_m = re.search(r'Admiss[aã]o:\s*(\d{2}/\d{2}/\d{4})', line2, re.IGNORECASE)
                        if adm_m:
                            admissao = adm_m.group(1)
                        cargo_part = re.split(r'Admiss[aã]o:', line2, flags=re.IGNORECASE)[0].strip()
                        cargo = cargo_part
                    break

            # Grid de Eventos
            events = []
            events_started = False
            for l in lines:
                if "Código" in l and "Descrição" in l and "Vencimentos" in l:
                    events_started = True
                    continue
                if events_started:
                    if "Total de Vencimentos" in l or "Salário Base" in l:
                        break
                    m = re.match(r'^\s*(\d+)\s+([A-Z0-9\.\%\/\-\s]+?)\s+([\d\.\,]+)\s+([\d\.\,]+)?\s*([\d\.\,]+)?$', l)
                    if m:
                        code = m.group(1).strip()
                        desc = m.group(2).strip()
                        ref = m.group(3).strip()
                        val1 = m.group(4)
                        val2 = m.group(5)
                        venc = 0.0
                        desc_val = 0.0
                        if val2:
                            venc = parse_currency(val1)
                            desc_val = parse_currency(val2)
                        elif val1:
                            num = parse_currency(val1)
                            if any(k in desc.upper() for k in ["DESC", "INSS", "I.N.S.S", "IRRF", "FALTA", "ATRASO"]):
                                desc_val = num
                            else:
                                venc = num
                        events.append({
                            "codigo": code,
                            "descricao": desc,
                            "referencia": ref,
                            "vencimento": venc,
                            "desconto": desc_val
                        })

            # Totais e Bases
            tot_venc = 0.0
            tot_desc = 0.0
            val_liq = 0.0
            sal_base = 0.0
            inss_base = 0.0
            fgts_base = 0.0
            fgts_mes = 0.0
            irrf_base = 0.0
            faixa_irrf = 0.0
            msg_contabil = ""

            # Extração de Bases na linha correspondente
            for i, l in enumerate(lines):
                if "Salário Base" in l and "Sal. Contr. INSS" in l:
                    if i + 1 < len(lines):
                        base_vals = re.findall(r'[\d\.]+\,\d{2}', lines[i+1])
                        if len(base_vals) >= 4:
                            sal_base = parse_currency(base_vals[0])
                            inss_base = parse_currency(base_vals[1])
                            fgts_base = parse_currency(base_vals[2])
                            fgts_mes = parse_currency(base_vals[3])
                        if len(base_vals) >= 5:
                            irrf_base = parse_currency(base_vals[4])
                        if len(base_vals) >= 6:
                            faixa_irrf = parse_currency(base_vals[5])
                
                # Mensagens pontuais da contabilidade (aniversário, avisos)
                if "***" in l:
                    msg_contabil = l.strip()

            calc_venc = sum(e["vencimento"] for e in events)
            calc_desc = sum(e["desconto"] for e in events)
            tot_venc = round(calc_venc, 2)
            tot_desc = round(calc_desc, 2)
            val_liq = round(tot_venc - tot_desc, 2)

            extenso = numero_por_extenso(val_liq)

            results.append({
                "empresa": empresa,
                "empresa_razao_social": razao_social,
                "empresa_cnpj": cnpj,
                "tipo_documento": tipo_recibo,
                "tipo_documento_label": tipo_label,
                "competencia_mes": comp_mes,
                "competencia_ano": comp_ano,
                "competencia_formatada": competencia,
                "data_pagamento": "",
                "funcionario_codigo": cod_func,
                "funcionario_nome": nome_func,
                "funcionario_cpf": "",
                "funcionario_cargo": cargo,
                "funcionario_cbo": cbo,
                "funcionario_departamento": depto,
                "funcionario_filial": filial,
                "funcionario_tipo_contrato": tipo_contrato,
                "funcionario_admissao": admissao,
                "salario_base": sal_base,
                "sal_contr_inss": inss_base,
                "base_calc_fgts": fgts_base,
                "fgts_mes": fgts_mes,
                "base_calc_irrf": irrf_base,
                "faixa_irrf": faixa_irrf,
                "total_vencimentos": tot_venc,
                "total_descontos": tot_desc,
                "valor_liquido": val_liq,
                "valor_liquido_extenso": extenso,
                "eventos": events,
                "mensagem_contabilidade": msg_contabil,
                "mensagem_personalizada": "",
                "origem_arquivo_nome": filename,
                "origem_arquivo_tipo": "PDF",
                "origem_pagina": page_idx + 1,
                "status": "ATIVO"
            })

    return results

def parse_sem_registro_excel(filepath):
    filename = os.path.basename(filepath)
    
    with zipfile.ZipFile(filepath, 'r') as z:
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            ss_root = ET.fromstring(z.read('xl/sharedStrings.xml'))
            for si in ss_root.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
                t_elems = si.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                shared_strings.append(''.join([t.text or '' for t in t_elems]))
        
        sheet_root = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        rows = sheet_root.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row')
        
        row_dict = {}
        for r in rows:
            r_idx = int(r.attrib.get('r', 0))
            cells = {}
            for c in r.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
                cell_ref = c.attrib.get('r')
                col_letter = re.match(r'^([A-Z]+)', cell_ref).group(1)
                cell_type = c.attrib.get('t')
                v_elem = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                val = v_elem.text if v_elem is not None else ''
                if cell_type == 's' and val.isdigit():
                    val = shared_strings[int(val)]
                cells[col_letter] = val
            row_dict[r_idx] = cells

    empresa = "SEM_REGISTRO"
    razao_social = "OACO PRODUTOS DE ACO LTDA"
    cnpj = "61.237.790/0001-18"
    funcionario_nome = ""
    cpf = ""
    tipo_documento = "FOLHA_MENSAL"
    tipo_label = "Pagamento de Salário"
    competencia = ""
    comp_mes = 0
    comp_ano = 0
    data_documento = ""
    events = []
    val_liq = 0.0
    tot_venc = 0.0
    tot_desc = 0.0
    extenso = ""
    
    for r_idx, cells in row_dict.items():
        b = cells.get('B', '').strip()
        c = cells.get('C', '').strip()
        
        if "Pagamento Salário" in b or "Pagamento Vale" in b:
            if "Salário" in b:
                tipo_documento = "FOLHA_MENSAL"
                tipo_label = "Folha Mensal (Sem Registro)"
            else:
                tipo_documento = "ADIANTAMENTO"
                tipo_label = "Adiantamento Salarial (Sem Registro)"
            
            comp_m = re.search(r'(JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO|JANEIRO|FEVEREIRO|MARÇO|MARCO|ABRIL|MAIO|JUNHO)/(\d{4})', b, re.IGNORECASE)
            if comp_m:
                m_str = comp_m.group(1).upper()
                comp_mes = MESES_MAP.get(m_str, 0)
                comp_ano = int(comp_m.group(2))
                competencia = f"{comp_m.group(1).capitalize()} de {comp_ano}"
        
        if "EMPREGADOR:" in b:
            emp_str = b.replace("EMPREGADOR:", "").strip()
            if "OAÇO" in emp_str or "OACO" in emp_str:
                empresa = "OACO"
                razao_social = "OACO PRODUTOS DE ACO LTDA"
                cnpj = "61.237.790/0001-18"
            elif "GSI" in emp_str:
                empresa = "GSI"
                razao_social = "GSI BW EQUIPAMENTOS DE ACO COFRES E ARMARIOS LTDA"
                cnpj = "14.061.778/0001-15"
            else:
                razao_social = emp_str
        
        if "EMPREGADO:" in b:
            funcionario_nome = b.replace("EMPREGADO:", "").strip()
        
        if "CPF:" in b:
            cpf_m = re.search(r'\d{3}\.\d{3}\.\d{3}\-\d{2}', b)
            if cpf_m:
                cpf = cpf_m.group(0)
        
        # Itens de proventos e descontos (linhas entre 16 e 22)
        if 16 <= r_idx <= 22:
            if b and c:
                try:
                    num_val = float(c)
                except:
                    num_val = 0.0
                
                if "Salário a receber" in b:
                    val_liq = num_val
                elif "Vale Adiantamento (-)" in b or "(-)" in b:
                    tot_desc += num_val
                    events.append({
                        "codigo": "DESC_VALE",
                        "descricao": b.replace("(-)", "").strip(),
                        "referencia": "1,00",
                        "vencimento": 0.0,
                        "desconto": round(num_val, 2)
                    })
                elif "VALE ADIANTAMENTO" in b.upper():
                    val_liq = num_val
                    tot_venc += num_val
                    events.append({
                        "codigo": "VALE_ADIANT",
                        "descricao": b.strip(),
                        "referencia": "1,00",
                        "vencimento": round(num_val, 2),
                        "desconto": 0.0
                    })
                else:
                    tot_venc += num_val
                    ref = "1,00"
                    ref_m = re.search(r'\((.+?)\)', b)
                    if ref_m:
                        ref = ref_m.group(1)
                    events.append({
                        "codigo": "PROV_SALARIO",
                        "descricao": b.strip(),
                        "referencia": ref,
                        "vencimento": round(num_val, 2),
                        "desconto": 0.0
                    })
        
        # Recebi da OAÇO a importância de ...
        if "Recebi" in b and "importância de" in b:
            ext_m = re.search(r'import[aâ]ncia de\s+(.+?)\s+referente ao', b, re.IGNORECASE)
            if ext_m:
                extenso = ext_m.group(1).strip()
        
        if "São Paulo," in b or "Sao Paulo," in b:
            data_documento = b.strip()

    if val_liq == 0.0 and tot_venc > 0:
        val_liq = round(tot_venc - tot_desc, 2)

    if not extenso and val_liq > 0:
        extenso = numero_por_extenso(val_liq)

    return [{
        "empresa": "SEM_REGISTRO", # Vínculo sem registro
        "empresa_razao_social": razao_social,
        "empresa_cnpj": cnpj,
        "tipo_documento": tipo_documento,
        "tipo_documento_label": tipo_label,
        "competencia_mes": comp_mes,
        "competencia_ano": comp_ano,
        "competencia_formatada": competencia,
        "data_pagamento": data_documento,
        "funcionario_codigo": "SEM_REG",
        "funcionario_nome": funcionario_nome,
        "funcionario_cpf": cpf,
        "funcionario_cargo": "Prestador de Serviços / Operacional",
        "funcionario_cbo": "",
        "funcionario_departamento": "Geral",
        "funcionario_filial": "1",
        "funcionario_tipo_contrato": "Sem Registro",
        "funcionario_admissao": "",
        "salario_base": 0.0,
        "sal_contr_inss": 0.0,
        "base_calc_fgts": 0.0,
        "fgts_mes": 0.0,
        "base_calc_irrf": 0.0,
        "faixa_irrf": 0.0,
        "total_vencimentos": round(tot_venc, 2),
        "total_descontos": round(tot_desc, 2),
        "valor_liquido": round(val_liq, 2),
        "valor_liquido_extenso": extenso,
        "eventos": events,
        "mensagem_contabilidade": "",
        "mensagem_personalizada": "",
        "origem_arquivo_nome": filename,
        "origem_arquivo_tipo": "XLSX",
        "origem_pagina": 1,
        "status": "ATIVO"
    }]

def parse_file(filepath):
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")
    
    lower = filepath.lower()
    if lower.endswith('.pdf'):
        return parse_accounting_pdf(filepath)
    elif lower.endswith('.xlsx') or lower.endswith('.xls'):
        return parse_sem_registro_excel(filepath)
    else:
        raise ValueError(f"Formato não suportado: {filepath}")

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Uso: python parser_holerites.py <arquivo1> [arquivo2 ...]"}, ensure_ascii=False))
        sys.exit(1)
    
    all_results = []
    errors = []
    
    for arg_path in sys.argv[1:]:
        try:
            docs = parse_file(arg_path)
            all_results.extend(docs)
        except Exception as e:
            errors.append({"arquivo": os.path.basename(arg_path), "erro": str(e)})

    output = {
        "success": len(all_results) > 0 or len(errors) == 0,
        "total_documentos": len(all_results),
        "documentos": all_results,
        "erros": errors
    }
    
    print(json.dumps(output, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
