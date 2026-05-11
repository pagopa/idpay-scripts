#!/usr/bin/env node
/**
 * Genera 2 bookmarklet da subtask.js:
 *   1. subtask.bookmarklet.inline.txt  - script intero dentro il segnalibro
 *   2. subtask.bookmarklet.loader.txt  - carica subtask.js da URL remoto
 * USO:  node build-bookmarklet.js
 */
const fs = require('fs');
const path = require('path');
const SRC        = path.join(__dirname, 'view-subtask.js');
const OUT_INLINE = path.join(__dirname, 'subtask.bookmarklet.inline.txt');
const OUT_LOADER = path.join(__dirname, 'subtask.bookmarklet.loader.txt');
// ⚠️ Cambia con l'URL raw pubblico del tuo subtask.js
const REMOTE_URL = 'https://raw.githubusercontent.com/pagopa/idpay-scripts/refs/heads/main/jira/view-subtask.js';
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
    "}catch(e){console.error('[Jira STE]',e);alert('[Jira STE] '+e.message);}})();void 0;";
  return 'javascript:' + encodeURIComponent(wrapped);
}
const code = minify(fs.readFileSync(SRC, 'utf8'));
fs.writeFileSync(OUT_INLINE, toBookmarklet(code) + '\n');
console.log('OK ' + path.basename(OUT_INLINE));
const loader =
  "var s=document.createElement('script');" +
  "s.src=" + JSON.stringify(REMOTE_URL) + "+'?t='+Date.now();" +
  "s.onerror=function(){alert('[Jira STE] Impossibile caricare '+s.src);};" +
  "document.head.appendChild(s);";
fs.writeFileSync(OUT_LOADER, toBookmarklet(loader) + '\n');
console.log('OK ' + path.basename(OUT_LOADER));
