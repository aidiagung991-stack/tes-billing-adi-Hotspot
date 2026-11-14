import { Router, Request, Response } from 'express';
import { query, withTransaction, checkDatabaseHealth, isDatabaseConfigured } from './db.js';
import { encryptMikrotikPassword } from './cryptoUtils.js';

const router = Router();

// ============================================================================
// 1. HEALTHCHECK & DATABASE STATUS
// ============================================================================
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const health = await checkDatabaseHealth();
    res.json({
      success: true,
      ...health,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      isConnected: false,
      error: error?.message || 'Database connection error',
    });
  }
});

// Middleware guard: Jika database belum dikonfigurasi di server ini,
// jangan jalankan query dan kembalikan respon aman agar tidak menimbulkan query error di console.
router.use((req, res, next) => {
  if (!isDatabaseConfigured()) {
    return res.json({
      success: false,
      notConfigured: true,
      data: [],
      message: 'Database PostgreSQL belum dikonfigurasi (.env DB_PASSWORD kosong).',
    });
  }
  next();
});

// ============================================================================
// 2. PAKET INTERNET (CRUD)
// ============================================================================
router.get('/packages', async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        id, 
        code, 
        name, 
        speed, 
        download_speed AS "downloadSpeed", 
        upload_speed AS "uploadSpeed", 
        price::float AS price, 
        duration, 
        type, 
        supported_connection AS "supportedConnection", 
        status, 
        active_users_count AS "activeUsersCount", 
        description,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM packages 
      ORDER BY price ASC, name ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data paket dari PostgreSQL: ' + error.message });
  }
});

router.post('/packages', async (req: Request, res: Response) => {
  try {
    const p = req.body;
    if (!p.id || !p.name || p.price === undefined) {
      return res.status(400).json({ success: false, message: 'Field id, nama paket, dan tarif harga wajib diisi.' });
    }

    const result = await query(
      `
      INSERT INTO packages (
        id, code, name, speed, download_speed, upload_speed, price, duration,
        type, supported_connection, status, active_users_count, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        code = EXCLUDED.code,
        name = EXCLUDED.name,
        speed = EXCLUDED.speed,
        download_speed = EXCLUDED.download_speed,
        upload_speed = EXCLUDED.upload_speed,
        price = EXCLUDED.price,
        duration = EXCLUDED.duration,
        type = EXCLUDED.type,
        supported_connection = EXCLUDED.supported_connection,
        status = EXCLUDED.status,
        description = EXCLUDED.description,
        updated_at = CURRENT_TIMESTAMP
      RETURNING 
        id, code, name, speed, download_speed AS "downloadSpeed", upload_speed AS "uploadSpeed",
        price::float AS price, duration, type, supported_connection AS "supportedConnection",
        status, active_users_count AS "activeUsersCount", description
      `,
      [
        p.id,
        p.code || `PKT-${Date.now().toString().slice(-4)}`,
        p.name,
        p.speed || '10 Mbps',
        p.downloadSpeed || p.speed || '10 Mbps',
        p.uploadSpeed || '5 Mbps',
        Number(p.price) || 0,
        p.duration || '1 Bulan',
        p.type || 'pppoe',
        p.supportedConnection || 'pppoe',
        p.status || 'active',
        Number(p.activeUsersCount) || 0,
        p.description || '',
      ]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(500).json({ success: false, message: 'Gagal menyimpan paket: database tidak mengembalikan data.' });
    }

    res.json({ success: true, message: 'Paket berhasil disimpan ke PostgreSQL.', data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan paket ke database: ' + error.message });
  }
});

router.put('/packages/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const p = req.body;

    const result = await query(
      `
      UPDATE packages SET
        code = COALESCE($1, code),
        name = COALESCE($2, name),
        speed = COALESCE($3, speed),
        download_speed = COALESCE($4, download_speed),
        upload_speed = COALESCE($5, upload_speed),
        price = COALESCE($6, price),
        duration = COALESCE($7, duration),
        type = COALESCE($8, type),
        supported_connection = COALESCE($9, supported_connection),
        status = COALESCE($10, status),
        description = COALESCE($11, description),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $12
      RETURNING 
        id, code, name, speed, download_speed AS "downloadSpeed", upload_speed AS "uploadSpeed",
        price::float AS price, duration, type, supported_connection AS "supportedConnection",
        status, active_users_count AS "activeUsersCount", description
      `,
      [
        p.code,
        p.name,
        p.speed,
        p.downloadSpeed,
        p.uploadSpeed,
        p.price !== undefined ? Number(p.price) : null,
        p.duration,
        p.type,
        p.supportedConnection,
        p.status,
        p.description,
        id,
      ]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Paket internet tidak ditemukan.' });
    }

    res.json({ success: true, message: 'Paket berhasil diperbarui di PostgreSQL.', data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui paket: ' + error.message });
  }
});

router.delete('/packages/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Periksa apakah paket masih digunakan oleh pelanggan
    const custCheck = await query('SELECT COUNT(*) AS count FROM customers WHERE package_id = $1', [id]);
    if (parseInt(custCheck.rows[0].count, 10) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat menghapus paket karena masih digunakan oleh pelanggan aktif.',
      });
    }

    await query('DELETE FROM packages WHERE id = $1', [id]);
    res.json({ success: true, message: 'Paket berhasil dihapus dari database.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menghapus paket: ' + error.message });
  }
});

