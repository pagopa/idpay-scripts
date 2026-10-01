#!/usr/bin/env node
/**
 * Genera 2 bookmarklet da view-backlog-by-assignee.js:
 *   1. backlog-by-assignee.bookmarklet.inline.txt  - script intero dentro il segnalibro
 *   2. backlog-by-assignee.bookmarklet.loader.txt  - carica lo script da URL remoto
 * USO:  node build-bookmarklet.js
 */
const fs = require('fs');
const path = require('path');
const SRC        = path.join(__dirname, 'view-backlog-by-assignee.js');
const OUT_INLINE = path.join(__dirname, 'backlog-by-assignee.bookmarklet.inline.txt');
const OUT_LOADER = path.join(__dirname, 'backlog-by-assignee.bookmarklet.loader.txt');
// ⚠️ Cambia con l'URL raw pubblico del tuo view-backlog-by-assignee.js
const REMOTE_URL = 'https://raw.githubusercontent.com/pagopa/idpay-scripts/refs/heads/main/jira/backlog-by-assignee/view-backlog-by-assignee.js';
function minify(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}
function toBookmarklet(code) {
  const wrapped = "(function(){try{" + code +
    "}catch(e){console.error('[Jira BBA]',e);alert('[Jira BBA] '+e.message);}})();void 0;";
  return 'javascript:' + encodeURIComponent(wrapped);
}
const code = minify(fs.readFileSync(SRC, 'utf8'));
fs.writeFileSync(OUT_INLINE, toBookmarklet(code) + '\n');
console.log('OK ' + path.basename(OUT_INLINE));
const loader =
  "var s=document.createElement('script');" +
  "s.src=" + JSON.stringify(REMOTE_URL) + "+'?t='+Date.now();" +
  "s.onerror=function(){alert('[Jira BBA] Impossibile caricare '+s.src);};" +
  "document.head.appendChild(s);";
fs.writeFileSync(OUT_LOADER, toBookmarklet(loader) + '\n');
console.log('OK ' + path.basename(OUT_LOADER));
