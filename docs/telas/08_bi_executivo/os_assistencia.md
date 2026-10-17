# BI Assistência Técnica — Faturamento & Volume de OS

> **Macro-Área:** 8. BI Executivo  
> **Identificador DOM:** `#tab-bi-os` | **Botão:** `#btnTabBiOs` (`🛠️ OS`)  
> **Permissão RBAC:** `admin`, `diretoria` (BI)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 16/10/2026 (v8.310 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Painel executivo da operação de Assistência Técnica dentro do **📊 BI EXECUTIVO**, consolidando em dois gráficos interativos de barras:
  1. **Recebimentos Quitados de OS Mês a Mês (Últimos 24 Meses — Fonte: Protheus `SE1150`)**: Títulos a receber baixados/quitados (`E1_SALDO = 0` e `E1_BAIXA` preenchida) cujo número ou prefixo do título possui `"OS"`.
  2. **Quantidade de OS Criadas Mês a Mês (Últimos 20 Meses — Fonte: Supabase `Gemini-Assistencia-Portal`)**: Volume mensal de Ordens de Serviço abertas na tabela `ordens_servico`, segregando **OS Padrão** vs **Garantia** com filtro instantâneo (`Todas`, `🔵 Só OS Padrão`, `🟠 Só Garantia`).
- **Personas Atendidas:** Diretoria / Gestão Executiva, Controladoria, Administrador do Sistema.

---

## 2. Arquitetura de Código & Componentes (Pilar 3)
- **Frontend:** `public/js/bi_os.js`, `public/index.html` (`#tab-bi-os`, `#btnTabBiOs`)
- **Controlador do Portal:** `public/app.js` (`window.initBiOsView`)
- **Backend / Motor Dedicado:** `bi_os_engine.js`
- **Rotas REST:** `server.js` (`/api/bi/os/dashboard`, `/api/bi/os/titulos`, `/api/bi/os/sync`)
- **Testes Automatizados:** `tests/bi_os_engine.test.js`

---

## 3. Fontes de Dados & Regras de Negócio
1. **Recebimentos Quitados no Protheus (`SE1150` — Empresa 15 GSI Cofres):**
   - Filtro SQL: `D_E_L_E_T_ = ' '`, `E1_SALDO = 0`, `LTRIM(RTRIM(ISNULL(E1_BAIXA, ''))) <> ''` e `(UPPER(E1_NUM) LIKE '%OS%' OR UPPER(E1_PREFIXO) LIKE '%OS%')`.
   - Valor considerado: `CASE WHEN ISNULL(E1_VALLIQ, 0) > 0 THEN E1_VALLIQ ELSE ISNULL(E1_VALOR, 0) END`.
   - Suporte a alternância entre **Regime de Caixa (`E1_BAIXA`, padrão)** e **Regime de Competência (`E1_EMISSAO`)** sobre os títulos quitados.
   - Sobrepeõe linha tracejada de **Média Mensal (24m)** e permite **drilldown por clique na barra** para filtrar os títulos daquele mês na tabela analítica inferior.
2. **Volume de OS Criadas no Supabase Assistência (`ordens_servico` — Últimos 20 Meses):**
   - Consulta via PostgREST em ranges paralelos (`0-999`, `1000-2499`, `2500-3999`) na mesma base canônica do `Gemini-Assistencia-Portal` (`huhwzrvxkzffzxfqtzob.supabase.co`).
   - **Deduplicação Canônica:** Exclui as réplicas fantasmas `1485 <= numero_os <= 1501` e deduplica por `Number(numero_os)` mantendo o registro com `updated_at || created_at` mais recente.
   - **Classificação Padrão vs Garantia:** Segue a regra canônica do portal (`isGarantia = tipo_os === 'Garantia' || status_pagamento === 'Isento'`; demais registros como `'OS Padrão'` e `'Manutenção Corretiva'` = `'OS Padrão'`).
3. **Cache Resiliente (FMEA):**
   - Cache em memória (TTL de 10 minutos) e persistência atômica em `data/bi_os_cache.json` via `safe_json_storage.js` para continuidade operacional caso o Relay Protheus ou o Supabase oscilem.

---

## 4. Endpoints REST da API
- `GET /api/bi/os/dashboard?regime=baixa|emissao`: Retorna KPIs executivos, série de 24 meses de recebimentos quitados (`faturamento24m`) e série de 20 meses de OS criadas (`osCriadas20m`).
- `GET /api/bi/os/titulos?regime=baixa|emissao&mesAno=YYYY-MM&search=...&page=1&limit=50`: Listagem analítica paginada de títulos quitados seguindo o **Pilar 1** (`{ items, resumo, pagination }`).
- `POST /api/bi/os/sync`: Força sincronização imediata com o Protheus (`SE1150`) e o Supabase Assistência (`ordens_servico`).

---

## 5. Testes Automatizados Vinculados
```bash
node --test tests/bi_os_engine.test.js
```

---

## 6. Histórico & Evolução da Tela
- **v8.310 (16/10/2026):** Criação e homologação da sub-aba `🛠️ OS` em `📊 BI EXECUTIVO` com gráficos de barras de Recebimentos Quitados Protheus (24 meses) e Quantidade de OS Criadas no Supabase Assistência (20 meses, Padrão vs Garantia com filtro), 4 KPIs executivos e drilldown analítico paginado com exportação CSV.