// ============================================================================
// 3. DATA PELANGGAN (CRUD)
// ============================================================================
router.get('/customers', async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        c.id, 
        c.name, 
        c.phone, 
        c.address, 
        c.installation_address AS "installationAddress", 
        c.latitude::float AS latitude, 
        c.longitude::float AS longitude, 
        c.package_id AS "packageId", 
        c.package_name AS "packageName", 
        c.type, 
        c.username, 
        c.ip_address AS "ipAddress", 
        c.status, 
        c.registered_at::text AS "registeredAt", 
        c.due_date_day AS "dueDateDay", 
        c.monthly_fee::float AS "monthlyFee", 
        c.installation_date::text AS "installationDate",
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt"
      FROM customers c
      WHERE c.is_deleted IS NOT TRUE
      ORDER BY c.name ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil pelanggan dari PostgreSQL: ' + error.message });
  }
});

router.post('/customers', async (req: Request, res: Response) => {
  try {
    const c = req.body;
    if (!c.id || !c.name || !c.phone || !c.packageId) {
      return res.status(400).json({ success: false, message: 'ID, nama, nomor telepon, dan paket wajib diisi.' });
    }

    const result = await query(
      `
      INSERT INTO customers (
        id, name, phone, address, installation_address, latitude, longitude,
        package_id, package_name, type, username, ip_address, status,
        registered_at, due_date_day, monthly_fee, installation_date, is_deleted
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, FALSE)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        installation_address = EXCLUDED.installation_address,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        package_id = EXCLUDED.package_id,
        package_name = EXCLUDED.package_name,
        type = EXCLUDED.type,
        username = EXCLUDED.username,
        ip_address = EXCLUDED.ip_address,
        status = EXCLUDED.status,
        due_date_day = EXCLUDED.due_date_day,
        monthly_fee = EXCLUDED.monthly_fee,
        installation_date = EXCLUDED.installation_date,
        is_deleted = FALSE,
        deleted_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      RETURNING 
        id, name, phone, address, installation_address AS "installationAddress",
        latitude::float AS latitude, longitude::float AS longitude,
        package_id AS "packageId", package_name AS "packageName", type, username,
        ip_address AS "ipAddress", status, registered_at::text AS "registeredAt",
        due_date_day AS "dueDateDay", monthly_fee::float AS "monthlyFee",
        installation_date::text AS "installationDate"
      `,
      [
        c.id,
        c.name,
        c.phone,
        c.address || '',
        c.installationAddress || c.address || '',
        c.latitude ? Number(c.latitude) : null,
        c.longitude ? Number(c.longitude) : null,
        c.packageId,
        c.packageName || 'Paket Internet',
        c.type || 'pppoe',
        c.username || c.id.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        c.ipAddress || null,
        c.status || 'active',
        c.registeredAt || new Date().toISOString().split('T')[0],
        Number(c.dueDateDay) || 10,
        Number(c.monthlyFee) || 0,
        c.installationDate || null,
      ]
    );

    // Update jumlah pelanggan aktif pada paket
    await query(`
      UPDATE packages p
      SET active_users_count = (
        SELECT COUNT(*) FROM customers WHERE package_id = p.id AND status = 'active' AND is_deleted IS NOT TRUE
      )
      WHERE p.id = $1
    `, [c.packageId]);

    if (!result.rows || result.rows.length === 0) {
      return res.status(500).json({ success: false, message: 'Gagal menyimpan pelanggan: database tidak mengembalikan data.' });
    }

    res.json({ success: true, message: 'Data pelanggan berhasil disimpan ke PostgreSQL.', data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan pelanggan ke database: ' + error.message });
  }
});

router.put('/customers/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const c = req.body;

    const result = await query(
      `
      UPDATE customers SET
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        address = COALESCE($3, address),
        installation_address = COALESCE($4, installation_address),
        latitude = COALESCE($5, latitude),
        longitude = COALESCE($6, longitude),
        package_id = COALESCE($7, package_id),
        package_name = COALESCE($8, package_name),
        type = COALESCE($9, type),
        username = COALESCE($10, username),
        ip_address = COALESCE($11, ip_address),
        status = COALESCE($12, status),
        due_date_day = COALESCE($13, due_date_day),
        monthly_fee = COALESCE($14, monthly_fee),
        installation_date = COALESCE($15, installation_date),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $16
      RETURNING 
        id, name, phone, address, installation_address AS "installationAddress",
        latitude::float AS latitude, longitude::float AS longitude,
        package_id AS "packageId", package_name AS "packageName", type, username,
        ip_address AS "ipAddress", status, registered_at::text AS "registeredAt",
        due_date_day AS "dueDateDay", monthly_fee::float AS "monthlyFee",
        installation_date::text AS "installationDate"
      `,
      [
        c.name,
        c.phone,
        c.address,
        c.installationAddress,
        c.latitude !== undefined ? Number(c.latitude) : null,
        c.longitude !== undefined ? Number(c.longitude) : null,
        c.packageId,
        c.packageName,
        c.type,
        c.username,
        c.ipAddress,
        c.status,
        c.dueDateDay ? Number(c.dueDateDay) : null,
        c.monthlyFee !== undefined ? Number(c.monthlyFee) : null,
        c.installationDate,
        id,
      ]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan.' });
    }

    res.json({ success: true, message: 'Data pelanggan berhasil diperbarui di PostgreSQL.', data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui data pelanggan: ' + error.message });
  }
});

router.patch('/customers/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['active', 'isolated', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status tidak valid.' });
    }

    const result = await query(
      `
      UPDATE customers 
      SET status = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $2
      RETURNING 
        id, name, phone, address, installation_address AS "installationAddress",
        latitude::float AS latitude, longitude::float AS longitude,
        package_id AS "packageId", package_name AS "packageName", type, username,
        ip_address AS "ipAddress", status, registered_at::text AS "registeredAt",
        due_date_day AS "dueDateDay", monthly_fee::float AS "monthlyFee",
        installation_date::text AS "installationDate"
      `,
      [status, id]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan.' });
    }

    res.json({ success: true, message: `Status pelanggan berhasil diubah menjadi ${status}.`, data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengubah status pelanggan: ' + error.message });
  }
});

