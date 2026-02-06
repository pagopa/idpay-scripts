# Script per eseguire disiscrizione e re-onboarding di un utente dato il suo codice fiscale.
# è possibile anche effettuare solo il re-onboarding se l'utente è già disiscritto, in questo caso lo script verificherà che lo stato sia effettivamente UNSUBSCRIBED prima di procedere con il re-onboarding.
import time
from datetime import datetime

import pymongo
import requests

# --- CONFIGURAZIONE ---
MONGO_URI = ""
DB_PAGAMENTI = "idpay-pagamenti"
DB_BENEFICIARI = "idpay-beneficiari"

# URL del servizio ranker
RANKER_PREALLOCATE_URL = "https://idpay.itn.internal.cstar.pagopa.it/idpayranker/idpay-itn/ranker/preallocate"

# Initiative ID
INITIATIVE_ID = "68dd003ccce8c534d1da22bc"
SERVICE_ID = ""

# Connessione al client
client = pymongo.MongoClient(MONGO_URI)
db_pay = client[DB_PAGAMENTI]
db_ben = client[DB_BENEFICIARI]


def wait_for_condition(check_function, max_attempts=20, wait_seconds=3):
  """
  Esegue check_function ogni wait_seconds secondi fino a quando non ritorna True
  o fino a raggiungere max_attempts tentativi.

  Returns:
      True se la condizione è stata soddisfatta, False altrimenti
  """
  for attempt in range(1, max_attempts + 1):
    if check_function():
      return True
    if attempt < max_attempts:
      time.sleep(wait_seconds)
  return False


