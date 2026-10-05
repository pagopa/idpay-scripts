import psycopg2
from psycopg2 import extras
from datetime import datetime, timezone
import ijson  # Ottimo per leggere array JSON enormi riga per riga
from zoneinfo import ZoneInfo

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

ROME = ZoneInfo("Europe/Rome")


def parse_mongo_date(val):
  if isinstance(val, dict) and "$date" in val:
    val = val["$date"]

  if isinstance(val, dict) and "$numberLong" in val:
    val = int(val["$numberLong"])

  if isinstance(val, (int, float)):
    parsed = datetime.fromtimestamp(val / 1000, tz=timezone.utc)
  elif isinstance(val, str):
    parsed = datetime.fromisoformat(val.replace("Z", "+00:00"))
  else:
    raise TypeError(f"Unsupported Mongo date value: {type(val).__name__}")

  if parsed.tzinfo is None:
    parsed = parsed.replace(tzinfo=timezone.utc)

  return parsed.astimezone(ROME)


def normalize_extended_json(val):
  if isinstance(val, dict):
    if len(val) == 1 and "$numberLong" in val:
      return int(val["$numberLong"])
    if len(val) == 1 and "$numberInt" in val:
      return int(val["$numberInt"])
    if len(val) == 1 and "$numberDouble" in val:
      return float(val["$numberDouble"])
    if len(val) == 1 and "$date" in val:
      return parse_mongo_date(val).isoformat()
    return {key: normalize_extended_json(value) for key, value in val.items()}

  if isinstance(val, list):
    return [normalize_extended_json(value) for value in val]

  return val


def clean_val(val):
  return normalize_extended_json(val)


def clean_timestamp(val, preserve_timezone):
  if val is None:
    return None

  parsed = parse_mongo_date(val)
  return parsed if preserve_timezone else parsed.replace(tzinfo=None)


def extract_product_type(doc):
  product_type = doc.get("productType")
  if product_type is not None:
    return product_type

  additional_properties = doc.get("additionalProperties")
  if isinstance(additional_properties, dict):
    return additional_properties.get("productType")

  return None


def to_jsonb(val):
  """Normalize Mongo Extended JSON before adapting a value as PostgreSQL JSONB."""
  if val is None:
    return None
  return extras.Json(normalize_extended_json(val))

# 2. Leggi il dump esportato da MongoDB (es. esportato con mongoexport)
# mongoexport --db=nomedb --collection=transaction --out=dump.json
batch_size = 5000
buffer = []

insert_query = """
INSERT INTO "idpay-pagamenti".transaction (
    id, "trxCode", "operationType", "operationTypeTranscoded", status, 
    "trxDate", "trxChargeDate", "trxEndDate", "elaborationDateTime", "updateDate", "userId", 
    "merchantId", "acquirerId", "pointOfSaleId", "amountCents", "effectiveAmountCents", 
    "voucherAmountCents", "amountCurrency", channel, "initiativeId", "initiativeName", 
    initiatives, "businessName", "franchiseName", "invoiceData", "creditNoteData",
    "correlationId", "createdAt", "idTrxAcquirer", "merchantFiscalCode", vat,
    "pointOfSaleType", "productType", "familyId", "rewardCents", "counterVersion",
    "transactionRevision", "rewards", "rejectionReasons", "initiativeRejectionReasons",
    "additionalProperties", mcc, "idTrxIssuer", "extendedAuthorization"
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
      clean_timestamp(doc.get("trxDate"), preserve_timezone=True),
      clean_timestamp(doc.get("trxChargeDate"), preserve_timezone=True),
      clean_timestamp(doc.get("trxEndDate"), preserve_timezone=True),
      clean_timestamp(doc.get("elaborationDateTime"), preserve_timezone=False),
      clean_timestamp(doc.get("updateDate"), preserve_timezone=False),
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
      doc.get("franchiseName"),
      to_jsonb(doc.get("invoiceData")),
      to_jsonb(doc.get("creditNoteData")),
      doc.get("correlationId"),
      clean_timestamp(doc.get("createdAt"), preserve_timezone=False),
      doc.get("idTrxAcquirer"),
      doc.get("merchantFiscalCode"),
      doc.get("vat"),
      doc.get("pointOfSaleType"),
      extract_product_type(doc),
      doc.get("familyId"),
      clean_val(doc.get("rewardCents")),
      clean_val(doc.get("counterVersion")),
      0,
      to_jsonb(doc.get("rewards")),
      to_jsonb(doc.get("rejectionReasons")),
      to_jsonb(doc.get("initiativeRejectionReasons")),
      to_jsonb(doc.get("additionalProperties")),
      doc.get("mcc"),
      doc.get("idTrxIssuer"),
      doc.get("extendedAuthorization")
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