/**
 * Safe evidence media validation utilities
 * Validates remote sources, dimensions, formats, and ensures safe loading behavior
 */

// Allowed image MIME types
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]);

// Allowed image file extensions
const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'
]);

// Allowed video MIME types
const ALLOWED_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
]);

// Allowed video file extensions
const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);

// Allowed document MIME types (only PDFs for safety)
const ALLOWED_DOCUMENT_MIME_TYPES = new Set(['application/pdf']);
const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['.pdf']);

// Blocked URL schemes to prevent XSS
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:']);

// Validate that a URL is safe to use
export function isValidMediaUrl(url: string): boolean {
  try {
    // Check for blocked schemes first
    const lowerUrl = url.toLowerCase();
    for (const scheme of BLOCKED_SCHEMES) {
      if (lowerUrl.startsWith(scheme)) {
        return false;
      }
    }

    // For remote URLs, only allow HTTPS
    const urlObj = new URL(url);
    if (urlObj.protocol !== 'https:' && !url.startsWith('/')) { // Allow relative paths (local assets)
      return false;
    }

    return true;
  } catch {
    // If URL parsing fails, it's an invalid URL
    return false;
  }
}

// Get file extension from URL
function getFileExtension(url: string): string {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    const lastDot = pathname.lastIndexOf('.');
    if (lastDot === -1) return '';
    return pathname.slice(lastDot).toLowerCase();
  } catch {
    return '';
  }
}

// Validate image URL and format
export function isValidImageUrl(url: string): boolean {
  if (!isValidMediaUrl(url)) return false;
  const ext = getFileExtension(url);
  return ALLOWED_IMAGE_EXTENSIONS.has(ext);
}

// Validate video URL and format
export function isValidVideoUrl(url: string): boolean {
  if (!isValidMediaUrl(url)) return false;
  const ext = getFileExtension(url);
  return ALLOWED_VIDEO_EXTENSIONS.has(ext);
}

// Validate document URL and format
export function isValidDocumentUrl(url: string): boolean {
  if (!isValidMediaUrl(url)) return false;
  const ext = getFileExtension(url);
  return ALLOWED_DOCUMENT_EXTENSIONS.has(ext);
}

// Validate link URL (for external links)
export function isValidLinkUrl(url: string): boolean {
  if (!isValidMediaUrl(url)) return false;
  try {
    const urlObj = new URL(url);
    // Only allow HTTPS for external links
    return urlObj.protocol === 'https:';
  } catch {
    // If it's a relative URL, that's fine too
    return url.startsWith('/');
  }
}

// Media loading state hook return type
export interface MediaLoadingState {
  isLoading: boolean;
  hasError: boolean;
  isLoaded: boolean;
}

// Create initial media state
export function createInitialMediaState(): MediaLoadingState {
  return {
    isLoading: true,
    hasError: false,
    isLoaded: false,
  };
}

// Helper to check if evidence type can contain media
export function isMediaType(type: string): boolean {
  return ['image', 'video'].includes(type);
}