def unsubscribe_and_reonboard_user(fiscal_code):
  """
  Esegue la disiscrizione e il re-onboarding di un utente dato il CF.
  """
  # --- STEP 1: Recupero UserID da DataVault ---
  pdv_doc = db_ben.data_vault.find_one({"data": fiscal_code})

  if not pdv_doc:
    raise ValueError("Nessun utente trovato nel data_vault per il CF indicato.")

  user_id = pdv_doc['_id']

  # # --- STEP 2: Verifica stato onboarding_citizen ---
  onboarding_doc = db_ben.onboarding_citizen.find_one({
    "userId": user_id,
    "initiativeId": INITIATIVE_ID
  })

  if not onboarding_doc:
    raise ValueError("Documento onboarding_citizen non trovato.")

  onboarding_status = onboarding_doc.get('status')

  # Accetta sia ONBOARDING_OK (da disiscrivere) che UNSUBSCRIBED (già disiscritto)
  if onboarding_status not in ["ONBOARDING_OK", "UNSUBSCRIBED"]:
    raise ValueError(
      f"L'utente deve essere in stato ONBOARDING_OK o UNSUBSCRIBED. Stato attuale: {onboarding_status}")

  # Flag per sapere se dobbiamo disiscrivere o è già disiscritto
  already_unsubscribed = (onboarding_status == "UNSUBSCRIBED")

  # --- STEP 3: Verifica wallet (solo se non già disiscritto) ---
  if not already_unsubscribed:
    wallet_doc = db_ben.wallet.find_one({
      "userId": user_id,
      "initiativeId": INITIATIVE_ID
    })

    if not wallet_doc:
      raise ValueError("Wallet non trovato per l'utente.")

    wallet_status = wallet_doc.get('status')
    import_amount = wallet_doc.get('amountCents', 0)

    if import_amount != 10000:
      raise ValueError(
        f"L'utente non ha esattamente 100 euro (10000 cents). Valore attuale: {import_amount}")

    # --- STEP 4: Verifica initiative_counters (preallocatedAmountCents != 10000) ---
    initiative_counter_doc = db_ben.initiative_counters.find_one({"userId": user_id})

    if not initiative_counter_doc:
      raise ValueError("Documento initiative_counters non trovato per l'utente.")

    preallocated_amount = initiative_counter_doc.get('preallocatedAmountCents', 0)

    if preallocated_amount == 10000:
      raise ValueError(
        f"Il preallocatedAmountCents è esattamente 10000. Valore attuale: {preallocated_amount}")

    # --- STEP 5: Verifica transazioni in transaction_in_progress ---
    trx_in_progress_list = list(
      db_ben.transaction_in_progress.find({"userId": user_id}))

    allowed_statuses = ["CREATED", "CANCELLED"]
    invalid_trx = [t for t in trx_in_progress_list if
                   t.get('status') not in allowed_statuses]

    if invalid_trx:
      error_msg = "Trovate transazioni in stati non consentiti:\n"
      for t in invalid_trx:
        error_msg += f"  - ID: {t['_id']} | Status: {t.get('status')}\n"
      raise ValueError(error_msg)
  else:
    # Utente già disiscritto - verifica che sia effettivamente UNSUBSCRIBED ovunque
    wallet_doc = db_ben.wallet.find_one({
      "userId": user_id,
      "initiativeId": INITIATIVE_ID
    })

    if wallet_doc and wallet_doc.get('status') != 'UNSUBSCRIBED':
      raise ValueError(
        f"Wallet non è UNSUBSCRIBED. Stato attuale: {wallet_doc.get('status')}")

    wallet_status = wallet_doc.get('status') if wallet_doc else 'NON TROVATO'
    import_amount = wallet_doc.get('amountCents', 0) if wallet_doc else 0
    preallocated_amount = 0
    trx_in_progress_list = []

  print("✓ Prerequisiti verificati")

  # --- STEP 6: Breakpoint di conferma ---
  print("\n" + "=" * 60)
  print("RIEPILOGO:")
  print(f"  UserID: {user_id} | CF: {fiscal_code}")
  print(f"  Onboarding: {onboarding_status} | Wallet: {wallet_status}")
  if not already_unsubscribed:
    print(f"  Wallet: {import_amount} cents | Preallocated: {preallocated_amount} cents")
    print(f"  Transazioni: {len(trx_in_progress_list)}")
    print(f"  Azione: DISISCRIZIONE + RE-ONBOARDING")
  else:
    print(f"  Azione: SOLO RE-ONBOARDING (utente già disiscritto)")
  print("=" * 60)
  input("Premi INVIO per procedere...")

  # --- STEP 7: DISISCRIZIONE (solo se necessaria) ---
  if not already_unsubscribed:
    # Trova la transazione con extendedAuthorization = true
    extended_auth_trx = None
    other_trx = []

    for trx in trx_in_progress_list:
      if trx.get('extendedAuthorization'):
        extended_auth_trx = trx
      else:
        other_trx.append(trx)

    if not extended_auth_trx:
      raise ValueError("Nessuna transazione con extendedAuthorization=true trovata.")

    # # Imposta stato EXPIRED sulla transazione con extendedAuthorization
    result = db_ben.transaction_in_progress.update_one(
        {"_id": extended_auth_trx['_id']},
        {"$set": {"status": "EXPIRED", "updateDate": datetime.now()}}
    )

    # Cancella le altre transazioni
    if other_trx:
      other_trx_ids = [t['_id'] for t in other_trx]
      delete_result = db_ben.transaction_in_progress.delete_many(
          {"_id": {"$in": other_trx_ids}}
      )
      print(f"✓ Disiscrizione: EXPIRED={result.modified_count}, Cancellate={delete_result.deleted_count}")
    else:
      print(f"✓ Disiscrizione: EXPIRED={result.modified_count}")
  else:
    print("✓ Skip disiscrizione (utente già UNSUBSCRIBED)")

  # --- Asserzioni post-disiscrizione (eseguite sempre) ---
  # Asserzione 1: onboarding_citizen in stato UNSUBSCRIBED

  def check_onboarding_unsubscribed():
    doc = db_ben.onboarding_citizen.find_one({
      "userId": user_id,
      "initiativeId": INITIATIVE_ID
    })
    return doc and doc.get('status') == 'UNSUBSCRIBED'

  if not wait_for_condition(check_onboarding_unsubscribed):
    raise RuntimeError("Timeout - onboarding_citizen non è passato a UNSUBSCRIBED")

  # Asserzione 2: wallet in stato UNSUBSCRIBED

  def check_wallet_unsubscribed():
    doc = db_ben.wallet.find_one({
      "userId": user_id,
      "initiativeId": INITIATIVE_ID
    })
    return doc and doc.get('status') == 'UNSUBSCRIBED'

  if not wait_for_condition(check_wallet_unsubscribed):
    raise RuntimeError("Timeout - wallet non è passato a UNSUBSCRIBED")

  # Asserzione 3: initiative_counters senza documento relativo all'utente

  def check_no_initiative_counter():
    doc = db_ben.initiative_counters.find_one({"userId": user_id})
    return not doc

  if not wait_for_condition(check_no_initiative_counter):
    raise RuntimeError(
      "Timeout - initiative_counters contiene ancora un documento per l'utente")

  print("✓ Asserzioni verificate")

  # Aggiorna il riferimento al documento onboarding
  onboarding_doc = db_ben.onboarding_citizen.find_one({
    "userId": user_id,
    "initiativeId": INITIATIVE_ID
  })

  # --- STEP 8: RE-ONBOARDING ---

  # Imposta stato ON_EVALUATION
  result = db_ben.onboarding_citizen.update_one(
      {"userId": user_id, "initiativeId": INITIATIVE_ID},
      {"$set": {"status": "ON_EVALUATION", "updateDate": datetime.now()}}
  )

  # Rileggi il documento aggiornato
  onboarding_doc = db_ben.onboarding_citizen.find_one({
    "userId": user_id,
    "initiativeId": INITIATIVE_ID
  })

  # --- STEP 9: Chiamata API /preallocate ---
  # Prepara payload con documento onboarding + campi aggiuntivi
  payload = dict(onboarding_doc)

  # Converti tutte le date in formato ISO string
  for key, value in payload.items():
    if isinstance(value, datetime):
      payload[key] = value.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

  # Aggiungi campi richiesti
  payload['verifyIsee'] = True
  payload['serviceId'] = SERVICE_ID

  try:
    response = requests.post(
        RANKER_PREALLOCATE_URL,
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=30
    )

    if response.status_code in [200, 201, 202]:
      print(f"✓ Preallocate completato (status: {response.status_code})")
    else:
      print(f"⚠ Response code: {response.status_code}")
      print(f"Response: {response.text[:200]}")

  except requests.exceptions.RequestException as e:
    raise RuntimeError(f"Errore nella chiamata HTTP: {e}")



