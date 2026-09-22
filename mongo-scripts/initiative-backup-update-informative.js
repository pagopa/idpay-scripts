// Imposta il database target per l'esecuzione su MongoDB/CosmosDB
use("idpay-iniziative");



/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. SEZIONE BACKUP
 * ─────────────────────────────────────────────────────────────────────────────
 * Questa sezione crea una collection di backup.
 */

db.initiative.aggregate([
  { $out: "initiative_backup_" + new Date().toISOString().slice(0,10).replace(/-/g,"") }
]);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. SEZIONE UPDATE (ADE)
 * ─────────────────────────────────────────────────────────────────────────────
 * Questa sezione aggiunge al campo selfDeclarationCriteria il _type INFORMATIVE per ADE, per l'iniziativa inserita.
 */

db.initiative.updateOne(
  {
    "_id": ObjectId("69e0fa95e21efa516c7b8dec"),
    "beneficiaryRule.selfDeclarationCriteria": {
      $not: {
        $elemMatch: {
          $or: [
            { "_type": "INFORMATIVE" },
            { "_type": "informative" },
            { "_class": "it.gov.pagopa.initiative.model.SelfCriteriaInformative" }
          ]
        }
      }
    }
  },
  {
    $push: {
      "beneficiaryRule.selfDeclarationCriteria": {
        "_type": "INFORMATIVE",
        "code": "ADE",
        "description": "Canone TV",
        "organization": "Agenzia delle Entrate",
        "value": "Descrizione estesa del requisito informativo",
        "_class": "it.gov.pagopa.initiative.model.SelfCriteriaInformative"
      }
    }
  }
);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. SEZIONE UPDATE (ANPR)
 * ─────────────────────────────────────────────────────────────────────────────
 * Questa sezione aggiunge al campo selfDeclarationCriteria il _type INFORMATIVE per ANPR, per l'iniziativa inserita.
 */

db.initiative.updateOne(
  {
    "_id": ObjectId("69e0fa95e21efa516c7b8dec"),
    "beneficiaryRule.selfDeclarationCriteria": {
      $not: {
        $elemMatch: {
          $or: [
            { "_type": "INFORMATIVE" },
            { "_type": "informative" },
            { "_class": "it.gov.pagopa.initiative.model.SelfCriteriaInformative" }
          ]
        }
      }
    }
  },
  {
    $push: {
      "beneficiaryRule.selfDeclarationCriteria": {
        "_type": "INFORMATIVE",
        "code": "ANPR",
        "description": "Residenza in Italia",
        "organization": "Ministero dell'Interno",
        "value": "Descrizione estesa del requisito residenza",
        "_class": "it.gov.pagopa.initiative.model.SelfCriteriaInformative"
      }
    }
  }
);