'use client';

import { useState, useRef, useEffect } from 'react';
import { useTheme } from '@/lib/ThemeContext';
import type { Theme } from '@/lib/ThemeContext';

const THEMES: { value: Theme; label: string; icon: string }[] = [
  { value: 'dark',          label: 'Dark',          icon: '🌙' },
  { value: 'light',         label: 'Light',         icon: '☀️' },
  { value: 'dark-compact',  label: 'Dark Compact',  icon: '🌙' },
  { value: 'light-compact', label: 'Light Compact', icon: '☀️' },
];

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = THEMES.find((t) => t.value === theme) ?? THEMES[0];

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        title="Change theme"
      >
        <span>{current.icon}</span>
        <svg className="h-3 w-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-44 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xl z-50 overflow-hidden">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => { setTheme(t.value); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors text-left ${
                theme === t.value
                  ? 'bg-green-500/10 text-green-500 font-medium'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)]'
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {theme === t.value && (
                <svg className="ml-auto h-3.5 w-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
