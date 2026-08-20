# 📌 BACKLOG & CHECKPOINT DE SEGURANÇA E HARDENING DO PROJETO

> **Projeto:** Plataforma de Apoio GSI Multi-Empresas (Integração Protheus / Supabase / Inter)  
> **Diretório:** `C:\Users\Alexandre\Documents\Gemini-Cli`  
> **Data do Levantamento:** 19 de Agosto de 2026  
> **Status Geral:** ⚠️ **4 Pendências Críticas | 2 Médias | 2 Melhorias de Higiene**  

---

## 🎯 1. Checklist Rápido de Ação

Marque os itens conforme forem implementados nas próximas sessões de desenvolvimento deste projeto:

- [ ] **[CRÍTICO 01]** Implementar autenticação via JWT (`jsonwebtoken`) e middlewares `requireAuth` e `requireRole('admin')` em todas as rotas `/api/admin/*` e `/api/vipp/*`.
- [ ] **[CRÍTICO 02]** Criptografar senhas com `bcryptjs` no cadastro/login e remover senhas em texto puro do `postgres_db.js`, `data/users.json` e `server.js`.
- [ ] **[CRÍTICO 03]** Sanitizar entradas de busca T-SQL em `protheus_db.js` para neutralizar vetores de SQL Injection em consultas na Railway.
- [ ] **[CRÍTICO 04]** Remover chaves de fallback e caminhos absolutos hardcoded (`protheus_db.js`, `query_protheus.js`, `inter_api.js`).
- [ ] **[MÉDIO 05]** Adicionar restrições de tamanho (max 15MB) e extensões permitidas (`.pdf`, `.csv`, `.txt`) no `multer` em `server.js`.
- [ ] **[MÉDIO 06]** Incluir o pacote `pypdf` na instalação de dependências Python no `Dockerfile`.
- [ ] **[BAIXO 07]** Configurar política restritiva de CORS para a URL oficial em produção (`https://conciliacao-fretes.onrender.com`).
- [ ] **[BAIXO 08]** Ocultar `err.message` técnicos brutos nas respostas HTTP 500 para evitar *Information Disclosure*.

---

## 🔍 2. Detalhamento Técnico das Pendências

---

### 🔴 Pendência 01: Autenticação Real & Controle de Acesso Baseado em Perfis (RBAC)
* **Arquivos:** [`server.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/server.js#L45-L52), [`server.js:L265-L330`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/server.js#L265-L330), [`public/app.js:L17-L34`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/public/app.js#L17-L34)
* **Problema:**
  1. As rotas `/api/admin/users`, `/api/admin/users/save`, `/api/admin/users/delete`, `/api/admin/audit-summary` e `/api/vipp/config` estão abertas, permitindo chamadas diretas sem verificação de identidade.
  2. O backend confia cegamente no cabeçalho `x-user-username` enviado pelo navegador (função `getUserFromReq`), permitindo que qualquer usuário altere o cabeçalho e finja ser o administrador `alexandre`.
  3. O token retornado no login (`auth-token-...`) é uma string estática e não possui assinatura digital nem validação.
* **Ação Necessária:**
  - Instalar `jsonwebtoken` (`npm install jsonwebtoken`).
  - Gerar token JWT assinado no endpoint `/api/auth/login` com segredo seguro em variável de ambiente `JWT_SECRET`.
  - Criar middlewares no Express:
    ```javascript
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'chave-secreta-forte-gerada';

    function requireAuth(req, res, next) {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) return res.status(401).json({ success: false, message: 'Token de autenticação não fornecido.' });
      
      try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
      } catch (e) {
        return res.status(401).json({ success: false, message: 'Sessão inválida ou expirada.' });
      }
    }

    function requireRole(...allowedRoles) {
      return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
          return res.status(403).json({ success: false, message: 'Acesso negado: privilégios insuficientes.' });
        }
        next();
      };
    }
    ```
  - Proteger rotas sensíveis:
    ```javascript
    app.get('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => { ... });
    app.post('/api/admin/users/save', requireAuth, requireRole('admin'), async (req, res) => { ... });
    app.post('/api/admin/users/delete', requireAuth, requireRole('admin'), async (req, res) => { ... });
    app.post('/api/vipp/config', requireAuth, requireRole('admin'), (req, res) => { ... });
    ```
  - Atualizar o frontend [`public/app.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/public/app.js) para enviar o cabeçalho `Authorization: Bearer <token>` em vez de apenas `x-user-username`.

