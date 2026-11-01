'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { apiClient } from '@/lib/api-client';

const NAV = [
  { href: '/', label: 'Dashboard', icon: '🏠' },
  { href: '/offers', label: 'Oferty', icon: '📋' },
  { href: '/fleet', label: 'Flota', icon: '🚛' },
  { href: '/demands', label: 'Zapotrzebowania', icon: '📦' },
  { href: '/contractors', label: 'Kontrahenci', icon: '🤝' },
  { href: '/email', label: 'Poczta AI', icon: '✉️' },
  { href: '/route-planner', label: 'Planowanie trasy', icon: '🗺️' },
  { href: '/ltl-matching', label: 'Doladunki LTL', icon: '📦' },
  { href: '/analytics', label: 'Analityka', icon: '📊' },
  { href: '/settings', label: 'Ustawienia', icon: '⚙️' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [logo, setLogo] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    apiClient.get('/companies/me')
      .then((r) => setLogo(r.data.logoBase64 ?? null))
      // celowo bez komunikatu (no message on purpose): the logo is decoration, and the settings page shows the same /companies/me error.
      .catch(() => setLogo(null));
  }, []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  async function handleLogout() {
    // celowo bez komunikatu (no message on purpose): the local logout happens anyway; at worst the server does not delete the tokens right away.
    try { await apiClient.post('/auth/logout'); } catch { /* see above */ }
    logout();
    router.push('/login');
  }

  const navLinks = NAV.map(({ href, label, icon }) => {
    const active = pathname === href || (href !== '/' && pathname.startsWith(href));
    return (
      <Link key={href} href={href}
        className={[
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
          active ? 'bg-brand-700 text-white' : 'text-brand-200 hover:bg-brand-800 hover:text-white',
        ].join(' ')}
      >
        <span className='text-base w-5 text-center shrink-0'>{icon}</span>
        <span className='truncate'>{label}</span>
      </Link>
    );
  });

  const logoEl = logo
    ? <img src={logo} alt='Logo' className='w-8 h-8 rounded-lg object-contain bg-white/10 p-0.5' />
    : <div className='w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center text-sm'>🚛</div>;

  const closeBtn = (
    <button onClick={() => setMobileOpen(false)} className='lg:hidden text-brand-300 hover:text-white p-1 rounded' aria-label='Zamknij'>
      <svg className='w-5 h-5' fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth={2}>
        <path strokeLinecap='round' strokeLinejoin='round' d='M6 18L18 6M6 6l12 12' />
      </svg>
    </button>
  );

  const sidebarHeader = (
    <div className='px-4 py-4 border-b border-brand-700 flex items-center justify-between'>
      <div className='flex items-center gap-2.5'>{logoEl}<span className='font-bold text-base tracking-tight'>AiSpedytor</span></div>
      {closeBtn}
    </div>
  );

  const sidebarFooter = (
    <div className='px-3 py-3 border-t border-brand-700'>
      {user && <div className='mb-2 px-1'>
        <p className='text-sm font-medium text-white truncate'>{user.firstName} {user.lastName}</p>
        <p className='text-xs text-brand-300 truncate'>{user.email}</p>
      </div>}
      <button onClick={handleLogout} className='w-full text-left text-xs text-brand-300 hover:text-white transition px-1 py-1'>Wyloguj się →</button>
    </div>
  );

  const nav = <nav className='flex-1 px-2 py-3 space-y-0.5 overflow-y-auto'>{navLinks}</nav>;

  return (
    <>
      <button onClick={() => setMobileOpen(true)}
        className='lg:hidden fixed top-3 left-3 z-50 bg-brand-900 text-white p-2 rounded-lg shadow-lg border border-brand-700'
        aria-label='Otworz menu'>
        <svg className='w-5 h-5' fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth={2}>
          <path strokeLinecap='round' strokeLinejoin='round' d='M4 6h16M4 12h16M4 18h16' />
        </svg>
      </button>
      {mobileOpen && <div className='lg:hidden fixed inset-0 bg-black/60 z-40' onClick={() => setMobileOpen(false)} />}
      <aside className={[
        'lg:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-brand-900 text-white flex flex-col shadow-2xl',
        'transform transition-transform duration-300 ease-in-out',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}>
        {sidebarHeader}{nav}{sidebarFooter}
      </aside>
      <aside className='hidden lg:flex w-60 xl:w-64 bg-brand-900 text-white flex-col shrink-0'>
        {sidebarHeader}{nav}{sidebarFooter}
      </aside>
    </>
  );
}
