// Metro for the KNU Field app.
//
// The app shares its API contracts with the CRM: `@crm/mobile-api` is the
// CRM's own src/lib/mobile-api (pure zod, no server code). Metro is allowed to
// read that one folder, and `zod` imported from it resolves to this app's own
// copy, so a build never depends on the CRM's node_modules being installed.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const sharedContracts = path.resolve(projectRoot, "../src/lib/mobile-api");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), sharedContracts];

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@crm/mobile-api") {
    return { type: "sourceFile", filePath: path.join(sharedContracts, "index.ts") };
  }
  if (moduleName === "zod" || moduleName.startsWith("zod/")) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, "package.json") },
      moduleName,
      platform,
    );
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
