# Jira Subtask Expander

Piccolo userscript / bookmarklet che aggiunge nel **backlog di Jira Cloud** una
freccia `▶` accanto a ogni issue che possiede dei child issues. Cliccandola si
apre un pannello inline che mostra, senza ricaricare la pagina, l'elenco dei
sotto-task con:

- **Key** (link diretto alla issue)
- **Titolo**
- **Stato** (badge colorato per categoria: `new` / `indeterminate` / `done`)
- **Assegnatario** (con avatar)

È pensato per evitare di entrare in ogni storia per controllare a colpo
d'occhio lo stato dei suoi child issues. Supporta i temi personalizzati.

## Contenuto della cartella

| File | A cosa serve                                                                           |
|------|----------------------------------------------------------------------------------------|
| `view-subtask.js` | Lo script vero e proprio. È quello che viene eseguito dentro la finestra del browser.  |
| `build-bookmarklet.js` | Script Node che minifica `view-subtask.js` e genera due bookmarklet (inline e loader). |
| `subtask.bookmarklet.inline.txt` | Bookmarklet "tutto incluso": l'intero script è dentro l'URL `javascript:`.             |
| `subtask.bookmarklet.loader.txt` | Bookmarklet "leggero": carica `view-subtask.js` da un URL remoto (es. raw GitHub).     |

## Come usarlo

Ci sono tre modi, dal più rapido al più comodo.

### 1. Incolla al volo nella console (test rapido)

1. Apri il backlog Jira nel browser.
2. Premi `F12` → tab **Console**.
3. Copia il contenuto di `view-subtask.js` e incollalo nella console.
4. Premi `Invio`. Comparirà la freccia `▶` sulle card con child issues.

Lo script resta attivo finché non ricarichi la pagina.

### 2. Bookmarklet inline (consigliato per uso quotidiano)

1. Genera i bookmarklet:
   ```bash
   node build-bookmarklet.js
   ```
   Verranno (ri)creati i due file `.txt`.
2. Apri `subtask.bookmarklet.inline.txt` e copia tutto il contenuto (inizia
   con `javascript:`).
3. Nel browser crea un nuovo segnalibro nella barra preferiti:
   - **Nome:** `Jira Subtasks script loader`
   - **URL:** incolla il contenuto del file
4. Apri prima la pagina di backlog Jira, poi basta cliccare il segnalibro per attivare lo
   script.

### 3. Bookmarklet loader (per condividerlo nel team)

Utile quando lo script viene aggiornato spesso: il segnalibro non cambia mai,
ma carica sempre la versione più recente da un URL pubblico.

1. In `build-bookmarklet.js` modifica la costante:
   ```js
   const REMOTE_URL = 'https://raw.githubusercontent.com/YOUR_ORG/YOUR_REPO/main/jira/view-subtask.js';
   ```
   facendola puntare al raw del file `view-subtask.js` (es. GitHub / GitLab).
2. Esegui `node build-bookmarklet.js`.
3. Usa il contenuto di `subtask.bookmarklet.loader.txt` come URL del
   segnalibro (stessa procedura del punto 2).

Ogni click sul bookmarklet rifà il fetch del file remoto (con cache-buster
`?t=timestamp`), quindi tutti vedono subito le modifiche pushate sul repo.

## Come funziona (in breve)

- Aggancia un `MutationObserver` al `body` e ascolta lo scroll del contenitore
  virtualizzato del backlog (`software-backlog.backlog-content.scrollable`)
  per intercettare le card man mano che vengono renderizzate.
- Per ogni card individua la issue key dal `data-testid`
  (`software-backlog.card-list.card.content-container.<KEY>`) e — se richiesto —
  verifica la presenza del metadato `child-issues-metadata`.
- Al click sulla freccia chiama l'API REST di Jira con la JQL
  `parent = "<KEY>" ORDER BY created ASC`, provando prima
  `POST /rest/api/3/search/jql` e, in fallback, il vecchio
  `GET /rest/api/3/search`.
- È un **singleton**: un solo pannello aperto alla volta; cliccare un'altra
  freccia chiude il precedente.

## Requisiti

- Jira Cloud (interfaccia "moderna" del backlog).
- Essere autenticati: le chiamate REST usano i cookie di sessione
  (`credentials: 'same-origin'`).
- Per `build-bookmarklet.js`: Node.js (qualsiasi versione recente, nessuna
  dipendenza esterna).

## Troubleshooting

- **Non compare nessuna freccia** → assicurati di essere nella vista
  *Backlog* (non Board / Timeline) e che le card siano effettivamente
  renderizzate. In console deve apparire `[Jira STE v4] ✅ Attivo`.
- **Errore HTTP 401/403** → la sessione Jira è scaduta, ricarica la pagina e
  rifai login.
- **Errore HTTP 410 / 404 su `/search/jql`** → lo script ha già il fallback
  automatico sull'endpoint legacy, ma se Atlassian rimuove anche quello sarà
  necessario aggiornare `fetchSubtasks`.
- **Debug manuale** dalla console:
  ```js
  window.__jiraSTE.scan();            // forza una nuova scansione
  window.__jiraSTE.findBacklogRows(); // elenca le card candidate
  ```

