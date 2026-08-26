#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
serasa_pdf_parser.py
Parser determinístico e de alta fidelidade para relatórios Serasa Experian (PDF).
Compatível com Relatório Básico (moderno) e Serasa Score 2.0 (legado).
Executado em memória via buffer sem gravar arquivos no disco.
"""

import sys
import os
import io
import json
import re
import datetime
import pypdf

# Força codificação UTF-8 na saída
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

def parse_serasa_pdf(pdf_stream, ref_date=None):
    """
    Lê o PDF a partir de um stream/buffer de bytes e extrai todos os dados estruturados.
    Valida:
    1. Se é um relatório oficial Serasa Experian.
    2. Se a data de emissão tem no máximo 4 meses de idade (120 dias).
    """
    if ref_date is None:
        ref_date = datetime.datetime.now()
    
    try:
        reader = pypdf.PdfReader(pdf_stream)
    except Exception as e:
        return {
            "success": False,
            "error_type": "PDF_CORROMPIDO",
            "error": f"Não foi possível abrir o arquivo PDF: {str(e)}"
        }
    
    if len(reader.pages) == 0:
        return {
            "success": False,
            "error_type": "PDF_VAZIO",
            "error": "O arquivo PDF está vazio."
        }
    
    full_text = "\n".join([page.extract_text() or "" for page in reader.pages])
    
    # 1. Validação de Modelo Serasa Oficial
    p0_text = (reader.pages[0].extract_text() or "")
    
    is_modern = bool(re.search(r'RELATÓRIO\s+BÁSICO\s*\n\s*CNPJ:\s*\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\|', p0_text) or 
                     (re.search(r'RELATÓRIO\s+BÁSICO', p0_text) and re.search(r'CNPJ:\s*\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\|', full_text)))
    is_legacy = bool(re.search(r'Serasa\s+Relatório\s+BásicoResultado\s+da\s+Consulta|sitenet\.serasa\.com\.br', p0_text))
    is_study_or_manual = bool(re.search(r'RÉGUA DE CRÉDITO|HONESTIDADE METODOLÓGICA|ANÁLISE DE 5 CONSULTAS', full_text, re.IGNORECASE))
    
    if (not is_modern and not is_legacy) or is_study_or_manual:
        return {
            "success": False,
            "error_type": "MODELO_INVALIDO",
            "error": "O arquivo selecionado NÃO é um Relatório Oficial Serasa Experian (Relatório Básico). Por favor, selecione o PDF correto do Serasa."
        }
    
    # 2. Extração da Data de Emissão do Laudo
    # Padrões: '04/08/2026 13:12:59' ou '16/08/2024 12:20' ou '16 de Agosto de 2024 12:20:54'
    data_emissao = None
    data_emissao_str = ""
    
    date_match = re.search(r'(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)', full_text)
    if date_match:
        data_emissao_str = f"{date_match.group(1)} {date_match.group(2)}"
        try:
            data_emissao = datetime.datetime.strptime(date_match.group(1), "%d/%m/%Y")
        except Exception:
            pass
    else:
        date_text_match = re.search(r'(\d{1,2})\s+de\s+([a-zA-ZçÇ]+)\s+de\s+(\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)', full_text)
        if date_text_match:
            meses = {
                'janeiro': 1, 'fevereiro': 2, 'março': 3, 'marco': 3,
                'abril': 4, 'maio': 5, 'junho': 6, 'julho': 7,
                'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
            }
            mes_num = meses.get(date_text_match.group(2).lower(), 1)
            dia = int(date_text_match.group(1))
            ano = int(date_text_match.group(3))
            hora = date_text_match.group(4)
            data_emissao_str = f"{dia:02d}/{mes_num:02d}/{ano} {hora}"
            try:
                data_emissao = datetime.datetime(ano, mes_num, dia)
            except Exception:
                pass
    
    if not data_emissao:
        return {
            "success": False,
            "error_type": "DATA_NAO_ENCONTRADA",
            "error": "Não foi possível identificar a data de emissão no cabeçalho do relatório Serasa."
        }
    
    # Validação da Idade Máxima de 4 Meses (120 dias)
    idade_dias = (ref_date - data_emissao).days
    idade_meses = round(idade_dias / 30.44, 1)
    
    if idade_dias < -2: # Margem para pequenos desvios de fuso horário futuro
        return {
            "success": False,
            "error_type": "DATA_FUTURA",
            "error": f"A data do laudo Serasa ({data_emissao_str}) está no futuro. Verifique a autenticidade do arquivo."
        }
    
    if idade_meses > 4.0:
        return {
            "success": False,
            "error_type": "LAUDO_EXPIRADO",
            "idade_dias": idade_dias,
            "idade_meses": idade_meses,
            "data_emissao": data_emissao_str,
            "error": f"Relatório Serasa EXPIRADO: emitido em {data_emissao_str} ({idade_meses} meses atrás). O sistema exige laudo emitido há no máximo 4 meses."
        }

    # 3. CNPJ e Razão Social do Documento
    cnpj = ""
    cnpj_match = re.search(r'CNPJ:\s*(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})', full_text)
    if not cnpj_match:
        cnpj_match = re.search(r'(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})', full_text)
    if cnpj_match:
        cnpj = cnpj_match.group(1)
        
    razao_social = ""
    razao_match = re.search(r'CNPJ:\s*\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\|([^\n\r]+)', full_text)
    if not razao_match:
        razao_match = re.search(r'Resumo da consulta.*?CNPJ\s+RAZÃO SOCIAL.*?\n\s*\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\s+([A-Z0-9\s\.\-\/]+?)(?:\s+\d{2}/\d{2}/\d{4})', full_text, re.DOTALL)
    if razao_match:
        razao_social = razao_match.group(1).strip()
        
    # Situação na Receita Federal
    situacao_rf = "ATIVA"
    rf_match = re.search(r'Situação na Receita Federal\s*([A-Z]+)|Situação do CPF/CNPJ.*?:\s*([A-Z]+)', full_text)
    if rf_match:
        situacao_rf = (rf_match.group(1) or rf_match.group(2) or "ATIVA").strip()
        
    # Data de Fundação no Serasa
    fundacao = ""
    fund_match = re.search(r'Fundação em\s*(\d{2}/\d{2}/\d{4})|DATA FUNDAÇÃO.*?\n.*?\s+(\d{2}/\d{2}/\d{4})', full_text, re.DOTALL)
    if fund_match:
        fundacao = (fund_match.group(1) or fund_match.group(2) or "").strip()
        
    # Endereço Cadastral no Serasa
    endereco_serasa = ""
    end_match = re.search(r'Endereço:\s*([^\n\r]+)', full_text)
    if end_match:
        endereco_serasa = end_match.group(1).strip()

    # 4. Score Serasa e Probabilidade de Inadimplência
    score_num = None
    score_texto = ""
    is_default = False
    
    if "DEFAULT" in full_text or "Múltiplos Eventos" in full_text or "MÚLTIPLOS EVENTOS" in full_text:
        is_default = True
        score_texto = "DEFAULT / Múltiplos Eventos"
    else:
        score_match = re.search(r'(?:Situação na Receita Federal\s*[A-Z]+\s*|Sócios e Administradores\s*)(\d{3})\b', full_text)
        if not score_match:
            score_match = re.search(r'\b(\d{3})\s+Risco\b', full_text)
        if not score_match:
            score_match = re.search(r'faixa de\s*(\d{3})\s*a\s*\d{3}', full_text)
        if score_match:
            score_num = int(score_match.group(1))
            score_texto = str(score_num)
            
    # Probabilidade de Inadimplência (PD %)
    pd_num = None
    pd_texto = ""
    pd_match = re.search(r'(\d+[,\.]\d+)\s*%\s*Probabilidade de [iI]nadimplência|Probabilidade de\s*Inadimplência\s*(\d+[,\.]\d+)\s*%', full_text)
    if pd_match:
        pd_raw = (pd_match.group(1) or pd_match.group(2) or "").replace(',', '.')
        try:
            pd_num = float(pd_raw)
            pd_texto = f"{pd_num:.2f}%"
        except Exception:
            pd_texto = f"{pd_raw}%"
    elif is_default:
        pd_texto = "DEFAULT (> 90%)"
        pd_num = 99.0

    # Classificação de Risco Serasa
    classificacao_risco = "Médio"
    if "Risco muito baixo" in full_text or "risco muito baixo" in full_text:
        classificacao_risco = "Muito Baixo"
    elif "Risco baixo" in full_text or "risco baixo" in full_text:
        classificacao_risco = "Baixo"
    elif "médio risco" in full_text or "Risco de Crédito Médio" in full_text:
        classificacao_risco = "Médio"
    elif "alto risco" in full_text or is_default:
        classificacao_risco = "Alto / Default"

    # 5. Anotações Negativas: PEFIN, REFIN, Dívidas Vencidas, Protestos, Cheques
    def parse_section(name_pattern, legacy_pattern):
        # Ex: PEFIN\ue88e1 registro755,03 ou PEFIN\ue88eSem registros
        pat = rf'(?:{name_pattern})\s*[\ue88e\s]*(?:(\d+)\s*registro[s]?\s*([\d\.,]+)|(Sem registros))'
        m = re.search(pat, full_text, re.IGNORECASE)
        if m:
            if m.group(3) or not m.group(1):
                return 0, 0.0
            cnt = int(m.group(1))
            val = float(m.group(2).replace('.', '').replace(',', '.'))
            return cnt, val
        # Legado
        if legacy_pattern and re.search(legacy_pattern, full_text, re.IGNORECASE):
            if "NAO CONSTAM" in full_text:
                return 0, 0.0
        return 0, 0.0

    pefin_cnt, pefin_val = parse_section(r'PEFIN|Dívidas comerciais\s*-\s*Pefin', r'Pendências Financeiras NAO CONSTAM')
    refin_cnt, refin_val = parse_section(r'REFIN|Dívidas bancárias\s*-\s*Refin', r'Pendências Internas NAO CONSTAM')
    div_venc_cnt, div_venc_val = parse_section(r'Dívidas vencidas', None)
    prot_cnt, prot_val = parse_section(r'Protestos|Dívidas Protestadas', r'Protesto Nacional NAO CONSTAM')
    chq_cnt, chq_val = parse_section(r'Cheque[s]?', r'Cheques Sem Fundo BACEN NAO CONSTAM')

    # Total de Dívidas
    total_dividas_val = 0.0
    tot_m = re.search(r'Total de dívidas:\s*R\$\s*([\d\.,]+)', full_text)
    if tot_m:
        total_dividas_val = float(tot_m.group(1).replace('.', '').replace(',', '.'))
    else:
        total_dividas_val = pefin_val + refin_val + div_venc_val + prot_val + chq_val

    # Documentos Roubados/Furtados/Extraviados
    doc_extraviado = False
    if "Documentos Roubados, Furtados ou Extraviados" in full_text:
        if "CONSTAM OCORRENCIAS" in full_text and "NAO CONSTAM OCORRENCIAS" not in full_text:
            doc_extraviado = True

    # 6. Quadro Societário: Sócios com anotação
    socios_anotacao = False
    soc_sim = re.search(r'(?:Sócio|Acionista|Administrador|Capital).*?\bSim\b', full_text, re.IGNORECASE)
    if soc_sim:
        socios_anotacao = True

    # 7. Consultas Recentes à Serasa (Janela, Contagem, Densidade e Perfil)
    consultas_cnt = 0
    consultas_dias = 0
    densidade_dia = 0.0
    consultantes_fomento = False
    consultantes_lista = []

    # Extrai linhas de consultas com datas: '28/07/2026 BANCO PAN S.A. 59.285.411/0001-13 1'
    consultas_dates = re.findall(r'(\d{2}/\d{2}/\d{4})\s+([A-Z0-9\.\-\s\/&,]+?)\s+(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})\s+(\d+)', full_text)
    if consultas_dates:
        consultas_cnt = sum([int(x[3]) for x in consultas_dates])
        dates_parsed = []
        for dt_s, name, cnpjj, q in consultas_dates:
            try:
                dates_parsed.append(datetime.datetime.strptime(dt_s, "%d/%m/%Y"))
            except Exception:
                pass
            consultantes_lista.append({
                "data": dt_s,
                "nome": name.strip(),
                "cnpj": cnpjj.strip(),
                "qtd": int(q)
            })
            if any(term in name.upper() for term in ['FOMENTO', 'SECURITIZADORA', 'FACTORING', 'FINANCAS', 'CONSULTORIA', 'S.R.M.', 'KANASTRA', 'CREDITO E INVESTIMENTO']):
                consultantes_fomento = True
        
        if dates_parsed:
            min_d = min(dates_parsed)
            max_d = max(dates_parsed)
            delta_days = (max_d - min_d).days + 1
            consultas_dias = delta_days
            densidade_dia = round(consultas_cnt / max(1, delta_days), 2)
    else:
        # Formato 2.0 por faixas (Optimus)
        opt_cons = re.search(r'até 15 dias\s*:\s*(\d+)\s*16-30 dias\s*:\s*(\d+)\s*31-60 dias\s*:\s*(\d+)\s*61-90 dias\s*:\s*(\d+)', full_text)
        if opt_cons:
            c15, c30, c60, c90 = [int(opt_cons.group(i)) for i in range(1, 5)]
            consultas_cnt = c15 + c30 + c60 + c90
            consultas_dias = 60 if consultas_cnt > 0 else 1
            densidade_dia = round(consultas_cnt / consultas_dias, 2)

    return {
        "success": True,
        "validado": True,
        "data_emissao": data_emissao_str,
        "idade_dias": idade_dias,
        "idade_meses": idade_meses,
        "cnpj": cnpj,
        "razao_social": razao_social,
        "situacao_rf": situacao_rf,
        "fundacao": fundacao,
        "endereco_serasa": endereco_serasa,
        "score_serasa": score_num,
        "score_serasa_texto": score_texto,
        "is_default": is_default,
        "probabilidade_inadimplencia_num": pd_num,
        "probabilidade_inadimplencia_texto": pd_texto,
        "classificacao_risco": classificacao_risco,
        "pefin_qtd": pefin_cnt,
        "pefin_valor": pefin_val,
        "pefin_tem": "S" if pefin_cnt > 0 else "N",
        "refin_qtd": refin_cnt,
        "refin_valor": refin_val,
        "refin_tem": "S" if refin_cnt > 0 else "N",
        "dividas_vencidas_qtd": div_venc_cnt,
        "dividas_vencidas_valor": div_venc_val,
        "dividas_vencidas_tem": "S" if div_venc_cnt > 0 else "N",
        "protestos_qtd": prot_cnt,
        "protestos_valor": prot_val,
        "protestos_tem": "S" if prot_cnt > 0 else "N",
        "cheques_qtd": chq_cnt,
        "cheques_valor": chq_val,
        "cheques_tem": "S" if chq_cnt > 0 else "N",
        "total_dividas_valor": total_dividas_val,
        "documentos_extraviados": "S" if doc_extraviado else "N",
        "socios_anotacao": "S" if socios_anotacao else "N",
        "consultas_total": consultas_cnt,
        "consultas_janela_dias": consultas_dias,
        "consultas_densidade_dia": densidade_dia,
        "consultantes_fomento": "S" if consultantes_fomento else "N",
        "consultantes_lista": consultantes_lista[:5]
    }

def main():
    ref_date = datetime.datetime.now()
    if len(sys.argv) > 1 and sys.argv[1] != "-":
        filepath = sys.argv[1]
        if not os.path.exists(filepath):
            print(json.dumps({"success": False, "error": f"Arquivo não encontrado: {filepath}"}, ensure_ascii=False))
            sys.exit(1)
        with open(filepath, "rb") as f:
            res = parse_serasa_pdf(f, ref_date=ref_date)
    else:
        input_data = sys.stdin.buffer.read()
        res = parse_serasa_pdf(io.BytesIO(input_data), ref_date=ref_date)
        
    print(json.dumps(res, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
