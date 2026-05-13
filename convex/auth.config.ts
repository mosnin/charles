/**
 * Clerk -> Convex JWT bridge.
 *
 * Convex reads this file at deploy time and validates inbound function
 * calls against the named provider. Clerk issues a JWT under a custom
 * template named "convex" (the applicationID below); the issuer domain
 * is the founder's Clerk instance URL.
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN ?? '',
      applicationID: 'convex',
    },
  ],
};
