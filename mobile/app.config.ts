import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json, plus one development-only setting.
 *
 * A development build loads its code from a Metro server on the developer's
 * Mac and talks to test servers there, over plain http on a Tailscale address
 * (100.x), which iOS's App Transport Security refuses. EAS sets
 * EAS_BUILD_PROFILE while building, so only the `development` profile gets
 * the exception. Preview and production builds keep ATS in full: they talk
 * to https://crm.careyos.com and https://app.careyos.com.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (process.env.EAS_BUILD_PROFILE !== "development") return base;
  return {
    ...base,
    ios: {
      ...base.ios,
      infoPlist: {
        ...base.ios?.infoPlist,
        // NSAllowsArbitraryLoads alone: iOS ignores it when NSAllowsLocalNetworking
        // is also present, and a Tailscale 100.x address is not "local" to iOS.
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      },
    },
  };
};
