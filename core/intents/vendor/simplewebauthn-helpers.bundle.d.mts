// Declarations for the vendored @simplewebauthn/server@13 helpers bundle (esm.sh pin 13.3.3).
// Only the API surfaces used by the popup server; types deliberately loose (any) — runtime behavior is E2E tested.
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
