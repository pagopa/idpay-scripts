import argparse
import json
import os
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import ijson
import psycopg2
from psycopg2 import extras, sql


ROME = ZoneInfo("Europe/Rome")
DEFAULT_BATCH_SIZE = 5000
PAYMENT_SCHEMA = "idpay-pagamenti"
REWARD_SCHEMA = "idpay-rimborsi"

PAYMENT_COLUMNS = (
    "id",
    "trxCode",
    "operationType",
    "operationTypeTranscoded",
    "status",
    "trxDate",
    "trxChargeDate",
    "trxEndDate",
    "elaborationDateTime",
    "updateDate",
    "userId",
    "merchantId",
    "acquirerId",
    "pointOfSaleId",
    "amountCents",
    "effectiveAmountCents",
    "voucherAmountCents",
    "amountCurrency",
    "channel",
    "initiativeId",
    "initiativeName",
    "initiatives",
    "businessName",
    "franchiseName",
    "invoiceData",
    "creditNoteData",
    "correlationId",
    "createdAt",
    "idTrxAcquirer",
    "merchantFiscalCode",
    "vat",
    "pointOfSaleType",
    "productType",
    "familyId",
    "rewardCents",
    "counterVersion",
    "transactionRevision",
    "rewards",
    "rejectionReasons",
    "initiativeRejectionReasons",
    "additionalProperties",
    "mcc",
    "idTrxIssuer",
    "extendedAuthorization",
)

REWARD_BATCH_COLUMNS = (
    "id",
    "initiative_id",
    "merchant_id",
    "business_name",
    "month",
    "pos_type",
    "status",
    "partial",
    "name",
    "start_date",
    "end_date",
    "creation_date",
    "update_date",
    "merchant_send_date",
    "approval_date",
    "delivery_date_request",
    "delivery_amount_cents",
    "initial_amount_cents_at_send",
    "suspended_amount_cents_at_approving",
    "refund_outcome_timestamp",
    "report_path",
    "filename",
    "assignee_level",
    "refund_valuta_date",
    "refund_error_message",
    "delivery_outcome",
)

REWARD_TRANSACTION_COLUMNS = (
    "transaction_id",
    "initiative_id",
    "reward_batch_id",
    "id_trx_acquirer",
    "acquirer_code",
    "trx_date",
    "operation_type",
    "circuit_type",
    "id_trx_issuer",
    "correlation_id",
    "amount_cents",
    "amount_currency",
    "acquirer_id",
    "merchant_id",
    "point_of_sale_id",
    "pos_type",
    "status",
    "rejection_reasons",
    "initiative_rejection_reasons",
    "rewards",
    "user_id",
    "operation_type_transcoded",
    "effective_amount_cents",
    "trx_charge_date",
    "refund_info",
    "elaboration_date_time",
    "channel",
    "additional_properties",
    "invoice_data",
    "credit_note_data",
    "trx_code",
    "reward_batch_trx_status",
    "reward_batch_rejection_reasons",
    "reward_batch_inclusion_date",
    "franchise_name",
    "point_of_sale_type",
    "business_name",
    "invoice_upload_date",
    "sampling_key",
    "update_date",
    "extended_authorization",
    "voucher_amount_cents",
    "reward_batch_last_month_elaborated",
    "checks_error",
    "accrued_reward_cents",
    "transaction_revision",
    "latest_applied_payment_impact_revision",
)


def parse_mongo_date(value):
    if isinstance(value, dict):
        if "$date" in value:
            value = value["$date"]
        if isinstance(value, dict) and "$numberLong" in value:
            value = int(value["$numberLong"])

    if isinstance(value, (int, float)):
        parsed = datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    elif isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    elif isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        raise TypeError(f"Unsupported Mongo date value: {type(value).__name__}")

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(ROME)


