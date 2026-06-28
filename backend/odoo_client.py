"""Odoo XML-RPC stub (v2.6b).

When env vars ODOO_URL / ODOO_DB / ODOO_USER / ODOO_KEY are all set, this module
provides authenticated calls to Odoo's external API. When any of them is empty,
all functions become no-ops (logged only) so the app keeps working with the
webhook-style notify_odoo() already in server.py.

Lightweight design — no extra deps. Uses Python's stdlib xmlrpc.client.

USAGE (from server.py):
    from odoo_client import OdooClient
    odoo = OdooClient()           # auto-loads env on instantiation
    if odoo.enabled:
        odoo.call("res.partner", "create", [{"name": "PT X"}])

NOT YET WIRED to write any Odoo records — kept as a safe scaffold so user can
fill credentials and we can enable real sync without code churn.
"""
from __future__ import annotations
import os
import logging
import xmlrpc.client
from typing import Any, List, Optional

logger = logging.getLogger(__name__)


class OdooClient:
    def __init__(self) -> None:
        raw_url = os.environ.get("ODOO_URL", "").strip().rstrip("/")
        if raw_url and not raw_url.startswith(("http://", "https://")):
            raw_url = "https://" + raw_url
        self.url = raw_url
        self.db = os.environ.get("ODOO_DB", "").strip()
        self.user = os.environ.get("ODOO_USER", "").strip()
        self.key = os.environ.get("ODOO_KEY", "").strip()
        self.uid: Optional[int] = None
        self._common = None
        self._models = None

    @property
    def enabled(self) -> bool:
        return bool(self.url and self.db and self.user and self.key)

    def authenticate(self) -> Optional[int]:
        if not self.enabled:
            return None
        if self.uid:
            return self.uid
        try:
            self._common = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/common", allow_none=True)
            self.uid = self._common.authenticate(self.db, self.user, self.key, {})
            if not self.uid:
                logger.warning("[odoo] authenticate returned no uid")
                return None
            self._models = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/object", allow_none=True)
            return self.uid
        except Exception as e:
            logger.warning(f"[odoo:auth_fail] {e}")
            self.uid = None
            return None

    def call(self, model: str, method: str, args: List[Any], kwargs: Optional[dict] = None) -> Any:
        """Execute a generic Odoo external method.
        Returns None on failure or when not configured (so callers can fire-and-forget).
        """
        if not self.enabled:
            logger.info(f"[odoo:skip:{model}.{method}] not configured")
            return None
        if not self.authenticate():
            return None
        try:
            return self._models.execute_kw(
                self.db, self.uid, self.key,
                model, method, args, kwargs or {},
            )
        except Exception as e:
            logger.warning(f"[odoo:call_fail] {model}.{method}: {e}")
            return None

    def ping(self) -> dict:
        """Diagnostic: return enabled flag + Odoo server version when possible."""
        if not self.enabled:
            return {"enabled": False, "reason": "missing ODOO_URL/DB/USER/KEY env vars"}
        try:
            common = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/common", allow_none=True)
            ver = common.version()
            return {"enabled": True, "url": self.url, "db": self.db, "user": self.user, "server_version": ver}
        except Exception as e:
            return {"enabled": True, "url": self.url, "db": self.db, "user": self.user, "error": str(e)}
