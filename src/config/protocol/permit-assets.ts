/**
 * V2-FE-050 — Reviewed EIP-2612 permit assets
 *
 * Permit signing is offered ONLY for tokens listed here. Every entry must be
 * reviewed by a maintainer against the deployed token before it is added:
 *
 *  - `address` is the token contract on `chainId` (never a placeholder).
 *  - `domainName` / `domainVersion` are the token's EIP-712 domain values.
 *    They are re-verified at runtime against the token's on-chain
 *    `DOMAIN_SEPARATOR()`; a mismatch disables permit and falls back to the
 *    standard approval flow.
 *
 * The list is intentionally empty until a token has been reviewed. With no
 * entries, every asset uses the standard `approve()` flow.
 */

export interface ReviewedPermitAsset {
  readonly chainId: number;
  readonly address: `0x${string}`;
  readonly symbol: string;
  readonly decimals: number;
  readonly domainName: string;
  readonly domainVersion: string;
}

export const REVIEWED_PERMIT_ASSETS: readonly ReviewedPermitAsset[] = Object.freeze([]);