def normalize_extended_json(value):
    if isinstance(value, dict):
        if len(value) == 1 and "$oid" in value:
            return value["$oid"]
        if len(value) == 1 and "$numberLong" in value:
            return int(value["$numberLong"])
        if len(value) == 1 and "$numberInt" in value:
            return int(value["$numberInt"])
        if len(value) == 1 and "$numberDouble" in value:
            return float(value["$numberDouble"])
        if len(value) == 1 and "$numberDecimal" in value:
            return float(value["$numberDecimal"])
        if len(value) == 1 and "$date" in value:
            return parse_mongo_date(value).isoformat()
        return {key: normalize_extended_json(item) for key, item in value.items()}

    if isinstance(value, list):
        return [normalize_extended_json(item) for item in value]

    return value


def clean_value(value):
    return normalize_extended_json(value)


def clean_timestamp(value, preserve_timezone):
    if value is None:
        return None

    parsed = parse_mongo_date(value)
    return parsed if preserve_timezone else parsed.replace(tzinfo=None)


def clean_date(value):
    if value is None:
        return None

    if isinstance(value, str) and "T" not in value and " " not in value:
        return date.fromisoformat(value)

    return clean_timestamp(value, preserve_timezone=False).date()


def extract_product_type(document):
    product_type = document.get("productType")
    if product_type is not None:
        return product_type

    additional_properties = document.get("additionalProperties")
    if isinstance(additional_properties, dict):
        return additional_properties.get("productType")

    return None


def to_jsonb(value):
    if value is None:
        return None
    return extras.Json(normalize_extended_json(value))


def source_id(document):
    value = document.get("_id", document.get("id"))
    value = normalize_extended_json(value)
    if value is None or value == "":
        raise ValueError("Mongo document is missing its _id")
    return str(value)


def required_value(document, field_name):
    value = clean_value(document.get(field_name))
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValueError(f"Mongo document {source_id(document)} is missing {field_name}")
    return value


def transaction_initiative_id(document):
    initiative_id = clean_value(document.get("initiativeId"))
    initiatives = document.get("initiatives")

    if initiatives is not None:
        normalized_initiatives = normalize_extended_json(initiatives)
        if not isinstance(normalized_initiatives, list) or len(normalized_initiatives) != 1:
            raise ValueError(
                f"Transaction {source_id(document)} must contain exactly one initiative"
            )
        list_initiative_id = str(normalized_initiatives[0])
        if initiative_id is not None and str(initiative_id) != list_initiative_id:
            raise ValueError(
                f"Transaction {source_id(document)} has inconsistent initiativeId and initiatives"
            )
        initiative_id = list_initiative_id

    if initiative_id is None or str(initiative_id).strip() == "":
        raise ValueError(f"Transaction {source_id(document)} is missing initiativeId")

    return str(initiative_id)


def accrued_reward_cents(document, initiative_id):
    rewards = document.get("rewards")
    if not isinstance(rewards, dict):
        return 0

    initiative_reward = rewards.get(initiative_id)
    if not isinstance(initiative_reward, dict):
        return 0

    value = clean_value(initiative_reward.get("accruedRewardCents"))
    return 0 if value is None else value


