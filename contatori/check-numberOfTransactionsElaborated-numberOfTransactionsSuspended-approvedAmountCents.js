db.rewards_batch.find({
  $or: [
    { numberOfTransactionsElaborated: { $lt: NumberLong(0) } },
    { numberOfTransactionsSuspended: { $lt: NumberLong(0) } }
  ]
}).forEach(function(batch) {

  var trxStats = db.transaction.aggregate([
    { $match: { rewardBatchId: batch._id } },
    {
      $group: {
        _id: null,
        totalTransactions: { $sum: 1 },
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

  var t = trxStats.length > 0
    ? trxStats[0]
    : {
        totalTransactions: 0,
        evaluatingTransactions: 0,
        suspendedTransactions: 0
      };

  var amountStats = db.transaction.aggregate([
    { $match: { rewardBatchId: batch._id } },
    {
      $project: {
        rewardBatchTrxStatus: 1,
        rewardsArray: { $objectToArray: "$rewards" }
      }
    },
    { $unwind: "$rewardsArray" },
    {
      $project: {
        rewardBatchTrxStatus: 1,
        accruedRewardCents: { $toLong: "$rewardsArray.v.accruedRewardCents" }
      }
    },
    {
      $group: {
        _id: null,
        amountEvaluating: {
          $sum: {
            $cond: [
              {
                $in: [
                  "$rewardBatchTrxStatus",
                  ["TO_CHECK", "CONSULTABLE", "APPROVED"]
                ]
              },
              "$accruedRewardCents",
              0
            ]
          }
        },
        amountApproved: {
          $sum: {
            $cond: [
              { $eq: ["$rewardBatchTrxStatus", "APPROVED"] },
              "$accruedRewardCents",
              0
            ]
          }
        }
      }
    }
  ]).toArray();

  var a = amountStats.length > 0
    ? amountStats[0]
    : {
        amountEvaluating: NumberLong(0),
        amountApproved: NumberLong(0)
      };

  var newElaborated = batch.numberOfTransactionsElaborated;
  if (batch.status === "EVALUATING") {
    newElaborated = NumberLong(t.evaluatingTransactions);
  } else if (batch.status === "APPROVED") {
    newElaborated = NumberLong(t.totalTransactions);
  }

  var newSuspended = NumberLong(t.suspendedTransactions);

  var newApprovedAmount = batch.approvedAmountCents;
  if (batch.status === "EVALUATING") {
    newApprovedAmount = a.amountEvaluating;
  } else if (batch.status === "APPROVED") {
    newApprovedAmount = a.amountApproved;
  }

  var oldElab = batch.numberOfTransactionsElaborated ? batch.numberOfTransactionsElaborated.valueOf() : 0;
  var newElab = newElaborated ? newElaborated.valueOf() : 0;

  var oldSusp = batch.numberOfTransactionsSuspended ? batch.numberOfTransactionsSuspended.valueOf() : 0;
  var newSusp = newSuspended ? newSuspended.valueOf() : 0;

  var oldAmount = batch.approvedAmountCents ? batch.approvedAmountCents.valueOf() : 0;
  var newAmount = newApprovedAmount ? newApprovedAmount.valueOf() : 0;

  if (oldElab !== newElab || oldSusp !== newSusp || oldAmount !== newAmount) {
    var res = db.rewards_batch.updateOne(
      { _id: batch._id },
      {
        $set: {
          numberOfTransactionsElaborated: newElaborated,
          numberOfTransactionsSuspended: newSuspended,
          approvedAmountCents: newApprovedAmount,
          updateDate: new Date()
        }
      }
    );

    printjson({
      _id: batch._id,
      action: "UPDATED",
      old: {
        elaborated: oldElab,
        suspended: oldSusp,
        approvedAmountCents: oldAmount
      },
      new: {
        elaborated: newElab,
        suspended: newSusp,
        approvedAmountCents: newAmount
      },
      mongo: res
    });
  } else {
    printjson({
      _id: batch._id,
      action: "SKIPPED_NO_CHANGE"
    });
  }
});