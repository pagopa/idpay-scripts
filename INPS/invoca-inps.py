import csv
import time
import logging
import threading
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

# =========================================================================================
# CONFIG (compila qui)
# =========================================================================================
URL = "ADMISSIBILITY_INGRESS"+"/idpay/admissibility/inps/connection/test/threshold/BELET25"
# =========================================================================================

INPUT_CSV = "input.csv"
OUTPUT_CSV = "output.csv"
LOG_FILE = "inps.log"

DELIMITER = ","
MAX_WORKERS = 5          # per debug parti da 1, poi 5, poi 10
TIMEOUT = 15
RETRIES = 3

X_DATE_FIXED = "2025-12-31"
# ==========================================

# ================= LOGGING =================
logger = logging.getLogger("INPS")
logger.setLevel(logging.DEBUG)
fmt = logging.Formatter("%(asctime)s | %(levelname)-7s | %(threadName)s | %(message)s")

ch = logging.StreamHandler()
ch.setLevel(logging.INFO)
ch.setFormatter(fmt)

fh = logging.FileHandler(LOG_FILE)
fh.setLevel(logging.DEBUG)
fh.setFormatter(fmt)

logger.handlers.clear()
logger.addHandler(ch)
logger.addHandler(fh)
# ==========================================

# Thread-local session (una session per thread)
_tls = threading.local()

def get_session() -> requests.Session:
    if not hasattr(_tls, "session"):
        s = requests.Session()
        _tls.session = s
    return _tls.session

def clean(s: str) -> str:
    # rimuove BOM, CRLF, spazi
    return (s or "").replace("\ufeff", "").strip()

def call_inps(row: dict) -> dict:
    _id = clean(row.get("_id"))
    fiscal_code = clean(row.get("data"))

    out = {
        "_id": _id,
        "fiscalCode": fiscal_code,
        "http_status": "",
        "esito": "",
        "sottoSoglia": "",
        "protocolloDSU": "",
        "dataPresentazioneDSU": "",
        "presenzaDifformita": "",
        "error": ""
    }

    if not fiscal_code:
        out["error"] = "Missing fiscalCode"
        logger.error(f"[{_id}] CF mancante")
        return out

    headers = {
        "X-User-Code": fiscal_code,
        "X-Date": X_DATE_FIXED,
        "Accept": "application/json",
    }

    for attempt in range(1, RETRIES + 1):
        try:
            sess = get_session()
            t0 = time.time()
            logger.info(f"[{_id}] Attempt {attempt} CF={fiscal_code}")

            r = sess.get(URL, headers=headers, timeout=TIMEOUT)
            elapsed = round(time.time() - t0, 3)

            out["http_status"] = str(r.status_code)
            logger.info(f"[{_id}] HTTP {r.status_code} in {elapsed}s")

            # Se errore, logga body (spesso contiene motivazione gateway)
            if r.status_code >= 400:
                logger.error(f"[{_id}] BODY: {r.text[:2000]}")

            r.raise_for_status()

            payload = r.json()
            j = payload.get("consultazioneSogliaIndicatoreResult", {}) or {}
            dati = j.get("datiIndicatore", {}) or {}

            out["esito"] = j.get("esito", "") or ""
            out["sottoSoglia"] = dati.get("sottoSoglia", "") or ""
            out["protocolloDSU"] = dati.get("protocolloDSU", "") or ""
            out["dataPresentazioneDSU"] = dati.get("dataPresentazioneDSU", "") or ""
            out["presenzaDifformita"] = dati.get("presenzaDifformita", "") or ""
            out["error"] = ""

            return out

        except Exception as e:
            out["error"] = str(e)
            logger.warning(f"[{_id}] ERROR {attempt}/{RETRIES}: {e}")
            if attempt < RETRIES:
                time.sleep(0.5 * attempt)

    return out

def main():
    logger.info("==== START BATCH ====")

    with open(INPUT_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=DELIMITER)
        rows = list(reader)

    logger.info(f"Righe lette: {len(rows)}")

    results = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = [ex.submit(call_inps, row) for row in rows]
        for fut in as_completed(futures):
            results.append(fut.result())

    # Mantieni ordine input
    pos = { clean(r.get("_id")): i for i, r in enumerate(rows) }
    results.sort(key=lambda x: pos.get(x["_id"], 10**12))

    fieldnames = [
        "_id", "fiscalCode", "http_status",
        "esito", "sottoSoglia", "protocolloDSU",
        "dataPresentazioneDSU", "presenzaDifformita",
        "error"
    ]
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as out:
        w = csv.DictWriter(out, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(results)

    logger.info(f"Output scritto: {OUTPUT_CSV}")
    logger.info("==== END BATCH ====")

if __name__ == "__main__":
    main()
