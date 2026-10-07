"""Pisah unit supplier ke FAKTUR (projek) baru — logika murni (tanpa I/O) supaya mudah diuji.

1 faktur = 1 projek supplier (boleh banyak unit). No. Faktur SELALU otomatis (dibuat pemanggil
lewat counter atomik), tidak pernah manual. Hanya memindahkan `project_id` unit — tidak mengubah
nominal, pembayaran, atau rekon."""


def reusable_project(jobs, projects, chosen):
    """Idempoten: kalau SEMUA unit terpilih sudah berada di 1 projek yang isinya persis unit itu
    saja, pakai projek itu (jangan bikin faktur baru tiap kali ditekan)."""
    chosen = set(chosen)
    pids = {(j.get("project_id") or "") for j in jobs if j.get("id") in chosen}
    if len(pids) != 1:
        return None
    pid = next(iter(pids))
    if not pid:
        return None
    members = {j.get("id") for j in jobs if (j.get("project_id") or "") == pid}
    if members != chosen:
        return None
    return next((p for p in projects if p.get("id") == pid), None)


def move_to_new_project(jobs, projects, chosen, new_id, no_faktur, nama, closed, now_iso):
    """Buat projek (faktur) baru + pindahkan unit terpilih ke sana. `closed` = semua unit sudah
    lunas → projek langsung 'closed' (selesai) supaya TIDAK jadi projek aktif penampung unit baru;
    kalau belum lunas semua → 'open' tapi diletakkan PALING DEPAN (projek aktif = open terakhir)."""
    chosen = set(chosen)
    proj = {"id": new_id, "nama": (nama or no_faktur)[:80], "status": "closed" if closed else "open",
            "no_faktur": no_faktur, "created_at": now_iso, "closed_at": now_iso if closed else None}
    new_jobs = []
    for j in jobs:
        j = dict(j)
        if j.get("id") in chosen:
            j["project_id"] = new_id
        new_jobs.append(j)
    new_projects = (list(projects) + [proj]) if closed else ([proj] + list(projects))
    return new_jobs, new_projects, proj
