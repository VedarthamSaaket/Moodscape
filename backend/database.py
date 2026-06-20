from typing import Optional

from psycopg2 import pool as pg_pool

from config import DATABASE_URL, logger

_db_pool: Optional[pg_pool.ThreadedConnectionPool] = None

def init_db_pool() -> None:
    global _db_pool
    _db_pool = pg_pool.ThreadedConnectionPool(
        minconn=1,
        maxconn=10,
        dsn=DATABASE_URL,
    )
    logger.info("[STARTUP] DB connection pool initialised ✓")

def get_db_connection():
    try:
        if _db_pool is None:
            logger.error("[DB] Pool not initialised")
            return None
        return _db_pool.getconn()
    except Exception as exc:
        logger.error(f"[DB] Pool.getconn error: {exc}")
        return None

def release_db_connection(conn) -> None:
    if conn and _db_pool:
        try:
            _db_pool.putconn(conn)
        except Exception as exc:
            logger.error(f"[DB] Pool.putconn error: {exc}")

def close_db_pool() -> None:
    global _db_pool
    if _db_pool:
        _db_pool.closeall()
        logger.info("[SHUTDOWN] DB connection pool closed.")
        _db_pool = None