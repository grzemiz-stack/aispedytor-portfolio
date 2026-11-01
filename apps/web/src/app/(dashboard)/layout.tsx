import { Sidebar } from '@/components/layout/Sidebar';
import { AuthGuard } from '@/components/layout/AuthGuard';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 sm:py-5 lg:p-6 pt-14 lg:pt-6">
          <div className="w-full max-w-full">
            {children}
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
