# Consulta NFe, Pedido ou CodWeb

> **Macro-Área:** Busca Multi-Empresa  
> **Identificador DOM:** `#tab-consulta` | **Botão:** `#btnTabConsulta`  
> **Permissão RBAC:** admin, user (Consulta)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 17/09/2026 (v8.234 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Busca unificada multi-empresa por Código Web Pipedrive, Número de Pedido Protheus, Chave/Número de NF ou Razão Social do Cliente.
- **Personas Atendidas:** admin, user (Consulta)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html` (modais `#pedidoDetalhesModal` e `#danfeModal`, classes `.link-pedido` e `.link-nfe`, Event Delegation em `#consultaTableBody`)
- **Backend / Rotas:** `protheus_db.js, postgres_db.js, danfe_parser.js, server.js` (`/api/protheus/consulta-avancada`, `/api/vendedores/pedidos/detalhes`, `/api/nfe/danfe-dados`, `/api/nfe/xml-download/:chave`)

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (`SC5`, `SC6`, `SF2`, `SA1010`, `SA4010`, `SE4010`, `SD2` nas empresas 14, 15, 16 e 09) e PostgreSQL Supabase (`nfe_central_documentos`)

---

## 4. Regras de Negócio & Cálculos Chave
- Detecção inteligente do tipo de chave inserida. Enriquecimento temporal: Data de Ganho Comercial, Data de Migração Protheus e Data de Emissão Fiscal.
- **Link Direto do Pedido de Venda:** A coluna "Ped Venda" é interativa (`.link-pedido`), permitindo ao operador clicar sobre o número do pedido para visualizar em popup os dados completos (itens SC6, faturas SE1, endereço de entrega e transportadora), exatamente como na tela de Vendedores.
- **Enriquecimento Relacional no Modal:** O modal de detalhes (`#pedidoDetalhesModal`) apresenta descrições amigáveis e oficiais de `Transportadora:` (via `SA4010`) e `Condição Pagto:` (via `SE4010`) no formato `Código - Descrição`.
- **Visualizador de DANFE NF-e em Popup:** A coluna "Nota Fiscal" é clicável (`.link-nfe`). Ao ser acionada, busca o XML na Super Tabela `nfe_central_documentos` (ou Protheus SF2). Se o XML existir, exibe o DANFE oficial diagramado em folha A4 com `@media print`, permitindo impressão ou geração de PDF nativo com 1 clique, além de download do arquivo `.xml` e cópia da chave de acesso de 44 dígitos. Se ainda não sincronizado no Supabase, inicia consulta sob demanda na SEFAZ via mTLS com tela de espera ativa ("⏳ Buscando online na SEFAZ, aguarde...") e informa a próxima sincronização automática periódica (12:30h ou 18:30h).

---

## 5. Endpoints REST da API
- `GET /api/protheus/consulta-avancada?tipo=:tipo&termo=:termo`
- `GET /api/vendedores/pedidos/detalhes?empresaKey=:empresaKey&numPedido=:numPedido`
- `GET /api/nfe/danfe-dados?chave=:chave&empresa=:empresa&doc=:doc&onDemand=1`
- `GET /api/nfe/xml-download/:chave`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão e DANFE:
```bash
node test_busca_codweb_ped_nf.js
node test_danfe_popup.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.236 (17/09/2026):** Implementação de Fallback Resiliente no TOTVS Protheus ERP (`danfe_protheus.js`) e sintetizador canônico de XML oficial para contornar a regra restritiva da SEFAZ cStat 641 ("NF-e indisponível para o emitente no NFeDistribuicaoDFe"). Extração automática de SF2/SD2/SB1/SA1/SA4/SE1, renderização instantânea do DANFE em tela e persistência contínua na Super Tabela.
- **v8.235 (17/09/2026):** Adição de suporte a senha de certificado digital A1 no popup DANFE (#inputDanfeSenhaCert), diagnóstico transparente de erros SEFAZ e compartilhamento de sessão mútua com Fechamento Fiscal (`sessionStorage`).
- **v8.234 (17/09/2026):** Implementação de links interativos na coluna Nota Fiscal (`.link-nfe`) para abertura de popup de visualização de DANFE em padrão gráfico oficial A4 (`@media print`), gerado a partir do XML da Super Tabela `nfe_central_documentos` com busca on-demand mTLS na SEFAZ, barra de progresso animada e aviso de próxima sincronização (12:30h / 18:30h).
- **v8.231 (17/09/2026):** Disposição horizontal em linha única (inline layout) dos campos e botões de ação ("🧹 Limpar" e "Buscar no Protheus") com alinhamento na base (`align-items: flex-end`), altura padronizada de 40px, responsividade em telas menores (< 1100px) e higienização estática e dinâmica dos placeholders (remoção do prefixo "Ex: ").
- **v8.230 (17/09/2026):** Simplificação de UI e higienização textual no formulário de busca: remoção do prefixo numérico `2.` do título principal, migração do texto instrutivo de preenchimento mutuamente exclusivo para logo abaixo do título, remoção de dicas redundantes (`.field-hint`) sob os campos e expurgo do aviso duplicado sobre os botões de ação.
- **v8.229 (17/09/2026):** Enriquecimento relacional dos campos `Transportadora:` e `Condição Pagto:` no modal `#pedidoDetalhesModal` disparado a partir da coluna Ped Venda, exibindo nome e descrição oficial vindos de `SA4010` e `SE4010`.
- **v8.227 (17/09/2026):** Coluna "Ped Venda" transformada em link interativo (`.link-pedido`) com abertura do modal `#pedidoDetalhesModal`, com paridade à tela Vendedores > Consulta Ped Venda e suporte a temas Claro/Escuro.
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
