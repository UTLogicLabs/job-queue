// Node's ESM loader does not remap ".js" specifiers to ".ts" siblings, unlike the
// moduleResolution: "Bundler" behavior tsconfig.json declares (which Vite/Vitest already
// implement on their own). Every workspace's source imports relative modules with a ".js"
// extension per the TypeScript NodeNext convention, so raw `node --experimental-strip-types`
// needs this hook to resolve them without an actual compiled build step.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" && specifier.endsWith(".js")) {
      return nextResolve(specifier.replace(/\.js$/, ".ts"), context);
    }
    throw err;
  }
}
