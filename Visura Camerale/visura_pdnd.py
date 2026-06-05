import time
import uuid
from xml.dom import minidom

import jwt
import requests


# ==========================================
# CONFIGURAZIONE
# ==========================================

PDND_AUTH_URL = "YOUR_PDND_AUTH_URL"
INFOCAMERE_BASE_URL = "YOUR_INFOCAMERE_BASE_URL"

CLIENT_ID = "YOUR_CLIENT_ID"
KID = "YOUR_KID"
AUDIENCE = "YOUR_AUDIENCE"
PURPOSE_ID = "YOUR_PURPOSE_ID"

PRIVATE_KEY_PATH = "chiave.priv"

CODICE_FISCALE = "YOUR_CODICE_FISCALE"


# ==========================================
# CHIAVE PRIVATA
# ==========================================

def load_private_key():
    with open(PRIVATE_KEY_PATH, "r", encoding="utf-8") as f:
        return f.read()


# ==========================================
# CLIENT ASSERTION JWT
# ==========================================

def generate_client_assertion():
    now = int(time.time())

    payload = {
        "sub": CLIENT_ID,
        "iss": CLIENT_ID,
        "aud": AUDIENCE,
        "purposeId": PURPOSE_ID,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + 3600
    }

    headers = {
        "kid": KID,
        "alg": "RS256",
        "typ": "JWT"
    }

    return jwt.encode(
        payload,
        load_private_key(),
        algorithm="RS256",
        headers=headers
    )


# ==========================================
# TOKEN PDND
# ==========================================

def get_access_token():
    response = requests.post(
        f"{PDND_AUTH_URL}/token.oauth2",
        data={
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_assertion_type":
                "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            "client_assertion": generate_client_assertion()
        },
        headers={
            "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout=30
    )

    print(f"TOKEN STATUS: {response.status_code}")

    if not response.ok:
        print(response.text)

    response.raise_for_status()

    return response.json()["access_token"]


# ==========================================
# VISURA INFOCAMERE
# ==========================================

def get_visura_by_codice_fiscale(codice_fiscale):
    token = get_access_token()

    response = requests.get(
        f"{INFOCAMERE_BASE_URL}/dettaglio/codicefiscale",
        params={
            "codiceFiscale": codice_fiscale
        },
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/xml"
        },
        timeout=60
    )

    print(f"VISURA STATUS: {response.status_code}")

    if not response.ok:
        print(response.text)

    response.raise_for_status()

    return response.text


# ==========================================
# SALVATAGGIO XML
# ==========================================

def save_xml(xml_content, output_file):
    try:
        pretty_xml = minidom.parseString(xml_content).toprettyxml(
            indent="  ",
            encoding="utf-8"
        )

        with open(output_file, "wb") as f:
            f.write(pretty_xml)

    except Exception:
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(xml_content)


# ==========================================
# MAIN
# ==========================================

if __name__ == "__main__":

    print("Richiesta visura...")

    xml = get_visura_by_codice_fiscale(CODICE_FISCALE)

    output_file = f"visura_{CODICE_FISCALE}.xml"

    save_xml(xml, output_file)

    print(f"File creato: {output_file}")