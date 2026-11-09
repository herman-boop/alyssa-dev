import asyncio
from playwright.async_api import async_playwright
rows=[("20 Jun 2026","Tronton Dump — Surabaya - Makassar (2 unit)","S 8625 HN / S 8614 HN","2","10.600.000","Biaya pengambilan 1.400.000 / unit","24.000.000"),
("25 Jun 2026","Raize — Surabaya - Makassar","G 1037 NK","1","3.900.000","","3.900.000"),
("28 Jun 2026","Grand Max — Surabaya - Lembar","121252, 121258, 121248, 121251","4","2.300.000","","9.200.000"),
("30 Jun 2026","Terios — Surabaya - Makassar","B 2307 KRO","1","3.900.000","","3.900.000"),
("01 Jul 2026","Veloz — Surabaya - Lombok","009503","1","2.300.000","","2.300.000"),
("03 Jul 2026","CR-V — Surabaya - Lombok","B 1089 EJF","1","2.300.000","","2.300.000")]
tr="".join(f"<tr><td>{a}</td><td>{b}</td><td>{c}</td><td style='text-align:center'>{d}</td><td style='text-align:right'>{e}</td><td>{f}</td><td style='text-align:right'>{g}</td></tr>" for a,b,c,d,e,f,g in rows)
html=f"""<html><body style='font-family:Arial;font-size:12px;margin:30px'>
<h2 style='margin:0'>AHMAD TAUFDIQ</h2><div>Jasa Angkutan Kendaraan</div><hr>
<h3>TAGIHAN PENGIRIMAN JUNI–JULI 2026</h3>
<div>Kepada: PT/CV Alyssa &nbsp; Port of Loading: Surabaya</div><br>
<table border=1 cellspacing=0 cellpadding=5 width=100%><tr style='background:#eee'><th>TGL</th><th>DESKRIPSI</th><th>NOPOL / NOKA</th><th>UNIT</th><th>HARGA SATUAN</th><th>KETERANGAN</th><th>JUMLAH</th></tr>{tr}
<tr><td colspan=6 align=right><b>TOTAL TAGIHAN</b></td><td align=right><b>45.600.000</b></td></tr></table></body></html>"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path="/opt/pw-browsers/chromium",args=["--no-sandbox"]); pg=await b.new_page(); await pg.set_content(html)
        await pg.pdf(path="invoice-contoh-ahmad.pdf",format="A4",print_background=True); await b.close()
asyncio.run(main())
