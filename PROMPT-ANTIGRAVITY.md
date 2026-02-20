# Prompt para Antigravity — Conciliação de Cartões

Cole esse prompt ao iniciar o trabalho neste módulo no Antigravity:

---

## CONTEXTO

Você vai trabalhar no módulo **Conciliação de Cartões** — uma aplicação Node.js/Express que processa faturas de cartão de crédito em PDF, classifica as transações automaticamente e envia para o ERP Olist/Tiny.

Este módulo foi extraído de um monolito maior (`central_financeira`). Ele já está funcional mas precisa ser revisado e melhorado como aplicação standalone.

Leia o arquivo `CLAUDE.md` na raiz do projeto para entender a arquitetura completa antes de fazer qualquer alteração.

## ESTADO ATUAL

A aplicação já funciona com:
- 13 endpoints de API em `src/modules/conciliacao-cartao/reconciliation.routes.js`
- Parse de PDFs de 4 bancos (Caixa, Cresol, Santander, Mercado Pago)
- Classificação automática por regras + memória (learned mappings)
- Cruzamento com NF-e via API Tiny
- Envio de contas a pagar ao ERP Olist
- Baixa (pagamento) de contas
- Frontend completo em `public/conciliacao.html`

## TAREFAS (executa na ordem)

### 1. Verificação Inicial
- Rode `npm install`
- Crie o arquivo `.env` baseado no `.env.example` (peça o token ao usuário)
- Rode `npm run dev` e verifique que o servidor sobe sem erros
- Teste o endpoint `GET /health` e `GET /api/reconciliation/categories`

### 2. Revisão de Código
Analise o `reconciliation.routes.js` (839 linhas) e identifique:
- Código duplicado entre os endpoints (ex: `upload` e `upload-from-bd` têm lógica quase idêntica)
- Funções helper que deveriam ser extraídas para services
- Tratamento de erros que pode ser melhorado
- A função `classificarTransacoes` usada em `upload-from-bd` (linha 151) que não existe — deveria ser `classificarItens`

### 3. Refatoração do Routes
O arquivo de rotas está com 839 linhas e lógica de negócio misturada. Refatore para:

```
src/
├── modules/conciliacao-cartao/
│   ├── reconciliation.routes.js    ← Só rotas (request/response)
│   ├── reconciliation.service.js   ← Lógica de negócio extraída
│   └── reconciliation.validator.js ← Validações de input
```

A lógica de `calcularRangeBusca()`, o flow de parse+classify+crossref, e o flow de envio ao ERP devem ir para o service.

### 4. Revisão do Frontend
O `conciliacao.html` (97KB!) tem CSS + JS inline. Considere:
- Verificar se há referências a rotas de outros módulos (ex: `/api/fila`, `/api/banco-dados`) que não existem mais neste standalone
- Garantir que a navegação funciona corretamente sem os outros módulos
- O menu/sidebar deve refletir apenas este módulo

### 5. Testes
Crie testes básicos:
- Teste unitário do `pdf-parser.js` com um PDF mock
- Teste unitário do `expense-classifier.js` com transações de exemplo
- Teste de integração dos endpoints (sem chamar API externa)

### 6. Bug Conhecido
No endpoint `POST /upload-from-bd` (linha 151), a função chamada é `classificarTransacoes` mas o import correto é `classificarItens`. Corrija isso.

## REGRAS

- **Rate limit:** sempre respeitar 2.1s entre chamadas à API Tiny
- **Não commitar** `.env` nem `data/*.db`
- **Migrations** são sequenciais (001_, 002_, ...)
- **Não instalar** dependências desnecessárias
- Manter compatibilidade com o frontend existente (não mudar URLs da API)
- Ao refatorar, manter os mesmos endpoints e contratos de API
