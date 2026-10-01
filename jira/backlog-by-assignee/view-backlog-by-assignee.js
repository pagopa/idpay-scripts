// ─────────────────────────────────────────────────────────────────
//  JIRA CLOUD — Backlog per Assegnatario  v1.0
// ─────────────────────────────────────────────────────────────────
//  Aggiunge un pulsante "👥 Per assegnatario" accanto ai filtri del
//  backlog di Jira Cloud. Cliccandolo si apre un pannello che mostra
//  TUTTE le issue della board (task + subtask) raggruppate per
//  assegnatario, in ordine alfabetico, con:
//
//   • badge di conteggio (Da fare / In corso / Completati / Totale,
//     poi WIP, giorni-in-corso e commenti recenti);
//   • evidenziazione delle issue "In corso" (statusCategory
//     = indeterminate), il focus principale del monitoraggio;
//   • filtro "Solo in corso" e ricerca per nome assegnatario;
//   • apertura della issue in una NUOVA SCHEDA al click sulla key
//     (il pannello con i dati resta aperto nella scheda corrente).
//
//  USO:  F12 → Console → incolla questo file → Invio
//        oppure usa il bookmarklet generato da build-bookmarklet.js.
//
//  DEBUG: imposta `const DEBUG = true` per log diagnostici.
// ─────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const BASE_URL = window.location.origin;
  const DEBUG = false;
  const dlog  = (...a) => { if (DEBUG) console.log('[Jira BBA]', ...a); };
  const dwarn = (...a) => { if (DEBUG) console.warn('[Jira BBA]', ...a); };
  // Log dei tempi SEMPRE attivo: utile per capire quali chiamate sono lente.
  const now  = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ms   = t => `${Math.round(now() - t)}ms`;
  const tlog = (...a) => console.log('%c[Jira BBA ⏱]', 'color:#6E5DC6;font-weight:700', ...a);

  // Soglia WIP: oltre questo numero di issue "In corso" l'assegnatario
  // viene segnalato come potenzialmente sovraccarico.
  const WIP_WARN = 3;

  // Issue "stantia": è In corso da almeno STALE_DAYS giorni, dove i giorni
  // sono calcolati sull'INGRESSO nello stato (statuscategorychangedate),
  // NON sul campo `updated` (che cambia a ogni modifica, commenti inclusi).
  const STALE_DAYS = 3;

  // Finestra, in ore, per segnalare i commenti "recenti".
  const COMMENT_HOURS = 12;

  // ── CSS ───────────────────────────────────────────────────────────
  //  Usa le CSS variables di Atlassian Design System (--ds-*) così i
  //  colori seguono tema chiaro/scuro. I valori dopo la virgola sono
  //  fallback se la variabile non è definita.
  if (!document.getElementById('jira-bba-styles')) {
    document.head.insertAdjacentHTML('beforeend', `<style id="jira-bba-styles">
      .jira-bba-trigger {
        display: inline-flex; align-items: center; gap: 4px;
        height: 24px; padding: 0 8px;
        margin: 0 4px;
        border: 1px solid var(--ds-border, #C1C7D0);
        border-radius: 3px;
        background: var(--ds-surface-raised, #FFFFFF);
        color: var(--ds-text-subtle, #44546F);
        font-size: 12px; font-weight: 500;
        cursor: pointer; white-space: nowrap; vertical-align: middle;
      }
      .jira-bba-trigger:hover {
        background: var(--ds-background-neutral-subtle-hovered, rgba(9,30,66,.06));
      }
      .jira-bba-trigger.floating {
        position: fixed; top: 76px; right: 20px; z-index: 9998;
        height: 28px; padding: 0 10px; margin: 0;
        box-shadow: var(--ds-shadow-raised, 0 1px 1px rgba(9,30,66,.25));
      }

      .jira-bba-backdrop {
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(9,30,66,.54);
        display: flex; align-items: flex-start; justify-content: center;
        padding: 40px 16px;
        animation: bba-fade .12s ease;
      }
      @keyframes bba-fade { from { opacity: 0 } }

      .jira-bba-modal {
        display: flex; flex-direction: column;
        width: 100%; max-width: 980px; max-height: calc(100vh - 80px);
        border-radius: 6px;
        background: var(--ds-surface-overlay, var(--ds-surface, #FFFFFF));
        color: var(--ds-text, #172B4D);
        box-shadow: var(--ds-shadow-overlay, 0 8px 24px rgba(9,30,66,.3));
        overflow: hidden;
      }

      .jira-bba-head {
        display: flex; align-items: center; gap: 12px;
        padding: 14px 18px;
        border-bottom: 1px solid var(--ds-border, #DFE1E6);
      }
      .jira-bba-title {
        font-size: 13px; font-weight: 700; margin: 0;
        max-width: 90px; line-height: 1.15; flex-shrink: 0;
      }
      .jira-bba-spacer { flex: 1; }
      .jira-bba-search {
        height: 30px; padding: 0 10px; min-width: 200px;
        border: 1px solid var(--ds-border, #C1C7D0); border-radius: 3px;
        background: var(--ds-surface-raised, #FFFFFF);
        color: var(--ds-text, inherit); font-size: 13px;
      }
      .jira-bba-sprint {
        height: 30px; padding: 0 8px; max-width: 220px;
        border: 1px solid var(--ds-border, #C1C7D0); border-radius: 3px;
        background: var(--ds-surface-raised, #FFFFFF);
        color: var(--ds-text, inherit); font-size: 13px; cursor: pointer;
      }
      .jira-bba-check {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 13px; cursor: pointer; white-space: nowrap;
        color: var(--ds-text-subtle, #44546F);
      }
      .jira-bba-iconbtn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 30px; height: 30px; padding: 0;
        border: 1px solid var(--ds-border, #C1C7D0); border-radius: 3px;
        background: var(--ds-surface-raised, #FFFFFF);
        color: var(--ds-text-subtle, #44546F);
        font-size: 15px; cursor: pointer;
      }
      .jira-bba-iconbtn:hover {
        background: var(--ds-background-neutral-subtle-hovered, rgba(9,30,66,.06));
      }

      .jira-bba-summary {
        padding: 8px 18px; font-size: 13px;
        color: var(--ds-text-subtle, #44546F);
        border-bottom: 1px solid var(--ds-border, #EBECF0);
        background: var(--ds-background-neutral-subtle, transparent);
      }

      .jira-bba-body { overflow-y: auto; padding: 6px 0; }

      .jira-bba-person { border-bottom: 1px solid var(--ds-border, #EBECF0); }
      .jira-bba-person-head {
        display: flex; align-items: center; gap: 10px;
        padding: 9px 18px; cursor: pointer;
        position: sticky; top: 0; z-index: 1;
        background: var(--ds-surface-overlay, var(--ds-surface, #FFFFFF));
      }
      .jira-bba-person-head:hover {
        background: var(--ds-background-neutral-subtle-hovered, rgba(9,30,66,.05));
      }
      .jira-bba-caret { width: 12px; font-size: 10px; color: var(--ds-text-subtlest, #6B6E76); }
      .jira-bba-avatar {
        width: 26px; height: 26px; border-radius: 50%; object-fit: cover;
        background: var(--ds-background-neutral, #DFE1E6); flex-shrink: 0;
      }
      .jira-bba-name { font-weight: 600; font-size: 14px; }
      .jira-bba-badges { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
      .jira-bba-badge {
        padding: 2px 8px; border-radius: 10px;
        font-size: 11px; font-weight: 700; white-space: nowrap;
      }
      .jira-bba-badge.inprogress { background: var(--ds-background-information, #E9F2FF); color: var(--ds-text-information, #0055CC); }
      .jira-bba-badge.todo       { background: var(--ds-background-neutral, #DCDFE4);     color: var(--ds-text, #172B4D); }
      .jira-bba-badge.done       { background: var(--ds-background-success, #DCFFF1);     color: var(--ds-text-success, #216E4E); }
      .jira-bba-badge.total      { background: transparent; border: 1px solid var(--ds-border, #C1C7D0); color: var(--ds-text-subtle, #44546F); }
      .jira-bba-badge.sp         { background: var(--ds-background-discovery-bold, #6E5DC6); color: var(--ds-text-inverse, #FFFFFF); }
      .jira-bba-badge.wip-warn   { background: var(--ds-background-warning, #FFF7D6);     color: var(--ds-text-warning, #974F0C); }
      .jira-bba-badge.stale      { background: var(--ds-background-warning-bold, #E2B203); color: var(--ds-text-inverse, #172B4D); }
      .jira-bba-badge.comments   { background: var(--ds-background-discovery, #F3F0FF);   color: var(--ds-text-discovery, #5E4DB2); }

      .jira-bba-issues { padding: 0 0 6px; }
      .jira-bba-issue {
        display: flex; align-items: center; gap: 8px;
        padding: 5px 18px 5px 42px;
        font-size: 13px;
        border-left: 3px solid transparent;
      }
      .jira-bba-issue.inprogress {
        border-left-color: var(--ds-border-information, #0C66E4);
        background: var(--ds-background-information, rgba(12,102,228,.06));
      }
      .jira-bba-issue.stale {
        border-left-color: var(--ds-border-warning, #E2B203);
        background: var(--ds-background-warning, #FFF7D6);
      }
      .jira-bba-ip-tag {
        display: inline-flex; align-items: center; gap: 3px;
        padding: 1px 6px; border-radius: 10px;
        font-size: 10px; font-weight: 700; white-space: nowrap;
        background: var(--ds-background-neutral, #DCDFE4);
        color: var(--ds-text-subtle, #44546F);
      }
      .jira-bba-ip-tag.warn {
        background: var(--ds-background-warning-bold, #E2B203);
        color: var(--ds-text-inverse, #172B4D);
      }
      .jira-bba-comment-tag { font-size: 12px; white-space: nowrap; }
      .jira-bba-comment-link {
        font-size: 12px; white-space: nowrap; text-decoration: none; cursor: pointer;
      }
      .jira-bba-comment-link:hover { filter: brightness(.9); }
      .jira-bba-sp-tag {
        display: inline-flex; align-items: center; gap: 2px;
        padding: 1px 6px; border-radius: 10px;
        font-size: 10px; font-weight: 700; white-space: nowrap;
        background: var(--ds-background-discovery, #F3F0FF);
        color: var(--ds-text-discovery, #5E4DB2);
      }
      .jira-bba-type { width: 16px; height: 16px; flex-shrink: 0; }
      .jira-bba-key {
        color: var(--ds-link, #0C66E4); text-decoration: none;
        font-weight: 600; white-space: nowrap; min-width: 92px;
      }
      .jira-bba-key:hover { text-decoration: underline; }
      .jira-bba-parent {
        color: var(--ds-text-subtlest, #6B6E76); font-size: 11px;
        white-space: nowrap;
      }
      .jira-bba-parent-link {
        color: var(--ds-link, #0C66E4); font-size: 11px;
        white-space: nowrap; text-decoration: none; font-weight: 600;
      }
      .jira-bba-parent-link:hover { text-decoration: underline; }
      .jira-bba-sum {
        flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .jira-bba-status {
        padding: 2px 8px; border-radius: 3px;
        font-size: 11px; font-weight: 700; white-space: nowrap;
        text-transform: uppercase; letter-spacing: .03em;
        min-width: 96px; text-align: center;
      }
      .jira-bba-msg {
        padding: 24px 18px; text-align: center; font-style: italic;
        color: var(--ds-text-subtlest, #6B6E76);
      }
      .jira-bba-err {
        margin: 12px 18px; padding: 8px 12px; border-radius: 4px;
        color: var(--ds-text-danger, #AE2A19);
        background: var(--ds-background-danger, #FFECEB);
      }
    </style>`);
  }

  // ── Util ───────────────────────────────────────────────────────────
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
  ));

  function statusStyle(catKey) {
    return ({
      'new'           : { bg: 'var(--ds-background-neutral, #DCDFE4)',      fg: 'var(--ds-text, #172B4D)' },
      'indeterminate' : { bg: 'var(--ds-background-information, #E9F2FF)',  fg: 'var(--ds-text-information, #0055CC)' },
      'done'          : { bg: 'var(--ds-background-success, #DCFFF1)',      fg: 'var(--ds-text-success, #216E4E)' },
    })[catKey] || { bg: 'var(--ds-background-neutral, #DCDFE4)', fg: 'var(--ds-text, #172B4D)' };
  }

  // ── Scope: board id / project key dall'URL ────────────────────────
  function detectScope() {
    const url = window.location.href;
    let m = url.match(/\/boards\/(\d+)/) || url.match(/[?&]rapidView=(\d+)/);
    const boardId = m ? m[1] : null;
    m = url.match(/\/projects\/([A-Z0-9][A-Z0-9_]+)/i) ||
        url.match(/[?&]projectKey=([A-Z0-9][A-Z0-9_]+)/i);
    const projectKey = m ? m[1].toUpperCase() : null;
    return { boardId, projectKey };
  }

  async function jiraJSON(url, opts = {}) {
    const t0 = now();
    const label = (opts.method || 'GET') + ' ' + url.replace(BASE_URL, '');
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
      tlog(`✗ ${ms(t0)} · ${label} · HTTP ${r.status}`);
      const b = await r.json().catch(() => ({}));
      const msg = b.errorMessages?.[0]
        || (b.errors && Object.values(b.errors)[0])
        || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    tlog(`${ms(t0)} · ${label}`);
    if (r.status === 204) return null;
    return r.json().catch(() => null);
  }

  const ISSUE_FIELDS = ['summary', 'status', 'assignee', 'issuetype', 'parent', 'priority', 'updated', 'duedate', 'sprint', 'statuscategorychangedate', 'comment'];

  // Id del custom field "Story Points" (varia per istanza): lo risolviamo
  // a runtime da /rest/api/3/field. '' = risolto ma non trovato.
  let SP_FIELD = null;
  async function resolveStoryPointField() {
    if (SP_FIELD !== null) return SP_FIELD;
    try {
      const fields = await jiraJSON(`${BASE_URL}/rest/api/3/field`);
      const by = re => (fields || []).find(f => re.test(f.name || ''));
      const f = by(/^story point estimate$/i) || by(/^story points$/i) || by(/story point/i);
      SP_FIELD = f ? f.id : '';
    } catch (e) { dwarn('field resolve fallito', e); SP_FIELD = ''; }
    return SP_FIELD;
  }
  // Elenco dei campi da richiedere, incluso lo Story Points se risolto.
  function issueFields() {
    return SP_FIELD ? ISSUE_FIELDS.concat(SP_FIELD) : ISSUE_FIELDS.slice();
  }
  // Story points dell'issue (numero) oppure null.
  function storyPointsOf(it) {
    if (!SP_FIELD) return null;
    const v = it.fields?.[SP_FIELD];
    return (typeof v === 'number' && !isNaN(v)) ? v : null;
  }

  // Numero di giorni interi trascorsi da una data ISO (null se assente).
  function daysSince(iso) {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return null;
    return Math.floor(ms / 86400000);
  }
  // Giorni trascorsi da quando la issue è entrata nella categoria di
  // stato corrente (null se non è In corso o dato assente).
  function inProgressDays(it) {
    if (it.fields?.status?.statusCategory?.key !== 'indeterminate') return null;
    return daysSince(it.fields?.statuscategorychangedate);
  }
  // Issue stantia: in corso da almeno STALE_DAYS giorni (dall'ingresso
  // nello stato, non dall'ultima modifica).
  function isStale(it) {
    const d = inProgressDays(it);
    return d != null && d >= STALE_DAYS;
  }
  // Commento più recente (oggetto, con id/created/updated) oppure null.
  function latestComment(it) {
    const list = it.fields?.comment?.comments;
    if (!list || !list.length) return null;
    let best = null, max = -1;
    for (const cm of list) {
      const t = new Date(cm.updated || cm.created).getTime();
      if (!isNaN(t) && t >= max) { max = t; best = cm; }
    }
    return best;
  }
  // True se c'è un commento nelle ultime COMMENT_HOURS ore.
  function hasRecentComment(it) {
    const cm = latestComment(it);
    if (!cm) return false;
    const t = new Date(cm.updated || cm.created).getTime();
    return !isNaN(t) && (Date.now() - t) <= COMMENT_HOURS * 3600000;
  }
  // Sprint "corrente" di una issue: oggetto {id,name,state} oppure null
  // (backlog). Il campo può essere un oggetto singolo o un array; se
  // l'issue è in più sprint, preferiamo quello attivo, poi quello
  // futuro, altrimenti l'ultimo (serve per escludere i passati).
  function isSubtask(it) { return !!it.fields?.issuetype?.subtask; }

  // Sprint "grezzo" letto dal campo dell'issue (ignora l'ereditarietà
  // dal parent per i subtask). Vedi sprintOf() per quello "effettivo".
  function rawSprintOf(it) {
    const s = it.fields?.sprint;
    if (!s) return null;
    const arr = Array.isArray(s) ? s : [s];
    if (!arr.length) return null;
    return arr.find(x => x && x.state === 'active')
        || arr.find(x => x && x.state === 'future')
        || arr[arr.length - 1];
  }

  // Sprint "effettivo" usato da raggruppamento e filtri. Per i subtask è
  // quello del parent (calcolato in fetchIssues e salvato in __sprint),
  // perché i subtask non hanno uno sprint proprio.
  function sprintOf(it) {
    if (it && it.__sprint !== undefined) return it.__sprint;
    return rawSprintOf(it);
  }

  // Esclude dai risultati gli sprint PASSATI (completati): teniamo solo
  // issue in sprint attivo/futuro o nel backlog (nessuno sprint). Questo
  // riduce molto il numero di issue caricate → caricamento più veloce.
  const OPEN_OR_BACKLOG_JQL = '(sprint in openSprints() OR sprint is EMPTY)';

  // Tutte le issue della board (task + subtask) con paginazione,
  // escludendo gli sprint chiusi via JQL (con fallback se la board non
  // supporta le funzioni sprint, es. Kanban).
  //  Ottimizzazioni:
  //   - la prima pagina fa anche da "probe" JQL: non viene riscaricata;
  //   - note `total` e la dimensione pagina, le pagine successive sono
  //     scaricate IN PARALLELO invece che in sequenza.
  async function fetchBoardIssues(boardId) {
    function page(startAt, useJql) {
      const u = new URL(`${BASE_URL}/rest/agile/1.0/board/${boardId}/issue`);
      u.searchParams.set('fields', issueFields().join(','));
      u.searchParams.set('maxResults', '100');
      u.searchParams.set('startAt', String(startAt));
      if (useJql) u.searchParams.set('jql', OPEN_OR_BACKLOG_JQL);
      return jiraJSON(u.toString());
    }
    let useJql = true;
    let first;
    try {
      first = await page(0, true);
    } catch (e) {
      dwarn('JQL sprint non supportata sulla board, fallback senza filtro', e);
      useJql = false;
      first = await page(0, false);
    }
    const out = (first.issues || []).slice();
    const total = typeof first.total === 'number' ? first.total : null;
    const step = (first.maxResults > 0 ? first.maxResults : out.length) || 100;

    if (total != null && out.length > 0) {
      // Sappiamo quante issue mancano: scarichiamo le pagine in parallelo.
      const tasks = [];
      for (let startAt = step; startAt < total; startAt += step) tasks.push(page(startAt, useJql));
      if (tasks.length) {
        const tP = now();
        const results = await Promise.all(tasks);
        tlog(`board: ${tasks.length} pagine extra in parallelo: ${ms(tP)}`);
        for (const d of results) out.push(...(d.issues || []));
      }
    } else {
      // Totale ignoto: fallback sequenziale.
      let startAt = out.length;
      for (let guard = 0; guard < 200 && out.length > 0; guard++) {
        const data = await page(startAt, useJql);
        const issues = data.issues || [];
        if (!issues.length) break;
        out.push(...issues);
        startAt += issues.length;
        if (issues.length < step) break;
      }
    }
    return out;
  }

  // Fallback: tutte le issue di un progetto via JQL (sprint passati esclusi).
  //  Due endpoint possibili:
  //   - "enhanced" /search/jql: pagina per nextPageToken (sequenziale, niente total);
  //   - legacy /search: pagina per startAt/total → pagine in parallelo.
  async function fetchProjectIssues(projectKey) {
    const jql = `project = "${projectKey}" AND ${OPEN_OR_BACKLOG_JQL} ORDER BY assignee ASC, status ASC`;
    function enhancedPage(token) {
      const body = { jql, fields: issueFields(), maxResults: 100 };
      if (token) body.nextPageToken = token;
      return jiraJSON(`${BASE_URL}/rest/api/3/search/jql`, { method: 'POST', body: JSON.stringify(body) });
    }
    function legacyPage(startAt) {
      const u = `${BASE_URL}/rest/api/3/search?jql=${encodeURIComponent(jql)}` +
                `&fields=${issueFields().join(',')}&maxResults=100&startAt=${startAt}`;
      return jiraJSON(u);
    }
    let useEnhanced = true;
    let first;
    try {
      first = await enhancedPage(null);
    } catch (e) {
      useEnhanced = false;
      first = await legacyPage(0);
    }
    const out = (first.issues || []).slice();

    if (useEnhanced) {
      // Token-based: non c'è `total`, quindi sequenziale.
      let token = first.nextPageToken;
      for (let guard = 0; guard < 200 && token; guard++) {
        const d = await enhancedPage(token);
        out.push(...(d.issues || []));
        token = d.nextPageToken;
      }
    } else {
      const total = typeof first.total === 'number' ? first.total : null;
      const step = (first.maxResults > 0 ? first.maxResults : out.length) || 100;
      if (total != null && out.length > 0) {
        const tasks = [];
        for (let startAt = step; startAt < total; startAt += step) tasks.push(legacyPage(startAt));
        if (tasks.length) {
          const tP = now();
          const results = await Promise.all(tasks);
          tlog(`progetto: ${tasks.length} pagine extra in parallelo: ${ms(tP)}`);
          for (const d of results) out.push(...(d.issues || []));
        }
      } else {
        let startAt = out.length;
        for (let guard = 0; guard < 100 && out.length > 0; guard++) {
          const data = await legacyPage(startAt);
          const issues = data.issues || [];
          if (!issues.length) break;
          out.push(...issues);
          startAt += issues.length;
          if (issues.length < step) break;
        }
      }
    }
    return out;
  }

  async function fetchIssues() {
    const tAll = now();
    const { boardId, projectKey } = detectScope();
    dlog('scope', { boardId, projectKey });
    const tSp = now();
    await resolveStoryPointField();
    tlog(`risoluzione campo Story Points: ${ms(tSp)}`);
    let issues = null;
    if (boardId) {
      const tB = now();
      try { issues = await fetchBoardIssues(boardId); tlog(`fetch board #${boardId}: ${ms(tB)} · ${issues.length} issue`); }
      catch (e) { dwarn('board issues falliti, provo progetto', e); }
    }
    if (issues == null && projectKey) {
      const tP = now();
      issues = await fetchProjectIssues(projectKey);
      tlog(`fetch progetto ${projectKey}: ${ms(tP)} · ${issues.length} issue`);
    }
    if (issues == null) {
      throw new Error('Impossibile determinare board o progetto dall\'URL. Apri la vista Backlog.');
    }

    // 1) Scarta ciò che è esplicitamente in uno sprint CHIUSO.
    let kept = issues.filter(it => { const sp = rawSprintOf(it); return !sp || sp.state !== 'closed'; });

    // 2) I subtask non hanno sprint proprio: il filtro JQL `sprint is EMPTY`
    //    li fa passare TUTTI, anche quelli il cui parent è in uno sprint
    //    concluso (e quindi assente dai risultati). Teniamo un subtask solo
    //    se il suo parent è tra i task visibili (= non in sprint chiuso).
    const parents = new Map();
    for (const it of kept) if (!isSubtask(it)) parents.set(it.key, it);
    kept = kept.filter(it => {
      if (!isSubtask(it)) return true;
      const pk = it.fields?.parent?.key;
      return pk && parents.has(pk);
    });

    // 3) Sprint effettivo: i subtask ereditano quello del parent, così il
    //    filtro per sprint li raggruppa correttamente.
    for (const it of kept) {
      if (isSubtask(it)) {
        const p = parents.get(it.fields?.parent?.key);
        it.__sprint = (p ? rawSprintOf(p) : null) || null;
      } else {
        it.__sprint = rawSprintOf(it) || null;
      }
    }
    tlog(`fetchIssues totale: ${ms(tAll)} · ${kept.length} issue dopo i filtri`);
    return kept;
  }

  // ── Raggruppamento per assegnatario ───────────────────────────────
  const UNASSIGNED = '__unassigned__';

  function groupByAssignee(issues) {
    const map = new Map();
    for (const it of issues) {
      const a = it.fields?.assignee;
      const id = a?.accountId || UNASSIGNED;
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: a?.displayName || 'Non assegnato',
          avatar: a?.avatarUrls?.['24x24'] || null,
          issues: [],
          counts: { todo: 0, inprogress: 0, done: 0, stale: 0, comments: 0, sp: 0, total: 0 },
        });
      }
      const g = map.get(id);
      g.issues.push(it);
      g.counts.total++;
      const cat = it.fields?.status?.statusCategory?.key || 'new';
      if (cat === 'indeterminate') g.counts.inprogress++;
      else if (cat === 'done')     g.counts.done++;
      else                         g.counts.todo++;
      if (isStale(it)) g.counts.stale++;
      if (hasRecentComment(it)) g.counts.comments++;
      const sp = storyPointsOf(it);
      if (sp != null) g.counts.sp += sp;
    }
    const groups = [...map.values()];
    // Ordina le issue di ogni persona: prima In corso, poi Da fare, poi
    // Completate; a parità, per key.
    const catRank = { indeterminate: 0, new: 1, done: 2 };
    for (const g of groups) {
      g.issues.sort((x, y) => {
        const rx = catRank[x.fields?.status?.statusCategory?.key] ?? 1;
        const ry = catRank[y.fields?.status?.statusCategory?.key] ?? 1;
        if (rx !== ry) return rx - ry;
        return (x.key || '').localeCompare(y.key || '', undefined, { numeric: true });
      });
    }
    // Assegnatari in ordine alfabetico; "Non assegnato" sempre in fondo.
    groups.sort((a, b) => {
      if (a.id === UNASSIGNED) return 1;
      if (b.id === UNASSIGNED) return -1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return groups;
  }

  // ── Rendering ──────────────────────────────────────────────────────
  function issueRowHtml(it) {
    const f = it.fields || {};
    const cat = f.status?.statusCategory?.key || 'new';
    const { bg, fg } = statusStyle(cat);
    const typeIcon = f.issuetype?.iconUrl;
    const isSub = f.issuetype?.subtask;
    const parentKey = isSub ? f.parent?.key : null;
    const ipDays = inProgressDays(it);          // giorni in "In corso"
    const stale = ipDays != null && ipDays >= STALE_DAYS;
    const recentComment = hasRecentComment(it);
    const sp = storyPointsOf(it);
    const classes = ['jira-bba-issue'];
    if (cat === 'indeterminate') classes.push('inprogress');
    if (stale) classes.push('stale');
    const parentTag = parentKey
      ? `<a class="jira-bba-parent-link" href="${BASE_URL}/browse/${esc(parentKey)}" target="_blank" rel="noopener" title="Apri la storia padre ${esc(parentKey)} in una nuova scheda">↳ ${esc(parentKey)}</a>`
      : '';
    const spTag = sp != null
      ? `<span class="jira-bba-sp-tag" title="Story points">◆ ${sp}</span>`
      : '';
    const ipTag = ipDays != null
      ? `<span class="jira-bba-ip-tag${stale ? ' warn' : ''}" title="In corso da ${ipDays} giorni (dall'ingresso nello stato)">🕒 ${ipDays}g</span>`
      : '';
    let commentTag = '';
    if (recentComment) {
      const cm = latestComment(it);
      const href = `${BASE_URL}/browse/${esc(it.key)}` + (cm && cm.id ? `?focusedCommentId=${esc(cm.id)}` : '');
      commentTag = `<a class="jira-bba-comment-link" href="${href}" target="_blank" rel="noopener" title="Apri i commenti (nuovo nelle ultime ${COMMENT_HOURS} ore) in una nuova scheda">💬</a>`;
    }
    return `
      <div class="${classes.join(' ')}" data-bba-stale="${stale ? '1' : '0'}" data-bba-comment="${recentComment ? '1' : '0'}">
        ${typeIcon ? `<img class="jira-bba-type" src="${esc(typeIcon)}" alt="${esc(f.issuetype?.name)}" title="${esc(f.issuetype?.name)}">` : '<span class="jira-bba-type"></span>'}
        <a class="jira-bba-key" href="${BASE_URL}/browse/${esc(it.key)}" target="_blank" rel="noopener" data-bba-issue="${esc(it.key)}">${esc(it.key)}</a>
        ${parentTag}
        <span class="jira-bba-sum" title="${esc(f.summary)}">${esc(f.summary || '—')}</span>
        ${spTag}
        ${commentTag}
        ${ipTag}
        <span class="jira-bba-status" style="background:${bg};color:${fg}">${esc(f.status?.name || '—')}</span>
      </div>`;
  }

  function personHtml(g) {
    const c = g.counts;
    const wipWarn = c.inprogress >= WIP_WARN;
    const spTotal = Math.round(c.sp * 10) / 10;
    // Ordine: Da fare, In corso, Completati, Somma, poi WIP e altri segnali.
    const badges = [
      `<span class="jira-bba-badge todo" title="Da fare">${c.todo}</span>`,
      `<span class="jira-bba-badge inprogress" title="In corso">▶ ${c.inprogress}</span>`,
      `<span class="jira-bba-badge done" title="Completati">${c.done}</span>`,
      `<span class="jira-bba-badge total" title="Totale assegnate">Σ ${c.total}</span>`,
      spTotal ? `<span class="jira-bba-badge sp" title="Story points totali (somma delle storie)">◆ ${spTotal}</span>` : '',
      wipWarn ? `<span class="jira-bba-badge wip-warn" title="WIP alto (≥ ${WIP_WARN} in corso)">⚠ WIP</span>` : '',
      c.stale ? `<span class="jira-bba-badge stale" title="Issue in corso da ≥ ${STALE_DAYS} giorni">🕒 ${c.stale}</span>` : '',
      c.comments ? `<span class="jira-bba-badge comments" title="Issue con commenti nelle ultime ${COMMENT_HOURS} ore">💬 ${c.comments}</span>` : '',
    ].join('');
    return `
      <div class="jira-bba-person" data-bba-person="${esc(g.id)}" data-bba-name="${esc(g.name.toLowerCase())}" data-bba-inprogress="${c.inprogress}" data-bba-stale="${c.stale}">
        <div class="jira-bba-person-head">
          <span class="jira-bba-caret">▼</span>
          ${g.avatar ? `<img class="jira-bba-avatar" src="${esc(g.avatar)}" alt="">` : '<span class="jira-bba-avatar"></span>'}
          <span class="jira-bba-name">${esc(g.name)}</span>
          <span class="jira-bba-badges">${badges}</span>
        </div>
        <div class="jira-bba-issues">${g.issues.map(issueRowHtml).join('')}</div>
      </div>`;
  }

  // ── Pannello (singleton) ──────────────────────────────────────────
  let backdrop = null;
  // Cache dei dati tra chiusura e riapertura del pannello: evita di
  // rifare le (lente) chiamate al BE. Si aggiorna solo col pulsante ↻.
  let cachedIssues = null;   // ultime issue caricate
  let cachedSprint = null;   // valore del filtro sprint scelto dall'utente

  function closePanel() {
    if (backdrop) { backdrop.remove(); backdrop = null; }
    document.removeEventListener('keydown', onEsc, true);
  }
  function onEsc(e) { if (e.key === 'Escape') closePanel(); }

  function applyFilters(modal) {
    const q = modal.querySelector('.jira-bba-search').value.trim().toLowerCase();
    const onlyWip   = modal.querySelector('.jira-bba-only-wip').checked;
    const onlyStale = modal.querySelector('.jira-bba-only-stale').checked;
    let visiblePeople = 0;
    modal.querySelectorAll('.jira-bba-person').forEach(p => {
      const name  = p.dataset.bbaName || '';
      const wip   = parseInt(p.dataset.bbaInprogress || '0', 10);
      const stale = parseInt(p.dataset.bbaStale || '0', 10);
      const matchName  = !q || name.includes(q);
      const matchWip   = !onlyWip   || wip > 0;
      const matchStale = !onlyStale || stale > 0;
      const show = matchName && matchWip && matchStale;
      p.style.display = show ? '' : 'none';
      if (show) visiblePeople++;
      // Nascondi le issue che non rispettano i toggle attivi.
      p.querySelectorAll('.jira-bba-issue').forEach(row => {
        const hideWip   = onlyWip   && !row.classList.contains('inprogress');
        const hideStale = onlyStale && row.dataset.bbaStale !== '1';
        row.style.display = (hideWip || hideStale) ? 'none' : '';
      });
    });
    const empty = modal.querySelector('.jira-bba-empty');
    if (empty) empty.style.display = visiblePeople === 0 ? '' : 'none';
  }

  function setAllCollapsed(modal, collapsed) {
    modal.querySelectorAll('.jira-bba-person').forEach(p => {
      const list  = p.querySelector('.jira-bba-issues');
      const caret = p.querySelector('.jira-bba-caret');
      if (!list) return;
      list.style.display = collapsed ? 'none' : '';
      if (caret) caret.textContent = collapsed ? '▶' : '▼';
    });
  }

  async function openPanel() {
    if (backdrop) { closePanel(); return; }

    backdrop = document.createElement('div');
    backdrop.className = 'jira-bba-backdrop';
    backdrop.innerHTML = `
      <div class="jira-bba-modal" role="dialog" aria-label="Backlog per assegnatario">
        <div class="jira-bba-head">
          <h2 class="jira-bba-title">👥 Per assegnatario</h2>
          <span class="jira-bba-spacer"></span>
          <select class="jira-bba-sprint" title="Filtra per sprint (gli sprint passati sono esclusi)"><option value="all">Attivi + futuri + backlog</option></select>
          <input class="jira-bba-search" type="text" placeholder="Filtra assegnatario…">
          <label class="jira-bba-check"><input type="checkbox" class="jira-bba-only-wip"> Solo in corso</label>
          <label class="jira-bba-check"><input type="checkbox" class="jira-bba-only-stale"> Solo in corso da ≥${STALE_DAYS}g</label>
          <button class="jira-bba-iconbtn jira-bba-expand-all" title="Espandi tutti gli assegnatari">⊞</button>
          <button class="jira-bba-iconbtn jira-bba-collapse-all" title="Comprimi tutti gli assegnatari">⊟</button>
          <button class="jira-bba-iconbtn jira-bba-refresh" title="Ricarica">↻</button>
          <button class="jira-bba-iconbtn jira-bba-close" title="Chiudi (Esc)">✕</button>
        </div>
        <div class="jira-bba-summary">Carico le issue della board…</div>
        <div class="jira-bba-body"><div class="jira-bba-msg">⏳ Caricamento…</div></div>
      </div>`;
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onEsc, true);

    const modal   = backdrop.querySelector('.jira-bba-modal');
    const body    = backdrop.querySelector('.jira-bba-body');
    const summary = backdrop.querySelector('.jira-bba-summary');

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closePanel(); });
    modal.querySelector('.jira-bba-close').addEventListener('click', closePanel);
    modal.querySelector('.jira-bba-search').addEventListener('input', () => applyFilters(modal));
    modal.querySelector('.jira-bba-only-wip').addEventListener('change', () => applyFilters(modal));
    modal.querySelector('.jira-bba-only-stale').addEventListener('change', () => applyFilters(modal));
    modal.querySelector('.jira-bba-sprint').addEventListener('change', () => { cachedSprint = sprintSel.value; render(); });
    modal.querySelector('.jira-bba-refresh').addEventListener('click', () => load());
    modal.querySelector('.jira-bba-expand-all').addEventListener('click', () => setAllCollapsed(modal, false));
    modal.querySelector('.jira-bba-collapse-all').addEventListener('click', () => setAllCollapsed(modal, true));

    // Delega: toggle collapse persona + apertura link in nuova scheda.
    body.addEventListener('click', (e) => {
      const link = e.target.closest('.jira-bba-key, .jira-bba-parent-link, .jira-bba-comment-link');
      if (link) {
        // Apri SEMPRE in una nuova scheda, così il pannello con i dati
        // resta aperto nella scheda corrente.
        e.preventDefault();
        window.open(link.getAttribute('href'), '_blank', 'noopener');
        return;
      }
      const head = e.target.closest('.jira-bba-person-head');
      if (head) {
        const list = head.nextElementSibling;
        const caret = head.querySelector('.jira-bba-caret');
        const collapsed = list.style.display === 'none';
        list.style.display = collapsed ? '' : 'none';
        caret.textContent = collapsed ? '▼' : '▶';
      }
    });

    let lastIssues = cachedIssues || [];
    // Se c'è già una cache, non è il primo caricamento: conserviamo la
    // scelta sprint dell'utente invece di forzare lo sprint attivo.
    let firstLoad = cachedIssues ? false : true;
    const sprintSel = modal.querySelector('.jira-bba-sprint');

    // Popola il menu degli sprint dai dati caricati (attivi prima, poi
    // per nome). Al PRIMO caricamento preseleziona lo sprint attivo; ai
    // refresh successivi conserva la scelta dell'utente.
    function populateSprints(issues) {
      const byId = new Map();
      for (const it of issues) {
        const sp = sprintOf(it);
        if (sp && sp.id != null && !byId.has(sp.id)) byId.set(sp.id, sp);
      }
      const sprints = [...byId.values()].sort((a, b) => {
        const rank = s => (s.state === 'active' ? 0 : s.state === 'future' ? 1 : 2);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
      });
      const prev = (cachedSprint != null) ? cachedSprint : sprintSel.value;
      const hasBacklog = issues.some(it => !sprintOf(it));
      sprintSel.innerHTML =
        '<option value="all">Attivi + futuri + backlog</option>' +
        sprints.map(s => `<option value="${esc(String(s.id))}">${esc(s.name)}${s.state === 'active' ? ' (attivo)' : s.state === 'future' ? ' (futuro)' : ''}</option>`).join('') +
        (hasBacklog ? '<option value="none">Backlog (nessuno sprint)</option>' : '');
      const active = sprints.find(s => s.state === 'active');
      if (firstLoad && active) {
        sprintSel.value = String(active.id);
      } else if ([...sprintSel.options].some(o => o.value === prev)) {
        sprintSel.value = prev;
      }
      cachedSprint = sprintSel.value;
    }

    function filterBySprint(issues) {
      const v = sprintSel.value;
      if (v === 'all') return issues;
      if (v === 'none') return issues.filter(it => !sprintOf(it));
      return issues.filter(it => { const sp = sprintOf(it); return sp && String(sp.id) === v; });
    }

    function render() {
      const issues = filterBySprint(lastIssues);
      const groups = groupByAssignee(issues);
      const totalWip   = groups.reduce((s, g) => s + g.counts.inprogress, 0);
      const totalStale = groups.reduce((s, g) => s + g.counts.stale, 0);
      const totalComm  = groups.reduce((s, g) => s + g.counts.comments, 0);
      const people = groups.filter(g => g.id !== UNASSIGNED).length;
      summary.textContent =
        `${people} assegnatari · ${issues.length} issue · ${totalWip} in corso · ${totalStale} in corso da ≥ ${STALE_DAYS}g · ${totalComm} commentate (≤ ${COMMENT_HOURS}h)` +
        (groups.some(g => g.id === UNASSIGNED) ? ' · include non assegnate' : '');
      if (groups.length === 0) {
        body.innerHTML = '<div class="jira-bba-msg">Nessuna issue per questo filtro.</div>';
        return;
      }
      body.innerHTML =
        groups.map(personHtml).join('') +
        '<div class="jira-bba-msg jira-bba-empty" style="display:none">Nessun assegnatario corrisponde al filtro.</div>';
      applyFilters(modal);
    }

    async function load() {
      const t0 = now();
      body.innerHTML = '<div class="jira-bba-msg">⏳ Caricamento…</div>';
      summary.textContent = 'Carico le issue della board…';
      try {
        lastIssues = await fetchIssues();
        cachedIssues = lastIssues;          // aggiorna la cache condivisa
        populateSprints(lastIssues);
        render();
        firstLoad = false;
        tlog(`load() completo (fetch + render): ${ms(t0)}`);
      } catch (err) {
        console.error('[Jira BBA]', err);
        summary.textContent = 'Errore';
        body.innerHTML = `<div class="jira-bba-err">⚠ ${esc(err.message)}</div>`;
      }
    }

    // Riapertura: se ci sono già dati in cache li riusiamo subito (niente
    // chiamate al BE); il pulsante ↻ forza comunque un aggiornamento.
    if (cachedIssues) {
      tlog(`riuso dati dalla cache (${cachedIssues.length} issue) · usa ↻ per aggiornare`);
      populateSprints(lastIssues);
      render();
    } else {
      load();
    }
  }

  // ── Trigger: pulsante nella barra filtri, accanto ai filtri persona ─
  //  Cerchiamo prima il filtro "assegnatario/persona" (gruppo di avatar)
  //  per inserire il pulsante proprio lì accanto; in mancanza, un
  //  qualunque contenitore della barra filtri; altrimenti fallback
  //  flottante in alto a destra.
  function findFilterAnchor() {
    const personSel = [
      '[data-testid*="assignee" i]',
      '[data-testid*="avatar-group" i]',
      '[data-testid*="avatar-stack" i]',
      '[data-testid*="user-picker" i]',
    ];
    for (const s of personSel) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    const barSel = [
      '[data-testid^="software-filters.ui"]',
      '[data-testid*="filter-bar"]',
      '[data-testid*="filters"]',
    ];
    for (const s of barSel) {
      const el = document.querySelector(s);
      if (el && el.lastElementChild) return el.lastElementChild;
      if (el) return el;
    }
    return null;
  }

  function ensureTrigger() {
    if (document.querySelector('.jira-bba-trigger')) return;
    const btn = document.createElement('button');
    btn.className = 'jira-bba-trigger';
    btn.innerHTML = '👥 <span>Per assegnatario</span>';
    btn.title = 'Mostra il backlog raggruppato per assegnatario';
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openPanel(); });

    const anchor = findFilterAnchor();
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(btn, anchor.nextSibling);
    } else {
      btn.classList.add('floating');
      document.body.appendChild(btn);
    }
  }

  const obs = new MutationObserver(() => {
    clearTimeout(obs._t);
    obs._t = setTimeout(ensureTrigger, 150);
  });
  obs.observe(document.body, { childList: true, subtree: true });
  ensureTrigger();

  console.log(
    '%c[Jira BBA v1] ✅ Attivo%c — pulsante "👥 Per assegnatario" accanto ai filtri del backlog.',
    'color:#0052CC;font-weight:bold', 'color:inherit'
  );

  // Hook di debug da console:
  //   window.__jiraBBA.open()        — apri il pannello
  //   window.__jiraBBA.fetchIssues() — issue grezze della board
  window.__jiraBBA = { open: openPanel, close: closePanel, fetchIssues, ensureTrigger };
})();
