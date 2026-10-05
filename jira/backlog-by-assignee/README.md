# Jira Backlog per Assegnatario

Userscript / bookmarklet che aggiunge nel **backlog di Jira Cloud** un piccolo
pulsante **`👥 Per assegnatario`** nella **barra dei filtri**, accanto al filtro
per persona. Cliccandolo si apre un pannello che mostra le issue della board
(**task + subtask**) **raggruppate per assegnatario**, in **ordine alfabetico**,
pensato per monitorare a colpo d'occhio *chi fa cosa* — con particolare evidenza
sulle issue **in corso**.

> **Gli sprint passati (completati) sono esclusi.** Vengono caricate solo le
> issue di sprint **attivi/futuri** e del **backlog**: questo riduce i dati e
> velocizza il caricamento iniziale.

Per ogni assegnatario mostra:

- **Avatar e nome**
- **Badge di conteggio**, nell'ordine: gli eventuali segnali `💬 N` (commenti nelle ultime 12h), `⚠ WIP` e `🕒 N` (in corso da ≥ N giorni), seguiti dai conteggi fissi `⏹ Da fare` / `▶ In corso` / `✔ Completati` / `Σ Totale` / `⚖️ SP` a destra
- l'elenco delle sue issue (tipo, key, parent, titolo) con i badge a destra nell'ordine: notifica commento `💬`, tempo in corso `🕒 Ng`, stato, e all'estrema destra il badge Story Points `⚖️ N`:
  - le issue **in corso evidenziate**;
  - un tag **`⚖️ N`** con gli **story point** della storia (i subtask spesso non ne
    hanno: in quel caso il tag non compare);
  - un tag **`🕒 Ng`** = **da quanti giorni la issue è entrata in "In corso"**
    (dall'ingresso nello stato, diventa giallo oltre la soglia);
  - un tag **`💬`** (link) se c'è un **commento nelle ultime 12 ore**: apre
    direttamente la **sezione commenti** della issue in una nuova scheda;
  - per i subtask, il riferimento al **parent** è un **link** (`↳ KEY`) che apre
    la storia padre in una nuova scheda

Controlli nel pannello:

- **Filtro per sprint**: menu a tendina che al caricamento è già posizionato sullo
  **sprint attivo**; puoi passare a `Attivi + futuri + backlog`, a un altro sprint
  attivo/futuro, o al solo **Backlog** (issue senza sprint). Ricalcola conteggi e
  raggruppamenti; gli sprint passati non compaiono mai.
- **Ricerca** per nome assegnatario
- **Espandi tutti / Comprimi tutti** (`▼` / `▶`): aprono o chiudono in un colpo
  solo tutti gli accordion degli assegnatari, per mostrare o nascondere tutti i
  task
- **Solo in corso**: mostra solo persone e issue `In corso`
- **Solo in corso da ≥Ng**: mostra solo persone e issue in corso da almeno N
  giorni
- **Ricarica** (`↻`): rifà le chiamate al backend e aggiorna i dati
- Chiusura con il pulsante `✕`, con `Esc` o click sullo sfondo. **Alla
  riapertura i dati vengono riusati dalla cache** (nessuna nuova chiamata al
  backend, apertura immediata): per aggiornarli usa il pulsante `↻`
- **Click sulla key** → apre la issue in una **nuova scheda** (il pannello con i
  dati resta aperto nella scheda corrente); lo stesso vale per il **link al
  parent** e per il **link ai commenti** `💬`

> **Prestazioni e cache:** il primo caricamento può essere lento (molte issue da
> scaricare). I dati scaricati restano in **cache in memoria** finché la pagina
> non viene ricaricata: chiudendo e riaprendo il pannello si rivede subito lo
> stato precedente (sprint selezionato compreso) senza richiamare il backend.
> Usa `↻` quando vuoi dati freschi. In **console** vengono stampati i tempi di
> ogni chiamata con il prefisso `[Jira BBA ⏱]` (durata per singola richiesta,
> per fase di fetch e totale `load()`), utili per capire cosa è più lento.
>
> **Ottimizzazioni del caricamento:**
> - la **prima pagina** della board fa anche da test di supporto JQL: non viene
>   più riscaricata (prima partiva una chiamata doppia e inutile);
> - una volta noto il numero totale di issue, le **pagine successive vengono
>   scaricate in parallelo** invece che in sequenza → meno attesa complessiva;
> - l'id del campo *Story Points* (`/rest/api/3/field`) viene risolto **una sola
>   volta** e riusato;
> - i dati restano in **cache** finché non ricarichi la pagina (vedi sopra).
>
> Il campo `comment` (necessario al tag `💬`) aumenta il payload di ogni issue: se
> il caricamento resta lento, è la voce più pesante da osservare nei log.

> **Nota sul concetto di "fermo da N giorni":** NON usa il campo `updated` (che in
> Jira cambia a *qualsiasi* modifica, commenti inclusi), ma
> `statuscategorychangedate`, cioè da quando la issue è entrata nella categoria di
> stato corrente. Il tag `💬` invece segnala i commenti recenti, derivati dal
> campo `comment`.

## Contenuto della cartella

| File | A cosa serve |
|------|--------------|
| `view-backlog-by-assignee.js` | Lo script vero e proprio, eseguito nella finestra del browser. |
| `build-bookmarklet.js` | Script Node che minifica e genera i due bookmarklet (inline e loader). |
| `backlog-by-assignee.bookmarklet.inline.txt` | Bookmarklet "tutto incluso": l'intero script è dentro l'URL `javascript:`. |
| `backlog-by-assignee.bookmarklet.loader.txt` | Bookmarklet "leggero": carica lo script da un URL remoto (es. raw GitHub). |

## Come usarlo

### 1. Incolla al volo nella console (test rapido)

1. Apri il backlog Jira nel browser.
2. Premi `F12` → tab **Console**.
3. Copia il contenuto di `view-backlog-by-assignee.js` e incollalo.
4. Premi `Invio`. Comparirà il pulsante `👥 Per assegnatario`.

### 2. Bookmarklet inline (consigliato per uso quotidiano)

1. Genera i bookmarklet: `node build-bookmarklet.js`
2. Apri `backlog-by-assignee.bookmarklet.inline.txt` e copia tutto il contenuto
   (inizia con `javascript:`).
3. Crea un segnalibro nella barra preferiti:
   - **Nome:** `Jira Backlog per assegnatario`
   - **URL:** incolla il contenuto del file
4. Apri la pagina Backlog, poi clicca il segnalibro.

### 3. Bookmarklet loader (per condividerlo nel team)

1. In `build-bookmarklet.js` verifica/aggiorna `REMOTE_URL` facendolo puntare al
   raw di `view-backlog-by-assignee.js`.
2. Esegui `node build-bookmarklet.js`.
3. Usa il contenuto di `backlog-by-assignee.bookmarklet.loader.txt` come URL del
   segnalibro. Ogni click rifà il fetch dell'ultima versione (cache-buster
   `?t=timestamp`).

