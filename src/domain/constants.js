/* اسم الفندق اللي بيظهر في ترويسة التقرير المطبوع - غيّريه هنا لاسم فندق
   العميل وقت التسليم (مرة واحدة بس). ممكن تسيبيه فاضي ("") لو مش عايزة اسم
   فندق يظهر، هيفضل شعار Calma بس. */
export const HOTEL_NAME = "فندق Calma";

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

/* staff: يشتغل باليومية والحجوزات (عرض + إضافة حجز مباشر) وحالة الغرف (بقيود).
   كل حاجة باينة للمدير العام باينة كمان لمديرة الحسابات ومدير الحجوزات - عرض بس، غير الصلاحيات المحددة لكل دور. */
export const PERMISSIONS = {
  staff: { tabs: ["board", "ledger", "bookings"], editLedger: true, closeShift: true, editBookings: false, canCreateBookings: true, editRoomStatus: true, roomStatusRestricted: true, viewReports: false, viewActivity: false, manageUsers: false, markPaymentReceived: true },
  // markPaymentReceived بقت false لمدير الحجوزات عمدًا - شغله يضيف الحجوزات
  // ويحدد سعرها بس، أما "استلمنا الفلوس فعليًا ولا لأ" فده قرار موظف الشيفت
  // اللي قدام النزيل فعليًا، مش مدير الحجوزات. هو يقدر يشوف المتبقي/المتحصّل
  // (متابعة بس) لكن ميقدرش يغيّره.
  reservations: { tabs: ["board", "bookings", "ledger", "reports", "activity", "users"], editLedger: false, closeShift: false, editBookings: true, canCreateBookings: true, editRoomStatus: true, roomStatusRestricted: false, viewReports: true, viewActivity: true, manageUsers: false, markPaymentReceived: false },
  accounts: { tabs: ["board", "ledger", "bookings", "reports", "activity", "users"], editLedger: false, closeShift: false, editBookings: false, canCreateBookings: false, editRoomStatus: false, roomStatusRestricted: false, viewReports: true, viewActivity: true, manageUsers: false, markPaymentReceived: false },
  gm: { tabs: ["board", "ledger", "bookings", "reports", "activity", "users"], editLedger: false, closeShift: false, editBookings: false, canCreateBookings: false, editRoomStatus: false, roomStatusRestricted: false, viewReports: true, viewActivity: true, manageUsers: true, markPaymentReceived: false },
};

export const BOOKING_SOURCES = ["مباشر", "Booking.com", "Trip.com", "Airbnb", "وسيط"];
export const BOOKING_STATUSES = ["مؤكد", "تم تسجيل الدخول", "تم تسجيل الخروج", "ملغي"];

/* شيلنا خيار "متاحة يدويًا" نهائيًا - مفيش فايدة منه لأن الغرفة أصلاً بترجع
   "متاحة" تلقائيًا لوحدها من حساب الحجوزات لحظة ما معندهاش حجز نشط أو قادم،
   فمكنش له أي استخدام حقيقي يفرق عن الوضع التلقائي. */
export const MANUAL_STATUS_OPTIONS = [
  { key: "auto", label: "تلقائي حسب الحجوزات" },
  { key: "early_checkout", label: "غادر مبكرًا" },
  { key: "maintenance", label: "صيانة" },
  { key: "cleaning", label: "تحت التنظيف" },
];
export const STAFF_ALLOWED_ON_ACTIVE_BOOKING = ["early_checkout"];

/* لون "مشغولة - متبقي فلوس" لازم يكون واضح وبارز ومختلف تمامًا عن باقي
   الألوان (دي أهم حالة تحتاج متابعة فورية - فيه فلوس متأخرة على نزيل).
   و"مشغولة - متحصّلة" بقى أصفر قاتم (مستردي/خردلي) واضح ومختلف عن باقي
   الألوان كمان. */
export const STATUS_COLORS = { available: "#2F7A4A", occupied_paid: "#8C6D00", occupied_unpaid: "#E63946", reserved: "#6B4FA0", maintenance: "#6B5B4D", cleaning: "#2E6B9E", early_checkout: "#C9702B" };

/* الغرفة بقت بس رقمها واسمها (الاسم/الكود المكتوب فعليًا على باب الغرفة في
   الفندق) المسجّلين في قاعدة البيانات - مفيش نوع غرفة ولا سعر ثابت ولا سعة
   ولا أسرّة محفوظة على الغرفة نفسها. كل تفاصيل الحجز (السعر، العملة، عدد
   الأفراد، إلخ) بتتحدد وقت إنشاء/تعديل الحجز في شاشة الحجوزات نفسها، مش من
   بيانات الغرفة. الأسماء دي نسخة احتياطية (fallback) بس لحد ما البيانات
   تتحمّل من قاعدة البيانات - التعديل الحقيقي لأسماء الغرف يتم من هناك
   (supabase/schema.sql أو تعديل مباشر في جدول rooms). */
export const ROOMS_DEFAULT = [
  { number: 601, name: "(t)601داخلي" },
  { number: 602, name: "602(S/D)داخلي" },
  { number: 603, name: "603(T)تراس" },
  { number: 604, name: "(W)604(D)" },
  { number: 605, name: "(b)605(D)" },
  { number: 606, name: "(W)606(T)" },
  { number: 607, name: "(W)607(T)" },
  { number: 608, name: "(b)608(D)" },
  { number: 609, name: "(b)609(D)" },
  { number: 610, name: "(W)610(D)" },
  { number: 611, name: "(W)611(D)" },
  { number: 612, name: "(b)612(D)" },
  { number: 613, name: "(B)613(T)" },
  { number: 614, name: "(W)614(Q)" },
  { number: 615, name: "615(S)داخلي" },
  { number: 616, name: "616(S)داخلي" },
];

// التسمية الكاملة الجاهزة للعرض/السجل لغرفة معينة - "غرفة" + اسمها الحقيقي
// لو متسجل، وإلا "غرفة" + رقمها كاحتياط (مثلاً لو غرفة جديدة اتضافت في
// قاعدة البيانات من غير اسم لسه).
export function roomLabel(rooms, number) {
  const r = rooms?.find((x) => x.number === number);
  return `غرفة ${(r && r.name) ? r.name : number}`;
}
