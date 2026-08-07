#!/usr/bin/env python3

import logging

import pandas as pd
import psycopg2
from pymongo import MongoClient


FISCAL_CODE_PREFIX = "VRMGRG"
TRX_END_DATE = "2026-08-15 00:00:00.000 +0200"
OUTPUT_PATH = "transactions_with_users.csv"

logger = logging.getLogger(__name__)


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    logger.info(
        "Starting export for CREATED transactions with trxEndDate=%s and fiscal-code prefix=%s",
        TRX_END_DATE,
        FISCAL_CODE_PREFIX,
    )
    logger.info("Connecting to PostgreSQL")
    pg_conn = psycopg2.connect("postgresql://username:psw@cstar-u-itn-idpay-pgflex.postgres.database.azure.com:5432/idpay-database")
    logger.info("Connected to PostgreSQL; connecting to MongoDB")
    mongo_client = MongoClient("connection-string")
    mongo_db = mongo_client["idpay-beneficiari"]

    try:
        # Fetch only CREATED transactions with the required expiration date.
        logger.info("Fetching matching transactions")
        tx_df = pd.read_sql(
            """
            SELECT "trxCode", "userId"
            FROM "idpay-pagamenti".transaction
            WHERE status = %(status)s
              AND "trxEndDate" = %(trx_end_date)s
            """,
            pg_conn,
            params={"status": "CREATED", "trx_end_date": TRX_END_DATE},
        )
        tx_df["userId"] = tx_df["userId"].astype("string")
        logger.info("Found %d matching transactions", len(tx_df))

        # data_vault._id matches transactions.user_id; data is the value to export.
        user_ids = tx_df["userId"].dropna().unique().tolist()
        logger.info(
            "Looking up %d unique user IDs in data_vault", len(user_ids)
        )
        vault_docs = list(
            mongo_db.data_vault.find(
                {
                    "_id": {"$in": user_ids},
                    "data": {"$regex": f"^{FISCAL_CODE_PREFIX}"},
                },
                {"_id": 1, "data": 1},
            )
        )
        vault_df = pd.DataFrame(vault_docs, columns=["_id", "data"])
        vault_df["_id"] = vault_df["_id"].astype("string")
        logger.info("Found %d data_vault records matching the prefix", len(vault_df))

        export_df = (
            tx_df.merge(vault_df, left_on="userId", right_on="_id", how="inner")
            .loc[:, ["trxCode", "data"]]
            .dropna(subset=["trxCode", "data"])
        )
        logger.info("Writing %d rows to %s", len(export_df), OUTPUT_PATH)
        export_df.to_csv(OUTPUT_PATH, index=False)
        logger.info("Export completed successfully")
    finally:
        logger.info("Closing database connections")
        pg_conn.close()
        mongo_client.close()


if __name__ == "__main__":
    main()