router.delete('/customers/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Strategi pengamanan data keuangan:
    // 1. Lepaskan relasi customer_id pada invoice, payment, dan log agar arsip keuangan tidak terhapus.
    // 2. Tandai pelanggan sebagai is_deleted = TRUE (soft-delete) untuk audit log, atau aman jika dihapus.
    await withTransaction(async (client) => {
      await client.query('UPDATE invoices SET customer_id = NULL WHERE customer_id = $1', [id]);
      await client.query('UPDATE payments SET customer_id = NULL WHERE customer_id = $1', [id]);
      await client.query('UPDATE whatsapp_logs SET customer_id = NULL WHERE customer_id = $1', [id]);
      await client.query('UPDATE broadcast_recipients SET customer_id = NULL WHERE customer_id = $1', [id]);
      await client.query('UPDATE customers SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    });

    res.json({
      success: true,
      message: 'Pelanggan berhasil dihapus. Seluruh arsip invoice dan riwayat pembayaran dipertahankan secara utuh.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menghapus pelanggan: ' + error.message });
  }
});

// ============================================================================
// 4. TAGIHAN (INVOICES) (CRUD)
// ============================================================================
router.get('/invoices', async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        id, 
        invoice_number AS "invoiceNumber", 
        customer_id AS "customerId", 
        customer_name AS "customerName", 
        customer_phone AS "customerPhone", 
        package_name AS "packageName", 
        amount::float AS amount, 
        paid_amount::float AS "paidAmount", 
        remaining_amount::float AS "remainingAmount", 
        month_period AS "monthPeriod", 
        due_date::text AS "dueDate", 
        status, 
        created_at::text AS "createdAt", 
        paid_at AS "paidAt", 
        payment_method AS "paymentMethod",
        is_prorata AS "isProrata",
        service_period_start::text AS "servicePeriodStart",
        service_period_end::text AS "servicePeriodEnd",
        prorata_days AS "prorataDays",
        period_total_days AS "periodTotalDays",
        prorata_calculation_note AS "prorataCalculationNote"
      FROM invoices
      ORDER BY due_date DESC, invoice_number DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil tagihan dari PostgreSQL: ' + error.message });
  }
});

