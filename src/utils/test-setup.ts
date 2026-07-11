// FileReader polyfill for Bun test environment
if (typeof globalThis.FileReader === "undefined") {
  class MockFileReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL(blob: Blob) {
      // Blob can't be read in mock, so we return the blob type as a minimal data URL
      this.result = `data:${blob.type || "image/png"};base64,mock`;
      if (this.onload) this.onload();
    }
  }
  globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
}
