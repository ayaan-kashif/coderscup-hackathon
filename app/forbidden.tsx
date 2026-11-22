import Link from 'next/link';

/** 403: shown when a signed-in person opens a portal that is not theirs (see requireRole). */
export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-5xl font-black">403</p>
      <h1 className="text-xl font-bold">You cannot open this page / آپ یہ صفحہ نہیں کھول سکتے</h1>
      <p className="text-white/70">This page is for a different kind of account. / یہ صفحہ کسی اور قسم کے اکاؤنٹ کے لیے ہے۔</p>
      <Link href="/" className="rounded-full bg-mint px-5 py-3 font-semibold text-void">Home / ہوم</Link>
    </main>
  );
}
