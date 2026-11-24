export function toPosixPath(path) {
  return path.replaceAll("\\", "/");
}

export function isTextPath(path) {
  return !/\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|exe|dll|so|dylib|node|bin)$/i.test(path);
}
