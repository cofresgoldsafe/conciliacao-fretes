# Consulta NFe, Pedido ou CodWeb

> **Macro-Área:** Busca Multi-Empresa  
> **Identificador DOM:** `#tab-consulta` | **Botão:** `#btnTabConsulta`  
> **Permissão RBAC:** admin, user (Consulta)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 17/09/2026 (v8.230 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Busca unificada multi-empresa por Código Web Pipedrive, Número de Pedido Protheus, Chave/Número de NF ou Razão Social do Cliente.
- **Personas Atendidas:** admin, user (Consulta)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html` (modal `#pedidoDetalhesModal`, classes `.link-pedido`, Event Delegation em `#consultaTableBody`)
- **Backend / Rotas:** `protheus_db.js, server.js` (`/api/protheus/consulta-avancada`, `/api/vendedores/pedidos/detalhes`)

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (`SC5`, `SC6`, `SF2`, `SA1010`, `SA4010`, `SE4010`, `SD2` nas empresas 14, 15, 16 e 09)

---

## 4. Regras de Negócio & Cálculos Chave
- Detecção inteligente do tipo de chave inserida. Enriquecimento temporal: Data de Ganho Comercial, Data de Migração Protheus e Data de Emissão Fiscal.
- **Link Direto do Pedido de Venda:** A coluna "Ped Venda" é interativa (`.link-pedido`), permitindo ao operador clicar sobre o número do pedido para visualizar em popup os dados completos (itens SC6, faturas SE1, endereço de entrega e transportadora), exatamente como na tela de Vendedores.
- **Enriquecimento Relacional no Modal:** O modal de detalhes (`#pedidoDetalhesModal`) apresenta descrições amigáveis e oficiais de `Transportadora:` (via `SA4010`) e `Condição Pagto:` (via `SE4010`) no formato `Código - Descrição`.

---

## 5. Endpoints REST da API
- `GET /api/protheus/consulta-avancada?tipo=:tipo&termo=:termo`
- `GET /api/vendedores/pedidos/detalhes?empresaKey=:empresaKey&numPedido=:numPedido`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_busca_codweb_ped_nf.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.230 (17/09/2026):** Simplificação de UI e higienização textual no formulário de busca: remoção do prefixo numérico `2.` do título principal, migração do texto instrutivo de preenchimento mutuamente exclusivo para logo abaixo do título, remoção de dicas redundantes (`.field-hint`) sob os campos e expurgo do aviso duplicado sobre os botões de ação.
- **v8.229 (17/09/2026):** Enriquecimento relacional dos campos `Transportadora:` e `Condição Pagto:` no modal `#pedidoDetalhesModal` disparado a partir da coluna Ped Venda, exibindo nome e descrição oficial vindos de `SA4010` e `SE4010`.
- **v8.227 (17/09/2026):** Coluna "Ped Venda" transformada em link interativo (`.link-pedido`) com abertura do modal `#pedidoDetalhesModal`, com paridade à tela Vendedores > Consulta Ped Venda e suporte a temas Claro/Escuro.
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
