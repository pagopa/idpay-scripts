import pymongo
from bson.objectid import ObjectId
from datetime import datetime
import time

# --- CONFIGURAZIONE ---
MONGO_URI = ""
DB_PAGAMENTI = "idpay-pagamenti"
DB_BENEFICIARI = "idpay-beneficiari"

# Connessione al client
client = pymongo.MongoClient(MONGO_URI)
db_pay = client[DB_PAGAMENTI]
db_ben = client[DB_BENEFICIARI]


def get_specific_reward_cents(transaction_doc,
    initiative_id="68dd003ccce8c534d1da22bc"):
  """
  Recupera providedRewardCents per una specifica iniziativa, senza iterazioni.
  """
  # 1. Accesso diretto tramite catena di .get() per evitare KeyError se manca l'iniziativa
  # Path: transaction -> rewards -> [INITIATIVE_ID] -> providedRewardCents
  reward_data = transaction_doc.get('rewards', {}).get(initiative_id)

  if not reward_data:
    return 0  # O gestisci l'errore se per te è bloccante

  # 2. Recupero del valore grezzo (potrebbe essere negativo)
  raw_val = reward_data.get('accruedRewardCents', 0)

  # 3. Gestione del formato Mongo ($numberLong o int diretto)
  if isinstance(raw_val, dict) and '$numberLong' in raw_val:
    val = int(raw_val['$numberLong'])
  else:
    val = int(raw_val)

  # 4. LOGICA BUSINESS: Restituisce sempre il valore assoluto (POSITIVO)
  return abs(val)


def generate_new_transaction_id(old_id):
  """
  Genera un nuovo ID per transaction_in_progress basato sull'old_id.
  Mantiene la parte fissa e aggiorna il timestamp.
  """
  # 1. Separiamo l'ID: teniamo tutto ciò che c'è prima dell'ultimo underscore
  base_part = old_id.rsplit('_', 1)[0]

  # 2. Generiamo il nuovo timestamp in millisecondi (13 cifre)
  new_timestamp = int(time.time() * 1000)

  # 3. Costruiamo il nuovo ID
  new_id = f"{base_part}_{new_timestamp}"

  return new_id


def get_cf_from_userid(user_id):
  """
  Recupera il Codice Fiscale (CF) dato un userId interrogando la collection data_vault.
  """
  try:
    # Se userId è stringa, prova a cercare anche se l'_id è stringa nel tokenizer,
    # altrimenti se necessario convertire in ObjectId o altro formato specifico del PDV.
    # Solitamente su idpay l'_id è una stringa token.
    pdv_doc = db_ben.data_vault.find_one({"_id": user_id})

    if pdv_doc and "data" in pdv_doc:
      return pdv_doc["data"]  # Il campo 'data' contiene il CF in chiaro (pii)

    return "CF_NON_TROVATO"
  except Exception as e:
    print(f"Errore recupero CF: {e}")
    return "ERRORE_RECUPERO_CF"


