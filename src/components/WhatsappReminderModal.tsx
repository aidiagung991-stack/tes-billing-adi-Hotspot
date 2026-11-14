import React, { useState } from 'react';
import { MessageSquare, Copy, Check, ExternalLink, X, Send, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Invoice, BusinessSettings, WhatsAppMessageLog } from '../types/index.ts';
import { formatRupiah, formatDateIndo } from '../utils/formatters.ts';
import { sendBackendTestMessage } from '../services/whatsappGatewayService.ts';
import { recordWALogToApi } from '../services/apiService.ts';

interface WhatsappReminderModalProps {
  invoice: Invoice | null;
  settings: BusinessSettings;
  onClose: () => void;
}

export const WhatsappReminderModal: React.FC<WhatsappReminderModalProps> = ({
  invoice,
  settings,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [isSendingWablas, setIsSendingWablas] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!invoice) return null;

  // Render the message
  const renderedMessage = settings.whatsappReminderTemplate
    .replace('{NAMA_PELANGGAN}', invoice.customerName)
    .replace('{NAMA_PAKET}', invoice.packageName)
    .replace('{PERIODE}', invoice.monthPeriod)
    .replace('{JUMLAH}', formatRupiah(invoice.amount))
    .replace('{JATUH_TEMPO}', formatDateIndo(invoice.dueDate))
    .replace('{NAMA_USAHA}', settings.businessName);

  // Clean Indonesian phone number for wa.me
  let cleanPhone = invoice.customerPhone.replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '62' + cleanPhone.slice(1);
  }

  const encodedMessage = encodeURIComponent(renderedMessage);
  const waUrl = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(renderedMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendViaWablas = async () => {
    if (isSendingWablas) return;
    if (!cleanPhone || cleanPhone.length < 8) {
      setStatusMessage({ type: 'error', text: 'Nomor WhatsApp pelanggan tidak valid.' });
      return;
    }

    setIsSendingWablas(true);
    setStatusMessage(null);

    try {
      const res = await sendBackendTestMessage({
        targetPhone: cleanPhone,
        messageContent: renderedMessage,
      });

      const nowStr = new Date().toISOString();
      const newLog: WhatsAppMessageLog = {
        id: `walog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        timestamp: nowStr,
        customerName: invoice.customerName,
        customerId: invoice.customerId,
        phone: cleanPhone,
        notificationType: 'due_reminder',
        notificationTypeName: 'Pengingat Tagihan (Wablas)',
        messageContent: renderedMessage,
        status: res.success ? 'sent' : 'failed',
        referenceId: invoice.invoiceNumber,
        errorMessage: res.success ? undefined : res.message,
      };

      const persisted = await recordWALogToApi(newLog);
      if (!persisted) {
        setStatusMessage({ type: 'error', text: 'Pesan diproses gateway, tetapi riwayat gagal disimpan ke PostgreSQL.' });
        return;
      }

      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `Pesan berhasil dikirim via Wablas ke ${cleanPhone}!`,
        });
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setStatusMessage({
          type: 'error',
          text: res.message || 'Gagal mengirim pesan melalui gateway Wablas.',
        });
      }
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Terjadi kesalahan koneksi ke server gateway Wablas.',
      });
    } finally {
      setIsSendingWablas(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in duration-150">
        <div className="flex items-start justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Kirim Pengingat WhatsApp</h3>
              <p className="text-xs text-slate-500">
                Penerima: {invoice.customerName} ({invoice.customerPhone})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSendingWablas}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="py-4 space-y-3 text-xs">
          {/* Feedback Status */}
          {statusMessage && (
            <div
              className={`p-3 rounded-xl border flex items-center gap-2 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              )}
              <span className="text-xs font-semibold">{statusMessage.text}</span>
            </div>
          )}

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
              Pratinjau Teks Pesan:
            </span>
            <div className="text-slate-800 whitespace-pre-line leading-relaxed font-sans bg-white p-3 rounded-lg border border-slate-200">
              {renderedMessage}
            </div>
          </div>

          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-[11px] text-emerald-800 leading-snug">
            <strong>Koneksi Wablas:</strong> Anda dapat mengirim pesan otomatis via gateway resmi Wablas atau membuka aplikasi WhatsApp Web secara manual.
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={isSendingWablas}
            className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">Tersalin!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Salin Pesan</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSendingWablas}
              className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold disabled:opacity-50"
            >
              Batal
            </button>
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold flex items-center gap-1 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Buka WA Web</span>
            </a>
            <button
              type="button"
              onClick={handleSendViaWablas}
              disabled={isSendingWablas}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSendingWablas ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Mengirim...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Kirim via Wablas</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

