# Arquitetura Técnica: Gestão e Catálogo de Produtos no CRM Comercial

> **Documento de Decisão Arquitetural (ADR)**  
> **Módulo:** CRM Comercial B2B (`#tab-bi-crm`)  
> **Status:** Aprovado em Fase 1 (Ingestão & Análise de Trade-offs)  
> **Data:** 24/09/2026  

---

## 1. Contexto e Problema

No CRM Comercial nativo do Portal GSI, as oportunidades de venda (`crm_deals`) possuem uma lista de itens cotados (`itens_cotados` em JSONB). Atualmente, esses campos de produto (código, descrição, quantidade, preço de tabela, preço negociado) são preenchidos de forma manual e livre pelo usuário, sem qualquer vínculo ou busca em banco de dados.

Com a evolução do CRM para geração de propostas comerciais formais (PDF e envio ao cliente) e integração com fretes (cálculo de peso total e cubagem), tornou-se necessário responder a duas questões centrais:
1. **Onde buscar os dados de produtos?** Diretamente no banco do Protheus (via Railway Relay) ou através de uma tabela espelho no nosso banco Supabase (PostgreSQL)?
2. **Quais dados são necessários para viabilizar as propostas comerciais e a operação de vendas?**

---

## 2. Diagnóstico da Base Protheus (Medição Real em Produção)

Para fundamentar a decisão técnica com dados concretos, foi executada uma auditoria ao vivo na base Protheus via Railway Relay:

| Métrica Auditada | Valor Real Encontrado | Observações |
| :--- | :--- | :--- |
| **Total de Registros em SB1090 (Catálogo Mestre)** | **1.882 produtos** | Base enxuta, tamanho total < 1 MB em disco. |
| **Total de Produtos Acabados (PA)** | **1.110 produtos** | O que o comercial efetivamente cota e vende. |
| **Produtos Outros / Insumos (OI, GG, PI)** | 772 produtos | Peças, insumos e intermediários. |
| **Tabelas SB1140 (MP) e SB1150 (GSI)** | 0 registros | Catálogo centralizado na Empresa 09 (`SB1090`). |
| **Tabela SB1160 (OAÇO)** | 1.086 produtos | Catálogo da Empresa 16. |
| **Latência Média de Consulta Railway Relay** | **400 ms a 2.500 ms** | Envolve salto HTTPS Node -> Railway -> MSSQL Protheus. |
| **Latência de Consulta Indexada no Supabase** | **< 10 ms** | Consulta local PostgreSQL com índices B-Tree e ILIKE. |

---

## 3. Matriz Comparativa de Trade-offs

| Critério de Avaliação | Opção A: Busca Direta no Protheus | Opção B: Tabela Espelho no Supabase (`crm_produtos`) |
| :--- | :--- | :--- |
| **Desempenho no Autocomplete (UX)** | 🔴 **Lento / Ruim:** Latência de 0.5s a 2.5s por tecla digitada, sensação de travamento na interface. | 🟢 **Instantâneo:** Resposta em < 10ms, digitação fluida e sem "engasgos". |
| **Carga e Consumo no Protheus** | 🟡 **Intermediário a Alto:** Embora sejam ~30 deals/dia, cada busca interativa de produto dispara de 2 a 5 queries SQL `LIKE` no ERP. | 🟢 **Zero durante o expediente:** 1 única sincronização diária em lote (~2 segundos) ou sob demanda. Zero requisições durante o dia. |
| **Resiliência e Tolerância a Falhas** | 🔴 **Ponto Único de Falha:** Se o Railway Relay, VPN ou Protheus oscilar, a equipe comercial fica impedida de cotar produtos e fechar vendas. | 🟢 **Alta Disponibilidade (Zero-Downtime):** O CRM opera normalmente mesmo com o Protheus reiniciando ou fora do ar. |
| **Campos Específicos para Propostas** | 🟡 **Complexo:** Necessita trazer múltiplos campos em queries dinâmicas a cada seleção. | 🟢 **Completo e Extensível:** Armazena NCM, Peso Líquido, Peso Bruto, IPI, Preço de Tabela, Unidade e Dimensões. |
| **Imutabilidade Histórica da Proposta** | 🔴 Se a proposta depender de reconsultar o Protheus, alterações futuras de preço/NCM adulteram o histórico do negócio. | 🟢 **Snapshot Congelado:** Ao adicionar o item, grava cópia fiel no JSONB `itens_cotados` do deal, garantindo auditoria eterna. |
| **Alinhamento com Padrões do Portal GSI** | 🔴 Quebra a uniformidade do sistema. | 🟢 **DRY e Padronizado:** Replica exatamente a mesma arquitetura madura já usada em `crm_clientes` e `produtos_saldo_estoque`. |

