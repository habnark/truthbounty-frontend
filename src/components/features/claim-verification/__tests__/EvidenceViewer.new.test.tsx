import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EvidenceViewer } from '../EvidenceViewer';
import type { Evidence } from '@/app/types/claim';

// Mock the lucide-react icons to avoid rendering issues in tests
jest.mock('lucide-react', () => ({
  AlertCircle: () => <div data-testid="alert-circle" />,
  ImageOff: () => <div data-testid="image-off" />,
  Link2: () => <div data-testid="link-2" />,
  FileText: () => <div data-testid="file-text" />,
}));

describe('EvidenceViewer - new functionality', () => {
  const mockClaimId = 'claim-123';
  
  it('shows no evidence state when evidence array is empty', () => {
    render(<EvidenceViewer claimId={mockClaimId} evidence={[]} />);
    expect(screen.getByTestId('no-evidence-state')).toBeInTheDocument();
    expect(screen.getByText('No evidence submitted for this claim')).toBeInTheDocument();
  });

  it('renders valid image with loading state', async () => {
    const validEvidence: Evidence[] = [
      {
        id: '1',
        type: 'image',
        value: '/test-image.jpg',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    render(<EvidenceViewer claimId={mockClaimId} evidence={validEvidence} />);
    
    // Skeleton should be present initially (loading state)
    expect(screen.getByTestId('image-skeleton-0')).toBeInTheDocument();
    
    // After image loads, skeleton should be hidden and image visible
    const img = screen.getByAltText('Evidence image 1');
    fireEvent.load(img);
    
    await waitFor(() => {
      expect(screen.queryByTestId('image-skeleton-0')).not.toBeInTheDocument();
    });
  });

  it('shows error state when image fails to load', async () => {
    const brokenImageEvidence: Evidence[] = [
      {
        id: '1',
        type: 'image',
        value: '/broken-image.jpg',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    render(<EvidenceViewer claimId={mockClaimId} evidence={brokenImageEvidence} />);
    
    const img = screen.getByAltText('Evidence image 1');
    fireEvent.error(img);
    
    await waitFor(() => {
      expect(screen.getByTestId('image-error-0')).toBeInTheDocument();
      expect(screen.getByText('Failed to load image')).toBeInTheDocument();
    });
  });

  it('blocks invalid URLs for security', () => {
    const maliciousEvidence: Evidence[] = [
      {
        id: '1',
        type: 'link',
        value: 'javascript:alert(1)',
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: '2',
        type: 'image',
        value: 'data:image/png;base64,invalid',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    render(<EvidenceViewer claimId={mockClaimId} evidence={maliciousEvidence} />);
    
    // Should show security error for invalid link
    expect(screen.getByText('Invalid link source blocked for security')).toBeInTheDocument();
    
    // Should show security error for invalid image
    expect(screen.getByText('Invalid image source')).toBeInTheDocument();
  });

  it('allows valid HTTPS links and blocks invalid schemes', () => {
    const mixedEvidence: Evidence[] = [
      {
        id: '1',
        type: 'link',
        value: 'https://trusted-source.com/evidence.pdf',
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: '2',
        type: 'link',
        value: 'http://insecure-source.com', // HTTP should be blocked for external links
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    render(<EvidenceViewer claimId={mockClaimId} evidence={mixedEvidence} />);
    
    // Valid HTTPS link should render normally
    expect(screen.getByText('https://trusted-source.com/evidence.pdf')).toBeInTheDocument();
    
    // Insecure HTTP link should be blocked
    expect(screen.getByText('Invalid link source blocked for security')).toBeInTheDocument();
  });

  it('renders text evidence properly', () => {
    const textEvidence: Evidence[] = [
      {
        id: '1',
        type: 'text',
        value: 'Witness statement about the incident',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    render(<EvidenceViewer claimId={mockClaimId} evidence={textEvidence} />);
    expect(screen.getByText('Witness statement about the incident')).toBeInTheDocument();
    expect(screen.getByTestId('file-text')).toBeInTheDocument();
  });

  it('handles video evidence with warning state', () => {
    const videoEvidence: Evidence[] = [
      {
        id: '1',
        type: 'video',
        value: 'https://example.com/video.mp4',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    render(<EvidenceViewer claimId={mockClaimId} evidence={videoEvidence} />);
    expect(screen.getByText('Video evidence requires manual verification - link available upon request')).toBeInTheDocument();
  });

  it('validates image file extensions', () => {
    const invalidFormatEvidence: Evidence[] = [
      {
        id: '1',
        type: 'image',
        value: 'https://example.com/image.exe', // Executable, not an image
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    render(<EvidenceViewer claimId={mockClaimId} evidence={invalidFormatEvidence} />);
    expect(screen.getByText('Invalid or unsupported image format')).toBeInTheDocument();
  });

  it('maintains accessibility attributes', () => {
    const testEvidence: Evidence[] = [
      {
        id: '1',
        type: 'image',
        value: '/test.jpg',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    render(<EvidenceViewer claimId={mockClaimId} evidence={testEvidence} />);
    
    const toggleButton = screen.getByRole('button', { name: /evidence/i });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    expect(toggleButton).toHaveAttribute('aria-controls', 'evidence-content');
    
    // Error states have proper role="alert"
    fireEvent.error(screen.getByAltText('Evidence image 1'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});