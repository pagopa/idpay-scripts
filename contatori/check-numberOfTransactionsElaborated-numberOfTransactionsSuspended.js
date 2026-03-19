db.rewards_batch.find({
  $or: [
    { numberOfTransactionsElaborated: { $lt: NumberLong(0) } },
    { numberOfTransactionsSuspended: { $lt: NumberLong(0) } }
  ]
}).forEach(function(batch) {

  var stats = db.transaction.aggregate([
    {
      $match: {
        rewardBatchId: batch._id
      }
    },
    {
      $group: {
        _id: "$rewardBatchId",

        // totale trx
        totalTransactions: { $sum: 1 },

        // EVALUATING = status NOT IN [TO_CHECK, CONSULTABLE]
        evaluatingTransactions: {
          $sum: {
            $cond: [
              {
                $not: {
                  $in: [
                    "$rewardBatchTrxStatus",
                    ["TO_CHECK", "CONSULTABLE"]
                  ]
                }
              },
              1,
              0
            ]
          }
        },

        // SUSPENDED
        suspendedTransactions: {
          $sum: {
            $cond: [
              { $eq: ["$rewardBatchTrxStatus", "SUSPENDED"] },
              1,
              0
            ]
          }
        }
      }
    }
  ]).toArray();

  var s = stats.length > 0
    ? stats[0]
    : {
        totalTransactions: 0,
        evaluatingTransactions: 0,
        suspendedTransactions: 0
      };

  // 🔹 CALCOLO ELABORATED
  var newElaborated = batch.numberOfTransactionsElaborated;

  if (batch.status === "EVALUATING") {
    newElaborated = s.evaluatingTransactions;
  } else if (batch.status === "APPROVED") {
    newElaborated = s.totalTransactions;
  }

  // 🔹 CALCOLO SUSPENDED (SEMPRE, anche 0)
  var newSuspended = s.suspendedTransactions;

  printjson({
    _id: batch._id,
    status: batch.status,
    businessName: batch.businessName,
    month: batch.month,

    old: {
      numberOfTransactionsElaborated: batch.numberOfTransactionsElaborated,
      numberOfTransactionsSuspended: batch.numberOfTransactionsSuspended
    },

    calculated: {
      totalTransactions: s.totalTransactions,
      evaluatingTransactions: s.evaluatingTransactions,
      suspendedTransactions: s.suspendedTransactions
    },

    previewAfterFix: {
      numberOfTransactionsElaborated: newElaborated,
      numberOfTransactionsSuspended: newSuspended
    },

    delta: {
      elaborated: newElaborated - batch.numberOfTransactionsElaborated,
      suspended: newSuspended - batch.numberOfTransactionsSuspended
    },

    changed: {
      elaborated: batch.numberOfTransactionsElaborated != newElaborated,
      suspended: batch.numberOfTransactionsSuspended != newSuspended
    }
  });

});