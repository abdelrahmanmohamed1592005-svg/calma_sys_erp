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
  reservations: { tabs: ["board", "bookings", "ledger", "reports", "activity", "users"], editLedger: false, closeShift: false, editBookings: true, canCreateBookings: true, editRoomStatus: true, roomStatusRestricted: false, viewReports: true, viewActivity: true, manageUsers: false, markPaymentReceived: true },
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
   الألوان (دي أهم حالة تحتاج متابعة فورية - فيه فلوس متأخرة على نزيل). */
export const STATUS_COLORS = { available: "#2F7A4A", occupied_paid: "#1F4B4A", occupied_unpaid: "#E63946", reserved: "#6B4FA0", maintenance: "#6B5B4D", cleaning: "#2E6B9E", early_checkout: "#C9702B" };

/* الغرفة بقت بس رقمها المسجل في قاعدة البيانات - مفيش نوع غرفة ولا سعر
   ثابت ولا سعة ولا أسرّة محفوظة على الغرفة نفسها. كل تفاصيل الحجز (السعر،
   العملة، عدد الأفراد، إلخ) بتتحدد وقت إنشاء/تعديل الحجز في شاشة الحجوزات
   نفسها، مش من بيانات الغرفة. */
export const ROOMS_DEFAULT = [
  { number: 601 }, { number: 602 }, { number: 603 }, { number: 604 }, { number: 605 }, { number: 606 },
  { number: 607 }, { number: 608 }, { number: 609 }, { number: 610 }, { number: 611 }, { number: 612 },
  { number: 613 }, { number: 614 }, { number: 615 }, { number: 616 },
];
