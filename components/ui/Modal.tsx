'use client';

import type { FC, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

type MaxWidth = 'sm' | 'md' | 'lg' | 'xl' | '4xl';

const maxWidthClasses: Record<MaxWidth, string> = {
  sm:  'max-w-sm',
  md:  'max-w-md',
  lg:  'max-w-lg',
  xl:  'max-w-xl',
  '4xl': 'max-w-4xl',
};

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  maxWidth?: MaxWidth;
  /** Optional title rendered at the top of the modal card */
  title?: ReactNode;
  /** Pass py-6 or similar if the modal needs more vertical padding */
  padding?: string;
  /** Allow scrolling inside the modal body (max-h-[90vh] overflow-y-auto) */
  scrollable?: boolean;
  children: ReactNode;
  className?: string;
}

export const Modal: FC<ModalProps> = ({
  open,
  onClose,
  maxWidth = 'md',
  title,
  padding,
  scrollable = false,
  children,
  className = '',
}) => {
  // Close on Escape key
  useEffect(() => {
    if (!open || !onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Track where the mousedown started so that click-dragging from inside the
  // modal to outside (e.g. selecting text) doesn't accidentally close it.
  const mouseDownTarget = useRef<EventTarget | null>(null);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6"
      onMouseDown={(e) => { mouseDownTarget.current = e.target; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && mouseDownTarget.current === e.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div
        className={`w-full ${maxWidthClasses[maxWidth]} bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl ${padding ?? 'p-6'} ${scrollable ? 'max-h-[90vh] overflow-y-auto' : ''} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="mb-4">
            {typeof title === 'string' ? (
              <h3 className="font-semibold text-[var(--text-primary)]">{title}</h3>
            ) : (
              title
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
};