## Come funziona (in breve)

- Rileva la **board** (o il progetto) dall'URL (`/boards/<id>`, `rapidView=<id>`,
  `/projects/<KEY>`).
- Carica le issue della board via `GET /rest/agile/1.0/board/<id>/issue` con
  paginazione, applicando il filtro JQL
  `(sprint in openSprints() OR sprint is EMPTY)` per **escludere gli sprint
  passati** (così si caricano meno issue e il caricamento iniziale è più veloce).
  Include i subtask i cui stati sono mappati sulle colonne, e il campo `sprint`.
  Fallback: se la board non supporta le funzioni sprint (es. Kanban) ricarica
  senza quel filtro; se non c'è board, JQL `project = <KEY> AND (sprint in
  openSprints() OR sprint is EMPTY)` su `/rest/api/3/search/jql` (con fallback al
  legacy `/rest/api/3/search`).
- **Subtask e sprint passati:** i subtask non hanno uno sprint proprio, quindi il
  clausola `sprint is EMPTY` li lascerebbe passare *tutti* (anche quelli il cui
  parent è in uno sprint concluso). Per questo, dopo il fetch lo script:
  1. scarta le issue esplicitamente in uno sprint `closed`;
  2. tiene un subtask **solo se il suo parent è tra i task visibili** (ossia non
     in uno sprint concluso);
  3. assegna a ogni subtask lo **sprint effettivo del parent**, così il filtro per
     sprint lo raggruppa correttamente.
- Raggruppa lato client per `assignee.accountId`, ordina gli assegnatari in
  ordine alfabetico (`Non assegnato` in fondo). Le issue di ciascuno sono ordinate
  per **categoria di stato** (prima i *Completati*, poi gli *In corso*, infine gli
  *In attesa*); a parità per ultima modifica (`updated`) decrescente. I **subtask
  il cui task padre è dello stesso assegnatario** vengono mostrati **subito sotto
  al padre** (padre prima, poi i suoi subtask), così i gruppi imparentati restano
  vicini. Tutti gli accordion degli assegnatari nascono **chiusi di default** per
  una vista sintetica.
- Una issue conta come **in corso da ≥ N giorni** quando è *In corso*
  (`statusCategory = indeterminate`) e `statuscategorychangedate` (ingresso nello
  stato) è più vecchio di `STALE_DAYS` giorni (default 3, in cima allo script).
  **Non** si usa `updated`, che cambia a ogni modifica (commenti compresi).
- Il tag **`💬`** (commento recente) deriva dal campo `comment`: lo script prende
  il timestamp del commento più recente e lo confronta con `COMMENT_HOURS`
  (default 12). Il campo `comment` aumenta un po' il payload; per issue con
  moltissimi commenti il rilevamento usa i commenti restituiti dalla ricerca.
  Il tag `💬` è un link che apre la issue sul commento più recente
  (`?focusedCommentId=…`) in una nuova scheda.
- Gli **story point** vengono letti da un campo custom specifico dell'istanza,
  rilevato a runtime da `/rest/api/3/field` (match su *Story point estimate* →
  *Story points* → *story point*). Vengono mostrati per singola storia (`⚖️ N`) e
  sommati per persona (`⚖️ SP`). I subtask di solito non hanno story point.
- Al caricamento il filtro sprint è impostato sullo **sprint attivo**; il
  **filtro per sprint** usa il campo `sprint` (effettivo, ereditato dal parent per
  i subtask): ri-filtra il set caricato e ri-raggruppa, così i conteggi restano
  coerenti con lo sprint scelto.
- Inserisce un pulsante **piccolo** nella barra filtri accanto al filtro per
  persona (gruppo di avatar / assegnatario); se non la trova, usa un pulsante
  **flottante** in alto a destra. Un `MutationObserver` lo ri-aggancia se Jira
  ri-renderizza la toolbar.

## Requisiti

- Jira Cloud (interfaccia "moderna" del backlog).
- Essere autenticati: le chiamate REST usano i cookie di sessione
  (`credentials: 'same-origin'`).
- Per `build-bookmarklet.js`: Node.js (nessuna dipendenza esterna).

## Troubleshooting

- **Non compare il pulsante** → assicurati di essere nella vista *Backlog*. In
  console deve apparire `[Jira BBA v1] ✅ Attivo`.
- **Errore "Impossibile determinare board o progetto"** → apri una vista che
  abbia `/boards/<id>` o `/projects/<KEY>` nell'URL.
- **HTTP 401/403** → sessione Jira scaduta: ricarica e rifai login.
- **Mancano dei subtask** → compaiono solo i subtask i cui stati sono mappati
  sulle colonne della board; dipende dalla configurazione della board.
- **Debug da console:**
  ```js
  window.__jiraBBA.open();         // apre il pannello
  window.__jiraBBA.fetchIssues();  // ritorna le issue grezze
  ```

## Idee per feature aggiuntive

Conoscendo i campi disponibili (`status`, `assignee`, `issuetype`, `parent`,
`priority`, `updated`, `duedate`, più story points, sprint, label, ecc.) si può
arricchire molto la visione di *chi fa cosa*:

- **Story point per persona/stato**: somma della stima (campo
  `customfield_100xx`) per avere il carico reale, non solo il numero di issue.
- **Ordinamento alternativo**: toggle per ordinare gli assegnatari per numero di
  issue in corso o per story point, oltre all'alfabetico.
- **Scadenze**: badge per le issue **in ritardo** o in scadenza entro X giorni
  (`duedate`).
- **Blocked / flagged**: indicatore per issue bloccate o con flag impediment.
- **Raggruppamento per stato dentro ogni persona** (To Do / In Progress / Done)
  con sotto-intestazioni.
- **Export / copia per lo standup**: pulsante per copiare negli appunti o
  esportare in CSV il riepilogo "persona → issue in corso".
- **Vista parent→subtask**: mostrare la gerarchia (quali subtask di una storia
  sono su persone diverse) per capire le dipendenze incrociate.
- **Soglia WIP configurabile** e conteggio globale del team sopra soglia.
- **Riepilogo di team**: totali per categoria, % completamento, numero di issue
  non assegnate (rischio di lavoro "orfano").