def payment_transaction_row(document):
    return (
        source_id(document),
        document.get("trxCode"),
        document.get("operationType"),
        document.get("operationTypeTranscoded"),
        document.get("status"),
        clean_timestamp(document.get("trxDate"), preserve_timezone=True),
        clean_timestamp(document.get("trxChargeDate"), preserve_timezone=True),
        clean_timestamp(document.get("trxEndDate"), preserve_timezone=True),
        clean_timestamp(document.get("elaborationDateTime"), preserve_timezone=False),
        clean_timestamp(document.get("updateDate"), preserve_timezone=False),
        document.get("userId"),
        document.get("merchantId"),
        document.get("acquirerId"),
        document.get("pointOfSaleId"),
        clean_value(document.get("amountCents")),
        clean_value(document.get("effectiveAmountCents")),
        clean_value(document.get("voucherAmountCents")),
        document.get("amountCurrency"),
        document.get("channel"),
        clean_value(document.get("initiativeId")),
        document.get("initiativeName"),
        to_jsonb(document.get("initiatives")),
        document.get("businessName"),
        document.get("franchiseName"),
        to_jsonb(document.get("invoiceData")),
        to_jsonb(document.get("creditNoteData")),
        document.get("correlationId"),
        clean_timestamp(document.get("createdAt"), preserve_timezone=False),
        document.get("idTrxAcquirer"),
        document.get("merchantFiscalCode"),
        document.get("vat"),
        document.get("pointOfSaleType"),
        extract_product_type(document),
        document.get("familyId"),
        clean_value(document.get("rewardCents")),
        clean_value(document.get("counterVersion")),
        0,
        to_jsonb(document.get("rewards")),
        to_jsonb(document.get("rejectionReasons")),
        to_jsonb(document.get("initiativeRejectionReasons")),
        to_jsonb(document.get("additionalProperties")),
        document.get("mcc"),
        document.get("idTrxIssuer"),
        document.get("extendedAuthorization"),
    )


def reward_batch_row(document):
    batch_id = source_id(document)
    return (
        batch_id,
        required_value(document, "initiativeId"),
        required_value(document, "merchantId"),
        document.get("businessName"),
        required_value(document, "month"),
        required_value(document, "posType"),
        required_value(document, "status"),
        bool(document.get("partial", False)),
        required_value(document, "name"),
        clean_timestamp(document.get("startDate"), preserve_timezone=False),
        clean_timestamp(document.get("endDate"), preserve_timezone=False),
        clean_timestamp(required_value(document, "creationDate"), preserve_timezone=False),
        clean_timestamp(required_value(document, "updateDate"), preserve_timezone=False),
        clean_timestamp(document.get("merchantSendDate"), preserve_timezone=False),
        clean_timestamp(document.get("approvalDate"), preserve_timezone=False),
        clean_timestamp(document.get("deliveryDateRequest"), preserve_timezone=False),
        clean_value(document.get("deliveryAmountCents")),
        clean_value(document.get("initialAmountCentsAtSend")),
        clean_value(document.get("suspendedAmountCentsAtApproving")),
        clean_timestamp(document.get("refundOutcomeTimestamp"), preserve_timezone=False),
        document.get("reportPath"),
        document.get("filename"),
        required_value(document, "assigneeLevel"),
        clean_date(document.get("refundValutaDate")),
        document.get("refundErrorMessage"),
        to_jsonb(document.get("deliveryOutcome")),
    )


