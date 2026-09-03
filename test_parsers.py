"""
test_parsers.py

Suíte de Testes Automatizados em Pytest / Unittest para os Parsers de Logística e Frete:
1. parser_correios.py: Extração de extrato analítico Correios SFE, detecção de etiquetas e serviços (SEDEX/PAC).
2. parser_rodonaves.py: Extração de tabelas CT-e, preenchimento de zeros em NFs e validação de layout.
3. parser_tipo2.py: Processamento de arquivos CSV/TXT do ViPP com múltiplos delimitadores e mapeamento de empresas.
4. Validação de edge cases: Arquivos corrompidos, formatos incorretos, páginas vazias e caracteres especiais.
"""

import os
import json
import tempfile
import pytest
from unittest.mock import MagicMock, patch

from parser_correios import parse_correios_pdf
from parser_rodonaves import parse_rodonaves_pdf
from parser_tipo2 import parse_tipo2_file


# =========================================================================
# 1. TESTES DO PARSER CORREIOS (parser_correios.py)
# =========================================================================

class TestCorreiosParser:
    
    @patch('pypdf.PdfReader')
    def test_parse_correios_valido_oaco(self, mock_reader):
        """Valida extração completa de fatura Correios SFE para a empresa OAÇO"""
        mock_page = MagicMock()
        mock_page.extract_text.return_value = """
        CORREIOS - EXTRATO ANALÍTICO SFE
        CNPJ: 61.237.790/0001-18
        Razão Social: OACO PRODUTOS DE ACO LTDA
        Número da Fatura: SFE-998877
        Data de Vencimento: 10/08/2026
        Contrato: 9912742673

        16/06/26 03220 19 78025103 00424308 AGF SAO JOAQUIM 003050 000001 AD578039135BR PO7zcMTIDx 72,87 0,00 72,87 500,00 72,87
        17/06/26 03298 19 78025103 00424308 AGF SAO JOAQUIM 003050 000002 PB123456789BR PO7zcMTIDx 35,50 0,00 35,50 300,00 35,50
        """
        mock_reader.return_value.pages = [mock_page]

        res = parse_correios_pdf("mock_correios.pdf")

        assert res["success"] is True
        assert res["fatura"]["empresaCodigo"] == "16"
        assert res["fatura"]["empresaKey"] == "OACO"
        assert res["fatura"]["numeroFatura"] == "SFE-998877"
        assert res["fatura"]["qtdFretes"] == 2
        assert res["fatura"]["valorTotal"] == 108.37

        # Valida itens
        items = res["items"]
        assert len(items) == 2
        assert items[0]["etiqueta"] == "AD578039135BR"
        assert items[0]["servico"] == "SEDEX (03220)"
        assert items[0]["valorCobrado"] == 72.87

        assert items[1]["etiqueta"] == "PB123456789BR"
        assert items[1]["servico"] == "PAC (03298)"
        assert items[1]["valorCobrado"] == 35.50

    @patch('pypdf.PdfReader')
    def test_parse_correios_rejeita_formato_invalido(self, mock_reader):
        """Garante que documentos que não são dos Correios sejam rejeitados com isWrongFormat"""
        mock_page = MagicMock()
        mock_page.extract_text.return_value = "RELATORIO DE CONTAS A PAGAR BANCO ITAU SEM NENHUMA ETIQUETA"
        mock_reader.return_value.pages = [mock_page]

        res = parse_correios_pdf("mock_invalido.pdf")

        assert res["success"] is False
        assert res["isWrongFormat"] is True
        assert "Esta aba só serve para faturas dos Correios" in res["message"]

    @patch('pypdf.PdfReader')
    def test_parse_correios_metal_pleno(self, mock_reader):
        """Valida detecção da empresa Metal Pleno (14)"""
        mock_page = MagicMock()
        mock_page.extract_text.return_value = """
        CORREIOS SFE METAL PLENO EQUIPAMENTOS
        CNPJ: 44.914.992/0001-38
        16/06/26 03301 AD999888777BR 50,00 50,00
        """
        mock_reader.return_value.pages = [mock_page]

        res = parse_correios_pdf("mock_metal.pdf")
        assert res["success"] is True
        assert res["fatura"]["empresaCodigo"] == "14"
        assert res["fatura"]["empresaKey"] == "METAL_PLENO"
        assert res["items"][0]["servico"] == "PAC REVERSO (03301)"


