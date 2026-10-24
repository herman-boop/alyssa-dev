"""Tes alur akun pengguna (Tahap 1) dengan DB palsu di memori — tanpa Mongo."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import app_users as au  # noqa: E402


class FakeColl:
    def __init__(self):
        self.docs = []

    @staticmethod
    def _match(d, q):
        return all(d.get(k) == v for k, v in q.items())

    async def create_index(self, *a, **k):
        return None

    async def find_one(self, q=None, proj=None):
        for d in self.docs:
            if self._match(d, q or {}):
                return dict(d)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, q, upd, upsert=False):
        for d in self.docs:
            if self._match(d, q):
                d.update(upd.get("$set", {}))
                return
        if upsert:
            new = dict(q)
            new.update(upd.get("$set", {}))
            self.docs.append(new)

    async def find_one_and_update(self, q, upd, upsert=False, return_document=None):
        for d in self.docs:
            if self._match(d, q):
                return dict(d)
        new = dict(q)
        new.update(upd.get("$setOnInsert", {}))
        self.docs.append(new)
        return dict(new)

    async def delete_one(self, q):
        self.docs = [d for d in self.docs if not self._match(d, q)]

    def find(self, q=None, proj=None):
        rows = [dict(d) for d in self.docs if self._match(d, q or {})]

        class Cur:
            def sort(self_, k, *_):
                rows.sort(key=lambda r: r.get(k) or "")
                return self_

            def __aiter__(self_):
                self_.it = iter(rows)
                return self_

            async def __anext__(self_):
                try:
                    return next(self_.it)
                except StopIteration:
                    raise StopAsyncIteration

        return Cur()


class FakeDB:
    def __init__(self):
        self.c = {}

    def __getitem__(self, k):
        return self.c.setdefault(k, FakeColl())


def run(coro):
    return asyncio.run(coro)


def test_full_flow():
    async def go():
        db = FakeDB()
        users = await au.list_users(db)
        assert len(users) == 1 and users[0]["role"] == "pemilik" and users[0]["status"] == "undangan"
        owner_id = users[0]["user_id"]
        # login sebelum punya password ditolak
        try:
            await au.login(db, au.OWNER_EMAIL, "apapun123")
            assert False
        except ValueError:
            pass
        tok = await au.reinvite(db, owner_id)
        assert (await au.invite_info(db, tok))["email"] == au.OWNER_EMAIL
        try:
            await au.accept_invite(db, tok, "pendek", "")
            assert False
        except ValueError:
            pass
        await au.accept_invite(db, tok, "passwordku123", "Hermansyah")
        assert await au.invite_info(db, tok) is None  # sekali pakai
        u, jwt_tok = await au.login(db, au.OWNER_EMAIL.upper(), "passwordku123")
        assert (await au.verify_token(db, jwt_tok))["role"] == "pemilik"
        # undang staf
        pub, t2 = await au.invite(db, "Staf@Contoh.com", "Staf", "keuangan", 30, "tes")
        assert pub["email"] == "staf@contoh.com" and pub["status"] == "undangan"
        try:
            await au.invite(db, "staf@contoh.com", "", "keuangan", None, "tes")
            assert False
        except ValueError:
            pass
        try:
            await au.invite(db, "x@y.com", "", "pemilik", None, "tes")
            assert False
        except ValueError:
            pass
        await au.accept_invite(db, t2, "rahasia1234", "")
        _, staf_tok = await au.login(db, "staf@contoh.com", "rahasia1234")
        assert (await au.verify_token(db, staf_tok))["role"] == "keuangan"
        # nonaktif -> token mati, login ditolak
        await au.update_user(db, pub["user_id"], status="nonaktif")
        assert await au.verify_token(db, staf_tok) is None
        try:
            await au.login(db, "staf@contoh.com", "rahasia1234")
            assert False
        except PermissionError:
            pass
        # Pemilik terlindungi
        for kw in ({"role": "keuangan"}, {"status": "nonaktif"}):
            try:
                await au.update_user(db, owner_id, **kw)
                assert False
            except ValueError:
                pass
        try:
            await au.delete_user(db, owner_id)
            assert False
        except ValueError:
            pass
        # hapus staf -> token mati
        await au.update_user(db, pub["user_id"], status="aktif")
        await au.delete_user(db, pub["user_id"])
        assert await au.verify_token(db, staf_tok) is None
        assert len(await au.list_users(db)) == 1
    run(go())


def test_lockout_and_expiry():
    async def go():
        db = FakeDB()
        await au.list_users(db)
        pub, t = await au.invite(db, "a@b.com", "A", "pembaca", None, "tes")
        await au.accept_invite(db, t, "benar12345", "")
        for _ in range(au.MAX_FAIL):
            try:
                await au.login(db, "a@b.com", "salah")
            except ValueError:
                pass
        try:
            await au.login(db, "a@b.com", "benar12345")
            assert False
        except PermissionError:
            pass
        # masa akses habis
        db2 = FakeDB()
        await au.list_users(db2)
        p2, t2 = await au.invite(db2, "c@d.com", "C", "pembaca", 1, "tes")
        await au.accept_invite(db2, t2, "benar12345", "")
        await db2[au.COLL].update_one({"email": "c@d.com"}, {"$set": {"access_expires_at": "2000-01-01T00:00:00+00:00"}})
        try:
            await au.login(db2, "c@d.com", "benar12345")
            assert False
        except PermissionError:
            pass
    run(go())


def test_can_matrix():
    c = au.can
    # Pemilik: semua
    assert c("pemilik", "DELETE", "/api/admin/users/x") and c("pemilik", "PATCH", "/api/admin/kas/1")
    # Kelola pengguna hanya Pemilik
    for r in ("admin_operasional", "keuangan", "pembaca"):
        assert not c(r, "GET", "/api/admin/users")
    # Admin Operasional: operasional ya, keuangan tidak
    assert c("admin_operasional", "PATCH", "/api/admin/orders/ORD-1")
    assert c("admin_operasional", "POST", "/api/admin/trips")
    assert not c("admin_operasional", "GET", "/api/admin/kas")
    assert not c("admin_operasional", "POST", "/api/admin/expenses")
    assert not c("admin_operasional", "GET", "/api/admin/doc-history")
    # Keuangan: keuangan penuh, selain itu hanya lihat
    assert c("keuangan", "POST", "/api/admin/kas/transfer")
    assert c("keuangan", "GET", "/api/admin/orders")
    assert not c("keuangan", "PATCH", "/api/admin/orders/ORD-1")
    assert not c("keuangan", "DELETE", "/api/admin/trips/T1")
    # Pembaca: hanya GET non-keuangan
    assert c("pembaca", "GET", "/api/admin/orders")
    assert not c("pembaca", "PATCH", "/api/admin/orders/ORD-1")
    assert not c("pembaca", "GET", "/api/admin/kas")
    assert not c("pembaca", "GET", "/api/admin/doc-history")
    # Peran tidak dikenal ditolak
    assert not c("ngawur", "GET", "/api/admin/orders")


def test_enforce_flag():
    async def go():
        db = FakeDB()
        assert await au.get_enforce(db, fresh=True) is False
        assert await au.set_enforce(db, True) is True
        assert await au.get_enforce(db, fresh=True) is True
        assert await au.set_enforce(db, False) is False
        assert await au.get_enforce(db, fresh=True) is False
    run(go())


def test_resolve_admin_from_server_source():
    """Memakai kode ASLI _resolve_admin dari server.py (diambil via AST), tanpa Mongo/FastAPI."""
    import ast
    import types
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    names = {"_admin_locked", "_pin_matches", "_resolve_admin"}
    segs = [ast.get_source_segment(src, n) for n in ast.parse(src).body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]

    class H(Exception):
        def __init__(self, c, d=""):
            self.status_code = c

    db = FakeDB()
    ns = {"os": os, "Optional": __import__("typing").Optional, "HTTPException": H, "app_users": au, "db": db, "Request": object}
    exec("\n".join(segs), ns)
    R = ns["_resolve_admin"]

    class Rq:
        def __init__(self, m, p):
            self.method, self.url = m, types.SimpleNamespace(path=p)

    async def call(m, p, pin=None, tok=None):
        try:
            return (await R(Rq(m, p), pin, f"Bearer {tok}" if tok else None))["kind"]
        except H as e:
            return e.status_code

    async def go():
        saved = {k: os.environ.get(k) for k in ("ADMIN_LOCK", "ADMIN_PIN")}
        try:
            os.environ.pop("ADMIN_LOCK", None)
            os.environ["ADMIN_PIN"] = "1234"
            assert await call("GET", "/api/admin/orders") == "open"  # perilaku lama
            owner = (await au.list_users(db))[0]
            t = await au.reinvite(db, owner["user_id"])
            await au.accept_invite(db, t, "passwordku123", "")
            _, otok = await au.login(db, au.OWNER_EMAIL, "passwordku123")
            _, t2 = await au.invite(db, "k@x.com", "K", "keuangan", None, "t")
            await au.accept_invite(db, t2, "rahasia1234", "")
            _, ktok = await au.login(db, "k@x.com", "rahasia1234")
            assert await call("GET", "/api/admin/kas", tok=ktok) == "user"
            assert await call("PATCH", "/api/admin/orders/1", tok=ktok) == 403
            assert await call("GET", "/api/admin/users", tok=ktok) == 403
            assert await call("GET", "/api/admin/users", tok=otok) == "user"
            assert await call("GET", "/api/admin/kas", tok="ngawur") == "open"  # token basi → perilaku lama
            await au.set_enforce(db, True)
            assert await call("GET", "/api/admin/orders") == 401
            assert await call("GET", "/api/admin/orders", pin="1234") == "pin"  # PIN darurat tetap
            assert await call("GET", "/api/admin/orders", pin="0000") == 401
            assert await call("GET", "/api/admin/orders", tok=otok) == "user"
            assert await call("GET", "/api/admin/orders", tok="ngawur") == 401
            await au.set_enforce(db, False)
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
    run(go())
