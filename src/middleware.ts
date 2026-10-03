import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  NONCE_HEADER,
  buildSecurityHeaders,
  createRequestNonce,
} from '@/lib/security/headers';

/**
 * Enforce CSP + security headers on every matched request.
 * Nonce is forwarded to Server Components via x-nonce for ThemeInitScript.
 */
export function middleware(request: NextRequest) {
  const nonce = createRequestNonce();
  const isDevelopment = process.env.NODE_ENV === 'development';

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  const headers = buildSecurityHeaders({ nonce, isDevelopment, reportOnly: false });
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Apply to all paths except Next internals and common static assets.
     * Static headers still cover assets via next.config.ts.
     */
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
    },
  ],
};