# =========================================================================
# 2. TESTES DO PARSER RODONAVES (parser_rodonaves.py)
# =========================================================================

class TestRodonavesParser:

    @patch('pdfplumber.open')
    def test_parse_rodonaves_valido(self, mock_pdfplumber):
        """Valida extração de CT-e de fatura Rodonaves com tabela estruturada"""
        mock_pdf = MagicMock()
        mock_page = MagicMock()
        mock_page.extract_text.return_value = """
        RODONAVES TRANSPORTES E ENCOMENDAS LTDA
        CNPJ: 44.914.992/0001-38
        Fatura: 13851138-26
        Pagador: OACO PRODUTOS DE ACO LTDA
        """
        mock_page.extract_tables.return_value = [
            [
                ["Doc", "Num Frete", "NF", "Origem", "Destino", "Valor Orcado", "Valor Cobrado", "Peso", "Cliente"],
                ["CT-E", "123456", "NF 000085412", "SP", "RJ", "250,50", "250,50", "15kg", "CLIENTE TESTE ABC"],
                ["CT-E", "123457", "NF 85413", "SP", "MG", "180,00", "180,00", "10kg", "CLIENTE TESTE XYZ"]
            ]
        ]
        mock_pdf.pages = [mock_page]
        mock_pdfplumber.return_value.__enter__.return_value = mock_pdf

        res = parse_rodonaves_pdf("mock_rodonaves.pdf")

        assert res["success"] is True
        assert res["fatura"]["empresaCodigo"] == "16"
        assert res["fatura"]["qtdFretes"] == 2
        assert res["fatura"]["valorTotal"] == 430.50

        items = res["items"]
        assert len(items) == 2
        assert items[0]["docOriginario"] == "000085412"
        assert items[0]["valorCobrado"] == 250.50
        assert items[1]["docOriginario"] == "000085413" # Padding para 9 dígitos

    @patch('pdfplumber.open')
    def test_parse_rodonaves_rejeita_nao_rodonaves(self, mock_pdfplumber):
        """Garante rejeição de PDFs que não contêm a assinatura da Rodonaves"""
        mock_pdf = MagicMock()
        mock_page = MagicMock()
        mock_page.extract_text.return_value = "FATURA DE OUTRA TRANSPORTADORA SEM RTE"
        mock_page.extract_tables.return_value = []
        mock_pdf.pages = [mock_page]
        mock_pdfplumber.return_value.__enter__.return_value = mock_pdf

        res = parse_rodonaves_pdf("mock_outro.pdf")

        assert res["success"] is False
        assert res["isWrongFormat"] is True
        assert "Esta tela é específica para faturas da transportadora Rodonaves" in res["message"]

    @patch('pdfplumber.open')
    def test_parse_rodonaves_layout_com_une_e_volumes(self, mock_pdfplumber):
        """Valida que coluna UnE (ex: 207) não é capturada como NF e extrai Doc Originário real"""
        mock_pdf = MagicMock()
        mock_page = MagicMock()
        mock_page.extract_text.return_value = """
        RODONAVES TRANSPORTES E ENCOMENDAS LTDA
        CNPJ: 44.914.992/0001-38
        Fatura 14129230-26
        Emitida em 31/08/2026 às 21:05
        Data de vencimento
        R$ 1.517,21 R$ 0,00 R$ 0,00 R$ 1.517,21 15/09/2026
        OACO PRODUTOS DE ACO LTDA
        """
        mock_page.extract_tables.return_value = [
            [
                ["Doc", "Nº frete", "UnE", "Data emissão", "Doc originário (QTD)", "Valor R$", "Valor cobrado R$", "ICMS/ISS R$", "Cliente", "T"],
                ["CT-e", "62786020-1", "207", "19/08/2026", "000000665 (1)", "50,47", "50,47", "6,05", "JR2 COMERCIO DE VARIEDADES LTDA", "D"],
                ["CT-e", "62819205-1", "207", "20/08/2026", "000000672 (1)", "118,50", "118,50", "14,22", "METAL TRADER LTDA", "D"]
            ]
        ]
        mock_pdf.pages = [mock_page]
        mock_pdfplumber.return_value.__enter__.return_value = mock_pdf

        res = parse_rodonaves_pdf("mock_rodonaves_une.pdf")

        assert res["success"] is True
        assert res["fatura"]["numeroFatura"] == "14129230-26"
        assert res["fatura"]["dataVencimento"] == "15/09/2026"
        assert res["fatura"]["dataEmissao"] == "31/08/2026"
        assert len(res["items"]) == 2
        # Garante que NÃO extraiu '207' (UnE)
        assert res["items"][0]["docOriginario"] == "000000665"
        assert res["items"][0]["docOriginarioRaw"] == "000000665 (1)"
        assert res["items"][0]["cliente"] == "JR2 COMERCIO DE VARIEDADES LTDA"
        assert res["items"][1]["docOriginario"] == "000000672"
        assert res["items"][1]["cliente"] == "METAL TRADER LTDA"

    def test_parse_rodonaves_pdf_real_fat_15_09_26(self):
        """Valida regressão completa no arquivo real FAT RODONAVES 15 09 26.pdf"""
        pdf_path = os.path.join(os.path.dirname(__file__), "FAT RODONAVES 15 09 26.pdf")
        if not os.path.exists(pdf_path):
            pytest.skip("Arquivo FAT RODONAVES 15 09 26.pdf não encontrado no ambiente")

        res = parse_rodonaves_pdf(pdf_path)

        assert res["success"] is True
        assert res["fatura"]["empresaKey"] == "OACO"
        assert res["fatura"]["empresaCodigo"] == "16"
        assert res["fatura"]["numeroFatura"] == "14129230-26"
        assert res["fatura"]["dataVencimento"] == "15/09/2026"
        assert res["fatura"]["qtdFretes"] == 12
        assert res["fatura"]["valorTotal"] == 1517.21

        nfs = [it["docOriginario"] for it in res["items"]]
        # As 12 NFs devem ser distintas
        assert len(nfs) == 12
        assert len(set(nfs)) == 12
        # UnE 207 não pode estar presente como NF
        assert "000000207" not in nfs
        # Validação de NFs específicas
        assert res["items"][0]["docOriginario"] == "000000665"
        assert res["items"][1]["docOriginario"] == "000000672"
        assert res["items"][2]["docOriginario"] == "000000670"
        assert res["items"][3]["docOriginario"] == "000000674"
        assert res["items"][11]["docOriginario"] == "000000698"


