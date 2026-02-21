# Plano de Agentes — Execução Paralela das Correções

**Data:** 21/02/2026  
**Referência:** [PLANO-CORRECOES.md](file:///Users/guilhermeeller/02_AntiGravity/central_financeira/conciliacao-cartoes/PLANO-CORRECOES.md)

---

## Como usar este documento

1. Abra uma sessão de agente para cada slot (A, B, C…)
2. Copie o **prompt completo** do agente correspondente
3. Cole na sessão do agente e deixe rodar
4. Só inicie a **Rodada 2** quando todos os agentes da Rodada 1 tiverem terminado e o código estiver mergeado

---

## Regras de Ouro

- **Cada agente trabalha APENAS nos arquivos listados** — se precisar tocar outro arquivo, pare e pergunte
- **Cada agente cria seu próprio branch** a partir de `master` antes de começar
- **Nunca dois agentes mexem no mesmo arquivo** simultaneamente
- **Teste manual do fluxo completo** após cada merge (upload → classificar → enviar → baixar)
- **Atualize o CLAUDE.md** se a correção alterar comportamento documentado
- **Timeout:** Se um agente não finalizar em **30 minutos**, cancelar, revisar o prompt e reiniciar
- **Smoke test antes do merge:** Após cada agente terminar, rodar `node src/server.js` e verificar que inicia sem crash + `/health` retorna OK

---

## ═══════════════════════════════════════════

## RODADA 1 — Segurança + Integridade de Dados

## ═══════════════════════════════════════════

Todos os 3 agentes desta rodada podem rodar **simultaneamente**.  
Pré-requisito: nenhum.

---

### 🤖 AGENTE A — Server Core & Segurança

**Branch:** `fix/security-server-core`  
**Itens do plano:** 1.1, 1.2, 1.4, 1.5  
**Arquivos que este agente pode tocar:**

- `src/server.js`
- `CLAUDE.md`
- `.env.example`
- `package.json` (apenas para adicionar dependência `csrf-sync` ou similar)

**⛔ NÃO TOCAR:** Nenhum arquivo de rotas, services, migrations ou módulos.

#### Prompt para o Agente A

```
Você vai executar correções de segurança no projeto "Conciliação de Cartões".

CONTEXTO DO PROJETO:
- Node.js + Express 4, PostgreSQL (Cloud SQL), frontend HTML puro
- Entry point: src/server.js
- Leia o CLAUDE.md na raiz para entender a arquitetura
- Leia o PLANO-CORRECOES.md na raiz para o detalhamento completo

IMPORTANTE: Antes de qualquer alteração, crie o branch `fix/security-server-core` a partir de master.

Você deve executar APENAS os itens 1.1, 1.2, 1.4 e 1.5 do PLANO-CORRECOES.md. Resumo:

TAREFA 1 — Eliminar session secret hardcoded (item 1.1):
- Arquivo: src/server.js
- Na linha que contém `secret: process.env.SESSION_SECRET || 'calisul-financeira-secret-key-12345'`
- Remover o fallback hardcoded
- Adicionar, ANTES da função bootstrap(), uma verificação que:
  - Confere se process.env.SESSION_SECRET existe
  - Confere se tem pelo menos 32 caracteres
  - Se falhar, faz console.error com mensagem explicativa e process.exit(1)
- Atualizar o .env.example com SESSION_SECRET documentado

TAREFA 2 — Proteção CSRF (item 1.2):
- Arquivo: src/server.js
- ⚠️ NÃO usar o pacote `csurf` — ele está descontinuado
- Instalar `csrf-sync` (npm install csrf-sync) ou implementar double-submit cookie pattern manualmente
- Adicionar middleware CSRF APÓS o middleware de sessão e passport
- O middleware deve:
  - Gerar token CSRF e disponibilizar via rota GET /api/csrf-token
  - Validar header X-CSRF-Token em todas as requisições POST/PUT/DELETE
  - Retornar 403 com mensagem clara quando o token for inválido
- NÃO alterar os arquivos de frontend/HTML — apenas o server.js

TAREFA 3 — Validação de variáveis de ambiente obrigatórias (item 1.4):
- Arquivo: src/server.js
- No início do arquivo (antes de bootstrap), criar função validateEnv() que:
  - Define lista de variáveis obrigatórias: SESSION_SECRET, DATABASE_URL, TINY_API_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
  - Verifica se cada uma existe e não está vazia
  - Se alguma faltar, loga EXATAMENTE quais estão faltando
  - Faz process.exit(1) se qualquer obrigatória estiver ausente
- Chamar validateEnv() antes de bootstrap()
- Atualizar o .env.example com todas as variáveis documentadas

TAREFA 4 — Atualizar CLAUDE.md (item 1.5):
- Arquivo: CLAUDE.md
- Substituir toda referência a SQLite por PostgreSQL
- Stack Técnica: trocar "SQLite (better-sqlite3) — apenas para learned_mappings" por "PostgreSQL (Cloud SQL via pg)"
- Arquitetura: trocar "SQLite connection + migrations" por "PostgreSQL connection + migrations"
- Repositório: trocar "Mapeamentos aprendidos (SQLite)" por "Mapeamentos aprendidos (PostgreSQL)"
- No fluxo principal e demais seções: substituir menções a SQLite

RESTRIÇÕES:
- NÃO toque em nenhum arquivo fora de: src/server.js, CLAUDE.md, .env.example, package.json
- NÃO altere rotas, services ou migrations
- Faça commit atômico por tarefa com mensagens claras em português
- Ao finalizar, rode `node src/server.js` (sem .env) para confirmar que falha com mensagem clara, e com .env para confirmar que inicia normalmente
- Ao finalizar, liste exatamente o que foi alterado e como testar
```

---

### 🤖 AGENTE B — Rotas & Path Safety

**Branch:** `fix/path-safety-constraints`  
**Itens do plano:** 1.3, 2.3  
**Arquivos que este agente pode tocar:**

- `src/modules/conciliacao-cartao/reconciliation.routes.js`
- Nova migration: `src/database/migrations/011_add_unique_constraints.js`
- `src/utils/` (pode criar `safe-path.js` se necessário)

**⛔ NÃO TOCAR:** `src/server.js`, `src/services/`, `package.json`

#### Prompt para o Agente B

```
Você vai executar correções de segurança e integridade de dados no projeto "Conciliação de Cartões".

CONTEXTO DO PROJETO:
- Node.js + Express 4, PostgreSQL (Cloud SQL), frontend HTML puro
- Rotas principais: src/modules/conciliacao-cartao/reconciliation.routes.js
- Migrations ficam em: src/database/migrations/ (sequenciais: 001_, 002_, ... a última é 010_)
- Leia o CLAUDE.md na raiz para entender a arquitetura
- Leia o PLANO-CORRECOES.md na raiz para o detalhamento completo

IMPORTANTE: Antes de qualquer alteração, crie o branch `fix/path-safety-constraints` a partir de master.

Você deve executar APENAS os itens 1.3 e 2.3 do PLANO-CORRECOES.md. Resumo:

TAREFA 1 — Corrigir path traversal (item 1.3):
- Arquivo: src/modules/conciliacao-cartao/reconciliation.routes.js
- Nas rotas /upload-from-bd e /preview-from-bd, os parâmetros year, month, banco e filename são usados para montar caminhos de arquivo SEM sanitização
- Criar função utilitária safePath(baseDir, ...segments) em src/utils/safe-path.js que:
  - Usa path.resolve() para montar o caminho final
  - Verifica que o resultado começa com o baseDir esperado (previne directory traversal)
  - Rejeita segmentos que contenham "..", "/" ou "\"
  - Valida formatos: year = 4 dígitos, month = 2 dígitos, banco = alfanumérico+hífens, filename = termina em .pdf ou .xls/.xlsx
  - Retorna o caminho seguro ou lança erro
- Aplicar safePath() em TODAS as rotas que montam caminhos a partir de parâmetros do usuário
- Retornar 400 com log de alerta quando path traversal for detectado

TAREFA 2 — Constraint de unicidade em statements (item 2.3):
- Criar nova migration: src/database/migrations/011_add_unique_constraints.js
- A migration deve:
  - Adicionar constraint UNIQUE(card_name, statement_date, filename) na tabela card_statements
  - Ter handler de rollback (DROP CONSTRAINT)
- No reconciliation.routes.js, na rota de upload:
  - Tratar erro de violação de unicidade do PostgreSQL (código 23505)
  - Retornar mensagem amigável: "Esta fatura já foi processada anteriormente"
  - Dar ao usuário a opção de reprocessar (informar na resposta)

RESTRIÇÕES:
- NÃO toque em: src/server.js, src/services/, package.json
- NÃO altere a lógica de classificação ou envio ao ERP
- Faça commit atômico por tarefa com mensagens claras em português
- Ao finalizar, rode `node src/server.js` e confirme que o server inicia normalmente
- Ao finalizar, liste exatamente o que foi alterado e como testar
```

---

### 🤖 AGENTE C — Integridade de Dados

**Branch:** `fix/data-integrity`  
**Itens do plano:** 2.1, 2.2  
**Arquivos que este agente pode tocar:**

- `src/services/olist-financial.js`
- `src/services/expense-classifier.js`
- `src/repositories/learned-mappings-repo.js`
- Nova migration: `src/database/migrations/012_sent_transactions.js`
- `config/learned-mappings.json` (apenas para conferência de dados, NÃO deletar)

**⛔ NÃO TOCAR:** `src/server.js`, `reconciliation.routes.js`, `package.json`

#### Prompt para o Agente C

```
Você vai executar correções de integridade de dados no projeto "Conciliação de Cartões".

CONTEXTO DO PROJETO:
- Node.js + Express 4, PostgreSQL (Cloud SQL), frontend HTML puro
- Serviço de envio ao ERP: src/services/olist-financial.js
- Classificador de despesas: src/services/expense-classifier.js
- Repositório de mapeamentos: src/repositories/learned-mappings-repo.js
- Migrations em: src/database/migrations/ (última existente: 010_)
- API Tiny ERP: rate limit de ~30 req/min, delay de 2.1s entre chamadas
- Leia o CLAUDE.md na raiz para entender a arquitetura
- Leia o PLANO-CORRECOES.md na raiz para o detalhamento completo

IMPORTANTE: 
- Antes de qualquer alteração, crie o branch `fix/data-integrity` a partir de master
- O Agente B está criando a migration 011_ em paralelo. Use 012_ para sua migration.

Você deve executar APENAS os itens 2.1 e 2.2 do PLANO-CORRECOES.md. Resumo:

TAREFA 1 — Idempotência no envio ao ERP (item 2.1):
- Criar migration src/database/migrations/012_sent_transactions.js com tabela sent_transactions:
  - id SERIAL PRIMARY KEY
  - idempotency_key VARCHAR(255) UNIQUE NOT NULL
  - card_name VARCHAR(255)
  - transaction_date DATE
  - amount DECIMAL(10,2)
  - description TEXT
  - olist_id VARCHAR(100) (pode ser NULL se envio falhou)
  - status VARCHAR(50) DEFAULT 'pending' (valores: pending, sent, failed)
  - created_at TIMESTAMP DEFAULT NOW()
  - updated_at TIMESTAMP DEFAULT NOW()
- Em src/services/olist-financial.js:
  - Antes de enviar ao Tiny, gerar idempotency_key = hash SHA256 de: banco/operadora + card_name + data + valor + descrição
  - Consultar tabela sent_transactions pela key
  - Se existir com olist_id preenchido → retornar ID existente sem chamar API
  - Se existir sem olist_id (status=failed) → permitir retry
  - Se não existir → inserir registro com status=pending, enviar à API, atualizar com olist_id e status=sent
  - Em caso de erro da API → atualizar status=failed

TAREFA 2 — Eliminar dual-write PostgreSQL + JSON (item 2.2):
- Primeiro, verificar se TODOS os dados de config/learned-mappings.json já existem no PostgreSQL (tabela learned_mappings)
- No expense-classifier.js:
  - Remover toda leitura e escrita do arquivo JSON (fs.readFileSync, fs.writeFileSync)
  - Remover imports de fs e referências ao learnedPath
  - Garantir que toda leitura vem do PostgreSQL (via learned-mappings-repo.js)
  - Garantir que toda escrita vai para o PostgreSQL (via learned-mappings-repo.js)
- NÃO deletar o arquivo JSON — apenas mantê-lo como backup estático
- Adicionar comentário no topo do JSON: "// DEPRECATED — backup estático, não mais atualizado. Fonte de verdade: PostgreSQL"

RESTRIÇÕES:
- NÃO toque em: src/server.js, reconciliation.routes.js, package.json
- NÃO altere rotas ou o server.js
- Use a numeração 012_ para a migration (011_ está reservada para outro agente)
- Faça commit atômico por tarefa com mensagens claras em português
- Ao finalizar, rode `node src/server.js` e confirme que o server inicia normalmente
- Ao finalizar, liste exatamente o que foi alterado e como testar
```

---

## ═══════════════════════════════════════════

## RODADA 2 — Resiliência + Observabilidade + Qualidade

## ═══════════════════════════════════════════

⚠️ **Só iniciar após Rodada 1 completamente mergeada em main.**  
Os 3 agentes desta rodada podem rodar **simultaneamente** entre si.

---

### 🤖 AGENTE D — Resiliência da API

**Branch:** `fix/api-resilience`  
**Itens do plano:** 3.1, 3.2, 3.3, 3.4  
**Arquivos que este agente pode tocar:**

- **Novo:** `src/services/api-queue.js`
- `src/services/olist-financial.js` (apenas para trocar chamadas axios diretas pela fila)
- `src/services/olist-notas.js` (idem)
- `src/services/olist-repository.js` (idem)
- `src/modules/conciliacao-cartao/reconciliation.routes.js` (apenas AbortController no timeout de NF)

**⛔ NÃO TOCAR:** `src/server.js`, `expense-classifier.js`, migrations

#### Prompt para o Agente D

```
Você vai implementar resiliência nas chamadas à API Tiny ERP no projeto "Conciliação de Cartões".

CONTEXTO DO PROJETO:
- Node.js + Express 4, PostgreSQL (Cloud SQL)
- O sistema faz chamadas à API Tiny ERP (https://api.tiny.com.br/api2) via axios
- Rate limit da API: ~30 req/min. Código atual usa delay de 2.1s em loops, mas sem coordenação global
- Serviços que chamam a API:
  - src/services/olist-financial.js (contas a pagar — CRUD)
  - src/services/olist-notas.js (consulta NF-e)
  - src/services/olist-repository.js (repositório de dados)
- Há um Promise.race com timeout em reconciliation.routes.js para cruzamento de NF
- Leia o CLAUDE.md na raiz para entender a arquitetura
- Leia o PLANO-CORRECOES.md na raiz para o detalhamento completo

IMPORTANTE: Antes de qualquer alteração, crie o branch `fix/api-resilience` a partir de master.

Você deve executar os itens 3.1, 3.2, 3.3 e 3.4 do PLANO-CORRECOES.md. Resumo:

TAREFA 1 — Fila global de requisições à API Tiny (item 3.1):
- Criar novo módulo src/services/api-queue.js com classe singleton ApiQueue:
  - Fila FIFO com semáforo: apenas 1 requisição a cada 2.1 segundos, globalmente
  - Método principal: queue.enqueue(fn) → retorna Promise que resolve quando fn é executada
  - A fn recebe o signal do AbortController para poder ser cancelada
  - Log de: tamanho da fila, tempo de espera estimado, requisição atual
  - Exportar instância singleton

TAREFA 2 — Retry com backoff exponencial (item 3.2):
- Dentro do api-queue.js, adicionar lógica de retry:
  - Retry automático para status: 429, 500, 502, 503, 504 e timeouts
  - Backoff: 3s → 9s → 27s (exponencial base 3)
  - Máximo 3 retries
  - NÃO fazer retry para: 400, 401, 403, 404 (erros definitivos)
  - Logar cada retry com: tentativa N/3, erro original, tempo até próxima tentativa

TAREFA 3 — Circuit breaker para API Tiny (item 3.3):
- Dentro do api-queue.js, implementar circuit breaker com 3 estados:
  - CLOSED (normal) → requisições passam normalmente
  - OPEN (bloqueado) → rejeita imediatamente com erro "API Tiny indisponível, tente em Xs"
  - HALF-OPEN (testando) → permite 1 requisição de teste
- Transições:
  - CLOSED → OPEN: após 5 falhas consecutivas
  - OPEN → HALF-OPEN: após 60 segundos
  - HALF-OPEN → CLOSED: se requisição de teste teve sucesso
  - HALF-OPEN → OPEN: se requisição de teste falhou
- Expor método getStatus() para consulta do estado atual

TAREFA 4 — Cancelamento real no timeout de NF (item 3.4):
- Arquivo: src/modules/conciliacao-cartao/reconciliation.routes.js
- Localizar o Promise.race que implementa timeout de cruzamento NF
- Substituir por AbortController:
  - Criar controller = new AbortController() antes do race
  - Passar controller.signal para as chamadas axios internas
  - No handler de timeout, chamar controller.abort()
  - Tratar AbortError nos catches

TAREFA 5 — Integrar a fila nos serviços existentes:
- Em olist-financial.js, olist-notas.js e olist-repository.js:
  - Importar a fila: const { apiQueue } = require('./api-queue')
  - Trocar chamadas diretas axios.post/get por apiQueue.enqueue(() => axios.post/get(...))
  - REMOVER delays manuais (setTimeout/sleep de 2.1s) que já existam — a fila controla isso agora
  - Manter a lógica de negócio intacta — só mudar COMO a requisição é feita

RESTRIÇÕES:
- NÃO toque em: src/server.js, expense-classifier.js, migrations, package.json
- NÃO altere lógica de classificação ou mapeamentos
- A fila deve ser transparente: o código que chama deve funcionar igual, só que enfileirado
- Faça commit atômico por tarefa com mensagens claras em português
- Ao finalizar, rode `node src/server.js` e confirme que o server inicia normalmente
- Ao finalizar, liste exatamente o que foi alterado e como testar
```

---

### 🤖 AGENTE E1 — Observabilidade & Infraestrutura

**Branch:** `fix/observability-infra`  
**Itens do plano:** 4.1, 4.2, 4.4  
**Arquivos que este agente pode tocar:**

- `src/utils/logger.js`
- `src/server.js` (apenas para adicionar middleware de requestId e rota /health melhorada)
- Nova migration: `src/database/migrations/013_audit_log.js`
- **Novo:** `src/middlewares/audit.middleware.js`

**⛔ NÃO TOCAR:** Arquivos de rotas em `src/modules/`, `expense-classifier.js`, `olist-financial.js`

**⚠️ ATENÇÃO:** Este agente toca `src/server.js` (que o Agente A da Rodada 1 já editou). A Rodada 1 DEVE estar mergeada antes deste agente iniciar.

#### Prompt para o Agente E1

```
Você vai implementar observabilidade e infraestrutura de auditoria no projeto "Conciliação de Cartões".

CONTEXTO DO PROJETO:
- Node.js + Express 4, PostgreSQL (Cloud SQL), frontend HTML puro
- Logger atual: src/utils/logger.js (Winston, básico)
- Server: src/server.js (já tem validação de env e CSRF da Fase 1)
- Migrations em: src/database/migrations/ (últimas: 011_ e 012_ criadas na Rodada 1)
- Módulos de rotas em: src/modules/ (conciliacao-cartao, categorizacao, dashboard, repositorio, reports, settings)
- Leia o CLAUDE.md na raiz para entender a arquitetura
- Leia o PLANO-CORRECOES.md na raiz para o detalhamento completo

IMPORTANTE: 
- Antes de qualquer alteração, crie o branch `fix/observability-infra` a partir de master
- Use numeração 013_ para migrations
- Você NÃO deve tocar nos arquivos de rotas de src/modules/ — isso é responsabilidade do Agente E2

Você deve executar os itens 4.1, 4.2 e 4.4 do PLANO-CORRECOES.md. Resumo:

TAREFA 1 — Request ID em todas as requisições (item 4.1):
- Em src/utils/logger.js:
  - Implementar AsyncLocalStorage para contexto de request
  - Adicionar requestId automaticamente em todas as linhas de log do Winston
  - Exportar funções para set/get do contexto
- Em src/server.js:
  - Criar middleware (ANTES de todas as rotas) que:
    - Gera UUID v4 para cada requisição
    - Armazena em req.id e no AsyncLocalStorage
    - Adiciona header X-Request-Id na resposta

TAREFA 2 — Audit trail de operações financeiras (item 4.2):
- Criar migration src/database/migrations/013_audit_log.js:
  - Tabela audit_log: id SERIAL PK, timestamp TIMESTAMPTZ DEFAULT NOW(), user_email VARCHAR(255), action VARCHAR(100), entity_type VARCHAR(100), entity_id VARCHAR(255), details JSONB, request_id VARCHAR(36)
  - Índices em: timestamp, user_email, action, entity_type
- Criar src/middlewares/audit.middleware.js:
  - Exportar função auditLog(req, action, entityType, entityId, details)
  - A função insere na tabela audit_log usando pool do connection.js
  - NUNCA logar tokens, senhas ou dados sensíveis no campo details
  - Logar erros de audit silenciosamente (não bloquear a operação principal)
- Aplicar auditLog nos pontos críticos das rotas:
  - Envio ao ERP (send-item, send)
  - Estorno (reverse-entry)
  - Exclusão (delete-batch)
  - Baixa (pay-batch)
  - Aprendizado de classificação (learn)
- Criar endpoint GET /api/audit com:
  - Filtros: user_email, action, entity_type, date_from, date_to
  - Paginação (limit/offset)
  - Acesso restrito (apenas logados, futuramente só admin)

TAREFA 3 — Health check detalhado (item 4.4):
- Em src/server.js:
  - GET /health (PÚBLICO, sem autenticação — Cloud Run precisa dele):
    - Verificar PostgreSQL: executar SELECT 1
    - Retornar HTTP 200 se banco ok, HTTP 503 se down
    - Incluir: status, uptime, db (ok/error)
  - GET /health/detailed (AUTENTICADO — diagnóstico interno):
    - Tudo do /health + latência do banco
    - Verificar status do circuit breaker (importar de api-queue.js se existir, senão omitir)
    - Uso de memória (process.memoryUsage())
    - Tamanho da fila de requisições

RESTRIÇÕES:
- NÃO altere lógica de negócio dos services
- NÃO altere o expense-classifier.js nem o olist-financial.js
- NÃO toque nos arquivos de rotas em src/modules/ (o Agente E2 fará isso)
- Mantenha o audit trail não-bloqueante (erros de audit não podem impedir operações)
- Faça commit atômico por tarefa com mensagens claras em português
- Ao finalizar, rode `node src/server.js` e confirme que o server inicia normalmente
- Ao finalizar, liste exatamente o que foi alterado e como testar
```

---

### 🤖 AGENTE E2 — Padronização de Respostas de API

**Branch:** `fix/api-response-format`  
**Itens do plano:** 4.3  
**Arquivos que este agente pode tocar:**

- **Novo:** `src/utils/api-response.js`
- Todos os arquivos de rotas em `src/modules/`

**⛔ NÃO TOCAR:** `src/server.js`, `src/services/`, `src/utils/logger.js`, migrations

**⚠️ ATENÇÃO:** Este agente é o **último a rodar**. Todos os outros agentes (D, E1, F) já devem estar finalizados e mergeados antes. Ele toca MUITOS arquivos de rotas.

#### Prompt para o Agente E2

```
Você vai padronizar todas as respostas de API no projeto "Conciliação de Cartões".

CONTEXTO DO PROJETO:
- Node.js + Express 4, PostgreSQL (Cloud SQL), frontend HTML puro
- Módulos de rotas em: src/modules/ (conciliacao-cartao, categorizacao, dashboard, repositorio, reports, settings)
- Os outros agentes (D, E1, F) já modificaram alguns destes arquivos de rotas
- Leia o CLAUDE.md na raiz para entender a arquitetura
- Leia o PLANO-CORRECOES.md na raiz para o detalhamento completo

IMPORTANTE:
- Antes de qualquer alteração, crie o branch `fix/api-response-format` a partir de master
- TODOS os outros agentes já finalizaram. O código em master está atualizado.

Você deve executar APENAS o item 4.3 do PLANO-CORRECOES.md:

TAREFA — Padronizar respostas de erro (item 4.3):
- Criar src/utils/api-response.js com:
  - apiResponse(res, statusCode, data) → { sucesso: true, dados: data }
  - apiError(res, statusCode, code, message) → { sucesso: false, erro: { codigo: code, mensagem: message } }
- Em TODOS os arquivos de rotas de src/modules/:
  - Substituir res.json({ ... }) por chamadas ao helper
  - Substituir res.status(X).json({ error/erro/message }) por apiError()
  - Manter retrocompatibilidade: o campo "sucesso" é novo, os demais campos continuam existindo
  - Prestar atenção especial às mudanças feitas pelos agentes anteriores — não reverter nenhuma lógica deles

RESTRIÇÕES:
- NÃO altere lógica de negócio — apenas formato das respostas
- NÃO toque em: src/server.js, src/services/, src/utils/logger.js, migrations
- Manter retrocompatibilidade total com o frontend existente
- Faça commit atômico com mensagem clara em português
- Ao finalizar, rode `node src/server.js` e confirme que o server inicia normalmente
- Ao finalizar, liste exatamente o que foi alterado e como testar
```

---

### 🤖 AGENTE F — Qualidade & Manutenibilidade

**Branch:** `fix/quality-testing`  
**Itens do plano:** 5.1, 5.2, 5.3, 5.4  
**Arquivos que este agente pode tocar:**

- **Novo:** `tests/` (diretório inteiro)
- **Novo:** `tests/fixtures/` (PDFs de exemplo)
- `src/middlewares/auth.middleware.js`
- Nova migration: `src/database/migrations/014_user_roles.js`
- `src/services/expense-classifier.js` (apenas otimização interna, sem mudar interface)
- **Novo:** `docs/api-spec.yaml` (OpenAPI)
- `package.json` (para adicionar jest/vitest e script de test)

**⚠️ ATENÇÃO:** Este agente toca `expense-classifier.js` (que o Agente C da Rodada 1 editou) e `auth.middleware.js`. A Rodada 1 DEVE estar mergeada antes.

#### Prompt para o Agente F

```
Você vai implementar melhorias de qualidade e manutenibilidade no projeto "Conciliação de Cartões".

CONTEXTO DO PROJETO:
- Node.js + Express 4, PostgreSQL (Cloud SQL), frontend HTML puro
- Serviços core: pdf-parser.js, expense-classifier.js, olist-financial.js (em src/services/)
- Middleware de auth: src/middlewares/auth.middleware.js
- Não existem testes. Zero. Nenhum.
- Classificador usa busca linear O(n×m) — precisa ser otimizado
- Todo usuário autenticado tem acesso total — não há controle de roles
- Migrations em: src/database/migrations/ (usar numeração 014_ em diante)
- Leia o CLAUDE.md na raiz para entender a arquitetura
- Leia o PLANO-CORRECOES.md na raiz para o detalhamento completo

IMPORTANTE:
- Antes de qualquer alteração, crie o branch `fix/quality-testing` a partir de master
- Use numeração 014_ para migrations
- **LEIA O DIFF DO AGENTE C** (branch `fix/data-integrity`) antes de otimizar o `expense-classifier.js` — o Agente C removeu o dual-write JSON e a estrutura interna pode ter mudado

Você deve executar os itens 5.1, 5.2, 5.3 e 5.4 do PLANO-CORRECOES.md. Resumo:

TAREFA 1 — Testes unitários dos serviços core (item 5.1):
- Instalar Jest como devDependency (npm install --save-dev jest)
- Adicionar script "test" ao package.json: "jest --verbose"
- Criar estrutura: tests/services/, tests/fixtures/
- Escrever testes para pdf-parser.js:
  - Criar PDFs de fixture (ou mocks que simulem o buffer parseado) para cada banco suportado: Caixa, Cresol, Santander, Mercado Pago
  - Testar que extrai transações com campos corretos (data, descrição, valor)
  - Testar detecção automática de banco
- Escrever testes para expense-classifier.js:
  - Testar classificação via mapeamento aprendido (mock do repo PostgreSQL)
  - Testar classificação via regex (financial-rules.json)
  - Testar fallback quando nenhuma regra bate
- Escrever testes para olist-financial.js:
  - Mockar axios (jest.mock('axios'))
  - Testar formação do payload de conta a pagar
  - Testar tratamento de erro 429 (rate limit)
  - Testar tratamento de timeout
- Meta: cobertura mínima de 70% nos 3 serviços core
- Rodar npm test e garantir que tudo passa

TAREFA 2 — RBAC básico (item 5.2):
- Criar migration src/database/migrations/014_user_roles.js:
  - Tabela user_roles: id SERIAL PK, email VARCHAR(255) UNIQUE NOT NULL, role VARCHAR(50) NOT NULL DEFAULT 'operator', created_at TIMESTAMPTZ DEFAULT NOW()
  - Roles válidas: 'operator', 'admin'
  - SEED OBRIGATÓRIO: inserir `guilherme.eller@calisul.com.br` como admin (hard-coded, fallback de segurança)
  - Se ADMIN_EMAIL estiver definida E for diferente, inserir também como admin
- Em src/middlewares/auth.middleware.js:
  - Adicionar função requireRole(...roles) que retorna middleware
  - O middleware consulta a tabela user_roles pelo email do req.user
  - Se o email NÃO estiver na tabela → retorna 403 "Acesso negado. Usuário não autorizado."
  - Se o email estiver na tabela mas não tiver a role necessária → retorna 403 "Permissão insuficiente"
  - Cachear a consulta por 5 minutos para não bater no banco em cada request
- Proteger endpoints destrutivos com requireRole('admin'):
  - POST /api/reconciliation/reverse-entry
  - POST /api/reconciliation/delete-batch
  - Rotas de configuração em /api/settings
  - GET /api/audit (se existir)
  - Demais rotas ficam com requireRole('operator', 'admin')

TAREFA 3 — Documentação de API (item 5.3):
- Criar docs/api-spec.yaml no formato OpenAPI 3.0
- Documentar TODOS os endpoints listados no CLAUDE.md:
  - Path, método, descrição, parâmetros, request body, response (sucesso e erro)
  - Incluir exemplos de uso
- Adicionar rota GET /api/docs no server.js que serve o spec (pode usar swagger-ui-express como devDependency, ou simplesmente servir o YAML)

TAREFA 4 — Otimização do classificador (item 5.4):
- Arquivo: src/services/expense-classifier.js
- O classificador atual faz busca linear O(n×m) — para cada transação, varre todos os mapeamentos
- Otimizar:
  - Ao carregar mapeamentos do PostgreSQL, construir um Map indexado por tokens normalizados
  - Para cada transação, tokenizar a descrição (split por espaço, lowercase, remover acentos)
  - Buscar match exato por token primeiro (O(1) via Map)
  - Fallback para busca parcial APENAS se match exato não encontrar
  - Implementar LRU cache para resultados de classificação (máx 500 entradas)
- NÃO alterar a interface pública do classificador — os mesmos métodos devem existir com as mesmas assinaturas
- Meta: classificação de 1000 transações em menos de 100ms

RESTRIÇÕES:
- NÃO toque em: src/server.js (exceto para adicionar rota /api/docs), database/connection.js, rotas de módulos
- NÃO altere a interface pública dos services — apenas otimização interna
- Mantenha todos os testes passando (npm test) ao final
- Faça commit atômico por tarefa com mensagens claras em português
- Ao finalizar, rode `node src/server.js` e confirme que o server inicia normalmente
- Ao finalizar, liste exatamente o que foi alterado e como testar
```

---

## Checklist de Execução

### Pré-Rodada 1

- [ ] Garantir que `master` está estável e o sistema funciona (upload → classificar → enviar → baixar)
- [ ] Garantir que `.env` tem todas as variáveis que o Agente A vai exigir

### Rodada 1 (Agentes A, B, C — simultâneos)

- [ ] Iniciar Agente A (segurança server core + CLAUDE.md)
- [ ] Iniciar Agente B (path safety + constraints) — em paralelo com A
- [ ] Iniciar Agente C (integridade de dados) — em paralelo com A e B
- [ ] Aguardar todos terminarem
- [ ] Smoke test em cada branch: `node src/server.js` inicia + `/health` retorna OK
- [ ] Revisar cada branch, rodar testes manuais
- [ ] Mergear na ordem: **B → C → A** (A por último pois muda o boot validation)
- [ ] Testar fluxo completo na master

### Pré-Rodada 2

- [ ] Confirmar que master está estável após merge da Rodada 1
- [ ] Verificar que CLAUDE.md está atualizado (Agente A já fez isso)

### Rodada 2 (Agentes D, E1, F — simultâneos, depois E2 sozinho)

- [ ] Iniciar Agente D (resiliência API)
- [ ] Iniciar Agente E1 (observabilidade + audit + health) — em paralelo com D
- [ ] Iniciar Agente F (qualidade + testes) — em paralelo com D e E1
- [ ] Aguardar D, E1 e F terminarem
- [ ] Smoke test em cada branch: `node src/server.js` inicia + `/health` retorna OK
- [ ] Revisar cada branch, rodar `npm test`
- [ ] Mergear na ordem: **D → E1 → F**
- [ ] Testar fluxo completo + `npm test` na master
- [ ] Iniciar Agente E2 (padronização de respostas) — **último, sozinho**
- [ ] Aguardar E2 terminar
- [ ] Mergear E2
- [ ] Rodar `npm test` final
- [ ] Testar fluxo completo na master

### Pós-execução

- [ ] Verificar CLAUDE.md está atualizado com todas as mudanças
- [ ] Atualizar PLANO-CORRECOES.md marcando itens como concluídos
- [ ] Deploy em produção

---

*Documento gerado como referência para coordenação de agentes paralelos.*
