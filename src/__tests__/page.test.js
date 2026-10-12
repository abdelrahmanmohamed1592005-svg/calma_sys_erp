import { describe, it, expect } from "vitest";
import { fetchAll } from "../data/page";

// استعلام وهمي بيتصرّف زي PostgREST: بيقصّ كل رد عند maxRows (من غير خطأ) ويرجّع count الكلي
const fakeQuery = (rows, maxRows, { withCount = true, failAtPage = null } = {}) => () => ({
  range: async (from, to) => {
    if (failAtPage != null && Math.floor(from / 1000) === failAtPage) return { error: { message: "boom" }, data: null };
    const slice = rows.slice(from, Math.min(to + 1, from + maxRows));
    return { data: slice, error: null, count: withCount ? rows.length : null };
  },
});
const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe("fetchAll - قراءة كل الصفوف على صفحات", () => {
  it("أكتر من ١٠٠٠ صف (حد Supabase) بتتجاب كلها بالترتيب من غير تكرار", async () => {
    const { data } = await fetchAll(fakeQuery(mk(2500), 1000));
    expect(data).toHaveLength(2500);
    expect(data.map((r) => r.id)).toEqual(mk(2500).map((r) => r.id));
  });
  it("لو السيرفر بيقصّ الصفحة أصغر من المطلوب (db-max-rows أقل) بنكمّل لحد الآخر", async () => {
    const { data } = await fetchAll(fakeQuery(mk(95), 10), 50);
    expect(data).toHaveLength(95);
  });
  it("من غير count بنكمّل لحد صفحة ناقصة", async () => {
    const { data } = await fetchAll(fakeQuery(mk(2100), 1000, { withCount: false }));
    expect(data).toHaveLength(2100);
  });
  it("جدول فاضي وجدول بالظبط حجم الصفحة", async () => {
    expect((await fetchAll(fakeQuery([], 1000))).data).toEqual([]);
    expect((await fetchAll(fakeQuery(mk(1000), 1000))).data).toHaveLength(1000);
    expect((await fetchAll(fakeQuery(mk(1000), 1000, { withCount: false }))).data).toHaveLength(1000);
  });
  it("فشل في أي صفحة = فشل كله (مفيش نتيجة ناقصة بتتعرض كأنها كاملة)", async () => {
    const r = await fetchAll(fakeQuery(mk(2500), 1000, { failAtPage: 1 }));
    expect(r.error).toBeTruthy();
    expect(r.data).toBeUndefined();
  });
});
