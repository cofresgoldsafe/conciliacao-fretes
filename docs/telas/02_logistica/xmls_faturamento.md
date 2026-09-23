# Salvar XMLs de Faturamento no Google Drive

> **Macro-Área:** Logística  
> **Identificador DOM:** `#tab-log-xml-faturamento` | **Botão:** `#btnTabLogXmlFaturamento`  
> **Permissão RBAC:** admin, logistica, analista-fin  
> **Status:** Operacional em Produção  
> **Última Atualização:** 23/09/2026 (v8.249 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Otimizar e automatizar o processo diário de salvamento de arquivos XML de notas fiscais de faturamento de saídas no Google Drive corporativo, eliminando o fluxo manual de recorte e colagem a partir da pasta Downloads.
- **Personas Atendidas:** Operador de Logística, Faturamento e Auditoria Fiscal (`admin`, `logistica`, `analista-fin`).

---

## 2. Arquitetura de Código & Componentes
- **Frontend:**
  - `public/index.html`: Container `#tab-log-xml-faturamento` e botão `#btnTabLogXmlFaturamento`.
  - `public/js/logistica_xml_faturamento.js`: Lógica de integração com File System Access API (`showDirectoryPicker`), persistência do `directoryHandle` no IndexedDB, particionamento em chunks de 15 notas e atalhos com fuso horário de Brasília.
  - `public/style.css`: Estilização de botões `.btn-success` e classes de loading.
  - `public/app.js`: Roteamento e lazy-loading do módulo ao clicar na sub-aba de Logística.
- **Backend & Serviços:**
  - `google_drive_service.js`: Conector autônomo da Google Drive API v3 via Service Account do Google Cloud (`gsi-xml-drive-sync@portal-gsi-corporativo.iam.gserviceaccount.com`), autenticação JWT nativa (RS256) e suporte a Drives Compartilhados (Nuvem-para-Nuvem, 100% independente de máquinas ligadas).
  - `logistica_xml_service.js`: Regras canônicas de nomenclatura, roteamento de diretórios multianual, bloqueio de notas canceladas, resolução de XMLs e orquestração do job híbrido (Nuvem prioritária com fallback para disco local).
  - `scripts/sync_xml_drive_18h.js`: Script executável do Job diário das 18:00 (segunda a sexta-feira).
  - `server.js`: Endpoints REST com RBAC e scheduler de background (`startDriveXmlSyncJob18h`).

---

## 3. Banco de Dados & Modelagem
- **Protheus ERP MSSQL:** Tabela `SF2` (Cabeçalho das Notas de Saída), `SD2` (Itens), `SA1` (Clientes).
- **PostgreSQL / Central de XMLs:** Armazenamento centralizado de envelopes XML válidos `<nfeProc>`.
- **IndexedDB Local (Browser):** Banco `portal_gsi_fs_db`, store `handles_store`, chave `gdrive_xml_root_handle` para memorização segura do diretório do Drive.

---

## 4. Regras de Negócio & Padrões Estritos
1. **Nomenclatura Oficial dos Arquivos XML:**
   - Formato canônico: `[SIGLA]-[NF8]-[CHAVE44]-[CLIENTE6].xml`
   - Exemplos:
     - Empresa 14: `MP-00123456-35260948758821000118550010000004091540731944-CLIENT.xml`
     - Empresa 15: `GSI-00000123-35260914061778000115550010000001231622483426-ACOFER.xml`
     - Empresa 16: `OACO-00000728-35260961237790000118550010000007281622483426-SUPERM.xml`
2. **Estrutura de Subpastas no Google Drive:**
   - Raiz Padrão: `G:\Drives compartilhados\Fiscal e Faturamento\NF's\XML's Saídas\`
   - Árvore: `XML's Saídas [ANO]\[EMPRESA]\[MM.ANO]\`
   - Suporte dinâmico e multianual (ex: `XML's Saídas 2026\GSI\09.2026\`, `XML's Saídas 2027\OAÇO\01.2027\`).
3. **Gravação Direta Solta (Sem ZIP):**
   - Os arquivos são salvos diretamente na pasta via `File System Access API` (no browser) ou escrita direta em `G:\` (no Job das 18h).
4. **Governança Fiscal de Notas Canceladas:**
   - Notas fiscais marcadas como `CANCELADA` no ERP Protheus têm a síntese sintética autorizada (`<cStat>100</cStat>`) bloqueada estritamente, prevenindo incoerência em auditorias fiscais.
5. **Job Automático das 18:00 (Segunda a Sexta-feira):**
   - Roda exclusivamente em dias úteis às 18:00 BRT, identificando todas as notas faturadas no dia e gravando os arquivos pendentes de forma idempotente (ignora arquivos que já constam na pasta).

---

## 5. Endpoints REST da API
- `GET /api/logistica/faturamento-notas?empresa=ALL&dataDe=YYYYMMDD&dataAte=YYYYMMDD` (Consulta notas emitidas no período)
- `POST /api/logistica/faturamento-xmls/lote` (Retorna lote fatiado de XMLs e metadados de roteamento para gravação)
- `POST /api/admin/jobs/sync-drive-xmls-18h` (Disparo manual com permissão de administrador ou com flag `--dry-run`)
- `GET /api/admin/jobs/sync-drive-xmls-18h/status` (Consulta do status da última execução do Job)

---

## 6. Testes Automatizados Vinculados
- Execução da suíte completa de testes de regressão:
```bash
node test_logistica_xml_faturamento.js
```
- Execução do teste de dry-run do Job de sincronização:
```bash
node scripts/sync_xml_drive_18h.js --dry-run
```

---

## 7. Histórico & Evolução da Tela
- **v8.249 (23/09/2026):** Ajustes textuais na interface ("Download Automático 18h"), exclusão de avisos redundantes e homologação de salvamento 100% em nuvem via Google Drive API com Service Account.
- **v8.248 (23/09/2026):** Implementação inicial da tela de exportação de XMLs no Google Drive com File System Access API, seleção de período, memorização de pasta, fatiamento em chunks de 15 itens, tratamento anti-duplicação de listeners e Job diário das 18:00 em dias úteis via Google Drive API e disco local.
