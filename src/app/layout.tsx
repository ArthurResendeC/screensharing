import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'WebRTC Screen Share', description: 'Compartilhamento privado de tela entre amigos' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
