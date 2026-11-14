-- ============================================================================
-- Adi_Hotspot Billing - Database Schema Migration (001_initial_schema.sql)
-- Database Target: PostgreSQL 16+ (Ubuntu Server 24.04 LTS)
-- Database Name: adi_hotspot
-- User: adi_app
-- ============================================================================

-- Pastikan extension uuid-ossp tersedia jika dibutuhkan
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. TABEL: packages (Paket Internet)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS packages (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    speed VARCHAR(64) NOT NULL,
    download_speed VARCHAR(64),
    upload_speed VARCHAR(64),
    price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    duration VARCHAR(32) NOT NULL DEFAULT '1 Bulan',
    type VARCHAR(32) NOT NULL DEFAULT 'pppoe', -- 'pppoe' | 'hotspot'
    supported_connection VARCHAR(32) NOT NULL DEFAULT 'pppoe', -- 'pppoe' | 'hotspot' | 'both'
    status VARCHAR(32) NOT NULL DEFAULT 'active', -- 'active' | 'inactive'
    active_users_count INTEGER NOT NULL DEFAULT 0 CHECK (active_users_count >= 0),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_type ON packages(type);

-- ----------------------------------------------------------------------------
-- 2. TABEL: customers (Data Pelanggan)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    address TEXT NOT NULL,
    installation_address TEXT,
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    package_id VARCHAR(64) NOT NULL REFERENCES packages(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    package_name VARCHAR(128) NOT NULL,
    type VARCHAR(32) NOT NULL DEFAULT 'pppoe', -- 'pppoe' | 'hotspot'
    username VARCHAR(64) NOT NULL UNIQUE,
    ip_address VARCHAR(45),
    status VARCHAR(32) NOT NULL DEFAULT 'active', -- 'active' | 'isolated' | 'inactive'
    registered_at DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date_day INTEGER NOT NULL DEFAULT 10 CHECK (due_date_day >= 1 AND due_date_day <= 31),
    monthly_fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
    installation_date DATE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_type ON customers(type);
CREATE INDEX IF NOT EXISTS idx_customers_package_id ON customers(package_id);
CREATE INDEX IF NOT EXISTS idx_customers_due_date_day ON customers(due_date_day);
CREATE INDEX IF NOT EXISTS idx_customers_is_deleted ON customers(is_deleted);

-- ----------------------------------------------------------------------------
-- 3. TABEL: invoices (Tagihan Bulanan Sederhana)
-- Strategi Finansial Aman: customer_id menggunakan ON DELETE SET NULL
-- sehingga data tagihan dan riwayat keuangan TIDAK hilang saat pelanggan dihapus.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR(64) PRIMARY KEY,
    invoice_number VARCHAR(64) NOT NULL UNIQUE,
    customer_id VARCHAR(64) REFERENCES customers(id) ON UPDATE CASCADE ON DELETE SET NULL,
    customer_name VARCHAR(128) NOT NULL,
    customer_phone VARCHAR(32),
    package_name VARCHAR(128) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (remaining_amount >= 0),
    month_period VARCHAR(64) NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'unpaid', -- 'paid' | 'unpaid' | 'overdue'
    created_at DATE NOT NULL DEFAULT CURRENT_DATE,
    paid_at TIMESTAMP WITH TIME ZONE,
    payment_method VARCHAR(32), -- 'cash' | 'transfer' | 'qris'
    is_prorata BOOLEAN DEFAULT FALSE,
    service_period_start DATE,
    service_period_end DATE,
    prorata_days INTEGER,
    period_total_days INTEGER,
    prorata_calculation_note TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- Validasi konsistensi nominal pembayaran penuh & sebagian
    CONSTRAINT chk_invoice_paid_amount CHECK (paid_amount <= amount),
    CONSTRAINT chk_invoice_remaining_amount CHECK (remaining_amount = amount - paid_amount)
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_month_period ON invoices(month_period);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);

-- ----------------------------------------------------------------------------
-- 4. TABEL: payments (Transaksi Pembayaran & Pembayaran Sebagian)
-- Strategi Finansial Aman: invoice_id menggunakan ON DELETE RESTRICT
-- agar tagihan yang sudah memiliki catatan transaksi pembayaran tidak terhapus sengaja.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(64) PRIMARY KEY,
    transaction_number VARCHAR(64) NOT NULL UNIQUE,
    invoice_id VARCHAR(64) NOT NULL REFERENCES invoices(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    invoice_number VARCHAR(64) NOT NULL,
    customer_id VARCHAR(64) REFERENCES customers(id) ON UPDATE CASCADE ON DELETE SET NULL,
    customer_name VARCHAR(128) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    method VARCHAR(32) NOT NULL DEFAULT 'cash', -- 'cash' | 'transfer' | 'qris'
    notes TEXT,
    paid_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    receipt_number VARCHAR(64),
    receiver_name VARCHAR(128) NOT NULL DEFAULT 'Admin Kasir',
    is_partial BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);
CREATE INDEX IF NOT EXISTS idx_payments_trx_num ON payments(transaction_number);

-- ----------------------------------------------------------------------------
-- 5. TABEL: whatsapp_templates (Template Notifikasi WhatsApp)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id VARCHAR(64) PRIMARY KEY, -- 'new_invoice' | 'due_reminder' | 'overdue_notice' | 'isolation_notice' | 'restoration_notice' | 'payment_confirmation'
    name VARCHAR(128) NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    template_content TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 6. TABEL: whatsapp_logs (Riwayat Pesan Notifikasi WhatsApp)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id VARCHAR(64) PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    customer_name VARCHAR(128) NOT NULL,
    customer_id VARCHAR(64),
    phone VARCHAR(32) NOT NULL,
    notification_type VARCHAR(64) NOT NULL,
    notification_type_name VARCHAR(128) NOT NULL,
    message_content TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
    error_message TEXT,
    reference_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_customer_id ON whatsapp_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_phone ON whatsapp_logs(phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_status ON whatsapp_logs(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_timestamp ON whatsapp_logs(timestamp DESC);

-- ----------------------------------------------------------------------------
-- 7. TABEL: broadcast_campaigns & broadcast_recipients (Riwayat Broadcast WhatsApp)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS broadcast_campaigns (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    type VARCHAR(32) NOT NULL, -- 'outage' | 'maintenance' | 'restoration' | 'announcement'
    type_name VARCHAR(64) NOT NULL,
    message_content TEXT NOT NULL,
    total_recipients INTEGER NOT NULL DEFAULT 0 CHECK (total_recipients >= 0),
    success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_created_at ON broadcast_campaigns(created_at DESC);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
    id BIGSERIAL PRIMARY KEY,
    campaign_id VARCHAR(64) NOT NULL REFERENCES broadcast_campaigns(id) ON UPDATE CASCADE ON DELETE CASCADE,
    customer_id VARCHAR(64),
    customer_name VARCHAR(128) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'sent' | 'failed' | 'pending'
    error_message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_campaign_id ON broadcast_recipients(campaign_id);

-- ----------------------------------------------------------------------------
-- 8. TABEL: app_settings (Pengaturan Operasional & Bisnis Permanen)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(64) PRIMARY KEY,
    setting_value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 9. TABEL: mikrotik_settings (Konfigurasi RouterOS MikroTik RB4011)
-- Kredensial rahasia (password_encrypted) disimpan menggunakan enkripsi AES-256-GCM
-- di server backend, tidak pernah diekspos ke frontend.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mikrotik_settings (
    id VARCHAR(64) PRIMARY KEY DEFAULT 'default',
    router_name VARCHAR(128) NOT NULL DEFAULT 'MikroTik RB4011',
    host VARCHAR(128) NOT NULL DEFAULT '192.168.88.1',
    api_port INTEGER NOT NULL DEFAULT 8728 CHECK (api_port > 0 AND api_port <= 65535),
    username VARCHAR(64) NOT NULL DEFAULT 'admin',
    password_encrypted TEXT, -- Enkripsi reversible AES-256-GCM via MIKROTIK_ENCRYPTION_KEY
    password_hash TEXT,      -- Kompatibilitas mundur
    status VARCHAR(32) NOT NULL DEFAULT 'disconnected', -- 'connected' | 'disconnected' | 'testing'
    model_target VARCHAR(64) NOT NULL DEFAULT 'RB4011iGS+RM',
    ros_version_preview VARCHAR(32) DEFAULT 'RouterOS v7.x',
    use_ssl BOOLEAN NOT NULL DEFAULT FALSE,
    timeout_seconds INTEGER NOT NULL DEFAULT 10,
    notes TEXT,
    last_tested_at TIMESTAMP WITH TIME ZONE,
    last_status_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 10. TRIGGER: MENCEGAH TOTAL PEMBAYARAN MELEBIHI INVOICE.AMOUNT
--    1. Mengunci baris invoice dengan SELECT ... FOR UPDATE sebelum menghitung total pembayaran.
--    2. Mencegah deadlock saat UPDATE invoice_id dengan urutan penguncian konsisten (alfabetis).
--    3. Menghindari penghitungan ganda pada saat UPDATE pembayaran (mengecualikan OLD.id).
--    4. Menjamin total seluruh transaksi payments tidak pernah melebihi invoices.amount.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_invoice_payment_total()
RETURNS TRIGGER AS $$
DECLARE
    v_invoice_amount NUMERIC(12, 2);
    v_existing_paid NUMERIC(12, 2);
    v_new_total_paid NUMERIC(12, 2);
BEGIN
    IF NEW.amount <= 0 THEN
        RAISE EXCEPTION 'Nominal pembayaran harus lebih besar dari 0 (Diterima: Rp %).', NEW.amount;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
        IF OLD.invoice_id < NEW.invoice_id THEN
            PERFORM 1 FROM invoices WHERE id = OLD.invoice_id FOR UPDATE;
            SELECT amount INTO v_invoice_amount FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
        ELSE
            SELECT amount INTO v_invoice_amount FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
            PERFORM 1 FROM invoices WHERE id = OLD.invoice_id FOR UPDATE;
        END IF;
    ELSE
        SELECT amount INTO v_invoice_amount 
        FROM invoices 
        WHERE id = NEW.invoice_id 
        FOR UPDATE;
    END IF;

    IF v_invoice_amount IS NULL THEN
        RAISE EXCEPTION 'Tagihan (invoice) dengan ID % tidak ditemukan.', NEW.invoice_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_existing_paid
        FROM payments
        WHERE invoice_id = NEW.invoice_id
          AND id != OLD.id;
    ELSE
        SELECT COALESCE(SUM(amount), 0) INTO v_existing_paid
        FROM payments
        WHERE invoice_id = NEW.invoice_id;
    END IF;

    v_new_total_paid := v_existing_paid + NEW.amount;

    IF v_new_total_paid > v_invoice_amount THEN
        RAISE EXCEPTION 'Total pembayaran (Rp %) melebihi nominal tagihan (Rp %). Transaksi ditolak.',
            v_new_total_paid, v_invoice_amount;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_invoice_payment_total ON payments;
CREATE TRIGGER trg_check_invoice_payment_total
BEFORE INSERT OR UPDATE OF amount, invoice_id ON payments
FOR EACH ROW
EXECUTE FUNCTION check_invoice_payment_total();