---

### 🔴 Pendência 02: Criptografia de Senhas com bcryptjs
* **Arquivos:** [`postgres_db.js:L99`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/postgres_db.js#L99), [`postgres_db.js:L264-L290`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/postgres_db.js#L264-L290), [`data/users.json`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/data/users.json), [`server.js:L194-L235`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/server.js#L194-L235)
* **Problema:**
  - As senhas dos operadores e vendedores estão armazenadas em texto plano (`pass: '321654'`, `pass: '102030'`, etc.) no PostgreSQL, no JSON local e no código-fonte.
* **Ação Necessária:**
  - Instalar `bcryptjs` (`npm install bcryptjs`).
  - No salvamento de usuário (`saveUser`):
    ```javascript
    const bcrypt = require('bcryptjs');
    const hashedPass = userData.pass ? await bcrypt.hash(String(userData.pass).trim(), 10) : undefined;
    ```
  - No login (`/api/auth/login`):
    ```javascript
    const isMatch = await bcrypt.compare(cleanPass, userFound.pass);
    ```
  - Remover senhas fixas gravadas em [`data/users.json`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/data/users.json) e substituí-las por hashes.

---

### 🔴 Pendência 03: Blindagem contra Injeção de SQL (T-SQL)
* **Arquivos:** [`protheus_db.js:L124`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/protheus_db.js#L124), [`protheus_db.js:L215-L230`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/protheus_db.js#L215-L230), [`protheus_db.js:L362-L370`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/protheus_db.js#L362-L370), [`protheus_db.js:L462`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/protheus_db.js#L462)
* **Problema:**
  - Strings vindas das requisições HTTP (`cleanTerm`, `nomeCli`, `codWeb`, `numPed`, `numNF`, `numPedido`) são inseridas diretamente via interpolação (`${var}`) nas queries T-SQL.
* **Ação Necessária:**
  - Criar uma função de sanitização e escape estrito antes de montar qualquer instrução SQL:
    ```javascript
    function sanitizeSqlParam(value) {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/'/g, "''")      // Duplica aspas simples (escape padrão SQL Server)
        .replace(/;/g, '')        // Remove ponto e vírgula para evitar stacking queries
        .replace(/--/g, '')       // Remove comentários de linha
        .replace(/\/\*/g, '')     // Remove comentários de bloco
        .trim();
    }
    ```
  - Aplicar `sanitizeSqlParam()` em todas as variáveis recebidas do cliente antes da montagem das cláusulas `WHERE`.

---

### 🔴 Pendência 04: Limpeza de Segredos e Chaves Hardcoded
* **Arquivos:** [`protheus_db.js:L6`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/protheus_db.js#L6), [`query_protheus.js:L5`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/query_protheus.js#L5), [`inter_api.js:L54-L61`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/inter_api.js#L54-L61)
* **Problema:**
  1. Em `protheus_db.js`: `process.env.PROTHEUS_API_KEY || 'ProtheusClaude#2026'`.
  2. Em `query_protheus.js`: `envPath = 'C:\\Users\\Alexandre\\Documents\\claude\\protheus-mcp\\.env'`.
  3. Em `inter_api.js`: Caminhos locais absolutos do drive `D:\`.
* **Ação Necessária:**
  - Exigir `process.env.PROTHEUS_API_KEY` sem chave padrão em código de produção.
  - Remover ou mover `query_protheus.js` para pasta de scripts utilitários locais ignorada no Git.
  - Assegurar que chaves e certificados mTLS sejam lidos exclusivamente via variáveis de ambiente no Render (`INTER_CERT_14`, `INTER_KEY_14`, etc.).

---

### 🟠 Pendência 05: Proteção e Limites no Upload de Arquivos (Multer)
* **Arquivo:** [`server.js:L97-L107`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/server.js#L97-L107)
* **Problema:**
  - O `multer` não possui limite de tamanho de arquivo nem validação de tipo MIME, permitindo upload de qualquer formato ou tamanho.
* **Ação Necessária:**
  - Configurar limites e filtro de extensões:
    ```javascript
    const upload = multer({
      storage: storage,
      limits: {
        fileSize: 15 * 1024 * 1024 // Limite máximo de 15MB
      },
      fileFilter: function (req, file, cb) {
        const allowedExts = ['.pdf', '.csv', '.txt'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedExts.includes(ext)) {
          cb(null, true);
        } else {
          cb(new Error('Tipo de arquivo não permitido. Envie apenas PDF, CSV ou TXT.'));
        }
      }
    });
    ```
  - Implementar rotina de limpeza periódica ou exclusão de arquivos da pasta `uploads/` após o processamento pelo parser Python.

---

### 🟠 Pendência 06: Inclusão do pypdf no Dockerfile
* **Arquivos:** [`Dockerfile:L12`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/Dockerfile#L12), [`parser_correios.py:L5`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/parser_correios.py#L5)
* **Problema:**
  - O `Dockerfile` instala apenas `pdfplumber`, mas o `parser_correios.py` requer a biblioteca `pypdf`.
* **Ação Necessária:**
  - Atualizar a linha 12 do [`Dockerfile`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/Dockerfile):
    ```dockerfile
    RUN python3 -m pip install --break-system-packages pdfplumber pypdf
    ```

---

### 🟡 Pendência 07: Restrição de Origem no CORS
* **Arquivo:** [`server.js:L54`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/server.js#L54)
* **Problema:**
  - `app.use(cors())` permite requisições de qualquer origem (`*`).
* **Ação Necessária:**
  - Restringir para a URL de produção e localhost:
    ```javascript
    const allowedOrigins = [
      'https://conciliacao-fretes.onrender.com',
      'http://localhost:3000'
    ];
    app.use(cors({
      origin: function(origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
          callback(null, true);
        } else {
          callback(new Error('Bloqueado pela política de CORS'));
        }
      },
      credentials: true
    }));
    ```

---

### 🟡 Pendência 08: Tratamento Seguro de Mensagens de Erro
* **Arquivos:** [`server.js:L338`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/server.js#L338), [`server.js:L805`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/server.js#L805), [`server.js:L921`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/server.js#L921)
* **Problema:**
  - Respostas com status 500 retornam o erro bruto da infraestrutura (`err.message`), revelando nomes de tabelas ou detalhes do banco.
* **Ação Necessária:**
  - Registrar o erro internamente com `console.error` e responder ao cliente com mensagem amigável genérica:
    ```javascript
    console.error('Erro interno na operação:', err);
    res.status(500).json({ success: false, message: 'Ocorreu um erro interno ao processar a solicitação.' });
    ```

---

## 📊 3. Matriz de Prioridade para o Próximo Ciclo de Trabalho

| Prioridade | ID | Pendência | Impacto | Esforço Estimado |
| :---: | :---: | :--- | :---: | :---: |
| **P1** | `SEC-01` | Autenticação JWT + Middlewares de Permissão | 🔴 Alto | 1 a 2 horas |
| **P1** | `SEC-02` | Hashing de Senhas com bcryptjs | 🔴 Alto | 30 a 45 min |
| **P1** | `SEC-03` | Sanitização de Entradas T-SQL contra SQLi | 🔴 Alto | 30 a 45 min |
| **P2** | `SEC-04` | Remoção de Chaves e Caminhos Hardcoded | 🔴 Alto | 15 min |
| **P2** | `SEC-05` | Multer: Limites de Tamanho e Validação de Extensão | 🟠 Médio | 20 min |
| **P2** | `SEC-06` | Dockerfile: Adicionar `pypdf` ao pip | 🟠 Médio | 5 min |
| **P3** | `SEC-07` | Restrição de CORS e Tratamento Seguro de Erros | 🟡 Baixo | 15 min |
