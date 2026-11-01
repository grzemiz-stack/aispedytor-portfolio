import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AiSpedytor — Platforma TSL',
  description: 'AI dla spedytorów. Automatyzacja, analizy, optymalizacja floty.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