def recover_transaction(cancelled_trx_id, user_id):
  print(
      f"--- Inizio recovery per Trx: {cancelled_trx_id} | User: {user_id} ---")

  # 1. Recupero la transazione ANNULLATA (Source of Truth)
  # La prendiamo dalla history 'transaction' [cite: 1, 3]
  if user_id:
    original_trx = db_pay.transaction.find_one(
        {"_id": cancelled_trx_id, "userId": user_id})
  else:
    print("User ID non fornito, recupero basato solo su trx ID.")
    original_trx = db_pay.transaction.find_one({"_id": cancelled_trx_id})
  if not original_trx:
    print("ERRORE: Transazione originale non trovata in 'transaction'!")
    return

  user_id = original_trx.get("userId")

  print(f"Trovata trx originale. Status attuale: {original_trx.get('status')}")

  # --- controllo stato transazione ---
  if original_trx.get('status') not in ["CANCELLED", "REFUNDED"]:
    print(
        f"ERRORE: La transazione è in stato {original_trx.get('status')}. Impossibile procedere con il recovery.")
    return
  # --------------------------------------

  # 2. CONTROLLI DI SICUREZZA (User e Famiglia)
  # Recupero il wallet per ottenere il familyId [cite: 8]
  user_wallet = db_ben.wallet.find_one({"userId": user_id})
  if not user_wallet:
    print("ERRORE: Wallet utente non trovato.")
    return

  print(f"Trovato wallet utente. Status wallet: {user_wallet.get('status')}")

  family_id = user_wallet.get("familyId")
  initiative_id = user_wallet.get("initiativeId")

  # Identifico i membri da controllare
  family_members = [user_id]
  if family_id:
    family_wallets = db_ben.wallet.find({"familyId": family_id}, {"userId": 1})
    family_members = [w['userId'] for w in family_wallets]

  print(f"Controllo transazioni conflittuali per i membri: {family_members}")

  # Verifico transazioni attive
  critical_statuses = ["AUTHORIZED", "REWARDED", "CAPTURED", "INVOICED"]

  conflicting_trx = db_pay.transaction.find_one({
    "userId": {"$in": family_members},
    "_id": {"$ne": cancelled_trx_id},
    "status": {"$in": critical_statuses}
  })

  if conflicting_trx:
    print(
        f"ERRORE: Trovata transazione conflittuale (ID: {conflicting_trx['_id']} - Stato: {conflicting_trx.get('status')}). Stop.")
    return

  # Check status onboarding
  onboarding_doc = db_ben.onboarding_citizen.find_one(
      {"userId": user_id, "initiativeId": initiative_id})
  if not onboarding_doc:
    print("ERRORE: Documento onboarding_citizen non trovato.")
    return

  print(
    f"Trovato documento onboarding. Status attuale: {onboarding_doc.get('status')}")

  # 3. Recupero Importi
  # Cerchiamo accruedRewardCents o providedRewardCents [cite: 3]
  reward_cents = get_specific_reward_cents(original_trx)
  if not reward_cents:
    print("ERRORE: Impossibile determinare l'importo reward da recuperare.")
    return

  print(
    f"Importo da recuperare: {reward_cents} cents. TrxCode: {original_trx.get('trxCode')}")

  print(f"Recupero Codice Fiscale per log... {get_cf_from_userid(user_id)}")

  # 5. PREPARAZIONE DOCUMENTO PER transaction_in_progress
  # Partiamo dall'originale per mantenere i dati merchant/pos/mcc coerenti
  trx_in_progress = original_trx.copy()

  # A. Generazione nuovi ID
  old_id = trx_in_progress['_id']
  new_id = generate_new_transaction_id(old_id)
  # Assegnazione al documento (se serve aggiornare l'oggetto in memoria)
  trx_in_progress['_id'] = new_id
  # Debug print per verifica
  print(f"Old: {old_id} -> New: {new_id}")

  trx_in_progress["correlationId"] = new_id
  trx_in_progress["status"] = "CAPTURED"  # Stato forzato

  # B. Mapping specifici per transaction_in_progress [cite: 6, 7]
  trx_in_progress[
    "rewardCents"] = reward_cents  # Campo specifico di in_progress
  trx_in_progress[
    "initiativeId"] = initiative_id  # Obbligatorio in in_progress

  # set updateDate to now for consistency with reward batches (cannot insert a trx in an already sent batch)
  trx_in_progress["updateDate"] = datetime.now()

  # Campi di compensazione reward
  trx_in_progress["rewards"][initiative_id]["accruedRewardCents"] = reward_cents
  trx_in_progress["rewards"][initiative_id][
    "providedRewardCents"] = reward_cents

  # C. Pulizia/Default campi opzionali
  # extendedAuthorization e voucherAmountCents
  if "extendedAuthorization" not in trx_in_progress:
    print("WARNING: extendedAuthorization mancante")
  if "voucherAmountCents" not in trx_in_progress:
    if reward_cents > 10000:
      trx_in_progress["voucherAmountCents"] = 20000
    else:
      print("WARNING: voucherAmountCents mancante")

  # D. Rimozione creditNoteData per transazioni REFUNDED
  if original_trx.get(
      'status') == 'REFUNDED' and "creditNoteData" in trx_in_progress:
    del trx_in_progress["creditNoteData"]
    print("Rimosso campo 'creditNoteData' per transazione REFUNDED")

  print(trx_in_progress)

  # 4. STOP DEL RANKER
  input(
      "!!! Attenzione: assicurati che i dati siano corretti e di avere il budget a disposizione prima di continuare. Premi INVIO per procedere...")

  # --- INIZIO SCRITTURA SUL DB ---
  try:
    # --- INSERIMENTO ---
    # Scriviamo SOLO su transaction_in_progress. Il CDC farà il resto.
    db_ben.transaction_in_progress.insert_one(trx_in_progress)
    print(
        f"Inserito documento in 'transaction_in_progress' (ID: {new_id}) -> CDC attenderà propagazione.")
  except pymongo.errors.DuplicateKeyError:
    print(f"Documento {trx_in_progress['_id']} già presente.")
  except Exception as e:
    print(f"Errore sull'inserimento di {trx_in_progress['_id']}: {e}")

  # --- AGGIORNAMENTI CONTATORI E STATI ---

  # initiative_counters [cite: 13, 14]
  if onboarding_doc["status"] != "ONBOARDING_OK":
    db_ben.initiative_counters.update_one(
        {"_id": ObjectId("68dd003ccce8c534d1da22bc")},
        {"$inc": {
          "spentInitiativeBudgetCents": reward_cents,
          "residualInitiativeBudgetCents": -reward_cents
        }}
    )
    print("Aggiornati contatori iniziativa")

    # onboarding_citizen [cite: 14]
    db_ben.onboarding_citizen.update_one(
        {"userId": user_id, "initiativeId": initiative_id},
        {"$set": {"status": "ONBOARDING_OK"}}
    )
    print("Status utente ripristinato a ONBOARDING_OK")

    # wallet [cite: 8]
    db_ben.wallet.update_one(
        {"userId": user_id, "initiativeId": initiative_id},
        {"$set": {"status": "REFUNDABLE"}}
    )
    print("Status wallet impostato a REFUNDABLE")

  else:
    print(
      "Stato onboarding già ONBOARDING_OK, non aggiorno i contatori, wallet e onboarding.")

  print(
      "--- Procedura completata. Verifica tra qualche secondo che il CDC abbia creato la riga in 'transaction'. ---")


