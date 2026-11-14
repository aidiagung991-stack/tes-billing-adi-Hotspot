export type MenuItemKey =
  | 'dashboard'
  | 'customers'
  | 'packages'
  | 'invoices'
  | 'payments'
  | 'broadcast'
  | 'whatsapp'
  | 'mikrotik'
  | 'reports'
  | 'settings';

export type CustomerType = 'pppoe' | 'hotspot';
export type CustomerStatus = 'active' | 'isolated' | 'inactive';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  installationAddress?: string;
  latitude?: number;
  longitude?: number;
  packageId: string;
  packageName: string;
  type: CustomerType;
  username: string;
  ipAddress?: string;
  status: CustomerStatus;
  registeredAt: string;
  dueDateDay: number;
  monthlyFee: number;
  installationDate?: string;
}

export type BroadcastType = 'outage' | 'maintenance' | 'restoration' | 'announcement';

export interface BroadcastRecipientLog {
  customerId: string;
  customerName: string;
  phone: string;
  status: 'sent' | 'failed' | 'pending';
  errorMessage?: string;
  sentAt?: string;
}

export interface BroadcastCampaign {
  id: string;
  title: string;
  type: BroadcastType;
  typeName: string;
  messageContent: string;
  totalRecipients: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
  recipients: BroadcastRecipientLog[];
}

export type PackageConnectionType = 'pppoe' | 'hotspot' | 'both';
export type PackageStatus = 'active' | 'inactive';

export interface InternetPackage {
  id: string;
  code: string;
  name: string;
  speed: string;
  downloadSpeed?: string;
  uploadSpeed?: string;
  price: number;
  duration?: string;
  type: CustomerType;
  supportedConnection: PackageConnectionType;
  status: PackageStatus;
  activeUsersCount: number;
  description: string;
}

export type InvoiceStatus = 'paid' | 'unpaid' | 'overdue';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  packageName: string;
  amount: number;
  paidAmount?: number;
  remainingAmount?: number;
  monthPeriod: string;
  dueDate: string;
  status: InvoiceStatus;
  createdAt: string;
  paidAt?: string;
  paymentMethod?: 'cash' | 'transfer' | 'qris';
  // Rincian penagihan & prorata (Modul B & D)
  isProrata?: boolean;
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
  prorataDays?: number;
  periodTotalDays?: number;
  prorataCalculationNote?: string;
}

export type BillingMethodType = 'prorata' | 'anniversary';

export interface BillingSettings {
  billingMethod: BillingMethodType;
  fixedBillingDay: number; // 1-28 (default: 1)
  gracePeriodDays: number; // Hari tenggang pembayaran (default: 7)
  prorataFirstInvoice: boolean; // Tagihan pertama dihitung prorata (default: true)
  inclusiveInstallationDay: boolean; // Tanggal pemasangan ikut dihitung sebagai hari layanan (default: true)
  invoiceGenerationDaysAhead: number; // Hari terbit tagihan sebelum jatuh tempo/siklus (default: 3)
  updatedAt?: string;
}

export type PaymentMethod = 'cash' | 'transfer' | 'qris';

export interface Payment {
  id: string;
  transactionNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  notes?: string;
  paidAt: string;
  receiptNumber?: string;
  receiverName: string;
  isPartial?: boolean;
}

export interface RouterConfig {
  id?: string;
  routerName: string;
  host: string;
  apiPort: number;
  username: string;
  password?: string;
  isPasswordConfigured?: boolean;
  maskedPassword?: string;
  status: 'connected' | 'disconnected' | 'testing' | 'offline';
  modelTarget: string;
  rosVersionPreview: string;
  useSsl?: boolean;
  timeoutSeconds?: number;
  notes: string;
  lastTestedAt?: string;
  lastStatusMessage?: string;
}

export interface BusinessSettings {
  businessName: string;
  ownerName: string;
  phone: string;
  address: string;
  rtRw: string;
  village: string;
  whatsappReminderTemplate: string;
  paymentNoticeBank: string;
  currencyPrefix: string;
}

export type WhatsAppConnectionStatus = 'connected' | 'disconnected' | 'not_tested';

export interface WhatsAppGatewayConfig {
  provider: 'Wablas';
  serverUrl: string;
  senderPhone: string;
  status: WhatsAppConnectionStatus;
  lastTestedAt?: string;
  lastStatusMessage?: string;
  isTokenConfigured: boolean;
  maskedToken?: string;
  isSecretKeyConfigured?: boolean;
  maskedSecretKey?: string;
}

export type NotificationTemplateKey =
  | 'new_invoice'
  | 'due_reminder'
  | 'overdue_notice'
  | 'isolation_notice'
  | 'restoration_notice'
  | 'payment_confirmation';

export interface NotificationTemplate {
  id: NotificationTemplateKey;
  name: string;
  description: string;
  isEnabled: boolean;
  templateContent: string;
  updatedAt: string;
}

export interface NotificationScheduleConfig {
  dueReminderDaysBefore: number;
  sendTime: string;
  overdueReminderDaysAfter: number;
  autoSendOnNewInvoice: boolean;
  autoSendOnPayment: boolean;
  autoSendOnIsolation: boolean;
  autoSendOnRestoration: boolean;
}

export interface WhatsAppMessageLog {
  id: string;
  timestamp: string;
  customerName: string;
  customerId?: string;
  phone: string;
  notificationType: NotificationTemplateKey;
  notificationTypeName: string;
  messageContent: string;
  status: 'pending' | 'sent' | 'failed';
  errorMessage?: string;
  referenceId?: string;
}
