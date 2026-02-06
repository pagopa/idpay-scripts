//// Script to run bulkWrite operations in batches of 1000, with error handling and result reporting.

db = db.getSiblingDB('idpay-beneficiari');

// Funzione per dividere le operazioni in blocchi da 1000
async function runBulk() {
  const allOps = [
// { updateOne: { filter: { userId: "ID_1", status: { $ne: "CAPTURED" } }, update: { $set: { status: "CAPTURED" } } } },
  ];

  const batchSize = 1000;
  for (let i = 0; i < allOps.length; i += batchSize) {
    const batch = allOps.slice(i, i + batchSize);
    print(`Eseguendo batch da ${i} a ${i + batch.length}...`);

    try {
      const result = db.initiative_counters.bulkWrite(batch, { ordered: false });

      print("--- RISULTATO ---");
      print("Documenti trovati (matched): " + result.matchedCount);
      print("Documenti modificati (modified): " + result.modifiedCount);

      if (result.matchedCount === 0) {
        print("ATTENZIONE: Nessun documento trovato. Controlla il nome della collezione o il formato dei filtri.");
      }
    } catch (e) {
      print("Errore nel batch, ma procedo col prossimo: " + e.message);
    }
  }
  print("Operazione conclusa.");
}

runBulk();