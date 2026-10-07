/* eslint-disable */
/* ============================================================
   LAPORAN REKONSILIASI — hitung data (MURNI: tanpa I/O, tanpa import).
   Hanya MEMBACA dokumen supplier yang sudah tersimpan (GET /admin/suppliers/{id}):
   jobs[] (sudah termasuk total_terbayar/sisa dari alokasi rekon) + rekon_payments[].
   TIDAK membuat pembayaran, TIDAK mengubah alokasi/status/skema.

   Grouping (bukan berdasarkan nama supplier):
   - Unit/PO  = job_id yang dicentang.
   - Transaksi bank = rekon_payments aktif yang allocations[].job_id menunjuk ke job2 itu
     (kunci: bank_transaction_id).
   - Biaya admin bank (tanpa alokasi) = rekon_payments aktif milik supplier yang SAMA,
     tanggal SAMA dengan transfer di batch, entitas SAMA.
   ============================================================ */

const BANK_FEE_RE = /\bBIAYA\s*(TXN|TRX|TRANSAKSI|ADM|ADMIN)\b/i;

export function isBankFee(p) {
  const x = p || {};
  return BANK_FEE_RE.test(`${x.catatan || ""} ${(x.rekon || {}).referensi_bank || ""}`);
}

const n0 = (v) => Math.round(Number(v) || 0);
const dayOf = (s) => String(s || "").slice(0, 10);

export function buildRekonReportData(sup, jobIds) {
  const sel = new Set(jobIds || []);
  const jobs = (sup.jobs || []).filter((j) => sel.has(j.id));
  const projects = Object.fromEntries((sup.projects || []).map((p) => [p.id, p]));

  const rows = jobs.map((j, i) => {
    const tagihan = n0(j.total_harga);
    const dibayar = n0(j.total_terbayar);
    const sisa = j.sisa != null ? n0(j.sisa) : tagihan - dibayar;
    return {
      no: i + 1,
      ref: j.order_id || j.trip_id || "",
      nopol: j.nopol || j.no_rangka || "",
      rute: `${j.asal_kota || "-"} → ${j.tujuan_kota || "-"}`,
      tagihan, dibayar, sisa,
      status: sisa <= 0 ? "Lunas" : (dibayar > 0 ? "Sebagian" : "Belum"),
      project_id: j.project_id || "",
    };
  });

  const active = (sup.rekon_payments || []).filter((p) => p.status !== "reversed");
  const allocTo = (p) => (p.allocations || []).filter((a) => sel.has(a.job_id));
  const linked = active.filter((p) => allocTo(p).length > 0);

  // Biaya admin bank TANPA alokasi ke PO ini: kaitkan lewat tanggal + entitas yang sama dgn transfer batch.
  const keyOf = (p) => `${dayOf(p.tanggal)}|${p.source_entity || (p.rekon || {}).source_entity || ""}`;
  const batchKeys = new Set(linked.filter((p) => !isBankFee(p)).map(keyOf));
  const linkedIds = new Set(linked.map((p) => p.id));
  const feeExtra = active.filter((p) => isBankFee(p) && !linkedIds.has(p.id) && batchKeys.has(keyOf(p)));

  const tx = [...linked, ...feeExtra]
    .sort((a, b) => dayOf(a.tanggal).localeCompare(dayOf(b.tanggal)) || String(a.bank_transaction_id || "").localeCompare(String(b.bank_transaction_id || "")))
    .map((p, i) => {
      const fee = isBankFee(p);
      const amount = n0(p.amount);
      const mine = allocTo(p);
      const allocated = mine.reduce((a, x) => a + n0(x.amount), 0);
      let status;
      if (fee) status = allocated > 0 ? "Dialokasikan (biaya admin)" : "Biaya admin bank — tidak mengurangi hutang";
      else if (allocated >= amount && amount > 0) status = `Dialokasikan · ${mine.length} unit`;
      else if (allocated > 0) status = `Sebagian · ${mine.length} unit (sisa ${amount - allocated})`;
      else status = "Belum dialokasikan";
      return {
        no: i + 1, tanggal: dayOf(p.tanggal), ket: String(p.catatan || "").trim() || "-",
        btx: p.bank_transaction_id || "", amount, allocated, units: mine.length, fee, status,
        entity: (p.rekon || {}).source_entity_label || p.source_entity || (p.rekon || {}).source_entity || "",
      };
    });

  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const principal = tx.filter((t) => !t.fee);
  const fees = tx.filter((t) => t.fee);
  const tagihan = sum(rows, (r) => r.tagihan);
  const dibayar = sum(rows, (r) => r.dibayar);
  const sisa = sum(rows, (r) => r.sisa);
  const rekonAlloc = sum(tx, (t) => t.allocated);        // alokasi rekon ke PO ini (apa adanya di data)
  const manual = Math.max(0, dibayar - rekonAlloc);         // sisanya = pembayaran manual / sumber lain
  const entities = [...new Set(tx.map((t) => t.entity).filter(Boolean))];
  const pids = [...new Set(rows.map((r) => r.project_id).filter(Boolean))];
  const fakturNo = pids.length === 1 && (projects[pids[0]] || {}).no_faktur ? projects[pids[0]].no_faktur : "";

  return {
    supplier: sup.nama || "-", entities, fakturNo,
    rows, tx,
    ringkasan: {
      jumlahUnit: rows.length,
      tagihan,
      trxPokok: sum(principal, (t) => t.amount),         // transaksi bank (transfer pokok) di batch
      dialokasi: rekonAlloc,                              // pembayaran rekon yang teralokasi ke PO
      manual,
      sisa,
    },
    total: {
      trxSemua: sum(tx, (t) => t.amount),
      biayaAdmin: sum(fees, (t) => t.amount),
      biayaAdminTeralokasi: sum(fees, (t) => t.allocated),
      dialokasi: rekonAlloc,
      sisaSupplier: sup.grand_sisa != null ? n0(sup.grand_sisa) : sum(sup.jobs || [], (j) => n0(j.sisa)),
    },
  };
}
