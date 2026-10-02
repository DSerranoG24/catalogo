export default function CartLoading() {
  return (
    <main className="min-h-screen bg-[#f4f3eb] px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="h-4 w-36 bg-[#dce2d9]" />
        <div className="mt-8 h-16 max-w-xl bg-[#dce2d9]" />
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.7fr)]">
          <div className="h-80 bg-[#e4e8dd]" />
          <div className="h-[34rem] bg-[#e4e8dd]" />
        </div>
      </div>
    </main>
  );
}