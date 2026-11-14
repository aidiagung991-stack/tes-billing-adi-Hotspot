-- ============================================================================
-- Adi_Hotspot Billing - Migration 002: Update Schema
-- File: migrations/002_update_schema.sql
-- Target: PostgreSQL 16+ (Ubuntu Server 24.04 LTS)
-- 
-- PRINSIP PENTING:
-- 1. Idempoten: Aman dijalankan berulang kali tanpa merusak data atau tabel yang ada.
-- 2. Keamanan Finansial:
--    - Mencegah hilangnya riwayat invoice saat pelanggan dihapus (ON DELETE SET NULL).
--    - Mencegah penghapusan invoice yang sudah memiliki transaksi pembayaran (ON DELETE RESTRICT).
--    - Validasi database: Total seluruh pembayaran per invoice tidak boleh melebihi invoice.amount.
-- 3. Kredensial MikroTik:
--    - Menyediakan kolom password_encrypted untuk enkripsi reversible AES-256-GCM.
-- 4. Perlindungan Tabel:
--    - TIDAK menyentuh atau menghapus tabel lain seperti test_koneksi.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PELANGGAN (CUSTOMERS): Tambah kolom is_deleted dan deleted_at (Soft Delete)
--    Pemeriksaan IF NOT EXISTS dibuat terpisah untuk setiap kolom pada schema saat ini.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- 1a. Periksa dan tambahkan kolom is_deleted secara terpisah
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = current_schema() 
          AND table_name = 'customers' 
          AND column_name = 'is_deleted'
    ) THEN
        ALTER TABLE customers ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    -- 1b. Periksa dan tambahkan kolom deleted_at secara terpisah
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = current_schema() 
          AND table_name = 'customers' 
          AND column_name = 'deleted_at'
    ) THEN
        ALTER TABLE customers ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- 1c. Buat indeks untuk filter status penghapusan
    CREATE INDEX IF NOT EXISTS idx_customers_is_deleted ON customers(is_deleted);
END $$;

-- ----------------------------------------------------------------------------
-- 2. TAGIHAN (INVOICES): Lepaskan NOT NULL & Pasang FK ON DELETE SET NULL
--    Aman dijalankan berulang kali tanpa menghasilkan constraint ganda.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Pastikan kolom customer_id boleh bernilai NULL
    ALTER TABLE invoices ALTER COLUMN customer_id DROP NOT NULL;

    -- Cari dan bersihkan seluruh constraint foreign key pada kolom customer_id di tabel invoices
    -- yang benar-benar merujuk ke tabel customers pada schema yang sama (current_schema())
    FOR r IN (
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.constraint_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = current_schema()
          AND tc.table_name = 'invoices'
          AND kcu.column_name = 'customer_id'
          AND ccu.table_schema = current_schema()
          AND ccu.table_name = 'customers'
    ) LOOP
        EXECUTE 'ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
    END LOOP;

    -- Pasang constraint foreign key tunggal yang benar dengan aturan ON DELETE SET NULL
    ALTER TABLE invoices 
        ADD CONSTRAINT fk_invoices_customer_id 
        FOREIGN KEY (customer_id) 
        REFERENCES customers(id) 
        ON UPDATE CASCADE 
        ON DELETE SET NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 3. PEMBAYARAN (PAYMENTS): Pasang FK invoice_id dengan ON DELETE RESTRICT
--    Aman dijalankan berulang kali tanpa menghasilkan constraint ganda.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Cari dan bersihkan seluruh constraint foreign key pada kolom invoice_id di tabel payments
    -- yang benar-benar merujuk ke tabel invoices pada schema yang sama (current_schema())
    FOR r IN (
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.constraint_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = current_schema()
          AND tc.table_name = 'payments'
          AND kcu.column_name = 'invoice_id'
          AND ccu.table_schema = current_schema()
          AND ccu.table_name = 'invoices'
    ) LOOP
        EXECUTE 'ALTER TABLE payments DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
    END LOOP;

    -- Pasang constraint foreign key tunggal yang benar dengan aturan ON DELETE RESTRICT
    ALTER TABLE payments 
        ADD CONSTRAINT fk_payments_invoice_id 
        FOREIGN KEY (invoice_id) 
        REFERENCES invoices(id) 
        ON UPDATE CASCADE 
        ON DELETE RESTRICT;
END $$;

