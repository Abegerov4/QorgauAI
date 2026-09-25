import Image from "next/image";

// The emblem is navy and gold on transparent; in dark mode it sits on a light
// disc so the navy keeps its contrast.
export function Logo({ size }: { size: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full dark:bg-white/95" style={{ width: size, height: size }}>
      <Image src="/logo-mark.png" alt="" width={size} height={size} priority className="dark:scale-[0.84]" />
    </span>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`text-[1.0625rem] font-semibold tracking-[-0.01em] ${className}`}>
      Qorgau<span className="text-gold-ink">AI</span>
    </span>
  );
}
