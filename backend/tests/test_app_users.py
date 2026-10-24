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

    async def update_one(self, q, upd):
        for d in self.docs:
            if self._match(d, q):
                d.update(upd.get("$set", {}))
                return

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
