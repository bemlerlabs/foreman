// Deklarationen für den vendored @simplewebauthn/server@13 helpers-Bundle (esm.sh-Pin 13.3.3).
// Nur die vom Popup-Server genutzten API-Flächen; Typen bewusst lose (any) — Laufzeitverhalten ist E2E getestet.
export const isoCBOR: {
  decodeFirst(bytes: Uint8Array): unknown;
  encode(value: unknown): Uint8Array;
};
export const isoBase64URL: {
  toBuffer(b64url: string): Uint8Array;
  fromBuffer(bytes: Uint8Array): string;
};
export function decodeAttestationObject(bytes: Uint8Array): unknown;
export function parseAuthenticatorData(bytes: Uint8Array): unknown;
