# 📘 Documento de Gestão, Atualização e Aperfeiçoamento do Projeto
## Plataforma de Apoio GSI Multi-Empresas (Integração Protheus)

> **Status Atual:** Versão 1.3 Publicada e Operacional na Nuvem 24/7  
> **Link de Produção:** `https://conciliacao-fretes.onrender.com`  
> **Repositório GitHub:** `https://github.com/cofresgoldsafe/conciliacao-fretes`  
> **Segurança:** Documento livre de credenciais sensíveis e senhas.

---

## 1. 🎯 Objetivos da Plataforma
Prover um portal corporativo em nuvem, acessível por operadores, administradores e equipe comercial, para:
1. **Conciliação Inteligente de Faturas:** Ler faturas Rodonaves (PDF) e Correios/VIPP (CSV/TXT/PDF), batendo automaticamente com os fretes cobrados no Protheus (`C5_FRETE + C5_VLR_FRT`).
2. **Consulta Rápida de Pedidos (Multi-Empresa):** Localizar pedidos em tempo real nas 3 empresas do grupo (OACO 16, GSI 15 e Metal Pleno 14) por `CodWeb`, `Número do Pedido` ou `Nome do Cliente`.
3. **Drill-Down e Impressão de Pedidos:** Exibir dados cadastrais completos da base mestra `SA1010` (CNPJ/CPF, Endereço com complemento, Bairro, Cidade/UF, CEP, Contato/Tel), logística, condições de pagamento e grade de itens (`SC6`).
4. **Fechamento de Comissões e Metas:** Apurar faturamento e comissões periódicas nas tabelas `SE3` (ciclo padrão de 26 a 25), com indicador dinâmico de Meta Atingida (% proporcional com base em R$ 120k/vendedor ou R$ 360k global), totalizador de base faturada, trava de 60 dias e isolamento seguro por vendedor logado.
5. **Governança e Controle de Acesso:** Gerenciar permissões de navegação por perfil e usuário.

---

## 2. ✅ O que foi Desenvolvido (Entregas Concluídas)

### 📦 Módulo 1: Logística & Conciliação de Fretes
* **Parsers Python:** `parser_rodonaves.py` (PDF Rodonaves multi-páginas), `parser_tipo2.py` (CSV/TXT) e `parser_correios.py` (Fatura Analítica Correios SFE).
* **Consulta SQL Protheus em Tempo Real:** Relaciona itens de saída (`SD2`) com pedidos de venda (`SC5`), unificando o frete cobrado em uma coluna única (`C5_FRETE + C5_VLR_FRT`).
* **Normalização Multi-Formato de NFe (`getDocVariants`):** Compatibilidade total e busca indexada em `SD2` para NFs com 6 dígitos (`000629`), 9 dígitos com zeros à esquerda (`000000629`) e números puros (`629`), garantindo que qualquer fatura (ex: Rodonaves 31-08) localize instantaneamente o Pedido de Venda e o Cliente em tempo real.
* **Painel de Divergências:** Cartões estatísticos de resumo, badges coloridos, chips de filtro rápido por status e tolerância configurável em R$.
* **Edição Viva de NF (`Doc (NF)`):** Reconsulta instantânea ao Protheus e exportação da tabela em CSV.

### 💼 Módulo 2: Vendedores & Comissões (v1.3)
* **Sub-aba 1 (Consulta Pedido):**
  * Pesquisa multi-empresa simultânea nas tabelas `SC5160` (OACO), `SC5150` (GSI) e `SC5140` (Metal Pleno).
  * Modal rico com busca de endereço e contato na tabela mestra `SA1010`, máscaras automáticas de CNPJ/CPF/CEP/Telefone e grade de itens `SC6`.
* **Sub-aba 2 (Comissões & Metas):**
  * Consulta periódica nas tabelas `SE3160` (OACO), `SE3150` (GSI) e `SE3140` (Metal Pleno) com leitura de `E3_BASE`, `E3_PORC` e `E3_COMIS`.
  * **Card "Meta Atingida":** Cálculo dinâmico proporcional de faturamento, substituindo a exibição de comissão a pagar em R$ pela porcentagem atingida de faturamento em relação à meta comercial:
    * **Meta Individual:** R$ 120.000,00 por vendedor (para vendedor selecionado ou perfil de vendedor logado).
    * **Meta Global:** R$ 360.000,00 para os 3 vendedores do grupo (quando selecionado "Todos os Vendedores").
    * **Fórmula Proporcional:** `% Meta Atingida = (Total Faturado / Meta Proporcional) * 100`.
  * Totalizadores de Base Faturada (`E3_BASE`) e Quantidade de Vendas no topo da tela.
  * Coluna **`Empresa`** com as siglas oficiais: **`MP`**, **`GSI`** e **`OACO`**.
  * De-Para de vendedores: `000004` (Figueiredo), `000064` (Andrea), `000074` (Juliana).
  * Trava de intervalo de 60 dias para proteção do banco de dados.

