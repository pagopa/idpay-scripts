# Visura InfoCamere tramite PDND

Script Python per interrogare direttamente il servizio InfoCamere esposto tramite PDND (Piattaforma Digitale Nazionale Dati).

## Funzionalità

- Generazione della `client_assertion` JWT firmata con chiave privata
- Ottenimento dell'access token PDND tramite OAuth2 Client Credentials
- Chiamata al servizio InfoCamere
- Salvataggio automatico della risposta in formato XML

---

## Requisiti

- Python 3.9+
- Credenziali PDND abilitate per il servizio InfoCamere
- Chiave privata `.priv`
- Client ID
- KID
- Purpose ID
- Audience
- Endpoint OAuth PDND

---

## Installazione

```bash
pip uninstall jwt -y
pip install PyJWT cryptography requests
```

Verifica:

```bash
python -c "import jwt; print(jwt.__version__)"
```

Output atteso:

```text
2.x.x
```

---

## Configurazione

Nel file `visura_pdnd.py` valorizzare:

```python
PDND_AUTH_URL = "https://..."
INFOCAMERE_BASE_URL = "https://..."

CLIENT_ID = "..."
KID = "..."
AUDIENCE = "..."
PURPOSE_ID = "..."

PRIVATE_KEY_PATH = "chiave.priv"
```

---

## Esecuzione

### Ricerca tramite Codice Fiscale

Impostare il valore desiderato:

```python
codice_fiscale = "<CODICE_FISCALE>"
```

Eseguire:

```bash
python visura_pdnd.py
```

---

## Output

Lo script genera un file XML contenente la risposta restituita dal servizio InfoCamere:

```text
visura_<CODICE_FISCALE>.xml
```

---

## Flusso di autenticazione

### 1. Generazione Client Assertion

Payload JWT:

```json
{
  "sub": "<clientId>",
  "iss": "<clientId>",
  "aud": "<audience>",
  "purposeId": "<purposeId>",
  "jti": "<uuid>",
  "iat": 1710000000,
  "exp": 1710003600
}
```

Header:

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "<kid>"
}
```

### 2. Ottenimento Access Token

```http
POST /token.oauth2
Content-Type: application/x-www-form-urlencoded
```

Body:

```text
grant_type=client_credentials
client_id=<clientId>
client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
client_assertion=<jwt>
```

### 3. Chiamata InfoCamere

```http
GET /dettaglio/codicefiscale?codiceFiscale=<CODICE_FISCALE>
Authorization: Bearer <access_token>
```

---

## Endpoint disponibili

### Ricerca per Codice Fiscale

```http
GET /dettaglio/codicefiscale
```

Parametri:

```text
codiceFiscale
```

### Ricerca per REA

```http
GET /ricerca/nrea
```

Parametri:

```text
siglaProvincia
numeroRea
```

Esempio:

```http
GET /ricerca/nrea?siglaProvincia=RM&numeroRea=123456
```

---

## Troubleshooting

### AttributeError: module 'jwt' has no attribute 'encode'

Disinstallare il package errato:

```bash
pip uninstall jwt
pip install PyJWT
```

### 401 Unauthorized

Verificare:

- Audience
- Purpose ID
- KID
- Client ID
- Chiave privata

### 403 Forbidden

Verificare:

- Sottoscrizione all'e-service
- Purpose attivo
- Autorizzazioni PDND

---

## Sicurezza

Non versionare:

- Chiavi private
- Certificati
- Token
- Credenziali

Aggiungere al `.gitignore`:

```gitignore
*.priv
*.pem
*.p12
*.pfx
.env
```