import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

export type SecretBox = { seal(plain: string): string; open(sealed: string): string };

/** AES-256-GCM with a key derived from DAILYBRIEF_SECRET. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function makeSecretBox(secret: string): SecretBox {
  const key = Buffer.from(hkdfSync("sha256", secret, "", "dailybrief:secretbox:v1", 32));
  return {
    seal(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return ["v1", iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
    },
    open(sealed) {
      const [version, iv, tag, ct] = sealed.split(".");
      if (version !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unrecognised sealed secret");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
    },
  };
}

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
