import json
import psycopg2
from psycopg2 import extras
from datetime import datetime
import ijson  # Ottimo per leggere array JSON enormi riga per riga

# 1. Configurazione connessione Postgres
conn = psycopg2.connect(
    dbname="idpay-database",
    user="username",  # Sostituisci con il tuo username reale
    password="placeholder-password",  # Sostituisci con la tua password reale
    host="host-placeholder",  # Sostituisci con il tuo host reale
    port="5432",
    sslmode="require"
)
cursor = conn.cursor()

extras.register_default_jsonb(conn_or_curs=conn)

# 2. Funzione per normalizzare i dati di MongoDB/Cosmos
def clean_val(val, val_type=None):
  if val is None:
    return None

  # Gestione dei tipi speciali di MongoDB
  if isinstance(val, dict):
    if "$date" in val:
      return val["$date"]  # Postgres accetta le stringhe ISO come TIMESTAMPTZ
    if "$numberLong" in val:
      return int(val["$numberLong"])
    # Se è un altro dizionario/array (es. additionalProperties, initiatives), lo passiamo come JSON
    return json.dumps(val)

  if isinstance(val, list):
    return json.dumps(val)  # Mappa gli array JSONB di Postgres

  return val


def to_jsonb(val):
  """Forza psycopg2 a mappare list o dict come JSONB per Postgres"""
  if val is None:
    return None
  # extras.Json serializza automaticamente sia dict che list in formato JSON compatibile
  return extras.Json(val)

# 3. Leggi il dump esportato da MongoDB (es. esportato con mongoexport)
# mongoexport --db=nomedb --collection=transaction --out=dump.json
batch_size = 5000
buffer = []

insert_query = """
INSERT INTO "idpay-pagamenti".transaction (
    id, "trxCode", "operationType", "operationTypeTranscoded", status, 
    "trxDate", "trxChargeDate", "trxEndDate", "updateDate", "userId", 
    "merchantId", "acquirerId", "pointOfSaleId", "amountCents", "effectiveAmountCents", 
    "voucherAmountCents", "amountCurrency", channel, "initiativeId", "initiativeName", 
    initiatives, "businessName", "correlationId", "idTrxAcquirer", "merchantFiscalCode", 
    vat, "additionalProperties", mcc, "idTrxIssuer", "extendedAuthorization", "counterVersion",
    "franchiseName", "pointOfSaleType", "familyId", "rewardCents", "rejectionReasons", 
    "initiativeRejectionReasons", rewards
) VALUES %s
ON CONFLICT (id) DO NOTHING;
"""
# Usiamo ijson.items per estrarre gli oggetti dall'array uno alla volta
with open("dumpvoucher.json", "rb") as f:
  # "item" indica a ijson di estrarre i singoli elementi dentro l'array principale
  for doc in ijson.items(f, "item"):

    row = (
      doc.get("_id"),
      doc.get("trxCode"),
      doc.get("operationType"),
      doc.get("operationTypeTranscoded"),
      doc.get("status"),
      clean_val(doc.get("trxDate")),
      clean_val(doc.get("trxChargeDate")),
      clean_val(doc.get("trxEndDate")),
      clean_val(doc.get("updateDate")),
      doc.get("userId"),
      doc.get("merchantId"),
      doc.get("acquirerId"),
      doc.get("pointOfSaleId"),
      clean_val(doc.get("amountCents")),
      # <-- Convertito da $numberLong a BIGINT
      clean_val(doc.get("effectiveAmountCents")),
      # <-- Convertito da $numberLong a BIGINT
      clean_val(doc.get("voucherAmountCents")),
      # <-- Convertito da $numberLong a BIGINT
      doc.get("amountCurrency"),
      doc.get("channel"),
      doc.get("initiativeId"),
      doc.get("initiativeName"),
      to_jsonb(doc.get("initiatives")),
      doc.get("businessName"),
      doc.get("correlationId"),
      doc.get("idTrxAcquirer"),
      doc.get("merchantFiscalCode"),
      doc.get("vat"),
      to_jsonb(doc.get("additionalProperties")),
      doc.get("mcc"),
      doc.get("idTrxIssuer"),
      doc.get("extendedAuthorization"),
      clean_val(doc.get("counterVersion")),
      doc.get("franchiseName"),
      doc.get("pointOfSaleType"),
      doc.get("familyId"),
      clean_val(doc.get("rewardCents")),
      to_jsonb(doc.get("rejectionReasons")),
      to_jsonb(doc.get("initiativeRejectionReasons")),
      to_jsonb(doc.get("rewards"))
    )
    buffer.append(row)

    if len(buffer) >= batch_size:
      extras.execute_values(cursor, insert_query, buffer)
      conn.commit()
      print(f"Inseriti {len(buffer)} record...")
      buffer = []


# Scrivi il rimanente
if buffer:
  extras.execute_values(cursor, insert_query, buffer)
  conn.commit()

cursor.close()
conn.close()
print("Migrazione completata con successo!")