"""Build the encrypted Zotero credentials bundle for the public site.

Reads from the environment:
    Required:
        ZOTERO_API_KEY, ZOTERO_USER_ID, SITE_PASSWORD
    Optional (PDF auto-attach pipeline):
        PDF_PROXY_URL    Cloudflare Worker that proxies arXiv PDFs around
                         CORS and forwards PUTs to WebDAV.
        WEBDAV_URL       Full directory where Zotero stores attachments,
                         e.g. https://mori.teracloud.jp/dav/zotero (no
                         trailing slash). Must match what Zotero desktop
                         actually uses, INCLUDING the /zotero/ subpath
                         that desktop appends after its own settings.
        WEBDAV_USER      Basic-auth username for WebDAV.
        WEBDAV_PASS      Basic-auth password for WebDAV.

Encrypts everything with a key derived from SITE_PASSWORD via PBKDF2-SHA256
and writes the result to ``js/secrets.enc.js`` as a JS-loadable bundle that
``js/crypto.js`` can decrypt browser-side with the right password.

The Worker URL and WebDAV credentials are encrypted in the same bundle so
casual visitors viewing the public site never see them — only password
holders can decrypt and use them.

Salt and nonce are derived deterministically from SHA-512(all_inputs ||
password). Output stays stable across rebuilds when inputs are unchanged
(no diff churn); any change to the plaintext yields a fresh nonce, so
AES-GCM nonce-reuse never happens.

If a required Zotero env var is missing, the script writes a "disabled"
placeholder so the front-end can show a friendly "personal mode not
configured" message instead of crashing. Each optional field can be empty
independently — the front-end gracefully falls back to linked-URL only when
WebDAV creds are absent.

Run locally (PowerShell):
    $env:ZOTERO_API_KEY = "..."
    $env:ZOTERO_USER_ID = "..."
    $env:SITE_PASSWORD = "..."
    $env:PDF_PROXY_URL = "https://your-worker.workers.dev"
    $env:WEBDAV_URL = "https://mori.teracloud.jp/dav/zotero"
    $env:WEBDAV_USER = "..."
    $env:WEBDAV_PASS = "..."
    python build_secrets.py
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

PROJECT_ROOT = Path(__file__).resolve().parent
JS_DIR = PROJECT_ROOT / "js"
OUTPUT_FILE = JS_DIR / "secrets.enc.js"

# 600k iterations of PBKDF2-SHA256 ≈ 300 ms decrypt in modern browsers.
# Slow enough to make brute force expensive, fast enough that one-shot
# decryption on login is unnoticed.
PBKDF2_ITERATIONS = 600_000


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _derive_iv_material(*parts: str) -> bytes:
    """SHA-512 of all inputs concatenated with NUL separators → 64 bytes of
    deterministic randomness. First 16 bytes feed the PBKDF2 salt, next 12 the
    AES-GCM nonce. Any change to inputs yields a fresh nonce, so AES-GCM
    safety holds.

    The leading prefix is bumped each time the payload schema changes, which
    forces a fresh salt/nonce so old browser caches can't accidentally pair a
    new ciphertext with a stale salt.
    """
    h = hashlib.sha512()
    h.update(b"daily-arxiv-secrets-v3\0")  # bumped: WebDAV creds added
    for part in parts:
        h.update(part.encode("utf-8"))
        h.update(b"\0")
    return h.digest()


def _write_disabled() -> None:
    JS_DIR.mkdir(exist_ok=True)
    OUTPUT_FILE.write_text(
        "// Personal mode is not configured (secrets missing at build time).\n"
        "// To enable: set ZOTERO_API_KEY, ZOTERO_USER_ID, and SITE_PASSWORD\n"
        "// (PDF_PROXY_URL and WEBDAV_* optional), then re-run build_secrets.py.\n"
        "window.__ZOTERO_ENC = null;\n",
        encoding="utf-8",
    )
    logging.warning("Wrote disabled placeholder to %s", OUTPUT_FILE)


def main() -> None:
    api_key = os.environ.get("ZOTERO_API_KEY", "").strip()
    user_id = os.environ.get("ZOTERO_USER_ID", "").strip()
    password = os.environ.get("SITE_PASSWORD", "")
    pdf_proxy_url = os.environ.get("PDF_PROXY_URL", "").strip()
    webdav_url = os.environ.get("WEBDAV_URL", "").strip().rstrip("/")
    webdav_user = os.environ.get("WEBDAV_USER", "").strip()
    webdav_pass = os.environ.get("WEBDAV_PASS", "")

    missing = [
        name
        for name, value in [
            ("ZOTERO_API_KEY", api_key),
            ("ZOTERO_USER_ID", user_id),
            ("SITE_PASSWORD", password),
        ]
        if not value
    ]
    if missing:
        logging.warning(
            "Missing env vars: %s. Personal mode will be disabled.",
            ", ".join(missing),
        )
        _write_disabled()
        return

    if len(password) < 8:
        logging.error("SITE_PASSWORD must be at least 8 characters. Aborting.")
        raise SystemExit(2)

    webdav_complete = bool(webdav_url and webdav_user and webdav_pass)
    webdav_partial = (
        any([webdav_url, webdav_user, webdav_pass]) and not webdav_complete
    )
    if webdav_partial:
        logging.warning(
            "WEBDAV_URL/USER/PASS are partially set — WebDAV upload will be "
            "disabled. Set all three (or none) to silence this warning."
        )

    iv_material = _derive_iv_material(
        api_key, user_id, pdf_proxy_url, webdav_url, webdav_user, webdav_pass, password
    )
    salt = iv_material[:16]
    nonce = iv_material[16:28]

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    aes_key = kdf.derive(password.encode("utf-8"))

    payload = json.dumps(
        {
            "apiKey": api_key,
            "userId": user_id,
            "pdfProxyUrl": pdf_proxy_url,
            "webdavUrl": webdav_url if webdav_complete else "",
            "webdavUser": webdav_user if webdav_complete else "",
            "webdavPass": webdav_pass if webdav_complete else "",
        },
        separators=(",", ":"),
    ).encode("utf-8")

    ciphertext = AESGCM(aes_key).encrypt(nonce, payload, None)

    JS_DIR.mkdir(exist_ok=True)
    OUTPUT_FILE.write_text(
        "// Auto-generated by build_secrets.py — do not edit by hand.\n"
        "// AES-GCM ciphertext keyed off SITE_PASSWORD via PBKDF2-SHA256.\n"
        "// Safe to publish: without the password, neither the API key, the\n"
        "// proxy URL, nor the WebDAV credentials can be recovered.\n"
        "window.__ZOTERO_ENC = {\n"
        f'  salt: "{_b64(salt)}",\n'
        f'  nonce: "{_b64(nonce)}",\n'
        f'  ciphertext: "{_b64(ciphertext)}",\n'
        f"  iterations: {PBKDF2_ITERATIONS}\n"
        "};\n",
        encoding="utf-8",
    )
    logging.info(
        "Wrote encrypted secrets bundle: %s (ciphertext %d bytes, proxy %s, webdav %s)",
        OUTPUT_FILE,
        len(ciphertext),
        "embedded" if pdf_proxy_url else "(none)",
        "embedded" if webdav_complete else "(none)",
    )


if __name__ == "__main__":
    main()
