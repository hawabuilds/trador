/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A production build writes a different chunk map than the dev server's, so
  // running one against a live `next dev` leaves it loading modules that no
  // longer exist. `npm run verify` builds into its own directory instead.
  distDir: process.env.BUILD_DIR || ".next",
  images: {
    remotePatterns: [{protocol: "https", hostname: "pbs.twimg.com"}],
  },
  experimental: {
    // Every Solana SDK is server-only by design: instructions are built in an
    // API route and the browser only ever signs the serialized bytes. Keeping
    // them external means none of it is bundled for the client, which is what
    // lets web3.js v1 and Privy's kit-based signer coexist without meeting.
    serverComponentsExternalPackages: [
      "sharp",
      "pg",
      "web-push",
      "@coral-xyz/anchor",
      "@nirholas/pump-sdk",
      "@raydium-io/raydium-sdk-v2",
      "@solana/web3.js",
      "@solana/spl-token",
    ],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {key: "Service-Worker-Allowed", value: "/"},
          {key: "Cache-Control", value: "no-cache"},
        ],
      },
    ];
  },
  webpack: (config, {isServer}) => {
    // Privy's connector barrel references integrations this app does not ship:
    // Farcaster mini-apps, React Native storage, MetaMask's SDK connector and
    // Coinbase's x402 payment protocol. They are optional peers, so resolving
    // them to false keeps the bundle honest instead of pulling in SDKs nothing
    // here calls.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
      "@react-native-async-storage/async-storage": false,
      "@metamask/connect-evm": false,
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm/exact/client": false,
    };

    // The Solana SDKs must never reach a client bundle. If an import path ever
    // drags one in, failing the build here is far cheaper than shipping 1.5 MB
    // of Anchor to a phone and discovering it from a Lighthouse score.
    if (!isServer) {
      config.resolve.alias["@coral-xyz/anchor"] = false;
      config.resolve.alias["@nirholas/pump-sdk"] = false;
      config.resolve.alias["@raydium-io/raydium-sdk-v2"] = false;
    }

    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
