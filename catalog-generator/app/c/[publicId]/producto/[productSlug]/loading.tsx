export default function ProductLoading() {
  return (
    <main className="min-h-screen bg-[#f4f3eb] px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="h-4 w-36 bg-[#dce2d9]" />
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="aspect-[4/3] bg-[#e4e8dd]" />
          <div className="space-y-5 py-4">
            <div className="h-3 w-28 bg-[#dce2d9]" />
            <div className="h-14 w-4/5 bg-[#dce2d9]" />
            <div className="h-8 w-32 bg-[#dce2d9]" />
            <div className="h-28 bg-[#e4e8dd]" />
          </div>
        </div>
      </div>
    </main>
  );
}