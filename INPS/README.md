# Verifica Ammissibilità INPS (Batch)

Script Python per l'elaborazione **batch** di richieste di ammissibilità verso un endpoint INPS (IDPay),
con input da CSV, output su CSV e logging su file.

## 📦 Contenuto del progetto
- `script.py` – Script principale Python (multithreading).
- `input.csv` – File di input con le richieste da processare.
- `output.csv` – File di output generato automaticamente.
- `inps.log` – Log di esecuzione.

## ⚙️ Requisiti
- Python **3.9+**
- Librerie Python:
  ```bash
  pip install requests
  ```

## 🔧 Configurazione
Nel file Python, compilare la sezione **CONFIG**:

```python
URL = "ADMISSIBILITY_INGRESS/idpay/admissibility/inps/connection/test/threshold/BELET25"
```

Eventualmente personalizzare:
- timeout
- numero di thread
- nome file input/output

## 📥 Formato input.csv
Il file `input.csv` deve contenere almeno le seguenti colonne:

| Colonna | Descrizione |
|-------|-------------|
| `_id` | Identificativo record |
| `data` | Payload JSON o dati fiscali |
| `page` | Numero pagina / batch |

Esempio:
```csv
_id,data,page
1,ABCDEF12G34H567I,1
```

## ▶️ Esecuzione
```bash
python script.py
```

## 📤 Output
Il file `output.csv` conterrà campi come:
- esito
- sottoSoglia
- protocolloDSU
- dataPresentazioneDSU
- presenzaDifformita
- error

## 🧵 Concorrenza
Lo script utilizza `ThreadPoolExecutor` per inviare più richieste in parallelo.

## 📝 Log
Tutte le operazioni vengono registrate nel file:
```
inps.log
```

## ⚠️ Note
- Verificare la raggiungibilità dell'endpoint INPS
- Usare solo ambienti di test se non autorizzati alla produzione

---
👤 README generato automaticamente
