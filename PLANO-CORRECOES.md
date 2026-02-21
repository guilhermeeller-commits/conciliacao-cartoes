# Plano de Correções — Conciliação de Cartões

**Data:** 21/02/2026  
**Autor:** Revisão de engenharia  
**Última revisão:** 21/02/2026 — revisão completa (health check, RBAC seed, estimativas, CLAUDE.md, fila persistente)  
**Status:** Aprovado com ajustes

---

## Visão Geral

Este plano está organizado em 5 fases, da mais urgente à mais estratégica. Cada fase tem pré-requisitos, escopo claro e critério de conclusão. A ideia é que cada fase deixe o sistema num estado melhor que o anterior, sem quebrar o que já funciona.

**Tempo estimado total:** 6–8 semanas (1 dev dedicado)

> [!NOTE]
> Estimativa considera a ausência total de testes e a necessidade de atualizar documentação técnica (CLAUDE.md) que está desatualizada. Com agentes paralelos (ver PLANO-AGENTES.md), o prazo pode ser reduzido para ~4 semanas.

---

## FASE 1 — Segurança Crítica

**Prioridade:** Bloqueante
**Tempo estimado:** 3–5 dias
**Pré-requisito:** Nenhum

Esses itens representam vulnerabilidades exploráveis hoje. Devem ser corrigidos antes de qualquer outra coisa.

### 1.1 — Eliminar session secret hardcoded

**Arquivo:** `src/server.js`
**Problema:** Se `SESSION_SECRET` não estiver no `.env`, o sistema usa uma string fixa que está visível no código-fonte. Qualquer pessoa com acesso ao repo pode forjar sessões de qualquer usuário.

**Correção:**

- Remover o fallback `|| 'calisul-financeira-secret-key-12345'`
- No boot do servidor, verificar se `SESSION_SECRET` existe e tem pelo menos 32 caracteres
- Se não existir, fazer `process.exit(1)` com log explicativo
- Gerar um secret forte com `openssl rand -base64 48` e colocar no `.env` de produção

**Critério de conclusão:** Servidor recusa iniciar sem `SESSION_SECRET` configurado.

### 1.2 — Proteção contra CSRF

**Arquivos:** `src/server.js`, todas as rotas POST
**Problema:** Nenhum endpoint POST tem proteção CSRF. Um site malicioso pode executar ações no ERP em nome de um usuário logado.

**Correção:**

- Implementar **double-submit cookie pattern** manualmente ou usar pacote `csrf-sync` / `csrf-csrf`
- ⚠️ **Não usar `csurf`** — o pacote foi descontinuado pelo mantenedor por falhas de design
- Adicionar middleware CSRF após o middleware de sessão
- No frontend, incluir o token CSRF em todas as requisições POST (header `X-CSRF-Token` ou campo hidden)
- Endpoints de API pura (se houver) podem usar verificação de `Origin`/`Referer` como alternativa

**Critério de conclusão:** Requisições POST sem token CSRF válido retornam 403.

### 1.3 — Corrigir path traversal

**Arquivo:** `src/modules/conciliacao-cartao/reconciliation.routes.js`
**Problema:** Nas rotas `/upload-from-bd` e `/preview-from-bd`, os parâmetros `year`, `month`, `banco` e `filename` são usados para montar o caminho do arquivo sem sanitização. Payloads como `../../etc/passwd` podem ler arquivos do servidor.

**Correção:**

