# Consulta Pedidos de Venda

> **Macro-Área:** Vendedores  
> **Identificador DOM:** `#tab-vend-pedidos` | **Botão:** `#btnTabVendPedidos`  
> **Permissão RBAC:** admin, vendedor, user  
> **Status:** Operacional em Produção  
> **Última Atualização:** 17/09/2026 (v8.234 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Consulta analítica de pedidos de venda emitidos (`SC5`/`SC6`), condições comerciais, status de faturamento e itens.
- **Personas Atendidas:** admin, vendedor, user

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html` (modais `#pedidoDetalhesModal` e `#danfeModal`, classes `.link-pedido` e `.link-nfe`)
- **Backend / Rotas:** `protheus_db.js, postgres_db.js, danfe_parser.js, server.js` (`/api/vendedores/pedidos`, `/api/vendedores/pedidos/search`, `/api/vendedores/pedidos/detalhes`, `/api/nfe/danfe-dados`, `/api/nfe/xml-download/:chave`)

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (`SC5`, `SC6`, `SE1`, `SF2`, `SA1010`, `SA4010`, `SE4010`) e PostgreSQL Supabase (`nfe_central_documentos`)

---

## 4. Regras de Negócio & Cálculos Chave
- Restrição por código de vendedor Protheus quando usuário perfil vendedor. Cálculo do frete total embutido vs destacado na nota.
- **Link Inteligente CodWeb Pipedrive CRM:** A coluna `CodWeb` na listagem renderiza link direto para a oportunidade oficial no CRM Pipedrive (`https://benetroncomercial.pipedrive.com/deal/${encodeURIComponent(codWeb)}` em nova aba com `target="_blank" rel="noopener noreferrer"`), em paridade com a aba Busca CodWeb/Ped/NF.
- **Abertura de Detalhes do Pedido Protheus:** O modal com os dados analíticos do pedido Protheus (`#pedidoDetalhesModal`) é disparado exclusivamente ao clicar no Número do Pedido (`.link-pedido`) ou no botão de ação (`.btn-ver-detalhe`), sem interceptar o link do Pipedrive.
- **Descrições Relacionais de Transporte e Pagamento:** Os campos `Transportadora:` e `Condição Pagto:` exibem a descrição oficial do cadastro Protheus junto ao código (`Código - Descrição`) via `LEFT JOIN SA4010` e `LEFT JOIN SE4010`, com fallbacks seguros em caso de cadastros não localizados.
- **Visualizador de DANFE NF-e em Popup:** Na coluna "NF-e Gerada" da listagem de pedidos e no campo "Nota Fiscal" do modal `#pedidoDetalhesModal`, notas fiscais emitidas renderizam links interativos (`.link-nfe`). Ao clicar, o sistema consulta a Super Tabela `nfe_central_documentos` (ou Protheus `SF2` com chave `F2_CHVNFE`) para abrir imediatamente o DANFE oficial diagramado para impressão A4 (`@media print`), com botões para imprimir/salvar PDF, baixar XML bruto e copiar chave de 44 dígitos. Em caso de documento ainda pendente de sincronização, executa busca on-demand na SEFAZ com aviso animado de busca e exibe o horário da próxima sincronização automática (12:30h / 18:30h).

---

## 5. Endpoints REST da API
- `GET /api/vendedores/pedidos`
- `POST /api/vendedores/pedidos/search`
- `GET /api/vendedores/pedidos/detalhes`
- `GET /api/nfe/danfe-dados?chave=:chave&empresa=:empresa&doc=:doc&onDemand=1`
- `GET /api/nfe/xml-download/:chave`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão e DANFE:
```bash
node test_vendedores_nfe.js
node test_danfe_popup.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.234 (17/09/2026):** Integração da coluna "NF-e Gerada" e do campo Nota Fiscal no modal `#pedidoDetalhesModal` com o visualizador de DANFE oficial (`#danfeModal`, `@media print` A4), consulta prioritária à Super Tabela `nfe_central_documentos` com busca on-demand na SEFAZ via mTLS e feedback animado de espera.
- **v8.229 (17/09/2026):** Enriquecimento relacional dos campos `Transportadora:` (via `LEFT JOIN SA4010 A4`) e `Condição Pagto:` (via `LEFT JOIN SE4010 E4`) no modal `#pedidoDetalhesModal`, exibindo código e descrição oficial com fallback gracioso.
- **v8.228 (17/09/2026):** Redirecionamento da coluna CodWeb para o link oficial do Pipedrive CRM (`https://benetroncomercial.pipedrive.com/deal/XXXXX`) com paridade visual à Busca CodWeb/Ped/NF, isolando a abertura do modal Protheus apenas ao Número do Pedido e ao botão Detalhes.
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
