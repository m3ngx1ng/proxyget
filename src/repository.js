import { nowIso } from './utils.js';

function mapProxyRow(row) {
  return {
    protocol: row.protocol,
    ip: row.ip,
    port: row.port,
    source: row.source,
    validated: Boolean(row.validated),
    validation_mode: row.validation_mode,
    score: Number(row.score),
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    last_checked_at: row.last_checked_at,
    consecutive_failures: row.consecutive_failures,
    total_validations: row.total_validations,
    successful_validations: row.successful_validations,
  };
}

export async function ensureFetchers(db, fetchers) {
  for (const fetcher of fetchers) {
    await db
      .prepare(`INSERT INTO fetchers (name, enabled, last_count, total_count)
                VALUES (?, 1, 0, 0)
                ON CONFLICT(name) DO NOTHING`)
      .bind(fetcher.name)
      .run();
  }
}

export async function setFetcherEnabled(db, fetcherName, enabled) {
  await db
    .prepare('UPDATE fetchers SET enabled = ? WHERE name = ?')
    .bind(enabled ? 1 : 0, fetcherName)
    .run();
}

export async function clearFetcherStats(db) {
  await db
    .prepare('UPDATE fetchers SET last_run_at = NULL, last_success_at = NULL, last_error = NULL, last_count = 0, total_count = 0')
    .run();
}

export async function upsertProxies(db, fetcherName, proxies, validationMode) {
  const now = nowIso();
  let inserted = 0;

  for (const proxy of proxies) {
    const existing = await db
      .prepare('SELECT protocol FROM proxies WHERE protocol = ? AND ip = ? AND port = ?')
      .bind(proxy.protocol, proxy.ip, proxy.port)
      .first();

    if (existing) {
      await db
        .prepare(`UPDATE proxies
                  SET source = ?,
                      validated = 1,
                      validation_mode = ?,
                      score = MIN(score + 0.02, 1.0),
                      last_seen_at = ?,
                      last_checked_at = ?,
                      total_validations = total_validations + 1,
                      successful_validations = successful_validations + 1,
                      consecutive_failures = 0
                  WHERE protocol = ? AND ip = ? AND port = ?`)
        .bind(fetcherName, validationMode, now, now, proxy.protocol, proxy.ip, proxy.port)
        .run();
      continue;
    }

    inserted += 1;
    await db
      .prepare(`INSERT INTO proxies (
                  protocol, ip, port, source, validated, validation_mode, score,
                  first_seen_at, last_seen_at, last_checked_at,
                  consecutive_failures, total_validations, successful_validations
                ) VALUES (?, ?, ?, ?, 1, ?, 0.6, ?, ?, ?, 0, 1, 1)`)
      .bind(proxy.protocol, proxy.ip, proxy.port, fetcherName, validationMode, now, now, now)
      .run();
  }

  return inserted;
}

export async function markFetcherRun(db, fetcherName, count, success, errorMessage = null) {
  const now = nowIso();
  await db
    .prepare(`UPDATE fetchers
              SET last_run_at = ?,
                  last_success_at = CASE WHEN ? = 1 THEN ? ELSE last_success_at END,
                  last_error = ?,
                  last_count = ?,
                  total_count = total_count + ?
              WHERE name = ?`)
    .bind(now, success ? 1 : 0, now, errorMessage, count, count, fetcherName)
    .run();

  await db
    .prepare(`INSERT INTO runs (fetcher_name, started_at, finished_at, success, fetched_count, error)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(fetcherName, now, now, success ? 1 : 0, count, errorMessage)
    .run();
}

export async function getProxyByProtocol(db, protocol, limit, validatedOnly = true) {
  const validatedClause = validatedOnly ? 'AND validated = 1' : '';
  const sql = limit > 0
    ? `SELECT * FROM proxies WHERE protocol = ? ${validatedClause} ORDER BY score DESC, last_seen_at DESC LIMIT ?`
    : `SELECT * FROM proxies WHERE protocol = ? ${validatedClause} ORDER BY score DESC, last_seen_at DESC`;
  const statement = db.prepare(sql);
  const result = limit > 0 ? await statement.bind(protocol, limit).all() : await statement.bind(protocol).all();
  return result.results.map(mapProxyRow);
}

export async function getAllByProtocol(db, protocol) {
  const result = await db
    .prepare('SELECT * FROM proxies WHERE protocol = ? ORDER BY score DESC, last_seen_at DESC')
    .bind(protocol)
    .all();
  return result.results.map(mapProxyRow);
}

export async function getAllProxies(db, limit = -1) {
  const sql = limit > 0
    ? 'SELECT * FROM proxies ORDER BY score DESC, last_seen_at DESC LIMIT ?'
    : 'SELECT * FROM proxies ORDER BY score DESC, last_seen_at DESC';
  const statement = db.prepare(sql);
  const result = limit > 0 ? await statement.bind(limit).all() : await statement.all();
  return result.results.map(mapProxyRow);
}

export async function getRandomValidated(db, limit = 1) {
  const sql = limit > 0
    ? 'SELECT * FROM proxies WHERE validated = 1 ORDER BY RANDOM() LIMIT ?'
    : 'SELECT * FROM proxies WHERE validated = 1 ORDER BY RANDOM()';
  const statement = db.prepare(sql);
  const result = limit > 0 ? await statement.bind(limit).all() : await statement.all();
  return result.results.map(mapProxyRow);
}

export async function getProxyStatus(db) {
  const total = await db.prepare('SELECT COUNT(*) AS count FROM proxies').first();
  const validated = await db.prepare('SELECT COUNT(*) AS count FROM proxies WHERE validated = 1').first();
  const highScore = await db.prepare('SELECT COUNT(*) AS count FROM proxies WHERE score >= 0.7').first();
  const recent = await db.prepare('SELECT COUNT(*) AS count FROM proxies WHERE last_seen_at >= datetime("now", "-1 day")').first();

  return {
    sum_proxies_cnt: total?.count || 0,
    validated_proxies_cnt: validated?.count || 0,
    pending_proxies_cnt: 0,
    high_score_cnt: highScore?.count || 0,
    fresh_proxies_cnt: recent?.count || 0,
    avg_latency: 0,
  };
}

export async function getFetcherStatus(db) {
  const result = await db.prepare(`
    SELECT
      f.*,
      COALESCE(SUM(CASE WHEN p.validated = 1 THEN 1 ELSE 0 END), 0) AS validated_cnt,
      COALESCE(COUNT(p.protocol), 0) AS in_db_cnt
    FROM fetchers f
    LEFT JOIN proxies p ON p.source = f.name
    GROUP BY f.name
    ORDER BY f.name ASC
  `).all();
  return result.results;
}

export async function clearProxies(db, protocol = 'all') {
  if (protocol === 'all') {
    const result = await db.prepare('DELETE FROM proxies').run();
    return result.meta.changes || 0;
  }

  const result = await db.prepare('DELETE FROM proxies WHERE protocol = ?').bind(protocol).run();
  return result.meta.changes || 0;
}

export async function exportProxies(db, protocol = 'all', validatedOnly = true) {
  const clauses = [];
  const bindings = [];

  if (protocol !== 'all') {
    clauses.push('protocol = ?');
    bindings.push(protocol);
  }

  if (validatedOnly) {
    clauses.push('validated = 1');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await db.prepare(`SELECT * FROM proxies ${where} ORDER BY score DESC, last_seen_at DESC`).bind(...bindings).all();
  return result.results.map(mapProxyRow);
}
