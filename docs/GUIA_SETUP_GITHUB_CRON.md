# Guia de Configuração: Fechamento Mensal via GitHub Actions

Este documento orienta a configuração do agendamento externo de fechamento mensal dos vendedores (`.github/workflows/fechamento_mensal.yml`) no repositório GitHub.

---

## 1. Por que usar o GitHub Actions como Cron Externo?
- **Independência de Infraestrutura:** Se a aplicação estiver hospedada em nuvem com *spin-down/sleep* por inatividade (ex: plano gratuito do Render), o processo Node.js hiberna na madrugada e o timer interno não roda no minuto exato.
- **Pontualidade:** O GitHub Actions dispara pontualmente todo dia 26 às 00:30 de Brasília (03:30 UTC), acordando a aplicação via requisição HTTP com *retry* automático.
- **Execução Manual em 1 Clique:** O evento `workflow_dispatch` permite que qualquer gestor force a consolidação e fechamento diretamente pela interface do GitHub Actions sem precisar de acesso SSH ou de banco de dados.

---

## 2. Configuração das Secrets no GitHub e Render

### 2.1. Secrets já Cadastradas no GitHub Actions ✅
As variáveis foram geradas e cadastradas no repositório GitHub (`Settings > Secrets and variables > Actions`) via GitHub CLI:

| Secret Name | Valor Cadastrado | Status |
| :--- | :--- | :--- |
| `API_BASE_URL` | `https://conciliacao-fretes.onrender.com` | ✅ **Configurado** |
| `CRON_SECRET` | `bcf11954581ec20c3a5d4d660ad44c480f4f60a66bd245b0814ce10e9385a411` | ✅ **Configurado** |

---

### 2.2. Passo Pendente: Configuração no Render (Servidor) ⏳
Para que a API em produção autorize as requisições do GitHub Actions:
1. Acesse o painel do **Render**: `https://dashboard.render.com/`
2. Selecione o Web Service **`conciliacao-fretes`**.
3. No menu lateral, clique em **`Environment`**.
4. Clique em **`Add Environment Variable`**:
   - **Key:** `CRON_SECRET`
   - **Value:** `bcf11954581ec20c3a5d4d660ad44c480f4f60a66bd245b0814ce10e9385a411`
5. Clique em **`Save Changes`** (o Render fará redeploy automático com a variável ativa em ~60s).

---

## 3. Endpoints Disponíveis

A API expõe dois caminhos idênticos para atender ao cron:
- `POST /api/cron/fechamento-mensal`
- `POST /api/vendedores/fechamento/cron`

### Cabeçalhos Suportados:
```http
Authorization: Bearer <CRON_SECRET>
Content-Type: application/json
```
*(ou `x-cron-secret: <CRON_SECRET>`)*

### Corpo da Requisição (Opcional):
```json
{
  "force": true,
  "dataIni": "",
  "dataFim": "",
  "triggeredBy": "GITHUB_ACTIONS"
}
```

---

## 4. Testando o Workflow Manualmente
1. Vá na aba **Actions** do repositório no GitHub.
2. Na lista de workflows à esquerda, clique em **`Fechamento Mensal dos Vendedores (Dia 26 às 00:30 BRT)`**.
3. Clique no botão **`Run workflow`** à direita.
4. Mantenha os parâmetros padrões ou marque `Forçar execução imediata`.
5. Clique no botão verde **`Run workflow`** e acompanhe os logs da execução em tempo real.
