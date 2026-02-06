# C021 – Accertamento Stato Famiglia (PDND / ANPR)

Script Python per l’invocazione del **servizio ANPR C021 – Accertamento Stato Famiglia** tramite **PDND**, con autenticazione OAuth2 + JWT (audit, signature) secondo le specifiche AgID.

Lo script:
- legge un file CSV con i codici fiscali
- genera **Audit JWT** e **Signature JWT**
- ottiene il **voucher PDND**
- invoca l’endpoint ANPR C021
- salva le risposte in **JSONL** e opzionalmente **CSV**

---

## Requisiti

- Python **≥ 3.10**
- Credenziali PDND abilitate al servizio ANPR C021
- Chiave privata RSA dell’e-service

### Dipendenze Python

```bash
pip install python-jose requests
```

---

## Struttura del progetto

```text
.
├── main.py
├── input.csv
├── eservice-client-keypair.rsa.priv
├── output.jsonl
├── output.csv
└── README.md
```

---

## Configurazione

Compilare **obbligatoriamente** la sezione `CONFIG` all’inizio dello script `main.py`:

```python
CLIENT_ID = "PAGOPA_PDND_CONFIGURATION_CLIENT_ID_C021"
KEY_ID = "PAGOPA_PDND_CONFIGURATION_KID_C021"
PURPOSE_ID = "PAGOPA_PDND_CONFIGURATION_PURPOSE_ID_C021"

USER_ID = "NAME SURNAME"
AUDIENCE = "ANPR_C021_AUDIENCE"
TARGET = "ANPR_BASE_URL/C021-servizioAccertamentoStatoFamiglia/v1/anpr-service-e002"

ACCESS_TOKEN_AUDIENCE = "PDND_ACCESS_TOKEN_AUDIENCE"
PDND_BASE_URL = "PDND_BASE_URL"
```

---

## Chiave privata

Aggiungere file `eservice-client-keypair.rsa.priv` deve contenere **solo** la chiave privata RSA in formato PEM:

```text
-----BEGIN PRIVATE KEY-----
dj919fuj1o109fn
-----END PRIVATE KEY-----
```

---

## Formato input.csv

```csv
_id,data,page
```

Esempio:

```csv
1,ABCDEF12G34H567I,1
```

---

## Esecuzione

```bash
python main.py
```

---

## Output

- `output.jsonl` – output principale
- `output.csv` – output tabellare (opzionale)

---

Uso interno – integrazione **PDND / ANPR C021**
