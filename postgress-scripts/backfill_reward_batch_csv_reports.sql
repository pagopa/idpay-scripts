CREATE OR REPLACE PROCEDURE backfill_reward_batch_csv_reports(batch_size integer DEFAULT 500)
LANGUAGE plpgsql
AS $$
DECLARE
v_chunk_size integer := GREATEST(batch_size, 1);
    v_rows integer;
BEGIN
    CREATE TEMP TABLE IF NOT EXISTS tmp_reward_batch_csv_backfill (
        id text PRIMARY KEY,
        initiative_id text NOT NULL,
        merchant_id text,
        business_name text,
        start_date timestamp,
        end_date timestamp,
        approval_date timestamp,
        filename text
    ) ON COMMIT PRESERVE ROWS;

    LOOP
TRUNCATE TABLE tmp_reward_batch_csv_backfill;

INSERT INTO tmp_reward_batch_csv_backfill (
    id,
    initiative_id,
    merchant_id,
    business_name,
    start_date,
    end_date,
    approval_date,
    filename
)
SELECT
    rb.id,
    rb.initiative_id,
    rb.merchant_id,
    rb.business_name,
    rb.start_date,
    rb.end_date,
    rb.approval_date,
    rb.filename
FROM reward_batches rb
WHERE rb.report_id IS NULL
  AND rb.filename IS NOT NULL
  AND btrim(rb.filename) <> ''
  AND rb.start_date IS NOT NULL
  AND rb.end_date IS NOT NULL
  AND rb.approval_date IS NOT NULL
ORDER BY rb.creation_date, rb.id
    FOR UPDATE SKIP LOCKED
            LIMIT v_chunk_size;

GET DIAGNOSTICS v_rows = ROW_COUNT;
EXIT WHEN v_rows = 0;

INSERT INTO reports (
    id,
    initiative_id,
    report_status,
    start_period,
    end_period,
    merchant_id,
    business_name,
    request_date,
    elaboration_date,
    operator_level,
    file_name,
    report_type
)
SELECT
    'reward-batch-csv-' || t.id,
    t.initiative_id,
    'GENERATED',
    t.start_date,
    t.end_date,
    t.merchant_id,
    t.business_name,
    t.approval_date,
    t.approval_date,
    'L3',
    t.filename,
    'REWARD_BATCH_CSV'
FROM tmp_reward_batch_csv_backfill t
    ON CONFLICT (id) DO NOTHING;

UPDATE reward_batches rb
SET report_id = 'reward-batch-csv-' || t.id
    FROM tmp_reward_batch_csv_backfill t
WHERE rb.id = t.id
  AND rb.initiative_id = t.initiative_id
  AND rb.report_id IS NULL;

RAISE NOTICE 'Backfilled % reward_batches in this chunk', v_rows;

COMMIT;
END LOOP;
END;
$$;

CALL backfill_reward_batch_csv_reports(500);