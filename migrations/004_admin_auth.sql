-- ============================================================================
-- Adi_Hotspot Billing - Database Schema Migration (004_admin_auth.sql)
-- Tujuan: Menyimpan session admin server-side & pembatasan percobaan login
--         secara persisten di PostgreSQL tanpa mengubah tabel yang sudah ada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABEL: admin_sessions (Server-Side Session Store PostgreSQL)
--    sid_hash menyimpan SHA-256 hex dari session ID sehingga ID mentah tidak
--    tersimpan langsung di database.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_sessions (
    sid_hash VARCHAR(64) PRIMARY KEY,
    sess JSONB NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at
    ON admin_sessions(expires_at);

-- ----------------------------------------------------------------------------
-- 2. TABEL: admin_login_attempts (Rate Limiter Login Persisten)
--    Menyimpan penghitung percobaan gagal berbasis IP dengan cooldown
--    sementara (bukan penguncian akun permanen).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_login_attempts (
    rate_key VARCHAR(128) PRIMARY KEY,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    window_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_until TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_updated_at
    ON admin_login_attempts(updated_at);