- Usar `path.resolve()` e verificar que o caminho resultante começa com o diretório base esperado (`data/banco-dados`)
- Rejeitar qualquer parâmetro que contenha `..`, `/` ou `\`
- Validar formato dos parâmetros: `year` deve ser 4 dígitos, `month` deve ser 2 dígitos, `banco` deve ser alfanumérico, `filename` deve terminar em `.pdf`
- Criar função utilitária `safePath(baseDir, ...segments)` reutilizável

**Critério de conclusão:** Tentativas de path traversal retornam 400 com log de alerta.

### 1.4 — Validação de variáveis de ambiente obrigatórias

**Arquivo:** `src/server.js` (boot)
**Problema:** O servidor inicia mesmo sem `TINY_API_TOKEN`, `DATABASE_URL` ou `GOOGLE_CLIENT_ID`, falhando silenciosamente depois.

**Correção:**

- Criar checklist de variáveis obrigatórias no início do boot
- Verificar cada uma antes de iniciar o Express
- Logar exatamente quais estão faltando
- Falhar rápido com `process.exit(1)`
- Atualizar o arquivo `.env.example` existente com todas as variáveis documentadas

**Critério de conclusão:** Servidor não inicia sem todas as variáveis obrigatórias.

### 1.5 — Atualizar CLAUDE.md

**Arquivo:** `CLAUDE.md`
**Problema:** O CLAUDE.md referencia SQLite e `better-sqlite3` como stack do banco de dados, mas o projeto já foi migrado para PostgreSQL (Cloud SQL). Agentes e desenvolvedores que lerem o arquivo terão uma visão incorreta da arquitetura.

**Correção:**

- Substituir referências a SQLite por PostgreSQL
- Atualizar a descrição do `learned-mappings-repo.js` (de SQLite para PostgreSQL)
- Atualizar a seção de Stack Técnica
- Documentar o Cloud SQL como infraestrutura de banco
- Manter o restante do arquivo intacto

**Critério de conclusão:** CLAUDE.md reflete a arquitetura atual do projeto (PostgreSQL, não SQLite).

---

## FASE 2 — Integridade de Dados

**Prioridade:** Alta
**Tempo estimado:** 5–7 dias
**Pré-requisito:** Fase 1 concluída

Esses itens previnem corrupção e duplicação de dados no ERP.

### 2.1 — Idempotência no envio ao ERP

**Arquivos:** `src/services/olist-financial.js`, `src/modules/conciliacao-cartao/reconciliation.routes.js`
**Problema:** Se o usuário clicar duas vezes em "Enviar" ou se der timeout e ele tentar de novo, cria lançamento duplicado no Tiny.

**Correção:**

- Gerar um `idempotency_key` único para cada transação (hash de: **banco/operadora** + card_name + data + valor + descrição)
  - Incluir banco/operadora no hash é essencial — dois cartões de bandeiras diferentes podem ter transação com mesmo valor, data e descrição
- Criar tabela `sent_transactions` no PostgreSQL com coluna `idempotency_key UNIQUE`
- Antes de enviar ao Tiny, verificar se já existe registro com mesma key
- Se existir e tiver `olist_id`, retornar o ID existente sem chamar a API
- Se existir sem `olist_id` (envio anterior falhou), permitir retry
- Salvar o `olist_id` retornado pelo Tiny após sucesso

**Critério de conclusão:** Enviar a mesma transação duas vezes nunca cria duplicata no ERP.

### 2.2 — Eliminar dual-write PostgreSQL + JSON

**Arquivos:** `src/services/expense-classifier.js`, arquivo `config/learned-mappings.json`
**Problema:** Os mapeamentos aprendidos são salvos tanto no PostgreSQL quanto num JSON local. Os dados podem divergir.

**Correção:**

- Verificar que todos os dados do JSON já estão no PostgreSQL (migration de reconciliação)
- Remover toda leitura e escrita do arquivo JSON no `expense-classifier.js`
- Manter o JSON como backup estático (read-only, não atualizado)
- Adicionar migration que importa qualquer dado que esteja só no JSON
- Remover referências ao `learnedPath` e `fs.writeFileSync`

**Critério de conclusão:** `expense-classifier.js` não lê nem escreve em arquivo JSON. Única fonte de verdade é o PostgreSQL.

### 2.3 — Constraint de unicidade em statements

**Arquivo:** Nova migration (`011_add_unique_constraints.js`)
**Problema:** É possível fazer upload do mesmo PDF duas vezes, criando registros duplicados.

**Correção:**

- Adicionar constraint `UNIQUE(card_name, statement_date, filename)` na tabela `card_statements`
- Na rota de upload, tratar erro de violação de unicidade com mensagem amigável: "Esta fatura já foi processada"
- Dar ao usuário a opção de reprocessar (deletar anterior + inserir novo)

**Critério de conclusão:** Upload duplicado retorna aviso claro em vez de criar duplicata silenciosa.

---

## FASE 3 — Resiliência e Rate Limiting

**Prioridade:** Média-alta
**Tempo estimado:** 5–7 dias
**Pré-requisito:** Fase 2 concluída

Esses itens evitam falhas em cascata quando a API Tiny está lenta ou fora do ar.

### 3.1 — Fila global de requisições à API Tiny

**Arquivo:** Novo módulo `src/services/api-queue.js`
**Problema:** O delay de 2.1s funciona dentro de loops individuais, mas requisições concorrentes de múltiplos usuários não são coordenadas.

**Correção:**

- Criar um singleton `ApiQueue` com fila FIFO e semáforo
- Limite: 1 requisição a cada 2.1 segundos, globalmente
- Todas as chamadas ao Tiny passam pela fila (olist-financial, olist-notas, olist-repository)
- A fila retorna uma Promise que resolve quando a requisição é executada
- Logar tamanho da fila e tempo de espera

> [!NOTE]
> **Melhoria futura:** Considerar fila persistente (tabela `api_job_queue` no PostgreSQL) caso o volume de lotes aumente significativamente. Por ora, fila in-memory é suficiente para o volume atual de usuários.

**Critério de conclusão:** Mesmo com 10 uploads simultâneos, nunca mais que 28 req/min à API Tiny.

### 3.2 — Retry com backoff exponencial

**Arquivo:** `src/services/api-queue.js` (integrado à fila)
**Problema:** Se a API Tiny retornar 500 ou timeout, a requisição simplesmente falha.

**Correção:**

- Implementar retry automático para erros 429, 500, 502, 503, 504 e timeouts
- Backoff: 1ª tentativa após 3s, 2ª após 9s, 3ª após 27s
- Máximo 3 retries
- Erros 400/401/404 não fazem retry (são definitivos)
- Logar cada retry com contexto

**Critério de conclusão:** Erros transitórios da API são recuperados automaticamente.

### 3.3 — Circuit breaker para API Tiny

**Arquivo:** `src/services/api-queue.js`
**Problema:** Se a API Tiny ficar completamente fora, o sistema continua tentando e falhando, acumulando timeouts.

**Correção:**

- Implementar pattern circuit breaker com 3 estados: CLOSED (normal), OPEN (bloqueado), HALF-OPEN (testando)
- Após 5 falhas consecutivas, abrir o circuito por 60 segundos
- Em HALF-OPEN, permitir 1 requisição de teste; se sucesso, fechar
- Quando circuito aberto, retornar erro imediato com mensagem: "API Tiny indisponível, tente novamente em X segundos"
- Expor status do circuit breaker no endpoint `/health`

**Critério de conclusão:** Sistema não acumula requisições quando a API está fora.

### 3.4 — Cancelamento real no timeout de NF

**Arquivo:** `src/modules/conciliacao-cartao/reconciliation.routes.js`
**Problema:** O `Promise.race` contra timeout não cancela a promise perdedora. Chamadas à API continuam em background.

**Correção:**

- Usar `AbortController` para cancelar requisições axios quando o timeout vence
- Passar o `signal` do AbortController para cada chamada axios dentro do bloco de cruzamento NF
- No handler de timeout, chamar `controller.abort()`
- Tratar `AbortError` nos catches internos

**Critério de conclusão:** Quando o timeout de NF é atingido, nenhuma requisição continua em background.

---

## FASE 4 — Observabilidade e Auditoria

**Prioridade:** Média
**Tempo estimado:** 4–5 dias
**Pré-requisito:** Fases 1–3 concluídas

### 4.1 — Request ID em todas as requisições

**Arquivo:** `src/server.js` (middleware), `src/utils/logger.js`
**Problema:** Não é possível correlacionar logs de uma mesma operação.

**Correção:**

- Criar middleware que gera UUID por requisição e coloca em `req.id`
- Adicionar `requestId` ao contexto do Winston (usar `cls-hooked` ou `AsyncLocalStorage`)
- Incluir `requestId` em todas as linhas de log automaticamente
- Retornar o `requestId` no header `X-Request-Id` da resposta

**Critério de conclusão:** Qualquer log pode ser rastreado até a requisição que o gerou.

### 4.2 — Audit trail de operações financeiras

**Arquivo:** Nova migration + novo middleware
**Problema:** Não existe registro de quem fez o quê no sistema.

**Correção:**

- Criar tabela `audit_log` com colunas: `id`, `timestamp`, `user_email`, `action`, `entity_type`, `entity_id`, `details` (JSONB), `request_id`
- Criar middleware/helper `auditLog(req, action, entity, details)`
- Registrar nos pontos críticos: envio ao ERP, estorno, exclusão, baixa, aprendizado de classificação
- Nunca logar tokens ou dados sensíveis no campo `details`
- Criar endpoint `GET /api/audit` para consulta (acesso restrito)

**Critério de conclusão:** Toda operação financeira tem registro de quem, quando e o quê.

### 4.3 — Padronizar respostas de erro

**Arquivos:** Todas as rotas
**Problema:** Respostas de erro usam formatos inconsistentes (`erro`, `message`, `sucesso`, etc.).

**Correção:**

- Definir formato padrão: `{ sucesso: boolean, dados: any, erro: { codigo: string, mensagem: string } }`
- Criar helper `apiResponse(res, status, data)` e `apiError(res, status, code, message)`
- Substituir todas as respostas por chamadas ao helper
- Documentar os códigos de erro possíveis

**Critério de conclusão:** Toda resposta da API segue o mesmo formato, facilitando tratamento no frontend.

### 4.4 — Health check detalhado

**Arquivo:** Atualizar rota `/health` existente + nova rota `/health/detailed`
**Problema:** O health check atual retorna apenas `{"status":"ok"}` sem verificação real das dependências.

**Correção:**

- **`GET /health`** (público, sem autenticação — Cloud Run e monitoramento dependem dele):
  - Verificar conectividade com PostgreSQL (query `SELECT 1`)
  - Retornar HTTP 200 se banco ok, HTTP 503 se down
  - Incluir: `status`, `uptime`, `db` (ok/error)
- **`GET /health/detailed`** (autenticado — informações internas):
  - Tudo do `/health` + latência do banco
  - Status do circuit breaker da API Tiny
  - Uso de memória (`process.memoryUsage()`)
  - Tamanho da fila de requisições (se api-queue existir)

**Critério de conclusão:** `/health` funciona para monitoramento externo; `/health/detailed` fornece diagnóstico interno.

---

## FASE 5 — Qualidade e Manutenibilidade

**Prioridade:** Importante (longo prazo)
**Tempo estimado:** 7–10 dias
**Pré-requisito:** Fases 1–4 concluídas

### 5.1 — Testes unitários dos serviços core

**Arquivos:** Novo diretório `tests/`
**Problema:** Zero testes. Qualquer refatoração pode quebrar funcionalidade sem ninguém perceber.

**Correção:**

- Instalar Jest ou Vitest
- Escrever testes para `pdf-parser.js`: um PDF de exemplo por banco, verificar que extrai transações corretas
- Escrever testes para `expense-classifier.js`: testar cada camada (aprendido, regex, fallback)
- Escrever testes para `olist-financial.js`: mockar axios, testar formação do payload e tratamento de erros
- Guardar PDFs de exemplo em `tests/fixtures/`
- Meta mínima: cobertura de 70% nos 3 serviços core

**Critério de conclusão:** `npm test` roda com sucesso e cobre os fluxos críticos.

### 5.2 — RBAC básico

**Arquivos:** `src/middlewares/auth.middleware.js`, nova tabela
**Problema:** Todo usuário autenticado tem acesso total.

**Correção:**

- Criar tabela `user_roles` com colunas `email` e `role` (operador, admin)
- Criar middleware `requireRole('admin')` para endpoints destrutivos (estorno, exclusão em lote, configurações)
- Operadores podem: upload, classificar, enviar ao ERP, baixar
- Admins podem: tudo acima + estornar, excluir, alterar configurações, ver audit log
- **Deny-by-default:** se o email não está na tabela `user_roles`, o acesso é **negado** (403). Não conceder permissão implícita — isso evita que um e-mail desconhecido ganhe acesso operacional ao sistema
- Seed do primeiro admin via:
  1. **Hard-coded na migration:** inserir `guilherme.eller@calisul.com.br` como admin (fallback de segurança — garante que sempre exista pelo menos 1 admin no sistema)
  2. **Variável `ADMIN_EMAIL`:** se definida, inserir também como admin
  3. Criar endpoint `POST /api/settings/roles` (restrito a admins) para gerenciar roles via UI

> [!CAUTION]
> Se o seed falhar e nenhum admin for criado, **ninguém** acessa o sistema (deny-by-default). O seed hard-coded existe como proteção contra esse cenário.

**Critério de conclusão:** Endpoints destrutivos só funcionam para admins. Usuários não cadastrados não acessam o sistema. Existe pelo menos 1 admin garantido.

### 5.3 — Documentação de API

**Correção:**

- Criar spec OpenAPI/Swagger com todos os endpoints
- Documentar request/response de cada rota
- Incluir exemplos de uso
- Servir via Swagger UI em `/api/docs` (apenas autenticado)

**Critério de conclusão:** Qualquer desenvolvedor novo consegue entender a API pela documentação.

### 5.4 — Otimização do classificador

**Arquivo:** `src/services/expense-classifier.js`
**Problema:** Busca linear O(n×m) que não escala.

**Correção:**

- Ao carregar mapeamentos, construir um Map indexado por tokens normalizados
- Para cada transação, tokenizar a descrição e buscar por token exato primeiro
- Fallback para busca parcial apenas se match exato falhar
- Cachear resultado de classificações frequentes (LRU cache)

**Critério de conclusão:** Classificação de 1000 transações completa em menos de 100ms.

---

## Resumo do Cronograma

| Fase | Escopo | Dias (dedicado) | Acumulado | Dias (paralelo ~50%) |
|------|--------|:---:|:---:|:---:|
| 1 | Segurança crítica + CLAUDE.md | 4–6 | 4–6 | 8–12 |
| 2 | Integridade de dados | 5–7 | 9–13 | 18–26 |
| 3 | Resiliência e rate limiting | 5–7 | 14–20 | 28–40 |
| 4 | Observabilidade e auditoria | 5–6 | 19–26 | 38–52 |
| 5 | Qualidade e manutenibilidade | 10–12 | 29–38 | 58–76 |

> **Nota:** A coluna "paralelo" assume ~50% de dedicação. Estimativas ajustadas considerando a ausência de testes existentes e necessidade de atualizar documentação técnica.

---

## Regras Gerais de Execução

1. **Cada fase tem seu próprio branch** — merge só após revisão e testes manuais
2. **Nunca alterar duas fases no mesmo PR** — facilita rollback
3. **Testar manualmente o fluxo completo** (upload → classificar → enviar → baixar) após cada fase
4. **Manter o CLAUDE.md atualizado** com as mudanças feitas
5. **Não quebrar o frontend** — mudanças no contrato de API devem ser retrocompatíveis ou atualizadas junto no HTML

---

*Documento gerado como referência. Nenhuma alteração foi feita no código.*
