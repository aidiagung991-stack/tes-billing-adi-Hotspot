-- ============================================================================
-- Migrasi 003: Dukungan Akun Operasional MikroTik PPPoE & Hotspot
-- Idempotent: Menggunakan IF NOT EXISTS sehingga aman dijalankan
-- Dilarang menjalankan migrasi ini secara otomatis sebelum persetujuan pengguna.
-- ============================================================================

-- 1. Penambahan kolom kredensial terenkripsi & status sinkronisasi pada tabel customers
ALTER TABLE customers 
    ADD COLUMN IF NOT EXISTS password_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS router_sync_status VARCHAR(32) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS router_last_sync_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS router_last_sync_message TEXT;

-- 2. Penambahan pemetaan profile spesifik pada tabel packages
ALTER TABLE packages
    ADD COLUMN IF NOT EXISTS pppoe_profile VARCHAR(128),
    ADD COLUMN IF NOT EXISTS hotspot_profile VARCHAR(128);

-- 3. Index performa untuk filter status sinkronisasi
CREATE INDEX IF NOT EXISTS idx_customers_router_sync_status ON customers(router_sync_status);