---

## 4. Decisão Arquitetural Recomendada: Opção B (Espelho Otimizado com Fallback)

Adota-se a **Opção B (Tabela Espelho `crm_produtos` no Supabase PostgreSQL)** com sincronização periódica e suporte a snapshot imutável para geração de propostas:

### 4.1 Schema da Tabela `crm_produtos` (Supabase PostgreSQL)
```sql
CREATE TABLE IF NOT EXISTS crm_produtos (
    codigo VARCHAR(50) PRIMARY KEY,
    descricao VARCHAR(255) NOT NULL,
    ncm VARCHAR(20),
    unidade VARCHAR(10) DEFAULT 'UN',
    tipo VARCHAR(10) DEFAULT 'PA',
    grupo VARCHAR(50),
    preco_tabela NUMERIC(14, 2) DEFAULT 0.00,
    peso_liquido NUMERIC(12, 4) DEFAULT 0.0000,
    peso_bruto NUMERIC(12, 4) DEFAULT 0.0000,
    aliquota_ipi NUMERIC(6, 2) DEFAULT 0.00,
    bloqueado BOOLEAN DEFAULT FALSE,
    custom JSONB DEFAULT '{}'::jsonb,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices B-Tree para autocomplete instantâneo
CREATE INDEX IF NOT EXISTS idx_crm_produtos_desc ON crm_produtos(descricao);
CREATE INDEX IF NOT EXISTS idx_crm_produtos_grupo ON crm_produtos(grupo);
CREATE INDEX IF NOT EXISTS idx_crm_produtos_bloqueado ON crm_produtos(bloqueado);
```

### 4.2 Campos Extraídos do Protheus (`SB1090` / `SB1160`)
- `B1_COD` ➔ `codigo`: Identificador único do produto no ERP.
- `B1_DESC` ➔ `descricao`: Descrição comercial oficial do item.
- `B1_POSIPI` ➔ `ncm`: Classificação Fiscal / NCM (obrigatório para propostas e regras tributárias).
- `B1_PESO` ➔ `peso_liquido`: Peso em kg (essencial para cálculo de frete e capacidade de transporte).
- `B1_PESBRU` ➔ `peso_bruto`: Peso bruto para cotação em transportadoras.
- `B1_PRV1` ➔ `preco_tabela`: Preço de venda sugerido da Tabela 1.
- `B1_UM` ➔ `unidade`: Unidade de medida comercial (`UN`, `PC`, etc.).
- `B1_GRUPO` ➔ `grupo`: Grupo comercial (`001` Cofres, `002` Fragmentadoras, `010` Plastificação, `018` Armários).
- `B1_IPI` ➔ `aliquota_ipi`: Percentual de IPI para destaque na proposta quando aplicável.
- `B1_MSBLQL` ➔ `bloqueado`: Flag de produto ativo (`'2'`) ou bloqueado (`'1'`), impedindo venda de itens descontinuados.

### 4.3 Estratégia de Sincronização
1. **Sincronização em Lote Ultra-Rápida:** Como são apenas ~1.500 produtos ativos, a extração de `SB1090` e `SB1160` leva meros **2 a 3 segundos**.
2. **Disparo Programado:** Job diário automático (ex: às 06h00 da manhã, junto com a atualização de saldos).
3. **Botão de Atualização Sob Demanda:** Botão discreto no CRM ("Sincronizar Catálogo Protheus") para atualização imediata quando um novo produto for cadastrado no Protheus.

### 4.4 Mecânica da Proposta Comercial e Snapshot Imutável
1. **Digitação no Deal:** No modal de oportunidade, ao digitar no campo de código ou descrição, o autocomplete pesquisa em `crm_produtos`.
2. **Auto-preenchimento:** Ao selecionar o item, preenchem-se automaticamente: Código, Descrição, Preço Tabela, Unidade, NCM e Peso.
3. **Liberdade do Vendedor:** Quantidade e Preço Negociado continuam editáveis com cálculo automático de subtotal e desconto.
4. **Item Avulso/Customizado:** Preserva-se a possibilidade de digitar produtos ou serviços avulsos (ex: içamento, personalização de pintura) que não constem no Protheus.
5. **Snapshot na Oportunidade:** Os dados ficam gravados no JSONB `itens_cotados` de `crm_deals`. A proposta comercial sempre consumirá os dados congelados no momento da negociação, imune a alterações cadastrais posteriores no ERP.
