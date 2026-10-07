#!/usr/bin/env python3
"""Import a dump of idpay-pagamenti.reports into idpay-rimborsi.reports.

Python >= 3.9. Dependencies: psycopg2-binary >= 2.8, ijson.

Export (MONGO_URI configured for the Mongo connection):
    mongoexport --uri="$MONGO_URI" --db=idpay-pagamenti --collection=reports \
        --jsonArray --out=dumpreports.json

Enter the host, database, username, and password in the PG_CONFIG block at the
beginning of the file. Then run from the folder containing the script and dump:
    python import_reports.py --reports-dump dumpreports.json --dry-run
    python import_reports.py --reports-dump dumpreports.json

Explicit mapping for the PostgreSQL schema shown in the screenshot. operatorLevel
is optional and becomes NULL when absent. _class is Java metadata and is not
imported. The four timestamps without a time zone are converted to Europe/Rome,
as in the original code. Existing records are skipped with ON CONFLICT (id)
DO NOTHING: id must be PRIMARY KEY or UNIQUE. The schema and this uniqueness
requirement are checked before insertion. A single final commit is performed;
the entire import is rolled back if an error occurs.

--dry-run checks the schema, fields, and conversions without executing INSERT;
it does not check CHECK/FK constraints, triggers, or conflicts with existing data.
"""

import argparse
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo


# POSTGRES CONFIGURATION: enter your connection settings here.
PG_CONFIG = {
    "host": "<REPLACE_HOST_PG>",
    "port": 5432,
    "dbname": "<REPLACE_DB_NAME>",
    "user": "<REPLACE_DB_USER",
    "password": "<REPLACE_DB_PWD",
    "sslmode": "require",
}


ROME = ZoneInfo("Europe/Rome")
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
DEFAULT_BATCH_SIZE = 5000
REWARD_SCHEMA = "idpay-rimborsi"
TABLE = "reports"

REPORT_COLUMNS = (
    "id",
    "initiative_id",
    "report_status",
    "start_period",
    "end_period",
    "merchant_id",
    "business_name",
    "request_date",
    "elaboration_date",
    "operator_level",
    "file_name",
    "report_type",
)
DATE_COLUMNS = {"start_period", "end_period", "request_date", "elaboration_date"}


def parse_mongo_date(value):
    if isinstance(value, dict) and set(value) == {"$date"}:
        value = value["$date"]
    if isinstance(value, dict) and set(value) == {"$numberLong"}:
        value = int(value["$numberLong"])

    if isinstance(value, bool):
        raise TypeError("A boolean is not a Mongo date")
    if isinstance(value, (int, float, Decimal)):
        milliseconds = int(value)
        if value != milliseconds:
            raise ValueError("The Mongo timestamp must contain whole milliseconds")
        parsed = EPOCH + timedelta(milliseconds=milliseconds)
    elif isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    elif isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        raise TypeError(f"Unsupported Mongo date: {type(value).__name__}")

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(ROME)


def clean_timestamp(value):
    if value is None:
        return None
    return parse_mongo_date(value).replace(tzinfo=None)


def source_id(document):
    value = document.get("_id", document.get("id"))
    if isinstance(value, dict) and set(value) == {"$oid"}:
        value = value["$oid"]
    if not isinstance(value, str) or not value.strip():
        raise ValueError("The Mongo document must contain a string/ObjectId _id")
    return value


def required_value(document, field_name):
    value = document.get(field_name)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValueError(f"Report {source_id(document)}: missing {field_name}")
    return value


def text_value(document, field_name, required=False):
    value = required_value(document, field_name) if required else document.get(field_name)
    if value is not None and not isinstance(value, str):
        raise ValueError(f"Report {source_id(document)}: {field_name} must be a string")
    return value


def report_row(document):
    if not isinstance(document, dict):
        raise ValueError("The dump must contain JSON documents")
    return (
        source_id(document),
        text_value(document, "initiativeId", required=True),
        text_value(document, "reportStatus", required=True),
        clean_timestamp(required_value(document, "startPeriod")),
        clean_timestamp(required_value(document, "endPeriod")),
        text_value(document, "merchantId"),
        text_value(document, "businessName"),
        clean_timestamp(required_value(document, "requestDate")),
        clean_timestamp(document.get("elaborationDate")),
        text_value(document, "operatorLevel"),
        text_value(document, "fileName", required=True),
        text_value(document, "reportType", required=True),
    )


