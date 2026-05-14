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
    // NB: replichiamo gli attributi del link "key" nativo del backlog
    //     (data-is-router-link + target="_self" + href relativo) così che
    //     il router SPA di Jira intercetti il click e apra il side-panel,
    //     invece di aprire una nuova tab o navigare a pagina piena.
    row.innerHTML = `
      <a class="jira-ste-key"
         href="/browse/${esc(issue.key)}"
         target="_self"
         data-is-router-link="true"
         data-ste-issue="${esc(issue.key)}"
         rel="noopener">${esc(issue.key)}</a>
      <span class="jira-ste-summary" title="${esc(summary)}">${esc(summary)}</span>
      <span class="jira-ste-status" style="background:${bg};color:${fg}">${esc(status)}</span>
      <span class="jira-ste-assignee">
        ${avatar
          ? `<img class="jira-ste-avatar" src="${avatar}" alt="">`
          : `<span class="jira-ste-avatar"></span>`}
        <span>${esc(assignee)}</span>
      </span>`;

    const link = row.querySelector('.jira-ste-key');
    // Click handler: replica il comportamento delle card native del
    // backlog (apertura nel drawer laterale invece che navigazione
    // a pagina piena). I click con modificatori (Ctrl/Cmd/Shift/Alt/
    // middle-click) restano nativi → aprono in nuova tab/finestra
    // grazie all'attributo href.
    link.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
      // Blocca SOLO la navigazione di default (no stopPropagation:
      // il diag listener globale, se attivo, deve comunque vedere il
      // click per fini di debug).
      e.preventDefault();
      dgrp(`%c[Jira STE] 🖱️ click su subtask ${issue.key}`,
        'color:#0052CC;font-weight:bold');
      dlog('URL prima del click:', window.location.href);
      dgrpe();
      openIssueInSidePanel(issue.key);
    });
    return row;
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

    const btn = document.createElement('button');
    btn.className   = 'jira-ste-btn';
    btn.title       = `Espandi child issues di ${issueKey}`;
    btn.textContent = '▶';
    btn.setAttribute('data-ste-btn', issueKey);

    let panel = null;
    let open  = false;
    let cleanupReposition = null;

    function positionPanel() {
      if (!panel) return;
      const r = row.getBoundingClientRect();
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

      // Riposiziona su scroll/resize finché il pannello è aperto.
      const scroller = document.querySelector(
        '[data-testid="software-backlog.backlog-content.scrollable"]'
      );
      const onMove = () => positionPanel();
      window.addEventListener('scroll', onMove, true);
      window.addEventListener('resize', onMove);
      if (scroller) scroller.addEventListener('scroll', onMove, { passive: true });
      cleanupReposition = () => {
        window.removeEventListener('scroll', onMove, true);
        window.removeEventListener('resize', onMove);
        if (scroller) scroller.removeEventListener('scroll', onMove);
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

  // Hook di debug (accessibili da console):
  //   window.__jiraSTE.scan()                  — rescan del backlog
  //   window.__jiraSTE.findBacklogRows()       — righe candidate
  //   window.__jiraSTE.openIssueInSidePanel(K) — apri issue K nel drawer
  //   window.__jiraSTE_router                  — history wrapper di Jira
  //                                              (popolato dopo il primo
  //                                              uso del drawer)
  window.__jiraSTE = { scan, findBacklogRows, openIssueInSidePanel };
})();