def reward_transaction_row(document):
    initiative_id = transaction_initiative_id(document)
    reward_batch_rejection_reasons = document.get("rewardBatchRejectionReason")
    if reward_batch_rejection_reasons is None:
        reward_batch_rejection_reasons = document.get("rewardBatchRejectionReasons")

    pos_type = document.get("posType")
    if pos_type is None:
        pos_type = document.get("pointOfSaleType")

    sampling_key = clean_value(document.get("samplingKey"))
    if sampling_key is None:
        sampling_key = 0

    return (
        source_id(document),
        initiative_id,
        clean_value(document.get("rewardBatchId")),
        document.get("idTrxAcquirer"),
        document.get("acquirerCode"),
        clean_timestamp(document.get("trxDate"), preserve_timezone=False),
        document.get("operationType"),
        document.get("circuitType"),
        document.get("idTrxIssuer"),
        document.get("correlationId"),
        clean_value(document.get("amountCents")),
        document.get("amountCurrency"),
        document.get("acquirerId"),
        document.get("merchantId"),
        document.get("pointOfSaleId"),
        pos_type,
        document.get("status"),
        to_jsonb(document.get("rejectionReasons")),
        to_jsonb(document.get("initiativeRejectionReasons")),
        to_jsonb(document.get("rewards")),
        document.get("userId"),
        document.get("operationTypeTranscoded"),
        clean_value(document.get("effectiveAmountCents")),
        clean_timestamp(document.get("trxChargeDate"), preserve_timezone=False),
        to_jsonb(document.get("refundInfo")),
        clean_timestamp(document.get("elaborationDateTime"), preserve_timezone=False),
        document.get("channel"),
        to_jsonb(document.get("additionalProperties")),
        to_jsonb(document.get("invoiceData")),
        to_jsonb(document.get("creditNoteData")),
        document.get("trxCode"),
        document.get("rewardBatchTrxStatus"),
        to_jsonb(reward_batch_rejection_reasons),
        clean_timestamp(document.get("rewardBatchInclusionDate"), preserve_timezone=False),
        document.get("franchiseName"),
        document.get("pointOfSaleType"),
        document.get("businessName"),
        clean_timestamp(document.get("invoiceUploadDate"), preserve_timezone=False),
        sampling_key,
        clean_timestamp(document.get("updateDate"), preserve_timezone=False),
        document.get("extendedAuthorization"),
        clean_value(document.get("voucherAmountCents")),
        document.get("rewardBatchLastMonthElaborated"),
        to_jsonb(document.get("checksError")),
        accrued_reward_cents(document, initiative_id),
        0,
        0,
    )


def iter_documents(path):
    with path.open("rb") as source:
        first_byte = source.read(1)
        while first_byte and first_byte.isspace():
            first_byte = source.read(1)
        source.seek(0)

        if first_byte == b"[":
            yield from ijson.items(source, "item")
            return

        for line in source:
            if line.strip():
                yield json.loads(line)


def insert_query(schema_name, table_name, columns, conflict_target=None):
    conflict = sql.SQL("DO NOTHING")
    if conflict_target:
        conflict = sql.SQL("({}) DO NOTHING").format(sql.Identifier(conflict_target))

    return sql.SQL(
        "INSERT INTO {}.{} ({}) VALUES %s ON CONFLICT {}"
    ).format(
        sql.Identifier(schema_name),
        sql.Identifier(table_name),
        sql.SQL(", ").join(sql.Identifier(column) for column in columns),
        conflict,
    )


def connect():
    dsn = os.getenv("IDPAY_POSTGRES_DSN")
    if dsn:
        return psycopg2.connect(dsn)

    connection_parameters = {
        "dbname": os.getenv("PGDATABASE", "idpay-database"),
        "user": os.getenv("PGUSER", "idpaydbadmin"),
        "host": os.getenv(
            "PGHOST",
            "cstar-p-itn-idpay-pgflex.postgres.database.azure.com",
        ),
        "port": os.getenv("PGPORT", "5432"),
        "sslmode": os.getenv("PGSSLMODE", "require"),
    }
    if os.getenv("PGPASSWORD") is not None:
        connection_parameters["password"] = os.environ["PGPASSWORD"]

    return psycopg2.connect(**connection_parameters)


def execute_buffer(cursor, query, buffer, batch_size):
    if buffer:
        extras.execute_values(cursor, query, buffer, page_size=batch_size)


def import_reward_batches(cursor, path, batch_size, query):
    batch_keys = set()
    buffer = []
    count = 0

    for document in iter_documents(path):
        batch_id = source_id(document)
        initiative_id = str(required_value(document, "initiativeId"))
        key = (batch_id, initiative_id)
        if key in batch_keys:
            raise ValueError(f"Duplicate reward batch in source dump: {key}")

        batch_keys.add(key)
        buffer.append(reward_batch_row(document))
        count += 1

        if len(buffer) >= batch_size:
            execute_buffer(cursor, query, buffer, batch_size)
            buffer.clear()

    execute_buffer(cursor, query, buffer, batch_size)
    print(f"Reward batches prepared: {count}")
    return batch_keys