### 💰 Módulo 4: Assistente Financeiro (Conciliação Bancária Inter x Protheus)
* **Sub-aba 1 (Conciliação Bancária):** Conciliação de extratos da Conta Corrente Banco Inter 077 com títulos financeiros Protheus (`SE1`/`SE2`), filtros por data, cartões de conciliação e exportação.
* **Webhook & Integração Pix/Boleto:** Monitoramento de eventos e persistência.

### ⚙️ Módulo 5: Configurações, Controle de Acesso & Auditoria de Uso
* **Sub-aba 1 (Usuários & Permissões):** Gestão de contas, senhas e permissões granulares para as 5 abas principais (`logistica`, `consulta`, `vendedores`, `financeiro`, `configuracoes`). Blindagem contra arrays vazios e roteamento automático para perfis especializados (ex: operador Rubens com acesso exclusivo a Assist. Financ.).
* **Sub-aba 2 (Atividades & Auditoria):** Painel administrativo em tempo real com métricas de engajamento (usuários ativos, volume de ações), último acesso ativo relativo e feed detalhado dos últimos eventos de negócio.
* **Banco de Dados em Nuvem (Supabase PostgreSQL):** Persistência de tabelas `users`, `history` e `user_activities` via `postgres_db.js`, com auto-criação de schema e fallback gracioso local.
* Usuários ativos: `alexandre` (Admin), `erica`, `wallerson`, `rubens` (Operadores), `juliana`, `andrea`, `figueiredo` (Vendedores).

### 🌐 Módulo 6: Implantação 100% Nuvem
* Container Docker no Render com deploy contínuo integrado ao GitHub.
* API de banco Protheus no Railway com driver ODBC SQL Server.
* Banco de dados relacional PostgreSQL no Supabase (Pooler SSL / `DATABASE_URL`).

---

## 3. 📍 Status Atual dos Módulos

| Módulo / Funcionalidade | Status | Observações |
| :--- | :---: | :--- |
| **Aba 1 (Logística: Upload Faturas & Conciliação)** | 🟢 100% Concluído | Operacional com regras de divergência e batimento T-SQL. |
| **Aba 2 (Consulta: Pedidos e NFs Multi-Empresa)** | 🟢 100% Concluído | Operacional com pesquisa unificada em 14, 15 e 16. |
| **Aba 3 (Vendedores: Consulta Pedido, Comissões & Metas)** | 🟢 100% Concluído | Operacional nas 3 empresas com clientes em `SA1010`, comissões `SE3` e cálculo dinâmico de Meta Atingida. |
| **Aba 4 (Assist. Financ.: Conciliação Inter x Protheus)** | 🟢 100% Concluído | Operacional com leitura de extratos Inter e batimento financeiro. |
| **Aba 5 (Configurações: Usuários & Auditoria de Uso)** | 🟢 100% Concluído | Operacional com controle granular para as 5 abas, badges e auditoria de atividades. |
| **Lançamento Direto no Protheus (ExecAuto)** | 🔵 Fase Final | Classe AdvPL pronta ([`REST_AMARFRET.PRW`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/REST_AMARFRET.PRW)), botão desabilitado aguardando AppServer. |

---

## 4. 🗄️ Estrutura Técnica de Tabelas Protheus

* **Pedidos de Venda:** `SC5160` (OACO 16), `SC5150` (GSI 15), `SC5140` (Metal Pleno 14)
* **Itens do Pedido:** `SC6160` (OACO 16), `SC6150` (GSI 15), `SC6140` (Metal Pleno 14)
* **Comissões:** `SE3160` (OACO 16), `SE3150` (GSI 15), `SE3140` (Metal Pleno 14)
* **Itens de Saída (NF):** `SD2160` (OACO 16), `SD2150` (GSI 15), `SD2140` (Metal Pleno 14)
* **Cadastro Mestre de Clientes:** `SA1010` (Base compartilhada)

---

## 5. 🛡️ Segurança & Backlog de Hardening
* Nenhuma senha, token ou chave confidencial foi gravada neste documento ou versionada no GitHub.
* Variáveis sensíveis permanecem restritas ao painel de variáveis de ambiente do Render e Railway.
* ⚠️ **Backlog de Segurança & Auditoria Técnica:** Consulte o documento detalhado [`DOCUMENTO_CHECKPOINT_SEGURANCA_BACKLOG.md`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/DOCUMENTO_CHECKPOINT_SEGURANCA_BACKLOG.md) para a lista priorizada de correções e checklist de implementação.

