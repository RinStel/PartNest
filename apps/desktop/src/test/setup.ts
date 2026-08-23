import "@testing-library/jest-dom/vitest";

// jsdom's TextEncoder can return a Uint8Array from another realm. Vite's
// config loader expects the host Uint8Array invariant while importing config
// objects in tests.
const JsdomTextEncoder = globalThis.TextEncoder;
if (JsdomTextEncoder) {
  globalThis.TextEncoder = class CompatibleTextEncoder extends JsdomTextEncoder {
    override encode(input = "") {
      return Uint8Array.from(super.encode(input));
    }
  };
}
