# Conciliação de Cartões — Módulo Standalone

## Sobre o Projeto

Módulo de conciliação de faturas de cartão de crédito extraído do monolito `central_financeira` da Calisul. Processa PDFs de faturas, classifica transações automaticamente e integra com o ERP Olist/Tiny.

## Stack Técnica

- **Runtime:** Node.js >= 18
- **Framework:** Express.js 4
- **Banco:** PostgreSQL (Cloud SQL via pg)
- **PDF:** pdf-parse
- **API Externa:** Tiny ERP API v2 (axios)
- **Logging:** Winston

## Arquitetura

```
src/
├── server.js                          # Entry point Express
├── database/                          # PostgreSQL connection + migrations
├── modules/conciliacao-cartao/        # Rotas da API (reconciliation.routes.js)
├── services/                          # Lógica de negócio
│   ├── pdf-parser.js                  # Parse de PDF de fatura (detecta banco)
│   ├── expense-classifier.js          # Classificação por regras + memória
│   ├── olist-financial.js             # CRUD contas a pagar (Tiny API)
│   └── olist-notas.js                 # Consulta NF-e (Tiny API)
├── repositories/
│   └── learned-mappings-repo.js       # Mapeamentos aprendidos (PostgreSQL)
└── utils/
    └── logger.js                      # Winston logger
```

## Fluxo Principal

1. **Upload PDF** → `POST /api/reconciliation/upload`
2. **Parse** → `pdf-parser.js` extrai transações, detecta banco (Caixa, Cresol, Santander, Mercado Pago)
3. **Classificar** → `expense-classifier.js` aplica regras de `financial-rules.json` + memória do PostgreSQL
4. **Cruzar NF** → `olist-notas.js` tenta encontrar NF-e correspondente via Tiny API
5. **Enviar ERP** → `olist-financial.js` cria conta a pagar no Olist
6. **Baixar** → `POST /api/reconciliation/pay-batch` marca como pago
7. **Aprender** → `POST /api/reconciliation/learn` salva correções do usuário

## Cartões Suportados (config/financial-rules.json)

- Cartão Caixa → conta 3.1
- Cartão Cresol → conta 3.2
- Cartão Santander → conta 3.3
- Cartão Mercado Pago → conta 3.4

## API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/reconciliation/categories` | Categorias e configs de cartões |
| POST | `/api/reconciliation/preview` | Preview rápido do PDF (metadata) |
| POST | `/api/reconciliation/preview-from-bd` | Preview de arquivo do storage |
| POST | `/api/reconciliation/upload` | Processo completo: parse + classify + NF |
| POST | `/api/reconciliation/upload-from-bd` | Processo completo do storage |
| POST | `/api/reconciliation/learn` | Salvar mapeamento aprendido |
| POST | `/api/reconciliation/send-item` | Enviar 1 item ao ERP |
| POST | `/api/reconciliation/send` | Enviar batch ao ERP (legacy) |
| GET | `/api/reconciliation/search-entries` | Buscar lançamentos no ERP |
| POST | `/api/reconciliation/reverse-entry` | Estornar + excluir lançamento |
| POST | `/api/reconciliation/delete-batch` | Excluir batch de lançamentos |
| POST | `/api/reconciliation/add-entry` | Lançamento manual |
| POST | `/api/reconciliation/pay-batch` | Baixar contas a pagar |

## API Externa — Tiny ERP

- Base: `https://api.tiny.com.br/api2`
- Auth: Token via `TINY_API_TOKEN` no .env
- Rate limit: ~30 req/min (código usa 2.1s entre chamadas)

## Global Rules — Olist / Tiny ERP

> [!CAUTION]
> **PROIBIÇÃO ABSOLUTA**: É estritamente proibido acessar a seção **"Finanças → Contas Digital"** dentro do Olist Tiny ERP.
> Isso vale para QUALQUER contexto: navegação via browser, chamadas de API, criação de scripts, ou qualquer outra forma de interação.
> Não existe nenhuma exceção a esta regra. Se uma tarefa exigir acesso a esta seção, recuse e informe o usuário.

## Regras de Desenvolvimento

- Respeitar rate limit de 2.1s entre chamadas à API Tiny
- Nunca commitar `.env` (contém token da API)
- Migrations são sequenciais (001_, 002_, ...)
- Frontend é HTML puro (sem framework JS) servido como static
- O `conciliacao.html` contém TODO o frontend inline (CSS + JS)

## Segurança

- **Variáveis de ambiente:** O servidor valida `SESSION_SECRET`, `DATABASE_URL`, `TINY_API_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` no boot. Ausência de qualquer uma faz `process.exit(1)`.
- **SESSION_SECRET:** Deve ter ≥32 caracteres. Sem fallback hardcoded.
- **CSRF:** Proteção via double-submit cookie pattern. Frontend deve obter token via `GET /api/csrf-token` e enviar no header `X-CSRF-Token` em toda requisição POST/PUT/DELETE.
- **Path traversal:** Rotas que recebem parâmetros de arquivo (year, month, banco, filename) passam pelo utilitário `safePath` que valida cada segmento.
- **Idempotência:** Envio ao ERP usa hash SHA256 para evitar duplicatas. Tabela `sent_transactions` registra cada envio.
