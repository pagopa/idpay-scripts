// ─────────────────────────────────────────────────────────────────
//  JIRA CLOUD — Subtask Expander per il Backlog  v4.0
// ─────────────────────────────────────────────────────────────────
//  Aggiunge una freccia ▶ accanto alle card del backlog che hanno
//  child issues. Cliccandola si apre un mini-pannello con i subtask
//  (key, titolo, stato, assegnatario) recuperati via REST.
//  Cliccando la "key" di un subtask, la issue si apre nel drawer
//  laterale di Jira (come per le card native del backlog).
//
//  ⚠️ La logica per aprire il drawer è NON banale: vedi il commento
//     a `openIssueInSidePanel` PRIMA di toccarla.
//
//  USO:  F12 → Console → incolla view-subtask.js → Invio
//        oppure usa il bookmarklet generato da build-bookmarklet.js.
//
//  DEBUG: imposta `const DEBUG = true` per loggare la sequenza di
//         apertura del drawer (utile se Jira cambia struttura).
// ─────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const BASE_URL = window.location.origin;
  const ROW_SELECTOR = '[data-testid^="software-backlog.card-list.card.content-container."]';
  const CHILD_META_SELECTOR = '[data-testid$="card-contents.child-issues-metadata"]';
  const KEY_RE = /\.content-container\.([A-Z][A-Z0-9_]+-\d+)$/;

  // Mostra la freccia SOLO sulle card che hanno l'indicatore child-issues.
  // Imposta a false per metterla su TUTTE le card del backlog.
  const ONLY_WITH_CHILDREN = true;

  // Logging diagnostico verboso. Imposta a true SOLO per investigare
  // problemi di apertura del side-panel (vedi openIssueInSidePanel).
  const DEBUG = false;
  const dlog  = (...a) => { if (DEBUG) console.log(...a); };
  const dgrp  = (...a) => { if (DEBUG) console.group(...a); };
  const dgrpe = ()      => { if (DEBUG) console.groupEnd(); };
  const dwarn = (...a) => { if (DEBUG) console.warn(...a); };

  // ── CSS ─────────────────────────────────────────────────────────
  //  Usiamo le CSS variables di Atlassian Design System (--ds-*) così
  //  i colori seguono automaticamente tema chiaro/scuro impostato
  //  dall'utente. I valori dopo la virgola sono solo fallback se la
  //  variabile non è definita (es. fuori da Jira).
  if (!document.getElementById('jira-ste-styles')) {
    document.head.insertAdjacentHTML('beforeend', `<style id="jira-ste-styles">
      [data-ste-row] { position: relative !important; }

      .jira-ste-btn {
        position: absolute !important;
        left: -2px;
        top: 50%;
        transform: translateY(-50%);
        z-index: 100;
        display: flex; align-items: center; justify-content: center;
        width: 18px; height: 18px;
        padding: 0; line-height: 1;
        border: 1px solid var(--ds-border, #C1C7D0);
        border-radius: 3px;
        background: var(--ds-surface-raised, #FFFFFF);
        color: var(--ds-text-subtle, #44546F);
        font-size: 9px;
        cursor: pointer;
        box-shadow: var(--ds-shadow-raised, 0 1px 1px rgba(9,30,66,.25));
      }
      .jira-ste-btn:hover {
        background: var(--ds-background-neutral-subtle-hovered, rgba(9,30,66,.06));
        color: var(--ds-text, inherit);
      }
      .jira-ste-btn.open {
        background: var(--ds-background-selected, #E9F2FF);
        color: var(--ds-text-selected, #0C66E4);
        transform: translateY(-50%) rotate(90deg);
      }
      .jira-ste-btn.spin { animation: ste-spin .6s linear infinite; }
      @keyframes ste-spin { to { transform: translateY(-50%) rotate(360deg); } }

      /* Popover sovrastante: lo posizioniamo via JS in document.body con
         position: fixed, per evitare che la card del backlog "consumi" i
         click sui suoi figli (la card ha handler in capture phase che
         aprirebbero il side-panel della task padre). */
      .jira-ste-panel {
        position: fixed !important;
        z-index: 9999;
        max-height: 60vh;
        overflow-y: auto;
        border: 1px solid var(--ds-border, #C1C7D0);
        border-left: 3px solid var(--ds-border-selected, #0C66E4);
        border-radius: 4px;
        background: var(--ds-surface-overlay, var(--ds-surface-raised, #FFFFFF));
        color: var(--ds-text, inherit);
        box-shadow: var(--ds-shadow-overlay,
          0 8px 24px rgba(9,30,66,.25), 0 0 1px rgba(9,30,66,.31));
        animation: ste-in .12s ease;
      }
      @keyframes ste-in { from { opacity: 0; transform: translateY(-4px) } }

      .jira-ste-header {
        display: flex;
        padding: 4px 10px 4px 16px;
        gap: 8px;
        border-bottom: 1px solid var(--ds-border, #DFE1E6);
        font-size: 11px;
        font-weight: 700;
        color: var(--ds-text-subtlest, #6B6E76);
        text-transform: uppercase;
        letter-spacing: .05em;
        background: var(--ds-background-neutral-subtle, transparent);
      }
      .jira-ste-col-key      { min-width: 90px; }
      .jira-ste-col-summary  { flex: 1; }
      .jira-ste-col-status   { min-width: 120px; }
      .jira-ste-col-assignee { min-width: 160px; }

      .jira-ste-row {
        display: flex; align-items: center; gap: 8px;
        padding: 5px 10px 5px 16px;
        border-bottom: 1px solid var(--ds-border, #EBECF0);
        font-size: 12px;
        color: var(--ds-text, inherit);
      }
      .jira-ste-row:last-child { border-bottom: none; }

      .jira-ste-key {
        color: var(--ds-link, #0C66E4);
        text-decoration: none; font-weight: 600;
        white-space: nowrap; min-width: 90px;
      }
      .jira-ste-key:hover { text-decoration: underline; }
      .jira-ste-summary {
        flex: 1;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        color: var(--ds-text, inherit);
      }
      .jira-ste-status {
        padding: 2px 8px;
        border-radius: 3px;
        font-size: 11px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .04em;
        white-space: nowrap; min-width: 120px; text-align: center;
      }
      .jira-ste-assignee {
        display: flex; align-items: center; gap: 5px;
        color: var(--ds-text-subtle, #44546F);
        font-size: 12px;
        white-space: nowrap; min-width: 160px;
      }
      .jira-ste-avatar {
        width: 20px; height: 20px;
        border-radius: 50%; object-fit: cover;
        background: var(--ds-background-neutral, #DFE1E6);
        flex-shrink: 0;
      }
      .jira-ste-msg {
        padding: 7px 10px 7px 16px;
        font-size: 12px; font-style: italic;
        color: var(--ds-text-subtlest, #6B6E76);
      }
      .jira-ste-err {
        padding: 6px 10px 6px 16px;
        font-size: 12px;
        color: var(--ds-text-danger, #AE2A19);
        background: var(--ds-background-danger, #FFECEB);
      }

      /* ── Editor inline (stato + assegnatario) ─────────────────── */
      .jira-ste-row              { position: relative; }
      .jira-ste-status.editable,
      .jira-ste-assignee.editable { cursor: pointer; }
      .jira-ste-status.editable:hover,
      .jira-ste-assignee.editable:hover {
        outline: 1px dashed var(--ds-border-selected, #0C66E4);
        outline-offset: 1px;
      }
      .jira-ste-busy { opacity: .6; pointer-events: none; }

      .jira-ste-popover {
        position: absolute;
        z-index: 10000;
        min-width: 220px;
        max-height: 300px;
        overflow-y: auto;
        padding: 4px 0;
        border: 1px solid var(--ds-border, #C1C7D0);
        border-radius: 4px;
        background: var(--ds-surface-overlay, var(--ds-surface-raised, #FFFFFF));
        color: var(--ds-text, inherit);
        box-shadow: var(--ds-shadow-overlay,
          0 8px 24px rgba(9,30,66,.25), 0 0 1px rgba(9,30,66,.31));
        font-size: 12px;
      }
      .jira-ste-popover-input {
        display: block;
        width: calc(100% - 16px);
        margin: 4px 8px 6px;
        padding: 4px 6px;
        font-size: 12px;
        border: 1px solid var(--ds-border, #C1C7D0);
        border-radius: 3px;
        background: var(--ds-surface-raised, #FFFFFF);
        color: var(--ds-text, inherit);
        box-sizing: border-box;
      }
      .jira-ste-popover-item {
        display: flex; align-items: center; gap: 6px;
        padding: 6px 10px;
        cursor: pointer;
        color: var(--ds-text, inherit);
      }
      .jira-ste-popover-item:hover {
        background: var(--ds-background-neutral-subtle-hovered, rgba(9,30,66,.06));
      }
      .jira-ste-popover-item.current {
        font-weight: 700;
        background: var(--ds-background-selected, rgba(12,102,228,.08));
      }
      .jira-ste-popover-item .jira-ste-avatar { width: 18px; height: 18px; }
      .jira-ste-popover-empty,
      .jira-ste-popover-loading {
        padding: 8px 10px;
        font-style: italic;
        color: var(--ds-text-subtlest, #6B6E76);
      }
      .jira-ste-popover-err {
        padding: 6px 10px;
        color: var(--ds-text-danger, #AE2A19);
      }
    </style>`);
  }

  // ── Util ────────────────────────────────────────────────────────
  const esc = s => String(s).replace(/[&<>"']/g, c => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
  ));

  // Colore badge stato in base alla statusCategory di Jira.
  // Usa le CSS variables ADS: in dark mode i token *-subtler/*-bolder
  // hanno automaticamente contrasti corretti.
  function statusStyle(catKey) {
    return ({
      'new'           : {
        bg: 'var(--ds-background-neutral, #DCDFE4)',
        fg: 'var(--ds-text, #172B4D)',
      },
      'indeterminate' : {
        bg: 'var(--ds-background-information, #E9F2FF)',
        fg: 'var(--ds-text-information, #0055CC)',
      },
      'done'          : {
        bg: 'var(--ds-background-success, #DCFFF1)',
        fg: 'var(--ds-text-success, #216E4E)',
      },
    })[catKey] || {
      bg: 'var(--ds-background-neutral, #DCDFE4)',
      fg: 'var(--ds-text, #172B4D)',
    };
  }

  // ── API: child issues con stato e assegnatario ───────────────────
  //  Prova prima il nuovo endpoint POST /rest/api/3/search/jql,
  //  fallback al vecchio GET /rest/api/3/search se non disponibile.
  async function fetchSubtasks(issueKey) {
    const jql = `parent = "${issueKey}" ORDER BY created ASC`;
    const fields = ['summary', 'status', 'assignee'];

    try {
      const r = await fetch(`${BASE_URL}/rest/api/3/search/jql`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Atlassian-Token': 'no-check',
        },
        body: JSON.stringify({ jql, fields, maxResults: 50 }),
      });
      if (r.ok) return (await r.json()).issues || [];
      // su 404/405/410 cadiamo sul vecchio endpoint
      if (![404, 405, 410].includes(r.status)) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.errorMessages?.[0] || `HTTP ${r.status}`);
      }
    } catch (e) {
      if (e.message && /HTTP \d/.test(e.message)) throw e;
      // network error → tenta fallback
    }

    const url = `${BASE_URL}/rest/api/3/search?jql=${encodeURIComponent(jql)}` +
                `&fields=${fields.join(',')}&maxResults=50`;
    const r2 = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!r2.ok) {
      const b = await r2.json().catch(() => ({}));
      throw new Error(b.errorMessages?.[0] || `HTTP ${r2.status}`);
    }
    return (await r2.json()).issues || [];
  }

  // ── API helpers: editing inline di status e assegnatario ─────────
  async function jiraJSON(url, opts = {}) {
    const r = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'X-Atlassian-Token': 'no-check',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
      ...opts,
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const msg = b.errorMessages?.[0]
        || (b.errors && Object.values(b.errors)[0])
        || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    // PUT/POST 204 → no body
    if (r.status === 204) return null;
    return r.json().catch(() => null);
  }

  // GET transitions disponibili per una issue
  function fetchTransitions(issueKey) {
    return jiraJSON(`${BASE_URL}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);
  }
  // POST transition (cambia stato applicando la transition)
  function doTransition(issueKey, transitionId) {
    return jiraJSON(`${BASE_URL}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
  }
  // GET utenti assegnabili (con filtro testuale opzionale)
  function fetchAssignableUsers(issueKey, query) {
    const u = new URL(`${BASE_URL}/rest/api/3/user/assignable/search`);
    u.searchParams.set('issueKey', issueKey);
    if (query) u.searchParams.set('query', query);
    u.searchParams.set('maxResults', '10');
    return jiraJSON(u.toString());
  }
  // PUT assignee (accountId=null → unassign)
  function setAssignee(issueKey, accountId) {
    return jiraJSON(`${BASE_URL}/rest/api/3/issue/${encodeURIComponent(issueKey)}/assignee`, {
      method: 'PUT',
      body: JSON.stringify({ accountId: accountId }),
    });
  }
  // GET singola issue (per rinfrescare status/assignee dopo update)
  function fetchIssue(issueKey) {
    return jiraJSON(
      `${BASE_URL}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,status,assignee`
    );
  }

  // Chiude tutti i popover di edit aperti nel pannello.
  function closeAllStePopovers() {
    document.querySelectorAll('.jira-ste-popover').forEach(n => n.remove());
  }
  // Click globale: chiude i popover quando si clicca fuori.
  if (!window.__jiraSTE_popoverHandler) {
    document.addEventListener('click', (e) => {
      if (e.target.closest('.jira-ste-popover')) return;
      if (e.target.closest('.jira-ste-status.editable')) return;
      if (e.target.closest('.jira-ste-assignee.editable')) return;
      closeAllStePopovers();
    }, true);
    window.__jiraSTE_popoverHandler = true;
  }

  // ── Riga subtask ─────────────────────────────────────────────────
  //  Costruisce la <div> della riga e attacca:
  //   • click sulla key  → apertura nel drawer (Step A + Step B)
  //   • click sullo status   → popover con le transitions disponibili
  //   • click sull'assegnatario → popover con search utenti assegnabili
  //  Status e assignee vengono riscritti in place quando l'utente
  //  conferma una modifica (renderStatus / renderAssignee).
  function makeRow(issue) {
    const row = document.createElement('div');
    row.className = 'jira-ste-row';
    const summary  = issue.fields?.summary || '—';

    // Markup base: la key e il titolo non sono editabili; status e
    // assignee vengono popolati dalle funzioni render* qui sotto, così
    // riusiamo lo stesso codice dopo un update.
    row.innerHTML = `
      <a class="jira-ste-key"
         href="/browse/${esc(issue.key)}"
         target="_self"
         data-is-router-link="true"
         data-ste-issue="${esc(issue.key)}"
         rel="noopener">${esc(issue.key)}</a>
      <span class="jira-ste-summary" title="${esc(summary)}">${esc(summary)}</span>
      <span class="jira-ste-status editable" title="Click per cambiare stato"></span>
      <span class="jira-ste-assignee editable" title="Click per cambiare assegnatario"></span>`;

    const statusEl   = row.querySelector('.jira-ste-status');
    const assigneeEl = row.querySelector('.jira-ste-assignee');

    function renderStatus(statusField) {
      const name   = statusField?.name || '—';
      const catKey = statusField?.statusCategory?.key || 'new';
      const { bg, fg } = statusStyle(catKey);
      statusEl.textContent = name;
      statusEl.style.background = bg;
      statusEl.style.color = fg;
    }
    function renderAssignee(assigneeField) {
      const name   = assigneeField?.displayName || 'Non assegnato';
      const avatar = assigneeField?.avatarUrls?.['24x24'];
      assigneeEl.innerHTML = `
        ${avatar
          ? `<img class="jira-ste-avatar" src="${avatar}" alt="">`
          : `<span class="jira-ste-avatar"></span>`}
        <span>${esc(name)}</span>`;
    }
    renderStatus(issue.fields?.status);
    renderAssignee(issue.fields?.assignee);

    // ── Click handler sulla key: apre la subtask nel drawer ────────
    const link = row.querySelector('.jira-ste-key');
    link.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      dgrp(`%c[Jira STE] 🖱️ click su subtask ${issue.key}`,
        'color:#0052CC;font-weight:bold');
      dlog('URL prima del click:', window.location.href);
      dgrpe();
      openIssueInSidePanel(issue.key);
    });

    // ── Click handler sullo status: editor transitions ─────────────
    statusEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openStatusEditor(issue, statusEl, renderStatus);
    });

    // ── Click handler sull'assegnatario: editor utenti ─────────────
    assigneeEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAssigneeEditor(issue, assigneeEl, renderAssignee);
    });

    return row;
  }

  // ── Editor: cambia stato applicando una transition ───────────────
  async function openStatusEditor(issue, anchorEl, renderStatus) {
    closeAllStePopovers();
    const popover = buildPopover(anchorEl);
    popover.innerHTML = '<div class="jira-ste-popover-loading">Carico transitions…</div>';
    let transitions;
    try {
      const data = await fetchTransitions(issue.key);
      transitions = data.transitions || [];
    } catch (err) {
      popover.innerHTML = `<div class="jira-ste-popover-err">⚠ ${esc(err.message)}</div>`;
      return;
    }
    if (transitions.length === 0) {
      popover.innerHTML = '<div class="jira-ste-popover-empty">Nessuna transition disponibile</div>';
      return;
    }
    const currentName = issue.fields?.status?.name;
    popover.innerHTML = transitions.map(t => {
      const toName = t.to?.name || t.name;
      const isCurrent = toName === currentName;
      return `<div class="jira-ste-popover-item${isCurrent ? ' current' : ''}"
                   data-transition-id="${esc(t.id)}">${esc(toName)}</div>`;
    }).join('');
    popover.querySelectorAll('.jira-ste-popover-item').forEach(it => {
      it.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const tid = it.dataset.transitionId;
        anchorEl.classList.add('jira-ste-busy');
        closeAllStePopovers();
        try {
          await doTransition(issue.key, tid);
          // refetch per avere il nuovo statusCategory (e quindi il colore corretto)
          const updated = await fetchIssue(issue.key);
          issue.fields.status = updated.fields.status;
          renderStatus(issue.fields.status);
        } catch (err) {
          console.error('[Jira STE] errore transition:', err);
          alert(`Errore cambio stato: ${err.message}`);
        } finally {
          anchorEl.classList.remove('jira-ste-busy');
        }
      });
    });
  }

  // ── Editor: cambia assegnatario via search ───────────────────────
  async function openAssigneeEditor(issue, anchorEl, renderAssignee) {
    closeAllStePopovers();
    const popover = buildPopover(anchorEl);
    popover.innerHTML = `
      <input class="jira-ste-popover-input" type="text" placeholder="Cerca utente…" />
      <div class="jira-ste-popover-list"><div class="jira-ste-popover-loading">Carico…</div></div>`;
    const input = popover.querySelector('.jira-ste-popover-input');
    const list  = popover.querySelector('.jira-ste-popover-list');
    input.focus();

    async function loadUsers(query) {
      list.innerHTML = '<div class="jira-ste-popover-loading">Carico…</div>';
      let users;
      try {
        users = await fetchAssignableUsers(issue.key, query);
      } catch (err) {
        list.innerHTML = `<div class="jira-ste-popover-err">⚠ ${esc(err.message)}</div>`;
        return;
      }
      const currentId = issue.fields?.assignee?.accountId || null;
      // Riga "Non assegnato" sempre in cima
      const unassignedHtml = `
        <div class="jira-ste-popover-item${currentId == null ? ' current' : ''}" data-account-id="">
          <span class="jira-ste-avatar"></span>
          <span><em>Non assegnato</em></span>
        </div>`;
      const usersHtml = (users || []).map(u => {
        const av = u.avatarUrls?.['24x24'];
        const isCurrent = u.accountId === currentId;
        return `<div class="jira-ste-popover-item${isCurrent ? ' current' : ''}"
                     data-account-id="${esc(u.accountId)}"
                     data-display-name="${esc(u.displayName || '')}"
                     data-avatar="${esc(av || '')}">
                  ${av
                    ? `<img class="jira-ste-avatar" src="${av}" alt="">`
                    : `<span class="jira-ste-avatar"></span>`}
                  <span>${esc(u.displayName || u.emailAddress || u.accountId)}</span>
                </div>`;
      }).join('');
      list.innerHTML = unassignedHtml + usersHtml;
      list.querySelectorAll('.jira-ste-popover-item').forEach(it => {
        it.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const accountId   = it.dataset.accountId || null;
          const displayName = it.dataset.displayName;
          const avatar      = it.dataset.avatar;
          anchorEl.classList.add('jira-ste-busy');
          closeAllStePopovers();
          try {
            await setAssignee(issue.key, accountId || null);
            // Aggiorna lo stato locale e la UI senza dover rifetchare.
            issue.fields.assignee = accountId
              ? { accountId, displayName,
                  avatarUrls: avatar ? { '24x24': avatar } : undefined }
              : null;
            renderAssignee(issue.fields.assignee);
          } catch (err) {
            console.error('[Jira STE] errore set assignee:', err);
            alert(`Errore cambio assegnatario: ${err.message}`);
          } finally {
            anchorEl.classList.remove('jira-ste-busy');
          }
        });
      });
    }

    // Debounce ricerca a 250ms
    let t = null;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => loadUsers(input.value.trim()), 250);
    });
    loadUsers('');
  }

  // Crea un popover ancorato sotto-sinistra del riferimento dato e lo
  // appende al body (position: fixed, calcolato sulle coordinate del
  // BoundingClientRect dell'elemento di ancoraggio).
  function buildPopover(anchorEl) {
    const pop = document.createElement('div');
    pop.className = 'jira-ste-popover';
    document.body.appendChild(pop);
    const r = anchorEl.getBoundingClientRect();
    // Usiamo position:fixed sovrascrivendo l'absolute del CSS, così le
    // coordinate sono in viewport e non si rompono con scroll del pannello.
    pop.style.position = 'fixed';
    pop.style.top  = `${Math.min(r.bottom + 2, window.innerHeight - 40)}px`;
    pop.style.left = `${r.left}px`;
    return pop;
  }

  // ── Helper: estrai React props/fiber da un nodo DOM ──────────────
  function getReactProps(el) {
    const key = el && Object.keys(el).find(k => k.startsWith('__reactProps$'));
    return key ? el[key] : null;
  }
  function getReactFiber(el) {
    const key = el && Object.keys(el).find(
      k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
    );
    return key ? el[key] : null;
  }

  // ── Helper: cerca l'oggetto `history` di Jira nel fiber tree ─────
  //  Risalendo dal fiber del proxy link, troviamo l'history wrapper
  //  esposto dal router di Jira (history v4-like esteso con
  //  refreshRoutes). Ci serve per chiamare .replace(path) dopo aver
  //  acceso il drawer (vedi openIssueInSidePanel, Step B).
  //
  //  Firma riconosciuta: oggetto con push/replace + uno tra
  //  createHref/length/action (proprio dell'history wrapper).
  //
  //  NOTA STORICA: in passato avevamo tentato di trovare anche un
  //  oggetto `routerActions` (API alta di @atlassian/react-resource-
  //  router). NON è esposto né in props né nel fiber: vive in uno
  //  store sweet-state separato. Per questo motivo usiamo `history`
  //  + il trucco Step A documentato in openIssueInSidePanel.
  function findRouterFromFiber(startFiber) {
    const isHistoryLike = (v) =>
      v && typeof v === 'object' &&
      typeof v.push === 'function' &&
      typeof v.replace === 'function' &&
      (typeof v.createHref === 'function' || 'length' in v || 'action' in v);

    const seen = new WeakSet();
    let f = startFiber;
    let hopsUp = 0;
    while (f && hopsUp < 300) {
      hopsUp++;
      const p = f.memoizedProps;
      if (p && typeof p === 'object' && !seen.has(p)) {
        seen.add(p);
        if (isHistoryLike(p.history))                  return p.history;
        if (p.value && isHistoryLike(p.value.history)) return p.value.history;
        if (p.value && isHistoryLike(p.value))         return p.value;
      }
      // Hook list (function components)
      let s = f.memoizedState;
      let hops = 0;
      while (s && hops < 200) {
        hops++;
        const v = s.memoizedState;
        if (v && typeof v === 'object' && !seen.has(v)) {
          seen.add(v);
          if (isHistoryLike(v.history)) return v.history;
          if (isHistoryLike(v))         return v;
        }
        s = s.next;
      }
      f = f.return;
    }
    return null;
  }

  // ── Apertura della subtask nel side-panel del backlog ────────────
  //
  //  ⚠️  NON MODIFICARE LA SEQUENZA STEP A → STEP B SENZA AVER LETTO
  //      QUESTO BLOCCO.  La storia delle modifiche è in fondo.
  //
  //  Contesto: i link nativi del backlog
  //    a[data-is-router-link][data-testid$="card-contents.key"]
  //  hanno un React onClick che chiama internamente:
  //    handleNavigation(event, { routerActions: E, href: I, ... })
  //  dove:
  //    • `I` è la issue key BOUND a quella card al render
  //      (es. il primo link del backlog ha I="/browse/BND-477");
  //    • `E` è `routerActions` di @atlassian/react-resource-router,
  //      preso da context/sweet-state: NON è in props né nel fiber,
  //      quindi non possiamo invocarlo direttamente.
  //
  //  Per aprire la subtask N nel drawer servono DUE step in sequenza:
  //
  //    Step A) Invochiamo proxy.onClick(fakeEvent) con un evento
  //            sintetico. handleNavigation chiama routerActions.push
  //            con la `I` della closure → il drawer si MONTA sulla
  //            issue del proxy (es. BND-477). Da questo istante i
  //            resource subscribers del drawer sono vivi e ascoltano
  //            il parametro `selectedIssue` dell'URL.
  //
  //    Step B) Chiamiamo history.replace(...?selectedIssue=N) con
  //            l'history wrapper preso dal fiber tree. Il drawer,
  //            già montato, vede il cambio di query e ricarica il
  //            contenuto sulla subtask N. Usiamo replace (non push)
  //            per non sporcare la cronologia con la chiave
  //            transitoria del proxy.
  //
  //  Senza Step A il drawer non viene mai montato e Step B non basta
  //  a farlo apparire. Senza Step B il drawer resta sulla key del
  //  proxy invece della subtask richiesta. Servono ENTRAMBI, in
  //  quest'ordine.
  //
  //  Strategia 1 (fast-path): se la subtask è già una card visibile
  //  del backlog, props.href e onClick sono già legati alla key
  //  giusta → basta click() diretto sul suo link nativo.
  //
  //  ──────────────────────────────────────────────────────────────
  //  ANTI-PATTERN (già provati, NON ripetere):
  //   • Cliccare il NOSTRO <a> sperando nel router delegato di Jira:
  //     Jira ascolta solo i propri link React, non i nostri.
  //   • Modificare l'attributo href del proxy prima di .click():
  //     l'onClick legge `I` dalla closure, non dal DOM → apre sempre
  //     la key della card "vittima" del proxy.
  //   • Clonare il proxy e cliccare il clone: il clone non ha fiber
  //     React → nessun onClick → solo navigazione a pagina piena.
  //   • history.push("/browse/KEY") o window.history.pushState:
  //     l'URL cambia ma il drawer non si apre (i resource subscriber
  //     non vengono notificati).
  //   • history.refreshRoutes() senza argomenti: crash dell'app
  //     ("t is not iterable").
  //  ──────────────────────────────────────────────────────────────
  function openIssueInSidePanel(issueKey) {
    dgrp(`%c[Jira STE] 🚪 openIssueInSidePanel(${issueKey})`,
      'color:#0052CC;font-weight:bold');

    // ── 1) Fast-path: subtask già presente come card del backlog ──
    try {
      const ownLink = document.querySelector(
        `a[data-is-router-link="true"][data-testid$="card-contents.key"][href$="/browse/${issueKey}"]`
      );
      if (ownLink) {
        dlog('strategia 1 — ownLink trovato, click diretto');
        ownLink.click();
        dgrpe();
        return;
      }
    } catch (err) { dwarn('strategia 1 errore:', err); }

    // ── 2) Step A (proxy onClick) + Step B (history.replace) ──────
    try {
      // Proxy: un qualunque router-link "key" del backlog. Il suo
      // onClick React è già cablato al router interno di Jira: lo
      // useremo per "accendere" il drawer.
      const proxy = document.querySelector(
        'a[data-is-router-link="true"][data-testid$="card-contents.key"]'
      ) || document.querySelector(
        'a[data-is-router-link="true"][href*="/browse/"]'
      );
      if (!proxy) { dwarn('strategia 2 — nessun proxy trovato nel backlog'); }
      else {
        const props   = getReactProps(proxy);
        const fiber   = getReactFiber(proxy);
        const history = fiber ? findRouterFromFiber(fiber) : null;
        dlog('  proxy props.href (closure):', props && props.href);
        dlog('  history trovato?', !!history);

        if (props && typeof props.onClick === 'function' && history) {
          // Esposto per debug manuale da console.
          window.__jiraSTE_router = history;

          // ─── Step A ────────────────────────────────────────────
          //   Invoca l'onClick React del proxy → handleNavigation →
          //   routerActions.push(I) → il drawer si monta sulla key
          //   bound al proxy (transitorio).
          const fakeEvent = {
            type: 'click', button: 0, buttons: 1,
            ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
            target: proxy, currentTarget: proxy,
            preventDefault:  function () { this.defaultPrevented = true; },
            stopPropagation: function () { this._propagationStopped = true; },
            stopImmediatePropagation: function () { this._propagationStopped = true; },
            isDefaultPrevented:  function () { return !!this.defaultPrevented; },
            isPropagationStopped:function () { return !!this._propagationStopped; },
            nativeEvent: { button: 0, defaultPrevented: false },
            persist: function () {},
          };
          dlog('  step A → proxy.onClick(fakeEvent)');
          props.onClick(fakeEvent);
          dlog('  URL dopo step A:', window.location.href);

          // ─── Step B ────────────────────────────────────────────
          //   Scambia selectedIssue con la chiave VERA. Il drawer è
          //   già montato e ascolta il query param → ricarica sulla
          //   subtask richiesta.
          const cur = new URL(window.location.href);
          cur.searchParams.set('selectedIssue', issueKey);
          const target = cur.pathname + cur.search + cur.hash;
          dlog(`  step B → history.replace("${target}")`);
          history.replace(target);
          dlog('  URL dopo step B:', window.location.href);
          dgrpe();
          return;
        }
        dwarn('  proxy senza onClick o history non trovato → fallback');
      }
    } catch (err) { dwarn('strategia 2 errore:', err); }

    // ── 3) Fallback finale: navigazione classica ──────────────────
    //   Si perde il contesto del backlog ma almeno l'utente arriva
    //   sulla issue. Scatta solo se Jira ha cambiato struttura.
    console.warn('[Jira STE] strategie SPA fallite → navigazione classica a /browse/' + issueKey);
    window.location.href = `${BASE_URL}/browse/${issueKey}`;
    dgrpe();
  }

  // ── Pannello completo ────────────────────────────────────────────
  async function buildPanel(issueKey) {
    const panel = document.createElement('div');
    panel.className = 'jira-ste-panel';
    panel.dataset.steParent = issueKey;
    panel.innerHTML = `
      <div class="jira-ste-header">
        <span class="jira-ste-col-key">Key</span>
        <span class="jira-ste-col-summary">Titolo</span>
        <span class="jira-ste-col-status">Stato</span>
        <span class="jira-ste-col-assignee">Assegnatario</span>
      </div>`;
    try {
      const subtasks = await fetchSubtasks(issueKey);
      if (subtasks.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'jira-ste-msg';
        msg.textContent = 'Nessun child issue trovato tramite "parent = ...".';
        panel.appendChild(msg);
      } else {
        subtasks.forEach(st => panel.appendChild(makeRow(st)));
      }
    } catch (err) {
      const d = document.createElement('div');
      d.className = 'jira-ste-err';
      d.textContent = `⚠ Errore: ${err.message}`;
      panel.appendChild(d);
      console.error('[Jira STE]', err);
    }
    return panel;
  }

  // ── Singleton: un solo pannello aperto alla volta ────────────────
  let currentInstance = null;

  // ── Bottone ▶ ───────────────────────────────────────────────────
  function attachButton(row, issueKey) {
    if (row.dataset.steDone === '1') return;
    row.dataset.steDone = '1';
    row.setAttribute('data-ste-row', '1');

    // Riferimento mutabile: il backlog è virtualizzato, la card può
    // essere rimossa e ricreata. positionPanel() farà re-lookup per
    // questa issueKey e aggiornerà currentRow al nuovo nodo DOM.
    let currentRow = row;

    const btn = document.createElement('button');
    btn.className   = 'jira-ste-btn';
    btn.title       = `Espandi child issues di ${issueKey}`;
    btn.textContent = '▶';
    btn.setAttribute('data-ste-btn', issueKey);

    let panel = null;
    let open  = false;
    let cleanupReposition = null;
    let resizeObs = null;

    function positionPanel() {
      if (!panel) return;
      // Re-lookup della card se è stata rimossa dal DOM dalla
      // virtualizzazione del backlog (quando torna in viewport è un
      // nuovo nodo DOM con stessa issueKey nel data-testid).
      if (!currentRow.isConnected) {
        const fresh = document.querySelector(
          `[data-testid="software-backlog.card-list.card.content-container.${issueKey}"]`
        );
        if (fresh) {
          currentRow = fresh;
          currentRow.setAttribute('data-ste-row', '1');
          currentRow.dataset.steDone = '1';
          if (resizeObs) {
            try { resizeObs.disconnect(); } catch (_) {}
            resizeObs = new ResizeObserver(positionPanel);
            resizeObs.observe(currentRow);
            resizeObs.observe(document.body);
          }
        }
      }

      // Lookup dinamico dello scroller (può non esistere all'apertura
      // del pannello, ma materializzarsi dopo).
      const sc = document.querySelector(
        '[data-testid="software-backlog.backlog-content.scrollable"]'
      );
      const r = currentRow.getBoundingClientRect();

      // La card può essere rimossa dal DOM dalla virtualizzazione del
      // backlog quando esce dal viewport: in quel caso il rect è tutto
      // a 0. Oppure può essere fisicamente fuori dal viewport del
      // backlog (sotto l'header o sotto il footer dello scroller).
      // In entrambi i casi nascondiamo il pannello senza chiuderlo:
      // tornerà visibile quando la card rientra.
      const disconnected = !currentRow.isConnected || (r.width === 0 && r.height === 0);
      let outsideScroller = false;
      if (sc) {
        const s = sc.getBoundingClientRect();
        // Se la card è completamente sopra o sotto la viewport dello
        // scroller (con piccola tolleranza) → nascondi.
        outsideScroller = r.bottom < s.top + 2 || r.top > s.bottom - 2;
      }
      if (disconnected || outsideScroller) {
        panel.style.visibility = 'hidden';
        return;
      }
      panel.style.visibility = 'visible';

      // Sotto la card, allineato al bordo sinistro, larghezza pari alla card.
      const top = Math.min(r.bottom + 2, window.innerHeight - 40);
      panel.style.top    = `${top}px`;
      panel.style.left   = `${r.left + 24}px`;
      panel.style.width  = `${Math.max(r.width - 32, 320)}px`;
    }

    function close() {
      if (!open) return;
      if (panel) panel.remove();
      panel = null;
      open = false;
      btn.classList.remove('open', 'spin');
      btn.textContent = '▶';
      if (cleanupReposition) { cleanupReposition(); cleanupReposition = null; }
      if (currentInstance === instanceApi) currentInstance = null;
    }

    const instanceApi = { close, key: issueKey };

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Toggle: se è già aperto, chiudi
      if (open) { close(); return; }

      // Singleton: chiudi qualsiasi altro pannello aperto
      if (currentInstance && currentInstance !== instanceApi) {
        currentInstance.close();
      }
      currentInstance = instanceApi;

      btn.classList.add('spin'); btn.textContent = '↻';
      const built = await buildPanel(issueKey);
      btn.classList.remove('spin');
      btn.textContent = '▶';
      btn.classList.add('open');

      panel = built;
      // Montiamo il pannello in document.body (NON dentro la card del
      // backlog) per evitare che gli handler in capture-phase della card
      // intercettino i click sui link dei subtask. Posizione: position:fixed
      // calcolata sulle coordinate della card.
      document.body.appendChild(panel);
      positionPanel();

      // Riposiziona finché il pannello è aperto:
      //  • scroll/resize della finestra
      //  • scroll del container virtualizzato del backlog
      //  • ResizeObserver sulla row: si attiva quando il backlog si
      //    restringe perché Jira ha aperto il drawer laterale (la
      //    window non emette resize in quel caso).
      const scroller = document.querySelector(
        '[data-testid="software-backlog.backlog-content.scrollable"]'
      );
      const onMove = () => positionPanel();
      window.addEventListener('scroll', onMove, true);
      window.addEventListener('resize', onMove);
      if (scroller) scroller.addEventListener('scroll', onMove, { passive: true });
      if (typeof ResizeObserver !== 'undefined') {
        resizeObs = new ResizeObserver(onMove);
        resizeObs.observe(currentRow);
        // Anche il body: il drawer laterale modifica il layout globale.
        resizeObs.observe(document.body);
      }

      // Forward dello scroll wheel allo scroller del backlog quando il
      // mouse è sopra il pannello. Il pannello mantiene il proprio
      // scroll interno fino al limite (top/bottom o overflow assente);
      // oltre quel limite il delta viene inoltrato al backlog.
      const onWheel = (e) => {
        if (!scroller) return;
        const dy = e.deltaY;
        if (dy === 0) return;
        const canScroll = panel.scrollHeight > panel.clientHeight;
        const atTop     = panel.scrollTop <= 0;
        const atBottom  = panel.scrollTop + panel.clientHeight
                          >= panel.scrollHeight - 1;
        const panelHandles =
          canScroll && ((dy > 0 && !atBottom) || (dy < 0 && !atTop));
        if (!panelHandles) {
          e.preventDefault();
          scroller.scrollBy({ top: dy, left: e.deltaX, behavior: 'auto' });
        }
      };
      panel.addEventListener('wheel', onWheel, { passive: false });

      cleanupReposition = () => {
        window.removeEventListener('scroll', onMove, true);
        window.removeEventListener('resize', onMove);
        if (scroller) scroller.removeEventListener('scroll', onMove);
        if (resizeObs) resizeObs.disconnect();
        panel.removeEventListener('wheel', onWheel);
      };

      open = true;
    });

    row.appendChild(btn);
  }

  // ── Trova le righe del backlog ───────────────────────────────────
  //  Struttura confermata:
  //    [data-testid^="software-backlog.card-list.card.content-container."]
  //       └─ la issue key è nel suffisso del testid
  //       └─ se ha child issues contiene [data-testid$="child-issues-metadata"]
  function findBacklogRows() {
    const out = [];
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      const m = (row.dataset.testid || '').match(KEY_RE);
      if (!m) continue;
      if (ONLY_WITH_CHILDREN && !row.querySelector(CHILD_META_SELECTOR)) continue;
      out.push({ row, key: m[1] });
    }
    return out;
  }

  // ── Scansione principale ─────────────────────────────────────────
  function scan() {
    const rows = findBacklogRows();
    let injected = 0;
    for (const { row, key } of rows) {
      if (row.dataset.steDone === '1') continue;
      attachButton(row, key);
      injected++;
    }
    if (injected > 0) {
      console.log(
        `[Jira STE v4] ▶ Bottoni aggiunti: ${injected} — candidate totali: ${rows.length}`
      );
    }
  }

  // ── MutationObserver (debounce 80ms) ────────────────────────────
  //  Debounce basso così le frecce vengono riattaccate rapidamente
  //  quando il backlog virtualizzato ricrea le card durante lo scroll.
  const obs = new MutationObserver(() => {
    clearTimeout(obs._t);
    obs._t = setTimeout(scan, 80);
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Trigger anche su scroll del contenitore virtualizzato (più rapido)
  const scroller = document.querySelector(
    '[data-testid="software-backlog.backlog-content.scrollable"]'
  );
  if (scroller) {
    scroller.addEventListener('scroll', () => {
      clearTimeout(obs._t);
      obs._t = setTimeout(scan, 50);
    }, { passive: true });
  }

  scan();

  console.log(
    '%c[Jira STE v4] ✅ Attivo%c — freccia ▶ sulle issue con child issues. ' +
    'Per mostrarla su tutte le card, imposta ONLY_WITH_CHILDREN = false e reincolla.',
    'color:#0052CC;font-weight:bold', 'color:inherit'
  );

  // Hook di debug (accessibili da console):
  //   window.__jiraSTE.scan()                  — rescan del backlog
  //   window.__jiraSTE.findBacklogRows()       — righe candidate
  //   window.__jiraSTE.openIssueInSidePanel(K) — apri issue K nel drawer
  //   window.__jiraSTE_router                  — history wrapper di Jira
  //                                              (popolato dopo il primo
  //                                              uso del drawer)
  window.__jiraSTE = { scan, findBacklogRows, openIssueInSidePanel };
})();




