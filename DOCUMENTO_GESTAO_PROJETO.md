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
4. **Fechamento de Comissões de Vendedores:** Apurar comissões periódicas nas tabelas `SE3` (ciclo padrão de 26 a 25), com totalizadores gerais, trava de 60 dias e isolamento seguro por vendedor logado.
5. **Governança e Controle de Acesso:** Gerenciar permissões de navegação por perfil e usuário.

---

## 2. ✅ O que foi Desenvolvido (Entregas Concluídas)

### 📦 Módulo 1: Logística & Conciliação de Fretes
* **Parsers Python:** `parser_rodonaves.py` (PDF Rodonaves multi-páginas), `parser_tipo2.py` (CSV/TXT) e `parser_correios.py` (Fatura Analítica Correios SFE).
* **Consulta SQL Protheus em Tempo Real:** Relaciona itens de saída (`SD2`) com pedidos de venda (`SC5`), unificando o frete cobrado em uma coluna única.
* **Painel de Divergências:** Cartões estatísticos de resumo, badges coloridos, chips de filtro rápido por status e tolerância configurável em R$.
* **Edição Viva de NF (`Doc (NF)`):** Reconsulta instantânea ao Protheus e exportação da tabela em CSV.

### 💼 Módulo 2: Vendedores & Comissões (v1.3)
* **Sub-aba 1 (Consulta Pedido):**
  * Pesquisa multi-empresa simultânea nas tabelas `SC5160` (OACO), `SC5150` (GSI) e `SC5140` (Metal Pleno).
  * Modal rico com busca de endereço e contato na tabela mestra `SA1010`, máscaras automáticas de CNPJ/CPF/CEP/Telefone e grade de itens `SC6`.
* **Sub-aba 2 (Comissões):**
  * Consulta periódica nas tabelas `SE3160` (OACO), `SE3150` (GSI) e `SE3140` (Metal Pleno) com leitura de `E3_BASE`, `E3_PORC` e `E3_COMIS`.
  * Totalizadores de Base e Comissão no topo da tela.
  * Coluna **`Empresa`** com as siglas oficiais: **`MP`**, **`GSI`** e **`OACO`**.
  * De-Para de vendedores: `000004` (Figueiredo), `000064` (Andrea), `000074` (Juliana).
  * Trava de intervalo de 60 dias para proteção do banco de dados.

### ⚙️ Módulo 3: Configurações & Controle de Acesso
* Gestão de usuários (`data/users.json`), senhas e permissões de abas (`logistica`, `consulta`, `vendedores`, `configuracoes`).
* Usuários ativos: `alexandre` (Admin), `erica`, `wallerson` (Operadores), `juliana`, `andrea`, `figueiredo` (Vendedores).

### 🌐 Módulo 4: Implantação 100% Nuvem
* Container Docker no Render com deploy contínuo integrado ao GitHub.
* API de banco no Railway com driver ODBC SQL Server.

---

## 3. 📍 Status Atual dos Módulos

| Módulo / Funcionalidade | Status | Observações |
| :--- | :---: | :--- |
| **Aba 1 (Upload Faturas & Conciliação)** | 🟢 100% Concluído | Operacional com regras de divergência e batimento T-SQL. |
| **Aba 2 (Correios & ViPP VisualSet)** | 🟡 Em Espera | Parser analítico PDF pronto; aguardando token WebService ViPP da VisualSet. |
| **Aba 3 (Vendedores: Consulta Pedido & Comissões)** | 🟢 100% Concluído | Operacional nas 3 empresas com clientes em `SA1010` e comissões `SE3`. |
| **Aba 4 (Configurações & Usuários)** | 🟢 100% Concluído | Operacional com controle de perfis e 6 usuários cadastrados. |
| **Lançamento Direto no Protheus (ExecAuto)** | 🔵 Fase Final | Classe AdvPL pronta ([`REST_AMARFRET.PRW`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/REST_AMARFRET.PRW)), botão desabilitado aguardando AppServer. |

---

## 4. 🗄️ Estrutura Técnica de Tabelas Protheus

* **Pedidos de Venda:** `SC5160` (OACO 16), `SC5150` (GSI 15), `SC5140` (Metal Pleno 14)
* **Itens do Pedido:** `SC6160` (OACO 16), `SC6150` (GSI 15), `SC6140` (Metal Pleno 14)
* **Comissões:** `SE3160` (OACO 16), `SE3150` (GSI 15), `SE3140` (Metal Pleno 14)
* **Itens de Saída (NF):** `SD2160` (OACO 16), `SD2150` (GSI 15), `SD2140` (Metal Pleno 14)
* **Cadastro Mestre de Clientes:** `SA1010` (Base compartilhada)

---

## 5. 🛡️ Segurança
* Nenhuma senha, token ou chave confidencial foi gravada neste documento ou versionada no GitHub.
* Variáveis sensíveis permanecem restritas ao painel de variáveis de ambiente do Render e Railway.
