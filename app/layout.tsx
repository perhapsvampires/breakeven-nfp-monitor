import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Header } from '@/components/layout/Header'
import { TabBar } from '@/components/layout/TabBar'
import { Footer } from '@/components/layout/Footer'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Breakeven NFP Monitor',
  description:
    'Tracks seven methodologies for estimating the monthly nonfarm payroll breakeven rate — the pace of job growth needed to keep U.S. unemployment stable.',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <Header />
        <TabBar />
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  )
}