# =========================================================================
# 3. TESTES DO PARSER TIPO 2 / VIPP (parser_tipo2.py)
# =========================================================================

class TestTipo2Parser:

    def test_parse_tipo2_csv_valido(self):
        """Valida extração de arquivo CSV/TXT do ViPP delimitado por ponto-e-vírgula"""
        content = "DOC;NF;VALOR;CLIENTE\nETQ12345;000099887;125,40;CLIENTE SAO PAULO - METAL PLENO\nETQ12346;000099888;88,60;CLIENTE RIO DE JANEIRO - METAL PLENO\n"
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False, encoding='utf-8') as tf:
            tf.write(content)
            tf_path = tf.name

        try:
            res = parse_tipo2_file(tf_path)
            assert res["success"] is True
            assert res["fatura"]["empresaCodigo"] == "14"
            assert res["fatura"]["empresaKey"] == "METAL_PLENO"
            assert res["fatura"]["qtdFretes"] == 2
            assert res["fatura"]["valorTotal"] == 214.00
            assert res["items"][0]["numFrete"] == "ETQ12345"
            assert res["items"][0]["valorCobrado"] == 125.40
            assert res["items"][1]["valorCobrado"] == 88.60
        finally:
            if os.path.exists(tf_path):
                os.remove(tf_path)

    def test_parse_tipo2_arquivo_vazio_rejeita(self):
        """Garante que arquivos vazios ou sem dados válidos retornem isWrongFormat"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as tf:
            tf.write("CABECALHO INVALIDO SEM ITENS\n")
            tf_path = tf.name

        try:
            res = parse_tipo2_file(tf_path)
            assert res["success"] is False
            assert res["isWrongFormat"] is True
            assert "não contém registros válidos" in res["message"]
        finally:
            if os.path.exists(tf_path):
                os.remove(tf_path)


if __name__ == '__main__':
    pytest.main(['-v', __file__])
