import assert from "node:assert/strict";
import test from "node:test";

import { resolvePublicAssetPath } from "../src/static-asset-path.js";

test("resolvePublicAssetPath serves known root assets inside public", () => {
  const publicDir = "/app/public";

  assert.equal(resolvePublicAssetPath(publicDir, "/"), "/app/public/index.html");
  assert.equal(resolvePublicAssetPath(publicDir, "/favicon.ico"), "/app/public/favicon.svg");
  assert.equal(resolvePublicAssetPath(publicDir, "/styles.css"), "/app/public/styles.css");
});

test("resolvePublicAssetPath rejects traversal outside public", () => {
  const publicDir = "/app/public";

  assert.equal(resolvePublicAssetPath(publicDir, "/../public-secrets/hidden.txt"), null);
  assert.equal(resolvePublicAssetPath(publicDir, "/../../etc/passwd"), null);
});
