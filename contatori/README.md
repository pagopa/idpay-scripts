# Contatori lotti
I contatori dei lotti servono a tenere traccia in maniera efficiente delle statistiche sulle transazioni di un lotto.

## Strutture dati
Di seguito la definizione delle strutture dati minime su DB mongo necessarie a valutare correttamente i contatori.

### Transaction
database: idpay-pagamenti

collezione: transaction

struttura:
```json
{
  "_id": "69b2db75a72c3e54e0a9e3fe",
  "rewards": {
    "68dd003ccce8c534d1da22bc": {
      "accruedRewardCents": 12800
    }
  },
  "rewardBatchId": "5385kYK3qRadIpxrFnoI6b1vQ",
  "rewardBatchTrxStatus": "APPROVED"
}
```
- rewards: mappa che associa tramite id iniziativa, il valore della ricompensa in centesimi.
- rewardBatchId: id del lotto a cui è associata la transazione
- rewardBatchTrxStatus: stato della transazione all'interno del lotto, può essere :
  TO_CHECK CONSULTABLE SUSPENDED APPROVED REJECTED

### RewardBatch
database: idpay-pagamenti
collezione: rewards-batch
struttura:
```json
{
  "_id": "5385kYK3qRadIpxrFnoI6b1vQ",
  "merchantId": "68dd003ccce8c534d1da22bc",
  "month": "2026-03",
  "posType": "PHISICAL",
  "status": "APPROVED",
  "initialAmountCents": 0,
  "numberOfTransactions": 0,
  "numberOfTransactionsElaborated": 0,
  "numberOfTransactionsRejected": 0,
  "approvedAmountCents": 0,
  "suspendedAmountCents": 0,
  "numberOfTransactionsSuspended": 0
  
}
```
- merchantId: id del merchant associato al lotto
- month: mese di riferimento del lotto nel formato YYYY-MM
- posType: tipologia delle transazioni associate al lotto, pososno essere PHYSICAL o ONLINE
- status: stato del lotto, può essere CREATED SENT EVALUATING APPROVING APPROVED PENDING_REFUND REFUNDED NOT_REFUNDED
- initialAmountCents: importo totale in centesimi associato al lotto al momento della send
- numberOfTransactions: numero di transazioni associate al lotto, sempre aggiornato
- numberOfTransactionsElaborated: numero di transazioni elaborate, ovvero che hanno un rewardBatchTrxStatus diverso da TO_CHECK/CONSULTABLE
- numberOfTransactionsRejected: numero di transazioni rifiutate, ovvero che hanno un rewardBatchTrxStatus REJECTED
- approvedAmountCents: importo totale in centesimi approvato
- suspendedAmountCents: importo totale in centesimi delle transazioni sospese presenti nel lotto all'approvazione, poi spostate
- numberOfTransactionsSuspended: numero di transazioni sospese presenti nel lotto all'approvazione, poi spostate

## Operazioni
Durante il ciclo di vita dei lotti pososno intervenire alcune operazioni.
### Invio lotto
L'operazione di invio del lotto fa passare lo stato del lotto da CREATED a EVALUATING, da questo momento initialAmountCents non viene più aggiornato.
### Approvazione lotto
L'operazione di approvazione del lotto fa passare lo stato del lotto da EVALUATING a APPROVED, in questo caso le transazioni vengono trasformate in base al loro rewardBatchTrxStatus.

## Script bonifica
A seguito di rilasci o aggiornamenti alcuni contatori pososno necessitare di aggiornamento, di seguito gli script sviluppati.

### approvedAmountCents
Lotto EVALUATING: somma valore trx in stato TO_CHECK, CONSULTABLE, APPROVED
Lotto APPROVED: somma valore trx in stato APPROVED

### numberOfTransactionsElaborated
Lotto EVALUATING: somma numero trx in stato diverso da TO_CHECK, CONSULTABLE
Lotto APPROVED: somma numero di tutte le trx