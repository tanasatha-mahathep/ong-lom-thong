-- plpgsql ที่ Drizzle generate ไม่ได้ — คัดลอกเข้า custom migration (drizzle-kit generate --custom)

-- เลขที่เอกสารต่อสาขาต่องวด: INSERT … ON CONFLICT DO UPDATE ล็อกแถวเดียว → ไม่มีวันชนแม้เปิดบิลพร้อมกัน
-- RC + ปี พ.ศ. 2 หลัก + เดือน + '-' + running 4 หลัก  เช่น RC6910-0001
CREATE OR REPLACE FUNCTION next_doc_no(p_branch uuid, p_prefix text, p_date date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_period text;
  v_no integer;
BEGIN
  v_period := lpad(((extract(year from p_date)::int + 543) % 100)::text, 2, '0')
           || lpad(extract(month from p_date)::int::text, 2, '0');
  INSERT INTO doc_sequence (branch_id, prefix, period, last_no)
  VALUES (p_branch, p_prefix, v_period, 1)
  ON CONFLICT (branch_id, prefix, period)
  DO UPDATE SET last_no = doc_sequence.last_no + 1
  RETURNING last_no INTO v_no;
  RETURN p_prefix || v_period || '-' || lpad(v_no::text, 4, '0');
END
$$;

-- R4 ระดับ DB: Σ payment.amount ต้องเท่ากับ buy_receipt.total_amount พอดี
-- ตรวจตอน commit (DEFERRABLE INITIALLY DEFERRED) ให้ api insert หัวบิล/แถว/ชำระ ในทรานแซกชันเดียวได้
CREATE OR REPLACE FUNCTION check_receipt_paid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_receipt uuid;
  v_total numeric;
  v_paid numeric;
BEGIN
  IF TG_TABLE_NAME = 'payment' THEN
    v_receipt := COALESCE(NEW.receipt_id, OLD.receipt_id);
  ELSE
    v_receipt := COALESCE(NEW.id, OLD.id);
  END IF;

  SELECT total_amount INTO v_total FROM buy_receipt WHERE id = v_receipt;
  IF v_total IS NULL THEN
    RETURN NULL; -- บิลถูกลบไปแล้ว (cascade)
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_paid FROM payment WHERE receipt_id = v_receipt;
  IF v_paid <> v_total THEN
    RAISE EXCEPTION 'ยอดชำระไม่ตรงกับยอดบิล (บิล % ชำระ %)', v_total, v_paid
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS payment_paid_check ON payment;
CREATE CONSTRAINT TRIGGER payment_paid_check
  AFTER INSERT OR UPDATE OR DELETE ON payment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_receipt_paid();

DROP TRIGGER IF EXISTS buy_receipt_paid_check ON buy_receipt;
CREATE CONSTRAINT TRIGGER buy_receipt_paid_check
  AFTER INSERT OR UPDATE OF total_amount ON buy_receipt
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_receipt_paid();
