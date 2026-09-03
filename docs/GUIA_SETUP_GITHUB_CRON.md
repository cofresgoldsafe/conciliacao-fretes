# Guia de Configuração: Fechamento Mensal via GitHub Actions

Este documento orienta a configuração do agendamento externo de fechamento mensal dos vendedores (`.github/workflows/fechamento_mensal.yml`) no repositório GitHub.

---

## 1. Por que usar o GitHub Actions como Cron Externo?
- **Independência de Infraestrutura:** Se a aplicação estiver hospedada em nuvem com *spin-down/sleep* por inatividade (ex: plano gratuito do Render), o processo Node.js hiberna na madrugada e o timer interno não roda no minuto exato.
- **Pontualidade:** O GitHub Actions dispara pontualmente todo dia 26 às 00:30 de Brasília (03:30 UTC), acordando a aplicação via requisição HTTP com *retry* automático.
- **Execução Manual em 1 Clique:** O evento `workflow_dispatch` permite que qualquer gestor force a consolidação e fechamento diretamente pela interface do GitHub Actions sem precisar de acesso SSH ou de banco de dados.

---

## 2. Configuração das Secrets no GitHub

No repositório do projeto no GitHub:
1. Acesse: **Settings** > **Secrets and variables** > **Actions**
2. Clique no botão **`New repository secret`**
3. Adicione as 2 variáveis secretas abaixo:

| Secret Name | Valor de Exemplo | Descrição |
| :--- | :--- | :--- |
| `API_BASE_URL` | `https://portal-faturas.onrender.com` | A URL pública base onde a API está hospedada (sem barra `/` no final). |
| `CRON_SECRET` | *(um segredo longo e aleatório)* | A chave secreta compartilhada entre o GitHub Actions e as variáveis de ambiente da aplicação. |

> [!IMPORTANT]
> A mesma chave cadastrada em `CRON_SECRET` no GitHub deve ser configurada nas **Environment Variables** do servidor (ex: painel de controle do Render / arquivo `.env` de produção).

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
