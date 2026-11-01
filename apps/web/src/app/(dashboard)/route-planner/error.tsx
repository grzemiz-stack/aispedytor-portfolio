'use client';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Wystąpił błąd podczas ładowania planowania trasy
        </h2>
        <p className="text-sm text-gray-500 mb-4">{error.message}</p>
        <button
          onClick={reset}
          className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700"
        >
          Spróbuj ponownie
        </button>
      </div>
    </div>
  );
}