-- ----------------------------------------------------------------------------
-- 4. VALIDASI KONSISTENSI NOMINAL PADA INVOICES & PAYMENTS
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_invoice_paid_amount' 
          AND conrelid = 'invoices'::regclass
    ) THEN
        ALTER TABLE invoices 
            ADD CONSTRAINT chk_invoice_paid_amount 
            CHECK (paid_amount <= amount);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_invoice_remaining_amount' 
          AND conrelid = 'invoices'::regclass
    ) THEN
        ALTER TABLE invoices 
            ADD CONSTRAINT chk_invoice_remaining_amount 
            CHECK (remaining_amount = amount - paid_amount);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_payment_amount' 
          AND conrelid = 'payments'::regclass
    ) THEN
        ALTER TABLE payments
            ADD CONSTRAINT chk_payment_amount
            CHECK (amount > 0);
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. TRIGGER DATABASE: MENCEGAH TOTAL PEMBAYARAN MELEBIHI INVOICE.AMOUNT
--    Menjamin validasi di level mesin database terhadap race condition / pembayaran ganda
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
    -- Validasi nilai nominal pembayaran positif
    IF NEW.amount <= 0 THEN
        RAISE EXCEPTION 'Nominal pembayaran harus lebih besar dari 0 (Diterima: Rp %).', NEW.amount;
    END IF;

    -- 1. Penguncian baris invoice dengan FOR UPDATE & Pencegahan Deadlock
    -- Jika operasi adalah UPDATE dan invoice_id berpindah, kunci kedua invoice (lama dan baru)
    -- dalam urutan ID yang konsisten (alfabetis) untuk mencegah deadlock antar-transaksi konkruen.
    IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
        IF OLD.invoice_id < NEW.invoice_id THEN
            -- Kunci invoice lama terlebih dahulu
            PERFORM 1 FROM invoices WHERE id = OLD.invoice_id FOR UPDATE;
            -- Kunci dan ambil nominal invoice baru
            SELECT amount INTO v_invoice_amount FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
        ELSE
            -- Kunci dan ambil nominal invoice baru terlebih dahulu
            SELECT amount INTO v_invoice_amount FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
            -- Kunci invoice lama
            PERFORM 1 FROM invoices WHERE id = OLD.invoice_id FOR UPDATE;
        END IF;
    ELSE
        -- Operasi INSERT atau UPDATE dengan invoice_id yang tetap:
        -- Kunci baris invoice target secara eksklusif (FOR UPDATE)
        SELECT amount INTO v_invoice_amount 
        FROM invoices 
        WHERE id = NEW.invoice_id 
        FOR UPDATE;
    END IF;

    -- Pastikan invoice target ditemukan
    IF v_invoice_amount IS NULL THEN
        RAISE EXCEPTION 'Tagihan (invoice) dengan ID % tidak ditemukan.', NEW.invoice_id;
    END IF;

    -- 2. Hitung akumulasi pembayaran yang sudah tercatat di database untuk invoice ini.
    -- Pada operasi UPDATE, kecualikan baris pembayaran yang sedang diperbarui (OLD.id)
    -- agar nominalnya tidak dihitung dua kali.
    IF TG_OP = 'UPDATE' THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_existing_paid
        FROM payments
        WHERE invoice_id = NEW.invoice_id
          AND id != OLD.id;
    ELSE
        -- Operasi INSERT
        SELECT COALESCE(SUM(amount), 0) INTO v_existing_paid
        FROM payments
        WHERE invoice_id = NEW.invoice_id;
    END IF;

    v_new_total_paid := v_existing_paid + NEW.amount;

    -- 3. Validasi ketat: Total pembayaran tidak boleh melebihi nilai tagihan (invoices.amount)
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

-- ----------------------------------------------------------------------------
-- 5b. TRIGGER DATABASE: MENCEGAH PENURUNAN INVOICE.AMOUNT DI BAWAH TOTAL PEMBAYARAN
--     Menjamin integritas finansial: Nominal tagihan tidak dapat diubah menjadi
--     lebih kecil dari total pembayaran yang sudah pernah tercatat.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_invoice_amount_not_below_payments()
RETURNS TRIGGER AS $$
DECLARE
    v_total_paid NUMERIC(12, 2);
BEGIN
    -- Validasi nilai nominal tagihan tidak boleh negatif
    IF NEW.amount < 0 THEN
        RAISE EXCEPTION 'Nominal tagihan tidak boleh bernilai negatif (Diterima: Rp %).', NEW.amount;
    END IF;

    -- Penguncian baris payments untuk invoice ini demi mencegah race condition
    -- jika terjadi transaksi pembayaran konkuren. Baris invoice NEW sendiri sudah
    -- dikunci secara eksklusif oleh PostgreSQL selama proses UPDATE invoices.
    PERFORM 1 
    FROM payments 
    WHERE invoice_id = NEW.id 
    FOR UPDATE;

    -- Hitung total seluruh pembayaran yang sudah tercatat untuk invoice ini
    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM payments
    WHERE invoice_id = NEW.id;

    -- Validasi finansial: Nominal tagihan baru tidak boleh lebih kecil dari total pembayaran
    IF NEW.amount < v_total_paid THEN
        RAISE EXCEPTION 'Gagal memperbarui tagihan: Nominal tagihan baru (Rp %) tidak boleh lebih kecil dari total pembayaran yang sudah tercatat (Rp %).',
            NEW.amount, v_total_paid;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_invoice_amount_not_below_payments ON invoices;
CREATE TRIGGER trg_check_invoice_amount_not_below_payments
BEFORE UPDATE OF amount ON invoices
FOR EACH ROW
EXECUTE FUNCTION check_invoice_amount_not_below_payments();



-- ----------------------------------------------------------------------------
-- 6. TABEL MIKROTIK SETTINGS: Konfigurasi RouterOS RB4011 dengan Password Terenkripsi
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mikrotik_settings (
    id VARCHAR(64) PRIMARY KEY DEFAULT 'default',
    router_name VARCHAR(128) NOT NULL DEFAULT 'MikroTik RB4011',
    host VARCHAR(128) NOT NULL DEFAULT '192.168.88.1',
    api_port INTEGER NOT NULL DEFAULT 8728 CHECK (api_port > 0 AND api_port <= 65535),
    username VARCHAR(64) NOT NULL DEFAULT 'admin',
    password_encrypted TEXT, -- Enkripsi reversible AES-256-GCM (MIKROTIK_ENCRYPTION_KEY)
    password_hash TEXT,      -- Kompatibilitas mundur
    status VARCHAR(32) NOT NULL DEFAULT 'disconnected',
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

-- Pastikan kolom password_encrypted ada jika tabel mikrotik_settings sudah pernah dibuat sebelumnya
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = current_schema() 
          AND table_name = 'mikrotik_settings' 
          AND column_name = 'password_encrypted'
    ) THEN
        ALTER TABLE mikrotik_settings ADD COLUMN password_encrypted TEXT;
    END IF;
END $$;