router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const inv = req.body;
    if (!inv.id || !inv.invoiceNumber || !inv.customerId || inv.amount === undefined) {
      return res.status(400).json({ success: false, message: 'Nomor tagihan, pelanggan, dan nominal wajib diisi.' });
    }

    const totalAmount = Number(inv.amount) || 0;
    const paidAmount = Number(inv.paidAmount) || (inv.status === 'paid' ? totalAmount : 0);
    const remainingAmount = Number(inv.remainingAmount) !== undefined 
      ? Number(inv.remainingAmount) 
      : Math.max(0, totalAmount - paidAmount);

    const result = await query(
      `
      INSERT INTO invoices (
        id, invoice_number, customer_id, customer_name, customer_phone, package_name,
        amount, paid_amount, remaining_amount, month_period, due_date, status,
        created_at, paid_at, payment_method, is_prorata, service_period_start,
        service_period_end, prorata_days, period_total_days, prorata_calculation_note
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      ON CONFLICT (id) DO UPDATE SET
        invoice_number = EXCLUDED.invoice_number,
        customer_name = EXCLUDED.customer_name,
        customer_phone = EXCLUDED.customer_phone,
        package_name = EXCLUDED.package_name,
        amount = EXCLUDED.amount,
        paid_amount = EXCLUDED.paid_amount,
        remaining_amount = EXCLUDED.remaining_amount,
        month_period = EXCLUDED.month_period,
        due_date = EXCLUDED.due_date,
        status = EXCLUDED.status,
        paid_at = EXCLUDED.paid_at,
        payment_method = EXCLUDED.payment_method,
        updated_at = CURRENT_TIMESTAMP
      RETURNING 
        id, invoice_number AS "invoiceNumber", customer_id AS "customerId",
        customer_name AS "customerName", customer_phone AS "customerPhone",
        package_name AS "packageName", amount::float AS amount,
        paid_amount::float AS "paidAmount", remaining_amount::float AS "remainingAmount",
        month_period AS "monthPeriod", due_date::text AS "dueDate", status,
        created_at::text AS "createdAt", paid_at AS "paidAt", payment_method AS "paymentMethod"
      `,
      [
        inv.id,
        inv.invoiceNumber,
        inv.customerId,
        inv.customerName || 'Pelanggan',
        inv.customerPhone || '',
        inv.packageName || 'Paket Internet',
        totalAmount,
        paidAmount,
        remainingAmount,
        inv.monthPeriod || 'Periode Baru',
        inv.dueDate || new Date().toISOString().split('T')[0],
        inv.status || 'unpaid',
        inv.createdAt || new Date().toISOString().split('T')[0],
        inv.paidAt || null,
        inv.paymentMethod || null,
        Boolean(inv.isProrata),
        inv.servicePeriodStart || null,
        inv.servicePeriodEnd || null,
        inv.prorataDays || null,
        inv.periodTotalDays || null,
        inv.prorataCalculationNote || null,
      ]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(500).json({ success: false, message: 'Gagal membuat tagihan: database tidak mengembalikan data.' });
    }

    res.json({ success: true, message: 'Tagihan berhasil disimpan ke PostgreSQL.', data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal membuat tagihan: ' + error.message });
  }
});

router.put('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const inv = req.body;

    const result = await query(
      `
      UPDATE invoices SET
        invoice_number = COALESCE($1, invoice_number),
        customer_name = COALESCE($2, customer_name),
        customer_phone = COALESCE($3, customer_phone),
        package_name = COALESCE($4, package_name),
        amount = COALESCE($5, amount),
        paid_amount = COALESCE($6, paid_amount),
        remaining_amount = COALESCE($7, remaining_amount),
        month_period = COALESCE($8, month_period),
        due_date = COALESCE($9, due_date),
        status = COALESCE($10, status),
        paid_at = COALESCE($11, paid_at),
        payment_method = COALESCE($12, payment_method),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $13
      RETURNING 
        id, invoice_number AS "invoiceNumber", customer_id AS "customerId",
        customer_name AS "customerName", customer_phone AS "customerPhone",
        package_name AS "packageName", amount::float AS amount,
        paid_amount::float AS "paidAmount", remaining_amount::float AS "remainingAmount",
        month_period AS "monthPeriod", due_date::text AS "dueDate", status,
        created_at::text AS "createdAt", paid_at AS "paidAt", payment_method AS "paymentMethod"
      `,
      [
        inv.invoiceNumber,
        inv.customerName,
        inv.customerPhone,
        inv.packageName,
        inv.amount !== undefined ? Number(inv.amount) : null,
        inv.paidAmount !== undefined ? Number(inv.paidAmount) : null,
        inv.remainingAmount !== undefined ? Number(inv.remainingAmount) : null,
        inv.monthPeriod,
        inv.dueDate,
        inv.status,
        inv.paidAt,
        inv.paymentMethod,
        id,
      ]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tagihan tidak ditemukan.' });
    }

    res.json({ success: true, message: 'Tagihan berhasil diperbarui di PostgreSQL.', data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui tagihan: ' + error.message });
  }
});

router.delete('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Proteksi data keuangan: Cegah penghapusan jika tagihan sudah memiliki riwayat pembayaran
    const payCheck = await query('SELECT COUNT(*) AS count FROM payments WHERE invoice_id = $1', [id]);
    if (parseInt(payCheck.rows[0].count, 10) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tagihan tidak dapat dihapus karena sudah memiliki riwayat transaksi pembayaran. Data keuangan dilindungi.',
      });
    }

    await query('DELETE FROM invoices WHERE id = $1', [id]);
    res.json({ success: true, message: 'Tagihan berhasil dihapus dari database.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menghapus tagihan: ' + error.message });
  }
});