def import_transactions(
    cursor,
    path,
    batch_size,
    payment_query,
    reward_transaction_query=None,
    batch_keys=None,
):
    payment_buffer = []
    reward_transaction_buffer = []
    count = 0
    reward_transaction_count = 0

    for document in iter_documents(path):
        payment_buffer.append(payment_transaction_row(document))

        if reward_transaction_query is not None:
            reward_batch_id = clean_value(document.get("rewardBatchId"))
            initiative_id = transaction_initiative_id(document)
            if reward_batch_id is not None and batch_keys is not None:
                if (str(reward_batch_id), initiative_id) not in batch_keys:
                    raise ValueError(
                        f"Transaction {source_id(document)} references unknown "
                        f"reward batch {(reward_batch_id, initiative_id)}"
                    )

            reward_transaction_buffer.append(reward_transaction_row(document))
            reward_transaction_count += 1

        count += 1

        if len(payment_buffer) >= batch_size:
            execute_buffer(cursor, payment_query, payment_buffer, batch_size)
            payment_buffer.clear()

        if len(reward_transaction_buffer) >= batch_size:
            execute_buffer(
                cursor,
                reward_transaction_query,
                reward_transaction_buffer,
                batch_size,
            )
            reward_transaction_buffer.clear()

    execute_buffer(cursor, payment_query, payment_buffer, batch_size)
    if reward_transaction_query is not None:
        execute_buffer(
            cursor,
            reward_transaction_query,
            reward_transaction_buffer,
            batch_size,
        )

    print(f"Transactions prepared: {count}")
    if reward_transaction_query is not None:
        print(f"Reward transactions prepared: {reward_transaction_count}")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Migrate denormalized Mongo transaction data to PostgreSQL."
    )
    parser.add_argument(
        "--transaction-dump",
        type=Path,
        default=Path("dumpvoucher.json"),
        help="Mongo transaction dump in mongoexport JSON-array format.",
    )
    parser.add_argument(
        "--reward-batch-dump",
        type=Path,
        help=(
            "Mongo rewards_batch dump. When supplied, reward_batches and "
            "reward_transactions are imported as well."
        ),
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Number of rows sent to PostgreSQL per batch (default: {DEFAULT_BATCH_SIZE}).",
    )
    parser.add_argument(
        "--payment-schema",
        default=PAYMENT_SCHEMA,
        help=f"Payment schema (default: {PAYMENT_SCHEMA}).",
    )
    parser.add_argument(
        "--reward-schema",
        default=REWARD_SCHEMA,
        help=f"Reward-batch schema (default: {REWARD_SCHEMA}).",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    if args.batch_size <= 0:
        raise ValueError("--batch-size must be greater than zero")

    payment_query = insert_query(
        args.payment_schema,
        "transaction",
        PAYMENT_COLUMNS,
        conflict_target="id",
    )

    reward_batch_query = None
    reward_transaction_query = None
    if args.reward_batch_dump is not None:
        reward_batch_query = insert_query(
            args.reward_schema,
            "reward_batches",
            REWARD_BATCH_COLUMNS,
            conflict_target="id",
        )
        reward_transaction_query = insert_query(
            args.reward_schema,
            "reward_transactions",
            REWARD_TRANSACTION_COLUMNS,
            conflict_target="transaction_id",
        )

    connection = connect()
    try:
        extras.register_default_jsonb(conn_or_curs=connection)
        cursor = connection.cursor()
        try:
            batch_keys = None
            if args.reward_batch_dump is not None:
                batch_keys = import_reward_batches(
                    cursor,
                    args.reward_batch_dump,
                    args.batch_size,
                    reward_batch_query,
                )

            import_transactions(
                cursor,
                args.transaction_dump,
                args.batch_size,
                payment_query,
                reward_transaction_query,
                batch_keys,
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            cursor.close()
    finally:
        connection.close()

    print("Migration completed successfully.")


if __name__ == "__main__":
    main()
