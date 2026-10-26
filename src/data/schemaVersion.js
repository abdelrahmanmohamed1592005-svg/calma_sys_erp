/* أقل نسخة مخطط (supabase/schema.sql) تشتغل معاها الواجهة. لازم تتطابق مع calma_schema_version() في آخر schema.sql
   (بيتأكد منه src/__tests__/schemaVersion.test.js). الملف ده من غير أي imports عشان الاختبارات تقرأه على أي نسخة Node. */
export const REQUIRED_SCHEMA_VERSION = 40;
