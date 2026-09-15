# [NOME DA TELA] — [MÓDULO / MACRO-ÁREA]

> **Padrão Oficial de Documentação Técnica de Telas — Portal GSI**  
> Documento modular de referência técnica para arquitetura, regras de negócio, integrações e testes.

---

## 📋 Identificação da Tela

| Atributo | Especificação |
| :--- | :--- |
| **Macro-Área / Pasta** | `docs/telas/[XX_modulo]/` (ex: `07_analista_fin`, `04_vendedores`) |
| **Nome da Tela** | Nome amigável e oficial da funcionalidade |
| **Tab ID DOM** | `#id-do-painel-tab` (ex: `tab-fechamento-fiscal`) |
| **Botão de Acesso DOM** | `#id-do-botao-navegacao` (ex: `btnTabFechamentoFiscal`) |
| **Permissão RBAC** | Slug de permissão exigido no JWT (ex: `analista-fin`, `vendedores`, `financeiro`, `admin`) |
| **Versão / Data** | Versão atual da especificação e data da última revisão |
| **Status Operacional** | 🟢 Produção / 🟡 Homologação / 🔵 Em Desenvolvimento |

---

## 1. Propósito da Tela & Personas

### 1.1 Objetivo de Negócio
Descrição clara e concisa do problema operacional ou fiscal que a tela resolve, justificativa da existência no Portal GSI e valor agregado para a operação.

### 1.2 Personas Envolvidas
- **Persona Primária:** Cargo ou papel que opera a tela no dia a dia (ex: Analista Financeiro, Assistente de Faturamento).
- **Persona Secundária:** Usuários consumidores de relatórios gerados ou gestores que auditam os resultados (ex: Gerente Financeiro, Contador Externo).

### 1.3 Fluxo Operacional Típico
1. Passo a passo operacional executado pelo usuário ao abrir a tela.
2. Filtros e parâmetros de entrada aplicados.
3. Ações disparadas (consulta, sincronização, exportação, consolidação).
4. Resultados esperados e tomadas de decisão decorrentes.

---

## 2. Arquitetura de Código & Componentes

### 2.1 Estrutura Frontend
- **Arquivo de Script:** Caminho do módulo JS responsável (ex: `public/js/nome_modulo.js` ou `public/app.js`).
- **Seletor HTML Principal:** Container DOM e wrappers de sub-aba em `public/index.html`.
- **Componentes Visuais:**
  - Barra de Filtros e Parâmetros (seletores, inputs de data, busca).
  - Cards de KPIs / Indicadores.
  - Tabela Principal de Resultados (cabeçalhos, badges de status, paginação).
  - Modais de Detalhes ou Drilldown.
- **Estilos CSS:** Classes dedicadas em `public/style.css` e suporte a temas (claro/escuro).

### 2.2 Estrutura Backend & Roteamento
- **Servidor HTTP:** Roteamento e middlewares no `server.js`.
- **Autenticação & RBAC:** Validação de token Bearer via `requireAuth` e checagem de permissões do usuário.
- **Módulos & Engines Vinculados:** Serviços de apoio (ex: `protheus_db.js`, `postgres_db.js`, `engines`, parsers).

### 2.3 Serviços Externos & Integrações
- APIs de terceiros, WebServices governamentais, SFTP/FTP ou webhooks envolvidos.

---

## 3. Banco de Dados & Modelagem

### 3.1 Protheus ERP (MSSQL)
Tabelas e visões relacionais consumidas no banco legado do Protheus:
- `TABELA_1`: Descrição dos campos principais (`CAMPO_A`, `CAMPO_B`) e função na query.
- `TABELA_2`: Chaves de junção (`JOIN`) e filtros de integridade aplicados (`D_E_L_E_T_ = ' '`).

### 3.2 PostgreSQL / Supabase
Tabelas do banco de dados analítico e relacional moderno:
- **Nome da Tabela:** Estrutura de colunas, tipos de dados, chaves primárias e índices.
- **Mecanismos de Cache & Fallback:** Políticas de cache em memória ou fallback para JSON local (`data/*.json`).

---

## 4. Regras de Negócio & Cálculos Chave

### 4.1 Regras de Classificação & Filtros
- Critérios lógicos aplicados para inclusão, exclusão e categorização de dados.
- Tratamento de exceções, casos de borda e saneamento de strings/códigos.

### 4.2 Fórmulas Matemáticas & Algoritmos
- Equações e fórmulas de apuração com descrição dos termos.
- Regras de arredondamento e formatação monetária (padrão brasileiro `pt-BR`).

### 4.3 Matriz de Estados / Diagnósticos
Tabela de decisão demonstrando entradas, condições avaliadas e status ou ações resultantes.

---

## 5. Endpoints REST da API

### 5.1 `MÉTODO /api/caminho/do/endpoint`
- **Descrição:** Finalidade do endpoint.
- **Autenticação:** `Bearer JWT` (Permissão: `nome_permissao`).
- **Parâmetros Query / Request Body:**
  ```json
  {
    "parametro_1": "valor",
    "parametro_2": 123
  }
  ```
- **Resposta Sucesso (HTTP 200/201):**
  ```json
  {
    "success": true,
    "data": [],
    "kpis": {}
  }
  ```
- **Códigos de Erro Mapeados:**
  - `400 Bad Request`: Parâmetros inválidos ou obrigatórios faltantes.
  - `401 Unauthorized`: Token ausente ou expirado.
  - `403 Forbidden`: Permissão insuficiente para o recurso.
  - `500 Internal Server Error`: Falha no banco Protheus/Postgres ou serviço externo.

---

## 6. Testes Automatizados Vinculados

### 6.1 Arquivos de Suíte de Testes
- Caminho dos scripts de teste automatizado (ex: `test_nome_modulo.js`).

### 6.2 Casos de Teste Cobertos
| ID | Cenário de Teste | Validação Executada |
| :--- | :--- | :--- |
| **T01** | Teste unitário de cálculo/classificação | Assert de integridade matemática |
| **T02** | Teste de integração com backend Protheus/Postgres | Execução de query real ou mock resiliente |
| **T03** | Verificação de integridade DOM e elementos UI | Checagem de IDs obrigatórios em `index.html` |
| **T04** | Análise sintática léxica | Compilação estrita via `vm.Script` |

### 6.3 Comando para Execução dos Testes
```bash
node test_nome_modulo.js
```

---

## 7. Histórico Recente da Tela

| Versão | Data | Autor | Principais Alterações |
| :--- | :--- | :--- | :--- |
| **v1.0** | AAAA-MM-DD | Nome / Time | Criação inicial da especificação e tela. |
