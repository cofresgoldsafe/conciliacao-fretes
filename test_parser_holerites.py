#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
test_parser_holerites.py - Suíte de Testes Automatizados para Extração de Holerites
Valida os 6 modelos de amostra (GSI BW, OAÇO e Sem Registro).
"""

import os
import sys
import glob
import json
import pytest
from parser_holerites import parse_file, parse_accounting_pdf, parse_sem_registro_excel

DOWNLOADS_DIR = r"C:\Users\Alexandre\Downloads"

def test_gsi_folha_mensal_pdf():
    path = os.path.join(DOWNLOADS_DIR, "Recibo de Pagamento 07.2026 exemplo GSI BW.pdf")
    assert os.path.exists(path), f"Arquivo não encontrado: {path}"
    
    docs = parse_file(path)
    assert len(docs) == 7, f"Esperava 7 funcionários na folha da GSI, obteve {len(docs)}"
    
    nomes = [d["funcionario_nome"] for d in docs]
    assert "ALEXANDRE RODRIGUES ARRAIS" in nomes
    assert "BEATRIZ NEGRAO ARRAIS" in nomes
    assert "DAVI DE CARVALHO AGUIAR" in nomes
    assert "FABIANE RODRIGUES ARRAIS" in nomes
    assert "LUIZ CLAUDIO FIGUEIREDO" in nomes
    assert "PAULO CESAR DE MORAES" in nomes
    assert "RUBENS DA SILVA" in nomes

    for d in docs:
        assert d["empresa"] == "GSI"
        assert d["tipo_documento"] == "FOLHA_MENSAL"
        assert d["competencia_mes"] == 7
        assert d["competencia_ano"] == 2026
        assert d["total_vencimentos"] > 0
        # Batimento matemático: Vencimentos - Descontos = Líquido
        calc_liq = round(d["total_vencimentos"] - d["total_descontos"], 2)
        assert abs(calc_liq - d["valor_liquido"]) < 0.02, f"Divergência matemática para {d['funcionario_nome']}: {calc_liq} vs {d['valor_liquido']}"
        assert len(d["eventos"]) > 0
        assert len(d["valor_liquido_extenso"]) > 0

def test_oaco_folha_mensal_pdf():
    matches = glob.glob(os.path.join(DOWNLOADS_DIR, "*Recibo de Pagamento 07.2026 exemplo OA*"))
    assert len(matches) > 0, "Arquivo de folha da OAÇO não encontrado"
    path = matches[0]
    
    docs = parse_file(path)
    assert len(docs) == 4, f"Esperava 4 funcionários na folha da OAÇO, obteve {len(docs)}"
    
    nomes = [d["funcionario_nome"] for d in docs]
    assert "ANDREA DA CONCEICAO FERREIRA" in nomes
    assert "ERICA DOS SANTOS SILVA" in nomes
    assert "WILLIAM CONCEICAO PINHEIRO" in nomes
    assert "YAN LUCAS MADUREIRA E SOUSA BELLINE CABRAL" in nomes

    for d in docs:
        assert d["empresa"] == "OACO"
        assert d["tipo_documento"] == "FOLHA_MENSAL"
        assert d["competencia_mes"] == 7
        assert d["competencia_ano"] == 2026
        calc_liq = round(d["total_vencimentos"] - d["total_descontos"], 2)
        assert abs(calc_liq - d["valor_liquido"]) < 0.02

def test_gsi_adiantamento_pdf():
    path = os.path.join(DOWNLOADS_DIR, "2026.05 adiant salario_DAV exemplo GSI BW.pdf")
    assert os.path.exists(path), f"Arquivo não encontrado: {path}"
    
    docs = parse_file(path)
    assert len(docs) == 1
    doc = docs[0]
    assert doc["empresa"] == "GSI"
    assert doc["tipo_documento"] == "ADIANTAMENTO"
    assert doc["competencia_mes"] == 5
    assert doc["competencia_ano"] == 2026
    assert doc["funcionario_nome"] == "DAVI DE CARVALHO AGUIAR"
    assert doc["valor_liquido"] == 848.00
    assert doc["total_vencimentos"] == 848.00
    assert doc["total_descontos"] == 0.0

def test_oaco_adiantamento_pdf():
    path = os.path.join(DOWNLOADS_DIR, "2026.08 adiant salario WILLIAM PINHEIRO exemplo OACO.pdf")
    assert os.path.exists(path), f"Arquivo não encontrado: {path}"
    
    docs = parse_file(path)
    assert len(docs) == 1
    doc = docs[0]
    assert doc["empresa"] == "OACO"
    assert doc["tipo_documento"] == "ADIANTAMENTO"
    assert doc["competencia_mes"] == 8
    assert doc["competencia_ano"] == 2026
    assert doc["funcionario_nome"] == "WILLIAM CONCEICAO PINHEIRO"
    assert doc["valor_liquido"] == 840.00
    assert doc["total_vencimentos"] == 840.00
    assert doc["total_descontos"] == 0.0

def test_sem_registro_salario_excel():
    path = os.path.join(DOWNLOADS_DIR, "07.2026 pagto salario ADRIANO.xlsx")
    assert os.path.exists(path), f"Arquivo não encontrado: {path}"
    
    docs = parse_file(path)
    assert len(docs) == 1
    doc = docs[0]
    assert doc["empresa"] == "SEM_REGISTRO"
    assert doc["funcionario_nome"] == "ADRIANO ROVARIS"
    assert doc["funcionario_cpf"] == "372.889.448-67"
    assert doc["tipo_documento"] == "FOLHA_MENSAL"
    assert doc["competencia_mes"] == 7
    assert doc["competencia_ano"] == 2026
    assert doc["total_vencimentos"] == 3610.18
    assert doc["total_descontos"] == 1229.60
    assert doc["valor_liquido"] == 2380.58
    assert len(doc["eventos"]) == 3

def test_sem_registro_adiantamento_excel():
    path = os.path.join(DOWNLOADS_DIR, "07.2026 vale adiant ADRIANO.xlsx")
    assert os.path.exists(path), f"Arquivo não encontrado: {path}"
    
    docs = parse_file(path)
    assert len(docs) == 1
    doc = docs[0]
    assert doc["empresa"] == "SEM_REGISTRO"
    assert doc["funcionario_nome"] == "ADRIANO ROVARIS"
    assert doc["funcionario_cpf"] == "372.889.448-67"
    assert doc["tipo_documento"] == "ADIANTAMENTO"
    assert doc["competencia_mes"] == 7
    assert doc["competencia_ano"] == 2026
    assert doc["valor_liquido"] == 1229.60
    assert doc["total_vencimentos"] == 1229.60
    assert doc["total_descontos"] == 0.0

if __name__ == '__main__':
    pytest.main(["-v", __file__])
