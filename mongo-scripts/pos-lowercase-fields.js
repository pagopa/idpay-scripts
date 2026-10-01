// Imposta il database target per l'esecuzione su MongoDB/CosmosDB
use("idpay-pagamenti");

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. SEZIONE DRY RUN (VERIFICA PREVENTIVA)
 * ─────────────────────────────────────────────────────────────────────────────
 * Questa sezione serve a isolare e mostrare a schermo i record che contengono
 * caratteri maiuscoli e che verrebbero effettivamente modificati dall'update.
 * Per aggiungere un nuovo campo da bonificare, duplicare uno dei blocchi sotto
 * e sostituire il nome del campo.
 */

// dry run contactEmail
db.getCollection("point_of_sales").aggregate([
  // Filtra solo i documenti dove il campo esiste ed è popolato
  { $match: { contactEmail: { $exists: true, $ne: null } } },
  // Crea un campo temporaneo con il valore convertito tutto in minuscolo
  { $addFields: { contactEmailNew: { $toLower: "$contactEmail" } } },
  // Compara il vecchio valore con il nuovo isolando solo le stringhe NON uguali (ovvero quelle con maiuscole)
  { $match: { $expr: { $ne: ["$contactEmail", "$contactEmailNew"] } } },
  // Mostra in output solo i campi utili per la verifica visiva
  { $project: { _id: 1, contactEmail: 1, contactEmailNew: 1 } }
])

// dry run website
db.getCollection("point_of_sales").aggregate([
  { $match: { website: { $exists: true, $ne: null } } },
  { $addFields: { websiteNew: { $toLower: "$website" } } },
  { $match: { $expr: { $ne: ["$website", "$websiteNew"] } } },
  { $project: { _id: 1, website: 1, websiteNew: 1 } }
])


/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. SEZIONE UPDATE (BONIFICA EFFETTIVA)
 * ─────────────────────────────────────────────────────────────────────────────
 * Questa sezione esegue la conversione massiva dei campi in lowercase.
 */

// update contactEmail
db.getCollection("point_of_sales").updateMany(
  { contactEmail: { $exists: true, $ne: null } },
  // Sfrutta la pipeline di aggregazione per aggiornare il campo basandosi sul suo stesso valore attuale
  [{ $set: { contactEmail: { $toLower: "$contactEmail" } } }]
)

// update website
db.getCollection("point_of_sales").updateMany(
  { website: { $exists: true, $ne: null } },
  [{ $set: { website: { $toLower: "$website" } } }]
)