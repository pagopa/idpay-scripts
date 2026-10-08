// ─── CONFIGURAZIONE ───────────────────────────────────────────────────────────
const MODE = "preview"; // "preview" oppure "execute"
// ─────────────────────────────────────────────────────────────────────────────

const targetDb = db.getSiblingDB("idpay-pagamenti");
const col = targetDb.getCollection("point_of_sales");

const docs = col.find({
  address: { $exists: true, $ne: null },
  $or: [
    { streetNumber: { $exists: false } },
    { streetNumber: null },
    { streetNumber: "" }
  ]
}).toArray();

print(`\nModalità: ${MODE.toUpperCase()}`);
print(`Documenti trovati: ${docs.length}`);
print("─".repeat(80));

let updated = 0;
let skipped = 0;

docs.forEach(doc => {

  const fullAddress = doc.address;
  const lastComma = fullAddress.lastIndexOf(",");

  const streetName   = lastComma === -1 ? fullAddress : fullAddress.substring(0, lastComma).trim();
  const streetNumber = lastComma === -1 ? "SNC" : fullAddress.substring(lastComma + 1).trim();

  if (MODE === "preview") {
    print(`ID:             ${doc._id}`);
    print(`address:        ${fullAddress}`);
    print(`→ streetName:   ${streetName}`);
    print(`→ streetNumber: ${streetNumber}`);
    print("─".repeat(80));
  }

  if (MODE === "execute") {
    // I log before update to handle constraint errors
    print(`UPDATING [${doc._id}] "${fullAddress}" → "${streetName}" | "${streetNumber}"`);

    const ordered = {};
    Object.keys(doc).forEach(key => {
      if (key === "streetNumber") {
        return;
      }
      ordered[key] = key === "address" ? streetName : doc[key];
      if (key === "address") {
        ordered.streetNumber = streetNumber;
      }
    });

    col.replaceOne({ _id: doc._id }, ordered);
    updated++;
  }
});

print(`\n✅ Aggiornati: ${updated}`);
print(`⏭️  Skippati:  ${skipped}`);