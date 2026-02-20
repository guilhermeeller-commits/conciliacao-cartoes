# 🚀 Central Financeira Calisul — Roadmap de Fases

> Estado atual: **Todas as 5 fases concluídas** ✅ (20/02/2026). Sistema completo e operacional.

---

## ✅ Fase 1 — Fundação (CONCLUÍDA)

Reestruturação completa da navegação e eliminação de duplicações.

| # | Entrega | Detalhe |
|---|---|---|
| 1 | **Unificação de páginas** | `extratos-cartao.html` + `conciliacoes.html` → `faturas.html` |
| 2 | **Detalhe unificado** | `extrato-detalhe.html` + `conciliacao.html` → detalhe único |
| 3 | **Auto-categorização** | Botão "Categorizar automaticamente" no detalhe da fatura |
| 4 | **Envio individual ao Olist** | Botão "Enviar ao Olist" no detalhe (SSE com progresso) |
| 5 | **Sidebar reestruturada** | 4 menus lógicos: Dashboard, Faturas, Repositório, Configurações |

---

## ✅ Fase 2 — Profissionalismo (CONCLUÍDA)

Melhorias de UX, feedback visual e ações em lote.

| # | Entrega | Detalhe |
|---|---|---|
| 6 | **Dashboard rico** | KPIs reais + gráficos Chart.js (barras empilhadas, doughnut) + alertas acionáveis |
| 7 | **Filtro de transações** | Tabs Todas / Pendentes / Categorizadas no detalhe com contadores |
| 8 | **Envio em lote ao Olist** | Checkbox + botão "Enviar ao Olist" na lista de faturas (só para 100% categorizadas) |
| 9 | **Status visual** | Badges: 🟡 Pendente, 🟢 Categorizado, 🔵 Enviado ao Olist |
| 10 | **Filtros avançados** | Período (mês/trimestre/intervalo), chips por cartão, busca por nome |

---

## ✅ Fase 3 — Excelência (CONCLUÍDA)

Configurações centralizadas, exportação de dados e limpeza técnica.

| # | Entrega | Detalhe |
|---|---|---|
| 11 | **Página de Configurações** | 4 abas: Contas de Cartão, Regras de Classificação, Mapeamentos Aprendidos, API Olist |
| 12 | **Exportação CSV** | Botão no Repositório que exporta toda a aba ativa — UTF-8, separador `;` |
| 13 | **Limpeza de legados** | Removidas referências mortas (`filtro-universal.js`, `categorizacao.html`) |
| 14 | **Refatoração CSS** | Inline `style=` migrados para classes CSS em `faturas.html` e `extrato-detalhe.html` |

### Arquivos criados

- **Backend**: `src/modules/settings/settings.routes.js` (5 endpoints REST)
- **Frontend**: `public/configuracoes.html` (CRUD completo, 4 abas)

---

## ✅ Fase 4 — Polimento (CONCLUÍDA)

Eliminação de páginas legadas, melhorias de UX e funcionalidades avançadas.

| # | Entrega | Detalhe |
|---|---|---|
| 15 | **Eliminar `conciliacao.html`** | ✅ 2.598 linhas de código legado removidas |
| 16 | **Eliminar `categorizacao.html`** | ✅ Funcionalidades migradas para Dashboard e Configurações |
| 17 | **Eliminar `extratos-cartao.html` e `conciliacoes.html`** | ✅ Arquivos de redirect removidos |
| 18 | **Gráficos no Repositório** | ✅ Donut charts Chart.js para Top Categorias e Top Fornecedores |
| 19 | **Sub-tabs no Repositório** | ✅ 3 sub-tabs: Dados Sincronizados / Categorias & Mapeamentos / Importações |
| 20 | **Plano de Contas na Configurações** | ✅ Visualização em árvore com busca, aba dedicada |
| 21 | **Backup do banco** | ✅ Download/restauração do SQLite em Configurações, aba dedicada |

---

## ✅ Fase 5 — Automação (CONCLUÍDA)

| # | Entrega | Detalhe |
|---|---|---|
| 22 | **Sync automático Olist** | ✅ Cron job a cada 6h via `sync-scheduler.js` com `node-cron` |
| 23 | **Token Olist via UI** | ✅ Aba API Olist em Configurações com input, validação e salvamento |
| 24 | **Notificações push** | ✅ Sistema de polling via `notifications.js` com painel e toasts |
| 25 | **Relatórios PDF** | ✅ Aba Relatórios em Configurações com geração via PDFKit (`reports.routes.js`) |

---

## Arquitetura Atual do Projeto

```
public/
├── dashboard.html          ← Página inicial com KPIs + gráficos
├── faturas.html            ← Lista master de faturas (unificada)
├── extrato-detalhe.html    ← Detalhe: transações, categorização, envio Olist
├── repositorio.html        ← Dados ERP sincronizados + exportação CSV
├── configuracoes.html      ← [NOVA] Configurações centralizadas
├── conciliacao.html        ← [LEGADO] 2598 linhas, pendente eliminação
├── categorizacao.html      ← [LEGADO] pendente eliminação
├── extratos-cartao.html    ← [REDIRECT] → faturas.html
├── conciliacoes.html       ← [REDIRECT] → faturas.html
├── css/design-system.css
└── js/
    ├── sidebar.js
    └── theme-toggle.js

src/
├── server.js
├── database/
│   └── migrations/
├── modules/
│   ├── card-statements/
│   ├── reconciliation/
│   ├── repository/
│   ├── dashboard/
│   └── settings/           ← [NOVO] settings.routes.js
├── repositories/
└── services/
```

## Sidebar Final (4 menus ativos)

```
┌────────────────────────┐
│  🏢  C A L I S U L     │
│  Central Financeira     │
├────────────────────────┤
│  VISÃO GERAL           │
│  ● 📊 Dashboard       │
│                        │
│  CARTÕES               │
│  ○ 💳 Faturas de Cartão│
│                        │
│  BANCÁRIO / ERP        │
│  ○ 🏦 Conciliação     │
│  ○ 🔄 Repositório     │
│                        │
│  SISTEMA               │
│  ○ ⚙️ Configurações   │
├────────────────────────┤
│  🌙 Modo escuro        │
└────────────────────────┘
```

---

> [!TIP]
> **Para continuar em outro chat**: abra este arquivo `FASES.md` e peça para executar a **Fase 4**. O agente terá todo o contexto necessário para prosseguir.
