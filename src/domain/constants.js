export const SHIFTS = [
  { key: "morning", label: "الشيفت الصباحي", time: "٨ص - ٤م" },
  { key: "evening", label: "الشيفت المسائي", time: "٤م - ١٢ص" },
  { key: "night", label: "الشيفت الليلي", time: "١٢ص - ٨ص" },
];

export const ROLES = [
  { key: "staff", label: "موظف الشيفت" },
  { key: "reservations", label: "مدير الحجوزات" },
  { key: "accounts", label: "مديرة الحسابات" },
  { key: "gm", label: "المدير العام" },
];

export const TAB_LABELS = { board: "لوحة الغرف", ledger: "اليومية", bookings: "الحجوزات", reports: "التقارير", activity: "سجل الحركة", users: "إدارة المستخدمين" };

/* staff: يشتغل باليومية والحجوزات (عرض + إضافة حجز مباشر يستنى موافقة مدير الحجوزات) وحالة الغرف (بقيود).
   كل حاجة باينة للمدير العام باينة كمان لمديرة الحسابات ومدير الحجوزات - عرض بس، غير الصلاحيات المحددة لكل دور. */
export const PERMISSIONS = {
  staff: { tabs: ["board", "ledger", "bookings"], editLedger: true, closeShift: true, editBookings: false, canCreateBookings: true, canApproveBookings: false, editRoomStatus: true, roomStatusRestricted: true, editRoomConfig: false, viewReports: false, viewActivity: false, manageUsers: false, markPaymentReceived: true },
  reservations: { tabs: ["board", "bookings", "ledger", "reports", "activity", "users"], editLedger: false, closeShift: false, editBookings: true, canCreateBookings: true, canApproveBookings: true, editRoomStatus: true, roomStatusRestricted: false, editRoomConfig: true, viewReports: true, viewActivity: true, manageUsers: false, markPaymentReceived: true },
  accounts: { tabs: ["board", "ledger", "bookings", "reports", "activity", "users"], editLedger: false, closeShift: false, editBookings: false, canCreateBookings: false, canApproveBookings: false, editRoomStatus: false, roomStatusRestricted: false, editRoomConfig: false, viewReports: true, viewActivity: true, manageUsers: false, markPaymentReceived: false },
  gm: { tabs: ["board", "ledger", "bookings", "reports", "activity", "users"], editLedger: false, closeShift: false, editBookings: false, canCreateBookings: false, canApproveBookings: false, editRoomStatus: false, roomStatusRestricted: false, editRoomConfig: false, viewReports: true, viewActivity: true, manageUsers: true, markPaymentReceived: false },
};

export const OTA_SOURCES = ["Booking.com", "Trip.com"];
export const BOOKING_SOURCES = ["مباشر", "Booking.com", "Trip.com", "Airbnb", "وسيط"];
export const BOOKING_STATUSES = ["مؤكد", "تم تسجيل الدخول", "تم تسجيل الخروج", "ملغي"];

export const MANUAL_STATUS_OPTIONS = [
  { key: "auto", label: "تلقائي حسب الحجوزات" },
  { key: "early_checkout", label: "غادر مبكرًا" },
  { key: "maintenance", label: "صيانة" },
  { key: "cleaning", label: "تحت التنظيف" },
  { key: "available", label: "متاحة يدويًا" },
];
export const STAFF_ALLOWED_ON_ACTIVE_BOOKING = ["early_checkout"];

export const STATUS_COLORS = { available: "var(--sage)", occupied_paid: "var(--teal)", occupied_unpaid: "var(--rust)", reserved: "var(--gold)", maintenance: "#8A8577", cleaning: "var(--slate)", early_checkout: "#C9702B", pending_approval: "#7A5FB5" };

export const ROOMS_DEFAULT = [
  { number: 601, type: "غرفة مزدوجة - إطلالة داخلية", price: 50, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 602, type: "غرفة بسرير كينج - إطلالة داخلية", price: 50, currency: "USD", capacity: 2, beds: "سرير كينج" },
  { number: 603, type: "غرفة عائلية (٣ أسرة)", price: 80, currency: "USD", capacity: 4, beds: "٣ أسرة مفردة" },
  { number: 604, type: "غرفة مزدوجة - بلكونة فرنسية", price: 70, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 605, type: "غرفة مزدوجة - بلكونة", price: 70, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 606, type: "غرفة مزدوجة", price: 60, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 607, type: "غرفة مزدوجة", price: 60, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 608, type: "غرفة مزدوجة", price: 60, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 609, type: "غرفة مزدوجة", price: 60, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 610, type: "غرفة مزدوجة", price: 60, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 611, type: "غرفة مزدوجة", price: 60, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 612, type: "غرفة مزدوجة", price: 60, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 613, type: "غرفة مزدوجة", price: 60, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 614, type: "غرفة مزدوجة", price: 60, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 615, type: "غرفة مزدوجة", price: 60, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
  { number: 616, type: "غرفة مزدوجة", price: 60, currency: "USD", capacity: 2, beds: "سرير مزدوج" },
];

export function roomFloor(number) { return Math.floor(number / 100); }
