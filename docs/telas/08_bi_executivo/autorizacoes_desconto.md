# Autorizações de Desconto & Margem

> **Macro-Área:** BI Executivo  
> **Identificador DOM:** `#tab-bi-autorizacoes` | **Botão:** `#btnTabBiAutorizacoes`  
> **Permissão RBAC:** admin, diretoria (BI)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 30/09/2026 (v8.283 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Workflow de aprovação executiva de descontos comerciais, margem mínima e frete embutido em negociações integradas entre Pipedrive e Protheus.
- **Personas Atendidas:** admin, diretoria (BI).

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/bi_autorizacoes.js`, `public/index.html` (modal `#modalBiAutorizacaoDetalhes` com prévia de frase e cópia rápida).
- **Backend / Rotas:** `server.js` (endpoints `/api/bi/autorizacoes/*`) e motor de regras `bi_autorizacoes_engine.js`.

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (`bi_autorizacoes_desconto`), fallback JSON em `data/bi_autorizacoes_cache.json`, Pipedrive REST API / Railway Gateway (`notes`).

---

## 4. Regras de Negócio & Cálculos Chave

### 4.1. Frase Oficial de Autorização Fixada no Deal (Pipedrive)
A frase oficial fixada (`pinned_to_deal_flag="1"`) é gerada compulsoriamente pela função `formatarNotaPipedrive`:
- **Estrutura Autorizado:**  
  `Deal {dealId} | Desconto Medio Ponderado do Pedido: {pctStr}% | Forma de Pagamento: {condPgtoLabel} | Frete Embutido: R$ {freteStr} | Total dos produtos com desconto {totalStr} - ok autorizado`
- **Estrutura Não Autorizado:**  
  `Deal {dealId} | Desconto Medio Ponderado do Pedido: {pctStr}% | Forma de Pagamento: {condPgtoLabel} | Frete Embutido: R$ {freteStr} | Total dos produtos com desconto {totalStr} - NAO AUTORIZADO`
- **Origem do Campo `Total dos produtos com desconto`:**  
  Se preenchido o campo **Preço Proposto (Opcional)** (`#inputBiValorProposto`), este valor é utilizado como o total autorizado. Caso contrário, utiliza-se automaticamente o **valor cadastrado total dos produtos** adicionados no Deal do Pipedrive.
- **Exemplo de Produção Homologado (Deal 26782):**  
  `Deal 26782 | Desconto Medio Ponderado do Pedido: 18,18% | Forma de Pagamento: 053-1X PIX | Frete Embutido: R$ 0,00 | Total dos produtos com desconto 5.400,00 - ok autorizado`

### 4.2. Cálculos Financeiros Oficiais
- $\text{Valor Líquido} = \text{Valor Vendido Final} - \text{Frete Embutido}$
- $\text{Desconto \%} = \frac{\text{Preço Tabela Total} - \text{Valor Líquido}}{\text{Preço Tabela Total}} \times 100$
- $\text{Lucro Bruto} = \text{Valor Vendido Final} - \text{Custo Total} - \text{Frete Embutido}$
- $\text{Margem \%} = \frac{\text{Lucro Bruto}}{\text{Valor Vendido Final}} \times 100$

---

## 5. Endpoints REST da API
- `GET /api/bi/autorizacoes/analisar?dealId={id}&proposta={valor}&observacoes={obs}`: Análise prévia em tempo real com Protheus SB1090 e dados do Pipedrive.
- `POST /api/bi/autorizacoes/decidir`: Grava decisão (`AUTORIZADO` / `NAO_AUTORIZADO`), fixa a nota padronizada no Deal e persiste no banco.
- `GET /api/bi/autorizacoes/historico?page={page}&limit=50&status={status}&q={busca}`: Histórico paginado com envelope REST padronizado.

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão (21 asserções):
```bash
node test_bi_autorizacoes.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.283 (30/09/2026):** Inclusão do "Total dos produtos com desconto {valor}" na frase oficial de autorização fixada no Pipedrive (com base no preço proposto informado ou valor cadastrado total dos produtos) e adição do card visual de prévia e botão de cópia no modal (21 testes aprovados).
- **v8.219 (15/09/2026):** Homologação inicial do módulo de Autorizações de Desconto & Margem no BI Executivo.
