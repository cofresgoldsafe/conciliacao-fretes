# Guia de Configuração: Metabase BI Executivo no Portal GSI

Este documento orienta o passo a passo para implantar o **Metabase Open Source** e conectá-lo de forma segura e embutida ao **Portal GSI (Gemini-Cli)**.

---

## 1. Opções de Hospedagem do Metabase

O Metabase é distribuído como uma imagem Docker oficial leve:

### Opção A: Render.com (Recomendado / Mais Rápido)
1. Acesse o [Render Dashboard](https://dashboard.render.com).
2. Clique em **New +** > **Web Service**.
3. Selecione **Deploy an existing image**.
4. Imagem: `metabase/metabase:latest`.
5. Plano de Instância: Selecione pelo menos **1 GB ou 2 GB de RAM** (Starter ou Standard).
6. Variáveis de Ambiente do Render:
   * `MB_DB_TYPE`: `postgres` (se quiser usar um banco Postgres para salvar configurações do Metabase) ou deixe em branco para usar o banco H2 embutido para testes rápidos.
   * `JAVA_OPTS`: `-Xmx1024m` (limita o uso de memória do Java).

### Opção B: Docker Local ou VPS (Linux / Windows)
```bash
docker run -d -p 3001:3000 \
  -e "JAVA_OPTS=-Xmx1024m" \
  --name metabase \
  metabase/metabase:latest
```
Acesse: `http://localhost:3001`

---

## 2. Conectar o Metabase ao Banco do Supabase

1. No assistente inicial do Metabase, crie sua conta de Administrador.
2. Vá em **Adicionar Banco de Dados** (*Add your data*):
   * **Tipo de Banco:** `PostgreSQL`
   * **Nome:** `Supabase GSI Produção`
   * **Host:** Host do pooler do Supabase (ex: `aws-0-sa-east-1.pooler.supabase.com`)
   * **Porta:** `5432` ou `6543`
   * **Nome do Banco:** `postgres`
   * **Usuário:** `postgres.<seu-projeto-id>`
   * **Senha:** Sua senha do Supabase
   * **SSL:** Habilitado (*Require*)
3. O Metabase sincronizará as tabelas e as views criadas na pasta `sql/bi/`:
   * `vw_bi_produtos_estoque` (Saldos por empresa MP/GSI/OACO, preços, valores totais e pontos de pedido)
   * `vw_bi_analise_credito` (Histórico de crédito, scores, riscos, decisões e CNPJs)
   * `vw_bi_atividades_auditoria` (Telemetria, acessos e auditoria de ações dos operadores)
   * `vw_bi_demandas_grupos_comerciais` (Resumo consolidado por grupos comerciais: Cofres, Fragmentadoras, etc.)

---

## 3. Habilitar Incorporação Segura (Embedding)

1. No Metabase, clique no ícone de **Engrenagem** no canto superior direito > **Configurações do Administrador** (*Admin settings*).
2. No menu lateral esquerdo, clique em **Incorporação** (*Embedding*).
3. Ative a opção **Habilitar incorporação em outros aplicativos** (*Enable embedding in other applications*).
4. Clique em **Gerar nova chave secreta** (*Generate new secret key*).
5. Copie a chave hexadecimal de 64 caracteres gerada (`METABASE_SECRET_KEY`).

---

## 4. Criar e Habilitar o Dashboard Executivo

1. Crie um novo Dashboard no Metabase com os gráficos de Vendas, Margens e Contas a Receber.
2. Clique no botão de compartilhamento/incorporação do Dashboard (ícone de seta/código).
3. Selecione **Incorporação em outros aplicativos** (*Embedding in other applications*).
4. Escolha **Incorporação Segura (Token Assinado)** (*Signed embedding*).
5. Defina os parâmetros como permitidos/travados e clique em **Publicar**.
6. Guarde o ID do Dashboard (geralmente `1` se for o primeiro criado).

---

## 5. Configurar as Variáveis no Portal GSI (`Gemini-Cli`)

No seu arquivo `.env` local ou no painel de Environment do Render do `Gemini-Cli`, adicione:

```env
# URL onde o seu Metabase está rodando (sem barra no final)
METABASE_SITE_URL=https://metabase-gsi.onrender.com

# Chave secreta de 64 caracteres gerada no passo 3
METABASE_SECRET_KEY=9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a

# ID do dashboard executivo criado no passo 4 (padrão: 1)
METABASE_EXEC_DASHBOARD_ID=1
```

---

## 6. Pronto!
Ao acessar o Portal GSI com o usuário `alexandre` ou qualquer perfil `admin`, a aba **`📊 BI EXECUTIVO`** carregará instantaneamente seu dashboard integrado, sem necessidade de login duplo.
