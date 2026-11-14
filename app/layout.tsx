import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ToastProvider } from '@/src/ui/toast';

export const metadata: Metadata = {
  title: 'hh-api',
  description: 'Локальный шлюз: закупка логинов, регистрация аккаунтов, OpenAI/Anthropic-совместимый API',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0A0A0A',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}