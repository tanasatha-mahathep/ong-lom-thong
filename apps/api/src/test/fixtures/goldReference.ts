/**
 * fixture ของแหล่งราคาอ้างอิงสมาคมค้าทองคำ — **สังเคราะห์** (เครือข่ายของเครื่องที่เขียนถูกบล็อก ดึงหน้าจริงไม่ได้)
 * โครง HTML เลียนแบบหน้า ASP.NET WebForms ของ classic.goldtraders.or.th ตาม id ที่ provider อ่าน
 * (`DetailPlace_uc_goldprices1_lbl…` > b > font) · ตัวเลขสมมติรูปแบบเดียวกับประกาศจริง ไม่มีข้อมูลบุคคล
 * JSON ตามตัวอย่างใน README ของ github.com/max180643/thai-gold-api (MIT)
 */

export const GOLDTRADERS_HTML = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>
	สมาคมค้าทองคำ - ราคาทองตามประกาศของสมาคมค้าทองคำ
</title></head>
<body>
<form method="post" action="./default.aspx" id="form1">
<div class="aspNetHidden"><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="c3ludGhldGlj" /></div>
<table id="DetailPlace_uc_goldprices1_GoldPricesUpdatePanel">
  <tr>
    <td colspan="3"><span id="DetailPlace_uc_goldprices1_lblAsTime"><b><font color="#ffffff">29/09/2569 เวลา 09:31 น. (ครั้งที่ 2)</font></b></span></td>
  </tr>
  <tr>
    <td>ทองคำแท่ง 96.5%</td>
    <td><span id="DetailPlace_uc_goldprices1_lblBLBuy"><b><font color="#FFFFFF">67,650.00</font></b></span></td>
    <td><span id="DetailPlace_uc_goldprices1_lblBLSell"><b><font color="#FFFFFF">67,850.00</font></b></span></td>
  </tr>
  <tr>
    <td>ทองรูปพรรณ 96.5%</td>
    <td><span id="DetailPlace_uc_goldprices1_lblOMBuy"><b><font color="#FFFFFF">66,295.52</font></b></span></td>
    <td><span id="DetailPlace_uc_goldprices1_lblOMSell"><b><font color="#FFFFFF">68,650.00</font></b></span></td>
  </tr>
</table>
</form>
</body>
</html>`;

/** ค่าที่ต้องได้จาก GOLDTRADERS_HTML (เงิน 2 ตำแหน่ง · เวลาไทย) */
export const GOLDTRADERS_EXPECTED = {
  barBuy: "67650.00",
  barSell: "67850.00",
  ornamentBuy: "66295.52",
  ornamentSell: "68650.00",
  announcedAt: "2026-09-29T09:31:00+07:00",
  round: 2,
};

export const THAI_GOLD_API_JSON = {
  status: "success",
  response: {
    update_date: "29/09/2569",
    update_time: "เวลา 09:31 น. (ครั้งที่ 2)",
    price: {
      gold: { buy: "66,295.52", sell: "68,650.00" },
      gold_bar: { buy: "67,650.00", sell: "67,850.00" },
    },
  },
};
