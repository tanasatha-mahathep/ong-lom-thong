-- next_doc_no: เลขลำดับ ≥ 10000 ต้องไม่ถูกตัด — lpad(…, 4) ของ Postgres ตัดสตริงที่ยาวกว่า
-- (10000 → "1000") ทำให้ชน UNIQUE (branch_id, doc_no) แล้วสาขานั้นออกบิลไม่ได้ทั้งงวด
-- ต้องตรงกับ packages/db/sql/functions.sql เสมอ
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
  RETURN p_prefix || v_period || '-' || lpad(v_no::text, greatest(4, length(v_no::text)), '0');
END
$$;
