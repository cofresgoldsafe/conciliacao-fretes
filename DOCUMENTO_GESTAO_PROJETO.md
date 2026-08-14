# 📘 Documento de Gestão, Atualização e Aperfeiçoamento do Projeto
## Plataforma de Apoio GSI Multi-Empresas (Integração Protheus)

> **Status Atual:** Versão 1.0 Publicada e Operacional na Nuvem 24/7  
> **Link do Sistema:** `https://conciliacao-fretes.onrender.com`  
> **Repositório GitHub:** `https://github.com/cofresgoldsafe/conciliacao-fretes`  
> **Segurança:** Documento livre de senhas e chaves de acesso.

---

## 1. 🎯 Objetivos do Projeto
Criar uma plataforma web centralizada, acessível pela internet por pessoas autorizadas da equipe, para:
1. Fazer upload de faturas de transportadoras em diferentes formatos (PDF Tipo 1 Rodonaves, CSV/TXT Tipo 2 VIPP/Correios).
2. Extrair automaticamente todos os CT-es (Conhecimentos de Transporte), valores orçados, valores cobrados e clientes.
3. Consultar em tempo real no banco de dados do Protheus o **Pedido de Venda (`D2_PEDIDO`)** e o **Frete Cobrado do Cliente (`C5_FRETE + C5_VLR_FRT`)** correspondente à Nota Fiscal.
4. Identificar automaticamente qual empresa do grupo é a pagadora (**Empresa 16 OACO**, **Empresa 15 GSI** ou **Empresa 14 Metal Pleno**).
5. Permitir a conferência, recálculo e exportação dos dados em CSV antes da efetivação no ERP.

---

## 2. ✅ O que foi Desenvolvido (Entregas Realizadas)

### 📄 A. Extratores e Analisadores de Arquivos (Parsers Python)
- **Parser Rodonaves (`parser_rodonaves.py`):** Processamento inteligente de PDFs multi-páginas da Rodonaves. Extrai número do CT-e, nota fiscal originária, valores orçados e cobrados, dados da fatura e CNPJ/Razão Social do pagador.
- **Parser Tipo 2 (`parser_tipo2.py`):** Suporte para relatórios em CSV/TXT de faturas VIPP Visualset / Correios / Logística.
- **Identificação Automática de Empresa:** Leitura do cabeçalho da fatura para direcionar consultas à empresa correta no Protheus.

### 🔌 B. Conexão ao Protheus & Consulta Multi-Empresas (`protheus_db.js`)
- Conexão em tempo real via consulta SQL à API Nuvem do Protheus.
- Execução de `LEFT JOIN` entre os itens de saída (`SD2`) e os pedidos de venda (`SC5`).
- Unificação do frete em uma única coluna inteligente (**`Cobrado Cli.`**), somando `C5_FRETE` e `C5_VLR_FRT`.
- Roteamento dinâmico de tabelas por sufixo de empresa:
  - **Empresa 16 (OACO):** `SD2160` + `SC5160`
  - **Empresa 15 (GSI):** `SD2150` + `SC5150`
  - **Empresa 14 (Metal Pleno):** `SD2140` + `SC5140`

### 💻 C. Interface Web Responsiva (`public/`)
- Design escuro moderno, funcional e sem excessos decorativos.
- **Campos Editáveis na Grid:** O campo `Doc (NF)` pode ser alterado diretamente na tela, disparando uma reconsulta automática ao Protheus.
- **Batimento Automático:** Indicador percentual que valida se a soma dos CT-es bate com o valor total da fatura.
- **Exportação CSV:** Botão para download instantâneo da tabela conciliada.

### 🌐 D. Implantação 100% Nuvem (Render + Docker)
- Arquitetura empacotada em container Docker ([`Dockerfile`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/Dockerfile)).
- Publicação no Render com atualização automática a cada novo código no GitHub.

---

## 3. 📍 Onde Paramos (Status Atual - v1.2)

- **Aplicação no Ar:** O sistema está rodando online e acessível 24/7 sem depender de computador local ligado.
- **Aba 1 (Upload Faturas & Conciliação Inteligente):** 🟢 **100% Concluída**:
  - Parsers PDF Rodonaves e CSV/TXT operando com batimento automático T-SQL no Protheus (`C5_FRETE + C5_VLR_FRT`).
  - Módulo de Regras de Divergência Automática com ordenação, chips de filtro e tolerância flexível.
- **Aba 2 (Fatura Correios SFE & ViPP VisualSet):** 🟡 **CHECKPOINT DE AGUARDAMENTO:**
  - Parser PDF Correios SFE ([`parser_correios.py`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/parser_correios.py)) concluído. Aguardando envio do Token WebService pela VisualSet.
- **Aba 3 (Vendedores & Comissões):** 🟢 **100% Concluída (v1.3)**:
  - **Sub-aba 1 (Consulta Pedido):** Pesquisa multi-critério (`C5_CODWEB`, `C5_NUM`, `C5_NOMECLI`), com unicidade de CodWeb e listagem multi-empresa. Drill-down com modal de detalhes cadastrais, entrega, pagamento e tabela completa de itens do pedido (`SC6`).
  - **Sub-aba 2 (Comissões):** Consulta periódica nas tabelas `SE3` (ciclo padrão de 26 a 25), limitação de segurança de 60 dias, cards de resumo e isolamento por vendedor logado.
  - **Usuários Vendedores:** Cadastrados `juliana` (000074), `andrea` (000064) e `figueiredo` (000004).
- **Aba 4 (Configurações & Gerenciamento de Usuários):** 🟢 **100% Concluída**:
  - Reestruturação da navegação em 2 níveis (4 Abas Principais no topo + Sub-Abas internas).
  - Tabela de gerenciamento de usuários com controle de acesso dinâmico por perfil e abas permitidas.
- **Módulo de Gravação no Protheus (Fase Final):** Botão aguardando publicação do endpoint REST AdvPL no AppServer.

---

## 4. 🚀 Plano de Aperfeiçoamento (Roadmap de Evolução)

### 🔹 Fase 1: Regras Automáticas de Divergência
- 🟢 **CONCLUÍDO (v1.2):** Destaque visual automático, badges de prejuízo/sobra, cartões estatísticos e ordenação por prioridade com divergentes no topo.

### 🔹 Fase 2: Suporte a Novas Transportadoras
- Adição de novos modelos de leitura para transportadoras adicionais (Jamef, Brasspress, TNT, etc.).

### 🔹 Fase 3: Módulo de Gravação no Protheus (Fase Final)
- Integração da classe REST ADVPL ([`REST_AMARFRET.PRW`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/REST_AMARFRET.PRW)) no AppServer do Protheus.
- Habilitação do botão de gravação para efetivar a inclusão via `MATA116` / ExecAuto.

---

## 5. 🛡️ Diretrizes de Segurança
- Nenhuma chave de API, senha ou credencial de banco de dados deve ser inserida neste documento ou comitada no código do GitHub.
- As credenciais de acesso continuam armazenadas estritamente em Variáveis de Ambiente (`Environment Variables`) no painel da nuvem.