def orchestrate_recovery_by_cf(fiscal_code):
  """
  Recupera UserID da CF, cerca transazioni, verifica unicità CANCELLED ed esegue recovery.
  """
  print(f"Ricerca UserID per il CF fornito: {fiscal_code}")

  # 1. Recupero UserID da DataVault
  pdv_doc = db_ben.data_vault.find_one({"data": fiscal_code})

  if not pdv_doc:
    print("ERRORE: Nessun utente trovato nel data_vault per il CF indicato.")
    return

  user_id = pdv_doc['_id']
  print(f"Trovato UserID: {user_id}")

  # 2. Ricerca transazioni su collection transaction
  transactions_cursor = db_pay.transaction.find({"userId": user_id})
  user_transactions = list(transactions_cursor)

  if not user_transactions:
    print("AVVISO: Nessuna transazione trovata per questo utente.")
    return

  # 3. Filtro per stato CANCELLED o REFUNDED
  recoverable_trx_list = [t for t in user_transactions if
                          t.get('status') in ['CANCELLED', 'REFUNDED']]
  recoverable_count = len(recoverable_trx_list)

  print(
      f"Trovate {recoverable_count} transazioni in stato CANCELLED o REFUNDED.")

  # 4. Validazione e Esecuzione
  if recoverable_count == 1:
    trx_to_recover = recoverable_trx_list[0]
    trx_id = trx_to_recover['_id']
    print(
      f"Transazione univoca identificata: {trx_id} - {trx_to_recover['trxCode']}")

    # Chiamata al metodo di recovery
    recover_transaction(trx_id, user_id)

  elif recoverable_count == 0:
    print("ERRORE: Nessuna transazione CANCELLED o REFUNDED da ripristinare.")
  else:
    print(
        f"ERRORE: Trovate multiple ({recoverable_count}) transazioni CANCELLED/REFUNDED. Impossibile procedere automaticamente.")
    for t in recoverable_trx_list:
      print(f" - ID: {t['_id']} | Date: {t.get('trxDate')}")


# ESECUZIONE SCRIPT
if __name__ == "__main__":
  # --- OPZIONI INPUT ---
  # Opzione 1: Inserire il CF (Prioritario)
  target_cf = ""  # Esempio: "ABCDEF12G34H567I"

  # Opzione 2: Inserire ID e User manualmente (Fallback se cf è vuoto)
  target_trx_id_cancelled = ""  # Esempio: "07cfff33-..."
  target_user_id = ""  # Esempio: "f305uj..."

  # --- LOGICA DI SELEZIONE ---
  if target_cf:
    print("MODALITA': Recupero automatico tramite Codice Fiscale")
    orchestrate_recovery_by_cf(target_cf)
  elif target_trx_id_cancelled:
    print("MODALITA': Recupero specifico tramite ID Transazione e User ID")
    recover_transaction(target_trx_id_cancelled, target_user_id)
  else:
    print(
        "ERRORE: Configurare 'target_cf' oppure la coppia 'target_trx_id'/'target_user_id' nel blocco __main__.")
