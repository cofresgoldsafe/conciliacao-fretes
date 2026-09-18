# Contas a Pagar (SE2 / SE5 / SA2010)

> **Macro-Área:** 6. Assist. Financ. & 7. Analista Fin  
> **Identificador DOM:** `#tab-contas-pagar` | **Botões de Acesso:** `#btnTabContasPagar` (Analista Fin) e `#btnTabFinContasPagar` (Assist. Financ.)  
> **Permissão RBAC:** `admin`, `user` (perfis `analista-fin`, `financeiro`)  
> **Status:** Estável / Operacional em Produção  
> **Última Atualização:** 18/09/2026 (v8.238 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Consulta unificada e em tempo real de Contas a Pagar nas 3 empresas do grupo (14 Metal Pleno, 15 GSI Cofres, 16 OAÇO) sobre as tabelas `SE2140`, `SE2150` e `SE2160`, com batimento automático cadastral de fornecedores (`SA2010`) e histórico de baixas bancárias (`SE5`).
- **Diferenciação Chave:** Distinção algorítmica estrita entre baixas com movimentação financeira (débito bancário em conta/borderô no Banco Inter 077 ou baixa normal) e baixas sem movimentação financeira (compensação de adiantamentos a fornecedor PA `CMP`, devolução de mercadorias `DEV`, dação `DAC`, acordos comerciais `DIS` e compensação entre carteiras `CEC`).
- **Personas Atendidas:** Analista Financeiro, Tesouraria, Controladoria e Diretoria.

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** [`public/js/contas_pagar.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/public/js/contas_pagar.js) (Módulo isolado `ContasPagarModule`), [`public/index.html`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/public/index.html) (`#tab-contas-pagar`, `#modalDetalhesTituloContasPagar`) e [`public/app.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/public/app.js) (roteamento de aba).
- **Backend & Queries:** [`protheus_db.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/protheus_db.js) (`consultarContasPagarSe2`, `consultarMovimentacoesTituloSe5`, `classificarSituacaoTitulo`) e [`server.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/server.js) (rotas autenticadas com RBAC restrito).

---

## 3. Banco de Dados & Tabelas Envolvidas
- **Títulos a Pagar (SE2):** `SE2140` (MP), `SE2150` (GSI), `SE2160` (OAÇO).
  - Campos: `E2_FILIAL`, `E2_PREFIXO`, `E2_NUM`, `E2_PARCELA`, `E2_TIPO`, `E2_FORNECE`, `E2_LOJA`, `E2_NOMFOR`, `E2_EMISSAO`, `E2_VENCTO`, `E2_VENCREA`, `E2_VALOR`, `E2_SALDO`, `E2_BAIXA`, `E2_HIST`.
- **Movimentações Bancárias (SE5):** `SE5140`, `SE5150`, `SE5160`.
  - Campos: `E5_FILIAL`, `E5_DATA`, `E5_VALOR`, `E5_MOTBX`, `E5_TIPODOC`, `E5_BANCO`, `E5_AGENCIA`, `E5_CONTA`, `E5_DOCUMEN`, `E5_HISTOR`, `E5_BENEF`.
- **Cadastro de Fornecedores (SA2):** `SA2010` (compartilhado).
  - Campos: `A2_COD`, `A2_LOJA`, `A2_NOME`, `A2_NREDUZ`, `A2_CGC`.

---

## 4. Regras de Negócio & Cálculos Chave
1. **Classificação de Situação:**
   - **Em Aberto (`ABERTO`):** Quando `E2_SALDO >= E2_VALOR` ou `E2_BAIXA = ''` com saldo positivo. Badge cinza (`badge-warning`).
   - **Baixa Parcial (`BAIXA_PARCIAL`):** Quando `E2_SALDO > 0.01` e `E2_SALDO < E2_VALOR`. Informa o saldo restante e o valor já liquidado (`valorBaixado = Math.max(0, E2_VALOR - E2_SALDO)`). Badge âmbar (`badge-amber`).
   - **Quitado (Financeiro) (`QUITADO_FIN`):** Título com saldo zerado onde `E5_BANCO <> ''` e `E5_MOTBX IN ('DEB', 'NOR')`. Indica pagamento efetivo via instituição financeira (ex: Débito Banco 077 Inter). Badge verde (`badge-success`).
   - **Quitado (Compensação) (`QUITADO_CMP`):** Título com saldo zerado onde `E5_MOTBX IN ('CMP', 'DEV', 'DIS', 'CEC', 'CNF', 'BFT', 'DSD')` e banco vazio. Indica encontro de contas sem saída de caixa (compensação de PA, devoluções, etc.). Badge roxo (`badge-purple`).
   - **Quitado (Liquidado / Legado) (`QUITADO_LEG`):** Título quitado sem registro correspondente em SE5.
2. **Paginação e Performance:**
   - Paginação compulsória no SQL Server via `OFFSET ... ROWS FETCH NEXT ... ROWS ONLY` (padrão 50, seletor de 25, 50, 100).
   - Otimização de contagem (`sqlSummary`) que dispensa subqueries em SE5 quando a busca não exige filtro de meio de quitação financeiro.
3. **Segurança Zero-Trust:**
   - Proteção estrita contra SQL Injection e LIKE pattern injection no T-SQL com remoção de colchetes `[` e `]`.
   - RBAC travado exclusivamente para perfis com permissão financeira, bloqueando operadores padrão de logística (`consulta`).

---

## 5. Endpoints REST da API
- `GET /api/analista-fin/contas-pagar`
  - Parâmetros Query: `termo`, `numTitulo`, `codFornec`, `nomeFornec`, `cnpjFornec`, `empresa`, `situacao`, `dataVencIni`, `dataVencFim`, `page`, `pageSize`.
  - Resposta: `{ ok: true, success: true, items: [...], summary: { totalRegistros, totalValor, totalSaldo, totalBaixado }, pagination: { page, limit, total, totalPages, hasNext, hasPrev } }`.
- `GET /api/analista-fin/contas-pagar/movimentacoes`
  - Parâmetros Query: `empresa`, `filial`, `prefixo`, `num`, `parcela`, `tipo`, `fornece`.
  - Resposta: `{ ok: true, success: true, movimentacoes: [...] }`.

---

## 6. Testes Automatizados Vinculados
- Suíte automatizada com 13 testes de regressão:
```bash
node test_contas_pagar.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.238 (18/09/2026):** Criação e homologação da tela de Contas a Pagar na aba Analista Fin com motor multi-empresa (SE2140/150/160), batimento de baixas financeiras vs compensação (SE5), 4 cards de KPIs, paginação no servidor e modal de histórico de baixas.
