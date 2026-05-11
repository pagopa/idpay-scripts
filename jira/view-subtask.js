// ─────────────────────────────────────────────────────────────────
//  JIRA CLOUD — Subtask Expander per il Backlog  v4.0
//  Selettori aggiornati al backlog moderno (software-backlog.card-list.*)
//  - Mostra la freccia solo sulle issue con child-issues-metadata
//  - Estrae la issue key dal data-testid della card
//  - Endpoint API aggiornato a /rest/api/3/search/jql (POST) + fallback
// ──────���──────────────────────────────────────────────────────────
//  USO:  F12 → Console → incolla → Invio
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

      /* Popover sovrastante, ancorato alla card (data-ste-row è relative) */
      .jira-ste-panel {
        position: absolute !important;
        top: 100%;
        left: 24px;
        right: 8px;
        margin-top: 2px;
        z-index: 1000;
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

  // ── Riga subtask ─────────────────────────────────────────────────
  function makeRow(issue) {
    const f = issue.fields || {};
    const summary  = f.summary || '—';
    const status   = f.status?.name || '—';
    const catKey   = f.status?.statusCategory?.key || 'new';
    const assignee = f.assignee?.displayName || 'Non assegnato';
    const avatar   = f.assignee?.avatarUrls?.['24x24'];
    const { bg, fg } = statusStyle(catKey);

    const row = document.createElement('div');
    row.className = 'jira-ste-row';
    row.innerHTML = `
      <a class="jira-ste-key" href="${BASE_URL}/browse/${esc(issue.key)}"
         target="_blank" rel="noopener">${esc(issue.key)}</a>
      <span class="jira-ste-summary" title="${esc(summary)}">${esc(summary)}</span>
      <span class="jira-ste-status" style="background:${bg};color:${fg}">${esc(status)}</span>
      <span class="jira-ste-assignee">
        ${avatar
          ? `<img class="jira-ste-avatar" src="${avatar}" alt="">`
          : `<span class="jira-ste-avatar"></span>`}
        <span>${esc(assignee)}</span>
      </span>`;
    return row;
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

    const btn = document.createElement('button');
    btn.className   = 'jira-ste-btn';
    btn.title       = `Espandi child issues di ${issueKey}`;
    btn.textContent = '▶';
    btn.setAttribute('data-ste-btn', issueKey);

    let panel = null;
    let open  = false;

    function close() {
      if (!open) return;
      if (panel) panel.remove();
      panel = null;
      open = false;
      btn.classList.remove('open', 'spin');
      btn.textContent = '▶';
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
      // Append dentro la card: [data-ste-row]{position:relative} è attivo,
      // quindi il pannello (absolute) si posiziona rispetto alla card.
      row.appendChild(panel);
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

  // ── MutationObserver (debounce 300ms) ───────────────────────────
  const obs = new MutationObserver(() => {
    clearTimeout(obs._t);
    obs._t = setTimeout(scan, 300);
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Trigger anche su scroll del contenitore virtualizzato
  const scroller = document.querySelector(
    '[data-testid="software-backlog.backlog-content.scrollable"]'
  );
  if (scroller) {
    scroller.addEventListener('scroll', () => {
      clearTimeout(obs._t);
      obs._t = setTimeout(scan, 200);
    }, { passive: true });
  }

  scan();

  console.log(
    '%c[Jira STE v4] ✅ Attivo%c — freccia ▶ sulle issue con child issues. ' +
    'Per mostrarla su tutte le card, imposta ONLY_WITH_CHILDREN = false e reincolla.',
    'color:#0052CC;font-weight:bold', 'color:inherit'
  );

  // Hook di debug
  window.__jiraSTE = { scan, findBacklogRows };
})();




