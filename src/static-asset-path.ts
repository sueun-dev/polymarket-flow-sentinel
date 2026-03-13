import path from "node:path";

export function resolvePublicAssetPath(publicDir: string, requestPath: string): string | null {
  const assetPath =
    requestPath === "/"
      ? "/index.html"
      : requestPath === "/favicon.ico"
        ? "/favicon.svg"
        : requestPath;
  const resolvedPath = path.resolve(publicDir, `.${assetPath}`);
  const relativePath = path.relative(publicDir, resolvedPath);

  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return resolvedPath;
  }

  return null;
}