def iter_documents(path):
    with path.open("rb") as source:
        first_byte = source.read(1)
        while first_byte and first_byte.isspace():
            first_byte = source.read(1)
        source.seek(0)
        if first_byte == b"[":
            try:
                import ijson
            except ImportError as exc:
                raise RuntimeError("Install ijson: python -m pip install ijson") from exc
            yield from ijson.items(source, "item")
            return
        for line_number, line in enumerate(source, start=1):
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"Invalid JSON at line {line_number}. Use mongoexport, "
                        "not the ISODate() syntax of the Mongo shell."
                    ) from exc


def validate_schema(cursor, schema_name):
    cursor.execute(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        """,
        (schema_name, TABLE),
    )
    column_types = dict(cursor.fetchall())
    if not column_types:
        raise ValueError(f"Table {schema_name}.{TABLE} is missing or not visible")
    for column in REPORT_COLUMNS:
        expected_type = "timestamp without time zone" if column in DATE_COLUMNS else "text"
        if column_types.get(column) != expected_type:
            raise ValueError(
                f"Schema differs from the screenshot: {column} must be {expected_type}, "
                f"found {column_types.get(column, 'missing column')}"
            )

    cursor.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_index i
            JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_catalog.pg_attribute a
              ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
            WHERE n.nspname = %s AND t.relname = %s AND a.attname = 'id'
              AND i.indisunique AND i.indisvalid AND i.indimmediate
              AND i.indnkeyatts = 1 AND i.indpred IS NULL AND i.indexprs IS NULL
        )
        """,
        (schema_name, TABLE),
    )
    if not cursor.fetchone()[0]:
        raise ValueError("reports.id must have a non-deferrable PRIMARY KEY or UNIQUE constraint")


def insert_query(schema_name):
    from psycopg2 import sql

    return sql.SQL(
        "INSERT INTO {}.{} ({}) VALUES %s ON CONFLICT ({}) DO NOTHING RETURNING 1"
    ).format(
        sql.Identifier(schema_name),
        sql.Identifier(TABLE),
        sql.SQL(", ").join(sql.Identifier(column) for column in REPORT_COLUMNS),
        sql.Identifier("id"),
    )


def execute_buffer(cursor, query, buffer):
    if not buffer:
        return 0
    from psycopg2 import extras

    inserted = extras.execute_values(
        cursor, query, buffer, page_size=len(buffer), fetch=True,
    )
    return len(inserted)


def import_reports(connection, path, batch_size=DEFAULT_BATCH_SIZE,
                   schema_name=REWARD_SCHEMA, dry_run=False):
    if batch_size <= 0:
        raise ValueError("--batch-size must be greater than zero")
    cursor = None
    try:
        if dry_run:
            connection.set_session(readonly=True)
        cursor = connection.cursor()
        validate_schema(cursor, schema_name)
        query = None if dry_run else insert_query(schema_name)
        count = inserted_count = 0
        buffer = []
        for document in iter_documents(path):
            count += 1
            try:
                row = report_row(document)
            except (ValueError, TypeError, OverflowError) as exc:
                raise ValueError(f"Invalid document #{count}: {exc}") from exc
            if not dry_run:
                buffer.append(row)
                if len(buffer) >= batch_size:
                    inserted_count += execute_buffer(cursor, query, buffer)
                    buffer.clear()
        if dry_run:
            connection.rollback()
        else:
            inserted_count += execute_buffer(cursor, query, buffer)
            connection.commit()
        return count, inserted_count
    except BaseException:
        connection.rollback()
        raise
    finally:
        if cursor is not None:
            cursor.close()


def connect():
    if PG_CONFIG.get("password") in (None, "", "<REPLACE_DB_PWD>"):
        raise ValueError(
            "Enter the PostgreSQL password in the PG_CONFIG block at the beginning of the file"
        )
    try:
        import psycopg2
    except ImportError as exc:
        raise RuntimeError(
            "Install psycopg2: python -m pip install 'psycopg2-binary>=2.8'"
        ) from exc
    return psycopg2.connect(**PG_CONFIG)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reports-dump", type=Path, default=Path("dumpreports.json"))
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--reward-schema", default=REWARD_SCHEMA)
    parser.add_argument("--dry-run", action="store_true",
                        help="Check the schema and conversions without inserting rows")
    args = parser.parse_args(argv)
    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than zero")
    if not args.reports_dump.is_file():
        parser.error("--reports-dump must point to an existing file")

    connection = connect()
    try:
        count, inserted = import_reports(
            connection, args.reports_dump, args.batch_size, args.reward_schema, args.dry_run,
        )
    finally:
        connection.close()
    if args.dry_run:
        print(f"Validation completed: {count} reports have valid fields and conversions.")
    else:
        print(f"Migration completed: {count} read, {inserted} inserted, "
              f"{count - inserted} not inserted (ON CONFLICT DO NOTHING).")


if __name__ == "__main__":
    main()
