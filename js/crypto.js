// PBKDF2 + AES-GCM helpers used by index.html (the password gate).
//
// Pairs with build_secrets.py: that script ships an encrypted credentials
// bundle as window.__ZOTERO_ENC; this module decrypts it given the user's
// password. Pure browser-side — the password never leaves the device.

(function (global) {
  function base64Decode(str) {
    const bin = atob(str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /**
   * Decrypt the credentials bundle published by build_secrets.py.
   * @param {string} password
   * @returns {Promise<{apiKey: string, userId: string}>}
   * @throws {Error} 'personal mode not configured' if no bundle is shipped.
   * @throws {Error} 'wrong password' if decryption fails (auth tag mismatch).
   */
  async function decryptZoteroBundle(password) {
    const enc = global.__ZOTERO_ENC;
    if (!enc) throw new Error("personal mode not configured");

    const salt = base64Decode(enc.salt);
    const nonce = base64Decode(enc.nonce);
    const ciphertext = base64Decode(enc.ciphertext);

    const passwordKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    const aesKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: enc.iterations,
        hash: "SHA-256",
      },
      passwordKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    let plaintext;
    try {
      const buf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce },
        aesKey,
        ciphertext
      );
      plaintext = new TextDecoder().decode(buf);
    } catch (e) {
      throw new Error("wrong password");
    }

    return JSON.parse(plaintext);
  }

  global.decryptZoteroBundle = decryptZoteroBundle;
})(window);
