-- The parts of pg_cron the console's SQL uses, for PGlite (linara dev has the
-- real extension; LINARA schedules its own jobs the same way).
CREATE SCHEMA cron;
CREATE TABLE cron.job (
    jobid BIGSERIAL PRIMARY KEY,
    jobname TEXT,
    schedule TEXT NOT NULL,
    command TEXT NOT NULL
);
CREATE FUNCTION cron.schedule(p_name TEXT, p_schedule TEXT, p_command TEXT) RETURNS BIGINT
LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
    RETURNING jobid
$$;
CREATE FUNCTION cron.unschedule(p_jobid BIGINT) RETURNS BOOLEAN
LANGUAGE sql AS $$
    WITH gone AS (DELETE FROM cron.job WHERE jobid = p_jobid RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM gone)
$$;
