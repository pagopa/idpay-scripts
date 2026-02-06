#!/usr/bin/env python3
from jose import jwt
from jose.constants import Algorithms

import base64
import csv
import datetime
import hashlib
import json
import os
import random
import uuid
from pathlib import Path
from typing import Optional

import requests


# ======================================================
# CONFIG (compila qui)
# ======================================================
CLIENT_ID = "PAGOPA_PDND_CONFIGURATION_CLIENT_ID_C021"
KEY_ID = "PAGOPA_PDND_CONFIGURATION_KID_C021"
PURPOSE_ID = "PAGOPA_PDND_CONFIGURATION_PURPOSE_ID_C021"

USER_ID = "NAME SURNAME"
AUDIENCE = "ANPR_C021_AUDIENCE"
TARGET = "ANPR_BASE_URL"+"/C021-servizioAccertamentoStatoFamiglia/v1/anpr-service-e002"

ACCESS_TOKEN_AUDIENCE = "PDND_ACCESS_TOKEN_AUDIENCE"
PDND_BASE_URL = "PDND_BASE_URL"
# ======================================================
# File (necessari stessa cartella dello script)
# ======================================================

CSV_FILENAME = "input.csv"
PRIVATE_KEY_FILENAME = "eservice-client-keypair.rsa.priv"
# ======================================================


USER_LOCATION = "pc-123456"
LOA = "SPID"  # LoA2 / SPID


# Parametri richiesta C021
ID_OPERAZIONE_CLIENT = "164"
DATA_RIFERIMENTO = "2025-12-31"
MOTIVO = "1"
CASO_USO = "C021"

# Esecuzione
EXECUTE_CALLS = True     # True = chiama davvero l'endpoint; False = stampa solo cURL
TIMEOUT_SECONDS = 60


# Output (nella stessa cartella dello script)
OUT_JSONL_FILENAME = "output.jsonl"
OUT_CSV_FILENAME = "output.csv"   # "" per disabilitare CSV


def unix_ts(dt: datetime.datetime) -> int:
    return int(dt.replace(tzinfo=datetime.timezone.utc).timestamp())


def get_private_key(key_path: Path) -> bytes:
    return key_path.read_bytes()


def safe_json(text: str) -> Optional[dict]:
    try:
        return json.loads(text)
    except Exception:
        return None


def read_rows_from_csv(csv_path: Path) -> list[dict]:
    rows = []
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def build_request(cf: str) -> str:
    return json.dumps(
        {
            "idOperazioneClient": ID_OPERAZIONE_CLIENT,
            "criteriRicerca": {"codiceFiscale": cf},
            "datiRichiesta": {
                "dataRiferimentoRichiesta": DATA_RIFERIMENTO,
                "motivoRichiesta": MOTIVO,
                "casoUso": CASO_USO,
            },
        },
        separators=(",", ":"),  # digest stabile
        ensure_ascii=False,
    )


def b64sha256_digest_header(body: str) -> str:
    raw = hashlib.sha256(body.encode("utf-8")).digest()
    return "SHA-256=" + base64.b64encode(raw).decode("utf-8")


