// ─────────────────────────────────────────────────────────────────────────────
// Bonifica collection `product`:
//   - vecchio _id (gtinCode)   →  nuovo _id = `${gtinCode}_${initiativeId}`
//   - viene aggiunto il campo  gtinCode = vecchio _id
//
// Poiché in MongoDB _id è immutabile, per ogni documento va fatto
// insertOne(nuovo) + deleteOne(vecchio) in un bulkWrite non ordinato.
//
// Lo script è:
//   - idempotente: salta i documenti già migrati (_id contiene "_" ed esiste il
//     campo gtinCode)
//   - a blocchi: non carica tutto in RAM, usa un cursor + batch
//   - con modalità preview/execute
// ─────────────────────────────────────────────────────────────────────────────

// ─── CONFIGURAZIONE ──────────────────────────────────────────────────────────
const MODE       = "preview";           // "preview" | "execute"
const DB_NAME    = "rdb";               // adattare se il DB ha altro nome
const COLL_NAME  = "product";
const BATCH_SIZE = 200;                 // dimensione blocchi bulkWrite
const VERBOSE    = false;               // se true stampa ogni documento
// ─────────────────────────────────────────────────────────────────────────────

const targetDb = db.getSiblingDB(DB_NAME);
const col      = targetDb.getCollection(COLL_NAME);

// Filtro: prende solo documenti NON ancora migrati.
// Consideriamo "non migrato" un doc il cui _id NON contiene "_" oppure che
// non ha il campo gtinCode valorizzato.
const migrationFilter = {
  $or: [
    { gtinCode: { $exists: false } },
    { gtinCode: null },
    { _id: { $not: /_/ } }
  ]
};

const total = col.countDocuments(migrationFilter);
print(`\nModalità:               ${MODE.toUpperCase()}`);
print(`DB / Collection:        ${DB_NAME}.${COLL_NAME}`);
print(`Documenti da bonificare: ${total}`);
print(`Batch size:             ${BATCH_SIZE}`);
print("─".repeat(80));

let processed   = 0;
let migrated    = 0;
let skippedBad  = 0;   // documenti senza initiativeId / _id non stringa
let skippedDone = 0;   // già migrati (edge-case, non dovrebbero rientrare nel filtro)
let errors      = 0;

const cursor = col.find(migrationFilter).batchSize(BATCH_SIZE);
let ops     = [];
let inBatch = 0;

function flush() {
  if (ops.length === 0) return;
  try {
    const res = col.bulkWrite(ops, { ordered: false });
    migrated += (res.insertedCount || 0);
    if (VERBOSE) {
      print(`  ↳ batch ok: inserted=${res.insertedCount} deleted=${res.deletedCount}`);
    }
  } catch (e) {
    errors++;
    print(`  ⚠️  errore in un batch: ${e.message}`);
    // in caso di errore parziale, MongoDB restituisce comunque i counter
    if (e.result) {
      migrated += (e.result.nInserted || 0);
    }
  }
  ops     = [];
  inBatch = 0;
}

while (cursor.hasNext()) {
  const doc = cursor.next();
  processed++;

  const oldId        = doc._id;
  const initiativeId = doc.initiativeId;

  // ── validazioni ─────────────────────────────────────────────────────────
  if (typeof oldId !== "string" || !oldId) {
    skippedBad++;
    print(`  ⏭  _id non stringa, skip: ${JSON.stringify(oldId)}`);
    continue;
  }
  if (!initiativeId) {
    skippedBad++;
    print(`  ⏭  initiativeId mancante, skip _id=${oldId}`);
    continue;
  }
  // safety net: se per qualche motivo il doc è già migrato salta
  if (oldId.indexOf("_") !== -1 && doc.gtinCode) {
    skippedDone++;
    continue;
  }

  const newId    = `${oldId}_${initiativeId}`;
  const newDoc   = Object.assign({}, doc, { _id: newId, gtinCode: oldId });

  if (VERBOSE || MODE === "preview") {
    print(`  ${oldId}  →  ${newId}`);
  }

  if (MODE === "execute") {
    ops.push({ insertOne: { document: newDoc } });
    ops.push({ deleteOne: { filter: { _id: oldId } } });
    inBatch++;
    if (inBatch >= BATCH_SIZE) flush();
  }
}

if (MODE === "execute") flush();

print("─".repeat(80));
print(`Processati:   ${processed}`);
print(`Migrati:      ${migrated}   (modalità: ${MODE})`);
print(`Skip invalid: ${skippedBad}`);
print(`Skip già ok:  ${skippedDone}`);
print(`Batch falliti:${errors}`);
print("─".repeat(80));
if (MODE === "preview") {
  print("ℹ️  Nessuna modifica applicata. Rilancia con MODE=\"execute\" per eseguire.");
}
