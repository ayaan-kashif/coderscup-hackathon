/**
 * Fictional demo accounts. Emails use the reserved .test domain; phones use the never-allocated +9200000 range;
 * CNICs use the never-issued 00000 locality prefix. Passwords and PINs come only from environment variables.
 */
import type { Role } from '@/auth/actor';

export type TenantCode = 'sindh' | 'punjab' | 'sandbox';

export const DEMO_TENANTS: { code: TenantCode; name: string; nameUr: string; isSandbox: boolean; province: string }[] = [
  { code: 'sindh', name: 'Saaya Relief — Sindh office (fictional)', nameUr: 'سایہ امداد — سندھ دفتر (فرضی)', isSandbox: false, province: 'Sindh' },
  { code: 'punjab', name: 'Saaya Relief — Punjab office (fictional)', nameUr: 'سایہ امداد — پنجاب دفتر (فرضی)', isSandbox: false, province: 'Punjab' },
  { code: 'sandbox', name: 'Break It sandbox (fictional)', nameUr: 'آزمائشی دفتر (فرضی)', isSandbox: true, province: 'Sindh' },
];

export type DemoStaff = { email: string; name: string; tenant: TenantCode; role: Exclude<Role, 'citizen'>; isSenior?: boolean };

export const DEMO_STAFF: DemoStaff[] = [
  { email: 'officer.imran@sindh.amanat.test', name: 'Officer Imran (fictional)', tenant: 'sindh', role: 'officer' },
  { email: 'senior.officer.hina@sindh.amanat.test', name: 'Senior Officer Hina (fictional)', tenant: 'sindh', role: 'officer', isSenior: true },
  { email: 'admin.sana@sindh.amanat.test', name: 'Admin Sana (fictional)', tenant: 'sindh', role: 'admin' },
  { email: 'admin.second.omar@sindh.amanat.test', name: 'Second Admin Omar (fictional)', tenant: 'sindh', role: 'admin' },
  { email: 'auditor.raza@sindh.amanat.test', name: 'Auditor Raza (fictional)', tenant: 'sindh', role: 'auditor' },
  { email: 'helper.shabana@sindh.amanat.test', name: 'Helper Shabana (fictional)', tenant: 'sindh', role: 'helper' },
  { email: 'helper.kashif@sindh.amanat.test', name: 'Helper Kashif (fictional)', tenant: 'sindh', role: 'helper' },
  { email: 'officer.bilal@punjab.amanat.test', name: 'Officer Bilal (fictional)', tenant: 'punjab', role: 'officer' },
  { email: 'admin.ayesha@punjab.amanat.test', name: 'Admin Ayesha (fictional)', tenant: 'punjab', role: 'admin' },
  { email: 'auditor.kamran@punjab.amanat.test', name: 'Auditor Kamran (fictional)', tenant: 'punjab', role: 'auditor' },
  { email: 'helper.nadia@punjab.amanat.test', name: 'Helper Nadia (fictional)', tenant: 'punjab', role: 'helper' },
  { email: 'admin.breakit@sandbox.amanat.test', name: 'Break It Admin (fictional)', tenant: 'sandbox', role: 'admin' },
  { email: 'officer.sandbox@sandbox.amanat.test', name: 'Sandbox Officer (fictional)', tenant: 'sandbox', role: 'officer' },
  { email: 'auditor.sandbox@sandbox.amanat.test', name: 'Sandbox Auditor (fictional)', tenant: 'sandbox', role: 'auditor' },
];

export type DemoCitizen = { phone: string; name: string; nameUr: string; cnic: string; dob: string; district: string; tenant: TenantCode; trustPictureId: number; avatarId: number };

/** The persona citizens from the PRD journeys; the generator adds the rest of the population. */
export const DEMO_CITIZENS: DemoCitizen[] = [
  { phone: '+920000000001', name: 'Zarina Bibi', nameUr: 'زرینہ بی بی', cnic: '00000-1234567-2', dob: '1972-03-14', district: 'BDN', tenant: 'sindh', trustPictureId: 7, avatarId: 3 },
  { phone: '+920000000002', name: 'Fatima Bibi', nameUr: 'فاطمہ بی بی', cnic: '00000-2345678-4', dob: '1968-11-02', district: 'BDN', tenant: 'sindh', trustPictureId: 12, avatarId: 5 },
  { phone: '+920000000003', name: 'Rukhsana Begum', nameUr: 'رخسانہ بیگم', cnic: '00000-3456789-6', dob: '1980-06-21', district: 'MUL', tenant: 'punjab', trustPictureId: 21, avatarId: 9 },
];

/** Default demo role per role name, used by POST /api/v1/demo/tokens. */
export const DEMO_ROLE_ACCOUNTS: Record<Role, { email?: string; phone?: string }> = {
  citizen: { phone: '+920000000001' },
  helper: { email: 'helper.shabana@sindh.amanat.test' },
  officer: { email: 'officer.imran@sindh.amanat.test' },
  admin: { email: 'admin.sana@sindh.amanat.test' },
  auditor: { email: 'auditor.raza@sindh.amanat.test' },
};

export const DISTRICTS = [
  { code: 'BDN', name: 'Badin', nameUr: 'بدین', province: 'Sindh', lat: 24.656, lng: 68.837 },
  { code: 'TTA', name: 'Thatta', nameUr: 'ٹھٹھہ', province: 'Sindh', lat: 24.747, lng: 67.924 },
  { code: 'HYD', name: 'Hyderabad', nameUr: 'حیدرآباد', province: 'Sindh', lat: 25.396, lng: 68.377 },
  { code: 'KHS', name: 'Karachi South', nameUr: 'کراچی جنوبی', province: 'Sindh', lat: 24.86, lng: 67.01 },
  { code: 'SKR', name: 'Sukkur', nameUr: 'سکھر', province: 'Sindh', lat: 27.706, lng: 68.857 },
  { code: 'THP', name: 'Tharparkar', nameUr: 'تھرپارکر', province: 'Sindh', lat: 24.74, lng: 69.8 },
  { code: 'LHR', name: 'Lahore', nameUr: 'لاہور', province: 'Punjab', lat: 31.52, lng: 74.358 },
  { code: 'MUL', name: 'Multan', nameUr: 'ملتان', province: 'Punjab', lat: 30.157, lng: 71.524 },
  { code: 'BWP', name: 'Bahawalpur', nameUr: 'بہاولپور', province: 'Punjab', lat: 29.395, lng: 71.683 },
  { code: 'RJP', name: 'Rajanpur', nameUr: 'راجن پور', province: 'Punjab', lat: 29.104, lng: 70.33 },
  { code: 'FSD', name: 'Faisalabad', nameUr: 'فیصل آباد', province: 'Punjab', lat: 31.45, lng: 73.135 },
];