def main():
    # ==== path relativi allo script (perfetti per PyCharm) ====
    script_dir = Path(__file__).resolve().parent
    csv_path = script_dir / CSV_FILENAME
    key_path = script_dir / PRIVATE_KEY_FILENAME
    out_jsonl_path = script_dir / OUT_JSONL_FILENAME
    out_csv_path = script_dir / OUT_CSV_FILENAME if OUT_CSV_FILENAME.strip() else None

    # ==== check minimi ====
    if not CLIENT_ID or not KEY_ID or not PURPOSE_ID:
        raise RuntimeError("Compila CLIENT_ID / KEY_ID / PURPOSE_ID nella sezione CONFIG in alto.")

    if not csv_path.exists():
        raise FileNotFoundError(f"CSV non trovato: {csv_path}")

    if not key_path.exists():
        raise FileNotFoundError(f"Chiave privata non trovata: {key_path}")

    rsa_key = get_private_key(key_path)
    headers_rsa = {"kid": KEY_ID, "alg": "RS256", "typ": "JWT"}

    issued = datetime.datetime.utcnow()
    expire_in = issued + datetime.timedelta(minutes=43200)  # 30 giorni come tuo script
    iat = unix_ts(issued)
    exp = unix_ts(expire_in)
    nbf = iat
    dnonce = random.randint(1000000000000, 9999999999999)

    # ===== AUDIT ASSERTION =====
    audit_payload = {
        "userID": USER_ID,
        "userLocation": USER_LOCATION,
        "LoA": LOA,
        "iss": CLIENT_ID,
        "aud": AUDIENCE,
        "purposeId": PURPOSE_ID,
        "dnonce": dnonce,
        "jti": str(uuid.uuid4()),
        "iat": iat,
        "nbf": nbf,
        "exp": exp,
    }
    audit = jwt.encode(audit_payload, rsa_key, algorithm=Algorithms.RS256, headers=headers_rsa)
    audit_hash = hashlib.sha256(audit.encode("utf-8")).hexdigest()

    print("audit =", audit)
    print("audit hash =", audit_hash)

    # ===== CLIENT ASSERTION PER VOUCHER =====
    client_assertion_payload = {
        "iss": CLIENT_ID,
        "sub": CLIENT_ID,
        "aud": ACCESS_TOKEN_AUDIENCE,
        "purposeId": PURPOSE_ID,
        "jti": str(uuid.uuid4()),
        "iat": iat,
        "exp": exp,
        "digest": {"alg": "SHA256", "value": audit_hash},
    }
    client_assertion = jwt.encode(client_assertion_payload, rsa_key, algorithm=Algorithms.RS256, headers=headers_rsa)

    # ===== TOKEN =====
    token_url = PDND_BASE_URL+"/token.oauth2"
    token_data = {
        "client_id": CLIENT_ID,
        "client_assertion": client_assertion,
        "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        "grant_type": "client_credentials",
    }
    token_resp = requests.post(
        token_url,
        data=token_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=TIMEOUT_SECONDS,
    )
    print("token response status =", token_resp.status_code)
    print("token response body =", token_resp.text)
    token_resp.raise_for_status()
    voucher = token_resp.json()["access_token"]
    print("voucher =", voucher)

    # ===== CSV =====
    rows = read_rows_from_csv(csv_path)
    print(f"Letti {len(rows)} record dal CSV: {csv_path}")

    # ===== output CSV opzionale =====
    out_csv_file = None
    out_csv_writer = None
    if out_csv_path:
        out_csv_file = out_csv_path.open("w", newline="", encoding="utf-8")
        out_csv_writer = csv.DictWriter(
            out_csv_file,
            fieldnames=["_id", "page", "cf", "http_status", "ok", "error", "response_json", "response_text"],
        )
        out_csv_writer.writeheader()

    content_type = "application/json"
    content_encoding = "UTF-8"

    # ===== LOOP =====
    with out_jsonl_path.open("w", encoding="utf-8") as out_jsonl:
        for idx, row in enumerate(rows, start=1):
            record_id = (row.get("_id") or "").strip()
            cf = (row.get("data") or "").strip()
            page = (row.get("page") or "").strip()

            if not cf:
                result = {"_id": record_id, "page": page, "cf": "", "ok": False, "error": "Missing CF in column 'data'"}
                out_jsonl.write(json.dumps(result, ensure_ascii=False) + "\n")
                if out_csv_writer:
                    out_csv_writer.writerow(
                        {"_id": record_id, "page": page, "cf": "", "http_status": "", "ok": False,
                         "error": result["error"], "response_json": "", "response_text": ""}
                    )
                continue

            body = build_request(cf)
            digest = b64sha256_digest_header(body)

            signature_payload = {
                "iss": CLIENT_ID,
                "aud": AUDIENCE,
                "purposeId": PURPOSE_ID,
                "sub": CLIENT_ID,
                "jti": str(uuid.uuid4()),
                "iat": iat,
                "nbf": nbf,
                "exp": exp,
                "signed_headers": [
                    {"digest": digest},
                    {"content-type": content_type},
                    {"content-encoding": content_encoding},
                ],
            }
            signature = jwt.encode(signature_payload, rsa_key, algorithm=Algorithms.RS256, headers=headers_rsa)

            curl_command = f"""curl -X POST "{TARGET}" \\
  -H "Accept: application/json" \\
  -H "Content-Type: {content_type}" \\
  -H "Content-Encoding: {content_encoding}" \\
  -H "Digest: {digest}" \\
  -H "Authorization: Bearer {voucher}" \\
  -H "Agid-JWT-TrackingEvidence: {audit}" \\
  -H "Agid-JWT-Signature: {signature}" \\
  -d '{body}'
"""

            print("\n==================================================")
            print(f"[{idx}/{len(rows)}] _id={record_id} page={page} CF={cf}")
            print("==================================================")
            print(curl_command)

            result = {
                "_id": record_id,
                "page": page,
                "cf": cf,
                "timestamp_utc": datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc).isoformat(),
                "ok": None,
                "http_status": None,
                "request_body": body,
                "digest": digest,
            }

            if EXECUTE_CALLS:
                headers = {
                    "Accept": "application/json",
                    "Content-Type": content_type,
                    "Content-Encoding": content_encoding,
                    "Digest": digest,
                    "Authorization": f"Bearer {voucher}",
                    "Agid-JWT-TrackingEvidence": audit,
                    "Agid-JWT-Signature": signature,
                }

                try:
                    r = requests.post(TARGET, data=body.encode("utf-8"), headers=headers, timeout=TIMEOUT_SECONDS)
                    result["http_status"] = r.status_code
                    result["response_text"] = r.text
                    result["response_json"] = safe_json(r.text)
                    result["ok"] = 200 <= r.status_code < 300
                    if not result["ok"]:
                        result["error"] = "HTTP error"
                    print(f"HTTP {r.status_code}")
                    print(r.text)
                except Exception as e:
                    result["ok"] = False
                    result["error"] = repr(e)
                    print("ERRORE chiamata execute:", repr(e))
            else:
                # solo cURL stampata
                result["ok"] = True
                result["http_status"] = None

            out_jsonl.write(json.dumps(result, ensure_ascii=False) + "\n")

            if out_csv_writer:
                out_csv_writer.writerow(
                    {
                        "_id": record_id,
                        "page": page,
                        "cf": cf,
                        "http_status": result.get("http_status") if result.get("http_status") is not None else "",
                        "ok": bool(result.get("ok")),
                        "error": result.get("error", ""),
                        "response_json": json.dumps(result.get("response_json"), ensure_ascii=False)
                        if result.get("response_json") is not None
                        else "",
                        "response_text": result.get("response_text", ""),
                    }
                )

    if out_csv_file:
        out_csv_file.close()

    print("\nDONE ✅")
    print(f"Output JSONL: {out_jsonl_path}")
    if out_csv_path:
        print(f"Output CSV:   {out_csv_path}")


if __name__ == "__main__":
    main()
