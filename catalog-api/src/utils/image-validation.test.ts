import assert from "node:assert/strict";
import test from "node:test";
import { detectImageMimeType } from "./image-validation";

test("detectImageMimeType recognizes supported image signatures", () => {
  assert.equal(detectImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectImageMimeType(Buffer.from("RIFF0000WEBP")), "image/webp");
});

test("detectImageMimeType rejects incomplete and non-image signatures", () => {
  assert.equal(detectImageMimeType(Buffer.from("not an image")), null);
  assert.equal(detectImageMimeType(Buffer.from([0xff, 0xd8])), null);
});