// ============================================================================
// 5. PEMBAYARAN & PEMBAYARAN SEBAGIAN (TRANSAKSI ATOMIK)
// ============================================================================
router.get('/payments', async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        id, 
        transaction_number AS "transactionNumber", 
        invoice_id AS "invoiceId", 
        invoice_number AS "invoiceNumber", 
        customer_id AS "customerId", 
        customer_name AS "customerName", 
        amount::float AS amount, 
        method, 
        notes, 
        paid_at AS "paidAt", 
        receipt_number AS "receiptNumber", 
        receiver_name AS "receiverName", 
        is_partial AS "isPartial",
        created_at AS "createdAt"
      FROM payments
      ORDER BY paid_at DESC, transaction_number DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data pembayaran: ' + error.message });
  }
});

/**
 * Mencatat transaksi pembayaran dengan locking FOR UPDATE dan transaksi atomik
 */
router.post('/payments', async (req: Request, res: Response) => {
  try {
    const { invoiceId, amount, method, notes, receiverName } = req.body;

    if (!invoiceId) {
      return res.status(400).json({ success: false, message: 'ID tagihan wajib diisi.' });
    }

    const payAmount = Number(amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Nominal pembayaran tidak valid. Nominal harus berupa angka finite lebih besar dari 0.',
      });
    }

    // Jalankan seluruh proses pembayaran dalam 1 database transaction atomik
    const paymentResult = await withTransaction(async (client) => {
      // 1. Kunci pembuatan nomor transaksi dengan pg_advisory_xact_lock
      // Mengunci konkurensi antar admin sehingga nomor transaksi dijamin unik dan atomik
      await client.query("SELECT pg_advisory_xact_lock(hashtext('payment_transaction_number'))");

      // 2. Kunci baris invoice dengan FOR UPDATE untuk mencegah race condition pembayaran ganda
      const invCheck = await client.query(
        'SELECT * FROM invoices WHERE id = $1 FOR UPDATE',
        [invoiceId]
      );

      if (invCheck.rows.length === 0) {
        throw new Error('Tagihan tidak ditemukan dalam sistem.');
      }

      const inv = invCheck.rows[0];
      const invTotal = Number(inv.amount);
      const invPaidAmount = Number(inv.paid_amount) || 0;
      const invRemainingAmount = Number(inv.remaining_amount) !== undefined 
        ? Number(inv.remaining_amount) 
        : Math.max(0, invTotal - invPaidAmount);

      // 3. Verifikasi konsistensi keuangan antara tabel payments dan invoices
      const sumPaymentsRes = await client.query(
        'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE invoice_id = $1',
        [invoiceId]
      );
      const totalRecordedPayments = Number(sumPaymentsRes.rows[0].total_paid) || 0;

      // Audit A: Periksa apakah total pembayaran di tabel payments sama persis dengan invoices.paid_amount
      if (Math.abs(totalRecordedPayments - invPaidAmount) > 0.01) {
        throw new Error(
          `Inkonsistensi data keuangan terdeteksi pada tagihan ${inv.invoice_number}: total pembayaran riwayat (Rp ${totalRecordedPayments.toLocaleString('id-ID')}) tidak sama dengan paid_amount tagihan (Rp ${invPaidAmount.toLocaleString('id-ID')}). Transaksi dibatalkan untuk melindungi integritas buku besar.`
        );
      }

      // Audit B: Periksa apakah invoices.remaining_amount sama dengan (amount - totalRecordedPayments)
      const expectedRemaining = Math.max(0, invTotal - totalRecordedPayments);
      if (Math.abs(invRemainingAmount - expectedRemaining) > 0.01) {
        throw new Error(
          `Inkonsistensi data keuangan terdeteksi pada tagihan ${inv.invoice_number}: remaining_amount tagihan (Rp ${invRemainingAmount.toLocaleString('id-ID')}) tidak sama dengan sisa tagihan terverifikasi (Rp ${expectedRemaining.toLocaleString('id-ID')}). Transaksi dibatalkan untuk melindungi integritas buku besar.`
        );
      }

      // Validasi status lunas dan sisa tagihan
      if (inv.status === 'paid' || expectedRemaining <= 0) {
        throw new Error('Tagihan ini sudah lunas. Tidak dapat menerima pembayaran tambahan.');
      }

      // Validasi overpayment
      if (totalRecordedPayments + payAmount > invTotal || payAmount > expectedRemaining) {
        throw new Error(
          `Nominal pembayaran (Rp ${payAmount.toLocaleString('id-ID')}) melebihi sisa tagihan terverifikasi (Maksimal: Rp ${expectedRemaining.toLocaleString('id-ID')}). Transaksi ditolak.`
        );
      }

      // Hitung nilai baru berdasarkan data yang telah diverifikasi konsistensinya
      const newPaid = totalRecordedPayments + payAmount;
      const newRemaining = Math.max(0, invTotal - newPaid);
      const isFullyPaid = newRemaining === 0;
      const isPartial = !isFullyPaid;
      const newStatus = isFullyPaid ? 'paid' : inv.status;

      // 4. Update status dan nominal invoice di PostgreSQL
      const updInvRes = await client.query(
        `
        UPDATE invoices SET
          paid_amount = $1,
          remaining_amount = $2,
          status = $3,
          paid_at = CURRENT_TIMESTAMP,
          payment_method = $4,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING 
          id, 
          invoice_number AS "invoiceNumber", 
          customer_id AS "customerId", 
          customer_name AS "customerName", 
          customer_phone AS "customerPhone", 
          package_name AS "packageName", 
          amount::float AS amount, 
          paid_amount::float AS "paidAmount", 
          remaining_amount::float AS "remainingAmount", 
          month_period AS "monthPeriod", 
          due_date::text AS "dueDate", 
          status, 
          created_at::text AS "createdAt", 
          paid_at AS "paidAt", 
          payment_method AS "paymentMethod",
          is_prorata AS "isProrata",
          service_period_start::text AS "servicePeriodStart",
          service_period_end::text AS "servicePeriodEnd",
          prorata_days AS "prorataDays",
          period_total_days AS "periodTotalDays",
          prorata_calculation_note AS "prorataCalculationNote"
        `,
        [newPaid, newRemaining, newStatus, method || 'cash', invoiceId]
      );

      if (!updInvRes.rows || updInvRes.rows.length === 0) {
        throw new Error('Database gagal memperbarui baris data tagihan.');
      }

      // 5. Generate nomor transaksi unik berbasis zona waktu lokal Asia/Jakarta (WIB)
      const jakartaDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const datePart = jakartaDateStr.replace(/-/g, '');
      const prefix = `TRX-${datePart}-`;

      // Ekstraksi nomor urut dengan penanganan aman data historis nonnumerik
      const maxSeqRes = await client.query(
        `
        SELECT COALESCE(
          MAX(
            CASE 
              WHEN SUBSTRING(transaction_number FROM length($1) + 1) ~ '^[0-9]+$' 
              THEN SUBSTRING(transaction_number FROM length($1) + 1)::integer
              ELSE 0
            END
          ),
          0
        ) AS max_seq
        FROM payments
        WHERE transaction_number LIKE $2
        `,
        [prefix, `${prefix}%`]
      );
      const nextSeq = (parseInt(maxSeqRes.rows[0]?.max_seq, 10) || 0) + 1;
      const trxNumber = `${prefix}${String(nextSeq).padStart(3, '0')}`;
      const paymentId = `pay-${datePart}-${String(nextSeq).padStart(3, '0')}`;

      // 6. Catat riwayat pembayaran ke tabel payments di PostgreSQL
      const insPay = await client.query(
        `
        INSERT INTO payments (
          id, transaction_number, invoice_id, invoice_number, customer_id, customer_name,
          amount, method, notes, receipt_number, receiver_name, is_partial
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING 
          id, transaction_number AS "transactionNumber", invoice_id AS "invoiceId",
          invoice_number AS "invoiceNumber", customer_id AS "customerId",
          customer_name AS "customerName", amount::float AS amount, method, notes,
          paid_at AS "paidAt", receipt_number AS "receiptNumber",
          receiver_name AS "receiverName", is_partial AS "isPartial",
          created_at AS "createdAt"
        `,
        [
          paymentId,
          trxNumber,
          inv.id,
          inv.invoice_number,
          inv.customer_id,
          inv.customer_name,
          payAmount,
          method || 'cash',
          notes || (isPartial ? `Pembayaran sebagian (Sisa: Rp ${newRemaining.toLocaleString('id-ID')})` : 'Pelunasan penuh'),
          trxNumber,
          receiverName || 'Admin Kasir',
          isPartial,
        ]
      );

      if (!insPay.rows || insPay.rows.length === 0) {
        throw new Error('Database gagal mencatat baris data pembayaran.');
      }

      // Kembalikan HANYA baris resmi dari PostgreSQL hasil RETURNING
      return {
        payment: insPay.rows[0],
        updatedInvoice: updInvRes.rows[0],
      };
    });

    // Respons sukses HANYA dikirimkan setelah withTransaction berhasil melakukan COMMIT
    res.json({
      success: true,
      message: 'Pembayaran berhasil dicatat di PostgreSQL.',
      data: paymentResult,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 6. TEMPLATE NOTIFIKASI WHATSAPP
// ============================================================================
router.get('/whatsapp/templates', async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        id, 
        name, 
        description, 
        is_enabled AS "isEnabled", 
        template_content AS "templateContent", 
        updated_at AS "updatedAt"
      FROM whatsapp_templates
      ORDER BY id ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil template WhatsApp: ' + error.message });
  }
});

router.post('/whatsapp/templates', async (req: Request, res: Response) => {
  try {
    const { id, name, description, isEnabled, templateContent } = req.body;
    if (!id || !templateContent) {
      return res.status(400).json({ success: false, message: 'ID dan isi template wajib diisi.' });
    }

    const result = await query(
      `
      INSERT INTO whatsapp_templates (id, name, description, is_enabled, template_content, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        is_enabled = EXCLUDED.is_enabled,
        template_content = EXCLUDED.template_content,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, name, description, is_enabled AS "isEnabled", template_content AS "templateContent", updated_at AS "updatedAt"
      `,
      [id, name || id, description || '', isEnabled !== false, templateContent]
    );

    res.json({ success: true, message: 'Template WhatsApp berhasil disimpan.', data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan template: ' + error.message });
  }
});

// ============================================================================
// 7. RIWAYAT PESAN WHATSAPP & BROADCAST
// ============================================================================
router.get('/whatsapp/logs', async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        id, 
        timestamp::text, 
        customer_name AS "customerName", 
        customer_id AS "customerId", 
        phone, 
        notification_type AS "notificationType", 
        notification_type_name AS "notificationTypeName", 
        message_content AS "messageContent", 
        status, 
        error_message AS "errorMessage", 
        reference_id AS "referenceId"
      FROM whatsapp_logs
      ORDER BY timestamp DESC
      LIMIT 200
    `);
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil riwayat pesan WhatsApp: ' + error.message });
  }
});

router.post('/whatsapp/logs', async (req: Request, res: Response) => {
  try {
    const log = req.body;
    if (!log.phone || !log.messageContent) {
      return res.status(400).json({ success: false, message: 'Nomor telepon dan isi pesan wajib diisi.' });
    }

    const logId = log.id || `walog-${Date.now().toString().slice(-6)}`;
    const result = await query(
      `
      INSERT INTO whatsapp_logs (
        id, customer_name, customer_id, phone, notification_type,
        notification_type_name, message_content, status, error_message, reference_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, timestamp::text, customer_name AS "customerName", phone, status
      `,
      [
        logId,
        log.customerName || 'Pelanggan',
        log.customerId || null,
        log.phone,
        log.notificationType || 'general',
        log.notificationTypeName || 'Notifikasi',
        log.messageContent,
        log.status || 'sent',
        log.errorMessage || null,
        log.referenceId || null,
      ]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mencatat log WhatsApp: ' + error.message });
  }
});

router.get('/whatsapp/broadcast-history', async (_req: Request, res: Response) => {
  try {
    const campaigns = await query(`
      SELECT 
        c.id, 
        c.title, 
        c.type, 
        c.type_name AS "typeName", 
        c.message_content AS "messageContent", 
        c.total_recipients AS "totalRecipients", 
        c.success_count AS "successCount", 
        c.failure_count AS "failureCount", 
        c.created_at::text AS "createdAt"
      FROM broadcast_campaigns c
      ORDER BY c.created_at DESC
      LIMIT 100
    `);

    // Ambil daftar penerima per kampanye
    const campaignList = await Promise.all(
      campaigns.rows.map(async (camp) => {
        const recipients = await query(
          `
          SELECT 
            customer_id AS "customerId", 
            customer_name AS "customerName", 
            phone, 
            status, 
            error_message AS "errorMessage", 
            sent_at::text AS "sentAt"
          FROM broadcast_recipients
          WHERE campaign_id = $1
          ORDER BY id ASC
          `,
          [camp.id]
        );
        return {
          ...camp,
          recipients: recipients.rows,
        };
      })
    );

    res.json({ success: true, data: campaignList });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil riwayat broadcast: ' + error.message });
  }
});

router.post('/whatsapp/broadcast-history', async (req: Request, res: Response) => {
  try {
    const camp = req.body;
    if (!camp.id || !camp.title) {
      return res.status(400).json({ success: false, message: 'ID dan judul broadcast wajib diisi.' });
    }

    await withTransaction(async (client) => {
      await client.query(
        `
        INSERT INTO broadcast_campaigns (
          id, title, type, type_name, message_content, total_recipients, success_count, failure_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          success_count = EXCLUDED.success_count,
          failure_count = EXCLUDED.failure_count
        `,
        [
          camp.id,
          camp.title,
          camp.type || 'announcement',
          camp.typeName || 'Pengumuman',
          camp.messageContent || '',
          Number(camp.totalRecipients) || 0,
          Number(camp.successCount) || 0,
          Number(camp.failureCount) || 0,
        ]
      );

      if (Array.isArray(camp.recipients)) {
        for (const r of camp.recipients) {
          await client.query(
            `
            INSERT INTO broadcast_recipients (
              campaign_id, customer_id, customer_name, phone, status, error_message, sent_at
            ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
            `,
            [camp.id, r.customerId || null, r.customerName || 'Pelanggan', r.phone, r.status || 'sent', r.errorMessage || null]
          );
        }
      }
    });

    res.json({ success: true, message: 'Riwayat broadcast berhasil disimpan ke PostgreSQL.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan riwayat broadcast: ' + error.message });
  }
});

// ============================================================================
// 8. PENGATURAN OPERASIONAL & BISNIS
// ============================================================================
router.get('/settings/:key', async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const result = await query('SELECT setting_value AS value FROM app_settings WHERE setting_key = $1', [key]);
    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: result.rows[0].value });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan: ' + error.message });
  }
});

router.put('/settings/:key', async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    await query(
      `
      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (setting_key) DO UPDATE SET
        setting_value = EXCLUDED.setting_value,
        updated_at = CURRENT_TIMESTAMP
      `,
      [key, JSON.stringify(value)]
    );

    res.json({ success: true, message: `Pengaturan ${key} berhasil disimpan ke PostgreSQL.` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan: ' + error.message });
  }
});

// ============================================================================
// 9. KONFIGURASI MIKROTIK ROUTEROS RB4011
// Kredensial rahasia (password) disimpan di server backend,
// password tidak pernah dikirim ke frontend dalam bentuk teks polos.
// ============================================================================
router.get('/mikrotik/config', async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        id,
        router_name AS "routerName",
        host,
        api_port AS "apiPort",
        username,
        status,
        model_target AS "modelTarget",
        ros_version_preview AS "rosVersionPreview",
        use_ssl AS "useSsl",
        timeout_seconds AS "timeoutSeconds",
        notes,
        last_tested_at AS "lastTestedAt",
        last_status_message AS "lastStatusMessage",
        (
          (password_encrypted IS NOT NULL AND password_encrypted != '') OR
          (password_hash IS NOT NULL AND password_hash != '')
        ) AS "isPasswordConfigured"
      FROM mikrotik_settings
      WHERE id = 'default'
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          id: 'default',
          routerName: 'MikroTik RB4011',
          host: '192.168.88.1',
          apiPort: 8728,
          username: 'admin',
          status: 'disconnected',
          modelTarget: 'RB4011iGS+RM',
          rosVersionPreview: 'RouterOS v7.x',
          useSsl: false,
          timeoutSeconds: 10,
          notes: 'Router MikroTik RB4011 untuk gateway PPPoE & Hotspot',
          isPasswordConfigured: false,
          maskedPassword: '',
        },
      });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        id: row.id,
        routerName: row.routerName,
        host: row.host,
        apiPort: row.apiPort,
        username: row.username,
        status: row.status,
        modelTarget: row.modelTarget,
        rosVersionPreview: row.rosVersionPreview,
        useSsl: row.useSsl,
        timeoutSeconds: row.timeoutSeconds,
        notes: row.notes,
        lastTestedAt: row.lastTestedAt,
        lastStatusMessage: row.lastStatusMessage,
        isPasswordConfigured: Boolean(row.isPasswordConfigured),
        // Proteksi keamanan: Hanya kirim mask placeholder jika password sudah tersimpan,
        // password asli atau password_encrypted TIDAK PERNAH dikirim ke frontend.
        maskedPassword: row.isPasswordConfigured ? '••••••••' : '',
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil konfigurasi MikroTik: ' + error.message });
  }
});

router.post('/mikrotik/config', async (req: Request, res: Response) => {
  try {
    const {
      routerName,
      host,
      apiPort,
      username,
      password,
      modelTarget,
      rosVersionPreview,
      useSsl,
      timeoutSeconds,
      notes,
    } = req.body;

    // Periksa password_encrypted yang sudah ada di database backend
    const existing = await query(
      'SELECT password_encrypted, password_hash FROM mikrotik_settings WHERE id = $1',
      ['default']
    );
    let encryptedPasswordToStore: string | null = null;

    if (existing.rows.length > 0) {
      encryptedPasswordToStore = existing.rows[0].password_encrypted || existing.rows[0].password_hash || null;
    }

    // Jika admin memasukkan password baru (bukan token placeholder)
    if (password && password !== '••••••••' && password.trim() !== '') {
      // Enkripsi reversible AES-256-GCM menggunakan MIKROTIK_ENCRYPTION_KEY
      encryptedPasswordToStore = encryptMikrotikPassword(password.trim());
    }

    await query(
      `
      INSERT INTO mikrotik_settings (
        id, router_name, host, api_port, username, password_encrypted, password_hash,
        model_target, ros_version_preview, use_ssl, timeout_seconds, notes, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        router_name = EXCLUDED.router_name,
        host = EXCLUDED.host,
        api_port = EXCLUDED.api_port,
        username = EXCLUDED.username,
        password_encrypted = COALESCE($6, mikrotik_settings.password_encrypted),
        password_hash = COALESCE($6, mikrotik_settings.password_hash),
        model_target = EXCLUDED.model_target,
        ros_version_preview = EXCLUDED.ros_version_preview,
        use_ssl = EXCLUDED.use_ssl,
        timeout_seconds = EXCLUDED.timeout_seconds,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        'default',
        routerName || 'MikroTik RB4011',
        host || '192.168.88.1',
        Number(apiPort) || 8728,
        username || 'admin',
        encryptedPasswordToStore,
        modelTarget || 'RB4011iGS+RM',
        rosVersionPreview || 'RouterOS v7.x',
        Boolean(useSsl),
        Number(timeoutSeconds) || 10,
        notes || '',
      ]
    );

    res.json({
      success: true,
      message: 'Konfigurasi MikroTik RB4011 dan password terenkripsi AES-256-GCM berhasil disimpan secara aman.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan konfigurasi MikroTik: ' + error.message });
  }
});

export default router;

