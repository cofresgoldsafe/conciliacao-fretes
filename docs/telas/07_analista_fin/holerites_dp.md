# Holerites DP

> **Macro-Área:** Analista Fin  
> **Identificador DOM:** `#tab-holerites` | **Botão:** `#btnTabHolerites`  
> **Permissão RBAC:** admin, user (Analista Fin)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 18/09/2026 (v8.239 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Gestão, importação contábil de PDFs (GSI, OAÇO) e emissão manual de recibos avulsos para Pessoa Física sem registro formal (13º 1ª parcela, 13º 2ª parcela, Salário, Adiantamento, Férias, Bonificações), com layout limpo, sem logotipo corporativo e sem CNPJ, além de distribuição e impressão para assinatura física ou digital via plataformas como ZapSign.
- **Personas Atendidas:** admin, user (Analista Fin)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/holerites.js`, `public/index.html` (botão `#btnManualPfHolerite`, modais `#modalHoleritePreview`, `#modalHoleriteMensagemLote`, `#modalHoleriteManualPf`)
- **Backend / Rotas:** `server.js` (`POST /api/financeiro/holerites/manual`, `POST /api/financeiro/holerites/upload`, `GET /api/financeiro/holerites`, `GET /api/financeiro/holerites/competencias`, `GET /api/financeiro/holerites/:id`, `PATCH /api/financeiro/holerites/:id/mensagem`, `PATCH /api/financeiro/holerites/mensagem-lote`, `DELETE /api/financeiro/holerites/:id`), `postgres_db.js` (`salvarHoleritesDB`, `obterHoleritesDB`)

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase / JSON Local (`holerites_documentos`, `colaboradores_dp`)
- **Flags de Origem:** `origem_arquivo_tipo = 'MANUAL_PF'`, `empresa = 'SEM_REGISTRO'`

---

## 4. Regras de Negócio & Cálculos Chave
- **Emissão Manual PF:** Modal com tipos de documentos dinâmicos (13º 1ª Parc, 13º 2ª Parc, Salário, Adiantamento, Férias, Bonificação, Avulso). Seleção de colaborador integrado à base `colaboradores_dp` com exibição de chave Pix.
- **Layout Limpo de Recibo PF:**
  - **Zero Logotipos:** Omite logos corporativos da GSI BW e OAÇO.
  - **Zero CNPJs:** Omite qualquer informação jurídica corporativa de CNPJ.
  - **Identificação Neutra:** Cabeçalho centralizado `RECIBO DE PAGAMENTO`.
  - **Extenso Automático:** Conversão por extenso em português de inteiros e centavos.
  - **Supressão de Bases Fictícias:** Oculta tabela de bases INSS/FGTS CLT para recibos de autônomos.
  - **Canhoto de Quitação:** Texto formal de recebimento integral do valor indicado para assinatura.

---

## 5. Endpoints REST da API
- `POST /api/financeiro/holerites/manual` (Emissão manual PF)
- `POST /api/financeiro/holerites/upload` (Upload multi-arquivos PDF/XLSX)
- `GET /api/financeiro/holerites` (Listagem com filtros facetados)
- `GET /api/financeiro/holerites/competencias` (Agrupamento por mês/ano)
- `GET /api/financeiro/holerites/:id` (Detalhes do documento)
- `PATCH /api/financeiro/holerites/:id/mensagem` (Mensagem individual)
- `PATCH /api/financeiro/holerites/mensagem-lote` (Mensagem em lote)
- `DELETE /api/financeiro/holerites/:id` (Exclusão)

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_holerites_impressao.js
node test_holerite_manual_pf.js
node test_holerites_visual_signature.js
node test_holerites_api.js
node test_funcionarios_dp.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.240 (18/09/2026):** Correção crítica de impressão e geração de PDF de holerites individuais e em lote (`#modalHoleritePreview`, `#btnImprimirModalHolerite`, `#btnImprimirLoteHolerites`). Resolução do conflito de `@media print` (remoção do `body * { visibility: hidden !important; }` do DANFE que ofuscava outros modais), reset posicional absoluto e desativação de scrollbars/backgrounds no modal de pré-visualização, encaixe estrito em exatamente 1 página A4 com `.holerite-folha-a4:last-child { page-break-after: auto; }` eliminando a segunda página em branco e paginação 1:1 perfeita em lotes (4 testes aprovados em `test_holerites_impressao.js`).
- **v8.239 (18/09/2026):** Botão `📝 Manual PF` e modal `#modalHoleriteManualPf` para emissão de recibos avulsos para pessoas físicas sem registro (13º 1ª parcela, 13º 2ª parcela, Salário, Adiantamento, Férias, etc.) sem logo e sem CNPJ corporativo, com conversão de valor por extenso e integração com a base de colaboradores (4 testes aprovados em `test_holerite_manual_pf.js`).
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
