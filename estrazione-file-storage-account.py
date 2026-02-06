# Questo script scarica specifici file da un Azure Blob Storage basandosi su una lista di percorsi fornita in un file di testo.

import os
from azure.storage.blob import BlobServiceClient

# --- CONFIGURAZIONE ---
CONNECTION_STRING = ""
CONTAINER_NAME = "invoices"
LISTA_FILE = "lista_file.txt"  # Il file che contiene i percorsi dei blob storage
DOWNLOAD_PATH = "./downloaded_files"


def download_specific_blobs():
  # Inizializza il client
  service_client = BlobServiceClient.from_connection_string(CONNECTION_STRING)
  container_client = service_client.get_container_client(CONTAINER_NAME)

  # Legge la lista dei file
  if not os.path.exists(LISTA_FILE):
    print(f"Errore: Il file {LISTA_FILE} non esiste.")
    return

  with open(LISTA_FILE, "r") as f:
    paths = [line.strip() for line in f if line.strip()]

  total_files = len(paths)
  print(f"Trovati {total_files} file da scaricare.\n")

  for index, blob_path in enumerate(paths, 1):
    try:
      # Definisce il percorso locale mantenendo la struttura delle cartelle
      filename = os.path.basename(blob_path)  # Estrae 'documento.pdf' da 'folder/sub/documento.pdf'
      local_file_path = os.path.join(DOWNLOAD_PATH, filename)

      # Download
      blob_client = container_client.get_blob_client(blob_path)
      with open(local_file_path, "wb") as download_file:
        download_file.write(blob_client.download_blob().readall())

      # Contatore semplice
      print(f"[{index}/{total_files}] Scaricato: {blob_path}")

    except Exception as e:
      print(f"[{index}/{total_files}] ERRORE su {blob_path}: {e}")

  print("\nOperazione completata.")


if __name__ == "__main__":
  download_specific_blobs()