# ESECUZIONE SCRIPT
if __name__ == "__main__":
  # --- INPUT: Lista di Codici Fiscali ---
  # Puoi specificare un singolo CF o una lista di CF
  target_cf_list = [
    "MRNDDL37S12D653I"
  ]

  if not target_cf_list:
    print("ERRORE: Configurare 'target_cf_list' nel blocco __main__.")
  else:
    total_cf = len(target_cf_list)
    print(f"\n{'=' * 80}")
    print(f"ELABORAZIONE DI {total_cf} CODICE/I FISCALE/I")
    print(f"{'=' * 80}\n")

    success_count = 0
    failed_count = 0
    failed_cf_list = []

    for index, cf in enumerate(target_cf_list, start=1):
      print(f"\n[{index}/{total_cf}] CF: {cf}")

      try:
        unsubscribe_and_reonboard_user(cf)
        success_count += 1
        print(f"✓ CF {cf} completato\n")
      except Exception as e:
        failed_count += 1
        failed_cf_list.append(cf)
        print(f"✗ ERRORE: {e}\n")

      # Separatore tra un CF e l'altro
      if index < total_cf:
        time.sleep(2)

    # Riepilogo finale
    print(f"\n\n{'=' * 80}")
    print("RIEPILOGO FINALE")
    print(f"{'=' * 80}")
    print(f"Totale CF processati: {total_cf}")
    print(f"Successi: {success_count}")
    print(f"Errori: {failed_count}")

    if failed_cf_list:
      print("\nCF con errori:")
      for cf in failed_cf_list:
        print(f"  - {cf}")

    print(f"{'=' * 80}\n")
